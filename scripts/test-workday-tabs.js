#!/usr/bin/env node
/**
 * יום עבודה — הטאבים בטלפון ובאייפד (גל 2, 06/10).
 *
 * שישה טאבים בשורה אחת (~900px). ל-.phase-tabs אין גלילה, ו-.main חותך
 * כל מה שגולש (overflow-x:hidden) — ולכן בטלפון טריפלקס, גרפיקה והובלות
 * לא היו נגישים בכלל, גם לא בגלילה. גם באייפד לאורך (768) לא נכנסו כולם.
 *
 * ≤900: רשת של 3 עמודות × 2 שורות, אייקון מעל השם, המונה בפינה.
 * הדסקטופ — אותה שורה כמו היום.
 *
 * Run: node scripts/test-workday-tabs.js
 */
const fs   = require('fs');
const path = require('path');
const W = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const tabs = [...W.matchAll(/<div class="phase-tab[^"]*" id="tab-(\w+)"[^>]*>/g)];
check('workday still has its six tabs', tabs.map(m => m[1]),
      ['build', 'work', 'chisum', 'triplex', 'graphic', 'delivery']);
check('every tab is announced as a tab', tabs.every(m => /role="tab"/.test(m[0])), true);
check('and reachable from the keyboard', tabs.every(m => /tabindex="0"/.test(m[0])), true);
check('the strip is a tablist', /<div class="phase-tabs" role="tablist"/.test(W), true);

const set = (W.match(/function setTab\(tab\)\{[\s\S]*?\n}/) || [''])[0];
check('switching tabs updates aria-selected', /setAttribute\('aria-selected'/.test(set), true);

const grid = (W.match(/\/\* ─ טאבים במסך צר[\s\S]*?\r?\n  }\r?\n/) || [''])[0];
check('the narrow layout exists', grid.length > 0, true);
check('all six fit: three columns, two rows', /grid-template-columns:repeat\(3,1fr\)/.test(grid), true);
check('each tab is at least 44px tall', /min-height:(4[4-9]|5\d)px/.test(grid), true);
check('the counter does not push the label around', /\.phase-tab \.cnt\{[^}]*position:absolute/.test(grid), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll workday-tab checks passed.');
