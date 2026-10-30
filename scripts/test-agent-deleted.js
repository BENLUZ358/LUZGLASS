#!/usr/bin/env node
/**
 * קולט — לקוח מחק בוואטסאפ את הודעת הסקיצה (שלב 2, משימה 7).
 * זיהוי המחיקה ברשומת הצל (כמה צורות payload), החלטה (lgAgentDecide)
 * וביצוע: בתור → ביטול שקט, בטיפול → "לבטל אותה?", בייצור → הודעה.
 * Run:  node scripts/test-agent-deleted.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const sh = require(path.join(ROOT, 'api', '_agent-shadow.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const MIN = 60 * 1000;
const PRIV = '972501234567@c.us';        // מקושר → לקוח 777 (בפיילוט)
const PRIV2 = '972507777777@c.us';       // מקושר → לקוח 999 (לא בפיילוט)
const key = id => String(id).replace(/[.#$[\]/]/g, '_');
const ASK = 'הסקיצה שמחקת כבר בטיפול אצלנו. לבטל אותה?';
const PROD = 'הסקיצה שמחקת כבר בייצור, ואי אפשר לבטל אותה.';
const HANDOFF = 'העברנו לשאול, הוא יחזור אליך';
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222',
             AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' };

const ORDERS = {
  o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday', waMessageId: 'WA1' },
  o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending', waMessageId: 'WA3' },
  o4: { customerId: '777', orderNum: 'L1004', sketchName: 'אמבטיה', stage: 'chash', waMessageId: 'WA4' },
  o6: { customerId: '777', orderNum: 'L1006', stage: '', waMessageId: 'WA6' },
  o7: { customerId: '777', orderNum: 'L1007', stage: 'pending' },                    // ממייל — בלי waMessageId
  o2: { customerId: '999', orderNum: 'L1002', sketchName: 'כהן', stage: 'pending', waMessageId: 'WA2' },
};
const seed = extra => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' }, '0507777777': { customerId: '999' } },
  waGroups: {},
  users: {},
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 999: { name: 'אחר' } },
  orders: JSON.parse(JSON.stringify(ORDERS)),
  waMeta: { agentPilot: { 777: true }, ...(extra || {}) },
});
const list = cid => Object.entries(ORDERS).filter(([, o]) => o.customerId === cid).map(([id, o]) => ({ ...o, id }));

const payload = (id, md, chatId) => ({
  typeWebhook: 'incomingMessageReceived', idMessage: id, timestamp: NOW / 1000,
  senderData: { chatId: chatId || PRIV, sender: chatId || PRIV, chatName: 'צ׳אט' }, messageData: md });
const model = () => {
  const m = { calls: 0 };
  m.fetchImpl = async () => { m.calls++; throw new Error('model must not be called'); };
  return m;
};

const R = o => ({ idMessage: 'D1', chatId: PRIV, groupId: '', sender: '0501234567', text: '', quotedId: '', hasImage: false,
  linked: true, state: 'done', intent: '', ref: '', route: 'kolet-deleted', deletedId: 'WA3',
  customerId: '777', customerName: 'כהן זכוכית', timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const conv = (db, chat) => ((db._data.waMeta || {}).agentConv || {})[key(chat)];
const cancels = db => (db._data.waMeta || {}).agentCancels || {};
const sendStub = async () => ({ sent: 0 });
const run = (db, k, env, now) => act.lgAgentAct(db, k, { env: env || ON, now: now || NOW, sendPending: sendStub });
const D = (r, orders) => act.lgAgentDecide({ rec: R(r), orders: orders || list('777'), conv: null, now: NOW });

(async () => {
  check('texts exported', [act.DELETED_ASK_TEXT, act.DELETED_PROD_TEXT], [ASK, PROD]);

  /* ── זיהוי — צורות payload ─────────────────────────────────────── */
  {
    const p1 = sh.lgAgentShadowParse(payload('X1', { typeMessage: 'deletedMessage', deletedMessageData: { stanzaId: 'WA3' } }));
    check('parse: deletedMessage + deletedMessageData.stanzaId', [p1.action, p1.entry.typeMessage, p1.entry.deletedId, p1.entry.text],
      ['record', 'deletedMessage', 'WA3', '']);
    const p2 = sh.lgAgentShadowParse(payload('X2', { typeMessage: 'deletedMessage', extendedTextMessageData: { stanzaId: 'WA4' } }));
    check('parse: deletedMessage + extendedTextMessageData.stanzaId', p2.entry.deletedId, 'WA4');
    const p3 = sh.lgAgentShadowParse(payload('X3', { typeMessage: 'deletedMessage', stanzaId: 'WA1' }));
    check('parse: deletedMessage + messageData.stanzaId', p3.entry.deletedId, 'WA1');
    const p4 = sh.lgAgentShadowParse(payload('X4', { typeMessage: 'somethingNew', deletedMessageData: { stanzaId: 'WA6' } }));
    check('parse: other typeMessage but deletedMessageData → deleted', [p4.entry.deletedId, p4.entry.deleted], ['WA6', true]);
    const p5 = sh.lgAgentShadowParse(payload('X5', { typeMessage: 'deletedMessage' }));
    check('parse: deletedMessage without any id → deleted, empty deletedId', [p5.action, p5.entry.deleted, p5.entry.deletedId], ['record', true, '']);
    const p6 = sh.lgAgentShadowParse(payload('X6', { typeMessage: 'textMessage', textMessageData: { textMessage: 'שלום' } }));
    check('parse: normal text → not deleted', [p6.entry.deleted, p6.entry.deletedId], [false, '']);
    const p7 = sh.lgAgentShadowParse(payload('X7', { typeMessage: 'quotedMessage', extendedTextMessageData: { text: 'מה עם זה?', stanzaId: 'WA3' } }));
    check('parse: quoted reply is NOT a deletion (stanzaId → quotedId only)', [p7.entry.deleted, p7.entry.deletedId, p7.entry.quotedId], [false, '', 'WA3']);
  }

  /* ── עיבוד הצל: route 'kolet-deleted', בלי מודל ──────────────────── */
  {
    const db = seed(); const m = model();
    const r = await sh.lgAgentShadowRecord(db, payload('S1', { typeMessage: 'deletedMessage', deletedMessageData: { stanzaId: 'WA3' } }), NOW);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: { AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' } });
    const x = rec(db, r.key);
    check('shadow: deletion → route kolet-deleted, deletedId, customer, no model call',
      [x.state, x.route, x.deletedId, x.customerId, x.intent, m.calls], ['done', 'kolet-deleted', 'WA3', '777', '', 0]);
    check('shadow (switches off): wouldAct cancel, not acted, order still there',
      [x.acted, x.actReason, (x.wouldAct || []).map(a => a.type), !!db._data.orders.o3], [false, 'switches-off', ['cancel'], true]);

    const r2 = await sh.lgAgentShadowRecord(db, payload('S2', { typeMessage: 'deletedMessage' }), NOW);
    await sh.lgAgentShadowProcess(db, r2.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ON });
    check('shadow: unknown deletion shape → route none, no action, no model',
      [rec(db, r2.key).route, rec(db, r2.key).deletedId, rec(db, r2.key).actReason, m.calls], ['none', '', 'no-action', 0]);

    // אדם עונה בצ'אט (שעתיים) → שום פעולה
    db._data.waMeta.agentHuman = { [key(PRIV)]: { lastAt: NOW } };
    const r3 = await sh.lgAgentShadowRecord(db, payload('S3', { typeMessage: 'deletedMessage', stanzaId: 'WA3' }), NOW + MIN);
    await sh.lgAgentShadowProcess(db, r3.key, { now: NOW + MIN, fetchImpl: m.fetchImpl, env: ON });
    check('shadow: human quiet → silent-human, order stays', [rec(db, r3.key).route, !!db._data.orders.o3], ['silent-human', true]);
  }

  /* ── החלטה (טהור) ─────────────────────────────────────────────── */
  {
    const d1 = D({ deletedId: 'WA3' });
    check('decide: pending → silent cancel (no customer text on success)',
      [d1.actions.length, d1.actions[0].type, d1.actions[0].orderId, d1.actions[0].okText, d1.actions[0].silent, d1.conv],
      [1, 'cancel', 'o3', '', true, null]);
    check('decide: stage "" → silent cancel', D({ deletedId: 'WA6' }).actions.map(a => [a.type, a.orderId]), [['cancel', 'o6']]);
    check('decide: chash → ask + conv confirm-cancel',
      D({ deletedId: 'WA4' }), { actions: [{ type: 'reply', text: ASK }], conv: { await: 'confirm-cancel', orderId: 'o4', at: NOW } });
    check('decide: workday → production text, no conv', D({ deletedId: 'WA1' }), { actions: [{ type: 'reply', text: PROD }], conv: null });
    check('decide: order of ANOTHER customer → nothing', D({ deletedId: 'WA2' }).actions, []);
    check('decide: no matching order → nothing', D({ deletedId: 'NOPE' }).actions, []);
    check('decide: empty deletedId never matches orders without waMessageId', D({ deletedId: '' }).actions, []);
    check('decide: not linked → nothing', D({ deletedId: 'WA3', linked: false }).actions, []);
    // כמה הזמנות מאותה הודעה
    const two = [{ id: 'a', customerId: '777', stage: 'pending', waMessageId: 'W' }, { id: 'b', customerId: '777', stage: '', waMessageId: 'W' }];
    check('decide: two queued orders from one message → two silent cancels',
      D({ deletedId: 'W' }, two).actions.map(a => [a.type, a.orderId, a.silent]), [['cancel', 'a', true], ['cancel', 'b', true]]);
    const mixed = [two[0], { id: 'c', customerId: '777', orderNum: 'L9', stage: 'workday', waMessageId: 'W' }];
    check('decide: mixed stages from one message → Shaul + handoff',
      D({ deletedId: 'W' }, mixed).actions.map(a => [a.type, a.type === 'reply' ? a.text : '']), [['staff', ''], ['reply', HANDOFF]]);
  }

  /* ── ביצוע ─────────────────────────────────────────────────────── */
  {
    // מתגים + פיילוט → ביטול שקט אמיתי, שום הודעה ללקוח
    const db = seed(); put(db, 'A1', R({ idMessage: 'A1' }));
    const a = await run(db, 'A1');
    check('act: pending → order removed, cancel record, nothing queued',
      [a.acted, !!db._data.orders.o3, cancels(db).o3 && cancels(db).o3.confirmed, Object.keys(outbox(db)).length],
      [true, false, true, 0]);
    check('act: cancel result recorded', rec(db, 'A1').actCancels, [{ orderId: 'o3', ok: true, code: '' }]);

    // מתג כבוי → רק wouldAct
    const db2 = seed(); put(db2, 'A2', R({ idMessage: 'A2' }));
    await run(db2, 'A2', { ...ON, AGENT_REPLY_ENABLED: 'false' });
    check('act: reply switch off → no cancel, wouldAct only', [!!db2._data.orders.o3, rec(db2, 'A2').actReason, cancels(db2).o3], [true, 'switches-off', undefined]);

    // לא בפיילוט → רק wouldAct
    const db3 = seed(); delete db3._data.waMeta.agentPilot[777]; put(db3, 'A3', R({ idMessage: 'A3' }));
    await run(db3, 'A3');
    check('act: not pilot → no cancel', [!!db3._data.orders.o3, rec(db3, 'A3').actReason], [true, 'not-pilot']);

    // בייצור → הודעה
    const db4 = seed(); put(db4, 'A4', R({ idMessage: 'A4', deletedId: 'WA1' }));
    await run(db4, 'A4');
    check('act: workday → production text queued to the chat', [outbox(db4).A4_0.text, outbox(db4).A4_0.to, !!db4._data.orders.o1], [PROD, PRIV, true]);

    // ירדה לייצור בין ההחלטה לביטול → הודעת "בייצור", לא נמחקת
    const db5 = seed(); put(db5, 'A5', R({ idMessage: 'A5' }));
    const real = act.lgAgentCancel;
    act.lgAgentCancel = async () => ({ ok: false, code: 'too-late' });
    await run(db5, 'A5');
    check('act: silent cancel → too-late → production text', outbox(db5).A5_0.text, PROD);
    // כבר נמחקה (missing) → כלום
    const db6 = seed(); put(db6, 'A6', R({ idMessage: 'A6' }));
    act.lgAgentCancel = async () => ({ ok: false, code: 'missing' });
    await run(db6, 'A6');
    check('act: silent cancel → missing → nothing queued', Object.keys(outbox(db6)).length, 0);
    // כשל אחר → שאול + "העברנו לשאול"
    const db7 = seed(); put(db7, 'A7', R({ idMessage: 'A7' }));
    act.lgAgentCancel = async () => ({ ok: false, code: 'error' });
    await run(db7, 'A7');
    check('act: silent cancel → error → Shaul + handoff', [outbox(db7).A7_0_s.to, outbox(db7).A7_0.text], ['0501112222', HANDOFF]);
    act.lgAgentCancel = real;

    // בטיפול → שאלה + conv; "כן" אחרי שנשלחה → ביטול דרך המסלול של משימה 2
    const db8 = seed(); put(db8, 'B1', R({ idMessage: 'B1', deletedId: 'WA4' }));
    await run(db8, 'B1');
    check('act: chash → question queued, conv with askKey', [outbox(db8).B1_0.text, conv(db8, PRIV)],
      [ASK, { await: 'confirm-cancel', orderId: 'o4', at: NOW, askKey: 'B1_0' }]);
    check('act: chash → order not touched yet', !!db8._data.orders.o4, true);
    Object.assign(outbox(db8).B1_0, { state: 'sent', sentAt: NOW + MIN });
    put(db8, 'B2', R({ idMessage: 'B2', route: 'shaul', deletedId: '', text: 'כן', intent: 'unclear', timestamp: NOW + 2 * MIN }));
    await run(db8, 'B2', ON, NOW + 2 * MIN);
    check('act: "כן" → o4 cancelled, "ההזמנה בוטלה", conv cleared',
      [!!db8._data.orders.o4, outbox(db8).B2_0.text, conv(db8, PRIV)], [false, 'ההזמנה בוטלה', undefined]);

    // לקוח אחר מחק הודעה עם מזהה של הזמנה של 777 → כלום
    const db9 = seed({ agentPilot: { 777: true, 999: true } });
    put(db9, 'C1', R({ idMessage: 'C1', chatId: PRIV2, sender: '0507777777', customerId: '999', customerName: 'אחר', deletedId: 'WA3' }));
    await run(db9, 'C1');
    check('act: other customer deleting a 777 message id → nothing', [!!db9._data.orders.o3, rec(db9, 'C1').actReason], [true, 'no-action']);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
