#!/usr/bin/env node
/**
 * מנהל — סיכום יומי: אימות cron, ספירות, שליחה לצוות בלבד, ללא כפילות, vercel.json.
 * Run:  node scripts/test-agent-daily.js
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const D = require(path.join(ROOT, 'api', '_agent-daily.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 9, 31, 13, 0, 0);     // 31.10.2026 15:00 ישראל (חורף? UTC+2 אחרי 25/10)
const H = 3600 * 1000;
const ENV = { CRON_SECRET: 'sek', AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true',
  AGENT_STAFF_PHONES: '0501112222,0502223333', AGENT_SUMMARY_TO: '0501112222, 0504445555' };
const req = tok => ({ headers: tok ? { authorization: 'Bearer ' + tok } : {} });

function provider() {
  const p = { name: 'fake', configured: true, globalSlot: true, maxPerRun: 10, checksState: true, nextGap: () => 0, texts: [],
    async getState() { return { ok: true, state: 'authorized', reason: '' }; },
    gate(c) { return c.linked === true ? { allowed: true, reason: '' } : { allowed: false, reason: 'x' }; },
    async sendText(f) { p.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length }; } };
  return p;
}
const seed = () => fakeDb({ waMeta: {
  agentShadow: {
    a: { createdAt: NOW - 1 * H, linked: true, route: 'okev', acted: true, state: 'done' },
    b: { createdAt: NOW - 2 * H, linked: true, route: 'quote', acted: true, wouldAct: [{ type: 'reply' }, { type: 'staff' }], state: 'done' },
    c: { createdAt: NOW - 3 * H, linked: false, route: 'shaul', acted: false, state: 'done' },
    d: { createdAt: NOW - 4 * H, linked: true, route: 'okev', acted: false, verdict: { ok: false }, state: 'done' },
    st: { createdAt: NOW - 1 * H, linked: false, staff: true, route: 'staff', acted: false, state: 'done' },
    old: { createdAt: NOW - 30 * H, linked: true, route: 'okev', acted: true, state: 'done' },
  },
  agentQuotes: {
    7: { state: 'waiting', at: NOW - 1 * H, customerId: '1' },
    8: { state: 'waiting', at: NOW - 5 * H, customerId: '1' },
    9: { state: 'relaying', at: NOW - 4 * H, customerId: '1' },
    10: { state: 'answered', at: NOW - 9 * H, customerId: '1' },
  },
  agentCancels: {
    x1: { order: { orderNum: 'L2001' }, at: NOW - H, hsSent: true, done: false, confirmed: true },
    x2: { order: { orderNum: 'L2002' }, at: NOW - H, hsSent: true, done: true, confirmed: true },
    x3: { order: { orderNum: 'L2003' }, at: NOW - H, hsSent: false, done: false, confirmed: true },
  },
} });

(async () => {
  /* אימות */
  {
    const db = seed();
    check('no secret configured → 401', (await D.lgAgentDailyRun(req('sek'), { db, env: { ...ENV, CRON_SECRET: '' }, now: NOW, provider: provider() })).status, 401);
    check('no header → 401', (await D.lgAgentDailyRun(req(''), { db, env: ENV, now: NOW, provider: provider() })).status, 401);
    check('wrong secret → 401', (await D.lgAgentDailyRun(req('nope'), { db, env: ENV, now: NOW, provider: provider() })).status, 401);
    check('401 sent nothing', db._data.waMeta.agentOutbox, undefined);
  }
  /* ספירות */
  {
    const sdb = seed();
    sdb._data.waMeta.agentOutbox = {   // F2: חסומות ב-24 השעות האחרונות
      b1: { state: 'blocked', updatedAt: NOW - H }, b2: { state: 'blocked', updatedAt: NOW - 2 * H },
      b3: { state: 'blocked', updatedAt: NOW - 30 * H }, s1: { state: 'sent', updatedAt: NOW - H } };
    const s = await D.lgAgentDailySummary(sdb, NOW);
    check('counts', s.counts, { incoming: 4, selfClosed: 1, toShaul: 1, quotesWaiting: 2, cancelsWaitingHs: 1,
      markedWrong: 1, unlinked: 1, quotesStuck: 2, blockedSends: 2 });
    check('text', s.text.split('\n'), [
      'סיכום סוכנים — 31.10.2026', 'הודעות שנכנסו: 4', 'נסגרו לבד: 1', 'הועברו לשאול: 1',
      'הצעות מחיר שמחכות לשאול: 2 (#7, #8)', 'ביטולים שמחכים לחשבשבת: 1 (L2001)', 'סומנו ✗ בפאנל: 1',
      'ממספרים לא מקושרים: 1', 'הצעות מחיר תקועות (מעל 3 שעות): 2 (#8, #9)', 'נחסמו בשליחה: 2']);
  }
  /* שליחה לצוות בלבד + בלי כפילות */
  {
    const db = seed(), p = provider();
    const r = await D.lgAgentDailyRun(req('sek'), { db, env: ENV, now: NOW, provider: p });
    check('200 + one sent', [r.status, r.body.ok, r.body.sent, r.body.failed], [200, true, 1, 0]);
    check('sent to staff recipient only', p.texts.length, 1);
    check('non-staff skipped with reason', r.body.skipped.map(x => x.to), ['0504445555']);
    check('summary counts in response', r.body.summary.incoming, 4);
    check('response has no message text', JSON.stringify(r.body).includes('סיכום סוכנים'), false);
    const r2 = await D.lgAgentDailyRun(req('sek'), { db, env: ENV, now: NOW + H, provider: p });
    check('second run same day → no resend', [r2.body.sent, p.texts.length], [0, 1]);
    check('deterministic key', Object.keys(db._data.waMeta.agentOutbox), ['daily-2026-10-31-0501112222']);
  }
  /* כבוי */
  {
    const db = seed(), p = provider();
    const r = await D.lgAgentDailyRun(req('sek'), { db, env: { ...ENV, AGENT_SHADOW_ENABLED: 'false' }, now: NOW, provider: p });
    check('shadow off → nothing sent/queued', [r.status, r.body.sent, r.body.summary, p.texts.length, db._data.waMeta.agentOutbox], [200, 0, null, 0, undefined]);
    const db2 = seed();
    const r3 = await D.lgAgentDailyRun(req('sek'), { db: db2, env: { ...ENV, AGENT_REPLY_ENABLED: '' }, now: NOW, provider: provider() });
    check('reply off → no summary queued', [r3.body.summary, db2._data.waMeta.agentOutbox], [null, undefined]);
  }
  /* תקציב: הסיכום נכנס ונשלח לפני רשת הביטחון, גם כשהעיבוד היה חורג */
  {
    const db = seed(); let t = 0;
    db._data.waMeta.agentShadow.pend = { createdAt: NOW - H, linked: true, state: 'received', attempts: 0, chatId: 'x@c.us', sender: '0500000000', text: 'q' };
    const p = provider();
    const orig = p.sendText; p.sendText = async f => { t = 11000; return orig(f); };   // השליחה אכלה את התקציב
    const r = await D.lgAgentDailyRun(req('sek'), { db, env: ENV, now: NOW, provider: p, clock: () => t });
    check('overrun: summary sent, shadow work skipped', [r.body.sent, p.texts.length, r.body.shadowProcessed, db._data.waMeta.agentShadow.pend.state], [1, 1, 0, 'received']);
    const db2 = seed(); const p2 = provider();
    const r2 = await D.lgAgentDailyRun(req('sek'), { db: db2, env: ENV, now: NOW, provider: p2, clock: () => 0 });
    check('no overrun: ok', [r2.body.sent, r2.body.failed], [1, 0]);
  }
  /* R14: פריט צל מתחיל רק אם עברו ≤10ש׳; שליחה רק אם נשארו ≥35ש׳ ותקציבה left−30ש׳ */
  {
    const budgets = [];
    const spy = (t) => ({ ...provider() });
    const send = require(path.join(ROOT, 'api', '_agent-send.js'));
    const orig = send.lgAgentSendPending;
    const deadlines = [], clocks = [];
    send.lgAgentSendPending = async (d, o) => { budgets.push(o.budgetMs); deadlines.push(o.deadline); clocks.push(typeof o.clock); return { sent: 0, failed: 0 }; };
    delete require.cache[require.resolve(path.join(ROOT, 'api', '_agent-daily.js'))];
    const D2 = require(path.join(ROOT, 'api', '_agent-daily.js'));
    let t = 0;
    await D2.lgAgentDailyRun(req('sek'), { db: seed(), env: ENV, now: NOW, provider: provider(), clock: () => t });
    check('send: no relative budget (F1 deadline instead)', budgets[0], undefined);
    check('F1 send gets the run deadline (start + 50s) + clock', [deadlines[0], clocks[0]], [50000, 'function']);
    budgets.length = 0; t = 0;
    const clk = () => t; const c0 = clk;
    await D2.lgAgentDailyRun(req('sek'), { db: seed(), env: { ...ENV, AGENT_SUMMARY_TO: '' }, now: NOW, provider: provider(), clock: (() => { let n = 0; return () => (n++ === 0 ? 0 : 26000); })() });
    check('34s left → send not started', budgets, []);
    send.lgAgentSendPending = orig;
    delete require.cache[require.resolve(path.join(ROOT, 'api', '_agent-daily.js'))];
    for (const [el, want] of [[9000, 'done'], [11000, 'received']]) {
      const D3 = require(path.join(ROOT, 'api', '_agent-daily.js'));
      const db = seed(); let n = 0;
      db._data.waMeta.agentShadow.pend = { createdAt: NOW - H, linked: false, staff: false, state: 'received', attempts: 0, chatId: '972500000000@c.us', sender: '0500000000' };
      await D3.lgAgentDailyRun(req('sek'), { db, env: { ...ENV, AGENT_SUMMARY_TO: '' }, now: NOW, provider: provider(), clock: () => (n++ === 0 ? 0 : el) });
      check('shadow item at elapsed ' + el + ' → ' + want, db._data.waMeta.agentShadow.pend.state, want);
    }
  }
  /* תיקון סופי 1: רשומת צל בריצה היומית מקבלת את הדדליין (התחלה + 50ש׳) */
  {
    const sh = require(path.join(ROOT, 'api', '_agent-shadow.js'));
    const origP = sh.lgAgentShadowProcess, seen = [];
    sh.lgAgentShadowProcess = async (d, k, o) => { seen.push([o.deadline, typeof o.clock]); return { ok: false }; };
    delete require.cache[require.resolve(path.join(ROOT, 'api', '_agent-daily.js'))];
    const D4 = require(path.join(ROOT, 'api', '_agent-daily.js'));
    const db = seed();
    db._data.waMeta.agentShadow.pend = { createdAt: NOW - H, linked: false, staff: false, state: 'received', attempts: 0, chatId: '972500000000@c.us', sender: '0500000000' };
    try { await D4.lgAgentDailyRun(req('sek'), { db, env: { ...ENV, AGENT_SUMMARY_TO: '' }, now: NOW, provider: provider(), clock: () => 1000 }); }
    finally { sh.lgAgentShadowProcess = origP; }
    check('F1 daily shadow item gets deadline + clock', seen[0], [1000 + 50000, 'function']);
  }
  /* vercel.json */
  {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    check('rewrite', v.rewrites.some(x => x.source === '/api/agent-daily' && x.destination === '/api/wa-inbound?agent=daily'), true);
    check('cron', v.crons, [{ path: '/api/agent-daily', schedule: '0 13 * * *' }]);
    check('existing keys kept', [v.rewrites.length, !!v.functions['api/wa-inbound.js'], Array.isArray(v.headers)], [4, true, true]);
    const wi = fs.readFileSync(path.join(ROOT, 'api', 'wa-inbound.js'), 'utf8');
    check('branch before webhook', wi.indexOf("req.query.agent === 'daily'") > 0 && wi.indexOf("req.query.agent === 'daily'") < wi.indexOf('handleInbound(req, {'), true);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
