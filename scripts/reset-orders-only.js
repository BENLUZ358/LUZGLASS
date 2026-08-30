// ═══════════════════════════════════════════════════════════════════
//  reset-orders-only.js
//  מאפס אך ורק את ההזמנות ואת מה שתלוי בהן — כדי להתחיל סבב בדיקות
//  נקי לפני עבודה אמיתית. לקוחות, מחירונים, קטלוג ומונים לא נוגעים.
//
//  זה לא reset-clients-clean-slate.js. ההוא מוחק גם לקוחות, חשבונות
//  Firebase Auth ומחירוני לקוח. כאן זה במפורש לא קורה.
//
//  מוחק:
//    · orders/     — ההזמנות עצמן
//    · sketches/   — הסקיצות, ממופתחות לפי מזהה הזמנה. בלי ההזמנה הן
//                    יתומות, ולא שורדת דרך למחוק אותן אחר כך. זה גם
//                    רוב המשקל של הבסיס.
//    · checkEdits/ — עריכות תחנת הבדיקה, גם הן לפי מזהה הזמנה
//    · workday/    — מצב העבודה הנוכחי, מצביע על הזמנות שנמחקות
//
//  לא נוגע:
//    · users/                — כל הלקוחות והאדמין, כולל חשבונות Auth
//    · prices/               — global וגם clientKeys
//    · skuCatalog/           — קטלוג המק"טים מחשבשבת
//    · hashavshevetAccounts/ — כרטיסי הלקוח מחשבשבת
//    · meta/                 — מוני מספרי ההזמנות והחשבוניות
//
//  על המונים: הם נשארים בכוונה. כבר הופקו בחשבשבת מסמכים אמיתיים
//  שנושאים מספרים מהמונים האלה. אם המונה יתאפס, הזמנה חדשה תקבל מספר
//  שכבר תפוס על מסמך אמיתי בהנהלת החשבונות. למי שבכל זאת רוצה מספור
//  מאפס — יש --reset-counters, ולא כדאי.
//
//  איך להריץ:
//  ────────────────────────────────────────────────────────────────
//  1. תצוגה בלבד (ברירת מחדל, לא מוחק כלום):
//       node scripts/reset-orders-only.js
//
//  2. מחיקה בפועל — כותב גיבוי מקומי לפני שהוא מוחק:
//       node scripts/reset-orders-only.js --delete
// ═══════════════════════════════════════════════════════════════════

'use strict';

const path = require('path');
const fs   = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase }         = require('firebase-admin/database');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const DRY_RUN  = !process.argv.includes('--delete');
const RESET_COUNTERS = process.argv.includes('--reset-counters');

// נמחקים במלואם. כולם ממופתחים לפי מזהה הזמנה או נגזרים ממנו.
const NODES_TO_WIPE = ['orders', 'sketches', 'checkEdits', 'workday'];
// חייבים לשרוד. נבדקים באימות הסופי, ואם אחד מהם ריק — הריצה נכשלת.
const NODES_TO_KEEP = ['users', 'prices', 'skuCatalog', 'meta'];

if (!fs.existsSync(KEY_PATH)) {
  console.error('✗ לא נמצא scripts/serviceAccountKey.json');
  process.exit(1);
}

const app = initializeApp({
  credential: cert(require(KEY_PATH)),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'
});
const db = getDatabase(app);

function fmtKB(bytes) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + ' MB'
    : Math.round(bytes / 1024) + ' KB';
}

async function inspect(nodePath) {
  const snap = await db.ref(nodePath).once('value');
  if (!snap.exists()) return { count: 0, bytes: 0, val: null };
  const val = snap.val();
  return {
    count: (val && typeof val === 'object') ? Object.keys(val).length : 1,
    bytes: Buffer.byteLength(JSON.stringify(val), 'utf8'),
    val,
  };
}

async function main() {
  console.log(DRY_RUN
    ? '🔍 תצוגה בלבד — שום דבר לא יימחק.\n   למחיקה אמיתית: node scripts/reset-orders-only.js --delete\n'
    : '⚠️  מחיקה אמיתית. גיבוי מקומי נכתב לפני כן.\n');

  // ── מה יימחק ─────────────────────────────────────────────────────
  console.log('── יימחק ────────────────────────────────────────');
  const wipe = {};
  let totalBytes = 0;
  for (const node of NODES_TO_WIPE) {
    const info = await inspect(node);
    wipe[node] = info;
    totalBytes += info.bytes;
    console.log(`   ✗ ${node.padEnd(12)} ${String(info.count).padStart(5)} רשומות   ${fmtKB(info.bytes).padStart(9)}`);
  }
  console.log(`     ${''.padEnd(12)} ${''.padStart(5)}            ${fmtKB(totalBytes).padStart(9)}  סה"כ`);

  // ── מה יישאר ─────────────────────────────────────────────────────
  console.log('\n── יישאר ללא שינוי ──────────────────────────────');
  for (const node of NODES_TO_KEEP) {
    const info = await inspect(node);
    console.log(`   ✓ ${node.padEnd(22)} ${String(info.count).padStart(4)} רשומות`);
  }

  // המונים בשמם המלא — זה מה שקובע איזה מספר תקבל ההזמנה הבאה
  const meta = (await inspect('meta')).val || {};
  console.log('\n── מונים ────────────────────────────────────────');
  for (const k of ['orderCounter', 'chisumCounter', 'invoiceCounter']) {
    const v = meta[k];
    console.log(`   ${RESET_COUNTERS ? '✗' : '✓'} meta/${k.padEnd(16)} ${v == null ? '(ריק)' : v}`
      + (RESET_COUNTERS ? '   → יאופס' : '   → נשאר'));
  }
  if (RESET_COUNTERS) {
    console.log('\n   ⚠️  איפוס מונים: מסמכים אמיתיים בחשבשבת כבר נושאים מספרים');
    console.log('      מהטווח הזה. הזמנה חדשה עלולה לקבל מספר תפוס.');
  }

  if (DRY_RUN) {
    console.log('\n🔍 סיום תצוגה. לא נמחק כלום.');
    process.exit(0);
  }

  // ── גיבוי לפני מחיקה ─────────────────────────────────────────────
  // מחיקה ב-RTDB היא בלתי הפיכה ואין סל מיחזור. הגיבוי נכתב לפני
  // הפעולה הראשונה, ואם הכתיבה נכשלת — לא מוחקים כלום.
  const stamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(__dirname, '..', 'backups');
  const outFile = path.join(outDir, `orders-backup-${stamp}.json`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const payload = {};
    for (const node of NODES_TO_WIPE) payload[node] = wipe[node].val;
    fs.writeFileSync(outFile, JSON.stringify(payload), 'utf8');
    const written = fs.statSync(outFile).size;
    console.log(`\n💾 גיבוי נכתב: ${path.relative(path.join(__dirname, '..'), outFile)}  (${fmtKB(written)})`);
    if (written < 2) throw new Error('הגיבוי ריק');
  } catch (err) {
    console.error(`\n✗ הגיבוי נכשל — לא נמחק כלום: ${err.message}`);
    process.exit(1);
  }

  // ── מחיקה ────────────────────────────────────────────────────────
  console.log('\n── מוחק ─────────────────────────────────────────');
  const failed = [];
  for (const node of NODES_TO_WIPE) {
    try {
      await db.ref(node).remove();
      console.log(`   ✓ נמחק: ${node}`);
    } catch (err) {
      failed.push({ node, reason: err.message });
      console.error(`   ✗ נכשל: ${node} — ${err.message}`);
    }
  }
  if (RESET_COUNTERS) {
    for (const k of ['orderCounter', 'chisumCounter', 'invoiceCounter']) {
      try { await db.ref('meta/' + k).remove(); console.log(`   ✓ אופס: meta/${k}`); }
      catch (err) { failed.push({ node: 'meta/' + k, reason: err.message }); }
    }
  }

  // ── אימות ────────────────────────────────────────────────────────
  console.log('\n══════════════ אימות ══════════════');
  const checks = [];
  for (const node of NODES_TO_WIPE) {
    const n = (await inspect(node)).count;
    checks.push({ name: `${node} ריק`, ok: n === 0, detail: `${n} רשומות` });
  }
  for (const node of NODES_TO_KEEP) {
    const n = (await inspect(node)).count;
    checks.push({ name: `${node} שרד`, ok: n > 0, detail: `${n} רשומות` });
  }
  if (!RESET_COUNTERS) {
    const after = (await inspect('meta')).val || {};
    checks.push({
      name: 'המונים לא זזו',
      ok: after.orderCounter === meta.orderCounter,
      detail: `orderCounter=${after.orderCounter}`
    });
  }
  checks.forEach(c => console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`));

  const allOk = checks.every(c => c.ok) && failed.length === 0;
  console.log(allOk
    ? `\n✅ ההזמנות אופסו. הלקוחות, המחירונים והקטלוג לא נגעו.\n   גיבוי: ${path.relative(path.join(__dirname, '..'), outFile)}`
    : `\n⚠️  יש בעיות — עבור על האימות.\n   גיבוי: ${outFile}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(err => { console.error('✗ שגיאה כללית:', err); process.exit(1); });
