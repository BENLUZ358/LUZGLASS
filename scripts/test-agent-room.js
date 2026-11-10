#!/usr/bin/env node
/**
 * חדר הסוכנים, שלב א' (בן, 10/11): "לא יודע → בן" במקום שאול לשאלות לקוח,
 * הודעה צהובה בחדר (kind 'ask'), וואטסאפ קצר לבן, ותשובה של בן מהחדר
 * (agent-room-answer) שיוצאת ללקוח דרך שכבת השליחה.
 * הודעות לרצפה (שינוי / ביטול מאוחר) נשארות אצל שאול.
 * Run:  node scripts/test-agent-room.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const ROOMJS = require(path.join(ROOT, 'api', '_agent-room.js'));
const D = require(path.join(ROOT, 'api', '_agent-daily.js'));
const { handleAdmin } = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
const { AGENT_MENU_TEXT } = require(path.join(ROOT, 'api', '_agent-okev.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const MIN = 60 * 1000;
const PRIV = '972501234567@c.us';
const HOLD = 'קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.';
const ENV = { AGENT_SHADOW_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k',
              VERCEL_PROJECT_PRODUCTION_URL: 'luz.example.app' };
const ALL_REPLY = { markazan: 'reply', okev: 'reply', archive: 'reply', price: 'reply', kolet: 'reply', manager: 'reply' };
const seed = (agents, extra) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' }, '0507777777': { customerId: '999', customerName: 'אחר' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 999: { name: 'אחר' } },
  orders: { o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday' },
            o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending' } },
  waMeta: { agentPilot: { 777: true }, agentConfig: { agents: { ...ALL_REPLY, ...(agents || {}) }, escalatePhone: '0547725552' }, ...(extra || {}) },
});
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'יש לכם זכוכית חכמה?', quotedId: '', hasImage: false,
  linked: true, linkVia: 'sender', state: 'done', intent: 'unclear', ref: '', route: 'shaul', customerId: '777', customerName: 'כהן זכוכית',
  timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const room = db => Object.entries((db._data.waMeta || {}).agentRoom || {}).map(([key, v]) => ({ key, ...v }));
const run = (db, k, env, extra) => act.lgAgentAct(db, k, { env: env || ENV, now: NOW, sendPending: async () => ({ sent: 0 }), ...(extra || {}) });

(async () => {
  /* ── lgRoomPost: הרחבה ── */
  {
    const db = fakeDb({});
    const k = await ROOMJS.lgRoomPost(db, { agent: 'manager', kind: 'ask', text: 'כהן שאל', state: 'open', customerId: '777', customerName: 'כהן',
      chat: PRIV, question: 'q', suggest: 's', ref: { customerId: '777', shadowKey: 'M1', bogus: 'x' } }, NOW);
    const e = db._data.waMeta.agentRoom[k];
    check('room ask entry keeps the question fields', [e.kind, e.state, e.customerId, e.customerName, e.chat, e.question, e.suggest],
      ['ask', 'open', '777', 'כהן', PRIV, 'q', 's']);
    check('ref object: only known keys', e.ref, { customerId: '777', shadowKey: 'M1' });
    const k2 = await ROOMJS.lgRoomPost(db, { agent: 'manager', kind: 'answer', text: 't', replyTo: k, by: '0501112222' }, NOW);
    check('answer / summary are kinds now', [db._data.waMeta.agentRoom[k2].kind, db._data.waMeta.agentRoom[k2].replyTo,
      db._data.waMeta.agentRoom[await ROOMJS.lgRoomPost(db, { kind: 'summary', text: 'x' }, NOW)].kind], ['answer', k, 'summary']);
    check('string ref still works', db._data.waMeta.agentRoom[await ROOMJS.lgRoomPost(db, { kind: 'info', text: 'x', ref: 'wa_1' }, NOW)].ref, 'wa_1');
  }

  /* ── החלטה: שאלה שאף אחד לא יודע → 'ask' (לא שאול) ── */
  {
    const d = act.lgAgentDecide({ rec: R({}), orders: [], conv: null, now: NOW });
    check('shaul route, linked → one ask action', d.actions, [{ type: 'ask', who: 'כהן זכוכית', question: 'יש לכם זכוכית חכמה?' }]);
    const un = act.lgAgentDecide({ rec: R({ linked: false, customerId: '', customerName: '' }), orders: [], conv: null, now: NOW });
    check('not linked → nothing', un.actions, []);
    const img = act.lgAgentDecide({ rec: R({ hasImage: true, text: '', idMessage: 'IMG1' }), orders: [], conv: null, now: NOW });
    check('image question → ask with the image forwarded', img.actions,
      [{ type: 'ask', who: 'כהן זכוכית', question: '(תמונה)', files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'IMG1' }] }]);
    check('menu no longer gives Shaul\'s number', /שאול|050-6824365/.test(AGENT_MENU_TEXT), false);
  }
  /* ── הודעות לרצפה נשארות אצל שאול ── */
  {
    const orders = [{ id: 'o3', customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending' }];
    const det = act.lgAgentDecide({ rec: R({ route: 'okev', intent: 'unclear', text: 'תוסיף חור', timestamp: NOW + MIN }),
      orders, conv: { await: 'change-details', orderId: 'o3', at: NOW }, now: NOW + MIN });
    check('change details → Shaul as today', det.actions.map(a => a.type), ['staff', 'reply']);
    const late = act.lgAgentDecide({ rec: R({ route: 'okev', intent: 'cancel', ref: 'L1001', text: 'בטל' }),
      orders: [{ id: 'o1', customerId: '777', orderNum: 'L1001', stage: 'workday' }], conv: null, now: NOW });
    check('cancel in production → Shaul notified as today', late.actions.map(a => [a.type, !!a.notify]), [['reply', false], ['staff', true]]);
  }

  /* ── ביצוע: לקוח מופעל, הסוכן "עונה" ── */
  {
    const db = seed();
    put(db, 'A1', R({}));
    const r = await run(db, 'A1');
    const ob = outbox(db);
    check('acted', [r.acted, rec(db, 'A1').actReason], [true, null]);
    check('customer gets exactly the hold text', [ob.A1_0.to, ob.A1_0.text, ob.A1_0.agent], [PRIV, HOLD, 'manager']);
    check('Ben gets one short line + link', [ob.A1_0_b.to, ob.A1_0_b.text, ob.A1_0_b.reason],
      ['0547725552', 'יש שאלה שמחכה לך בחדר הסוכנים: כהן זכוכית — יש לכם זכוכית חכמה?\nhttps://luz.example.app/agents.html', 'agent-ask']);
    check('nothing to Shaul', Object.values(ob).some(e => e.to === '0501112222'), false);
    const asks = room(db).filter(e => e.kind === 'ask');
    check('one yellow entry in the room', asks.map(e => [e.agent, e.state, e.customerId, e.customerName, e.question, e.chat]),
      [['manager', 'open', '777', 'כהן זכוכית', 'יש לכם זכוכית חכמה?', PRIV]]);
    check('room entry points at the record', asks[0].ref, { customerId: '777', shadowKey: 'A1' });
  }
  {
    const db = seed();
    put(db, 'A1b', R({ text: 'שורה ראשונה\nשורה שנייה ' + 'א'.repeat(200) }));
    await run(db, 'A1b');
    const t = outbox(db).A1b_0_b.text.split('\n');
    check('Ben\'s line is one line, cut short', [t.length, t[0].length <= 140, t[0].includes('שורה שנייה')], [2, true, false]);
  }
  {
    const db = seed();
    put(db, 'A2', R({ hasImage: true, text: '', idMessage: 'IMG1' }));
    await run(db, 'A2');
    check('image → forwarded to Ben with the line', outbox(db).A2_0_b.files, [{ kind: 'forward', fromChat: PRIV, idMessage: 'IMG1' }]);
  }
  /* ── לקוח לא מופעל / סוכן לא עונה → כלום, גם לא צהוב ── */
  {
    const db = seed({ manager: 'shadow' });
    put(db, 'B1', R({}));
    await run(db, 'B1');
    check('agent in shadow → no yellow, nothing sent', [room(db).length, Object.keys(outbox(db)).length, rec(db, 'B1').actReason], [0, 0, 'switches-off']);
    const db2 = seed();
    put(db2, 'B2', R({ sender: '0507777777', chatId: '972507777777@c.us', customerId: '999', customerName: 'אחר' }));
    await run(db2, 'B2');
    check('customer not in the pilot list → no yellow, nothing sent', [room(db2).length, Object.keys(outbox(db2)).length, rec(db2, 'B2').actReason], [0, 0, 'not-pilot']);
    const db3 = seed();
    put(db3, 'B3', R({ linked: false, customerId: '', customerName: '', sender: '0549999999', chatId: '972549999999@c.us', linkVia: '' }));
    await run(db3, 'B3');
    check('unlinked number → nothing', [room(db3).length, Object.keys(outbox(db3)).length], [0, 0]);
  }
  /* ── אין שאול מוגדר — השאלה לבן עדיין עובדת ── */
  {
    const db = seed();
    put(db, 'C1', R({}));
    await run(db, 'C1', { ...ENV, AGENT_STAFF_PHONES: '' });
    check('no Shaul configured → the ask still goes (to Ben)', [outbox(db).C1_0.text, outbox(db).C1_0_b.to, room(db).length], [HOLD, '0547725552', 1]);
  }
  /* ── ארכיון לא מצא / מחירון בלי מחיר → בן ── */
  {
    const db = seed();
    put(db, 'D1', R({ route: 'archive', intent: 'document', text: 'חשבונית 55555', ref: '55555' }));
    await run(db, 'D1');
    const ob = outbox(db);
    const ask = room(db).find(e => e.kind === 'ask');
    check('archive not found → hold + yellow from the archive', [ob.D1_0.text, ask && ask.agent, ask && ask.question, ask && ask.note],
      [HOLD, 'archive', 'חשבונית 55555', 'ביקשו חשבונית 55555 — לא נמצא']);
  }

  /* ── בן עונה בחדר ── */
  {
    const db = seed();
    put(db, 'E1', R({}));
    await run(db, 'E1');
    const ask = room(db).find(e => e.kind === 'ask');
    const sent = [];
    const deps = { env: ENV, now: NOW + 5 * MIN, by: '0547725552', sendPending: async () => { sent.push(1); return { sent: 1 }; } };
    for (const [why, b, code] of [['bad key', { key: 'a/b', text: 'x' }, 'bad-key'], ['empty text', { key: ask.key, text: '  ' }, 'bad-text'],
      ['too long', { key: ask.key, text: 'א'.repeat(1001) }, 'bad-text'], ['missing', { key: 'nope', text: 'x' }, 'missing']]) {
      const r = await ROOMJS.lgRoomAnswer(db, b, deps);
      check('answer rejects ' + why, [r.ok, r.code], [false, code]);
    }
    const r = await ROOMJS.lgRoomAnswer(db, { key: ask.key, text: '  כן, יש. נשלח לך מחיר מחר  ' }, deps);
    check('answer ok', [r.ok, r.outboxKey], [true, 'room_' + ask.key]);
    const e = outbox(db)['room_' + ask.key];
    check('answer queued to the customer through the send layer', [e.to, e.customerId, e.text, e.agent, e.reason],
      [PRIV, '777', 'כן, יש. נשלח לך מחיר מחר', 'manager', 'agent-room-answer']);
    check('send attempted right away', sent.length, 1);
    const after = db._data.waMeta.agentRoom[ask.key];
    check('yellow entry is answered', [after.state, after.answeredBy, after.answeredAt, after.outboxKey], ['answered', '0547725552', NOW + 5 * MIN, 'room_' + ask.key]);
    const ans = room(db).filter(x => x.kind === 'answer');
    check('the room shows what was sent', ans.map(x => [x.agent, x.text, x.replyTo, x.by]), [['manager', 'כן, יש. נשלח לך מחיר מחר', ask.key, '0547725552']]);
    const again = await ROOMJS.lgRoomAnswer(db, { key: ask.key, text: 'שוב' }, deps);
    check('second answer → refused, nothing new queued', [again.ok, again.code, outbox(db)['room_' + ask.key].text], [false, 'answered', 'כן, יש. נשלח לך מחיר מחר']);
    const info = await ROOMJS.lgRoomPost(db, { kind: 'info', text: 'x' }, NOW);
    check('answer on an info entry → refused', (await ROOMJS.lgRoomAnswer(db, { key: info, text: 'x' }, deps)).code, 'not-ask');
  }
  /* ── דרך ה-drain ── */
  {
    const db = seed();
    put(db, 'F1', R({}));
    await run(db, 'F1');
    const ask = room(db).find(e => e.kind === 'ask');
    const r = await handleAdmin({ action: 'agent-room-answer', key: ask.key, text: 'תשובה' },
      { db, by: '0547725552', now: NOW, sendPending: async () => ({ sent: 0 }) });
    check('drain agent-room-answer', [r.ok, outbox(db)['room_' + ask.key].text, db._data.waMeta.agentRoom[ask.key].state], [true, 'תשובה', 'answered']);
  }

  /* ── סיכום המנהל בחדר ── */
  {
    const db = seed();
    const p = { configured: true, globalSlot: true, maxPerRun: 10, checksState: false, nextGap: () => 0, gate: () => ({ allowed: true }),
      async sendText() { return { ok: true, httpStatus: 200, messageId: 'T' }; } };
    await D.lgAgentDailyRun({ headers: { authorization: 'Bearer sek' } }, { db, env: { ...ENV, CRON_SECRET: 'sek' }, now: NOW, provider: p });
    const s = room(db).filter(e => e.kind === 'summary');
    check('daily summary pinned in the room', [s.length, s[0] && s[0].agent, s[0] && /^סיכום סוכנים/.test(s[0].text)], [1, 'manager', true]);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll agent-room checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
