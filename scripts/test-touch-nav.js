#!/usr/bin/env node
/**
 * ניווט במסכי מגע (גל 2, 06/10).
 *
 * 1. פריטי התפריט הצדדי (.unav-a) — 38px בטלפון. lg-ui.css כבר מגדיל כל
 *    button ו-[onclick] ל-44px במסך מגע, אבל פריטי התפריט הם <a href>
 *    בלי onclick ולכן חמקו. התיקון במקום אחד, בקובץ המשותף, ורק במצביע
 *    גס — הדסקטופ נשאר צפוף.
 * 2. שרטט: שתי שורות כותרת אחת מעל השנייה, שתיהן עם הלוגו, וקישור
 *    "← אדמין" בגובה 18px.
 *
 * Run: node scripts/test-touch-nav.js
 */
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const UI = read('lg-ui.css');
const coarse = (UI.match(/@media \(pointer:coarse\)\{\s*button,[\s\S]*?min-height:var\(--touch-min\);/) || [''])[0];
check('the shared touch-target rule is found', coarse.length > 0, true);
check('it covers the side-menu items', /\.unav-a/.test(coarse), true);

/* כל דף שמשתמש בתפריט טוען את הקובץ המשותף — אחרת התיקון לא מגיע אליו */
for (const page of ['admin.html', 'check-station.html', 'drafter.html', 'workday.html']) {
  const t = read(page);
  if (!/class="unav-a/.test(t)) continue;
  check(`${page} loads lg-ui.css, so its menu gets the fix`, /lg-ui\.css/.test(t), true);
}

const D = read('drafter.html');
const narrow = (D.match(/\/\* ─ שרטט במסך צר[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the drafter has a narrow-screen header rule', narrow.length > 0, true);
check('the second logo goes, the burger bar already has one', /\.topbar \.logo\{display:none/.test(narrow), true);
check('the back link is a real touch target', /\.back-link\{[^}]*min-height:44px/.test(narrow), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll touch-navigation checks passed.');
