#!/usr/bin/env node
/**
 * 🏷 מדבקה מכל מקום (בן, 11/11): בחלון "פרטים" של הזמנה בלוח ההזמנות — כפתור
 * מדבקה ליד כל פריט + "מדבקות לכל הפריטים", בכל שלב (גם אחרי חשבונית).
 * אותה מדבקה ואותו מרכז הדפסות (/api/print) כמו בחיסום ביום עבודה.
 * Run: node scripts/test-order-labels.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'print-labels.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'order-labels.js'), 'utf8'), ctx);
const T = vm.runInContext('({ lgOrderLabels, lgOrderLabelsMsg })', ctx);
const J = x => JSON.parse(JSON.stringify(x));

const o = { id: 'wa_1', orderNum: 'L1208', orderClient: 'כתר מקלחונים', sketchName: 'ניסים', stage: 'done',
  items: [{ w: 500, h: 1500 }, { w: 500, h: 1488 }, { w: 0, h: 0 }] };
check('one item', J(T.lgOrderLabels(o, [1])).map(l => [l.title, l.dims, l.sketchName, l.orderNum]),
  [['כתר מקלחונים', '500 × 1488', 'ניסים', 'L1208']]);
check('all items with dimensions (skips an item with no size)', J(T.lgOrderLabels(o)).map(l => l.dims), ['500 × 1500', '500 × 1488']);
check('items as a Firebase object', J(T.lgOrderLabels({ ...o, items: { 0: { w: 300, h: 400 } } })).map(l => l.dims), ['300 × 400']);
check('no order', J(T.lgOrderLabels(null)), []);
check('message one', T.lgOrderLabelsMsg(1), 'מדבקה אחת נשלחה למדפסת המדבקות');
check('message many', T.lgOrderLabelsMsg(2), '2 מדבקות נשלחו למדפסת המדבקות');

const ADM = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
check('admin loads print-labels.js and order-labels.js', /<script src="print-labels\.js\?v=\d+"><\/script>/.test(ADM) && /<script src="order-labels\.js\?v=\d+"><\/script>/.test(ADM), true);
check('🏷 next to every item in the order window', /function _modItemsHtml\(items\)\{[\s\S]{0,900}modLabel\(/.test(ADM), true);
check('"all items" label button in the items header', ADM.includes('onclick="modLabelAll()"'), true);
check('label buttons are not limited by stage (no _modCanEditItems around them)', !/_modCanEditItems\(o\) \? `<button[^`]*modLabelAll/.test(ADM), true);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll order-labels checks passed.');
