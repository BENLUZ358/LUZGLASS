#!/usr/bin/env node
/**
 * ה-drain של האדמין משלים רשומות צל תקועות, ובן מסמן נכון/לא נכון.
 * Run:  node scripts/test-agent-drain.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const adm = require(path.join(__dirname, '..', 'api', 'wa-inbound-drain.js'));
const sh = require(path.join(__dirname, '..', 'api', '_agent-shadow.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const model = () => ({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ intent: 'order', ref: '' }) }] }] }) }) });
const stuck = (n, extra) => ({ idMessage: n, state: 'received', linked: true, chatId: '972501234567@c.us', groupId: '',
  sender: '0501234567', text: 'שלום', attempts: 0, createdAt: NOW - 1000 + Number(n.replace(/\D/g, '') || 0), updatedAt: NOW - 1000, ...extra });
const seed = shadow => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  waMeta: { agentShadow: shadow || {} } });

(async () => {
  const saved = process.env.AGENT_SHADOW_ENABLED;
  const sub = { AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' };
  Object.assign(process.env, sub);

  // 1. דגל כבוי — לא נוגעים ברשומות, ואין שדה agentShadow
  delete process.env.AGENT_SHADOW_ENABLED;
  let db = seed({ A1: stuck('A1') });
  let r = await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() });
  check('1a flag off: record untouched', db._data.waMeta.agentShadow.A1.state, 'received');
  check('1b flag off: no agentShadow field', 'agentShadow' in r, false);
  check('1c flag off: old fields intact', [r.ok, r.processed, r.remaining], [true, 0, 0]);

  // 2. דגל דלוק — רשומה תקועה מושלמת
  process.env.AGENT_SHADOW_ENABLED = 'true';
  db = seed({ A1: stuck('A1'), A2: stuck('A2', { state: 'done' }) });
  r = await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() });
  check('2a stuck record completed', db._data.waMeta.agentShadow.A1.state, 'done');
  check('2b agentShadow counts', { processed: r.agentShadow.processed, failed: r.agentShadow.failed }, { processed: 1, failed: 0 });
  check('2c old fields unchanged', [r.ok, r.processed, r.results, r.remaining], [true, 0, [], 0]);

  // 3. כשל במודל — נספר כ-failed, התגובה הרגילה ללא שינוי
  db = seed({ A1: stuck('A1') });
  const realRef = db.ref.bind(db);
  db.ref = p => { if (String(p).startsWith('waSenders')) throw new Error('boom'); return realRef(p); };
  r = await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() });
  check('3a failure counted', { processed: r.agentShadow.processed, failed: r.agentShadow.failed }, { processed: 0, failed: 1 });
  check('3b old fields unchanged', [r.ok, r.processed, r.remaining], [true, 0, 0]);

  // 4. עד BATCH (5) בקריאה
  const many = {}; for (let i = 1; i <= 7; i++) many['M' + i] = stuck('M' + i);
  db = seed(many);
  r = await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() });
  check('4 at most BATCH per call', r.agentShadow.processed + r.agentShadow.failed, 5);

  // 4b. הדדליין קרוב (פחות מ-22 שניות נשארו) — לא מתחילים רשומת צל חדשה
  //     (כל רשומה יכולה לקחת 20 שניות של OpenAI + קריאת הזמנות)
  {
    db = seed({ A1: stuck('A1') });
    const realNow = Date.now, t0 = realNow();
    let calls = 0;
    Date.now = () => (calls++ === 0 ? t0 : t0 + 30 * 1000);   // עברו 30ש׳
    try { r = await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() }); }
    finally { Date.now = realNow; }
    check('4b deadline near: no shadow record started', db._data.waMeta.agentShadow.A1.state, 'received');
    check('4b deadline near: counts zero', r.agentShadow, { processed: 0, failed: 0 });
  }

  // 4c. R14: רשומת צל מתחילה רק אם עברו ≤10ש׳ מתחילת ה-drain
  for (const [el, want] of [[9000, 'done'], [11000, 'received']]) {
    db = seed({ A1: stuck('A1') });
    const realNow = Date.now, t0 = realNow();
    let first = true;
    Date.now = () => { if (first) { first = false; return t0; } return t0 + el; };
    try { await adm.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() }); }
    finally { Date.now = realNow; }
    check('4c elapsed ' + el + 'ms → shadow ' + want, db._data.waMeta.agentShadow.A1.state, want);
  }

  // 4d. תיקון סופי 1: רשומת הצל מקבלת את הדדליין של ה-drain (התחלה + 50ש׳)
  {
    db = seed({ A1: stuck('A1') });
    const seen = [];
    const origP = sh.lgAgentShadowProcess;
    const realNow = Date.now, t0 = realNow();
    Date.now = () => t0;
    sh.lgAgentShadowProcess = async (d, k, o) => { seen.push(o.deadline); return { ok: true }; };
    const DP = path.join(__dirname, '..', 'api', 'wa-inbound-drain.js');
    delete require.cache[require.resolve(DP)];
    const adm2 = require(DP);
    try { await adm2.handleAdmin({ action: 'drain' }, { db, by: '052', now: NOW, ...model() }); }
    finally { Date.now = realNow; sh.lgAgentShadowProcess = origP; delete require.cache[require.resolve(DP)]; }
    check('4d F1: shadow process gets drain deadline', seen, [t0 + 50000]);
  }

  // 5. agent-verdict
  db = seed({ A1: stuck('A1', { state: 'done' }) });
  const v = b => adm.handleAdmin({ action: 'agent-verdict', ...b }, { db, by: '0520000000', now: NOW + 5 });
  r = await v({ key: 'A1', ok: false, note: ' ' + 'x'.repeat(400) });
  const vd = db._data.waMeta.agentShadow.A1.verdict;
  check('5a verdict written', [r.ok, vd.ok, vd.by, vd.at, vd.note.length], [true, false, '0520000000', NOW + 5, 300]);
  check('5b ok true + trimmed note', [(await v({ key: 'A1', ok: true, note: '  טוב  ' })).ok, db._data.waMeta.agentShadow.A1.verdict.note], [true, 'טוב']);
  check('5c missing record', (await v({ key: 'ZZ', ok: true })).code, 'missing');
  check('5d bad key', (await v({ key: 'a/b', ok: true })).code, 'bad-key');
  check('5e no key', (await v({ ok: true })).code, 'bad-key');
  check('5f ok must be boolean', (await v({ key: 'A1', ok: 'true' })).ok, false);
  check('5g missing ok', (await v({ key: 'A1' })).ok, false);
  check('5h verdict does not touch other fields', db._data.waMeta.agentShadow.A1.state, 'done');

  // 6. אימות אדמין — ה-handler דוחה בלי אדמין
  const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
  await adm({ method: 'POST', headers: {}, body: { action: 'agent-verdict', key: 'A1', ok: true } }, res);
  check('6 no admin auth: refused', [401, 403, 500].includes(res.code) && res.code !== 200, true);

  // 7. agent-pilot
  {
    db = seed({});
    const pl = b => adm.handleAdmin({ action: 'agent-pilot', ...b }, { db, by: '052', now: NOW });
    check('7a on', [(await pl({ customerId: '777', on: true })).ok, db._data.waMeta.agentPilot['777']], [true, true]);
    check('7b off removes', [(await pl({ customerId: '777', on: false })).ok, (db._data.waMeta.agentPilot || {})['777']], [true, undefined]);
    check('7c empty id', (await pl({ customerId: '', on: true })).code, 'bad-key');
    check('7d bad id', (await pl({ customerId: 'a/b', on: true })).code, 'bad-key');
    check('7e on must be boolean', (await pl({ customerId: '777', on: 'true' })).ok, false);
    check('7f nothing written on bad input', Object.keys((db._data.waMeta || {}).agentPilot || {}), []);
  }

  // 8. תור השליחה של הסוכנים בתוך ה-drain
  {
    process.env.AGENT_SHADOW_ENABLED = 'true';
    const send = require(path.join(__dirname, '..', 'api', '_agent-send.js'));
    const origSend = send.lgAgentSendPending;
    const calls = [];
    send.lgAgentSendPending = async (d, o) => { calls.push(o); return { sent: 2, failed: 1, blocked: 0, skipped: 0, state: null }; };
    const realNow = Date.now, t0 = realNow();
    const run = async elapsed => { calls.length = 0; let first = true;
      Date.now = () => { if (first) { first = false; return t0; } return t0 + elapsed; };
      try { return await adm.handleAdmin({ action: 'drain' }, { db: seed({}), by: '052', now: NOW, ...model() }); } finally { Date.now = realNow; } };
    let rr = await run(5 * 1000);   // נשארו 55 שניות → תקציב 25
    // F1: הדדליין המוחלט מחליף את "תקציב = מה שנשאר − 30ש׳" (שהיה משאיר 25ש׳ — פחות מ-getState + פריט)
    check('8a enough time: send called once, no relative budget', [calls.length, calls[0] && calls[0].budgetMs], [1, undefined]);
    check('8a2 F1: send gets the drain deadline (start + 50s)', calls[0] && calls[0].deadline, t0 + 50000);
    check('8b counts under agentShadow.sent', rr.agentShadow.sent, { sent: 2, failed: 1, blocked: 0, skipped: 0, state: null });
    rr = await run(26 * 1000);       // נשארו 34 → פחות מ-35, לא קוראים
    check('8c < 35s left: send not called', [calls.length, rr.agentShadow.sent], [0, undefined]);
    // נכשל — לא מפיל את שאר התגובה
    send.lgAgentSendPending = async () => { throw new Error('boom'); };
    rr = await run(5 * 1000);
    check('8d send throws: drain still ok', [rr.ok, rr.agentShadow.sent], [true, undefined]);
    delete process.env.AGENT_SHADOW_ENABLED;
    send.lgAgentSendPending = async (d, o) => { calls.push(o); return {}; };
    calls.length = 0; rr = await run(5 * 1000);
    check('8e flag off: send not called', [calls.length, 'agentShadow' in rr], [0, false]);
    send.lgAgentSendPending = origSend;
    process.env.AGENT_SHADOW_ENABLED = 'true';
  }

  if (saved === undefined) delete process.env.AGENT_SHADOW_ENABLED; else process.env.AGENT_SHADOW_ENABLED = saved;
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
