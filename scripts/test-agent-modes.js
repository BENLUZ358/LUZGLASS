#!/usr/bin/env node
/**
 * מתג לכל סוכן (waMeta/agentConfig) בכל המקומות שבדקו AGENT_REPLY_ENABLED:
 * _agent-act (פעולה), _agent-send (שליחה, לפי הסוכן של הרשומה), _agent-daily (מנהל).
 * המספר של בן (escalatePhone) — איש צוות בשכבת השליחה.
 * Run:  node scripts/test-agent-modes.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const S = require(path.join(ROOT, 'api', '_agent-send.js'));
const D = require(path.join(ROOT, 'api', '_agent-daily.js'));
const C = require(path.join(ROOT, 'api', '_agent-config.js'));
let failed = 0;
//  תשובות בשילוב (11/11): עם הגדרות "עונה" תשובה ללקוח נעטפת בפתיחה שהמודל בוחר מרשימה סגורה — בבדיקה
//  אסור לצאת לרשת. המודל המדומה תמיד בוחר את הפתיחה המותרת הראשונה (מהסכמה בבקשה): כל טקסט שעובר
//  בטעות בעטיפה משתנה ונופל בבדיקות הקיימות; מסלולים שאמורים להיעטף — מצפים ל-WRAP(...) / WRAP_UPSET(...)
global.fetch = async (url, init) => {
  const sc = JSON.parse(init.body).text.format.schema.properties;
  const pick = { opener: sc.opener.enum.find(i => i >= 0), closer: -1 };
  return { ok: true, json: async () => ({ status: 'completed', usage: null,
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(pick) }] }] }) };
};
const WRAP = t => 'היי, כהן זכוכית\n' + t;          // פתיחה 0 ("היי") + שם הלקוח
const WRAP_UPSET = t => 'תודה על הסבלנות\n' + t;     // הפתיחה הראשונה שמתאימה לתלונה
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';
// המתג העליון דולק, AGENT_REPLY_ENABLED לא — "עונה" נקבע רק מהמסך
const SH = { AGENT_SHADOW_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const CFG = (agents, extra) => ({ agents: { markazan: 'shadow', okev: 'shadow', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'shadow', ...agents }, ...(extra || {}) });
const seed = (cfg, extra) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' } },
  orders: { o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday' } },
  waMeta: { agentPilot: { 777: true }, ...(cfg ? { agentConfig: cfg } : {}), ...(extra || {}) },
});
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'איפה L1001', quotedId: '', hasImage: false,
  linked: true, linkVia: 'sender', state: 'done', intent: 'status', ref: 'L1001', route: 'okev', customerId: '777', customerName: 'כהן זכוכית',
  timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const runAct = (db, k, env) => act.lgAgentAct(db, k, { env: env || SH, now: NOW, sendPending: async () => ({ sent: 0 }) });

function provider() {
  const p = { name: 'fake', configured: true, globalSlot: true, maxPerRun: 10, checksState: true, nextGap: () => 0, texts: [],
    async getState() { return { ok: true, state: 'authorized', reason: '' }; },
    gate(c) { return c.linked === true ? { allowed: true, reason: '' } : { allowed: false, reason: 'x' }; },
    async sendText(f) { p.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length }; },
    async forward(f) { return { ok: true, httpStatus: 200, messageId: 'W1' }; } };
  return p;
}

(async () => {
  check('route → agent', ['okev', 'menu', 'archive', 'quote', 'price', 'staff', 'kolet-deleted', 'shaul', 'kolet', 'none'].map(C.lgAgentOfRoute),
    ['okev', 'markazan', 'archive', 'price', 'price', 'price', 'kolet', 'markazan', 'kolet', 'markazan']);   // shaul → המרכזן (תיקון סקירה 10/11)

  /* ── act: לפי הסוכן של המסלול ── */
  {
    const db = seed(CFG({ okev: 'reply' }));
    put(db, 'A1', R({}));
    const r = await runAct(db, 'A1');
    check('okev in "reply" on the screen → acts without AGENT_REPLY_ENABLED', [r.acted, rec(db, 'A1').actReason], [true, null]);
    check('outbox entry carries its agent', [outbox(db).A1_0.agent, outbox(db).A1_0.to], ['okev', PRIV]);

    put(db, 'A2', R({ idMessage: 'A2', route: 'menu', intent: 'chitchat', text: 'שלום', ref: '' }));
    const r2 = await runAct(db, 'A2');
    check('markazan still "shadow" → menu not sent', [r2.acted, rec(db, 'A2').actReason, !!outbox(db).A2_0], [false, 'switches-off', false]);
  }
  {
    const db = seed(CFG({ okev: 'off' }));
    put(db, 'B1', R({}));
    await runAct(db, 'B1', { ...SH, AGENT_REPLY_ENABLED: 'true' });
    check('okev "off" → agent-off, even with AGENT_REPLY_ENABLED', [rec(db, 'B1').acted, rec(db, 'B1').actReason], [false, 'agent-off']);
  }
  {
    const db = seed(CFG({ okev: 'reply' }));
    put(db, 'B2', R({}));
    await runAct(db, 'B2', { ...SH, AGENT_SHADOW_ENABLED: 'false' });
    check('master switch off → nothing, whatever the screen says', [rec(db, 'B2').acted, rec(db, 'B2').actReason], [false, 'switches-off']);
  }
  {
    const db = seed(null);
    put(db, 'B3', R({}));
    await runAct(db, 'B3', { ...SH, AGENT_REPLY_ENABLED: 'true' });
    check('no config + AGENT_REPLY_ENABLED → acts as today', rec(db, 'B3').acted, true);
  }

  /* ── send: לפי הסוכן של הרשומה, בזמן השליחה ── */
  {
    const db = seed(CFG({ okev: 'reply' })), p = provider();
    await S.lgAgentEnqueue(db, { key: 'q1', to: PRIV, customerId: '777', text: 'עוקב', reason: 'agent-reply', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'q2', to: PRIV, customerId: '777', text: 'ארכיון', reason: 'agent-files', agent: 'archive' });
    await S.lgAgentSendPending(db, { provider: p, env: SH });
    check('reply agent sent, shadow agent blocked', [outbox(db).q1.state, outbox(db).q2.state, p.texts.map(t => t.text)], ['sent', 'blocked', ['עוקב']]);
  }
  {
    const db = seed(CFG({ okev: 'reply' })), p = provider();
    await S.lgAgentEnqueue(db, { key: 'q3', to: PRIV, customerId: '777', text: 'x', agent: 'okev' });
    db._data.waMeta.agentConfig.agents.okev = 'shadow';   // בן כיבה בין ההכנסה לשליחה
    await S.lgAgentSendPending(db, { provider: p, env: SH });
    check('switched off after enqueue → blocked at send time', [outbox(db).q3.state, p.texts.length], ['blocked', 0]);
  }
  {
    const db = seed(CFG({}, { escalatePhone: '0521234567' }), {}), p = provider();
    db._data.waMeta.agentConfig.agents.markazan = 'reply';
    await S.lgAgentEnqueue(db, { key: 'q4', to: '0521234567', customerId: '', text: 'לבן', reason: 'agent-ask', agent: 'markazan' });
    await S.lgAgentEnqueue(db, { key: 'q5', to: '0547725552', customerId: '', text: 'לא בן', reason: 'agent-ask', agent: 'markazan' });
    await S.lgAgentSendPending(db, { provider: p, env: SH });
    check('Ben\'s number gets the ask ping (no link needed); the default gets nothing once another is saved',
      [outbox(db).q4.state, outbox(db).q5.state], ['sent', 'blocked']);
    check('staff list = the Vercel list only (Ben is not staff — תיקון סקירה 10/11)', S.lgAgentStaff(SH), ['0501112222']);
  }
  {
    const db = seed(null), p = provider();
    await S.lgAgentEnqueue(db, { key: 'q6', to: '0547725552', customerId: '', text: 'לבן', reason: 'agent-ask', agent: 'markazan' });
    await S.lgAgentEnqueue(db, { key: 'q6b', to: '0547725552', customerId: '', text: 'סתם', reason: 'agent-reply', agent: 'okev' });
    await S.lgAgentSendPending(db, { provider: p, env: { ...SH, AGENT_REPLY_ENABLED: 'true' } });
    check('no config → Ben\'s default number gets the ask ping, and only that', [outbox(db).q6.state, outbox(db).q6b.state], ['sent', 'blocked']);
  }
  {
    const db = seed(null), p = provider();
    await S.lgAgentEnqueue(db, { key: 'q7', to: PRIV, customerId: '777', text: 'ישן' });
    await S.lgAgentSendPending(db, { provider: p, env: { ...SH, AGENT_REPLY_ENABLED: 'true' } });
    check('old entry without agent + no config → as today', outbox(db).q7.state, 'sent');
  }

  /* ── daily: המנהל ── */
  {
    const ENV = { ...SH, CRON_SECRET: 'sek', AGENT_SUMMARY_TO: '0501112222' };
    const req = { headers: { authorization: 'Bearer sek' } };
    const db = seed(CFG({ manager: 'reply' })), p = provider();
    const r = await D.lgAgentDailyRun(req, { db, env: ENV, now: NOW, provider: p });
    check('manager "reply" on the screen → summary sent without AGENT_REPLY_ENABLED', [r.body.skipped, p.texts.length], [[], 1]);
    const db2 = seed(CFG({ manager: 'shadow' })), p2 = provider();
    const r2 = await D.lgAgentDailyRun(req, { db: db2, env: { ...ENV, AGENT_REPLY_ENABLED: 'true' }, now: NOW, provider: p2 });
    check('manager "shadow" → not sent, even with AGENT_REPLY_ENABLED', [p2.texts.length, (r2.body.skipped || [])[0] && !!r2.body.skipped[0].reason], [0, true]);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll agent-modes checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
