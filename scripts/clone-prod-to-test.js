#!/usr/bin/env node
/**
 * clone-prod-to-test.js — משכפל את הקונפיגורציה של הפרודקשן ל-TEST,
 * ומשאיר את TEST נקי מהזמנות.
 *
 * המטרה: TEST שמתנהג כמעט בדיוק כמו הפרודקשן, בלי ההזמנות הקיימות ועם
 * סדרת מספרים 9000+ שמזוהה מיד.
 *
 * ── עובר ──
 *   skuCatalog            200 מק"טים
 *   prices                global + clients + clientKeys + clientPriceList
 *   shapeLibrary/factory  ספריית הצורות
 *   users                 5 רשומות, עם role/customerId/monthlyBilling/isDelivery
 *   + חשבון Auth לכל משתמש, עם סיסמה חדשה שנוצרת כאן
 *
 * ── לא עובר, בהחלטת בן 2026-09-30 ──
 *   hashavshevetAccounts  999 כרטיסי לקוח עם שם וטלפון — מידע אישי אמיתי
 *   orders · sketches · workday · checkEdits   הזמנות וכל הנגזר מהן
 *   password hashes       סיסמאות של לקוחות אמיתיים לא משוכפלות לסביבה שנייה
 *
 * ── מתאפס ──
 *   meta/orderCounter · chisumCounter · invoiceCounter  →  9000
 *
 * הפרודקשן נקרא בלבד. אין בקובץ הזה שום set/update/delete מולו, וחתימת
 * המצב שלו נלקחת לפני ואחרי כדי להוכיח שלא זז.
 *
 *   node scripts/clone-prod-to-test.js            תצוגה מקדימה
 *   node scripts/clone-prod-to-test.js --apply    ביצוע
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');

const ROOT = path.join(__dirname, '..');
const PROD_KEY = path.join(ROOT, 'scripts', 'serviceAccountKey.json');
const PROD_DB  = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';
const TEST_KEY = process.env.LG_TEST_KEY || 'C:/Users/USER/luzglass-test-key.json';
const TEST_DB  = process.env.LG_TEST_DB  || '';
const PASS_OUT = process.env.LG_TEST_PASSWORDS || 'C:/Users/USER/luzglass-test-users.txt';
const APPLY    = process.argv.includes('--apply');
const COUNTER  = 9000;

const die = m => { console.error('\n[X] ' + m); process.exit(1); };

if (!fs.existsSync(PROD_KEY)) die('לא נמצא מפתח הפרודקשן');
if (!fs.existsSync(TEST_KEY)) die('לא נמצא מפתח ה-TEST ב-' + TEST_KEY);
if (!TEST_DB) die('חסרה LG_TEST_DB');
// הסיסמאות לא נכתבות לתוך המאגר, בשום מצב
if (path.resolve(PASS_OUT).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()))
  die('קובץ הסיסמאות מכוון לתוך תיקיית המאגר. חייב להיות מחוץ לה.');

const prodSA = JSON.parse(fs.readFileSync(PROD_KEY, 'utf8'));
const testSA = JSON.parse(fs.readFileSync(TEST_KEY, 'utf8'));

// ── נעילות הכיוון ──
if (prodSA.project_id !== 'lussglass')    die('מפתח המקור אינו של הפרודקשן');
if (testSA.project_id === 'lussglass')    die('מפתח היעד הוא הפרודקשן. הכיוון הפוך. עצור.');
if (/lussglass/.test(TEST_DB))            die('כתובת היעד היא הפרודקשן. עצור.');
if (!TEST_DB.includes(testSA.project_id)) die('אי-התאמה בין מפתח היעד לכתובתו');

const prodApp = initializeApp({ credential: cert(prodSA), databaseURL: PROD_DB }, 'prod');
const testApp = initializeApp({ credential: cert(testSA), databaseURL: TEST_DB }, 'test');
const prod = getDatabase(prodApp), test = getDatabase(testApp);

const COPY  = ['skuCatalog', 'prices', 'shapeLibrary/factory', 'users'];
const NEVER = ['hashavshevetAccounts', 'orders', 'sketches', 'workday', 'checkEdits'];

const sig   = v => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);
const count = v => (v && typeof v === 'object') ? Object.keys(v).length : (v == null ? 0 : 1);

// חתימת המצב של הפרודקשן — כדי להוכיח אחר כך שלא זז
async function prodFingerprint() {
  const fp = {};
  for (const n of [...COPY, ...NEVER, 'meta']) fp[n] = sig((await prod.ref(n).once('value')).val());
  const au = await getAuth(prodApp).listUsers(1000);
  fp['__auth'] = sig(au.users.map(u => [u.uid, u.email || '', u.disabled, u.passwordHash || '']).sort());
  return fp;
}

(async () => {
  console.log('מקור : ' + prodSA.project_id + '   (קריאה בלבד)');
  console.log('יעד  : ' + testSA.project_id);

  const before = await prodFingerprint();

  console.log('\n-- עובר --');
  const data = {};
  for (const n of COPY) {
    data[n] = (await prod.ref(n).once('value')).val();
    console.log('  ' + n.padEnd(22) + String(count(data[n])).padStart(5) + ' רשומות');
  }
  const users = data['users'] || {};
  console.log('\n-- חשבונות Auth שייווצרו --');
  Object.values(users).forEach(u => console.log('  ' + String(u.phone).padEnd(13) +
    (u.role || '-').padEnd(8) + (u.businessName || u.name || '')));
  console.log('\n-- מתאפס --');
  console.log('  meta/orderCounter . chisumCounter . invoiceCounter -> ' + COUNTER);
  console.log('\n-- לא עובר --');
  for (const n of NEVER) {
    const c = count((await prod.ref(n).once('value')).val());
    console.log('  ' + n.padEnd(22) + String(c).padStart(5) + ' רשומות במקור');
  }

  if (!APPLY) { console.log('\n(תצוגה מקדימה - לא נכתב כלום. לביצוע: --apply)\n'); process.exit(0); }

  // ── כתיבה ל-TEST בלבד ──
  console.log('\n-- כותב ל-' + testSA.project_id + ' --');
  for (const n of COPY) {
    if (data[n] == null) { console.log('  ' + n + ' ריק במקור - מדלג'); continue; }
    // update ולא set על users, כדי לא למחוק את אדמין הבדיקה שכבר קיים שם
    if (n === 'users') await test.ref(n).update(data[n]);
    else               await test.ref(n).set(data[n]);
    console.log('  [v] ' + n);
  }
  await test.ref('meta').update({ orderCounter: COUNTER, chisumCounter: COUNTER, invoiceCounter: COUNTER });
  console.log('  [v] meta x3 = ' + COUNTER);

  // ── חשבונות Auth ב-TEST, עם סיסמאות חדשות ──
  console.log('\n-- Auth ב-TEST --');
  const testAuth = getAuth(testApp);
  const creds = [];
  for (const u of Object.values(users)) {
    const phone = String(u.phone);
    const email = phone + '@luzglass.local';
    const pass  = crypto.randomBytes(12).toString('base64url');
    const name  = u.businessName || u.name || phone;
    try {
      await testAuth.createUser({ email, password: pass, displayName: name });
      console.log('  [v] נוצר  ' + phone);
    } catch (e) {
      if (e.code !== 'auth/email-already-exists') throw e;
      const ex = await testAuth.getUserByEmail(email);
      await testAuth.updateUser(ex.uid, { password: pass, displayName: name });
      console.log('  [v] אופס  ' + phone + '  (כבר היה קיים)');
    }
    creds.push({ phone, name, role: u.role || '', pass });
  }

  fs.writeFileSync(PASS_OUT,
    'LUZ GLASS TEST - סיסמאות משתמשים\n' +
    'פרויקט: ' + testSA.project_id + '\n' +
    'נוצר  : ' + new Date().toISOString() + '\n' +
    'סיסמאות חדשות. אינן הסיסמאות של הפרודקשן.\n' +
    '--------------------------------------------\n' +
    creds.map(c => c.phone.padEnd(13) + c.role.padEnd(8) + c.pass.padEnd(20) + c.name).join('\n') +
    '\n\nלא לשתף. לא להעלות למאגר.\n', 'utf8');
  console.log('\n  [v] הסיסמאות נשמרו ב: ' + PASS_OUT);
  console.log('      (לא מודפסות כאן, ומחוץ למאגר)');

  // ── אימות היעד ──
  console.log('\n-- אימות TEST --');
  let bad = 0;
  for (const n of COPY) {
    const got = (await test.ref(n).once('value')).val();
    const ok = n === 'users' ? count(got) >= count(data[n]) : sig(got) === sig(data[n]);
    if (!ok) bad++;
    console.log('  ' + (ok ? '[v]' : '[X]') + ' ' + n.padEnd(22) + 'מקור ' + count(data[n]) + ' / יעד ' + count(got));
  }
  const m = (await test.ref('meta').once('value')).val() || {};
  const metaOk = m.orderCounter === COUNTER && m.chisumCounter === COUNTER && m.invoiceCounter === COUNTER;
  if (!metaOk) bad++;
  console.log('  ' + (metaOk ? '[v]' : '[X]') + ' meta                  ' + JSON.stringify(m));
  for (const n of NEVER) {
    const v = (await test.ref(n).once('value')).val();
    if (v != null) { bad++; console.log('  [X] ' + n.padEnd(22) + 'קיים ב-TEST - לא היה אמור!'); }
    else console.log('  [v] ' + n.padEnd(22) + 'ריק, כמתוכנן');
  }
  const rootKeys = Object.keys((await test.ref('/').once('value')).val() || {}).sort();
  console.log('  צמתים ב-TEST: ' + rootKeys.join(', '));

  // ── אימות שהפרודקשן לא זז ──
  console.log('\n-- אימות שהפרודקשן לא השתנה --');
  const after = await prodFingerprint();
  let moved = 0;
  for (const k of Object.keys(before)) {
    const same = before[k] === after[k];
    if (!same) moved++;
    console.log('  ' + (same ? '[v]' : '[!!]') + ' ' + (k === '__auth' ? 'Firebase Auth' : k).padEnd(22) + (same ? 'זהה' : 'השתנה!'));
  }
  if (moved) { console.error('\n[!!] הפרודקשן השתנה - זו תקלה חמורה'); process.exit(1); }

  console.log(bad ? '\n[X] ' + bad + ' בעיות ב-TEST' : '\n[v] הכל תקין. הפרודקשן לא זז.');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('נכשל: ' + (e.message || e)); process.exit(1); });
