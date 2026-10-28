// ═══════════════════════════════════════════════════════════════════
//  POST /api/invoice-pdf-upload — כלי המחשב מעלה חשבונית שהודפסה (DB-00004).
//  (rewrite אל wa-inbound?invoice=upload — מגבלת 12 הפונקציות)
//
//  ⚠️ endpoint ללא התחברות אדמין. ההגנה:
//    1. Authorization: Bearer <INVOICE_UPLOAD_TOKEN> (_hook-token.js). לא הוגדר → 401.
//    2. חתימת %PDF- ומגבלת גודל לפני כל עיבוד.
//    3. כל אי-ודאות (מקור/העתק, שיוך, מספר מסמך) → 422 ולא נשמר דבר כ"מוכן".
//
//  גוף: { original: base64, copy: base64 }  (עמוד מקור ועמוד העתק, כל אחד PDF)
//  תשובה: { ok, key, docNumber, date, archivePath, sendAfter }
//         | 202 { ok, held } — הודפסה, ממתינה ל"החשבונית הופקה" (הכלי מנסה שוב)
//         | { ok:false, code }
//  הכלי כותב את ההעתק לתיקייה השיתופית לפי archivePath.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgHookTokenOk } = require('./_hook-token');
const M = require('./_invoice-match');
const S = require('./_invoice-send');
const C = require('./_invoice-ctl');

const MAX_PDF_BYTES = 600 * 1024;   // base64 ב-RTDB: שני קבצים נשארים מתחת ל-1MB לצומת

const _fail = (status, code) => ({ status, body: { ok: false, code } });

function _decode(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_PDF_BYTES) return null;
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return null;
  return buf;
}

const _sha = buf => crypto.createHash('sha1').update(buf).digest('hex');

//  deps: { db, env, now, pageTexts(buf) → string[] }
async function handleUpload(req, deps) {
  if (req.method !== 'POST') return _fail(405, 'method');
  const env = deps.env || process.env;
  if (!lgHookTokenOk(req.headers && req.headers.authorization, env.INVOICE_UPLOAD_TOKEN, 'invoice-upload')) {
    return _fail(401, 'unauthorized');
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body) return _fail(400, 'bad-body');

  const orig = _decode(body.original), copy = _decode(body.copy);
  if (!orig || !copy) return _fail(400, 'bad-pdf');

  const pageTexts = deps.pageTexts || M.lgPdfPageTexts;
  let oText, cText;
  try {
    const o = await pageTexts(orig), c = await pageTexts(copy);
    if (o.length !== 1 || c.length !== 1) return _fail(422, 'page-count');
    oText = o[0]; cText = c[0];
  } catch (_) {
    return _fail(422, 'unreadable-pdf');
  }
  //  הבדיקה שמונעת שליחת העתק ללקוח
  if (M.pageRole(oText) !== 'original' || M.pageRole(cText) !== 'copy') return _fail(422, 'role-unverified');

  const { db } = deps, now = deps.now || Date.now();
  const hash = _sha(orig);

  //  העלאה חוזרת של אותו קובץ (ניסיון חוזר של הכלי) → בלי עיבוד שני
  const dup = (await db.ref('invoicePdf').orderByChild('originalHash').equalTo(hash).limitToFirst(1).once('value')).val();
  if (dup) {
    const k = Object.keys(dup)[0], d = dup[k];
    if (d.state === 'ready') {
      return { status: 200, body: { ok: true, duplicate: true, key: k, docNumber: d.docNumber,
        date: d.date, archivePath: d.archivePath, sendAfter: d.sendAfter } };
    }
    return { status: 202, body: { ok: true, held: true, key: k } };   // עדיין ממתינה לרישום
  }

  const docNumber = M.extractDocNumber(oText);
  const date = M.extractDate(oText);
  if (!docNumber || !date) return _fail(422, 'no-docnumber-or-date');

  //  רישום ידני מקדים כבר נושא docNumber — חייב להיות זהה למה שהודפס
  const all = (await db.ref('invoicePdf').orderByChild('state').equalTo('awaiting').limitToFirst(200).once('value')).val() || {};
  const pend = {};
  Object.keys(all).forEach(k => { if (!all[k].docNumber || all[k].docNumber === docNumber) pend[k] = all[k]; });
  const pick = M.pickPending(oText, pend);

  if (!pick.ok) {
    //  הדפסה שהגיעה לפני "החשבונית הופקה": נשמרת, ו-register (invoice-ctl) ישייך.
    //  עמימות (כמה חשבוניות מתאימות) → לא שומרים, לבדיקה ידנית.
    if (pick.code === 'ambiguous') return _fail(422, pick.code);
    await C.holdPrinted(db, { hash, docNumber, date, text: oText, orig, copy, now });
    return { status: 202, body: { ok: true, held: true } };
  }

  const rec = pend[pick.key];
  const archivePath = S.lgInvoiceArchivePath(date, rec.client, docNumber);
  if (!archivePath) return _fail(422, 'no-docnumber-or-date');
  //  כתיבה אטומית: רק אם עדיין ממתינה (שתי העלאות מקבילות)
  const r = await C.finalizeReady(db, pick.key, rec, {
    docNumber, date, archivePath, originalHash: hash, uploadedAt: now,
    sendAfter: S.lgInvoiceSendAfter(now),
    sendKey: S.lgInvoiceSendKey(rec.clientPhone || rec.client, docNumber) },
    { original: orig.toString('base64'), copy: copy.toString('base64') });
  if (!r.committed) return _fail(409, 'already-processed');
  return { status: 200, body: { ok: true, key: pick.key, docNumber, date, archivePath, sendAfter: r.rec.sendAfter } };
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
    const r = await handleUpload(req, { db: getDatabase(app) });
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('invoice-pdf-upload: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
module.exports.handleUpload = handleUpload;
