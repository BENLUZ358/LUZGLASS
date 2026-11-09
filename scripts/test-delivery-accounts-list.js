#!/usr/bin/env node
/** לקוחות הובלות בלי משתמש (LG_DELIVERY_ACCOUNTS, בן 9/11 — פלג 07). Run: node scripts/test-delivery-accounts-list.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const parts = [
  SRC.match(/const LG_DELIVERY_ACCOUNTS = .*;/),
  SRC.match(/function _lgItemHasGraphic[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasChalavi[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsLaminatedTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasSurfaceWork[\s\S]*?\n}/),
  SRC.match(/function lgNextStage[\s\S]*?\n}/),
];
check('helpers found', parts.every(Boolean), true);
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n') + '\nthis.next = lgNextStage; this.L = LG_DELIVERY_ACCOUNTS;', ctx);
const o = (cid, items) => ({ stage: 'workday', customerId: cid, items: items || [{ w: 100, h: 50 }] });
check('Peleg (07) is in the list', ctx.L.includes('07'), true);
check('Peleg finishing the workday → delivery', ctx.next(o('07')), 'delivery');
check('regular customer → done, as before', ctx.next(o('509')), 'done');
check('flag on the order still wins', ctx.next({ ...o('509'), deliveryClient: true }), 'delivery');
check('Peleg with chisum → chisum first', ctx.next(o('07', [{ chisum: true }])), 'chisum');
check('Peleg back from chisum → delivery', ctx.next({ ...o('07', [{ chisum: true }]), stage: 'chisum' }), 'delivery');
console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
