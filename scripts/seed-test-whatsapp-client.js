#!/usr/bin/env node
/**
 * seed-test-whatsapp-client.js — כרטיס לקוח מדומה לבדיקות WhatsApp. TEST בלבד.
 *
 *  ─── למה זה קיים ───────────────────────────────────────────────────────
 *
 *  בדיקת WhatsApp שמזינה מספר ידנית לא בודקת כלום. המסלול האמיתי עובר
 *  בשלוש חוליות, וכל אחת מהן יכולה להיות שבורה:
 *
 *    הזמנה → users/<טלפון>.customerId → hashavshevetAccounts/<KEY>.phone
 *
 *  ובפרודקשן זו **החוליה האמצעית** שעובדת בפועל: להזמנה בדרך כלל אין
 *  customerId, והכרטיס נמצא דרך טלפון ההתחברות (ר' scripts/test-client-phone.js).
 *  לכן כרטיס לבד אינו מספיק — צריך גם רשומת users שמצביעה אליו.
 *
 *  ─── למה טלפון ההתחברות שונה מהטלפון בכרטיס ────────────────────────────
 *
 *  ⚠️ זו לא פשרה אלא עיקר הבדיקה. resolvePhone קיים כדי להעדיף את הטלפון
 *  שבכרטיס החשבשבת על זה שהועתק להזמנה ביום שנפתחה. אם שניהם היו אותו
 *  מספר, לא היה אפשר לדעת מאיזה מהם ההודעה יצאה.
 *
 *  ובונוס: אם הכרטיס יישבר, הנפילה היא לטלפון המומצא של ההזמנה — ונעילה 3
 *  של GREEN API מסרבת לו. כלומר תקלה בכרטיס לא שולחת למספר זר, היא לא
 *  שולחת בכלל, והכישלון נראה.
 *
 *  ─── המפתח ──────────────────────────────────────────────────────────────
 *
 *  'TEST-WA' ולא מספר. מפתחות חשבשבת אמיתיים הם מספריים (14201), ולכן
 *  מפתח לא-מספרי אינו יכול להתנגש באף כרטיס — ואם בכל זאת היה נשלח
 *  לחשבשבת, הוא היה נדחה ולא פוגע בחשבון אמיתי.
 *
 *  ─── שלוש נעילות, כמו ב-deploy-rules-test.js ו-seed-test-admin.js ──────
 *
 *    1. המפתח חייב להיות של TEST          2. הכתובת חייבת להתאים למפתח
 *    3. lussglass בכל אחד מהם = עצירה
 *
 *  ⚠️ הטלפון האישי לא נכתב בקוד ולא נכנס למאגר — הוא נמסר בשורת הפקודה.
 *  ⚠️ הסיסמה נוצרת כאן ונכתבת לקובץ מחוץ למאגר. לא מודפסת למסך.
 *
 *  ⚠️ הסקריפט אינו יכול לקרוא את GREENAPI_TEST_TO (הוא ב-Vercel). אם המספר
 *  שתמסור כאן אינו תואם לו — נעילה 3 תסרב, שום הודעה לא תצא, והסיבה תוצג.
 *  הנעילה היא האימות.
 *
 *   LG_TEST_DB=https://... node scripts/seed-test-whatsapp-client.js \
 *       --card-phone 05XXXXXXXX [--login-phone 0500000001]
 */
const fs = require('fs'), crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth }     = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const KEY = process.env.LG_TEST_KEY || 'C:/Users/USER/luzglass-test-key.json';
const DB  = process.env.LG_TEST_DB  || '';
const argOf = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };

const norm = p => String(p || '').replace(/[-\s]/g, '');

const ACCOUNT_KEY = 'TEST-WA';
const CLIENT_NAME = 'לקוח בדיקות WhatsApp';
const CARD_PHONE  = norm(argOf('card-phone'));    // המספר האישי — לכאן ההודעה יוצאת
const LOGIN_PHONE = norm(argOf('login-phone') || '0500000001');
const OUT         = argOf('out') || 'C:/Users/USER/luzglass-test-wa-client.txt';

function die(m) { console.error('✗ ' + m); process.exit(1); }

// מסתיר את המספר בפלט — הוא אישי, והפלט נדבק לצ'אטים ולטיקטים
const mask = p => p.length < 6 ? '***' : p.slice(0, 3) + '*'.repeat(p.length - 5) + p.slice(-2);

if (!/^\d{9,10}$/.test(CARD_PHONE))  die('--card-phone חייב להיות 9-10 ספרות, בלי מקפים');
if (!/^\d{9,10}$/.test(LOGIN_PHONE)) die('--login-phone חייב להיות 9-10 ספרות');
// ⚠️ אם הם זהים, הבדיקה מאבדת את כל התוכן שלה — ר' ההסבר למעלה
if (CARD_PHONE === LOGIN_PHONE)
  die('טלפון ההתחברות זהה לטלפון שבכרטיס. בחר --login-phone אחר,\n' +
      '  אחרת אי אפשר לדעת אם ההודעה יצאה בגלל הכרטיס או בגלל ההזמנה.');

if (!fs.existsSync(KEY)) die('לא נמצא מפתח שירות ב-' + KEY);
if (!DB) die('חסרה LG_TEST_DB');

const sa  = JSON.parse(fs.readFileSync(KEY, 'utf8'));
const pid = String(sa.project_id || '');
if (!pid) die('במפתח אין project_id');
if (pid === 'lussglass' || /lussglass/.test(DB)) die('עצור. זה פרודקשן. הקובץ הזה ל-TEST בלבד.');
if (!DB.includes(pid)) die('אי-התאמה בין המפתח (' + pid + ') לכתובת');

const app   = initializeApp({ credential: cert(sa), databaseURL: DB });
const db    = getDatabase(app);
const auth  = getAuth(app);
const EMAIL = LOGIN_PHONE + '@luzglass.local';
const PASS  = crypto.randomBytes(18).toString('base64url');

(async () => {
  console.log('פרויקט : ' + pid);
  console.log('כרטיס  : ' + ACCOUNT_KEY + '  → ' + mask(CARD_PHONE) + '   (לכאן ההודעה יוצאת)');
  console.log('התחברות: ' + LOGIN_PHONE + '  (מספר מומצא — מוכיח שהכרטיס גובר)\n');

  // ⚠️ אם טלפון ההתחברות תפוס, לרוב זה חשבון האדמין שלך. לא דורסים אותו:
  // דריסה הייתה הופכת את האדמין ללקוח ומנתקת אותך מהסביבה.
  const existing = await db.ref('users/' + LOGIN_PHONE).once('value');
  if (existing.exists() && existing.val().role !== 'client') {
    die('users/' + LOGIN_PHONE + ' קיים עם role=' + existing.val().role + '.\n' +
        '  לא דורס. בחר --login-phone פנוי.');
  }

  // ── 1. הכרטיס. אותם שדות בדיוק ש-syncHashavshevetAccount כותב ──
  const now  = Date.now();
  const prev = (await db.ref('hashavshevetAccounts/' + ACCOUNT_KEY).once('value')).val() || {};
  await db.ref('hashavshevetAccounts/' + ACCOUNT_KEY).set({
    key:              ACCOUNT_KEY,
    name:             CLIENT_NAME,
    phone:            CARD_PHONE,
    hashavshevetCode: ACCOUNT_KEY,
    active:           true,
    source:           'hashavshevet',
    createdAt:        prev.createdAt || now,
    updatedAt:        now,
  });
  console.log('✓ hashavshevetAccounts/' + ACCOUNT_KEY);

  // ── 2. חשבון ההתחברות ──
  try {
    await auth.createUser({ email: EMAIL, password: PASS, displayName: CLIENT_NAME });
    console.log('✓ נוצר משתמש ב-Authentication');
  } catch (e) {
    if (e.code !== 'auth/email-already-exists') throw e;
    const u = await auth.getUserByEmail(EMAIL);
    await auth.updateUser(u.uid, { password: PASS, displayName: CLIENT_NAME });
    console.log('✓ המשתמש כבר היה קיים — הסיסמה אופסה');
  }

  // ── 3. רשומת users. אותם שדות ש-lgProvisionClientFromHashavshevet כותב,
  //      כי זה המסלול שמייצר לקוח אמיתי מכרטיס חשבשבת ━ ר' firebase-db.js
  await db.ref('users/' + LOGIN_PHONE).set({
    id:               LOGIN_PHONE,
    phone:            LOGIN_PHONE,
    name:             CLIENT_NAME,
    businessName:     CLIENT_NAME,
    customerId:       ACCOUNT_KEY,
    hashavshevetCode: ACCOUNT_KEY,
    vatId:            '',
    role:             'client',
    active:           true,
    source:           'hashavshevet',
    linkedAt:         now,
    createdAt:        (existing.val() && existing.val().createdAt) || now,
    updatedAt:        now,
  });
  console.log('✓ users/' + LOGIN_PHONE + '  (role=client, customerId=' + ACCOUNT_KEY + ')');

  fs.writeFileSync(OUT,
    'LUZ GLASS TEST — לקוח בדיקות WhatsApp\n' +
    'פרויקט        : ' + pid + '\n' +
    'מפתח כרטיס    : ' + ACCOUNT_KEY + '\n' +
    'טלפון בכרטיס  : ' + CARD_PHONE + '   ← ההודעות יוצאות לכאן\n' +
    'טלפון התחברות : ' + LOGIN_PHONE + '\n' +
    'סיסמה         : ' + PASS + '\n' +
    'נוצר          : ' + new Date().toISOString() + '\n' +
    '\nההזמנות נפתחות על הלקוח הזה מ-admin. אל תסמן אותן "פיקטיביות" —\n' +
    'חשבשבת חסום ב-TEST ממילא, והדגל משתיק את ה-WhatsApp.\n', 'utf8');
  console.log('\n✓ הפרטים נכתבו ל-' + OUT + '  (מחוץ למאגר)');
  console.log('\nנותר: לפתוח הזמנות על "' + CLIENT_NAME + '" מ-admin.');
  process.exit(0);
})().catch(e => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
