#!/usr/bin/env node
/**
 * שיפורים 2+3 (חדר הסוכנים): עוקב — "מתי יהיה מוכן?" + הזמנה תקועה.
 *  • lgStageStats — מהיסטוריית ההזמנות (60 יום): createdAt / optyAt / readyAt / deliveryAt.
 *  • lgOkevEta — "בדרך כלל זה לוקח עוד בערך N ימים" רק מ-10 דגימות.
 * Run:  node scripts/test-agent-stage-stats.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const ST = require(path.join(ROOT, 'api', '_agent-stats.js'));
const W = require(path.join(ROOT, 'api', '_agent-watch.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const DAY = 24 * 3600 * 1000, MIN = 60 * 1000;
const PRIV = '972501234567@c.us';
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222' };
const CFG = mode => ({ agents: { markazan: 'reply', okev: mode, archive: 'reply', price: 'reply', kolet: 'reply', manager: 'reply' }, escalatePhone: '0547725552' });

//  היסטוריה: 12 הזמנות שהסתיימו — 2 ימים עד OptyWay, ועוד 3 ימים עד מוכן
const hist = (n, extra) => {
  const out = {};
  for (let i = 0; i < n; i++) {
    const created = NOW - (10 + i) * DAY;
    out['h' + i] = { customerId: '777', orderNum: 'L9' + i, stage: i % 2 ? 'collected' : 'done',
                     createdAt: created, optyAt: created + 2 * DAY, readyAt: created + 5 * DAY, ...(extra || {}) };
  }
  return out;
};

(async () => {
  /* ── lgStageStats ── */
  {
    const s = ST.lgStageStats(hist(12), NOW);
    check('stats: pre phase — in stage 2 days, to ready 5 days, 12 samples', s.phases.pre, { inStage: { n: 12, days: 2 }, remain: { n: 12, days: 5 } });
    check('stats: prod phase — 3 days', s.phases.prod, { inStage: { n: 12, days: 3 }, remain: { n: 12, days: 3 } });
    const old = { o: { createdAt: NOW - 90 * DAY, optyAt: NOW - 88 * DAY, readyAt: NOW - 85 * DAY } };
    check('stats: older than 60 days → ignored', ST.lgStageStats(old, NOW).phases.prod.remain.n, 0);
    const del = { d: { createdAt: NOW - 20 * DAY, deliveryAt: NOW - 14 * DAY, optyAt: NOW - 16 * DAY } };
    check('stats: delivery counts as ready', ST.lgStageStats(del, NOW).phases.prod.remain, { n: 1, days: 2 });
    const junk = { t: { isTest: true, createdAt: NOW - 20 * DAY, optyAt: NOW - 10 * DAY, readyAt: NOW - 5 * DAY },
                   s: { isSample: true, createdAt: NOW - 20 * DAY, optyAt: NOW - 10 * DAY, readyAt: NOW - 5 * DAY } };
    check('stats: test / sample orders ignored', ST.lgStageStats(junk, NOW).phases.pre.inStage.n, 0);
  }

  /* ── lgOkevEta ── */
  {
    const s = ST.lgStageStats(hist(12), NOW);
    check('eta: pending, created 1 day ago → 4 more days', ST.lgOkevEta({ stage: 'pending', createdAt: NOW - DAY }, s, NOW), 4);
    check('eta: workday, opty 1 day ago → 2', ST.lgOkevEta({ stage: 'workday', optyAt: NOW - DAY }, s, NOW), 2);
    check('eta: already past the usual → 0 (say nothing)', ST.lgOkevEta({ stage: 'workday', optyAt: NOW - 4 * DAY }, s, NOW), 0);
    check('eta: done → 0', ST.lgOkevEta({ stage: 'done', optyAt: NOW - DAY }, s, NOW), 0);
    check('eta: fewer than 10 samples → 0', ST.lgOkevEta({ stage: 'workday', optyAt: NOW - DAY }, ST.lgStageStats(hist(9), NOW), NOW), 0);
    check('eta: no stats → 0', ST.lgOkevEta({ stage: 'workday', optyAt: NOW - DAY }, null, NOW), 0);
    check('eta text', ST.lgOkevEtaText(2), 'בדרך כלל זה לוקח עוד בערך 2 ימים');
    check('eta text one day', ST.lgOkevEtaText(1), 'בדרך כלל זה לוקח עוד בערך יום');
  }

  /* ── הריצה האיטית של הדופק ── */
  const seed = cfg => fakeDb({
    orders: { ...hist(12), a: { customerId: '777', orderClient: 'כהן', orderNum: 'L1', sketchName: 'מטבח', stage: 'workday', optyAt: NOW - 7 * DAY } },
    waMeta: { ...(cfg ? { agentConfig: cfg } : {}) },
  });
  const roomOf = d => Object.values((d._data.waMeta || {}).agentRoom || {});
  {
    const d = seed(CFG('shadow'));
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW });
    check('watch: stats cached in waMeta/agentStats/stageDays', [d._data.waMeta.agentStats.stageDays.phases.prod.inStage, d._data.waMeta.agentStats.stageDays.at],
      [{ n: 12, days: 3 }, NOW]);
  }
  {
    const d = seed(CFG('off'));
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW });
    check('watch okev off: no stats computed', !!(d._data.waMeta.agentStats), false);
  }

  /* ── תשובת עוקב עם "בדרך כלל" ── */
  const seedAct = cfg => fakeDb({
    waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
    orders: { w1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday', optyAt: NOW - DAY } },
    waMeta: { agentPilot: { 777: true }, agentStats: { stageDays: ST.lgStageStats(hist(12), NOW) }, ...(cfg ? { agentConfig: cfg } : {}) },
  });
  const put = (d, k) => { d._data.waMeta.agentShadow = { [k]: { idMessage: k, chatId: PRIV, groupId: '', sender: '0501234567', hasImage: false, quotedId: '',
    state: 'done', timestamp: NOW, linked: true, linkVia: 'sender', route: 'okev', intent: 'status', ref: 'כהן', customerId: '777', customerName: 'כהן זכוכית', text: 'מתי יהיה מוכן?' } }; };
  const stub = async () => ({ sent: 0 });
  const said = d => Object.values(d._data.waMeta.agentOutbox || {}).map(e => e.text);
  {
    const d = seedAct(CFG('reply')); put(d, 'k1');
    await act.lgAgentAct(d, 'k1', { env: ON, now: NOW, sendPending: stub });
    check('okev reply: status + usual time', said(d), ['הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור. בדרך כלל זה לוקח עוד בערך 2 ימים']);
  }
  {
    const d = seedAct(null); put(d, 'k2');
    await act.lgAgentAct(d, 'k2', { env: ON, now: NOW, sendPending: stub });
    check('okev no agentConfig: unchanged text', said(d), ['הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור']);
  }
  {
    const d = seedAct(CFG('reply')); d._data.waMeta.agentStats.stageDays = ST.lgStageStats(hist(9), NOW); put(d, 'k3');
    await act.lgAgentAct(d, 'k3', { env: ON, now: NOW, sendPending: stub });
    check('okev <10 samples: nothing added', said(d), ['הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור']);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
