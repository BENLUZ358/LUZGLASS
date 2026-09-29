#!/usr/bin/env node
/**
 * seed-test-data.js — מעתיק לסביבת TEST את שלושת הצמתים שבלעדיהם היא
 * חסרת תועלת, ושום דבר מעבר להם.
 *
 *   skuCatalog            בלעדיו כל פריט יוצא בלי sku ונדחה בשליחה
 *   prices/global         בלעדיו כל שורה נדחית ב"אין מחיר"
 *   shapeLibrary/factory  ספריית הצורות של בונה הסקיצות
 *
 * ומגדיר meta/orderCounter כך שהזמנות ב-TEST יהיו בטווח 9xxx ולא יתבלבלו
 * לעולם עם הפרודקשן.
 *
 * ⚠️ מה שלא מועתק, ובכוונה: orders · sketches · users · clients ·
 * hashavshevetAccounts (999 כרטיסי לקוח עם שם וטלפון — מידע אישי אמיתי) ·
 * prices/clients · workday · checkEdits.
 *
 * ⚠️ הכיוון נעול. הפרודקשן נקרא ב-once('value') בלבד; אין בקובץ הזה שום
 * כתיבה אליו, והנעילות למטה מוודאות שכל כתיבה הולכת ל-TEST.
 *
 *   node scripts/seed-test-data.js            תצוגה מקדימה בלבד
 *   node scripts/seed-test-data.js --apply    העתקה
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ROOT = path.join(__dirname, '..');
const PROD_KEY = path.join(ROOT, 'scripts', 'serviceAccountKey.json');
const PROD_DB  = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';
const TEST_KEY = process.env.LG_TEST_KEY || 'C:/Users/USER/luzglass-test-key.json';
const TEST_DB  = process.env.LG_TEST_DB  || '';
const APPLY    = process.argv.includes('--apply');
const COUNTER  = Number(process.env.LG_TEST_COUNTER || 9000);

const die = m => { console.error('✗ ' + m); process.exit(1); };

if (!fs.existsSync(PROD_KEY)) die('לא נמצא מפתח הפרודקשן');
if (!fs.existsSync(TEST_KEY)) die('לא נמצא מפתח ה-TEST ב-' + TEST_KEY);
if (!TEST_DB) die('חסרה LG_TEST_DB');

const prodSA = JSON.parse(fs.readFileSync(PROD_KEY, 'utf8'));
const testSA = JSON.parse(fs.readFileSync(TEST_KEY, 'utf8'));

// ── נעילות הכיוון ──
if (prodSA.project_id !== 'lussglass') die('מפתח המקור אינו של הפרודקשן — עצור');
if (testSA.project_id === 'lussglass') die('מפתח היעד הוא של הפרודקשן. הכיוון הפוך. עצור.');
if (/lussglass/.test(TEST_DB))         die('כתובת היעד היא הפרודקשן. עצור.');
if (!TEST_DB.includes(testSA.project_id)) die('אי-התאמה בין מפתח היעד לכתובתו');

const prod = getDatabase(initializeApp({ credential: cert(prodSA), databaseURL: PROD_DB  }, 'prod'));
const test = getDatabase(initializeApp({ credential: cert(testSA), databaseURL: TEST_DB }, 'test'));

const NODES = ['skuCatalog', 'prices/global', 'shapeLibrary/factory'];
const count = v => (v && typeof v === 'object') ? Object.keys(v).length : (v == null ? 0 : 1);
const sig   = v => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);
const kb    = v => (Buffer.byteLength(JSON.stringify(v ?? null), 'utf8') / 1024).toFixed(1) + ' KB';

(async () => {
  console.log('מקור : ' + prodSA.project_id + '  (קריאה בלבד)');
  console.log('יעד  : ' + testSA.project_id);
  console.log('');

  const data = {};
  for (const n of NODES) {
    data[n] = (await prod.ref(n).once('value')).val();
    console.log(`${n.padEnd(22)} ${String(count(data[n])).padStart(5)} רשומות  ${kb(data[n]).padStart(10)}  ${sig(data[n])}`);
  }
  console.log(`${'meta/orderCounter'.padEnd(22)} ${String(COUNTER).padStart(5)}  (הזמנה ראשונה תהיה L${COUNTER + 1})`);

  if (!APPLY) { console.log('\n(תצוגה מקדימה — לא נכתב כלום. להעתקה: --apply)\n'); process.exit(0); }

  console.log('\n— מעתיק —');
  for (const n of NODES) {
    if (data[n] == null) { console.log('  ' + n + ' ריק במקור — מדלג'); continue; }
    await test.ref(n).set(data[n]);
    console.log('  ✓ ' + n);
  }
  await test.ref('meta/orderCounter').set(COUNTER);
  console.log('  ✓ meta/orderCounter = ' + COUNTER);

  // ── אימות: כמויות וחתימות משני הצדדים ──
  console.log('\n— אימות —');
  let bad = 0;
  for (const n of NODES) {
    const got = (await test.ref(n).once('value')).val();
    const ok  = sig(got) === sig(data[n]) && count(got) === count(data[n]);
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${n.padEnd(22)} מקור ${count(data[n])} / יעד ${count(got)}  ${ok ? 'זהה' : 'שונה!'}`);
  }

  // ── מה יש ב-TEST בכלל: שום צומת מעבר למה שנועד ──
  const rootKeys = Object.keys((await test.ref('/').once('value', )).val() || {}).sort();
  const allowed  = ['users', 'skuCatalog', 'prices', 'shapeLibrary', 'meta'].sort();
  const extra    = rootKeys.filter(k => !allowed.includes(k));
  console.log('\n  צמתים ב-TEST : ' + rootKeys.join(', '));
  console.log('  ' + (extra.length ? '✗ צמתים לא צפויים: ' + extra.join(', ') : '✓ אין שום צומת מעבר למתוכנן'));

  // ── ומה שאסור היה לעבור ──
  console.log('');
  for (const n of ['orders', 'sketches', 'clients', 'hashavshevetAccounts', 'prices/clients', 'workday', 'checkEdits']) {
    const v = (await test.ref(n).once('value')).val();
    if (v != null) { bad++; console.log('  ✗ ' + n + ' קיים ב-TEST — לא היה אמור!'); }
    else console.log('  ✓ ' + n.padEnd(22) + ' ריק, כמתוכנן');
  }

  console.log(bad ? '\n✗ ' + bad + ' בעיות' : '\n✓ הכל תקין');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('נכשל: ' + (e.message || e)); process.exit(1); });
