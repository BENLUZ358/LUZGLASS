// ═══════════════════════════════════════════════════════════════════
//  reset-clients-clean-slate.js
//  סקריפט חד-פעמי: מנקה את כל לקוחות העבר וההזמנות ההיסטוריות, כדי
//  להתחיל בסיס נקי שבו כל לקוח נוצר אך ורק מתוך כרטיס לקוח בחשבשבת.
//
//  מוחק:
//    · users/{phone} עם role==='client'  — גם רשומת ה-DB וגם חשבון
//      ה-Firebase Auth שלה (כדי שלא יישארו חשבונות "יתומים" שיכולים
//      להתנגש בעתיד עם auth/uid-already-exists)
//    · orders/           — כל ההזמנות ההיסטוריות
//    · checkEdits/       — רשומות עריכה שמצביעות על אותן הזמנות
//    · prices/clientKeys/ — מחירוני לקוח לפי שם, שייכים ללקוחות שנמחקים
//    · workday/          — state עבודה נוכחי שמצביע על הזמנות שנמחקות
//
//  לא נוגע (במפורש):
//    · האדמין — כל user עם role==='admin' או טלפון == MAIN_ADMIN_PHONE
//    · skuCatalog/    — קטלוג המק"טים המסונכרן מחשבשבת
//    · prices/global  — המחירים הכלליים המסונכרנים מחשבשבת
//    · meta/          — מונה מספרי ההזמנות (המשכיות מספור)
//    · hashavshevetAccounts/ — כרטיסי הלקוח מחשבשבת
//
//  איך להריץ (מהמחשב שלך — לא בשרת, לא ב-Vercel):
//  ────────────────────────────────────────────────────────────────
//  1. ודא שקיים scripts/serviceAccountKey.json (ראה migrate-users-to-auth.js)
//
//  2. הרצה ראשונה — תצוגה בלבד, לא מוחק כלום:
//       node scripts/reset-clients-clean-slate.js
//
//  3. עבור על הרשימה שמודפסת. רק אם היא נכונה — הרץ בפועל:
//       node scripts/reset-clients-clean-slate.js --delete
//
//  4. בסוף הריצה מודפס דוח אימות שמוודא שהמחיקה הושלמה ושהאדמין,
//     הקטלוג והמחירים נשארו שלמים.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const path = require('path');
const fs   = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase }         = require('firebase-admin/database');
const { getAuth }             = require('firebase-admin/auth');

const KEY_PATH         = path.join(__dirname, 'serviceAccountKey.json');
const MAIN_ADMIN_PHONE = '0547725552';
const DRY_RUN          = !process.argv.includes('--delete');

// צמתים שנמחקים במלואם
const NODES_TO_WIPE = ['orders', 'checkEdits', 'prices/clientKeys', 'workday'];
// צמתים שחייבים לשרוד — נבדקים באימות הסופי
const NODES_TO_KEEP = ['skuCatalog', 'prices/global', 'meta'];

if (!fs.existsSync(KEY_PATH)) {
  console.error('✗ לא נמצא scripts/serviceAccountKey.json — ראה הוראות בראש הקובץ.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert(require(KEY_PATH)),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'
});

const db   = getDatabase(app);
const auth = getAuth(app);

function normalizePhone(p) { return String(p || '').replace(/[-\s]/g, ''); }

// הגנה כפולה על האדמין: גם לפי role וגם לפי מספר הטלפון הקבוע
function isProtectedAdmin(u) {
  return u.role === 'admin' || normalizePhone(u.phone || u.id) === MAIN_ADMIN_PHONE;
}

async function countAt(nodePath) {
  const snap = await db.ref(nodePath).once('value');
  if (!snap.exists()) return 0;
  const val = snap.val();
  return (val && typeof val === 'object') ? Object.keys(val).length : 1;
}

async function main() {
  console.log(DRY_RUN
    ? '🔍 מצב תצוגה בלבד (DRY RUN) — שום דבר לא יימחק.\n   להרצה אמיתית: node scripts/reset-clients-clean-slate.js --delete\n'
    : '⚠️  מצב מחיקה אמיתי — הנתונים יימחקו לצמיתות.\n');

  // ── 1. סריקת משתמשים ──────────────────────────────────────────────
  const snap = await db.ref('users').once('value');
  const users = snap.exists() ? Object.values(snap.val()) : [];
  const clients = users.filter(u => !isProtectedAdmin(u));
  const admins  = users.filter(u => isProtectedAdmin(u));

  console.log('── משתמשים ──────────────────────────────────────');
  console.log(`סה"כ ב-users/: ${users.length}`);
  console.log(`ישמרו (אדמין): ${admins.length}`);
  admins.forEach(u => console.log(`   ✓ נשאר: ${normalizePhone(u.phone || u.id)}  (role=${u.role})`));
  console.log(`יימחקו (לקוחות): ${clients.length}`);
  clients.forEach(u => console.log(`   ✗ יימחק: ${normalizePhone(u.phone || u.id)}  (role=${u.role})`));

  // ── 2. צמתים למחיקה ──────────────────────────────────────────────
  console.log('\n── צמתים למחיקה ─────────────────────────────────');
  for (const node of NODES_TO_WIPE) {
    console.log(`   ✗ ${node}  (${await countAt(node)} רשומות)`);
  }
  console.log('\n── צמתים שיישמרו ────────────────────────────────');
  for (const node of NODES_TO_KEEP) {
    console.log(`   ✓ ${node}  (${await countAt(node)} רשומות)`);
  }

  if (DRY_RUN) {
    console.log('\n🔍 סיום תצוגה. לא בוצעה שום מחיקה.');
    process.exit(0);
  }

  // ── 3. מחיקה בפועל ───────────────────────────────────────────────
  const report = { authDeleted: [], authMissing: [], dbDeleted: [], failed: [] };

  console.log('\n── מוחק לקוחות ──────────────────────────────────');
  for (const u of clients) {
    const phone = normalizePhone(u.phone || u.id);
    if (!phone) { report.failed.push({ user: u, reason: 'אין מספר טלפון' }); continue; }

    // חשבון Auth (uid = טלפון, לפי המוסכמה שנקבעה ב-migrate-users-to-auth.js)
    try {
      await auth.deleteUser(phone);
      report.authDeleted.push(phone);
      console.log(`   ✓ נמחק חשבון Auth: ${phone}`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        report.authMissing.push(phone);
        console.log(`   · לא היה חשבון Auth: ${phone}`);
      } else {
        report.failed.push({ phone, reason: `Auth: ${err.message}` });
        console.error(`   ✗ נכשלה מחיקת Auth: ${phone} — ${err.message}`);
      }
    }

    // רשומת RTDB
    try {
      await db.ref('users/' + phone).remove();
      report.dbDeleted.push(phone);
      console.log(`   ✓ נמחקה רשומת users/: ${phone}`);
    } catch (err) {
      report.failed.push({ phone, reason: `DB: ${err.message}` });
      console.error(`   ✗ נכשלה מחיקת users/: ${phone} — ${err.message}`);
    }
  }

  console.log('\n── מוחק צמתים ───────────────────────────────────');
  for (const node of NODES_TO_WIPE) {
    try {
      await db.ref(node).remove();
      console.log(`   ✓ נמחק: ${node}`);
    } catch (err) {
      report.failed.push({ node, reason: err.message });
      console.error(`   ✗ נכשל: ${node} — ${err.message}`);
    }
  }

  // ── 4. אימות ─────────────────────────────────────────────────────
  console.log('\n══════════════ אימות ══════════════');
  const checks = [];

  const afterUsersSnap = await db.ref('users').once('value');
  const afterUsers = afterUsersSnap.exists() ? Object.values(afterUsersSnap.val()) : [];
  const leftoverClients = afterUsers.filter(u => !isProtectedAdmin(u));
  checks.push({
    name: 'users/ מכיל אדמין בלבד',
    ok: leftoverClients.length === 0 && afterUsers.length > 0,
    detail: `${afterUsers.length} משתמשים, מתוכם ${leftoverClients.length} לקוחות שנותרו`
  });

  for (const node of NODES_TO_WIPE) {
    const n = await countAt(node);
    checks.push({ name: `${node} ריק`, ok: n === 0, detail: `${n} רשומות` });
  }
  for (const node of NODES_TO_KEEP) {
    const n = await countAt(node);
    checks.push({ name: `${node} נשמר`, ok: n > 0, detail: `${n} רשומות` });
  }

  // אין חשבונות Auth יתומים — כל uid חייב להתאים למשתמש קיים ב-users/
  const validUids = new Set(afterUsers.map(u => normalizePhone(u.phone || u.id)));
  const listed = await auth.listUsers(1000);
  const orphans = listed.users.map(r => r.uid).filter(uid => !validUids.has(uid));
  checks.push({
    name: 'אין חשבונות Auth יתומים',
    ok: orphans.length === 0,
    detail: orphans.length ? `יתומים: ${orphans.join(', ')}` : `${listed.users.length} חשבונות, כולם תקינים`
  });

  checks.forEach(c => console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`));

  console.log('\n══════════════ דוח סופי ══════════════');
  console.log(`חשבונות Auth שנמחקו:  ${report.authDeleted.length}`);
  console.log(`לא היה להם Auth:      ${report.authMissing.length}`);
  console.log(`רשומות users/ שנמחקו: ${report.dbDeleted.length}`);
  console.log(`כשלונות:              ${report.failed.length}`, report.failed);
  console.log('════════════════════════════════════');

  const allOk = checks.every(c => c.ok) && report.failed.length === 0;
  console.log(allOk
    ? '\n✅ הניקוי הושלם בהצלחה. עכשיו: התחבר כאדמין, לחץ "סנכרן לקוחות מחשבשבת", וצור לקוחות מהכרטיסים.'
    : '\n⚠️  יש בעיות — עבור על האימות והכשלונות לפני שממשיכים.');

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('✗ שגיאה כללית:', err);
  process.exit(1);
});
