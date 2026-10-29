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
//  תשובות:
//    200 { ok, key, docNumber, date, archivePath, sendAfter }  שויכה — הכלי כותב העתק
//    202 { ok, pending:true }  הודפסה אך החשבונית עוד לא נרשמה בתחנה — הכלי ינסה שוב
//    4xx { ok:false, code }    נעצרה — הכלי מעביר ל-review
//
//  סדר לא משנה: חשבונית שנרשמה קודם ('awaiting') משויכת מיד; הדפסה שהגיעה
//  קודם נשמרת כ'printed' ומשויכת כשהחשבונית נרשמת (_invoice-ctl.js).
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgHookTokenOk } = require('./_hook-token');
const M = require('./_invoice-match');
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

//  שויכה (200) → שולחים ללקוח מיד (_invoice-deliver). כשל בשליחה לא מפיל את
//  ההעלאה: ההעתק כבר צריך להישמר בארכיון, והמצב נרשם ב-delivery.
//  השליחה לא כפולה: deliver מדלג על חשבונית שכבר נשלחה / בתור.
//  deps: { db, env, now, pageTexts(buf) → string[], deliver?(db, key, {now}) }
async function handleUpload(req, deps) {
  const r = await _handleUpload(req, deps);
  if (r.status === 200 && r.body && r.body.key) await deliverSafe(deps, r.body.key);
  return r;
}

async function deliverSafe(deps, key) {
  try {
    const deliver = deps.deliver || require('./_invoice-deliver').lgInvoiceDeliver;
    await deliver(deps.db, key, { now: deps.now });
  } catch (e) {
    console.error('invoice-pdf-upload: deliver failed', e && e.name);
  }
}

async function _handleUpload(req, deps) {
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

  //  העלאה חוזרת של אותו קובץ (ניסיון חוזר של הכלי) → תשובה זהה, בלי עיבוד שני.
  //  הדפסה שעדיין 'printed' מנסה להשתייך עכשיו (ייתכן שהחשבונית נרשמה בינתיים).
  const dup = (await db.ref('invoicePdf').orderByChild('originalHash').equalTo(hash).limitToFirst(1).once('value')).val();
  if (dup) {
    let k = Object.keys(dup)[0], r = dup[k];
    if (r.state === 'printed') {
      const s = await C.settlePrinted(db, k, now);
      if (!s.settled) return { status: 202, body: { ok: true, pending: true, duplicate: true, key: k } };
      k = s.key; r = s.rec;
    }
    return { status: 200, body: { ok: true, duplicate: true, key: k, docNumber: r.docNumber,
      date: r.date, archivePath: r.archivePath, sendAfter: r.sendAfter } };
  }

  const docNumber = M.extractDocNumber(oText);
  const date = M.extractDate(oText);
  const pend = (await db.ref('invoicePdf').orderByChild('state').equalTo('awaiting').limitToFirst(200).once('value')).val() || {};
  const pick = M.pickPending(oText, pend);

  if (!pick.ok) {
    //  אין חשבונית רשומה שמתאימה: שומרים את ההדפסה עד שהחשבונית תירשם בתחנה.
    //  גם 'ambiguous' (שתי ממתינות של אותו לקוח בלי מספר מסמך) מחכה: השיוך
    //  יקרה ב-settlePrinted, שם מספר המסמך חייב להתאים. בלי מספר מסמך ותאריך
    //  אין לפי מה לשייך אחר כך.
    if (!docNumber || !date) return _fail(422, 'no-docnumber-or-date');
    //  הדפסה חוזרת של חשבונית שכבר טופלה (או ממחשב שני): לא שומרים שוב.
    //  כבר שויכה → מחזירים את אותו נתיב ארכיון והכלי מסיים איתה; עדיין ממתינה
    //  כהדפסה → הכלי ינסה שוב, ואחרי השיוך היא תיסגר כאן.
    const same = (await db.ref('invoicePdf').orderByChild('docNumber').equalTo(docNumber).once('value')).val() || {};
    const sk = Object.keys(same);
    const settled = sk.find(k => !['awaiting', 'printed'].includes(same[k].state) && same[k].archivePath);
    if (settled) {
      const r = same[settled];
      return { status: 200, body: { ok: true, reprint: true, key: settled, docNumber, date: r.date,
        archivePath: r.archivePath, sendAfter: r.sendAfter } };
    }
    if (sk.some(k => same[k].state === 'printed')) return { status: 202, body: { ok: true, pending: true, reprint: true } };
    //  הופקה ישירות בחשבשבת מהזמנות סוכן (בן, 29/10): מספרי ההזמנות שלנו
    //  מודפסים בטור "מ.מקור". נמצאו הזמנות של אותו כרטיס → משייכים עכשיו.
    const acct = M.extractAccountKey(oText);
    const ids = acct ? await C.ordersFromPrint(db, oText, acct, docNumber) : [];
    if (ids.length) {
      const key = await C.openFromOrders(db, ids, docNumber, acct, now);
      const done = key && await C.markReady(db, key, { docNumber, date, hash, original: orig, copy }, now);
      if (done) return { status: 200, body: { ok: true, key, docNumber, date, byOrders: true,
        archivePath: done.archivePath, sendAfter: done.sendAfter } };
    }
    const pk = 'p' + hash.slice(0, 18);
    await db.ref('invoicePdf/' + pk).set({ state: 'printed', docNumber, date, originalHash: hash,
      text: oText.slice(0, 3000), createdAt: now, uploadedAt: now });
    await db.ref('invoicePdfBlobs/' + pk).set({
      original: orig.toString('base64'), copy: copy.toString('base64') });
    const s = await C.settlePrinted(db, pk, now);
    if (!s.settled) return { status: 202, body: { ok: true, pending: true, key: pk } };
    return { status: 200, body: { ok: true, key: s.key, docNumber, date,
      archivePath: s.rec.archivePath, sendAfter: s.rec.sendAfter } };
  }

  const rec = (pend[pick.key]);
  if (!docNumber || !date) return _fail(422, 'no-docnumber-or-date');
  if (rec.docNumber && rec.docNumber !== docNumber) return _fail(422, 'docnumber-mismatch');
  //  כתיבה אטומית: רק אם עדיין ממתינה (שתי העלאות מקבילות)
  const done = await C.markReady(db, pick.key, { docNumber, date, hash, original: orig, copy }, now);
  if (!done) return _fail(409, 'already-processed');
  return { status: 200, body: { ok: true, key: pick.key, docNumber, date,
    archivePath: done.archivePath, sendAfter: done.sendAfter } };
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
module.exports.deliverSafe = deliverSafe;
