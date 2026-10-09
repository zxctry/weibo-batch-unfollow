/*
 * 微博：一键取消全部「非互关」账号的关注
 * 用法：浏览器登录 weibo.com → F12 → Console → 粘贴本脚本 → 回车 → 弹窗点「确定」
 * 原理：反复读取关注列表 → 取消其中「对方没回关我」的账号 → 直到全部清完。
 */
(async function () {
  'use strict';

  // ================= 可调参数 =================
  const DELAY_MIN  = 1800;   // 两次取消之间的最小间隔（毫秒），不要低于 1000
  const DELAY_MAX  = 3500;   // 最大间隔（毫秒）
  const MAX_ROUNDS = 800;    // 最多循环多少轮（安全上限，一般用不到）
  const MAX_PAGES  = 100;    // 每轮最多抓多少页关注列表
  // ===========================================

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd   = () => DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);

  function getToken() {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function getMyUid() {
    try { if (window.$CONFIG && window.$CONFIG.uid) return String(window.$CONFIG.uid); } catch (e) {}
    try { if (window.$CONFIG && window.$CONFIG.user && window.$CONFIG.user.id) return String(window.$CONFIG.user.id); } catch (e) {}
    const m = location.href.match(/weibo\.com\/(?:u\/)?(\d{6,})/);
    return m ? m[1] : '';
  }

  const uid   = getMyUid();
  const token = getToken();
  if (!uid)   { alert('没自动认出你的微博 uid。\n请先打开你自己的主页（网址里有那串数字），再重新粘贴运行。'); return; }
  if (!token) { alert('没找到登录凭证，请确认已登录微博。'); return; }
  console.log('%c✅ 我的 uid：' + uid, 'color:#0a0;font-weight:bold');

  // 抓取一页关注列表（兼容两种接口路径）
  async function fetchPage(page) {
    const urls = [
      '/ajax/profile/followContent?uid=' + uid + '&page=' + page,
      '/ajax/friendships/friends?uid=' + uid + '&page=' + page,
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: 'include', headers: { 'x-requested-with': 'XMLHttpRequest' } });
        const j = await res.json();
        const list = (j && j.data && (j.data.list || j.data.users || j.data.friends)) || (j && j.users) || [];
        if (Array.isArray(list) && list.length) return { list, raw: j };
      } catch (e) { /* 换下一个接口 */ }
    }
    return { list: [], raw: null };
  }

  // 先抓一次，确定「是否互关」的字段名
  const probe = await fetchPage(1);
  if (!probe.list.length) { alert('没能读到关注列表，可能接口变了。请把 Console 报错发我。'); return; }
  const sample = probe.list[0];
  const mutualKey = ['follow_me', 'is_follow_me', 'followMe', 'follow_me_flag'].find(k => k in sample);
  if (!mutualKey) {
    console.warn('⚠️ 没找到「是否互关」字段。请把下面这行原始数据发我：');
    console.log('可用字段：', Object.keys(sample), sample);
    alert('脚本拿不到「互关」信息，先停一下。请把 Console 里的原始数据发给作者。');
    return;
  }
  const isMutual = u => { const v = u[mutualKey]; return v === true || v === 1 || v === '1' || v === 'true'; };

  const yes = confirm('即将自动取消你所有「非互关」账号的关注（对方没关注你的那些）。\n\n脚本会一直运行到清完为止，中途请不要关闭页面。\n\n⚠️ 不可撤销，确定继续吗？');
  if (!yes) { console.log('已取消，未做任何操作。'); return; }

  // 取消关注（注意：微博接口就是拼写为 destory）
  async function destroy(id) {
    const res = await fetch('/ajax/friendships/destory', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-xsrf-token': token,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: 'uid=' + encodeURIComponent(id),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { __html: text.slice(0, 120) }; }
  }

  const done = new Set();      // 已处理过的 uid，避免同一轮或跨轮重复
  let ok = 0, fail = 0, round = 0;

  console.log('%c🚀 开始清理所有非互关账号…', 'color:#e60;font-weight:bold');

  while (round < MAX_ROUNDS) {
    round++;

    // 每轮都重新读取关注列表（就地取关后列表会滚动，后面的人会补上来）
    const all = [];
    const seen = new Set();
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { list } = await fetchPage(p);
      if (!list.length) break;
      let added = 0;
      for (const u of list) {
        const id = String(u.idstr || u.id);
        if (!seen.has(id)) { seen.add(id); all.push(u); added++; }
      }
      if (added === 0) break;   // 没有新数据，说明翻页到底或分页失效
      await sleep(400);
    }

    const targets = all.filter(u => {
      const id = String(u.idstr || u.id);
      return !done.has(id) && !isMutual(u);
    });

    if (!targets.length) { console.log('%c✅ 已无更多非互关账号，结束。', 'color:#0a0;font-weight:bold'); break; }

    console.log('%c 第 ' + round + ' 轮：本轮取消 ' + targets.length + ' 个（累计成功 ' + ok + '）', 'color:#08f;font-weight:bold');

    for (const u of targets) {
      const id = String(u.idstr || u.id);
      try {
        const r = await destroy(id);
        if (r.ok === 1 || r.code === 100000) { ok++; console.log('✅ ' + u.screen_name); }
        else if (r.__html) { fail++; console.warn('⚠️ ' + u.screen_name + '：接口返回网页，内容 ' + r.__html); }
        else { fail++; console.warn('⚠️ ' + u.screen_name + '：' + (r.msg || r.error || JSON.stringify(r).slice(0, 100))); }
      } catch (e) { fail++; console.warn('⚠️ ' + u.screen_name + '：' + e.message); }
      done.add(id);
      await sleep(rnd());
    }

    await sleep(800);
  }

  console.log('%c🏁 全部完成：成功 ' + ok + '，失败 ' + fail, 'color:#0a0;font-weight:bold');
  alert('全部完成！成功取消 ' + ok + ' 个，失败 ' + fail + ' 个。');
})();