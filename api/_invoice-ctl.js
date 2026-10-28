// ═══════════════════════════════════════════════════════════════════
//  POST /api/invoice-ctl — בקרה על חשבוניות מודפסות (DB-00004).
//  (rewrite אל wa-inbound?invoice=ctl — מגבלת 12 הפונקציות)
//
//  גוף: { action, ... } ו-Authorization: Bearer <Firebase ID token>.
//    register  (אדמין)  { orderIds[], docNumber } — "החשבונית הופקה" בתחנה.
//                       מקשר את ההזמנות לרשומה; אם ההדפסה כבר הגיעה — משייך אותה.
//    list      (אדמין)  { fromMs } — רשומות מאז התאריך (בלי טקסט ובלי קבצים).
//    pdf       (אדמין, או לקוח שכל ההזמנות בחשבונית שלו) { key } — המקור בלבד.
//
//  ⚠️ ההעתק לעולם לא יוצא מכאן. invoicePdfBlobs סגור לדפדפן, ורק הפעולה
//  `pdf` קוראת ממנו, ורק את השדה original.
//
//  הסדר לא משנה: הדפסה לפני רישום נשמרת כ-'printed' (_invoice-upload),
//  רישום לפני הדפסה יוצר 'awaiting'. מי שמגיע שני משייך.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const M = require('./_invoice-match');
const S = require('./_invoice-send');

const _fail = (status, code) => ({ status, body: { ok: false, code } });
const _phone = s => String(s || '').replace(/[-\s]/g, '');

const pdfKeyFor = orderIds => crypto.createHash('sha1')
  .update('invoicePdf|' + [...orderIds].map(String).sort().join(',')).digest('hex').slice(0, 20);

//  awaiting → ready. מחזיר { ok, rec } או { ok:false } אם כבר טופלה.
//  הקבצים נכתבים אחרי המעבר, והקישור להזמנות (שהפורטל מסתמך עליו) אחרון.
async function promote(db, key, d, now) {
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    if (!cur || cur.state !== 'awaiting') return;
    return { ...cur, state: 'ready', docNumber: d.docNumber, date: d.date,
      archivePath: S.lgInvoiceArchivePath(d.date, cur.client, d.docNumber),
      originalHash: d.hash, uploadedAt: now, sendAfter: S.lgInvoiceSendAfter(now),
      sendKey: S.lgInvoiceSendKey(cur.clientPhone || cur.client, d.docNumber) };
  });
  if (!tx.committed) return { ok: false };
  await db.ref('invoicePdfBlobs/' + key).set({
    original: d.orig.toString('base64'), copy: d.copy.toString('base64') });
  const rec = tx.snapshot.val();
  const upd = {};
  (rec.orderIds || []).forEach(id => { upd['orders/' + id + '/invoicePdfKey'] = key; });
  await db.ref().update(upd);
  return { ok: true, rec };
}

//  רישום "החשבונית הופקה". best-effort מצד הקורא: כישלון כאן לא מבטל סימון.
async function register(db, { orderIds, docNumber }, now) {
  const ids = [...new Set((orderIds || []).map(String))].filter(Boolean);
  if (!ids.length) return _fail(400, 'no-orders');
  if (!/^\d{4,9}$/.test(String(docNumber || ''))) return _fail(400, 'bad-docnumber');

  const orders = [];
  for (const id of ids) {
    const o = (await db.ref('orders/' + id).once('value')).val();
    if (!o) return _fail(404, 'order-missing');
    orders.push(o);
  }
  const phones = new Set(orders.map(o => _phone(o.clientPhone)));
  if (phones.size !== 1 || phones.has('')) return _fail(422, 'mixed-clients');

  const key = pdfKeyFor(ids);
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    if (cur && cur.state !== 'awaiting') return;
    return { ...(cur || {}), state: 'awaiting', docNumber: String(docNumber),
      createdAt: (cur && cur.createdAt) || now,
      client: (cur && cur.client) || orders[0].orderClient || orders[0].clientName || '',
      clientPhone: _phone(orders[0].clientPhone), orderIds: ids,
      orderNums: orders.map(o => String(o.orderNum || o.id)),
      sketchNames: orders.map(o => String(o.sketchName || o.type || o.desc || '').trim()) };
  });
  if (!tx.committed) return { status: 200, body: { ok: true, key, state: 'already' } };
  const rec = tx.snapshot.val();

  //  הדפסה שהגיעה קודם? מתאימים לפי מספר מסמך ושמות הסקיצות — בדיוק אחת.
  const printed = (await db.ref('invoicePdf').orderByChild('state').equalTo('printed').limitToFirst(200).once('value')).val() || {};
  const hits = Object.keys(printed).filter(k =>
    printed[k].docNumber === String(docNumber) && M.matchesPending(printed[k].text || '', rec));
  if (hits.length !== 1) {
    return { status: 200, body: { ok: true, key, state: hits.length ? 'ambiguous' : 'awaiting' } };
  }
  const pk = hits[0], p = printed[pk];
  const blobs = (await db.ref('invoicePdfBlobs/' + pk).once('value')).val();
  if (!blobs) return { status: 200, body: { ok: true, key, state: 'awaiting' } };
  const r = await promote(db, key, { docNumber: String(docNumber), date: p.date, hash: p.originalHash,
    orig: Buffer.from(blobs.original, 'base64'), copy: Buffer.from(blobs.copy, 'base64') }, now);
  if (!r.ok) return { status: 200, body: { ok: true, key, state: 'already' } };
  await db.ref('invoicePdf/' + pk).set(null);
  await db.ref('invoicePdfBlobs/' + pk).set(null);
  return { status: 200, body: { ok: true, key, state: 'ready' } };
}

//  רשימה לאדמין: בלי text ובלי קבצים.
async function list(db, { fromMs }) {
  const from = Number(fromMs) || 0;
  const all = (await db.ref('invoicePdf').orderByChild('createdAt').startAt(from).once('value')).val() || {};
  const items = Object.keys(all).map(k => {
    const { text, originalHash, sendKey, ...r } = all[k];
    return { key: k, ...r };
  }).filter(r => (r.createdAt || 0) >= from).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { status: 200, body: { ok: true, items } };
}

//  המקור בלבד. לקוח: רק אם כל ההזמנות בחשבונית שלו.
async function getPdf(db, who, { key }) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(key)) return _fail(400, 'bad-key');
  const rec = (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!rec || rec.state !== 'ready') return _fail(404, 'not-ready');
  if (!who.admin) {
    const ids = rec.orderIds || [];
    if (!ids.length) return _fail(403, 'forbidden');
    for (const id of ids) {
      const o = (await db.ref('orders/' + id + '/clientPhone').once('value')).val();
      if (!o || _phone(o) !== _phone(who.phone)) return _fail(403, 'forbidden');
    }
    if (rec.simulated) return _fail(404, 'not-ready');
  }
  const blobs = (await db.ref('invoicePdfBlobs/' + key).once('value')).val();
  if (!blobs || !blobs.original) return _fail(404, 'not-ready');
  return { status: 200, body: { ok: true, docNumber: rec.docNumber, pdf: blobs.original } };
}

//  deps: { db, auth(req) → { phone, admin } | null, now }
async function handleCtl(req, deps) {
  if (req.method !== 'POST') return _fail(405, 'method');
  const who = await deps.auth(req);
  if (!who) return _fail(401, 'unauthorized');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object') return _fail(400, 'bad-body');
  const now = deps.now || Date.now();
  if (body.action === 'pdf') return getPdf(deps.db, who, body);
  if (!who.admin) return _fail(403, 'forbidden');
  if (body.action === 'register') return register(deps.db, body, now);
  if (body.action === 'list') return list(deps.db, body);
  return _fail(400, 'bad-action');
}

function _app() {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { lgDatabaseUrl } = require('./_env');
  return getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: lgDatabaseUrl() });
}

async function _auth(req) {
  const m = ((req.headers && req.headers.authorization) || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const { getAuth } = require('firebase-admin/auth');
  const { getDatabase } = require('firebase-admin/database');
  const app = _app();
  let decoded;
  try { decoded = await getAuth(app).verifyIdToken(m[1]); } catch (_) { return null; }
  const phone = _phone(String(decoded.email || '').split('@')[0]);
  if (!phone) return null;
  const u = (await getDatabase(app).ref('users/' + phone).once('value')).val();
  if (!u) return null;
  return { phone, admin: u.role === 'admin' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ ok: false, code: 'not-configured' });
    const { getDatabase } = require('firebase-admin/database');
    const r = await handleCtl(req, { db: getDatabase(_app()), auth: _auth });
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('invoice-ctl: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
module.exports.handleCtl = handleCtl;
module.exports.promote = promote;
module.exports.pdfKeyFor = pdfKeyFor;
