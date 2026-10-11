#!/usr/bin/env node
/**
 * פורטל הלקוח — הטאבים בטלפון (גל 2, 06/10).
 *
 * שבעה טאבים בשורה אחת ברוחב 684px. במסך של 390 ארבעה מהם — נאספו,
 * חשבוניות, הודעות, מחירון — ישבו מחוץ למסך, בלי שום סימן שיש עוד. זה
 * מסך שהלקוחות רואים.
 *
 * בטלפון (≤600) כל השבעה גלויים ברשת של 4 עמודות, אייקון מעל השם.
 * בדסקטופ — אותה שורה כמו היום.
 *
 * Run: node scripts/test-portal-tabs-mobile.js
 */
const fs   = require('fs');
const path = require('path');
const P = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const tabs = [...P.matchAll(/<div class="tab[^"]*" id="tab-(\w+)"[^>]*>/g)];
check('the portal still has its seven tabs', tabs.length, 7);
check('every tab is announced as a tab', tabs.every(m => /role="tab"/.test(m[0])), true);
check('and can be reached from the keyboard', tabs.every(m => /tabindex="0"/.test(m[0])), true);
check('the strip is a tablist', /<div class="tabs" role="tablist"/.test(P), true);

const body = id => (P.match(new RegExp('id="tab-' + id + '"[^>]*>([\\s\\S]*?)</div>')) || ['', ''])[1];
check('each icon sits in its own element, so it can go above the label',
      tabs.every(m => /<span class="tab-ic"/.test(body(m[1]))), true);

const set = (P.match(/function setTab\(tab\)\{[\s\S]*?\n}/) || [''])[0];
check('switching tabs updates aria-selected', /setAttribute\('aria-selected'/.test(set), true);

const grid = (P.match(/\/\* ─ טאבים בטלפון[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the phone layout exists', grid.length > 0, true);
check('it is a four-column grid, so all seven show', /grid-template-columns:repeat\(4,1fr\)/.test(grid), true);
check('nothing scrolls sideways any more', /overflow:visible/.test(grid), true);
check('each tab is at least 44px tall', /min-height:(4[4-9]|5\d)px/.test(grid), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll portal-tab checks passed.');
