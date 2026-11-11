#!/usr/bin/env node
/**
 * חדר הסוכנים — תיקוני סקירה של שלב א' (10/11):
 *  1. המספר של בן אינו "צוות": מקבל רק את ההתראה על שאלה (agent-ask), והעברה רק מהצ'אט של אותו לקוח.
 *  2. "לא יודע" אחרי התפריט — לפי המתג של המרכזן (התפריט שלו מבטיח "נחזור אליך").
 *  3. תשובת בן — תוצאת השליחה האמיתית; נחסמה → השאלה חוזרת לפתוחה / "שלח שוב".
 *  4. רשומה ישנה בלי agent — כשיש הגדרות במסך: רק אם לפחות סוכן אחד "עונה".
 *  5. (a) התראה לבן רק אחרי שהצהוב נכתב; (b) אינדקס waMeta/agentRoomOpen; (c) סיכום יומי
 *     קורא רק יומיים ונכתב לחדר פעם ביום; (d) קולט כבוי לא מכבה את "סקיצה שנמחקה — פעיל";
 *     (e) הכרטיס של המרכזן לא מבטיח מה שהמתג שלו לא שולט בו.
 * Run:  node scripts/test-agent-room-review.js
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const S = require(path.join(ROOT, 'api', '_agent-send.js'));
const C = require(path.join(ROOT, 'api', '_agent-config.js'));
const ROOMJS = require(path.join(ROOT, 'api', '_agent-room.js'));
const D = require(path.join(ROOT, 'api', '_agent-daily.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const PRIV = '972501234567@c.us';      // 777
const PRIV2 = '972507777777@c.us';     // 999
const BEN = '0521234567';
const HOLD = 'קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.';
const SH = { AGENT_SHADOW_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const ALL = m => ({ markazan: m, okev: m, archive: m, price: m, kolet: m, manager: m });
const CFG = (agents, extra) => ({ agents: { ...ALL('shadow'), ...agents }, escalatePhone: BEN, ...(extra || {}) });
const seed = (cfg, extra) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' }, '0507777777': { customerId: '999', customerName: 'אחר' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 999: { name: 'אחר' } },
  orders: { o1: { customerId: '777', orderNum: 'L1001', stage: 'workday' },
            o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending', waMessageId: 'WA3' } },
  waMeta: { agentPilot: { 777: true, 999: true }, ...(cfg ? { agentConfig: cfg } : {}), ...(extra || {}) },
});
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'יש לכם זכוכית חכמה?', quotedId: '', hasImage: false,
  linked: true, linkVia: 'sender', state: 'done', intent: 'unclear', ref: '', route: 'shaul', customerId: '777', customerName: 'כהן זכוכית',
  timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const room = db => Object.entries((db._data.waMeta || {}).agentRoom || {}).map(([key, v]) => ({ key, ...v }));
const openIdx = db => (db._data.waMeta || {}).agentRoomOpen || {};
const run = (db, k, env) => act.lgAgentAct(db, k, { env: env || SH, now: NOW, sendPending: async () => ({ sent: 0 }) });

function provider(over) {
  const p = { name: 'fake', configured: true, globalSlot: true, maxPerRun: 10, checksState: false, nextGap: () => 0, texts: [], fwds: [],
    gate(c) { return c.linked === true ? { allowed: true, reason: '' } : { allowed: false, reason: 'x' }; },
    async sendText(f) { p.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length }; },
    async forward(f) { p.fwds.push(f); return { ok: true, httpStatus: 200, messageId: 'W' + p.fwds.length }; }, ...(over || {}) };
  return p;
}
const send = (db, env, p) => S.lgAgentSendPending(db, { provider: p || provider(), env: env || SH });

(async () => {
  /* ── 1. המספר של בן — רק התראת שאלה ── */
  {
    const db = seed(CFG({ okev: 'reply', markazan: 'reply', manager: 'reply' })), p = provider();
    await S.lgAgentEnqueue(db, { key: 'b1', to: BEN, customerId: '', text: 'תשובת סוכן', reason: 'agent-reply', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'b2', to: BEN, customerId: '777', text: 'יש שאלה', reason: 'agent-ask', agent: 'markazan' });
    await S.lgAgentEnqueue(db, { key: 'b3', to: BEN, customerId: '', text: 'סיכום', reason: 'סיכום יומי', agent: 'manager' });
    await S.lgAgentEnqueue(db, { key: 'b4', to: BEN, customerId: '777', text: '', reason: 'agent-ask', agent: 'markazan',
      files: [{ kind: 'forward', fromChat: PRIV2, idMessage: 'X1' }] });
    await S.lgAgentEnqueue(db, { key: 'b5', to: BEN, customerId: '777', text: 'תמונה', reason: 'agent-ask', agent: 'markazan',
      files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'X2' }] });
    await S.lgAgentEnqueue(db, { key: 'b6', to: BEN, customerId: '', text: 'העברה', reason: 'agent-staff', agent: 'okev',
      files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'X3' }] });
    //  בן, 11/11 (אפיון יא): גם שומר / התראה / לקוח לא מרוצה — רק AGENT_BEN_REASONS
    await S.lgAgentEnqueue(db, { key: 'b7', to: BEN, customerId: '', text: 'שומר', reason: 'agent-guard', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'b8', to: BEN, customerId: '777', text: 'לקוח לא מרוצה', reason: 'agent-upset', agent: 'markazan' });
    await S.lgAgentEnqueue(db, { key: 'b9', to: BEN, customerId: '', text: 'x', reason: 'agent-files', agent: 'okev' });
    await send(db, SH, p);
    const ob = outbox(db);
    check('1: Ben gets the ask ping only', [ob.b1.state, ob.b2.state, ob.b3.state, ob.b6.state], ['blocked', 'sent', 'blocked', 'blocked']);
    check('1: Ben number takes AGENT_BEN_REASONS, nothing else', [ob.b7.state, ob.b8.state, ob.b9.state], ['sent', 'sent', 'blocked']);
    check('1: forwarded image only from that customer\'s own chat', [ob.b4.state, ob.b5.state, p.fwds.map(f => f.fromChat)], ['blocked', 'sent', [PRIV]]);
    check('1: staff list is the Vercel list only', S.lgAgentStaff(SH), ['0501112222']);
  }
  {
    const db = seed(null), p = provider();
    const ON = { ...SH, AGENT_REPLY_ENABLED: 'true' };
    await S.lgAgentEnqueue(db, { key: 'n1', to: C.AGENT_ESCALATE_DEFAULT, customerId: '', text: 'x', reason: 'agent-reply', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'n2', to: C.AGENT_ESCALATE_DEFAULT, customerId: '777', text: 'שאלה', reason: 'agent-ask', agent: 'markazan' });
    await send(db, ON, p);
    check('1: no config → the default number is not staff, but still gets the ping', [outbox(db).n1.state, outbox(db).n2.state], ['blocked', 'sent']);
  }
  {
    const db = seed(CFG({ markazan: 'reply' }));
    put(db, 'P1', R({ hasImage: true, text: '', idMessage: 'IMG1' }));
    await run(db, 'P1');
    check('1: the ping carries the customer (for the forward check)', [outbox(db).P1_0_b.to, outbox(db).P1_0_b.customerId], [BEN, '777']);
  }
  {
    const db = seed(CFG({ manager: 'reply' })), p = provider();
    const r = await D.lgAgentDailyRun({ headers: { authorization: 'Bearer sek' } },
      { db, env: { ...SH, CRON_SECRET: 'sek', AGENT_SUMMARY_TO: BEN }, now: NOW, provider: p });
    check('1: daily summary is not sent to Ben\'s number just because it is the ask number',
      [p.texts.length, (r.body.skipped || []).map(s => s.to)], [0, [BEN]]);
  }

  /* ── 2. "לא יודע" — לפי המרכזן ── */
  check('2: route shaul → markazan', C.lgAgentOfRoute('shaul'), 'markazan');
  {
    const db = seed(CFG({ markazan: 'reply', manager: 'shadow' }));
    put(db, 'Q1', R({}));
    const r = await run(db, 'Q1');
    check('2: markazan replying → the promise is kept (hold + yellow from markazan)',
      [r.acted, outbox(db).Q1_0 && outbox(db).Q1_0.text, room(db).filter(e => e.kind === 'ask').map(e => e.agent)], [true, HOLD, ['markazan']]);
    const db2 = seed(CFG({ markazan: 'shadow', manager: 'reply' }));
    put(db2, 'Q2', R({}));
    await run(db2, 'Q2');
    check('2: manager replying but markazan not → nothing (the menu was not sent either)',
      [rec(db2, 'Q2').acted, Object.keys(outbox(db2)).length, room(db2).length], [false, 0, 0]);
  }

  /* ── 3. תשובת בן — האמת ── */
  const ask = async (cfg) => {
    const db = seed(cfg || CFG({ markazan: 'reply' }));
    put(db, 'A1', R({}));
    await run(db, 'A1');
    return { db, key: room(db).find(e => e.kind === 'ask').key };
  };
  const answer = (db, key, text, p) => ROOMJS.lgRoomAnswer(db, { key, text }, { env: SH, now: NOW + 5 * MIN, by: BEN, provider: p || provider() });
  {
    const { db, key } = await ask();
    const r = await answer(db, key, 'כן, יש');
    check('3: sent → told so', [r.ok, r.sent, r.sendState, db._data.waMeta.agentRoom[key].state], [true, true, 'sent', 'answered']);
  }
  {
    const { db, key } = await ask();
    delete db._data.waMeta.agentPilot[777];   // בינתיים הלקוח הוצא מהפיילוט
    const r = await answer(db, key, 'כן, יש');
    check('3: blocked → not "sent", with the reason', [r.ok, r.sent, r.sendState, !!r.sendReason], [true, false, 'blocked', true]);
    check('3: blocked → the question is open again, back in the index',
      [db._data.waMeta.agentRoom[key].state, !!openIdx(db)[key]], ['open', true]);
    db._data.waMeta.agentPilot[777] = true;
    const r2 = await answer(db, key, 'שוב');
    check('3: Ben can answer again → a new outbox entry', [r2.ok, r2.sent, r2.outboxKey, outbox(db)[r2.outboxKey].text], [true, true, 'room_' + key + '_2', 'שוב']);
  }
  {
    const { db, key } = await ask();
    const r = await answer(db, key, 'כן', provider({ configured: false }));
    check('3: not sent yet (still queued) → honest, question stays answered',
      [r.ok, r.sent, r.sendState, db._data.waMeta.agentRoom[key].state], [true, false, 'pending', 'answered']);
  }
  {
    const { db, key } = await ask();
    await answer(db, key, 'כן');
    const ok = db._data.waMeta.agentRoom[key].outboxKey;
    db._data.waMeta.agentOutbox[ok].state = 'blocked';   // נחסם מאוחר יותר
    const r = await answer(db, key, 'שוב');
    check('3: answered but its send ended blocked → "send again" is accepted', [r.ok, r.outboxKey], [true, 'room_' + key + '_2']);
    const r2 = await answer(db, key, 'עוד פעם');
    check('3: answered and sent → refused', [r2.ok, r2.code], [false, 'answered']);
  }

  /* ── 4. רשומה ישנה בלי agent ── */
  {
    const db = seed(CFG({})), p = provider();
    await S.lgAgentEnqueue(db, { key: 'o1', to: PRIV, customerId: '777', text: 'ישן' });
    await send(db, { ...SH, AGENT_REPLY_ENABLED: 'true' }, p);
    check('4: config, nobody replying → old entry blocked (even with AGENT_REPLY_ENABLED)', [outbox(db).o1.state, p.texts.length], ['blocked', 0]);
    const db2 = seed(CFG({ okev: 'reply' })), p2 = provider();
    await S.lgAgentEnqueue(db2, { key: 'o2', to: PRIV, customerId: '777', text: 'ישן' });
    await send(db2, SH, p2);
    check('4: config, one agent replying → old entry sent', outbox(db2).o2.state, 'sent');
  }

  /* ── בלי הגדרות במסך — ללקוח בדיוק כמו קודם ── */
  {
    const db = seed(null), p = provider();
    const ON = { ...SH, AGENT_REPLY_ENABLED: 'true' };
    put(db, 'Z1', R({ idMessage: 'Z1', route: 'okev', intent: 'status', ref: 'L1001', text: 'איפה L1001' }));
    await act.lgAgentAct(db, 'Z1', { env: ON, now: NOW, sendPending: async () => ({ sent: 0 }) });
    await S.lgAgentEnqueue(db, { key: 'z2', to: PRIV, customerId: '777', text: 'ישן' });
    await send(db, ON, p);
    check('no config: customer reply + old entry sent as before', [outbox(db).Z1_0 && outbox(db).Z1_0.state, outbox(db).z2.state], ['sent', 'sent']);
    const db2 = seed(null), p2 = provider();
    put(db2, 'Z3', R({ idMessage: 'Z3', route: 'okev', intent: 'status', ref: 'L1001', text: 'איפה L1001' }));
    await act.lgAgentAct(db2, 'Z3', { env: SH, now: NOW, sendPending: async () => ({ sent: 0 }) });
    check('no config, no AGENT_REPLY_ENABLED: shadow as before', [rec(db2, 'Z3').acted, rec(db2, 'Z3').actReason], [false, 'switches-off']);
  }

  /* ── 5a. התראה לבן רק אחרי שהצהוב נכתב ── */
  {
    const db = seed(CFG({ markazan: 'reply' }));
    const realRef = db.ref.bind(db);
    db.ref = p => (String(p).startsWith('waMeta/agentRoom/') ? { set: async () => { throw new Error('down'); } } : realRef(p));
    put(db, 'F1', R({ idMessage: 'F1' }));
    const w0 = console.warn; console.warn = () => {};
    await run(db, 'F1');
    console.warn = w0;
    check('5a: room write failed → no ping to Ben, no hold to the customer', [!!outbox(db).F1_0_b, !!outbox(db).F1_0], [false, false]);
  }
  /* ── 5b. אינדקס השאלות הפתוחות ── */
  {
    const { db, key } = await ask();
    const e = openIdx(db)[key];
    check('5b: open index written on ask', e && [e.at, e.agent, e.customer], [NOW, 'markazan', 'כהן זכוכית']);
    await answer(db, key, 'כן');
    check('5b: removed on answer', openIdx(db)[key], undefined);
    const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const P = fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8');
    const m = A.match(/function lgAgentsNavCount\(\)[\s\S]*?\n}/);
    check('5b: admin counter reads the index', !!m && /waMeta\/agentRoomOpen/.test(m[0]) && !/limitToLast\(500\)/.test(m[0]), true);
    check('5b: the room page reads the index', /waMeta\/agentRoomOpen/.test(P), true);
  }
  /* ── 5c. סיכום יומי: יומיים אחרונים, פעם ביום בחדר ── */
  {
    const db = seed(CFG({}), { agentOutbox: { old: { state: 'blocked', updatedAt: NOW - 5 * DAY, createdAt: NOW - 5 * DAY },
                                              new1: { state: 'blocked', updatedAt: NOW - MIN, createdAt: NOW - MIN } } });
    const realRef = db.ref.bind(db), reads = [];
    db.ref = p => { const r = realRef(p); const q = { p: String(p) };
      const w = Object.assign({}, r, { orderByChild: c => { q.by = c; r.orderByChild(c); return w; }, startAt: x => { q.start = x; r.startAt(x); return w; },
        once: async () => { reads.push(q); return r.once(); } }); return w; };
    const env = { ...SH, CRON_SECRET: 'sek' }, req = { headers: { authorization: 'Bearer sek' } };
    const r1 = await D.lgAgentDailyRun(req, { db, env, now: NOW, provider: provider() });
    await D.lgAgentDailyRun(req, { db, env, now: NOW + 2 * 60 * MIN, provider: provider() });
    const whole = ['waMeta/agentRoom', 'waMeta/agentOutbox'].filter(p => reads.some(q => q.p === p && !(q.by && q.start != null)));
    check('5c: room/outbox never read whole', whole, []);
    check('5c: blocked count from the recent window', r1.body.summary && r1.body.summary.blockedSends, 1);
    check('5c: one room summary per day', room(db).filter(e => e.kind === 'summary').length, 1);
  }
  /* ── 5d. קולט כבוי — "סקיצה שנמחקה — פעיל" ממשיך ── */
  {
    const db = seed(CFG({ kolet: 'off' }), { agentDeleteLive: true });
    put(db, 'K1', R({ idMessage: 'K1', route: 'kolet-deleted', deletedId: 'WA3', text: '', intent: '' }));
    await run(db, 'K1');
    check('5d: kolet off + live switch → queued sketch still cancelled', [!!db._data.orders.o3, rec(db, 'K1').actMode], [false, 'delete-only']);
    const db2 = seed(CFG({ kolet: 'off' }), { agentDeleteLive: true }), p = provider();
    await S.lgAgentEnqueue(db2, { key: 'k2', to: '0501112222', customerId: '777', text: 'נמחקה', reason: S.AGENT_DELETED_REASON, agent: 'kolet' });
    await send(db2, SH, p);
    check('5d: and its note to Shaul still goes', outbox(db2).k2.state, 'sent');
  }
  /* ── 5e. הכרטיס של המרכזן ── */
  {
    const ctx = { console, Date, Intl }; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'agents-dash.js'), 'utf8'), ctx);
    const ag = JSON.parse(JSON.stringify(vm.runInContext('LG_AD_AGENTS', ctx)));
    const mk = ag.find(a => a.id === 'markazan'), mg = ag.find(a => a.id === 'manager');
    check('5e: markazan card does not claim intake ack / attach suggestions as its switch',
      !/נקלטו|צרופ/.test(mk.does) || /לא במתג הזה/.test(mk.does), true);
    check('5e: "don\'t know" belongs to markazan\'s card', [mk.routes.includes('shaul'), mg.routes.includes('shaul')], [true, false]);
    const idx = { a: { at: 1, agent: 'markazan', customer: 'x' }, b: { at: 2, agent: 'okev', customer: 'y' } };
    check('5b: open count from the index', [ctx.lgRoomOpenIndexCount(idx), ctx.lgRoomOpenIndexCount(null)], [2, 0]);
    const rm = { k: { at: 1, agent: 'markazan', kind: 'ask', state: 'answered', outboxKey: 'room_k', question: 'q', customerName: 'c' } };
    check('3: answered ask whose send ended blocked offers "send again"',
      [/data-roomanswer/.test(ctx.lgRoomBubbleHtml({ key: 'k', ...rm.k }, { room_k: { state: 'blocked', lastError: 'x' } })),
       /data-roomanswer/.test(ctx.lgRoomBubbleHtml({ key: 'k', ...rm.k }, { room_k: { state: 'sent' } }))], [true, false]);
    const P = fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8');
    check('3: the toast tells the truth', [/לא נשלח — /.test(P), /r\.sent/.test(P)], [true, true]);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll agent-room review checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
