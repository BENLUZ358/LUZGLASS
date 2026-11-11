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
//  דופק (10/11): { op:'heartbeat', pc, pending, lastPrintError, version } → 200 { ok, heartbeat }
//    — ר' heartbeat() למטה ו-api/_agent-watch.js.
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

//  האם כרטיס הלקוח שעל החשבונית ("מפתח") מחובר למערכת: משתמש עם אותו customerId.
//  לא נקרא / תקלה → true (הכיוון הבטוח: הכלי ממשיך לחכות כמו קודם, ואחרי
//  ההמתנה מדפיס על נייר בכל מקרה).
async function _knownAccount(db, text) {
  const acct = M.extractAccountKey(text);
  if (!acct) return true;
  try {
    const users = (await db.ref('users').once('value')).val() || {};
    return Object.values(users).some(u => u && String(u.customerId || '') === acct);
  } catch (_) { return true; }
}

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

//  ─── הדופק (חדר הסוכנים, שלב ב׳, 10/11) ───
//  { op:'heartbeat', pc, pending:[{name, ageSec}], lastPrintError, version } — כל דקה מהכלי
//  במשרד, אחרי אותה בדיקת טוקן. נשמר ב-waMeta/invoiceWatcher/<pc>, ואז הבדיקות של
//  הארכיון והקולט (api/_agent-watch.js — לכל היותר פעם בדקה). תקלה בבדיקות → עדיין 200:
//  הדופק עצמו נשמר, וזה מה שמסך הסוכנים והסיכום היומי קוראים.
async function heartbeat(body, deps) {
  const W = require('./_agent-watch');
  const hb = W.lgWatchHeartbeatClean(body);
  if (!hb) return _fail(400, 'bad-heartbeat');
  const now = deps.now || Date.now();
  await deps.db.ref(W.WATCHERS + '/' + hb.pc).set({ at: now, pending: hb.pending, lastPrintError: hb.lastPrintError, version: hb.version });
  //  תור הוואטסאפ מהשרת — ראשון, כדי שהודעה שנתקעה תצא גם בלי דף פתוח (מתג WA_SERVER_DRAIN). ר' api/_wa-server-drain.js
  try {
    await (deps.waDrain || require('./_wa-server-drain').lgWaServerDrain)(deps.db, { env: deps.env || process.env, now });
  } catch (e) { console.error('invoice-pdf-upload: wa server drain failed', e && e.name); }
  //  הבקשה כולה מתחת ל-60ש׳: שליחה עד 18ש׳, בדיקות עד 30ש׳
  try {
    await (deps.watchRun || W.lgAgentWatchRun)(deps.db, { env: deps.env || process.env, now, deadline: Date.now() + 30 * 1000 });
  } catch (e) { console.error('invoice-pdf-upload: watch failed', e && e.name); }
  //  "מוכן לאיסוף" שלא יצא מהדף (בן, 11/11) — לא תלוי במתגי הסוכנים. ר' api/_ready-net.js
  try {
    await (deps.readyNet || require('./_ready-net').lgReadyNetRun)(deps.db, { now });
  } catch (e) { console.error('invoice-pdf-upload: ready-net failed', e && e.name); }
  return { status: 200, body: { ok: true, heartbeat: true } };
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
  if (body.op === 'heartbeat') return heartbeat(body, deps);

  const orig = _decode(body.original), copy = _decode(body.copy);
  if (!orig || !copy) return _fail(400, 'bad-pdf');

  const pageTexts = deps.pageTexts || M.lgPdfPageTexts;
  //  חשבונית ארוכה היא כמה עמודים בכל קובץ (בן, 2/11 — 67395: 2+2). כל עמוד
  //  מודפס עם "מקור"/"העתק" בתחתית, ולכן כל עמוד נבדק; הטקסט של כל העמודים
  //  נקרא יחד (מספרי הזמנה יכולים להופיע רק בעמוד השני).
  let oPages, cPages;
  try {
    oPages = await pageTexts(orig); cPages = await pageTexts(copy);
    if (!oPages.length || !cPages.length) return _fail(422, 'page-count');
  } catch (_) {
    return _fail(422, 'unreadable-pdf');
  }
  //  הבדיקה שמונעת שליחת העתק ללקוח. החריג היחיד: "העתק משוחזר" שהכלי סימן
  //  במפורש (restored) — חשבשבת לא ידפיס מקור שני, וזה מה שהלקוח צריך לקבל.
  const restored = body.restored === true;
  if (restored) {
    if (!oPages.every(M.isRestoredCopy) || !cPages.every(M.isRestoredCopy)) return _fail(422, 'role-unverified');
  } else if (oPages.some(t => M.pageRole(t) !== 'original') || cPages.some(t => M.pageRole(t) !== 'copy')) {
    return _fail(422, 'role-unverified');
  }
  const oText = oPages.join('\n');

  const { db } = deps, now = deps.now || Date.now();
  const hash = _sha(orig);
  //  202 אומר לכלי גם אם הלקוח מחובר למערכת (בן, 10/11): לקוח שלא במערכת →
  //  הכלי מדפיס מקור והעתק על נייר מיד, במקום לחכות לרישום שלא יגיע.
  //  נחשב פעם אחת: גם נשמר על רשומת 'printed' (known) — בדיקת הארכיון (_agent-watch) קוראת
  //  אותו במקום את כל users (סקירה 10/11)
  let known;
  const knownOf = async () => (known === undefined ? (known = await _knownAccount(db, oText)) : known);
  const pending = async extra => ({ status: 202, body: { ok: true, pending: true, known: await knownOf(), ...extra } });

  //  העלאה חוזרת של אותו קובץ (ניסיון חוזר של הכלי) → תשובה זהה, בלי עיבוד שני.
  //  הדפסה שעדיין 'printed' מנסה להשתייך עכשיו (ייתכן שהחשבונית נרשמה בינתיים).
  const dup = (await db.ref('invoicePdf').orderByChild('originalHash').equalTo(hash).limitToFirst(1).once('value')).val();
  if (dup) {
    let k = Object.keys(dup)[0], r = dup[k];
    if (r.state === 'printed') {
      const s = await C.settlePrinted(db, k, now);
      if (!s.settled) return pending({ duplicate: true, key: k });
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
    if (sk.some(k => same[k].state === 'printed')) return pending({ reprint: true });
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
      text: oText.slice(0, 3000), known: await knownOf(), createdAt: now, uploadedAt: now });
    await db.ref('invoicePdfBlobs/' + pk).set({
      original: orig.toString('base64'), copy: copy.toString('base64') });
    const s = await C.settlePrinted(db, pk, now);
    if (!s.settled) return pending({ key: pk });
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
