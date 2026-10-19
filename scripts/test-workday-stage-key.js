#!/usr/bin/env node
/**
 * "הורדה לעבודה" moves an order's stage from 'opty' to 'workday' (Ben, 19/10/2026):
 *   "I sent Maor's orders to work, they are in the check station — why does the
 *    status say it waits for OptyWay?"
 *
 * markStageValue rewrote every id that did not start with ord_ / sub_ into 'ord_' + id.
 * WhatsApp orders are 'wa_<key>_1', so the stage went to orders/ord_wa_<key>_1 — a record
 * that does not exist (the write succeeded, created an empty stray, no error shown) —
 * and the real order stayed at stage 'opty' ("מחכה ל-OptyWay").
 * Every other save in workday.html already writes to the real id (saveOrderToStorage → updateOrder(sid)).
 *
 * Run: node scripts/test-workday-stage-key.js
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

const writes = [];
const ctx = vm.createContext({
  String, console,
  updateStage: (id, stage) => { writes.push([id, stage]); return Promise.resolve(); },
  showToast: () => {},
});
vm.runInContext(bodyOf(WD, 'markStageValue'), ctx);

for (const id of ['wa_-Nx7abc_1', 'ord_1760000000000', 'sub_1_0']) {
  writes.length = 0;
  ctx.markStageValue(id, 'workday');
  check(`the stage goes to the order's own record: ${id}`, writes, [[id, 'workday']]);
}
check('no id is rewritten with an ord_ prefix', /'ord_'\s*\+\s*sid/.test(bodyOf(WD, 'markStageValue')), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll workday stage-key checks passed.');
