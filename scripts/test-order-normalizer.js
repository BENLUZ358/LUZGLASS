#!/usr/bin/env node
/**
 * Tests lgNormalizeOrder — the whitelist every page's orders pass through.
 *
 * getAllOrders, listenAllOrders and listenClientOrders all map raw Firebase
 * orders through lgNormalizeOrder, so it decides what workday.html,
 * check-station.html, admin.html, drafter.html and portal.html can even see.
 * A field missing from its object literal is not "left alone" — it is gone.
 *
 * Two defects lived here, both silent:
 *
 * 1. chisumArrivedIdxs was reshaped with Object.keys(...).map(Number), turning
 *    the {itemIndex:true} map into an array OF INDICES — [0,7]. lgArrivedIdxs,
 *    the one decoder, reads an array as an array of BOOLEANS BY POSITION. The
 *    two shapes are incompatible, so every page decoded arrivals wrong:
 *      only item 3 arrived  → the screen ticked items 1, 2 and 3
 *      only item 0 arrived  → the screen ticked nothing
 *    That is the "I tick one and another lights up" report.
 *
 * 2. triplexReportId / triplexReportNum / triplexArrived / triplexSentAt were
 *    never in the whitelist. check-station.html writes them when it sends the
 *    laminated-triplex report to the factory; workday.html's triplex tab
 *    filters on triplexReportId. It always read undefined, so the tab could
 *    never show a single row no matter what was in the database.
 *
 * Run: node scripts/test-order-normalizer.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

const norm = SRC.match(/function lgNormalizeOrder[\s\S]*?\n}/);
const dec  = SRC.match(/function lgArrivedIdxs[\s\S]*?\n}/);
if (!norm || !dec) { console.error('FAIL  could not extract the functions'); process.exit(1); }

const ctx = { console };
vm.createContext(ctx);
/* lgNormalizeOrder leans on two stage helpers; stub them, they are tested elsewhere */
vm.runInContext('function lgStatusToStage(){return "";}\nfunction lgStageToStatus(){return "";}\n'
                + norm[0] + '\n' + dec[0], ctx);
const { lgNormalizeOrder, lgArrivedIdxs } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the arrival map must survive the trip intact ──────────────────────
   Firebase hands the field back as a dense array, a sparse array or an
   object depending on key density. Whichever it is, what the page decodes
   must be the item indices that actually arrived. */
const SHAPES = [
  ['dense — items 0,1,2',   [true, true, true],              [0, 1, 2]],
  ['sparse — only item 3',  [null, null, null, true],        [3]],
  ['object — items 0 and 7', { '0': true, '7': true },       [0, 7]],
  ['only item 0',           [true],                          [0]],
  ['object with a false',   { '0': true, '3': false },       [0]],
  ['nothing arrived',       null,                            []],
];
for (const [name, fromFirebase, truth] of SHAPES) {
  const o = lgNormalizeOrder({ id: 'L1', chisumArrivedIdxs: fromFirebase });
  check(`${name} decodes correctly after normalising`, lgArrivedIdxs(o.chisumArrivedIdxs), truth);
}

/* the exact corruption this replaced */
{
  const oldWay = raw => (raw ? Object.keys(raw).map(Number) : []);
  check('the old reshape really did turn "item 3" into items 1,2,3',
        lgArrivedIdxs(oldWay([null, null, null, true])), [1, 2, 3]);
  check('and really did lose item 0 entirely',
        lgArrivedIdxs(oldWay([true])), []);
}

/* nothing may reshape the field on the way through */
check('the normaliser does not reshape chisumArrivedIdxs',
      /chisumArrivedIdxs:\s*o\.chisumArrivedIdxs\s*\?\?/.test(norm[0]), true);
check('Object.keys is no longer applied to it',
      /Object\.keys\(o\.chisumArrivedIdxs\)/.test(norm[0]), false);

/* ── a field a page writes and another page reads must be carried ──────
   The whitelist silently drops anything not named in it, which is how the
   triplex report vanished between check-station and workday. */
const whitelist = new Set([...norm[0].matchAll(/^\s{4}([a-zA-Z_]\w*)\s*[:,]/gm)].map(m => m[1]));

const FACTORY_FIELDS = [
  'chisumArrived', 'chisumArrivedIdxs', 'chisumReportId', 'chisumReportNum',
  'triplexArrived', 'triplexReportId', 'triplexReportNum', 'triplexSentAt',
];
for (const f of FACTORY_FIELDS) check(`the whitelist carries ${f}`, whitelist.has(f), true);

/* and prove it end to end on a real-looking order */
{
  const o = lgNormalizeOrder({
    id: 'L1039', stage: 'chisum',
    triplexReportId: 'TRX-7', triplexReportNum: 7,
    triplexArrived: false, triplexSentAt: 1738000000000,
  });
  check('the triplex tab filter would now find this order',
        o.stage === 'chisum' && !!o.triplexReportId, true);
  check('and can show how long it has been out', o.triplexSentAt, 1738000000000);
}

/* ── the general guard ─────────────────────────────────────────────────
   Every order-level field any page writes must be named in the whitelist,
   otherwise it is write-only: saved to Firebase and invisible to the app. */
const PAGES = ['workday.html', 'check-station.html', 'admin.html',
               'drafter.html', 'portal.html', 'mekhlahon.html', 'new-order.html'];

/* deliberately not carried — write-only by design, no page reads them back */
const NOT_CARRIED = new Set([
  'obj',               // a variable name caught by the scan, not a field
  'inspectionStatus',  // set and cleared, never read for a decision
  'temperingStatus',   // same
  '_editedSketch',     // drafter-local marker
  'pickedDate',        // portal writes, portal re-reads from its own state
  'pickupDateRaw',
]);

const written = {};
for (const p of PAGES) {
  let t;
  try { t = fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { continue; }
  t = t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of t.matchAll(/\bpatch\.([a-zA-Z_]\w*)\s*=/g)) (written[m[1]] ??= new Set()).add(p);
  for (const m of t.matchAll(/updateOrder\(\s*[^,]+,\s*\{([^}]*)\}/g))
    for (const k of m[1].matchAll(/([a-zA-Z_]\w*)\s*:/g)) (written[k[1]] ??= new Set()).add(p);
}
const dropped = Object.keys(written).filter(f => !whitelist.has(f) && !NOT_CARRIED.has(f));
check('no page writes an order field the normaliser then drops', dropped, []);
check('the scan actually found fields to check', Object.keys(written).length > 10, true);

/* The pickup date the client sets in the portal.

   confirmPick has always written pickedDate and pickupDateRaw to Firebase.
   Neither was named here, so the whitelist dropped both on the way back out —
   to every screen, including the portal that had just written them and the
   admin's pickup board that exists to show them. The same shape as
   chisumArrivedIdxs and itemType before it. */
{
  const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const body = (SRC.match(/function lgNormalizeOrder[\s\S]*?\n}/) || [''])[0];
  check('the pickup date survives the whitelist',
        /pickedDate:    o\.pickedDate    \|\| '',/.test(body), true);
  check('and the raw yyyy-mm-dd with it',
        /pickupDateRaw: o\.pickupDateRaw \|\| '',/.test(body), true);
  /* the raw form is what the admin board groups and sorts by; the formatted
     Hebrew string cannot be parsed back into a date */
  check('the portal writes both',
        /updateOrder\(id, \{ pickedDate: fmt, pickupDateRaw: inp\.value \}\)/
          .test(fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8')), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-normaliser checks passed.');
