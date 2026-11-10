#!/usr/bin/env node
/**
 * מרכזן — "<N> סקיצות נקלטו." ללקוח (בן, 10/11).
 * אפיון: docs/superpowers/specs/2026-11-10-markazan-intake-ack-design.md §1
 *
 *   A. הנוסח — יחיד / רבים, אותה מעטפת כמו שאר ההודעות, בלי רשימת שמות
 *   B. החותמת על ההזמנה — intakeAck, לא דורסת "מוכן לאיסוף" / "טופלו"
 *   C. חדר הסוכנים — lgRoomPost כותב אירוע ל-waMeta/agentRoom
 *   D. וואטסאפ: כל תמונה מאריכה את ההמתנה (2 דקות אחרי האחרונה), הודעה אחת לסבב,
 *      רק לצ'אט מקושר, רק כשהמתג דולק
 *   E. השעון — outbox-claim של סקריפט ה-Gmail (כל דקה) מוציא את מה שהגיע זמנו
 *   F. מייל — מייל אחד = סבב אחד; לא לאביבי (הזמנת רכש) ולא כש"טופלו" כבר יצא לבד
 *
 * Run: node scripts/test-intake-ack.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};

const GREEN = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }),
  WA_PROVIDER: 'green', GREENAPI_ID_INSTANCE: '1', GREENAPI_TOKEN: 't',
  GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:14201', GREENAPI_ONLY_TO: '', INTAKE_ACK_ENABLED: 'true' };

const NOW = 1762790000000;
const GROUP = '120363000000000001@g.us';
const waOrder = (id, extra) => ({ id, refNum: 'L' + id.slice(-3), orderNum: 'L' + id.slice(-3), orderClient: 'המקום לאמבט',
  customerId: '14201', source: 'whatsapp', waMessageId: 'M' + id, waGroup: GROUP, stage: '', hasSketch: true, createdAt: NOW, ...(extra || {}) });

(async () => {

// ═══ A. הנוסח ════════════════════════════════════════════════════════
{
  const { renderText } = require(path.join(ROOT, 'api', '_wa-provider.js'));
  const many = renderText({ kind: 'sketches-received', clientName: 'המקום לאמבט', orderNums: ['L1', 'L2', 'L3'],
                            sketchNames: ['מקלחת הורים', 'x', 'y'] });
  check('A1 several: exactly Ben\'s words, wrapped like every message',
        many, 'שלום המקום לאמבט,\n\n3 סקיצות נקלטו.\n\nלוז זגגות ומראות האחים בע"מ');
  const one = renderText({ kind: 'sketches-received', clientName: 'X', orderNums: ['L1'] });
  check('A2 one: singular', one, 'שלום X,\n\nסקיצה אחת נקלטה.\n\nלוז זגגות ומראות האחים בע"מ');
  check('A3 never falls through to "ready for pickup"', /מוכנ/.test(many + one), false);
}

// ═══ B. החותמת ═══════════════════════════════════════════════════════
{
  const ob = require(path.join(ROOT, 'api', '_wa-outbox.js'));
  check('B1 sketches-received stamps intakeAck', ob.lgWaStampField('sketches-received'), 'intakeAck');
  check('B2 a different message from "handled"', ob.lgWaMsgKey('sketches-received', ['a']) !== ob.lgWaMsgKey('sketches-handled', ['a']), true);
}

// ═══ C. חדר הסוכנים ══════════════════════════════════════════════════
{
  const { lgRoomPost } = require(path.join(ROOT, 'api', '_agent-room.js'));
  const db = fakeDb({});
  const k1 = await lgRoomPost(db, { agent: 'מרכזן', kind: 'info', text: 'נשלח ל-X: 2 סקיצות נקלטו', ref: 'wa_1' }, NOW);
  const k2 = await lgRoomPost(db, { agent: 'מרכזן', kind: 'weird', text: 'שאלה' }, NOW);
  const room = db._data.waMeta.agentRoom;
  check('C1 one event per post, under its own key', [typeof k1, k1 !== k2, Object.keys(room).length], ['string', true, 2]);
  check('C2 the event', room[k1], { at: NOW, agent: 'מרכזן', kind: 'info', text: 'נשלח ל-X: 2 סקיצות נקלטו', ref: 'wa_1' });
  check('C3 unknown kind → info, no ref → null', [room[k2].kind, room[k2].ref], ['info', null]);
  check('C4 keys sort by time', [k1, k2].sort()[0] <= [k1, k2].sort()[1], true);
  const bad = { ref() { throw new Error('down'); } };
  check('C5 never throws (the room is a log, not the work)', await lgRoomPost(bad, { agent: 'a', text: 't' }, NOW), null);
}

const IA = require(path.join(ROOT, 'api', '_intake-ack.js'));
const seed = extra => fakeDb({
  waGroups: { [GROUP.replace(/[.#$[\]/]/g, '_')]: { customerId: '14201', customerName: 'המקום לאמבט' } },
  waSenders: { '0501234567': { customerId: '9117', customerName: 'נאור' } },
  orders: {}, ...(extra || {}),
});
const put = (db, o) => { db._data.orders[o.id] = o; };
const outbox = db => Object.entries(db._data.waOutbox || {}).map(([k, v]) => ({ key: k, ...v }));

// ═══ D. וואטסאפ — סבב ════════════════════════════════════════════════
await withEnv(GREEN, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'), b = waOrder('wa_b_1'), c = waOrder('wa_c_1');
  [a, b, c].forEach(o => put(db, o));
  const n1 = await IA.lgIntakeAckNote(db, a, NOW);
  const n2 = await IA.lgIntakeAckNote(db, b, NOW + 30000);
  const key = IA.lgIntakeAckChatKey(a);
  const rec = db._data.waMeta.intakeAcks[key];
  check('D1 noted', [n1.noted, n2.noted], [true, true]);
  check('D2 one record per chat, both images', [Object.keys(db._data.waMeta.intakeAcks).length, rec.orderIds, rec.count], [1, ['wa_a_1', 'wa_b_1'], 2]);
  check('D3 the wait restarts from the last image', [rec.firstAt, rec.lastAt, rec.dueAt], [NOW, NOW + 30000, NOW + 30000 + 120000]);
  check('D4 the card is kept', rec.customerId, '14201');
  await IA.lgIntakeAckNote(db, b, NOW + 31000);
  check('D5 the same image twice is counted once (and still extends the wait)', [db._data.waMeta.intakeAcks[key].count, db._data.waMeta.intakeAcks[key].dueAt], [2, NOW + 31000 + 120000]);

  const drained = [];
  const deps = { drain: async (d, keys, by) => { drained.push([keys, by]); return { results: [] }; } };
  const early = await IA.lgIntakeAckFlush(db, NOW + 60000, deps);
  check('D6 before the wait is over — nothing', [early.queued.length, outbox(db).length], [0, 0]);

  const f = await IA.lgIntakeAckFlush(db, NOW + 31000 + 120000, deps);
  const q = outbox(db);
  check('D7 one message for the batch', [f.queued.length, q.length], [1, 1]);
  check('D8 kind / to / count', [q[0].kind, q[0].to, q[0].orderNums.length], ['sketches-received', GROUP, 2]);
  check('D9 the batch record is gone', (db._data.waMeta.intakeAcks || {})[key], undefined);
  check('D10 sent right away through the regular drain', drained, [[[q[0].key], 'markazan']]);
  const room = Object.values(db._data.waMeta.agentRoom || {});
  check('D11 the room hears about it', room.map(r => [r.agent, r.text]), [['מרכזן', 'נשלח להמקום לאמבט: 2 סקיצות נקלטו']]);
  const again = await IA.lgIntakeAckFlush(db, NOW + 400000, deps);
  check('D12 never twice', [again.queued.length, outbox(db).length], [0, 1]);

  //  a later image starts a new batch
  await IA.lgIntakeAckNote(db, c, NOW + 500000);
  await IA.lgIntakeAckFlush(db, NOW + 500000 + 120000, deps);
  check('D13 a new image after the message → a new batch, one more message', outbox(db).length, 2);
});

await withEnv(GREEN, async () => {
  //  merged as an attachment before the message left — still counted, not looked up
  const db = seed();
  const a = waOrder('wa_a_1'), b = waOrder('wa_b_1');
  [a, b].forEach(o => put(db, o));
  await IA.lgIntakeAckNote(db, a, NOW);
  await IA.lgIntakeAckNote(db, b, NOW + 1000);
  delete db._data.orders.wa_a_1;
  await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
  const q = outbox(db);
  check('D14 N counts only orders that still exist (merged / deleted ones drop out)', (q[0] || {}).orderNums, ['Lb_1']);
  check('D15 but only existing orders are stamped', (q[0] || {}).orderIds, ['wa_b_1']);
});

await withEnv(GREEN, async () => {
  const db = seed();
  //  unlinked private number — nothing
  const u = { ...waOrder('wa_u_1'), waGroup: '', customerId: '', waChat: '' };
  put(db, u);
  check('D16 unlinked sender → nothing', (await IA.lgIntakeAckNote(db, u, NOW)).noted, false);
  //  linked private number → keyed by the number
  const p = { ...waOrder('wa_p_1'), waGroup: '', customerId: '9117', waChat: '0501234567' };
  put(db, p);
  check('D17 linked private number → noted', (await IA.lgIntakeAckNote(db, p, NOW)).noted, true);
  check('D17 keyed by the number', Object.keys(db._data.waMeta.intakeAcks), [IA.lgIntakeAckChatKey(p)]);
  //  text message order — not a sketch image
  const t = waOrder('wa_t_1', { waText: true });
  check('D18 a text-message order is not counted', (await IA.lgIntakeAckNote(db, t, NOW)).noted, false);
  //  a test order
  check('D19 a test order → nothing', (await IA.lgIntakeAckNote(db, waOrder('wa_x_1', { isTest: true }), NOW)).noted, false);
});

await withEnv({ ...GREEN, INTAKE_ACK_ENABLED: undefined }, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'); put(db, a);
  check('D20 switch off → nothing noted', (await IA.lgIntakeAckNote(db, a, NOW)).noted, false);
  check('D20 nothing written', db._data.waMeta, undefined);
});

await withEnv(GREEN, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'); put(db, a);
  await IA.lgIntakeAckNote(db, a, NOW);
  await withEnv({ INTAKE_ACK_ENABLED: 'false' }, async () => {
    const f = await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
    check('D21 switched off while waiting → nothing sent', [f.queued.length, outbox(db).length], [0, 0]);
  });
  //  Meta cannot send this text (its template is "ready for pickup")
  await withEnv({ WA_PROVIDER: 'meta' }, async () => {
    await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
    check('D22 not GREEN API → not queued (Meta would send the pickup template)', outbox(db).length, 0);
  });
});

await withEnv(GREEN, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'); put(db, a);
  await IA.lgIntakeAckNote(db, a, NOW);
  //  the clock (Gmail script) was down for an hour — a late "received" is noise
  const f = await IA.lgIntakeAckFlush(db, NOW + 60 * 60000, { drain: async () => ({}) });
  check('D23 stale batch dropped, not sent', [f.queued.length, f.dropped, outbox(db).length, (db._data.waMeta.intakeAcks || {})], [0, 1, 0, {}]);
});

await withEnv(GREEN, async () => {
  //  the group was unlinked between the image and the message
  const db = seed();
  const a = waOrder('wa_a_1'); put(db, a);
  await IA.lgIntakeAckNote(db, a, NOW);
  db._data.waGroups = {};
  await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
  check('D24 unlinked since → nothing', outbox(db).length, 0);
});

// ═══ E. השעון — outbox-claim של סקריפט ה-Gmail ═══════════════════════
await withEnv({ ...GREEN, EMAIL_INBOUND_TOKEN: 'mail-secret' }, async () => {
  const route = require(path.join(ROOT, 'api', 'email-inbound.js'));
  const db = seed();
  const a = waOrder('wa_a_1'); put(db, a);
  await IA.lgIntakeAckNote(db, a, NOW);
  const waits = [];
  const drained = [];
  const r = await route.handleEmailInbound({ method: 'POST', headers: { authorization: 'Bearer mail-secret' }, body: { op: 'outbox-claim' } },
    { db, now: NOW + 200000, waitUntil: p => waits.push(p), drain: async (d, keys) => { drained.push(keys); return {}; } });
  check('E1 the script still gets its answer', [r.status, r.body.ok, Array.isArray(r.body.items)], [200, true, true]);
  await Promise.all(waits);
  check('E2 the due WhatsApp ack went out in the background', [outbox(db).length, drained.length], [1, 1]);
});

await withEnv({ ...GREEN, EMAIL_INBOUND_TOKEN: 'mail-secret', INTAKE_ACK_ENABLED: undefined }, async () => {
  const route = require(path.join(ROOT, 'api', 'email-inbound.js'));
  const db = seed();
  const waits = [];
  await route.handleEmailInbound({ method: 'POST', headers: { authorization: 'Bearer mail-secret' }, body: { op: 'outbox-claim' } },
    { db, now: NOW, waitUntil: p => waits.push(p), drain: async () => ({}) });
  check('E3 switch off → the claim does nothing extra', waits.length, 0);
});

// ═══ F. מייל ═════════════════════════════════════════════════════════
const emSeed = (linked) => fakeDb({
  hashavshevetAccounts: { '07': { key: '07', name: 'פלג מקלחונים', email: 'dana@client.co.il' } },
  waMeta: linked ? { emailSenders: { 'dana@client,co,il': { email: 'dana@client.co.il', customerId: '07', customerName: 'פלג מקלחונים' } } } : {},
  orders: {},
});
const emOrder = (id, n, extra) => ({ id, refNum: 'L50-' + n, orderNum: 'L50-' + n, orderClient: 'פלג מקלחונים', customerId: '07',
  source: 'email', emailMessageId: 'MSG1', emailThreadId: 'T1', emailFrom: 'dana@client.co.il', emailReceivedAt: NOW,
  stage: '', hasSketch: true, createdAt: NOW, ...(extra || {}) });
const emq = db => Object.values((db._data.waMeta || {}).emailOutbox || {});

// בן, 10/11: במייל לא משתנה כלום בינתיים — הודעה אחת כמו היום (פלג). "נקלטו" במייל רק עם מתג משלו.
await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: undefined, EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const db = emSeed(true);
  put(db, emOrder('em_off_1', 1));
  check('F0 email ack off unless its own switch is on', [(await IA.lgIntakeAckEmail(db, ['em_off_1'], NOW, {})).reason, emq(db).length], ['off', 0]);
});

await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const db = emSeed(true);
  ['em_x_1', 'em_x_2'].forEach((id, i) => put(db, emOrder(id, i + 1)));
  const r = await IA.lgIntakeAckEmail(db, ['em_x_1', 'em_x_2'], NOW, {});
  const q = emq(db);
  check('F1 one reply for the email', [r.queued, q.length], [true, 1]);
  check('F2 kind, thread, count, wait', [q[0].kind, q[0].thread, q[0].messageId, q[0].orderNums.length, q[0].notBefore],
    ['sketches-received', 'T1', 'MSG1', 2, NOW + IA.INTAKE_ACK_EMAIL_DELAY_MS]);
  const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
  const items = await ob.lgEmailClaim(db, 5, NOW + IA.INTAKE_ACK_EMAIL_DELAY_MS + 1);
  check('F3 the text the script sends', (items[0] || {}).text, 'שלום פלג מקלחונים,\n\n2 סקיצות נקלטו.\n\nלוז זגגות ומראות האחים בע"מ');
  check('F3 no archive with it (that waits for "handled")', (items[0] || {}).doneMails, undefined);
  const room = Object.values(db._data.waMeta.agentRoom || {});
  check('F4 the room hears about it', room.map(x => x.text), ['נשלח לפלג מקלחונים: 2 סקיצות נקלטו']);
  check('F5 the same email again → no second reply', (await IA.lgIntakeAckEmail(db, ['em_x_1', 'em_x_2'], NOW, {})).queued, false);
});

await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const db = emSeed(true);
  put(db, emOrder('em_y_1', 1));
  check('F6 "handled" already went out on its own → no "received" too',
        [(await IA.lgIntakeAckEmail(db, ['em_y_1'], NOW, { ackedByAuto: true })).queued, emq(db).length], [false, 0]);
  put(db, emOrder('em_z_1', 1, { customerId: '450', poSupplier: 'avivi', emailMessageId: 'MSG2' }));
  check('F7 Avivi purchase order → nothing extra', [(await IA.lgIntakeAckEmail(db, ['em_z_1'], NOW, {})).queued, emq(db).length], [false, 0]);
});

await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const db = emSeed(false);
  put(db, emOrder('em_u_1', 1));
  check('F8 address not linked → nothing', [(await IA.lgIntakeAckEmail(db, ['em_u_1'], NOW, {})).queued, emq(db).length], [false, 0]);
});

await withEnv({ INTAKE_ACK_ENABLED: undefined, EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const db = emSeed(true);
  put(db, emOrder('em_v_1', 1));
  check('F9 switch off → nothing', [(await IA.lgIntakeAckEmail(db, ['em_v_1'], NOW, {})).queued, emq(db).length], [false, 0]);
});

// ═══ G. מחובר לקליטה ═════════════════════════════════════════════════
{
  //  וואטסאפ: תמונה מקבוצה מקושרת שעברה את הקליטה → נרשמה לסבב
  const inb = require(path.join(ROOT, 'api', '_wa-inbound.js'));
  const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                              Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
  const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                                 arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
  const hookBody = id => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: 1759650000,
    idMessage: id, senderData: { chatId: GROUP, sender: '972521112222@c.us', chatName: 'הזמנות' },
    messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/g.jpg', caption: '', mimeType: 'image/jpeg' } } });
  const run = async (env) => withEnv({ ...GREEN, ...env }, async () => {
    const db = seed({ meta: { orderCounter: 1041 }, hashavshevetAccounts: { '14201': { key: '14201', name: 'המקום לאמבט' } } });
    for (const id of ['G1', 'G2']) {
      const p = inb.lgWaInboundParse(hookBody(id));
      await inb.lgWaInboundRecord(db, p.entry, NOW);
      await inb.lgWaInboundProcess(db, inb.lgWaInboundKey(id), { by: 'test', fetchImpl: okFetch, now: NOW });
    }
    return db;
  });
  const on = await run({});
  const rec = Object.values((on._data.waMeta || {}).intakeAcks || {});
  check('G1 two images from a linked group → one batch with both', rec.map(r => r.orderIds), [['wa_G1_1', 'wa_G2_1']]);
  const off = await run({ INTAKE_ACK_ENABLED: undefined });
  check('G2 switch off → the intake does not touch it', (off._data.waMeta || {}).intakeAcks, undefined);
}
await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  //  מייל: נכנס לקליטה; ענה רק כש"טופלו" לא יצא לבד
  const em = require(path.join(ROOT, 'api', '_email-inbound.js'));
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 7)]);
  const receive = async (db, messageId, files) => {
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      await em.lgEmailPutChunk(db, { messageId, idx: i, chunk: 0, chunks: 1, data: files[i].toString('base64') });
      parts.push({ idx: i, name: 's' + i + (i ? '.heic' : '.png'), mime: i ? 'image/heic' : 'image/png', size: files[i].length, chunks: 1 });
    }
    return em.lgEmailCommit(db, { messageId, threadId: 'T-' + messageId, from: 'dana@client.co.il', subject: 'הזמנה', date: NOW - 5000, parts },
                            { by: 'gmail-script', now: NOW });
  };
  const kinds = db => emq(db).map(x => x.kind).sort();
  const a = emSeed(true); a._data.meta = { orderCounter: 1041 };
  const r1 = await receive(a, 'M1', [PNG]);
  check('G3 linked + handled on its own → only "handled", no "received"', [r1.autoHandled, kinds(a)], [true, ['sketches-handled']]);
  const b = emSeed(true); b._data.meta = { orderCounter: 1041 };
  //  a file that could not be read → left for Ben (no automatic "handled") → "received" goes out
  const r2 = await receive(b, 'M2', [PNG, Buffer.from('not an image')]);
  check('G4 left for Ben → "received" queued for the email', [!!r2.autoHandled, kinds(b)], [false, ['sketches-received']]);
  check('G4 counting the one sketch', (emq(b)[0] || {}).orderNums, [(b._data.orders[r2.orderIds[0]] || {}).orderNum]);
});

// ═══ H. לא "נקלטו" אחרי שכבר טופלו (סקירה 10/11) ══════════════════════
await withEnv(GREEN, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'), b = waOrder('wa_b_1');
  [a, b].forEach(o => put(db, o));
  await IA.lgIntakeAckNote(db, a, NOW);
  await IA.lgIntakeAckNote(db, b, NOW + 1000);
  db._data.orders.wa_a_1.sketchSeenAt = NOW + 2000;
  db._data.orders.wa_b_1.sketchAck = { sentAt: NOW + 3000 };
  const f = await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
  check('H1 every order already seen / acked → nothing sent', [f.queued.length, outbox(db).length], [0, 0]);
  check('H1 the record is dropped, with the reason', [(db._data.waMeta.intakeAcks || {})[IA.lgIntakeAckChatKey(a)], f.skipped.map(x => x.reason)], [undefined, ['handled']]);
});
await withEnv(GREEN, async () => {
  const db = seed();
  const a = waOrder('wa_a_1'), b = waOrder('wa_b_1'), c = waOrder('wa_c_1');
  [a, b, c].forEach(o => put(db, o));
  for (const o of [a, b, c]) await IA.lgIntakeAckNote(db, o, NOW);
  db._data.orders.wa_a_1.sketchSeenAt = NOW + 2000;
  delete db._data.orders.wa_c_1;
  await IA.lgIntakeAckFlush(db, NOW + 200000, { drain: async () => ({}) });
  const q = outbox(db);
  check('H2 one still waiting → sent; the deleted one is not counted', [q.length, (q[0] || {}).orderNums], [1, ['La_1', 'Lb_1']]);
});
await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
  const db = emSeed(true);
  ['em_h_1', 'em_h_2'].forEach((id, i) => put(db, emOrder(id, i + 1)));
  await IA.lgIntakeAckEmail(db, ['em_h_1', 'em_h_2'], NOW, {});
  db._data.orders.em_h_1.sketchSeenAt = NOW + 1;
  db._data.orders.em_h_2.sketchAck = { sentAt: NOW + 2 };
  const items = await ob.lgEmailClaim(db, 5, NOW + IA.INTAKE_ACK_EMAIL_DELAY_MS + 1);
  const row = emq(db)[0] || {};
  check('H3 email: all handled before the claim → not sent, cancelled with a reason',
        [items.length, row.state, /טופלו/.test(String(row.lastError || ''))], [0, 'cancelled', true]);
});
await withEnv({ INTAKE_ACK_ENABLED: 'true', INTAKE_ACK_EMAIL_ENABLED: 'true', EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
  const db = emSeed(true);
  ['em_i_1', 'em_i_2', 'em_i_3'].forEach((id, i) => put(db, emOrder(id, i + 1)));
  await IA.lgIntakeAckEmail(db, ['em_i_1', 'em_i_2', 'em_i_3'], NOW, {});
  db._data.orders.em_i_1.sketchSeenAt = NOW + 1;
  delete db._data.orders.em_i_3;
  const items = await ob.lgEmailClaim(db, 5, NOW + IA.INTAKE_ACK_EMAIL_DELAY_MS + 1);
  check('H4 email: one still waiting → sent, the deleted one not counted', [items.length, (items[0] || {}).text],
        [1, 'שלום פלג מקלחונים,\n\n2 סקיצות נקלטו.\n\nלוז זגגות ומראות האחים בע"מ']);
  const db2 = emSeed(true);
  put(db2, emOrder('em_j_1', 1));
  await IA.lgIntakeAckEmail(db2, ['em_j_1'], NOW, {});
  delete db2._data.orders.em_j_1;
  const none = await ob.lgEmailClaim(db2, 5, NOW + IA.INTAKE_ACK_EMAIL_DELAY_MS + 1);
  check('H5 email: every order gone → cancelled', [none.length, (emq(db2)[0] || {}).state], [0, 'cancelled']);
});

// ═══ I. תפוגה בתור הוואטסאפ — "נקלטו" בן חצי שעה לא יוצא ══════════════
{
  const ob = require(path.join(ROOT, 'api', '_wa-outbox.js'));
  const t = Date.now();
  const row = (kind, ageMin) => ({ kind, to: GROUP, orderIds: ['x'], orderNums: ['L1'], state: 'pending', attempts: 0,
                                   createdAt: t - ageMin * 60000, updatedAt: t - ageMin * 60000, claimedAt: null });
  const db = fakeDb({ waOutbox: { old: row('sketches-received', 31), fresh: row('sketches-received', 10), ready: row('dispatched', 31) } });
  const o = await ob.lgWaClaim(db, 'old', 'test');
  check('I1 sketches-received older than 30 minutes → expired, not claimed',
        [o.claimed, db._data.waOutbox.old.state, !!db._data.waOutbox.old.lastError], [false, 'expired', true]);
  check('I2 a fresh one is still claimed', (await ob.lgWaClaim(db, 'fresh', 'test')).claimed, true);
  check('I3 other kinds keep the 24h limit', (await ob.lgWaClaim(db, 'ready', 'test')).claimed, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll intake-ack checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
