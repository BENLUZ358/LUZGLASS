#!/usr/bin/env node
/**
 * deploy-rules-test.js — פורס את database.rules.json לפרויקט ה-TEST בלבד.
 *
 * למה קובץ נפרד ולא דגל ל-deploy-rules.js: שם כתובת הפרודקשן נעולה בקוד,
 * וזו תכונה ולא חיסרון — אי אפשר לפרוס לשם בטעות. כאן הכיוון הפוך, ולכן
 * הקובץ הזה מסרב לגעת בפרודקשן בכלל.
 *
 * ⚠️ שלוש נעילות, וכולן חייבות לעבור לפני שמשהו נכתב:
 *   1. project_id במפתח השירות אסור שיהיה 'lussglass'
 *   2. כתובת ה-DB אסור שתכיל 'lussglass'
 *   3. שם הפרויקט במפתח חייב להתאים לכתובת ה-DB
 *
 * המפתח יושב מחוץ למאגר בכוונה — מפתח שירות בתוך תיקיית git הוא דליפה
 * שמחכה לקרות, ו-.gitignore מגן רק על השם המדויק שרשום בו.
 *
 *   node scripts/deploy-rules-test.js --check    השוואה בלבד
 *   node scripts/deploy-rules-test.js            פריסה
 *
 * משתני סביבה (או ברירות המחדל למטה):
 *   LG_TEST_KEY   נתיב לקובץ מפתח השירות של פרויקט ה-TEST
 *   LG_TEST_DB    כתובת ה-Realtime Database של פרויקט ה-TEST
 */
const fs = require('fs'), path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');

const ROOT = path.join(__dirname, '..');
const KEY  = process.env.LG_TEST_KEY || 'C:/Users/USER/luzglass-test-key.json';
const DB   = process.env.LG_TEST_DB  || '';
const CHECK = process.argv.includes('--check');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!fs.existsSync(KEY)) {
  die('לא נמצא מפתח שירות ב-' + KEY + '\n' +
      '  Firebase Console → הפרויקט של TEST → ⚙️ Project settings → Service accounts\n' +
      '  → Generate new private key, ולשמור בנתיב הזה.');
}
if (!DB) die('חסרה כתובת ה-Database. הרץ עם  LG_TEST_DB=https://...firebasedatabase.app');

let sa;
try { sa = JSON.parse(fs.readFileSync(KEY, 'utf8')); }
catch (e) { die('קובץ המפתח אינו JSON תקין: ' + e.message); }

// ── נעילות הבטיחות ──
const pid = String(sa.project_id || '');
if (!pid) die('במפתח השירות אין project_id');
if (pid === 'lussglass' || /lussglass/.test(DB)) {
  die('עצור. המפתח או הכתובת שייכים לפרודקשן (lussglass).\n' +
      '  הקובץ הזה פורס אך ורק ל-TEST. לפרודקשן יש scripts/deploy-rules.js.');
}
if (!DB.includes(pid)) {
  die('אי-התאמה: המפתח הוא של "' + pid + '" והכתובת היא ' + DB + '\n' +
      '  שניהם חייבים להיות אותו פרויקט, אחרת הפריסה הולכת למקום לא צפוי.');
}

const local = fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8');
const app = initializeApp({ credential: cert(sa), databaseURL: DB });

(async () => {
  console.log('פרויקט: ' + pid);
  console.log('כתובת : ' + DB);
  const t = (await app.options.credential.getAccessToken()).access_token;
  const get = await fetch(`${DB}/.settings/rules.json?access_token=${t}`);
  if (!get.ok) die('קריאת החוקים הקיימים נכשלה: HTTP ' + get.status + ' ' + (await get.text()).slice(0, 200));
  const live = await get.text();
  const norm = s => { try { return JSON.stringify(JSON.parse(s)); } catch (_) { return s; } };

  if (norm(live) === norm(local)) { console.log('✓ החוקים הפרוסים כבר זהים לקובץ.'); process.exit(0); }
  console.log('הפרוס שונה מהקובץ (' + local.length + ' תווים לפריסה).');
  if (CHECK) process.exit(1);

  const put = await fetch(`${DB}/.settings/rules.json?access_token=${t}`, { method: 'PUT', body: local });
  console.log(put.ok ? '✓ נפרס בהצלחה ל-' + pid
                     : '✗ נכשל: HTTP ' + put.status + ' ' + (await put.text()).slice(0, 200));
  process.exit(put.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
