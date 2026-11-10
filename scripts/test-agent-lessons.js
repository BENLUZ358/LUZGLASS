#!/usr/bin/env node
/**
 * חדר הסוכנים, שלב ג׳ — למידה (בן, 11/11): "הסוכן מציע ושואל, ורק אחרי אישור מתחיל לענות לבד".
 *  - כל תשובה של בן לשאלת לקוח → כלל (waMeta/agentLessons/<id>)
 *  - שאלה דומה (מודל, ≥0.8) → צהוב עם "אני מציע לענות" + אשר / תקן / ענה אחרת
 *  - 3 אישורים ברצף → הסוכן עונה לבד (רק "עונה" + לקוח מופעל) ומדווח בחדר עם "תקן"
 * ⚠️ בלי מודל אמיתי: ההשוואה מוזרקת (lessonMatch) או fetcher מדומה.
 * Run:  node scripts/test-agent-lessons.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const L = require(path.join(ROOT, 'api', '_agent-lessons.js'));
const { handleAdmin } = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const MIN = 60 * 1000;
const PRIV = '972501234567@c.us';
const HOLD = 'קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.';
const BEN = '0547725552';
const ENV = { AGENT_SHADOW_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k',
              VERCEL_PROJECT_PRODUCTION_URL: 'luz.example.app' };
const ALL_REPLY = { markazan: 'reply', okev: 'reply', archive: 'reply', price: 'reply', kolet: 'reply', manager: 'reply' };
const LESSON = (o) => ({ agent: 'markazan', topicKey: 'זכוכית-חכמה', topic: 'זכוכית חכמה', question: 'יש לכם זכוכית חכמה?',
  answer: 'לא, אנחנו לא מייצרים זכוכית חכמה.', approvals: 0, corrections: 0, createdAt: NOW - 60 * MIN, by: BEN, ...(o || {}) });
const seed = (agents, extra, opts) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' }, '0507777777': { customerId: '999', customerName: 'אחר' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 999: { name: 'אחר' } },
  orders: {},
  waMeta: { agentPilot: { 777: true },
            ...((opts || {}).noConfig ? {} : { agentConfig: { agents: { ...ALL_REPLY, ...(agents || {}) }, escalatePhone: BEN } }),
            ...(extra || {}) },
});
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'אתם עושים זכוכית חכמה?', quotedId: '', hasImage: false,
  linked: true, linkVia: 'sender', state: 'done', intent: 'unclear', ref: '', route: 'shaul', customerId: '777', customerName: 'כהן זכוכית',
  timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const room = db => Object.entries((db._data.waMeta || {}).agentRoom || {}).map(([key, v]) => ({ key, ...v }));
const lessons = db => (db._data.waMeta || {}).agentLessons || {};
//  ההשוואה מוזרקת: סופרים קריאות כדי להוכיח שהמודל לא נקרא כשאסור
const matcher = (res) => { const f = async (args) => { f.calls.push(args); return typeof res === 'function' ? res(args) : res; }; f.calls = []; return f; };
const run = (db, k, extra, env) => act.lgAgentAct(db, k, { env: env || ENV, now: NOW, sendPending: async () => ({ sent: 0 }), ...(extra || {}) });
const deps = (o) => ({ by: BEN, now: NOW + 5 * MIN, sendPending: async () => ({ sent: 0 }), ...(o || {}) });

//  תשובת מודל מדומה (Responses API)
const okResp = (obj, usage) => ({ ok: true, json: async () => ({ status: 'completed', usage: usage || { input_tokens: 100, output_tokens: 20 },
  output: [{ content: [{ type: 'output_text', text: JSON.stringify(obj) }] }] }) });

(async () => {
  /* ── 1. ההשוואה במודל (lgLessonMatch) ── */
  {
    const ls = [{ id: 'L1', topic: 'זכוכית חכמה', question: 'יש לכם זכוכית חכמה?', answer: 'סוד-התשובה' },
                { id: 'L2', topic: 'שעות פתיחה', question: 'עד מתי פתוח?', answer: 'סוד-2' }];
    let called = 0;
    const none = await L.lgLessonMatch({ question: 'q', lessons: ls, model: '', key: 'k', fetcher: async () => { called++; } });
    check('no model configured → no call, no match', [called, none.match], [0, null]);
    const none2 = await L.lgLessonMatch({ question: 'q', lessons: [], model: 'm', key: 'k', fetcher: async () => { called++; } });
    check('no lessons → no call', [called, none2.match], [0, null]);
    let body = null;
    const hit = await L.lgLessonMatch({ question: 'אתם עושים זכוכית חכמה?', lessons: ls, model: 'm', key: 'k',
      fetcher: async (url, init) => { body = JSON.parse(init.body); return okResp({ match: 'L1', confidence: 0.92, topic: 'זכוכית חכמה' }); } });
    check('match ≥ 0.8 → the lesson id', [hit.match, hit.confidence, hit.topic], ['L1', 0.92, 'זכוכית חכמה']);
    const sent = JSON.stringify(body.input);
    check('prompt carries topics + questions, never the answers', [sent.includes('זכוכית חכמה'), sent.includes('עד מתי פתוח?'), sent.includes('סוד-התשובה'), sent.includes('סוד-2')],
      [true, true, false, false]);
    check('cheap call: low max tokens, strict JSON schema, not stored', [body.max_output_tokens <= 150, body.text.format.type, body.text.format.strict, body.store],
      [true, 'json_schema', true, false]);
    const low = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => okResp({ match: 'L1', confidence: 0.79, topic: 't' }) });
    check('confidence 0.79 → no match (topic kept)', [low.match, low.topic], [null, 't']);
    const bogus = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => okResp({ match: 'L9', confidence: 0.99, topic: 't' }) });
    check('unknown lesson id → no match', bogus.match, null);
    const thr = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => { throw new Error('timeout'); } });
    const bad = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => ({ ok: false }) });
    const junk = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'not json' }] }] }) }) });
    const inc = await L.lgLessonMatch({ question: 'x', lessons: ls, model: 'm', key: 'k', fetcher: async () => ({ ok: true, json: async () => ({ status: 'incomplete' }) }) });
    check('model failure / bad answer / incomplete → no match, never throws', [thr.match, bad.match, junk.match, inc.match], [null, null, null, null]);
    let b30 = null;
    const many = Array.from({ length: 45 }, (_, i) => ({ id: 'X' + i, topic: 'נושא ' + i, question: 'שאלה ' + i }));
    await L.lgLessonMatch({ question: 'x', lessons: many, model: 'm', key: 'k', fetcher: async (u, init) => { b30 = init.body; return okResp({ match: null, confidence: 0, topic: '' }); } });
    check('never more than 30 lessons in the prompt', [b30.includes('X29'), b30.includes('X30')], [true, false]);
  }

  /* ── 2. הכללים של סוכן: 30 החדשים, רק שלו ── */
  {
    const ls = {};
    for (let i = 0; i < 35; i++) ls['a' + i] = LESSON({ createdAt: NOW - (100 - i) * MIN, topic: 't' + i });
    ls.other = LESSON({ agent: 'archive' });
    const db = seed(null, { agentLessons: ls });
    const got = await L.lgLessonsOf(db, 'markazan');
    check('lessons of an agent: newest 30, only that agent', [got.length, got[0].id, got.some(x => x.id === 'other'), got.some(x => x.id === 'a4')], [30, 'a34', false, false]);
  }

  /* ── 3. בן עונה → נשמר כלל ── */
  {
    const db = seed();
    put(db, 'A1', R({ text: 'יש לכם זכוכית חכמה?' }));
    const m = matcher({ match: null, confidence: 0, topic: '' });
    await run(db, 'A1', { lessonMatch: m });
    check('no lessons yet → the model is not asked', m.calls.length, 0);
    const ask = room(db).find(e => e.kind === 'ask');
    const r = await handleAdmin({ action: 'agent-room-answer', key: ask.key, text: '  לא, אנחנו לא מייצרים זכוכית חכמה.  ' }, { db, ...deps() });
    check('answer ok', r.ok, true);
    const l = lessons(db)[ask.key];
    check('the answer is saved as a lesson', l && [l.agent, l.topic, l.question, l.answer, l.approvals, l.corrections, l.autoAt || null, l.createdAt, l.by],
      ['markazan', 'יש לכם זכוכית חכמה?', 'יש לכם זכוכית חכמה?', 'לא, אנחנו לא מייצרים זכוכית חכמה.', 0, 0, null, NOW + 5 * MIN, BEN]);
    check('topicKey is a safe short key', typeof l.topicKey === 'string' && l.topicKey.length > 0 && l.topicKey.length <= 60 && !/[.#$[\]/\s]/.test(l.topicKey), true);
    const bad = await handleAdmin({ action: 'agent-room-answer', key: 'nope', text: 'x' }, { db, ...deps() });
    check('failed answer → no lesson', [bad.ok, Object.keys(lessons(db)).length], [false, 1]);
  }

  /* ── 4. שאלה דומה, כלל עוד לא אוטומטי → צהוב עם הצעה ── */
  const withLesson = (o, agents, opts) => seed(agents, { agentLessons: { L1: LESSON(o) } }, opts);
  {
    const db = withLesson();
    put(db, 'B1', R({}));
    const m = matcher({ match: 'L1', confidence: 0.9, topic: 'זכוכית חכמה' });
    await run(db, 'B1', { lessonMatch: m });
    check('model asked once with the question and the lessons (no answers)', [m.calls.length, m.calls[0].question, m.calls[0].lessons.map(x => [x.id, x.topic, x.question, x.answer])],
      [1, 'אתם עושים זכוכית חכמה?', [['L1', 'זכוכית חכמה', 'יש לכם זכוכית חכמה?', undefined]]]);
    check('model call gets a bounded timeout', m.calls[0].timeoutMs > 0 && m.calls[0].timeoutMs <= 8000, true);
    const ob = outbox(db);
    check('customer still gets the hold text, Ben still pinged', [ob.B1_0 && ob.B1_0.text, ob.B1_0_b && ob.B1_0_b.to], [HOLD, BEN]);
    const ask = room(db).find(e => e.kind === 'ask');
    check('yellow carries the proposal + lesson id', [ask.state, ask.lessonId, ask.proposal, ask.topic], ['open', 'L1', LESSON().answer, 'זכוכית חכמה']);
    check('shadow record notes the match', rec(db, 'B1').lessonMatch, { id: 'L1', confidence: 0.9, auto: false });
  }
  {
    const db = withLesson();
    put(db, 'B2', R({}));
    await run(db, 'B2', { lessonMatch: matcher({ match: null, confidence: 0.3, topic: 'משהו אחר' }) });
    const ask = room(db).find(e => e.kind === 'ask');
    check('no match → plain yellow (topic remembered for the lesson)', [ask.lessonId || null, ask.proposal || null, ask.topic], [null, null, 'משהו אחר']);
    await handleAdmin({ action: 'agent-room-answer', key: ask.key, text: 'תשובה' }, { db, ...deps() });
    check('lesson topic comes from the model topic', lessons(db)[ask.key].topic, 'משהו אחר');
  }
  {
    const db = withLesson();
    put(db, 'B3', R({}));
    await run(db, 'B3', { lessonMatch: async () => { throw new Error('boom'); } });
    const ask = room(db).find(e => e.kind === 'ask');
    check('model throws → normal escalation', [outbox(db).B3_0.text, ask.state, ask.lessonId || null], [HOLD, 'open', null]);
  }
  {
    const db = withLesson();
    put(db, 'B4', R({}));
    const m = matcher({ match: 'L1', confidence: 0.95, topic: 't' });
    let t = NOW;
    await run(db, 'B4', { lessonMatch: m, clock: () => t, deadline: NOW + 20 * 1000 });
    check('no time left in the request → model skipped, normal escalation', [m.calls.length, outbox(db).B4_0.text, rec(db, 'B4').lessonMatch || null],
      [0, HOLD, { skipped: 'deadline' }]);
  }
  {
    const db = withLesson();
    put(db, 'B5', R({ hasImage: true, text: '', idMessage: 'IMG1' }));
    const m = matcher({ match: 'L1', confidence: 0.95, topic: 't' });
    await run(db, 'B5', { lessonMatch: m });
    check('image question → never matched', [m.calls.length, room(db).find(e => e.kind === 'ask').lessonId || null], [0, null]);
  }
  {
    const db = withLesson({ agent: 'archive' });
    put(db, 'B6', R({}));
    const m = matcher({ match: 'L1', confidence: 0.95, topic: 't' });
    await run(db, 'B6', { lessonMatch: m });
    check("another agent's lessons are not used", m.calls.length, 0);
  }

  /* ── 5. מתי המודל לא נקרא בכלל / שום דבר ללקוח לא משתנה ── */
  for (const [why, agents, opts, cust, env] of [
    ['agent off', { markazan: 'off' }, null, null, null],
    ['agent shadow', { markazan: 'shadow' }, null, null, null],
    ['no agentConfig (legacy shadow)', null, { noConfig: true }, null, null],
    ['top switch off', null, null, null, { ...ENV, AGENT_SHADOW_ENABLED: '' }],
    ['customer not enabled', null, null, { sender: '0507777777', chatId: '972507777777@c.us', customerId: '999', customerName: 'אחר' }, null]]) {
    const db = withLesson({ autoAt: NOW - MIN, approvals: 3 }, agents, opts);
    put(db, 'G1', R(cust || {}));
    const m = matcher({ match: 'L1', confidence: 0.99, topic: 't' });
    await run(db, 'G1', { lessonMatch: m }, env);
    check(why + ' → model not called, nothing sent, nothing in the room', [m.calls.length, Object.keys(outbox(db)).length, room(db).length], [0, 0, 0]);
  }

  /* ── 6. אשר ── */
  const proposed = async (o) => {
    const db = withLesson(o);
    put(db, 'P1', R({}));
    await run(db, 'P1', { lessonMatch: matcher({ match: 'L1', confidence: 0.9, topic: 'זכוכית חכמה' }) });
    return { db, ask: room(db).find(e => e.kind === 'ask') };
  };
  {
    const { db, ask } = await proposed();
    for (const [why, b, code] of [['bad key', { key: 'a/b' }, 'bad-key'], ['missing', { key: 'nope' }, 'missing']]) {
      const r = await handleAdmin({ action: 'agent-lesson-approve', ...b }, { db, ...deps() });
      check('approve rejects ' + why, [r.ok, r.code], [false, code]);
    }
    let sent = 0;
    const r = await handleAdmin({ action: 'agent-lesson-approve', key: ask.key }, { db, ...deps({ sendPending: async () => { sent++; return { sent: 1 }; } }) });
    check('approve ok', [r.ok, r.approvals, r.auto], [true, 1, false]);
    const e = outbox(db)['room_' + ask.key];
    check('approve sends the proposal through the send layer', [e.to, e.text, e.agent, e.reason, sent], [PRIV, LESSON().answer, 'markazan', 'agent-room-answer', 1]);
    check('lesson approvals +1, no new lesson', [lessons(db).L1.approvals, lessons(db).L1.approvedTotal, Object.keys(lessons(db)).length], [1, 1, 1]);
    const again = await handleAdmin({ action: 'agent-lesson-approve', key: ask.key }, { db, ...deps() });
    check('second approve refused, not counted twice', [again.ok, again.code, lessons(db).L1.approvals], [false, 'answered', 1]);
    check('room ask is answered', db._data.waMeta.agentRoom[ask.key].state, 'answered');
  }
  {
    const db = seed();
    put(db, 'P2', R({}));
    await run(db, 'P2');
    const ask = room(db).find(e => e.kind === 'ask');
    const r = await handleAdmin({ action: 'agent-lesson-approve', key: ask.key }, { db, ...deps() });
    check('approve on a yellow without a proposal → refused, nothing sent', [r.ok, r.code, !!outbox(db)['room_' + ask.key]], [false, 'no-proposal', false]);
  }
  {
    const { db, ask } = await proposed();
    delete db._data.waMeta.agentLessons.L1;
    const r = await handleAdmin({ action: 'agent-lesson-approve', key: ask.key }, { db, ...deps() });
    check('lesson deleted meanwhile → approve refused, nothing sent', [r.ok, r.code, !!outbox(db)['room_' + ask.key]], [false, 'no-lesson', false]);
  }
  {
    const { db, ask } = await proposed({ approvals: 2, approvedTotal: 2 });
    const r = await handleAdmin({ action: 'agent-lesson-approve', key: ask.key }, { db, ...deps() });
    const l = lessons(db).L1;
    check('third consecutive approval → auto', [r.auto, l.approvals, l.autoAt], [true, 3, NOW + 5 * MIN]);
    check('room says the agent will answer alone from now', room(db).some(x => x.kind === 'info' && x.lessonId === 'L1' && /מעכשיו/.test(x.text)), true);
  }

  /* ── 7. תקן ── */
  {
    const { db, ask } = await proposed({ approvals: 2, approvedTotal: 2 });
    const bad = await handleAdmin({ action: 'agent-lesson-correct', key: ask.key, text: '  ' }, { db, ...deps() });
    check('correct rejects empty text', [bad.ok, bad.code], [false, 'bad-text']);
    const r = await handleAdmin({ action: 'agent-lesson-correct', key: ask.key, text: 'כן, יש לנו זכוכית חכמה בהזמנה מיוחדת.' }, { db, ...deps() });
    check('correct ok', r.ok, true);
    check('the corrected text goes to the customer', outbox(db)['room_' + ask.key].text, 'כן, יש לנו זכוכית חכמה בהזמנה מיוחדת.');
    const l = lessons(db).L1;
    check('lesson answer updated, corrections+1, streak reset', [l.answer, l.corrections, l.approvals, l.autoAt || null], ['כן, יש לנו זכוכית חכמה בהזמנה מיוחדת.', 1, 0, null]);
    check('correct does not add a lesson', Object.keys(lessons(db)).length, 1);
  }
  /* ── 8. ענה אחרת = תשובה רגילה → כלל חדש, הישן לא משתנה ── */
  {
    const { db, ask } = await proposed({ approvals: 1 });
    await handleAdmin({ action: 'agent-room-answer', key: ask.key, text: 'תשובה אחרת לגמרי' }, { db, ...deps() });
    check('answer differently → old lesson untouched', [lessons(db).L1.answer, lessons(db).L1.approvals], [LESSON().answer, 1]);
    check('… and a new lesson from this answer', [Object.keys(lessons(db)).length, lessons(db)[ask.key].answer, lessons(db)[ask.key].topic], [2, 'תשובה אחרת לגמרי', 'זכוכית חכמה']);
  }

  /* ── 9. כלל אוטומטי ── */
  {
    const db = withLesson({ autoAt: NOW - MIN, approvals: 3 });
    put(db, 'U1', R({}));
    await run(db, 'U1', { lessonMatch: matcher({ match: 'L1', confidence: 0.9, topic: 'זכוכית חכמה' }) });
    const ob = outbox(db);
    check('auto: customer gets the lesson answer, no hold, nothing to Ben', [Object.keys(ob), ob.U1_0.text, ob.U1_0.agent, ob.U1_0.to],
      [['U1_0'], LESSON().answer, 'markazan', PRIV]);
    const rm = room(db);
    check('auto: no yellow, one info line with a fix handle', [rm.filter(e => e.kind === 'ask').length, rm.length, rm[0].kind, rm[0].text, rm[0].lessonId, rm[0].lessonAuto, rm[0].outboxKey],
      [0, 1, 'info', 'עניתי לפי מה שאישרת: זכוכית חכמה', 'L1', true, 'U1_0']);
    check('auto: open index untouched', Object.keys(db._data.waMeta.agentRoomOpen || {}).length, 0);
    check('auto: record notes it', [rec(db, 'U1').acted, rec(db, 'U1').lessonMatch], [true, { id: 'L1', confidence: 0.9, auto: true }]);
    check('lesson use counted', lessons(db).L1.uses, 1);

    /* ── "תקן" על תשובה אוטומטית ── */
    const info = rm[0];
    const bad = await handleAdmin({ action: 'agent-lesson-fix', key: info.key, text: '' }, { db, ...deps() });
    check('fix rejects empty text', [bad.ok, bad.code], [false, 'bad-text']);
    const notAuto = await handleAdmin({ action: 'agent-lesson-fix', key: 'nope', text: 'x' }, { db, ...deps() });
    check('fix on a missing entry → refused', [notAuto.ok, notAuto.code], [false, 'missing']);
    let sent = 0;
    const r = await handleAdmin({ action: 'agent-lesson-fix', key: info.key, text: 'סליחה, טעות: יש לנו בהזמנה מיוחדת.' },
      { db, ...deps({ sendPending: async () => { sent++; return { sent: 1 }; } }) });
    check('fix ok', r.ok, true);
    const l = lessons(db).L1;
    check('fix de-autos the lesson and takes the new answer', [l.autoAt || null, l.approvals, l.corrections, l.answer], [null, 0, 1, 'סליחה, טעות: יש לנו בהזמנה מיוחדת.']);
    const fx = outbox(db)['fix_' + info.key];
    check('the correction goes to that customer via the send layer', [fx && fx.to, fx && fx.customerId, fx && fx.text, fx && fx.agent, sent],
      [PRIV, '777', 'סליחה, טעות: יש לנו בהזמנה מיוחדת.', 'markazan', 1]);
    check('room shows the correction', room(db).some(x => x.kind === 'answer' && x.replyTo === info.key && x.text === 'סליחה, טעות: יש לנו בהזמנה מיוחדת.'), true);
    const twice = await handleAdmin({ action: 'agent-lesson-fix', key: info.key, text: 'שוב' }, { db, ...deps() });
    check('second fix refused', [twice.ok, twice.code], [false, 'fixed']);

    /* אחרי התיקון — אותה שאלה שוב: הצעה, לא תשובה לבד */
    put(db, 'U2', R({ idMessage: 'M2' }));
    await run(db, 'U2', { lessonMatch: matcher({ match: 'L1', confidence: 0.9, topic: 'זכוכית חכמה' }) });
    check('after fix the agent proposes again instead of answering', [outbox(db).U2_0.text, room(db).find(e => e.kind === 'ask' && e.ref && e.ref.shadowKey === 'U2').proposal],
      [HOLD, 'סליחה, טעות: יש לנו בהזמנה מיוחדת.']);
  }
  {
    const db = seed();
    const info = await require(path.join(ROOT, 'api', '_agent-room.js')).lgRoomPost(db, { kind: 'info', text: 'x', agent: 'markazan' }, NOW);
    const r = await handleAdmin({ action: 'agent-lesson-fix', key: info, text: 'x' }, { db, ...deps() });
    check('fix on a plain info line → refused', [r.ok, r.code, Object.keys(outbox(db)).length], [false, 'not-auto', 0]);
  }

  /* ── 10. מחק ── */
  {
    const db = withLesson();
    for (const [why, id] of [['bad id', 'a/b'], ['empty', ''], ['number', 5]]) {
      const r = await handleAdmin({ action: 'agent-lesson-delete', id }, { db, ...deps() });
      check('delete rejects ' + why, [r.ok, r.code], [false, 'bad-id']);
    }
    const miss = await handleAdmin({ action: 'agent-lesson-delete', id: 'nope' }, { db, ...deps() });
    check('delete missing → refused', [miss.ok, miss.code], [false, 'missing']);
    const r = await handleAdmin({ action: 'agent-lesson-delete', id: 'L1' }, { db, ...deps() });
    check('delete ok', [r.ok, lessons(db).L1 || null], [true, null]);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll agent-lessons checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
