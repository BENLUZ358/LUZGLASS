#!/usr/bin/env node
/**
 * מחירון (שלב 2, משימה 6) — הצעת מחיר מטקסט לפי המחירון, סקיצה לשאול
 * והחזרת התשובה שלו ללקוח.
 * Review Focus 1: הודעה אחרת משאול (לא "השב" לבקשה ממתינה) → שום פעולה.
 * Run:  node scripts/test-agent-quote.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const q = require(path.join(ROOT, 'api', '_agent-quote.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const sh = require(path.join(ROOT, 'api', '_agent-shadow.js'));
const { lgAgentSendPending } = require(path.join(ROOT, 'api', '_agent-send.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';
const SHAUL = '0501112222';
const SHAUL_CHAT = '972501112222@c.us';
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const HANDOFF = 'העברנו לשאול, הוא יחזור אליך';

const CAT = {
  G8: { name: 'זכוכית 8 שקוף', glass: 'שקוף', mm: 8, proc: '', active: true },
  G8L: { name: 'זכוכית 8 שקוף מלוטש', glass: 'שקוף', mm: 8, proc: 'litush', active: true },
  G10C: { name: 'זכוכית 10 מחוסם', glass: 'שקוף', mm: 10, proc: 'chisum', active: true },
  M5: { name: 'מראה 5', glass: 'מראה', mm: 5, proc: 'litush', active: true },
  OLD: { name: 'ישן', glass: 'שקוף', mm: 4, active: false },
  NOGLASS: { name: 'חסר', mm: 4 },
  NOPRICE: { name: 'זכוכית 12', glass: 'שקוף', mm: 12, proc: '' },
};
const GLOBAL = { G8: 200, G8L: 250, G10C: 400, M5: 300 };

// מודל מזויף: מחזיר תמיד את אותה תשובה, וזוכר מה נשלח אליו
const model = (out, opt = {}) => {
  const m = { calls: 0, bodies: [] };
  m.fetcher = async (url, init) => {
    m.calls++; m.bodies.push(JSON.parse(init.body));
    if (opt.throws) throw new TypeError('net');
    if (opt.http) return { ok: false, status: opt.http, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 1 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) };
  };
  return m;
};
const it = (sku, w, h, qty = 1, holes = 0, cutouts = 0) => ({ sku, w, h, qty, holes, cutouts });

(async () => {
  /* ── lgQuotePrice (טהור) ── */
  const P = items => q.lgQuotePrice({ items, catalog: CAT, clientPrices: {}, globalPrices: GLOBAL });
  {
    const a = P([it('G8', 50, 50)]);
    check('8 שקוף 50×50 → 0.25 (מעל המינימום, לא מעוגל למטה)', [a.lines[0].area, a.lines[0].total], [0.25, 50]);
    const b = P([it('G8', 40, 40)]);
    check('8 שקוף (חתוך) 40×40 → מינימום 0.2', [b.lines[0].area, b.lines[0].total], [0.2, 40]);
    const c = P([it('G10C', 40, 40)]);
    check('מחוסם 40×40 → מינימום 0.3', [c.lines[0].area, c.lines[0].total], [0.3, 120]);
    const l = P([it('G8L', 30, 30)]);
    check('מלוטש 30×30 → מינימום 0.2', l.lines[0].area, 0.2);
    const m = P([it('M5', 100, 80, 1, 2, 1)]);
    check('מראה 100×80 + 2 חורים + פינוי → +60', [m.lines[0].area, m.lines[0].extras, m.lines[0].total], [0.8, 60, 300]);
    const m2 = P([it('M5', 100, 80, 2, 2, 1)]);
    check('מראה ×2 — חורים ופינוי לכל יחידה', [m2.lines[0].extras, m2.lines[0].total], [120, 600]);
    const n = P([it('G8', 100, 80, 1, 2, 1)]);
    check('לא מראה — בלי תוספות חורים/פינוי', [n.lines[0].extras, n.lines[0].total], [0, 160]);
    const t = P([it('G8', 100, 100), it('M5', 100, 80, 1, 2, 1)]);
    check('סה"כ, מע"מ 18%, כולל', [t.net, t.vat, t.gross, t.missing], [500, 90, 590, []]);
    const r = P([it('G8', 33, 77)]);   // 0.2541 × 200 = 50.82
    check('עיגול לשקל שלם בשורה', r.lines[0].total, 51);
    const cp = q.lgQuotePrice({ items: [it('G8', 100, 100)], catalog: CAT, clientPrices: { G8: 150 }, globalPrices: GLOBAL });
    check('מחיר לקוח גובר על הכללי', [cp.lines[0].ppm2, cp.lines[0].total], [150, 150]);
    const mi = P([it('NOPRICE', 100, 100), it('G8', 100, 100)]);
    check('אין מחיר → missing', mi.missing, ['NOPRICE']);
    check('lines carry name', P([it('G8', 50, 50)]).lines[0].name, 'זכוכית 8 שקוף');
  }

  /* ── lgQuoteText ── */
  check('quote text', q.lgQuoteText(P([it('G8', 100, 100, 2), it('M5', 100, 80, 1, 2, 1)])),
    'זכוכית 8 שקוף 100×100 × 2 — 400 ₪\nמראה 5 100×80 × 1 — 300 ₪\nסה"כ לפני מע"מ: 700 ₪\nמע"מ 18%: 126 ₪\nסה"כ: 826 ₪');

  /* ── lgQuoteExtract (מודל מזויף) ── */
  {
    const m = model({ ok: true, items: [it('G8', 50, 50, 2)] });
    const x = await q.lgQuoteExtract({ text: 'כמה 2 זכוכיות 8 שקוף 50 על 50', catalog: CAT, model: 'm', key: 'k', fetcher: m.fetcher });
    check('extract ok', [x.ok, x.items], [true, [it('G8', 50, 50, 2)]]);
    const b = m.bodies[0];
    check('extract: strict json_schema + timeout pattern', [b.text.format.type, b.text.format.strict, b.store], ['json_schema', true, false]);
    const sent = JSON.stringify(b.input);
    check('extract: catalog filtered like catalogForModel', [sent.includes('G8L'), sent.includes('OLD'), sent.includes('NOGLASS')], [true, false, false]);
    const bad = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, items: [it('ZZZ', 50, 50)] }).fetcher });
    check('extract: sku not in catalog → ok:false', bad.ok, false);
    const inactive = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, items: [it('OLD', 50, 50)] }).fetcher });
    check('extract: inactive sku → ok:false', inactive.ok, false);
    const zero = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, items: [it('G8', 0, 50)] }).fetcher });
    check('extract: zero size → ok:false', zero.ok, false);
    // t6-5: מידה מעל 600 ס"מ או מתחת ל-1 ס"מ → כל הבקשה לשאול
    const sz = async (w, h) => (await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, items: [it('G8', 50, 50), it('G8', w, h)] }).fetcher })).ok;
    check('t6-5: size cap 601 / 0.5 / 600 / 1', [await sz(601, 50), await sz(50, 0.5), await sz(600, 50), await sz(50, 1)], [false, false, true, true]);
    const thr = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({}, { throws: true }).fetcher });
    check('extract: network error never throws', [thr.ok, thr.items], [false, []]);
    const h = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: 'k', fetcher: model({}, { http: 500 }).fetcher });
    check('extract: http error → ok:false', h.ok, false);
    const nk = model({ ok: true, items: [] });
    const nokey = await q.lgQuoteExtract({ text: 'x', catalog: CAT, model: 'm', key: '', fetcher: nk.fetcher });
    check('extract: no key → ok:false, no call', [nokey.ok, nk.calls], [false, 0]);
  }

  /* ── lgAgentDecide: ניתוב quote ── */
  {
    const base = { timestamp: NOW, linked: true, route: 'quote', intent: 'quote', customerName: 'כהן זכוכית', chatId: PRIV, idMessage: 'M1', text: 'כמה?' };
    const ok = P([it('G8', 100, 100)]);
    const d1 = act.lgAgentDecide({ rec: base, orders: [], conv: null, now: NOW, quote: { ok: true, priced: ok } });
    check('decide: priced → reply with the quote', d1.actions, [{ type: 'reply', text: q.lgQuoteText(ok) }]);
    const d2 = act.lgAgentDecide({ rec: base, orders: [], conv: null, now: NOW, quote: { ok: true, priced: P([it('NOPRICE', 100, 100)]) } });
    check('decide: missing price → Shaul', d2.actions.map(a => [a.type, a.text]), [['staff', 'כהן זכוכית: כמה?'], ['reply', HANDOFF]]);
    const d3 = act.lgAgentDecide({ rec: base, orders: [], conv: null, now: NOW, quote: { ok: false, priced: null } });
    check('decide: ok:false → Shaul', d3.actions.map(a => a.type), ['staff', 'reply']);
    const d4 = act.lgAgentDecide({ rec: { ...base, hasImage: true }, orders: [], conv: null, now: NOW });
    check('decide: sketch → hold reply + quote request to Shaul', d4.actions,
      [{ type: 'reply', text: 'קיבלנו, נחזור אליך עם מחיר' },
       { type: 'quote-ask', who: 'כהן זכוכית', files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'M1' }] }]);
    // Review Focus 1
    const st = { timestamp: NOW, linked: false, route: 'staff', chatId: SHAUL_CHAT, sender: SHAUL, text: 'מה נשמע', quotedId: '' };
    check('FOCUS1: staff message without a waiting quote → no action', act.lgAgentDecide({ rec: st, orders: [], conv: null, now: NOW }).actions, []);
    const w = { n: 4, customerId: '777', chat: PRIV, state: 'waiting' };
    check('decide: staff reply to a waiting quote → relay', act.lgAgentDecide({ rec: { ...st, text: '  1200 ₪ כולל ' }, orders: [], conv: null, now: NOW, staffQuote: w }).actions,
      [{ type: 'quote-relay', n: 4, chat: PRIV, customerId: '777', text: 'הצעת מחיר:\n1200 ₪ כולל' }]);
    check('decide: empty staff reply → no relay', act.lgAgentDecide({ rec: { ...st, text: ' ' }, orders: [], conv: null, now: NOW, staffQuote: w }).actions, []);
  }

  /* ── lgAgentAct מקצה לקצה ── */
  const seed = () => fakeDb({
    waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
    skuCatalog: CAT,
    prices: { global: GLOBAL, clients: { 777: { G8: 150 } } },
    orders: {},
    waMeta: { agentPilot: { 777: true } },
  });
  const put = (d, k, rr) => { d._data.waMeta.agentShadow = d._data.waMeta.agentShadow || {}; d._data.waMeta.agentShadow[k] = { idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567',
    hasImage: false, quotedId: '', state: 'done', timestamp: NOW, linked: true, route: 'quote', intent: 'quote', customerId: '777', customerName: 'כהן זכוכית', ...rr }; };
  const outbox = d => (d._data.waMeta || {}).agentOutbox || {};
  const stub = async () => ({ sent: 0 });
  {
    const d = seed(); put(d, 't1', { text: 'כמה עולה זכוכית 8 שקוף 100 על 100?' });
    const m = model({ ok: true, items: [it('G8', 100, 100)] });
    const res = await act.lgAgentAct(d, 't1', { env: ON, now: NOW, sendPending: stub, fetchImpl: m.fetcher });
    const o = Object.values(outbox(d));
    check('act text quote: one reply with client price', [res.acted, o.map(e => [e.to, e.text])],
      [true, [[PRIV, 'זכוכית 8 שקוף 100×100 × 1 — 150 ₪\nסה"כ לפני מע"מ: 150 ₪\nמע"מ 18%: 27 ₪\nסה"כ: 177 ₪']]]);
  }
  {
    const d = seed(); put(d, 't2', { text: 'כמה זכוכית 12?' });
    await act.lgAgentAct(d, 't2', { env: ON, now: NOW, sendPending: stub, fetchImpl: model({ ok: true, items: [it('NOPRICE', 100, 100)] }).fetcher });
    check('act text quote, no price → Shaul + handoff', Object.values(outbox(d)).map(e => [e.to, e.text]).sort(),
      [[PRIV, HANDOFF], [SHAUL, 'כהן זכוכית: כמה זכוכית 12?']].sort());
  }
  {
    const d = seed(); put(d, 't3', { text: 'כמה?' });
    const m = model({ ok: true, items: [it('G8', 100, 100)] });
    const res = await act.lgAgentAct(d, 't3', { env: { ...ON, AGENT_REPLY_ENABLED: 'false' }, now: NOW, sendPending: stub, fetchImpl: m.fetcher });
    check('act switches off → wouldAct only', [res.acted, Object.keys(outbox(d)).length, (d._data.waMeta.agentQuotes || null)], [false, 0, null]);
    // t6-4: usage של החילוץ נשמר ברשומה
    check('t6-4: quoteUsage on the record (also when not acting)', d._data.waMeta.agentShadow.t3.quoteUsage, { input_tokens: 1 });
  }
  {
    const d = seed(); put(d, 't4', { text: 'כמה עולה זכוכית 8 שקוף 100 על 100?' });
    await act.lgAgentAct(d, 't4', { env: ON, now: NOW, sendPending: stub, fetchImpl: model({ ok: true, items: [it('G8', 100, 100)] }).fetcher });
    check('t6-4: quoteUsage on an acted record', d._data.waMeta.agentShadow.t4.quoteUsage, { input_tokens: 1 });
  }
  {
    // t6-3: הודעת הבקשה לשאול לא נכנסה לתור (מפתח קיים) → לא נשמרת בקשה ממתינה
    const d = seed(); put(d, 'q3', { idMessage: 'IMG3', hasImage: true, text: 'כמה?' });
    d._data.waMeta.agentOutbox = { q3_1: { to: 'x', state: 'sent', text: 'ישן', files: [] } };
    await act.lgAgentAct(d, 'q3', { env: ON, now: NOW, sendPending: stub });
    check('t6-3: staff entry not queued → no waiting request', d._data.waMeta.agentQuotes || null, null);
  }
  {
    // t6-2: התור זורק בזמן ההעברה → הבקשה חוזרת ל-waiting (לא "נענתה" בלי שנשלח), ותשובה הבאה עוברת
    const d = seed();
    d._data.waMeta.agentQuotes = { 5: { customerId: '777', chat: PRIV, staffMessageId: 'X5', at: NOW, state: 'waiting' } };
    put(d, 'e1', { route: 'staff', linked: false, customerId: '', customerName: '', chatId: SHAUL_CHAT, sender: SHAUL, quotedId: 'X5', text: '500' });
    put(d, 'e2', { route: 'staff', linked: false, customerId: '', customerName: '', chatId: SHAUL_CHAT, sender: SHAUL, quotedId: 'X5', text: '550' });
    const ref = d.ref.bind(d);
    let boom = true;
    d.ref = p => {
      const r = ref(p);
      if (boom && String(p).startsWith('waMeta/agentOutbox/')) r.transaction = async () => { throw new TypeError('down'); };
      return r;
    };
    const warn = console.warn; console.warn = () => {};
    const r1 = await act.lgAgentAct(d, 'e1', { env: ON, now: NOW, sendPending: stub });
    console.warn = warn;
    check('t6-2: enqueue failure → not acted, request back to waiting', [r1.acted, d._data.waMeta.agentShadow.e1.actReason, d._data.waMeta.agentQuotes[5].state],
      [false, 'error', 'waiting']);
    boom = false;
    await act.lgAgentAct(d, 'e2', { env: ON, now: NOW, sendPending: stub });
    check('t6-2: next reply is relayed and answered', [d._data.waMeta.agentQuotes[5].state, Object.values(outbox(d)).map(e => e.text)],
      ['answered', ['הצעת מחיר:\n550']]);
  }

  // סקיצה → שאול → "השב" → ללקוח (עם תור השליחה האמיתי וספק מזויף)
  {
    const d = seed();
    const sent = { texts: [], forwards: [] };
    const provider = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 10, checksState: false, nextGap: () => 0,
      gate: c => (c.linked ? { allowed: true } : { allowed: false }),
      async forward(f) { sent.forwards.push(f); return { ok: true, httpStatus: 200, messageId: 'FW' + sent.forwards.length }; },
      async sendText(f) { sent.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + sent.texts.length }; } };
    const sendPending = (db, o) => lgAgentSendPending(db, { ...o, provider });
    put(d, 's1', { idMessage: 'IMG1', hasImage: true, text: 'כמה עולה?' });
    await act.lgAgentAct(d, 's1', { env: ON, now: NOW, sendPending });
    check('sketch: customer got the hold reply', sent.texts.filter(t => t.to === '0501234567').map(t => t.text), ['קיבלנו, נחזור אליך עם מחיר']);
    check('sketch: Shaul got the forward then the request text',
      [sent.forwards.map(f => [f.to, f.fromChat, f.idMessages]), sent.texts.filter(t => t.to === SHAUL).map(t => t.text)],
      [[[SHAUL, PRIV, ['IMG1']]], ['בקשת מחיר #1 — כהן זכוכית. נא לענות ב"השב" עם מחיר לכל פריט (ואם יש, מחיר כולל)']]);
    const shaulMid = 'T' + (sent.texts.findIndex(t => t.to === SHAUL) + 1);
    const qr = d._data.waMeta.agentQuotes[1];
    check('sketch: request stored waiting with staffMessageId of the TEXT', [qr.customerId, qr.chat, qr.state, qr.staffMessageId, qr.at], ['777', PRIV, 'waiting', shaulMid, NOW]);
    check('sketch: sequence advanced', d._data.waMeta.agentQuotesSeq, 1);

    // Review Focus 1: הודעה אחרת משאול — ציטוט של משהו אחר / בלי ציטוט
    const rS = await sh.lgAgentShadowRecord(d, { typeWebhook: 'incomingMessageReceived', idMessage: 'S0', timestamp: NOW / 1000 + 5,
      senderData: { chatId: SHAUL_CHAT, sender: SHAUL_CHAT }, messageData: { typeMessage: 'quotedMessage',
      extendedTextMessageData: { text: 'בסדר', stanzaId: 'OTHER' } } }, NOW + 5000, { env: ON });
    const before = Object.keys(outbox(d)).length;
    const cls = model({ intent: 'quote', ref: '' });
    await sh.lgAgentShadowProcess(d, rS.key, { now: NOW + 5000, env: ON, fetchImpl: cls.fetcher, provider });
    check('FOCUS1: other staff message → no queue, no classify, quote still waiting',
      [Object.keys(outbox(d)).length - before, cls.calls, d._data.waMeta.agentShadow[rS.key].route, d._data.waMeta.agentQuotes[1].state], [0, 0, 'staff', 'waiting']);

    // שאול עונה ב"השב" על הודעת הבקשה
    const reply = (id, t) => ({ typeWebhook: 'incomingMessageReceived', idMessage: id, timestamp: NOW / 1000 + 60,
      senderData: { chatId: SHAUL_CHAT, sender: SHAUL_CHAT }, messageData: { typeMessage: 'quotedMessage',
      extendedTextMessageData: { text: t, stanzaId: shaulMid } } });
    const r1 = await sh.lgAgentShadowRecord(d, reply('S1', 'מראה 450, זכוכית 300. סה"כ 750'), NOW + 60000, { env: ON });
    check('staff reply text is kept on the shadow record', d._data.waMeta.agentShadow[r1.key].text, 'מראה 450, זכוכית 300. סה"כ 750');
    await sh.lgAgentShadowProcess(d, r1.key, { now: NOW + 60000, env: ON, fetchImpl: cls.fetcher, provider });
    const toCustomer = sent.texts.filter(t => t.to === '0501234567').map(t => t.text);
    check('relay: Shaul\'s answer went to the customer', toCustomer, ['קיבלנו, נחזור אליך עם מחיר', 'הצעת מחיר:\nמראה 450, זכוכית 300. סה"כ 750']);
    check('relay: request answered', d._data.waMeta.agentQuotes[1].state, 'answered');
    const relayEntry = Object.values(outbox(d)).find(e => e.text.startsWith('הצעת מחיר:'));
    check('relay entry: to customer chat with customer id', [relayEntry.to, relayEntry.customerId, relayEntry.state], [PRIV, '777', 'sent']);

    // תשובה שנייה על אותה בקשה → לא מועברת שוב
    const r2 = await sh.lgAgentShadowRecord(d, reply('S2', 'סליחה, 800'), NOW + 70000, { env: ON });
    await sh.lgAgentShadowProcess(d, r2.key, { now: NOW + 70000, env: ON, fetchImpl: cls.fetcher, provider });
    check('relay once: second reply not relayed', sent.texts.filter(t => t.to === '0501234567').length, 2);
    check('classifier never called for staff', cls.calls, 0);
  }
  {
    // הלקוח יצא מהפיילוט לפני תשובת שאול → לא נשלח, הבקשה נשארת waiting
    const d = seed();
    d._data.waMeta.agentQuotes = { 7: { customerId: '777', chat: PRIV, staffMessageId: 'X7', at: NOW, state: 'waiting' } };
    d._data.waMeta.agentPilot[777] = false;
    put(d, 'p1', { route: 'staff', linked: false, customerId: '', customerName: '', chatId: SHAUL_CHAT, sender: SHAUL, quotedId: 'X7', text: '500' });
    const res = await act.lgAgentAct(d, 'p1', { env: ON, now: NOW, sendPending: stub });
    check('relay to non-pilot customer → not acted, still waiting', [res.acted, d._data.waMeta.agentShadow.p1.actReason, Object.keys(outbox(d)).length, d._data.waMeta.agentQuotes[7].state],
      [false, 'not-pilot', 0, 'waiting']);
  }
  {
    // staffMessageId חסר (נשלח אחר כך ב-drain) — נמצא דרך רשומת התור
    const d = seed();
    d._data.waMeta.agentQuotes = { 3: { customerId: '777', chat: PRIV, staffMessageId: null, outboxKey: 'k_1', at: NOW, state: 'waiting' } };
    d._data.waMeta.agentOutbox = { k_1: { to: SHAUL, state: 'sent', messageId: 'LATE', text: 'x', files: [] } };
    put(d, 'p2', { route: 'staff', linked: false, customerId: '', customerName: '', chatId: SHAUL_CHAT, sender: SHAUL, quotedId: 'LATE', text: '900' });
    await act.lgAgentAct(d, 'p2', { env: ON, now: NOW, sendPending: stub });
    check('late staffMessageId found via outbox → relayed', [d._data.waMeta.agentQuotes[3].state, d._data.waMeta.agentQuotes[3].staffMessageId,
      Object.values(outbox(d)).filter(e => e.to === PRIV).map(e => e.text)], ['answered', 'LATE', ['הצעת מחיר:\n900']]);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
