#!/usr/bin/env node
/**
 * חדר הסוכנים — שומר עלות (11/11): הריצה האיטית של הדופק (כל 10 דק') לא קוראת את כל orders.
 *  • בלי waMeta/agentConfig — אף פעם לא קוראים את orders.
 *  • הזמנות תקועות — רק כשיש הגדרות והעוקב לא כבוי, לכל היותר פעם בשעה.
 *  • זמן רגיל לכל שלב (_agent-stats) — לכל היותר פעם ביום (computedAt).
 * Run:  node scripts/test-agent-cost-guard.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const W = require(path.join(ROOT, 'api', '_agent-watch.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const DAY = 24 * 3600 * 1000, MIN = 60 * 1000, H = 60 * MIN;
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = (okev, kolet) => ({ agents: { markazan: 'shadow', okev, archive: 'shadow', price: 'shadow', kolet: kolet || 'off', manager: 'off' } });

const hist = n => {
  const out = {};
  for (let i = 0; i < n; i++) {
    const c = NOW - (10 + i) * DAY;
    out['h' + i] = { customerId: '777', orderNum: 'L9' + i, stage: 'done', createdAt: c, optyAt: c + 2 * DAY, readyAt: c + 5 * DAY };
  }
  return out;
};

//  כפיל שסופר כל קריאה של orders (once על 'orders' או מתחתיו)
function spyDb(initial) {
  const d = fakeDb(initial);
  d.reads = [];
  const ref = d.ref.bind(d);
  d.ref = p => {
    const r = ref(p);
    const once = r.once;
    r.once = async (...a) => { d.reads.push(String(p)); return once(...a); };
    return r;
  };
  return d;
}
const ordersReads = d => d.reads.filter(p => p === 'orders' || p.startsWith('orders/')).length;
const seed = cfg => spyDb({
  orders: { ...hist(12), a: { customerId: '777', orderNum: 'L1', stage: 'workday', optyAt: NOW - 7 * DAY } },
  waMeta: { ...(cfg ? { agentConfig: cfg } : {}) },
});

(async () => {
  {
    const d = seed(null);
    for (let i = 0; i < 4; i++) await W.lgAgentWatchRun(d, { env: ENV, now: NOW + i * 11 * MIN });
    check('no agentConfig: orders never read', ordersReads(d), 0);
    check('no agentConfig: no stats written', !!(d._data.waMeta.agentStats), false);
  }
  {
    //  ארכיון מפעיל גם הוא את סריקת השעה (חשבשבת דחה חשבונית — השומרים, 11/11) → כבוי גם הוא כאן
    const d = seed({ agents: { ...CFG('off').agents, archive: 'off' } });
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW });
    check('okev, kolet and archive off: orders never read', ordersReads(d), 0);
  }
  {
    const d = seed(CFG('shadow'));
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW });
    check('first slow run: orders read once', ordersReads(d), 1);
    check('stats stored with computedAt', d._data.waMeta.agentStats.stageDays.computedAt, NOW);
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW + 11 * MIN });
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW + 22 * MIN });
    check('slow runs inside the hour: no more orders reads', ordersReads(d), 1);
    const okev = () => Object.values(d._data.waMeta.agentRoom || {}).filter(v => v.agent === 'okev');
    check('stuck problem kept between hourly scans (not dropped, not repeated)',
      [okev().length, Object.keys(d._data.waMeta.agentWatch.problems).filter(k => k.startsWith('stuck_')).length], [1, 1]);
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW + 61 * MIN });
    check('after an hour: orders read again', ordersReads(d), 2);
    check('stats NOT recomputed within the day', d._data.waMeta.agentStats.stageDays.computedAt, NOW);
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW + DAY + 2 * MIN });
    check('after a day: stats recomputed', d._data.waMeta.agentStats.stageDays.computedAt, NOW + DAY + 2 * MIN);
  }
  {
    //  הסטטיסטיקה השמורה משמשת לבדיקת התקועות גם כשלא מחשבים מחדש
    const d = seed(CFG('shadow'));
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW });
    d._data.orders.b = { customerId: '777', orderNum: 'L2', stage: 'workday', optyAt: NOW - 8 * DAY };
    await W.lgAgentWatchRun(d, { env: ENV, now: NOW + 61 * MIN });
    check('stuck from cached stats', Object.keys(d._data.waMeta.agentWatch.problems).filter(k => k.startsWith('stuck_')).sort(), ['stuck_a_prod', 'stuck_b_prod']);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
