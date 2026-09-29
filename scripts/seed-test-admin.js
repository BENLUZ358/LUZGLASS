#!/usr/bin/env node
/**
 * seed-test-admin.js — יוצר משתמש אדמין יחיד בסביבת TEST.
 *
 * שני חלקים, ושניהם נדרשים כדי שההתחברות תעבוד:
 *   1. Firebase Auth — משתמש עם האימייל המלאכותי <טלפון>@luzglass.local
 *      (LG_EMAIL_DOMAIN ב-firebase-db.js). Firebase דורש "אימייל", ולשם
 *      הזה לא נשלח דבר.
 *   2. RTDB users/<טלפון> — שם, role ו-isMainAdmin. החוקים קוראים את role
 *      משם, ולכן בלי הרשומה הזו ההתחברות מצליחה וכל קריאה נדחית.
 *
 * ⚠️ הסיסמה נוצרת כאן ונכתבת לקובץ מחוץ למאגר. היא לא מודפסת למסך ולא
 * עוברת בשום ערוץ אחר.
 *
 * ⚠️ TEST בלבד — אותן שלוש נעילות כמו deploy-rules-test.js.
 *
 *   LG_TEST_DB=https://... node scripts/seed-test-admin.js --phone 0500000001 --name "..."
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const KEY = process.env.LG_TEST_KEY || 'C:/Users/USER/luzglass-test-key.json';
const DB  = process.env.LG_TEST_DB  || '';
const argOf = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };

const PHONE = String(argOf('phone') || '').replace(/[-\s]/g, '');
const NAME  = argOf('name') || 'אדמין בדיקות';
const OUT   = argOf('out') || 'C:/Users/USER/luzglass-test-admin.txt';

function die(m) { console.error('✗ ' + m); process.exit(1); }

if (!/^\d{9,10}$/.test(PHONE)) die('--phone חייב להיות 9-10 ספרות, בלי מקפים');
if (!fs.existsSync(KEY)) die('לא נמצא מפתח שירות ב-' + KEY);
if (!DB) die('חסרה LG_TEST_DB');

const sa = JSON.parse(fs.readFileSync(KEY, 'utf8'));
const pid = String(sa.project_id || '');
if (!pid) die('במפתח אין project_id');
if (pid === 'lussglass' || /lussglass/.test(DB)) die('עצור. זה פרודקשן. הקובץ הזה ל-TEST בלבד.');
if (!DB.includes(pid)) die('אי-התאמה בין המפתח (' + pid + ') לכתובת');

const app   = initializeApp({ credential: cert(sa), databaseURL: DB });
const EMAIL = PHONE + '@luzglass.local';
// 18 בתים base64url — חזק, ובלי תווים שנשברים בהעתקה מטרמינל
const PASS  = crypto.randomBytes(18).toString('base64url');

(async () => {
  console.log('פרויקט: ' + pid);
  console.log('טלפון : ' + PHONE + '   (אימייל: ' + EMAIL + ')');

  const auth = getAuth(app);
  let uid;
  try {
    const u = await auth.createUser({ email: EMAIL, password: PASS, displayName: NAME });
    uid = u.uid;
    console.log('✓ נוצר משתמש ב-Authentication');
  } catch (e) {
    if (e.code !== 'auth/email-already-exists') throw e;
    const u = await auth.getUserByEmail(EMAIL);
    uid = u.uid;
    await auth.updateUser(uid, { password: PASS, displayName: NAME });
    console.log('✓ המשתמש כבר היה קיים — הסיסמה אופסה');
  }

  // אותם שדות בדיוק ש-lgSaveUser כותב, כדי שהרשומה תיראה כמו כל אחרת
  await getDatabase(app).ref('users/' + PHONE).set({
    id: PHONE, phone: PHONE, name: NAME,
    role: 'admin', isMainAdmin: true, customerId: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  console.log('✓ נכתבה רשומה ב-users/' + PHONE + '  (role=admin, isMainAdmin=true)');

  fs.writeFileSync(OUT,
    'LUZ GLASS TEST — משתמש אדמין\n' +
    'פרויקט : ' + pid + '\n' +
    'טלפון  : ' + PHONE + '\n' +
    'סיסמה  : ' + PASS + '\n' +
    'נוצר   : ' + new Date().toISOString() + '\n' +
    '\nלא לשתף. לא להעלות למאגר. אפשר לשנות סיסמה במסך ניהול המשתמשים.\n',
    'utf8');
  console.log('\n✓ הסיסמה נשמרה ב: ' + OUT);
  console.log('  (לא מודפסת כאן בכוונה)');
  process.exit(0);
})().catch(e => { console.error('נכשל: ' + (e.message || e)); process.exit(1); });
