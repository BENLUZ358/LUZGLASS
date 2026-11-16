#!/usr/bin/env node
/**
 * "ייבא עבודה" in the check station (Ben, 16/11/2026):
 *   "I sent work to the check station while the person there had not finished
 *    today's goods, and it got mixed. I want a button in the station to import
 *    the work, so it doesn't mix."
 *
 * The workday marks every order it sends as workday/csNew/<id>. The station hides
 * those (not listed, not sent to the factory) and shows a bar with an import
 * button; importing clears the marks.
 *
 * Run: node scripts/test-cs-import-work.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CS = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('(async )?function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); process.exit(1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

/* ── workday: the mark is written before the order joins inChisum ── */
{
  const fn = bodyOf(WD, 'handleWorkdayStart');
  const iMark = fn.indexOf("ref('workday/csNew/' + _sid).set(");
  const iPush = fn.indexOf('workDay.inChisum.push(_sid)');
  check('workday marks a new station order as waiting for import', iMark > 0, true);
  check('and marks it before it is pushed to the station', iMark > 0 && iMark < iPush, true);
}

/* ── station: hidden until imported ── */
const el = {};
const getEl = id => id === "lgLoading" ? null : (el[id] = el[id] || { style: {}, textContent: "", disabled: false });
const writes = [];
let confirmAnswer = true, confirms = 0;
const ctx = vm.createContext({
  Math, JSON, Object, Array, String, Number, Promise, console,
  document: { getElementById: getEl },
  confirm: () => { confirms++; return confirmAnswer; },
  toast: () => {},
  firebase: { database: () => ({ ref: p => ({ update: v => { writes.push([p, v]); return Promise.resolve(); } }) }) },
  mapFirebaseOrder: o => o, buildClients: () => {}, renderList: () => {},
  window: {},
});
vm.runInContext([
  'var orders=[], cs={}, cur=null, wdInChisum=[], wdCsNew={}, csHeld=[];',
  bodyOf(CS, 'chisumIdxs'), bodyOf(CS, 'isDone'),
  bodyOf(CS, '_filterOrders'), bodyOf(CS, 'renderImportBar'), bodyOf(CS, 'csImportWork'),
].join('\n'), ctx);

const ord = (id, n) => ({ id, items: Array.from({ length: n }, () => ({ chisum: true })) });
ctx.window._allCsOrders = [ord('a', 2), ord('b', 1), ord('c', 3), ord('x', 1)];
vm.runInContext("wdInChisum=['a','b','c']; wdCsNew={c: 1}; cs={a:{0:true,1:true}};", ctx);
ctx._filterOrders();

check('orders already imported are listed', vm.runInContext('orders.map(o=>o.id)', ctx), ['a', 'b']);
check('the new one is held back', vm.runInContext('csHeld.map(o=>o.id)', ctx), ['c']);
check('the import bar shows', getEl('csImportBar').style.display, 'flex');
check('and says what came in', getEl('csImportTxt').textContent, 'נכנסה עבודה חדשה: 1 הזמנה · 3 פריטים');
check('and how many are still to finish first', getEl('csImportSub').textContent, 'קודם סיים את 1 ההזמנות שלפניך, ואז ייבא');

(async () => {
  confirmAnswer = false;
  await ctx.csImportWork();
  check('importing with unchecked work asks first', confirms, 1);
  check('and a "no" imports nothing', writes.length, 0);

  vm.runInContext('cs.b={0:true}', ctx);
  ctx.renderImportBar();
  check('once all is checked it says it can import', getEl('csImportSub').textContent, 'אפשר לייבא');
  await ctx.csImportWork();
  check('with nothing left it does not ask', confirms, 1);
  check('import clears exactly the held marks', writes, [['workday/csNew', { c: null }]]);

  vm.runInContext('wdCsNew={}', ctx);
  ctx._filterOrders();
  check('after import the order is listed', vm.runInContext('orders.map(o=>o.id)', ctx), ['a', 'b', 'c']);
  check('and the bar hides', getEl('csImportBar').style.display, 'none');

  /* sending to the factory works only on `orders`, so held work never travels */
  check('send-to-factory picks from the imported list only',
        /const doneOrds = orders\.filter\(isDone\)/.test(bodyOf(CS, 'sendAllToFactory')), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll import-work checks passed.');
})();
