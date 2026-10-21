#!/usr/bin/env node
/**
 * optyAt — the moment an order entered OptyWay (Ben, 19/10/2026).
 *
 * The workday sketch board lists one client's sketches in the order they were
 * entered into OptyWay ("מה שהוכנס ראשון"). Ben: go by the drafter's "סיים", i.e. the
 * moment the stage becomes 'opty'. Every path into that stage goes through updateStage,
 * so the stamp is written there, in the same write as the stage.
 *
 * Run: node scripts/test-opty-at.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DB = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
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

(async () => {
  const writes = [];
  const ctx = vm.createContext({
    Date, Error,
    lgStageToStatus: s => 'status-of-' + s,
    _lgDb: { ref: p => ({ update: v => { writes.push([p, v]); return Promise.resolve(); } }) },
  });
  vm.runInContext('async ' + bodyOf(DB, 'updateStage'), ctx);

  await ctx.updateStage('wa_k_1', 'opty');
  const [p1, v1] = writes[0];
  check('the stage write goes to the order', p1, 'orders/wa_k_1');
  check('entering OptyWay stamps optyAt in the same write', typeof v1.optyAt === 'number' && v1.optyAt === v1.updatedAt, true);

  await ctx.updateStage('wa_k_1', 'workday');
  check('other stages do not touch optyAt', 'optyAt' in writes[1][1], false);

  check('the normalizer keeps optyAt', /optyAt:\s*o\.optyAt\s*\|\|\s*0/.test(bodyOf(DB, 'lgNormalizeOrder')), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll optyAt checks passed.');
})();
