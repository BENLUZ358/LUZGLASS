// ═══════════════════════════════════════════════════════════════════
//  api/_verifyAdmin.js — עוזר משותף, לא route בפני עצמו (קידומת _ מונעת
//  מ-Vercel להפוך אותו לנתיב API).
//
//  מוודא שהבקשה מגיעה ממשתמש אדמין מחובר אמיתי, לפני שממשיכים ל-API
//  שחושף נתוני חשבשבת (מק"טים/כרטיסי לקוח — כולל שם+טלפון של כ-999
//  לקוחות). קורא Authorization: Bearer <idToken> שהדפדפן שולח, מאמת אותו
//  מול Firebase Auth, גוזר את הטלפון מהאימייל המלאכותי (לא מה-uid — לא
//  אמין, ר' _lgPhoneFromAuthUser ב-firebase-db.js), וקורא את role מ-
//  users/{phone} דרך Admin SDK (עוקף את חוקי ה-Firebase, כי זו קריאה
//  שרת-לשרת עם הרשאות מלאות — בדיוק בשביל זה).
//
//  משתנה סביבה נדרש (Vercel Dashboard → Project Settings → Environment
//  Variables — לא בקובץ, לא ב-repo):
//    FIREBASE_SERVICE_ACCOUNT   תוכן ה-JSON המלא של scripts/serviceAccountKey.json,
//                               כמחרוזת אחת (אותו קובץ בדיוק, לא סוד חדש)
// ═══════════════════════════════════════════════════════════════════

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';

function _adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('missing FIREBASE_SERVICE_ACCOUNT env var');
  return initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DATABASE_URL });
}

// מחזיר { ok:true, phone } או { ok:false, status, error } — אף פעם לא זורק.
async function verifyAdmin(req) {
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return { ok: false, status: 401, error: 'missing Authorization header' };

  let app, decoded;
  try {
    app = _adminApp();
    decoded = await getAuth(app).verifyIdToken(m[1]);
  } catch (e) {
    return { ok: false, status: 401, error: 'invalid token' };
  }

  const email = decoded.email || '';
  const phone = email.split('@')[0].replace(/[-\s]/g, '');
  if (!phone) return { ok: false, status: 403, error: 'token has no usable identity' };

  try {
    const snap = await getDatabase(app).ref('users/' + phone).once('value');
    const u = snap.val();
    if (!u || u.role !== 'admin') return { ok: false, status: 403, error: 'not an admin' };
    return { ok: true, phone };
  } catch (e) {
    return { ok: false, status: 500, error: 'role lookup failed' };
  }
}

module.exports = { verifyAdmin };
