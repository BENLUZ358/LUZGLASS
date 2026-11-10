#!/usr/bin/env node
/** שבר בחיסום (בן 10/11) — הזמנת הובלות ממשיכה, חשבונית על כולה. Run: node scripts/test-broken-chisum.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };
const pick = re => { const m = SRC.match(re); if (!m) { fail++; console.log('FAIL missing ' + re); return ''; } return m[0]; };

/* ── Task 1: ההחלטה ───────────────────────────────────────────────── */
const ctx = { console }; vm.createContext(ctx);
vm.runInContext([pick(/function lgBrokenPlan[\s\S]*?\n}/), pick(/function lgBrokenOpen[\s\S]*?\n}/),
                 pick(/function _lgBrokenEntries[\s\S]*?\n}/), pick(/function lgBrokenReturnedUndelivered[\s\S]*?\n}/)].join('\n'), ctx);
const base = { isDelivery: true, waitsPolish: false, done: false, chisumPending: [0, 1, 2], chisumArrived: [0, 1],
               triplexPending: [], triplexArrived: [], triplexBack: false, closedAny: false, itemCount: 3, factoryCount: 3 };
const P = x => ctx.lgBrokenPlan({ ...base, ...x });
check('delivery, 2 of 3 back → item 2 broken', P({}), [{ idx: 2, track: 'chisum' }]);
check('not a delivery customer → unchanged (null)', P({ isDelivery: false }), null);
check('everything back → normal path (null)', P({ done: true }), null);
check('waiting for polish → null', P({ waitsPolish: true }), null);
check('nothing ready at all → stays in chisum', P({ chisumArrived: [] }), null);
check('nothing back but a mirror cut in-house → continues', P({ chisumArrived: [], itemCount: 4 }),
      [{ idx: 0, track: 'chisum' }, { idx: 1, track: 'chisum' }, { idx: 2, track: 'chisum' }]);
check('nothing back this round but closed earlier → continues', P({ chisumPending: [2], chisumArrived: [], closedAny: true }),
      [{ idx: 2, track: 'chisum' }]);
check('triplex still at the factory → waits (Ben)', P({ triplexPending: [3], itemCount: 4, factoryCount: 4 }), null);
check('triplex back, one triplex missing → broken triplex', P({ chisumArrived: [0, 1, 2], triplexPending: [3, 4], triplexArrived: [3],
      triplexBack: true, itemCount: 5, factoryCount: 5 }), [{ idx: 4, track: 'triplex' }]);

const o = { brokenChisum: { 2: { at: 5, track: 'chisum' }, 4: { at: 6, track: 'triplex', returnedAt: 9 },
                            1: { at: 7, track: 'chisum', returnedAt: 8, deliveredAt: 10 } } };
check('lgBrokenOpen lists only not returned', ctx.lgBrokenOpen(o), [{ idx: 2, track: 'chisum', at: 5 }]);
check('lgBrokenOpen on order without breaks', ctx.lgBrokenOpen({}), []);
check('returned but not delivered', ctx.lgBrokenReturnedUndelivered(o), [{ idx: 4, track: 'triplex', returnedAt: 9 }]);
check('Firebase array shape is read too', ctx.lgBrokenOpen({ brokenChisum: [null, { at: 1, track: 'chisum' }] }), [{ idx: 1, track: 'chisum', at: 1 }]);

console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
