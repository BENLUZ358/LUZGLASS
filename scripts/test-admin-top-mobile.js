#!/usr/bin/env node
/**
 * ראש הדף באדמין (בן, 06/10):
 *   • הכרטיסים "שווי כולל" ו"מוכנות לאיסוף" → "תור סקיצות" ו"שרטט",
 *     ולחיצה עליהם פותחת את התור / את השרטט
 *   • חיפוש בטלפון — היה מוסתר ב-≤600 (display:none), בלי חלופה
 *
 * Run: node scripts/test-admin-top-mobile.js
 */
const fs   = require('fs');
const path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const stats = (A.match(/function renderStats\(\)\{[\s\S]*?\n}/) || [''])[0];
check('renderStats is found', stats.length > 0, true);
check('no "total value" card', /שווי כולל/.test(stats), false);
check('no "ready for pickup" card', /מוכנות לאיסוף/.test(stats), false);
check('a sketch-queue card that opens the queue', /onclick="openSketchQueue\(\)"[^>]*>[\s\S]*?תור סקיצות/.test(stats), true);
check('a drafter card that goes to the drafter', /drafter\.html[\s\S]*?שרטט/.test(stats), true);
check('the cards are buttons / links, not dead divs', /<button[^>]*class="stat stat-link"/.test(stats) && /<a[^>]*class="stat stat-link"/.test(stats), true);
check('urgent orders are still flagged somewhere', /דחופות/.test(stats), true);

/* חיפוש בטלפון */
const iphone = (A.match(/\/\* ── אייפון ── \*\/\s*@media\(max-width:600px\)\{[\s\S]*?\n\}/) || [''])[0];
check('the phone block is found', iphone.length > 0, true);
check('search is no longer hidden on the phone', /\.search-wrap\{display:none;?\}/.test(iphone), false);
const css = (A.match(/\/\* ─ חיפוש באדמין בטלפון[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the phone search gets its own full row', /\.search-wrap\{[^}]*flex:1 1 100%/.test(css), true);
check('16px, so iOS does not zoom into it', /#srch\{[^}]*font-size:16px/.test(css), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll admin-top checks passed.');
