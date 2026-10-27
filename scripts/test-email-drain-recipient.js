#!/usr/bin/env node
/**
 * הודעת וואטסאפ שנכנסה לתור **לפני** שהשולח במייל קושר — יוצאת בוואטסאפ (בן, 26/10).
 *
 *   whatsapp-drain פותר את הנמען מחדש בשליחה. אילו השתמש ב-resolveRecipient,
 *   הזמנת מייל שקושרה בינתיים הייתה נפתרת לערוץ 'email' עם phone:'' ונסגרת
 *   "אין מספר טלפון ללקוח" — הלקוח לא היה מקבל כלום באף ערוץ.
 *   לכן ה-drain משתמש ב-resolveRecipientWa: אותה פתירה כמו להזמנה לא מקושרת.
 *
 * Run: node scripts/test-email-drain-recipient.js
 */
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x@y', private_key: 'k' });

let DB = null;
const sent = [];
//  firebase-admin לא מותקן ב-worktree — מחליפים אותו, ואת הספק, ואת בדיקת האדמין
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin/app') return { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) };
  if (req === 'firebase-admin/database') return { getDatabase: () => DB };
  return realLoad.apply(this, arguments);
};
const stub = (file, exports) => { const p = require.resolve(path.join(ROOT, 'api', file)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('_verifyAdmin.js', { verifyAdmin: async () => ({ ok: true, phone: '0500000000' }) });
const realProv = require(path.join(ROOT, 'api', '_wa-provider.js'));
stub('_wa-provider.js', { ...realProv, lgWaProvider: () => ({
  name: 'green', configured: true, globalSlot: false, checksState: false, maxPerRun: 5,
  nextGap: () => 0, gate: () => ({ allowed: true }),
  send: async m => { sent.push(m.to); return { ok: true, messageId: 'w1', httpStatus: 200, detail: '' }; },
}) });

const rcp   = require(path.join(ROOT, 'api', '_wa-recipient.js'));
const ob    = require(path.join(ROOT, 'api', '_wa-outbox.js'));
const drain = require(path.join(ROOT, 'api', 'whatsapp-drain.js'));

const CLIENT = 'client@shop.co.il';
const order = { source: 'email', emailMessageId: 'm1', emailThreadId: 'T1', emailFrom: CLIENT,
                customerId: '3150', orderNum: 'L1', orderClient: 'אגן ברזל' };
const seed = () => fakeDb({
  hashavshevetAccounts: { '3150': { key: '3150', name: 'אגן ברזל', phone: '037436564' } },
  orders: { E1: order },
});
const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

(async () => {
  // ── resolveRecipientWa: תמיד וואטסאפ, גם כשהשולח מקושר ──
  {
    const db = seed();
    db._data.waMeta = { emailSenders: { 'client@shop,co,il': { email: CLIENT, customerId: '3150', customerName: 'אגן ברזל' } } };
    check('W1 resolveRecipient: linked email order -> email (unchanged)', (await rcp.resolveRecipient(db, order, 'ready')).channel, 'email');
    check('W1 resolveRecipientWa: the same order -> WhatsApp, the card phone',
          typeof rcp.resolveRecipientWa === 'function' ? await rcp.resolveRecipientWa(db, order, 'ready') : 'missing',
          { phone: '037436564', source: 'hashavshevet', accountKey: '3150', linked: false, channel: 'whatsapp' });
    const un = seed();
    check('W2 unlinked: resolveRecipientWa equals resolveRecipient',
          typeof rcp.resolveRecipientWa === 'function' ? await rcp.resolveRecipientWa(un, order, 'ready') : 'missing',
          await rcp.resolveRecipient(un, order, 'ready'));
  }

  // ── drain: נכנסה לתור לפני הקישור, קושרה לפני השליחה → יוצאת בוואטסאפ ──
  {
    DB = seed();
    const q = await ob.lgWaEnqueue(DB, { kind: 'ready', to: '037436564', clientName: 'אגן ברזל', orderNums: ['L1'],
                                         sketchNames: [''], orderIds: ['E1'], queuedBy: '050', phoneSource: 'hashavshevet', accountKey: '3150' });
    check('D0 queued while unlinked', q.queued, true);
    DB._data.waMeta = { ...(DB._data.waMeta || {}), emailSenders: { 'client@shop,co,il': { email: CLIENT, customerId: '3150', customerName: 'אגן ברזל' } } };
    const r = res();
    await drain({ method: 'POST', headers: {}, body: {} }, r);
    check('D1 the queued WhatsApp message still goes out by WhatsApp', [r.statusCode, sent], [200, ['037436564']]);
    check('D1 not closed as "no phone"', (r.body.results || []).map(x => [x.status, x.reason || null]), [['sent', null]]);
  }

  Module._load = realLoad;
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
