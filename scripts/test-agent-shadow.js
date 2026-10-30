#!/usr/bin/env node
/**
 * רשומת צל — כל הודעת וואטסאפ נרשמת ב-waMeta/agentShadow, מרכזן מסווג,
 * עוקב מחשב מה היה עונה. שום דבר לא נשלח (מצב שקט).
 * Run:  node scripts/test-agent-shadow.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const sh = require(path.join(__dirname, '..', 'api', '_agent-shadow.js'));
const { AGENT_MENU_TEXT } = require(path.join(__dirname, '..', 'api', '_agent-okev.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const HOUR = 60 * 60 * 1000;
const PRIV = '972501234567@c.us';        // מקושר ב-waSenders → לקוח 777
const STRANGER = '972549999999@c.us';    // לא מקושר
const GROUP = '120363000000@g.us';       // קבוצה מקושרת → לקוח 888
const ENV = { AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' };

const payload = (id, md, chatId, sender, typeWebhook) => ({
  typeWebhook: typeWebhook || 'incomingMessageReceived', idMessage: id, timestamp: NOW / 1000,
  senderData: { chatId: chatId || PRIV, sender: sender || chatId || PRIV, chatName: 'צ׳אט' }, messageData: md });
const textMd = t => ({ typeMessage: 'textMessage', textMessageData: { textMessage: t } });

// מודל מזויף: מחזיר intent קבוע וסופר קריאות
const model = (intent, ref, ok = true, status = 200) => {
  const m = { calls: 0 };
  m.fetchImpl = async () => {
    m.calls++;
    return { ok, status, json: async () => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ intent, ref: ref || '' }) }] }] }) };
  };
  return m;
};

const seed = () => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  waGroups: { [GROUP.replace(/[.#$[\]/]/g, '_')]: { customerId: '888', customerName: 'קבוצת לוי' } },
  users: {},
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 888: { name: 'לוי' } },
  orders: {
    o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday', waMessageId: 'WA1' },
    o2: { customerId: '999', orderNum: 'L1002', sketchName: 'כהן', stage: 'pending' },
    o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending' },
  },
});
const rec = (db, key) => db._data.waMeta.agentShadow[key];
const shadowCount = db => Object.keys((db._data.waMeta || {}).agentShadow || {}).length;

(async () => {
  check('constants', [sh.SHADOW, sh.HUMAN, sh.AGENT_HUMAN_QUIET_MS], ['waMeta/agentShadow', 'waMeta/agentHuman', 2 * 60 * 60 * 1000]);

  /* parse */
  {
    const p = sh.lgAgentShadowParse(payload('P1', textMd('מה עם כהן?')));
    check('parse: incoming text → record', [p.action, p.entry.text, p.entry.chatId, p.entry.sender, p.entry.groupId, p.entry.hasImage, p.entry.timestamp],
          ['record', 'מה עם כהן?', PRIV, '0501234567', '', false, NOW]);
    check('parse: outgoingMessageReceived → human', sh.lgAgentShadowParse(payload('P2', textMd('x'), PRIV, PRIV, 'outgoingMessageReceived')).action, 'human');
    check('parse: outgoingAPIMessageReceived → ignore', sh.lgAgentShadowParse(payload('P3', textMd('x'), PRIV, PRIV, 'outgoingAPIMessageReceived')).action, 'ignore');
    const img = sh.lgAgentShadowParse(payload('P4', { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://x/y.jpg', mimeType: 'image/jpeg', caption: 'מידות' } }));
    check('parse: image → hasImage, caption as text, no downloadUrl', [img.entry.hasImage, img.entry.text, 'downloadUrl' in img.entry], [true, 'מידות', false]);
  }

  /* הודעה פרטית ממספר מקושר → status, ורק הזמנות של אותו לקוח */
  {
    const db = seed(); const m = model('status', 'כהן');
    const r = await sh.lgAgentShadowRecord(db, payload('A1', textMd('מה עם כהן?')), NOW);
    check('linked private: one record created', [r.created, shadowCount(db)], [true, 1]);
    check('linked private: record has text and linked:true', [rec(db, r.key).text, rec(db, r.key).linked, rec(db, r.key).state], ['מה עם כהן?', true, 'received']);
    const res = await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 100, fetchImpl: m.fetchImpl, env: ENV });
    const e = rec(db, r.key);
    check('process ok', res.ok, true);
    check('intent/route', [e.state, e.intent, e.ref, e.route], ['done', 'status', 'כהן', 'okev']);
    check('wouldReply by עוקב', e.wouldReply, 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור');
    check('matchedOrderIds: only the same customer\'s order', e.matchedOrderIds, ['o1']);
    check('customer + model + usage', [e.customerId, e.customerName, e.model, e.usage], ['777', 'כהן זכוכית', 'm1', { input_tokens: 10, output_tokens: 5 }]);
    check('doneAt, claim cleared', [e.doneAt, e.claimToken], [NOW + 100, undefined]);
    check('nothing was queued to send', [db._data.waOutbox, db._data.waQueue], [undefined, undefined]);

    /* אותו idMessage פעמיים; process פעמיים */
    const again = await sh.lgAgentShadowRecord(db, payload('A1', textMd('מה עם כהן?')), NOW + 500);
    check('same idMessage again → created:false', [again.created, shadowCount(db)], [false, 1]);
    const res2 = await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 600, fetchImpl: m.fetchImpl, env: ENV });
    check('process again → not ok, model called once', [res2.ok, m.calls], [false, 1]);
  }

  /* תגובה עם ציטוט */
  {
    const db = seed(); const m = model('status', '');
    const r = await sh.lgAgentShadowRecord(db, payload('Q1', { typeMessage: 'quotedMessage',
      extendedTextMessageData: { text: 'מוכן?', stanzaId: 'WA1' }, quotedMessage: { typeMessage: 'imageMessage' } }), NOW);
    check('quoted: quotedId saved', rec(db, r.key).quotedId, 'WA1');
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    check('quoted: order with waMessageId WA1 is found', [rec(db, r.key).route, rec(db, r.key).matchedOrderIds], ['okev', ['o1']]);
  }

  /* מספר לא מקושר */
  {
    const db = seed(); const m = model('status', 'כהן');
    const r = await sh.lgAgentShadowRecord(db, payload('U1', textMd('מה עם כהן?'), STRANGER), NOW);
    const e0 = rec(db, r.key);
    check('unlinked: linked:false, no text field', [e0.linked, 'text' in e0], [false, false]);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    const e = rec(db, r.key);
    check('unlinked: route shaul, done, model not called', [e.state, e.route, m.calls, 'text' in e], ['done', 'shaul', 0, false]);
  }

  /* רשימת Vercel (lgWaInboundAllowed) גם נחשבת מקושר */
  {
    const prev = [process.env.GREENAPI_INBOUND_ALLOWED, process.env.FIREBASE_SERVICE_ACCOUNT];
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'luz-glass-test' });
    process.env.GREENAPI_INBOUND_ALLOWED = 'luz-glass-test:0549999999';
    const db = seed();
    const r = await sh.lgAgentShadowRecord(db, payload('V1', textMd('שלום'), STRANGER), NOW);
    check('allowlisted sender → linked:true with text', [rec(db, r.key).linked, rec(db, r.key).text], [true, 'שלום']);
    for (const [k, v] of [['GREENAPI_INBOUND_ALLOWED', prev[0]], ['FIREBASE_SERVICE_ACCOUNT', prev[1]]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  /* קבוצה מקושרת, chitchat */
  {
    const db = seed(); const m = model('chitchat', '');
    const r = await sh.lgAgentShadowRecord(db, payload('G1', textMd('בוקר טוב'), GROUP, '972521111111@c.us'), NOW);
    check('group: recorded with groupId, linked', [rec(db, r.key).groupId, rec(db, r.key).linked], [GROUP, true]);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    check('group chitchat → ignore, customer from the group', [rec(db, r.key).route, rec(db, r.key).customerId, rec(db, r.key).wouldReply], ['ignore', '888', '']);
  }

  /* קבוצה שלא מקושרת ב-waGroups — null, שום כתיבה */
  {
    const db = seed();
    const r = await sh.lgAgentShadowRecord(db, payload('G2', textMd('מתי מוכן?'), '120363000000000999@g.us', '972521111111@c.us'), NOW);
    check('unlinked group → null', r, null);
    check('unlinked group → no shadow write', shadowCount(db), 0);
    check('unlinked group → no waMeta at all', db._data.waMeta === undefined || Object.keys(db._data.waMeta).length === 0, true);
  }

  /* פרטי chitchat → תפריט */
  {
    const db = seed(); const m = model('chitchat', '');
    const r = await sh.lgAgentShadowRecord(db, payload('M1', textMd('היי')), NOW);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    check('private chitchat → menu with the menu text', [rec(db, r.key).route, rec(db, r.key).wouldReply], ['menu', AGENT_MENU_TEXT]);
  }

  /* הודעה ידנית מהטלפון → שקט שעתיים */
  {
    const db = seed();
    const h = await sh.lgAgentShadowRecord(db, payload('H1', textMd('אני בודק'), PRIV, PRIV, 'outgoingMessageReceived'), NOW);
    check('outgoingMessageReceived: no shadow record', [h, shadowCount(db)], [null, 0]);
    const chatKey = PRIV.replace(/[.#$[\]/]/g, '_');
    check('outgoingMessageReceived: HUMAN/<chat>/lastAt written', db._data.waMeta.agentHuman[chatKey].lastAt, NOW);
    const api = await sh.lgAgentShadowRecord(db, payload('H2', textMd('הודעה אוטומטית'), PRIV, PRIV, 'outgoingAPIMessageReceived'), NOW + 10 * HOUR);
    check('outgoingAPIMessageReceived does not mark human', [api, db._data.waMeta.agentHuman[chatKey].lastAt], [null, NOW]);

    const m = model('status', 'כהן');
    const r1 = await sh.lgAgentShadowRecord(db, payload('H3', textMd('מה עם כהן?')), NOW + HOUR);
    await sh.lgAgentShadowProcess(db, r1.key, { now: NOW + HOUR, fetchImpl: m.fetchImpl, env: ENV });
    check('an hour later → silent-human', [rec(db, r1.key).route, rec(db, r1.key).wouldReply], ['silent-human', '']);
    const r3 = await sh.lgAgentShadowRecord(db, payload('H4', textMd('מה עם כהן?')), NOW + 3 * HOUR);
    await sh.lgAgentShadowProcess(db, r3.key, { now: NOW + 3 * HOUR, fetchImpl: m.fetchImpl, env: ENV });
    check('three hours later → okev again', rec(db, r3.key).route, 'okev');
  }

  /* Review Focus 1: שאלה עם מספר ומידות שהקליטה הקיימת קולטת כהזמנה */
  {
    const db = seed(); const m = model('status', 'PHR#26037');
    const r = await sh.lgAgentShadowRecord(db, payload('F1', textMd('PHR#26037 מתי מוכן?\n90/145 ס"מ — כמות: 2')), NOW);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    check('focus 1: intakeKind text kept next to intent status', [rec(db, r.key).intakeKind, rec(db, r.key).intent], ['text', 'status']);
    // השורה האחת המקורית לא נקלטת בקליטה הקיימת (אין "כמות") — intakeKind ריק
    const r2 = await sh.lgAgentShadowRecord(db, payload('F2', textMd('PHR#26037 90/145 מתי מוכן?')), NOW);
    check('focus 1: the single-line form is not an intake order', rec(db, r2.key).intakeKind, '');
    const r3 = await sh.lgAgentShadowRecord(db, payload('F3', { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://x', mimeType: 'image/jpeg' } }), NOW);
    check('image → intakeKind image', rec(db, r3.key).intakeKind, 'image');
  }

  /* Review Focus 5: הודעה שנמחקה / סוג לא מוכר */
  {
    for (const tm of ['deletedMessage', 'someFutureType']) {
      const db = seed(); const m = model('status', '');
      const r = await sh.lgAgentShadowRecord(db, payload('D_' + tm, { typeMessage: tm }), NOW);
      const e0 = rec(db, r.key);
      check(tm + ': recorded with typeMessage and text:\'\'', [e0.typeMessage, e0.text], [tm, '']);
      const res = await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
      check(tm + ': process does not fail, route none, model not called', [res.ok, rec(db, r.key).state, rec(db, r.key).route, m.calls], [true, 'done', 'none', 0]);
    }
  }

  /* המודל נכשל */
  {
    const db = seed(); const m = model('status', '', false, 500);
    const r = await sh.lgAgentShadowRecord(db, payload('E1', textMd('מה עם כהן?')), NOW);
    const res = await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 1, fetchImpl: m.fetchImpl, env: ENV });
    check('model HTTP 500 → unclear, shaul, done', [res.ok, rec(db, r.key).intent, rec(db, r.key).route, rec(db, r.key).state], [true, 'unclear', 'shaul', 'done']);
  }

  /* תור ממתינים */
  {
    const db = seed();
    const a = await sh.lgAgentShadowRecord(db, payload('Z1', textMd('א')), NOW);
    const b = await sh.lgAgentShadowRecord(db, payload('Z2', textMd('ב')), NOW + 5);
    check('pending: both received, oldest first', await sh.lgAgentShadowPending(db, 10, NOW + 10), [a.key, b.key]);
    check('pending: limit 1 → oldest only', await sh.lgAgentShadowPending(db, 1, NOW + 10), [a.key]);
    await sh.lgAgentShadowProcess(db, a.key, { now: NOW + 20, fetchImpl: model('thanks').fetchImpl, env: ENV });
    check('pending: done record is gone', await sh.lgAgentShadowPending(db, 10, NOW + 30), [b.key]);
    check('ignored webhook → null', await sh.lgAgentShadowRecord(db, { typeWebhook: 'stateInstanceChanged' }, NOW), null);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
