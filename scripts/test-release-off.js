#!/usr/bin/env node
/**
 * שחרור "הכל כבוי" (בן, 11/11): פרודקשן בלי waMeta/agentConfig, AGENT_SHADOW_ENABLED='true',
 * AGENT_REPLY_ENABLED / INTAKE_ACK_ENABLED / ATTACH_SUGGEST_ENABLED לא מוגדרים.
 * בתנאים האלה הענף הזה מוסיף רק: שורות אפורות בחדר מפעולות שבן עצמו לוחץ (שרטט שלח/סיים/החזק,
 * בדיקת סנכרון, צירוף/הפרדת צרופה), את שמירת הדופק, ואת שורת המצב של הכלי במשרד.
 * כאן: קליטת תמונה+טקסט מלאה בוואטסאפ, שאלת סטטוס (עוקב), חשבוניות של חודש (ארכיון),
 * שליחה לחשבשבת עם פער מחיר, ודופק עם חשבונית שהשליחה שלה נכשלה —
 * בלי אף רשומה ב-waOutbox / agentOutbox / emailOutbox, בלי שדות חדשים על הזמנות, ובלי שורות בחדר.
 * Run:  node scripts/test-release-off.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const PC = require(path.join(ROOT, 'api', '_agent-price-check.js'));
const { handleUpload } = require(path.join(ROOT, 'api', '_invoice-upload.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 11, 8, 0);     // רביעי 11/11 10:00 בישראל — שעות עבודה
const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const CHAT = '972501234567@c.us';
const ENV = {
  AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: undefined, INTAKE_ACK_ENABLED: undefined, ATTACH_SUGGEST_ENABLED: undefined,
  AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs', GREENAPI_ID_INSTANCE: '7100',
  GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0501234567', INVOICE_UPLOAD_TOKEN: 'tok',
};
const withEnv = async fn => {
  const keep = {};
  for (const k of Object.keys(ENV)) { keep[k] = process.env[k]; if (ENV[k] === undefined) delete process.env[k]; else process.env[k] = ENV[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(ENV)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const calls = [];
//  תמונה מ-Green API; כל קריאה אחרת — "המודל": סטטוס / חשבוניות / הזמנה לפי הטקסט
const fetchImpl = async (url, init) => {
  calls.push(String(url));
  if (/green-api/.test(String(url))) {
    return { ok: true, status: 200, headers: { get: () => String(JPEG.length) },
             arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) };
  }
  const b = String((init && init.body) || '');
  const out = /מוכנה/.test(b) ? { intent: 'status', ref: 'L1001' } : /חשבוניות/.test(b) ? { intent: 'document', ref: 'אוקטובר' } : { intent: 'order', ref: '' };
  return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) };
};
const body = (id, md, ts) => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: (ts || NOW) / 1000,
  idMessage: id, senderData: { chatId: CHAT, sender: CHAT, senderName: 'כהן' }, messageData: md });
const img = id => body(id, { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/p.jpg', caption: '', mimeType: 'image/jpeg' } });
const txt = (id, t, ts) => body(id, { typeMessage: 'textMessage', textMessageData: { textMessage: t } }, ts);
const send = (db, b, now) => withEnv(async () => {
  const later = [];
  const r = await hook.handleInbound({ method: 'POST', headers: { authorization: 'Bearer hs' }, body: b },
    { db, waitUntil: p => later.push(p), now, fetchImpl });
  await Promise.all(later);
  return r;
});

const inv = (doc, date, extra) => ({ state: 'ready', docNumber: doc, date, accountKey: '777', createdAt: NOW - 2 * H, orderIds: [], ...(extra || {}) });
const db = fakeDb({
  meta: { orderCounter: 1200 },
  users: { u1: { customerId: '777', phone: '0501234567' } },
  hashavshevetAccounts: { 777: { key: '777', name: 'כהן זכוכית', phone: '501234567' } },
  waSenders: { '0501234567': { phone: '0501234567', customerId: '777', customerName: 'כהן זכוכית', linkedAt: NOW - DAY, linkedBy: 'ben' } },
  orders: {
    o1: { id: 'o1', customerId: '777', orderNum: 'L1001', orderClient: 'כהן זכוכית', sketchName: 'מטבח', stage: 'workday', createdAt: NOW - 3 * DAY, optyAt: NOW - 2 * H },
    o2: { id: 'o2', customerId: '777', orderNum: 'L1002', orderClient: 'כהן זכוכית', stage: 'workday', createdAt: NOW - 40 * DAY, optyAt: NOW - 39 * DAY },
  },
  invoicePdf: {
    a1: inv(1001, '2026-10-02'), a2: inv(1002, '2026-10-20'),
    //  חשבונית שהשליחה שלה ללקוח נכשלה (הדופק היה מנסה שוב רק ב"עונה")
    f1: inv(1003, '2026-11-10', { delivery: { state: 'failed', at: NOW - 30 * MIN, channel: 'wa', outboxKey: 'ob1' } }),
    p1: { state: 'printed', docNumber: 1004, date: '2026-11-11', accountKey: '777', createdAt: NOW - 3 * H },
  },
  waOutbox: { ob1: { state: 'failed', to: CHAT } },
  waMeta: { agentPilot: { 777: true } },
});
const outboxes = () => [Object.keys(db._data.waOutbox || {}).filter(k => k !== 'ob1').length,
  Object.keys((db._data.waMeta || {}).agentOutbox || {}).length, Object.keys((db._data.waMeta || {}).emailOutbox || {}).length];
const roomRows = () => Object.values((db._data.waMeta || {}).agentRoom || {});
const BEFORE_ORDERS = JSON.stringify({ o1: db._data.orders.o1, o2: db._data.orders.o2 });
//  שדות שהענף הזה הוסיף על הזמנות — אף אחד מהם לא נכתב בלי הגדרות
const NEW_FIELDS = ['sampleSuspect', 'sampleSuspectAt', 'sampleText', 'sampleRoomKey', 'isSample', 'sampleDecision'];

(async () => {
  /* ── קליטה מלאה: תמונה ואז "כזאת" ── */
  await send(db, img('I1'), NOW);
  await send(db, txt('T1', 'צריבה כזאת', NOW + MIN), NOW + MIN);
  const created = Object.entries(db._data.orders).filter(([k]) => !['o1', 'o2'].includes(k));
  check('intake: the image became one order in the queue (as before)', created.map(([, o]) => [o.stage, o.customerId]), [['', '777']]);
  check('intake: no new branch fields on the order', created.map(([, o]) => NEW_FIELDS.filter(f => f in o)), [[]]);
  check('intake: no sample mark on the inbound record', Object.values(db._data.waInbound || {}).some(r => r && r.sampleSuspect), false);

  /* ── שאלת סטטוס (עוקב) + חשבוניות של חודש (ארכיון) ── */
  await send(db, txt('T2', 'מתי ההזמנה L1001 מוכנה?', NOW + 2 * MIN), NOW + 2 * MIN);
  await send(db, txt('T3', 'תשלח לי את כל החשבוניות של אוקטובר', NOW + 3 * MIN), NOW + 3 * MIN);
  check('okev/archive: the model was asked (shadow is on)', calls.filter(u => !/green-api/.test(u)).length > 0, true);

  /* ── שליחה לחשבשבת עם פער מחיר (כמו hashavshevet-order אחרי שליחה שהתקבלה) ── */
  await withEnv(() => PC.lgPriceCheckRun(db, { orderId: 'o1', order: db._data.orders.o1, accountKey: '777',
    preview: [{ name: '8 שקוף', sku: 'G8', ppm2: 190, hsLine: 1 }],
    prices: { clients: { 777: { G8: 171 } }, clientKeys: { 777: 'כהן זכוכית' } }, now: NOW + 4 * MIN }));

  /* ── דופק מהכלי במשרד, עם חשבונית שהשליחה שלה נכשלה ── */
  let delivered = 0;
  const hb = await withEnv(() => handleUpload({ method: 'POST', headers: { authorization: 'Bearer tok' },
    body: { op: 'heartbeat', pc: 'OFFICE', pending: [{ name: 'x.pdf', ageSec: 4000 }], lastPrintError: 'paper', version: '1' } },
    { db, env: process.env, now: NOW + 5 * MIN, deliver: async () => { delivered++; } }));
  check('heartbeat: answered 200 and stored', [hb.status, !!db._data.waMeta.invoiceWatcher.OFFICE], [200, true]);
  check('heartbeat: no delivery retry', delivered, 0);

  /* ── הסיכום ── */
  check('no outbox entries (waOutbox / agentOutbox / emailOutbox)', outboxes(), [0, 0, 0]);
  check('existing orders untouched', JSON.stringify({ o1: db._data.orders.o1, o2: db._data.orders.o2 }), BEFORE_ORDERS);
  check('no room rows', roomRows().map(r => [r.agent, r.kind, r.text]), []);
  check('no price-check claim', !!(db._data.waMeta.agentPriceChecked), false);
  check('no orders scan / stats / morning', [!!db._data.waMeta.agentStats, !!db._data.waMeta.agentRoomMorning], [false, false]);

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
