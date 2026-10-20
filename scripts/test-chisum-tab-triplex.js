#!/usr/bin/env node
/**
 * "דוח ישן — 0 פריטים" בלשונית החיסום (בן, 20/10/2026): זו הייתה הזמנה אמיתית (L1088)
 * שכל הזכוכית שלה נסעה להדבקת טריפלקס — יש לה דוח טריפלקס ואין לה דוח חיסום.
 * לשונית החיסום הציגה כל הזמנה בשלב chisum, ובלי מספר דוח חיסום היא נפלה ל"דוח ישן" ריק.
 * מקומה בלשונית הטריפלקס בלבד. הזמנות ישנות באמת (בלי שום דוח) נשארות ב"דוח ישן".
 *
 * Run: node scripts/test-chisum-tab-triplex.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WD = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); process.exit(1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

const ctx = vm.createContext({});
vm.runInContext(bodyOf(WD, 'wdInChisumTab'), ctx);
const o = x => Object.assign({ stage: 'chisum' }, x);
check('an order in a chisum report is in the chisum tab', ctx.wdInChisumTab(o({ chisumReportId: 'r1' })), true);
check('a mixed order (chisum + triplex reports) is in the chisum tab', ctx.wdInChisumTab(o({ chisumReportId: 'r1', triplexReportId: 't1' })), true);
check('a triplex-only order is NOT in the chisum tab (it was "דוח ישן — 0 פריטים")', ctx.wdInChisumTab(o({ triplexReportId: 't1' })), false);
check('a truly old order with no report at all still shows as "דוח ישן"', ctx.wdInChisumTab(o({})), true);
check('an order not at the factory is not in the tab', ctx.wdInChisumTab({ stage: 'workday', chisumReportId: 'r1' }), false);
check('renderChisumTab uses it', /allOrders\.filter\(wdInChisumTab\)/.test(bodyOf(WD, 'renderChisumTab')), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll chisum-tab checks passed.');
