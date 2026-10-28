// ═══════════════════════════════════════════════════════════════════
//  POST /api/invoice-ctl — בקרת חשבוניות (DB-00004). rewrite אל
//  wa-inbound?invoice=ctl (מגבלת 12 הפונקציות).
//
//  גוף: { action, ... }. כל פעולה דורשת Authorization: Bearer <idToken>.
//    register  (אדמין)  { orderIds, docNumber } — "החשבונית הופקה" נרשם בשרת.
//                       עובד בכל סדר מול ההדפסה: רישום→הדפסה או הדפסה→רישום.
//    list      (אדמין)  { months }                — ארכיון, ברירת מחדל חצי שנה.
//    pdf       (אדמין)  { key }                   — המקור בלבד, base64.
//    myList    (לקוח)   {}                        — חשבוניות מוכנות של הטלפון שלו.
//    myPdf     (לקוח)   { key }                   — המקור בלבד, אחרי בדיקת בעלות.
//
//  ⚠️ ההעתק לא יוצא מכאן לעולם. ⚠️ לקוח מקבל רק רשומה ש**כל** הזמנותיה שלו.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const M = require('./_invoice-match');
const S = require('./_invoice-send');

const DAY = 24 * 60 * 60 * 1000;
const _fail = (status, code) => ({ status, body: { ok: false, code } });
const _phone = p => String(p || '').replace(/[-\s]/g, '');

//  אותו חישוב מפתח כמו hashavshevet-invoice.js — חשוב שיהיה זהה.
function lgInvoicePdfKey(orderIds) {
  return crypto.createHash('sha1')
    .update('invoicePdf|' + [...orderIds].map(String).sort().join(',')).digest('hex').slice(0, 20);
}

//  סוגר חשבונית: ממתינה/הודפסה → 'ready'. טרנזקציה אטומית, ומחזירה {committed, rec}.
//  ⚠️ firebase קוראת לפונקציה תחילה עם null (מטמון). החזרת undefined שם מבטלת
//  את הכול בשקט — ולכן null מוחלף בערך שכבר קראנו (guess) והשרת מתקן.
async function finalizeReady(db, key, guess, fields, blobs) {
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    const c = cur || guess;
    if (!c || c.state !== 'awaiting') return;
    return { ...c, ...fields, state: 'ready' };
  });
  if (!tx.committed) return { committed: false };
  await db.ref('invoicePdfBlobs/' + key).set(blobs);
  return { committed: true, rec: tx.snapshot.val() };
}

//  הדפסה שהגיעה לפני הרישום: נשמרת כ'printed' עד ש-register משייך אותה.
async function holdPrinted(db, { hash, docNumber, date, text, orig, copy, now }) {
  const key = 'p' + hash.slice(0, 19);
  await db.ref('invoicePdf/' + key).set({
    state: 'printed', originalHash: hash, docNumber: docNumber || null, date: date || null,
    text: String(text || '').slice(0, 4000), createdAt: now, uploadedAt: now });
  await db.ref('invoicePdfBlobs/' + key).set({ original: orig.toString('base64'), copy: copy.toString('base64') });
  return key;
}

//  נקרא אחרי register: אם כבר הודפסה חשבונית עם אותו מספר ושמות הסקיצות — משייכים.
async function claimPrinted(db, key, rec, now) {
  const docNumber = rec.docNumber;
  if (!docNumber) return { claimed: false };
  const snap = (await db.ref('invoicePdf').orderByChild('docNumber').equalTo(docNumber).limitToFirst(20).once('value')).val() || {};
  const hits = Object.keys(snap).filter(k => snap[k].state === 'printed' && M.matchesPending(snap[k].text, rec));
  if (hits.length !== 1) return { claimed: false, code: hits.length ? 'ambiguous' : 'none' };
  const pk = hits[0], p = snap[pk];
  const date = p.date || M.extractDate(p.text);
  const archivePath = S.lgInvoiceArchivePath(date, rec.client, docNumber);
  if (!date || !archivePath) return { claimed: false, code: 'no-date' };
  const blobs = (await db.ref('invoicePdfBlobs/' + pk).once('value')).val();
  if (!blobs) return { claimed: false, code: 'no-blob' };
  const r = await finalizeReady(db, key, rec, {
    docNumber, date, archivePath, originalHash: p.originalHash, uploadedAt: now,
    sendAfter: S.lgInvoiceSendAfter(now), sendKey: S.lgInvoiceSendKey(rec.clientPhone || rec.client, docNumber) }, blobs);
  if (!r.committed) return { claimed: false, code: 'already' };
  await db.ref('invoicePdf/' + pk).set(null);
  await db.ref('invoicePdfBlobs/' + pk).set(null);
  return { claimed: true };
}

//  deps: { db, now }. admin = { phone }.
async function register(body, deps) {
  const ids = Array.isArray(body.orderIds) ? body.orderIds.map(String).filter(Boolean) : [];
  const docNumber = String(body.docNumber || '').trim();
  if (!ids.length || ids.length > 200 || !/^\d{4,9}$/.test(docNumber)) return _fail(400, 'bad-input');
  const { db } = deps, now = deps.now || Date.now();
  //  מהמסד, לא מהלקוח: ההזמנות חייבות כבר לשאת את אותו מספר מסמך (lgMarkInvoiced)
  const orders = [];
  for (const id of ids) {
    const o = (await db.ref('orders/' + id).once('value')).val();
    if (!o || !o.invoiceDone || String(o.invoiceDone.docNumber) !== docNumber) return _fail(409, 'order-not-marked');
    orders.push({ ...o, id });
  }
  const phones = new Set(orders.map(o => _phone(o.clientPhone)));
  if (phones.size !== 1) return _fail(409, 'mixed-clients');
  const key = lgInvoicePdfKey(ids);
  const base = {
    state: 'awaiting', createdAt: now, createdBy: deps.adminPhone || null,
    client: orders[0].clientName || orders[0].client || '', clientPhone: [...phones][0],
    orderIds: ids, orderNums: orders.map(o => String(o.orderNum || o.id)),
    sketchNames: orders.map(o => String(o.sketchName || o.type || o.desc || '').trim()),
    simulated: orders.some(o => o.isTest) || null,
  };
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    if (!cur) return { ...base, docNumber };
    if (cur.state === 'ready') return;                       // כבר שויכה
    return { ...cur, docNumber };                            // awaiting מ-hashavshevet-invoice
  });
  const rec = tx.committed ? tx.snapshot.val() : (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!rec) return _fail(500, 'not-written');
  if (rec.state === 'ready') return { status: 200, body: { ok: true, key, state: 'ready' } };
  const c = await claimPrinted(db, key, rec, now);
  return { status: 200, body: { ok: true, key, state: c.claimed ? 'ready' : 'awaiting' } };
}

function _view(k, r) {
  return { key: k, state: r.state, client: r.client || '', clientPhone: r.clientPhone || '',
    docNumber: r.docNumber || '', date: r.date || '', createdAt: r.createdAt || 0,
    orderIds: r.orderIds || [], orderNums: r.orderNums || [], sketchNames: r.sketchNames || [],
    archivePath: r.archivePath || '', simulated: !!r.simulated };
}

async function adminList(body, deps) {
  const months = Math.min(Math.max(parseInt(body.months, 10) || 6, 1), 12);
  const since = (deps.now || Date.now()) - months * 31 * DAY;
  const snap = (await deps.db.ref('invoicePdf').orderByChild('createdAt').startAt(since).limitToLast(2000).once('value')).val() || {};
  const items = Object.keys(snap).map(k => _view(k, snap[k]))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { status: 200, body: { ok: true, items, now: deps.now || Date.now() } };
}

async function _original(db, key) {
  const b = (await db.ref('invoicePdfBlobs/' + key).once('value')).val();
  return b && b.original ? { ok: true, status: 200, body: { ok: true, pdf: b.original } } : _fail(404, 'no-pdf');
}

async function adminPdf(body, deps) {
  const key = String(body.key || '');
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(key)) return _fail(400, 'bad-key');
  const r = (await deps.db.ref('invoicePdf/' + key).once('value')).val();
  if (!r || r.state !== 'ready') return _fail(404, 'not-ready');
  return _original(deps.db, key);
}

async function _owned(db, r, phone) {
  if (!r || r.state !== 'ready' || r.simulated || !(r.orderIds || []).length) return false;
  for (const id of r.orderIds) {
    const p = (await db.ref('orders/' + id + '/clientPhone').once('value')).val();
    if (_phone(p) !== phone) return false;
  }
  return true;
}

async function myList(body, deps, phone) {
  const snap = (await deps.db.ref('invoicePdf').orderByChild('clientPhone').equalTo(phone).limitToFirst(500).once('value')).val() || {};
  const out = [];
  for (const k of Object.keys(snap)) {
    if (await _owned(deps.db, snap[k], phone)) {
      const v = _view(k, snap[k]);
      out.push({ key: v.key, docNumber: v.docNumber, date: v.date, orderIds: v.orderIds,
        orderNums: v.orderNums, sketchNames: v.sketchNames });
    }
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { status: 200, body: { ok: true, items: out } };
}

async function myPdf(body, deps, phone) {
  const key = String(body.key || '');
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(key)) return _fail(400, 'bad-key');
  const r = (await deps.db.ref('invoicePdf/' + key).once('value')).val();
  //  404 גם על "לא שלך" — לא מגלים שהחשבונית קיימת
  if (!(await _owned(deps.db, r, phone))) return _fail(404, 'not-found');
  return _original(deps.db, key);
}

//  deps: { db, now, who(req) → { phone, role } | null }
async function handleCtl(req, deps) {
  if (req.method !== 'POST') return _fail(405, 'method');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object') return _fail(400, 'bad-body');
  const who = await deps.who(req);
  if (!who || !who.phone) return _fail(401, 'unauthorized');
  const d = { ...deps, adminPhone: who.phone };
  const admin = who.role === 'admin';
  switch (body.action) {
    case 'register': return admin ? register(body, d) : _fail(403, 'forbidden');
    case 'list':     return admin ? adminList(body, d) : _fail(403, 'forbidden');
    case 'pdf':      return admin ? adminPdf(body, d)  : _fail(403, 'forbidden');
    case 'myList':   return myList(body, d, _phone(who.phone));
    case 'myPdf':    return myPdf(body, d, _phone(who.phone));
    default:         return _fail(400, 'bad-action');
  }
}

async function _whoFromToken(req, app) {
  const m = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const { getAuth } = require('firebase-admin/auth');
  const { getDatabase } = require('firebase-admin/database');
  let decoded;
  try { decoded = await getAuth(app).verifyIdToken(m[1]); } catch (_) { return null; }
  const phone = _phone(String(decoded.email || '').split('@')[0]);
  if (!phone) return null;
  const u = (await getDatabase(app).ref('users/' + phone).once('value')).val();
  if (!u) return null;                       // חשבון בלי רשומת משתמש
  return { phone, role: u.role };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ ok: false, code: 'not-configured' });
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    const { lgDatabaseUrl } = require('./_env');
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: lgDatabaseUrl() });
    const r = await handleCtl(req, { db: getDatabase(app), who: q => _whoFromToken(q, app) });
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('invoice-ctl: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
module.exports.handleCtl = handleCtl;
module.exports.finalizeReady = finalizeReady;
module.exports.holdPrinted = holdPrinted;
module.exports.lgInvoicePdfKey = lgInvoicePdfKey;
