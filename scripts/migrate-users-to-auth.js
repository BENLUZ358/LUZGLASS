// ═══════════════════════════════════════════════════════════════════
//  migrate-users-to-auth.js
//  סקריפט חד-פעמי: יוצר חשבון Firebase Authentication לכל משתמש קיים
//  ב-users/{phone}, כדי שנוכל לעבור מ-sessionStorage לאימות אמיתי.
//
//  לא נוגע ב-users/{phone} עצמו — רק יוצר במקביל חשבון ב-Firebase Auth
//  עם uid = מספר הטלפון (כדי לשמור על אותו מזהה), אימייל מלאכותי
//  {phone}@luzglass.local, וסיסמה זהה לסיסמה הקיימת ב-DB.
//
//  איך להריץ (חד פעמי, מהמחשב שלך — לא בשרת, לא ב-Vercel):
//  ────────────────────────────────────────────────────────────────
//  1. Firebase Console → Project Settings → Service accounts →
//     Generate new private key  → שמור את הקובץ בתור:
//     scripts/serviceAccountKey.json   (אל תעלה אותו ל-Git!)
//
//  2. Firebase Console → Authentication → Sign-in method →
//     הפעל את הספק "Email/Password"  (חובה לפני הרצת הסקריפט)
//
//  3. בטרמינל:
//       cd scripts
//       npm install firebase-admin
//       node migrate-users-to-auth.js
//
//  4. עקוב אחר הלוג — יודפס דוח מלא: כמה נוצרו, כמה כבר קיימים,
//     האם היו שגיאות. שום דבר לא נמחק ולא משתנה ב-users/{phone}.
//
//  5. לאחר ריצה מוצלחת — מחק את serviceAccountKey.json מהמחשב
//     (או שמור אותו במקום מאובטח, לא בתיקיית הפרויקט).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const EMAIL_DOMAIN = 'luzglass.local'; // דומיין מלאכותי — לעולם לא נשלח אליו מייל אמיתי

if (!fs.existsSync(KEY_PATH)) {
  console.error('✗ לא נמצא scripts/serviceAccountKey.json — ראה הוראות בראש הקובץ (שלב 1).');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'
});

const db   = admin.database();
const auth = admin.auth();

function normalizePhone(p) { return String(p || '').replace(/[-\s]/g, ''); }
function syntheticEmail(phone) { return `${phone}@${EMAIL_DOMAIN}`; }

async function main() {
  console.log('── קורא את users/ מ-Firebase Realtime Database... ──');
  const snap = await db.ref('users').once('value');
  if (!snap.exists()) {
    console.log('לא נמצאו משתמשים ב-users/. אין מה להעביר.');
    process.exit(0);
  }

  const users = Object.values(snap.val());
  console.log(`נמצאו ${users.length} משתמשים.\n`);

  const report = { created: [], alreadyExists: [], skippedNoPassword: [], failed: [] };

  for (const u of users) {
    const phone = normalizePhone(u.phone || u.id);
    if (!phone) { report.failed.push({ user: u, reason: 'אין מספר טלפון' }); continue; }
    if (!u.password) { report.skippedNoPassword.push(phone); continue; }

    const email = syntheticEmail(phone);

    try {
      // מנסה ליצור עם uid קבוע = מספר הטלפון, כדי לשמור זהות עם users/{phone}
      await auth.createUser({
        uid: phone,
        email,
        emailVerified: true,     // אימייל מלאכותי — "מאומת" כי לעולם לא נשלחת אליו הודעה אמיתית
        password: String(u.password),
        displayName: u.businessName || u.name || phone,
        disabled: false
      });
      report.created.push(phone);
      console.log(`✓ נוצר חשבון Auth: ${phone}  (${email})`);
    } catch (err) {
      if (err.code === 'auth/uid-already-exists' || err.code === 'auth/email-already-exists') {
        report.alreadyExists.push(phone);
        console.log(`· כבר קיים: ${phone}`);
      } else {
        report.failed.push({ phone, reason: err.message });
        console.error(`✗ נכשל: ${phone} — ${err.message}`);
      }
    }
  }

  console.log('\n══════════════ דוח סופי ══════════════');
  console.log(`נוצרו חדשים:        ${report.created.length}`);
  console.log(`כבר קיימים:         ${report.alreadyExists.length}`);
  console.log(`ללא סיסמה (דולג):   ${report.skippedNoPassword.length}`, report.skippedNoPassword);
  console.log(`נכשלו:              ${report.failed.length}`, report.failed);
  console.log('════════════════════════════════════');

  if (report.failed.length === 0) {
    console.log('\n✅ ההעברה הושלמה בהצלחה. אפשר לעבור לשלב הבא (עדכון login.html).');
  } else {
    console.log('\n⚠️  יש כשלונות — טפל בהם לפני שממשיכים לשלב הבא.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('✗ שגיאה כללית:', err);
  process.exit(1);
});
