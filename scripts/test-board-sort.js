#!/usr/bin/env node
/**
 * סדר ההזמנות בלוח ההזמנות (בן, 19/11/2026):
 *   "כשאני מסנן, למשל פלג מקלחונים — שההזמנה העליונה תהיה החדשה ביותר,
 *    ושתהיה אופציה מהישן לחדש."
 *
 * Run: node scripts/test-board-sort.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); failed++; return ''; }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

const store = {};
const el = { sortf: { value: 'new' }, srch: { value: '' }, gf: { value: '' }, cf: { value: '' } };
const ctx = vm.createContext({
  Number, String, Object,
  document: { getElementById: id => el[id] || null },
  safeStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  lgOrderHasGlass: () => true,
});
vm.runInContext(['var sf = "all", skuCatalogMap = {}, orders = [];',
  ...['lgOrderTime', 'lgOrderNumVal', 'lgSortOrdersByTime', 'lgSaveOrderSort', 'lgRestoreOrderSort', 'filtered'].map(n => bodyOf(A, n))].join('\n'), ctx);

const P = 'פלג מקלחונים בע"מ';
vm.runInContext(`orders = [
  { id: 'a', orderNum: 'L1303',  orderClient: '${P}', status: 'x', createdAt: 300 },
  { id: 'b', orderNum: 'L1325',  orderClient: '${P}', status: 'x', createdAt: 900 },
  { id: 'c', orderNum: 'L1310',  orderClient: 'המקום לאמבט', status: 'x', createdAt: 950 },
  { id: 'd', orderNum: 'L1324-1', orderClient: '${P}', status: 'x', emailReceivedAt: 600 },
  { id: 'e', orderNum: 'L1200',  orderClient: '${P}', status: 'x' },
  { id: 'f', orderNum: 'L1250',  orderClient: '${P}', status: 'x' },
];`, ctx);

const ids = () => vm.runInContext('filtered().map(o => o.id)', ctx);
el.cf.value = P;
check('filter פלג → newest on top (default)', ids(), ['b', 'd', 'a', 'f', 'e']);
check('…the other client is filtered out', ids().includes('c'), false);
el.sortf.value = 'old';
check('"מהישן לחדש" → oldest on top', ids(), ['e', 'f', 'a', 'd', 'b']);
el.cf.value = '';
el.sortf.value = 'new';
check('no filter → the whole board is newest first too', ids(), ['c', 'b', 'd', 'a', 'f', 'e']);
check('sorting does not reorder the live list itself', vm.runInContext('orders.map(o => o.id)', ctx), ['a', 'b', 'c', 'd', 'e', 'f']);

// remembered between visits
ctx.lgSaveOrderSort('old');
el.sortf.value = 'new';
ctx.lgRestoreOrderSort();
check('the choice is remembered', el.sortf.value, 'old');
delete store.lgOrderSort;
ctx.lgRestoreOrderSort();
check('nothing saved → newest first', el.sortf.value, 'new');

check('the choice sits in the filter bar with both options',
  /<select class="fsel" id="sortf"[^>]*onchange="lgSaveOrderSort\(this\.value\);renderAll\(\)"[\s\S]{0,120}value="new">מהחדש לישן[\s\S]{0,60}value="old">מהישן לחדש/.test(A), true);
check('restored before the first render', /function load\(\) \{\s*lgRestoreOrderSort\(\);/.test(A), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll board-sort checks passed.');
