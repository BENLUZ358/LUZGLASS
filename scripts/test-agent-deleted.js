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

  /* ── מתג נפרד: "סקיצה שנמחקה — פעיל" (בן, 3/11) ─────────────────────
     waMeta/agentDeleteLive === true → רק הפעולה הזו פועלת, לכל לקוח מקושר,
     גם כשהתשובות כבויות ובלי פיילוט. ללקוח לא נשלח כלום: בתור → ביטול שקט;
     כל השאר → הודעה לשאול לבדוק. */
  {
    const OFF = { ...ON, AGENT_REPLY_ENABLED: 'false' };
    const live = extra => { const db = seed({ agentDeleteLive: true, ...(extra || {}) }); delete db._data.waMeta.agentPilot; return db; };

    const db1 = live(); put(db1, 'E1', R({ idMessage: 'E1' }));
    const a1 = await run(db1, 'E1', OFF);
    check('live: queued order → cancelled even with replies off and no pilot',
      [a1.acted, !!db1._data.orders.o3, cancels(db1).o3 && cancels(db1).o3.confirmed, rec(db1, 'E1').actMode], [true, false, true, 'delete-only']);
    check('live: and nothing to the customer', Object.values(outbox(db1)).filter(e => e.to === PRIV).length, 0);

    const db2 = live(); put(db2, 'E2', R({ idMessage: 'E2', deletedId: 'WA1' }));
    await run(db2, 'E2', OFF);
    const e2 = Object.values(outbox(db2));
    check('live: in production → one note to Shaul, nothing to the customer, order kept',
      [e2.length, e2[0] && e2[0].to, e2[0] && e2[0].reason, /L1001/.test(e2[0] && e2[0].text), !!db2._data.orders.o1], [1, '0501112222', 'agent-deleted-staff', true, true]);
    check('live: no question asked → no conv', conv(db2, PRIV), undefined);

    const db3 = live(); put(db3, 'E3', R({ idMessage: 'E3', deletedId: 'WA4' }));
    await run(db3, 'E3', OFF);
    const e3 = Object.values(outbox(db3));
    check('live: in treatment (chash) → Shaul only, not cancelled', [e3.map(e => e.to), /L1004/.test(e3[0] && e3[0].text), !!db3._data.orders.o4], [['0501112222'], true, true]);

    const db4 = live(); put(db4, 'E4', R({ idMessage: 'E4' }));
    const realC = act.lgAgentCancel;
    act.lgAgentCancel = async () => ({ ok: false, code: 'too-late' });
    await run(db4, 'E4', OFF);
    act.lgAgentCancel = realC;
    check('live: cancel too late → Shaul, not the customer', Object.values(outbox(db4)).map(e => [e.to, e.reason]), [['0501112222', 'agent-deleted-staff']]);

    const db5 = seed(); delete db5._data.waMeta.agentPilot; put(db5, 'E5', R({ idMessage: 'E5' }));
    await run(db5, 'E5', OFF);
    check('live switch off → as before (wouldAct only)', [!!db5._data.orders.o3, rec(db5, 'E5').actReason], [true, 'switches-off']);

    const db6 = live(); put(db6, 'E6', R({ idMessage: 'E6', route: 'okev', deletedId: '', text: 'תבטל את L1003' }));
    await run(db6, 'E6', OFF);
    check('live: other routes are not affected', [!!db6._data.orders.o3, rec(db6, 'E6').acted], [true, false]);

    const db7 = live(); put(db7, 'E7', R({ idMessage: 'E7', linked: false }));
    await run(db7, 'E7', OFF);
    check('live: unlinked chat → nothing', [!!db7._data.orders.o3, Object.keys(outbox(db7)).length], [true, 0]);

    const db8 = live(); put(db8, 'E8', R({ idMessage: 'E8' }));
    await run(db8, 'E8', { ...OFF, AGENT_STAFF_PHONES: '' });
    check('live: no Shaul configured → no action at all', [!!db8._data.orders.o3, rec(db8, 'E8').actReason], [true, 'no-staff']);

    // שליחה: עם התשובות כבויות, רק הודעת "נמחקה" לשאול יוצאת; כל השאר נחסם
    const send = require(path.join(ROOT, 'api', '_agent-send.js'));
    const prov = () => { const p = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 10, checksState: false, nextGap: () => 0,
      texts: [], gate: () => ({ allowed: true, reason: '' }), async sendText(f) { p.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length }; } }; return p; };
    const db9 = live();
    await send.lgAgentEnqueue(db9, { key: 'k1', to: '0501112222', customerId: '777', text: 'נמחקה', files: [], reason: 'agent-deleted-staff' });
    await send.lgAgentEnqueue(db9, { key: 'k2', to: '0501112222', customerId: '777', text: 'אחר', files: [], reason: 'agent-staff' });
    await send.lgAgentEnqueue(db9, { key: 'k3', to: PRIV, customerId: '777', text: 'ללקוח', files: [], reason: 'agent-deleted-staff' });
    const p9 = prov();
    await send.lgAgentSendPending(db9, { provider: p9, env: OFF });
    check('send (replies off, live on): only the deleted note to Shaul goes out',
      [p9.texts.map(t => t.text), outbox(db9).k1.state, outbox(db9).k2.state, outbox(db9).k3.state], [['נמחקה'], 'sent', 'blocked', 'blocked']);
    const db10 = seed();
    await send.lgAgentEnqueue(db10, { key: 'k1', to: '0501112222', customerId: '777', text: 'נמחקה', files: [], reason: 'agent-deleted-staff' });
    const p10 = prov();
    await send.lgAgentSendPending(db10, { provider: p10, env: OFF });
    check('send: live switch off → blocked like everything else', [p10.texts.length, outbox(db10).k1.state], [0, 'blocked']);

    // המתג — רק דרך ה-endpoint האדמיני, ומוצג בלוח הסוכנים
    const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
    const db11 = seed();
    const sw = b => adm.handleAdmin({ action: 'agent-delete-live', ...b }, { db: db11, by: '0520000000', now: NOW });
    await sw({ on: true });
    check('switch: on → true', db11._data.waMeta.agentDeleteLive, true);
    await sw({ on: false });
    check('switch: off → removed', db11._data.waMeta.agentDeleteLive, undefined);
    check('switch: needs a boolean', (await sw({ on: 'yes' })).code, 'bad-on');

    // מרוץ: ההזמנה עברה לטיפול בין ההחלטה לביטול — ביטול "שקט" לא מוחק אותה
    const db12 = seed(); db12._data.orders.o3.stage = 'chash';
    const rc = await act.lgAgentCancel(db12, 'o3', { customerId: '777', chatId: PRIV, now: NOW, onlyStages: ['', 'pending'] });
    check('race: silent cancel of an order now in treatment → too-late, order kept', [rc.code, !!db12._data.orders.o3], ['too-late', true]);
    const rc2 = await act.lgAgentCancel(db12, 'o3', { customerId: '777', chatId: PRIV, now: NOW });
    check('race: a normal cancel (customer said yes) still allows chash', [rc2.ok, !!db12._data.orders.o3], [true, false]);
    const H = require('fs').readFileSync(path.join(ROOT, 'agents.html'), 'utf8');
    check('agents page listens to the switch and toggles it', /waMeta\/agentDeleteLive/.test(H) && /'agent-delete-live'/.test(H), true);
  }

  /* ── צרופה שנמחקה (בן, 10/11) ─────────────────────────────────────
     הלקוח מחק את הודעת התמונה שאוחדה כצרופה להזמנה → פועלים על הצרופה בלבד,
     לפי השלב של ההזמנה הראשית: בתור → יורדת בשקט; בטיפול → "להוריד?"; בייצור → הודעה. */
  {
    const LBL = 'גרפיקה חלבי';
    const AASK = "הקובץ 'גרפיקה חלבי' שמחקת כבר בטיפול. להוריד אותו?";
    const APROD = "הקובץ 'גרפיקה חלבי' שמחקת כבר בייצור, ואי אפשר להוריד אותו.";
    const AOK = "הקובץ 'גרפיקה חלבי' הוסר מההזמנה";
    const AKEPT = 'בסדר, הקובץ נשאר בהזמנה';
    check('att texts exported', [act.ATT_DELETED_ASK && act.ATT_DELETED_ASK(LBL), act.ATT_DELETED_PROD && act.ATT_DELETED_PROD(LBL),
      act.ATT_REMOVED_TEXT && act.ATT_REMOVED_TEXT(LBL), act.ATT_KEPT_TEXT], [AASK, APROD, AOK, AKEPT]);
    const o8 = stage => ({ customerId: '777', orderNum: 'L1008', sketchName: 'חלון', stage, waMessageId: 'WA8',
      attachments: { 1: { kind: 'graphic', at: 1, by: 'ben', from: { order: { customerId: '777', waMessageId: 'WAT1', orderNum: 'L1009' } } } } });
    const aseed = (stage, extra) => { const db = seed(extra); db._data.orders.o8 = o8(stage);
      db._data.sketches = { o8: 'data:image/png;base64,AAAA', o8__att1: 'data:image/png;base64,BBBB' }; return db; };
    const DL = (stage, r, more) => D({ deletedId: 'WAT1', ...(r || {}) }, [...list('777'), { ...o8(stage), id: 'o8' }, ...(more || [])]);
    const att = db => ((db._data.orders.o8 || {}).attachments || {})[1];

    // החלטה
    const d1 = DL('');
    check('att decide: order in queue → silent att-remove, nothing to the customer',
      [d1.actions.map(a => [a.type, a.orderId, a.k, a.silent, a.okText]), d1.conv], [[['att-remove', 'o8', 1, true, '']], null]);
    check('att decide: pending is also silent', DL('pending').actions.map(a => a.type), ['att-remove']);
    check('att decide: in treatment → ask about the label + conv confirm-att-remove',
      DL('chash'), { actions: [{ type: 'reply', text: AASK }], conv: { await: 'confirm-att-remove', orderId: 'o8', k: 1, at: NOW } });
    check('att decide: production → the production text', DL('workday'), { actions: [{ type: 'reply', text: APROD }], conv: null });
    check('att decide: attachment on another customer order → nothing', DL('', { customerId: '999' }).actions, []);
    check('att decide: an ORDER with that message id wins over the attachment',
      DL('', null, [{ id: 'o9', customerId: '777', stage: 'pending', waMessageId: 'WAT1' }]).actions.map(a => [a.type, a.orderId]), [['cancel', 'o9']]);

    const expired = { await: 'confirm-att-remove', orderId: 'o8', k: 1, at: NOW - 31 * MIN };
    check('att decide: "כן" after 30 minutes → asked again, nothing removed',
      act.lgAgentDecide({ rec: R({ route: 'shaul', deletedId: '', text: 'כן' }), orders: [{ ...o8('chash'), id: 'o8' }], conv: expired, now: NOW }),
      { actions: [{ type: 'reply', text: AASK }], conv: { await: 'confirm-att-remove', orderId: 'o8', k: 1, at: NOW } });

    // ביצוע — בתור: הצרופה יורדת, ההזמנה והסקיצה נשארות
    const db1 = aseed(''); put(db1, 'G1', R({ idMessage: 'G1', deletedId: 'WAT1' }));
    const g1 = await run(db1, 'G1');
    check('att act: queue → attachment + its image removed, order and main sketch kept, nothing queued',
      [g1.acted, !!db1._data.orders.o8, att(db1), db1._data.sketches.o8__att1, !!db1._data.sketches.o8, Object.keys(outbox(db1)).length, cancels(db1).o8],
      [true, true, undefined, undefined, true, 0, undefined]);
    const bk = Object.values((db1._data.waMeta || {}).agentAttRemovals || {});
    check('att act: a copy is kept in waMeta/agentAttRemovals (record + image)',
      [bk.length, bk[0] && bk[0].orderId, bk[0] && bk[0].k, bk[0] && bk[0].att && bk[0].att.kind, bk[0] && bk[0].sketch], [1, 'o8', 1, 'graphic', 'data:image/png;base64,BBBB']);
    check('att act: result recorded', rec(db1, 'G1').actAttRemovals, [{ orderId: 'o8', k: 1, ok: true, code: '' }]);

    // בטיפול → שאלה; "כן" → רק הצרופה יורדת
    const db2 = aseed('chash'); put(db2, 'G2', R({ idMessage: 'G2', deletedId: 'WAT1' }));
    await run(db2, 'G2');
    check('att act: chash → question queued, conv, attachment kept', [outbox(db2).G2_0 && outbox(db2).G2_0.text, conv(db2, PRIV), !!att(db2)],
      [AASK, { await: 'confirm-att-remove', orderId: 'o8', k: 1, at: NOW, askKey: 'G2_0' }, true]);
    if (outbox(db2).G2_0) Object.assign(outbox(db2).G2_0, { state: 'sent', sentAt: NOW + MIN });
    put(db2, 'G3', R({ idMessage: 'G3', route: 'shaul', deletedId: '', text: 'כן', intent: 'unclear', timestamp: NOW + 2 * MIN }));
    await run(db2, 'G3', ON, NOW + 2 * MIN);
    check('att act: "כן" → attachment removed, order untouched, "הוסר", conv cleared',
      [att(db2), db2._data.sketches.o8__att1, db2._data.orders.o8 && db2._data.orders.o8.stage, outbox(db2).G3_0 && outbox(db2).G3_0.text, conv(db2, PRIV)],
      [undefined, undefined, 'chash', AOK, undefined]);
    // "לא" → נשאר
    const db3 = aseed('chash'); put(db3, 'G4', R({ idMessage: 'G4', deletedId: 'WAT1' }));
    await run(db3, 'G4');
    if (outbox(db3).G4_0) Object.assign(outbox(db3).G4_0, { state: 'sent', sentAt: NOW + MIN });
    put(db3, 'G5', R({ idMessage: 'G5', route: 'shaul', deletedId: '', text: 'לא', intent: 'unclear', timestamp: NOW + 2 * MIN }));
    await run(db3, 'G5', ON, NOW + 2 * MIN);
    check('att act: "לא" → kept, kept text', [!!att(db3), outbox(db3).G5_0 && outbox(db3).G5_0.text, conv(db3, PRIV)], [true, AKEPT, undefined]);
    // ירדה לייצור בין השאלה ל"כן"
    const db4 = aseed('chash'); put(db4, 'G6', R({ idMessage: 'G6', deletedId: 'WAT1' }));
    await run(db4, 'G6');
    if (outbox(db4).G6_0) Object.assign(outbox(db4).G6_0, { state: 'sent', sentAt: NOW + MIN });
    db4._data.orders.o8.stage = 'workday';
    put(db4, 'G7', R({ idMessage: 'G7', route: 'shaul', deletedId: '', text: 'כן', intent: 'unclear', timestamp: NOW + 2 * MIN }));
    await run(db4, 'G7', ON, NOW + 2 * MIN);
    check('att act: moved to production before "כן" → production text, kept', [!!att(db4), outbox(db4).G7_0 && outbox(db4).G7_0.text], [true, APROD]);
    // בייצור
    const db5 = aseed('workday'); put(db5, 'G8', R({ idMessage: 'G8', deletedId: 'WAT1' }));
    await run(db5, 'G8');
    check('att act: production → production text, kept', [outbox(db5).G8_0 && outbox(db5).G8_0.text, !!att(db5)], [APROD, true]);

    // "סקיצה שנמחקה — פעיל" בלבד
    const OFF = { ...ON, AGENT_REPLY_ENABLED: 'false' };
    const live = stage => { const db = aseed(stage, { agentDeleteLive: true }); delete db._data.waMeta.agentPilot; return db; };
    const db6 = live(''); put(db6, 'H1', R({ idMessage: 'H1', deletedId: 'WAT1' }));
    const h1 = await run(db6, 'H1', OFF);
    check('att live: queue → removed, nothing to anyone', [h1.acted, att(db6), rec(db6, 'H1').actMode, Object.keys(outbox(db6)).length], [true, undefined, 'delete-only', 0]);
    const db7 = live('chash'); put(db7, 'H2', R({ idMessage: 'H2', deletedId: 'WAT1' }));
    await run(db7, 'H2', OFF);
    const e7 = Object.values(outbox(db7));
    check('att live: in treatment → one note to Shaul naming the label and the order, kept',
      [e7.map(e => [e.to, e.reason]), /גרפיקה חלבי/.test(e7[0] && e7[0].text), /L1008/.test(e7[0] && e7[0].text), !!att(db7)],
      [[['0501112222', 'agent-deleted-staff']], true, true, true]);

    // מרוצים בפונקציה עצמה
    if (typeof act.lgAgentAttRemove !== 'function') { failed++; console.error('FAIL  lgAgentAttRemove not exported'); }
    else {
      const db8 = aseed('chash');
      const ctx = { customerId: '777', chatId: PRIV, now: NOW, waMessageId: 'WAT1' };
      check('att race: silent removal of an order now in treatment → too-late',
        [(await act.lgAgentAttRemove(db8, 'o8', 1, { ...ctx, onlyStages: ['', 'pending'] })).code, !!att(db8)], ['too-late', true]);
      check('att race: the slot now holds another message → missing',
        [(await act.lgAgentAttRemove(db8, 'o8', 1, { ...ctx, waMessageId: 'OTHER' })).code, !!att(db8)], ['missing', true]);
      check('att race: other customer → forbidden', (await act.lgAgentAttRemove(db8, 'o8', 1, { ...ctx, customerId: '999', chatId: PRIV2 })).code, 'forbidden');
      const ok8 = await act.lgAgentAttRemove(db8, 'o8', 1, ctx);
      check('att race: normal removal (yes) allows chash', [ok8.ok, att(db8), db8._data.orders.o8.stage], [true, undefined, 'chash']);
      check('att race: twice → missing', (await act.lgAgentAttRemove(db8, 'o8', 1, ctx)).code, 'missing');
    }
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
