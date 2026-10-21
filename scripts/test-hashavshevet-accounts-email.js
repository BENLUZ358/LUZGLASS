#!/usr/bin/env node
/**
 * שדה דוא"ל מכרטיס הלקוח בחשבשבת — lgPickAccountEmail + העברתו עד Firebase.
 * Run: node scripts/test-hashavshevet-accounts-email.js
 */
const path = require('path');
const fs   = require('fs');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

// ⚠️ _verifyAdmin מושך firebase-admin (לא נחוץ כאן, ולא מותקן בכל עץ עבודה) —
//    מחליפים אותו במטמון ה-require כדי שהטעינה לא תצטרך רשת/סביבה/חבילות.
const vaPath = require.resolve(path.join(ROOT, 'api', '_verifyAdmin.js'));
require.cache[vaPath] = { id: vaPath, filename: vaPath, loaded: true, exports: { verifyAdmin: async () => null } };

const mod  = require(path.join(ROOT, 'api', 'hashavshevet-accounts.js'));
const pick = mod.lgPickAccountEmail;
check('A0 הפונקציה מיוצאת', typeof pick, 'function');
if (typeof pick === 'function') {
  check('A1 עמודה בעברית, מנוקה מרווחים', pick({ 'דואר אלקטרוני': ' a@b.com ' }), 'a@b.com');
  check('A2 E-mail עם כמה כתובות — גולמי', pick({ 'E-mail': 'x@y.co.il; z@w.com' }), 'x@y.co.il; z@w.com');
  check('A3 אין עמודת דוא"ל', pick({ 'טלפון': '050' }), '');
  check('A4 עמודה ריקה — עוברים לבאה', pick({ 'מייל': '  ', 'e-mail 2': 'q@r.com' }), 'q@r.com');
  check('A5 קלט ריק', pick(null), '');
}

const fb = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const fn = fb.slice(fb.indexOf('async function syncHashavshevetAccount'));
check('B1 ה-whitelist של syncHashavshevetAccount כולל email',
      /\[[^\]]*'email'[^\]]*\]\.forEach/.test(fn.slice(0, 600)), true);

const adm = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
check('C1 admin.html מעביר email: acc.email',
      /syncHashavshevetAccount\(acc\.key,\s*\{[^}]*email:\s*acc\.email/.test(adm), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll email-field checks passed.');
