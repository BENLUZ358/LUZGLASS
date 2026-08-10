#!/usr/bin/env node
/**
 * Tests lgArrivedIdxs — decoding orders/<id>/chisumArrivedIdxs.
 *
 * The field is written as {0:true, 1:true} and Firebase hands it back in one
 * of three shapes depending on how dense the keys are:
 *
 *   [true,true,true]                    dense  → array
 *   [true,true,null,null,true]          sparse → array with holes
 *   {"0":true,"7":true}                 very sparse → object
 *
 * Every reader in workday.html used (raw||[]).map(Number), which maps the
 * VALUES rather than their positions. [true,true,true] became [1,1,1], so the
 * app believed only item index 1 had arrived — in every order, in every
 * report. Number(null) is 0, so a sparse array also contributed a phantom 0.
 * Real data confirmed it: an order with ten arrived items decoded to {1}.
 *
 * Run: node scripts/test-arrived-idxs.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
const fn  = SRC.match(/function lgArrivedIdxs[\s\S]*?\n}/);
if (!fn) { console.error('FAIL  could not extract lgArrivedIdxs'); process.exit(1); }

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fn[0], ctx);
const decode = ctx.lgArrivedIdxs;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the dense array, which is what real orders hold ──────────────────── */
check('ten arrived items decode to 0..9',
      decode([true, true, true, true, true, true, true, true, true, true]),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('two arrived items', decode([true, true]), [0, 1]);

/* ── the sparse array, holes and all ──────────────────────────────────── */
check('sparse array skips the holes',
      decode([true, true, null, null, null, null, null, null, true, true]),
      [0, 1, 8, 9]);
check('only the last item arrived',
      decode([null, null, true]), [2]);

/* ── the object form ──────────────────────────────────────────────────── */
check('object form', decode({ '0': true, '7': true }), [0, 7]);
check('object form ignores false values', decode({ '0': true, '3': false }), [0]);

/* ── nothing arrived ──────────────────────────────────────────────────── */
check('null', decode(null), []);
check('undefined', decode(undefined), []);
check('empty array', decode([]), []);
check('empty object', decode({}), []);

/* ── the exact failure this replaced ──────────────────────────────────── */
{
  const raw = [true, true, true];
  const oldWay = [...new Set(raw.map(Number))];
  check('the old decode really did collapse to [1]', oldWay, [1]);
  check('the new decode gives the real positions', decode(raw), [0, 1, 2]);
}

/* ── no reader may go back to the raw form ────────────────────────────── */
const workday = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
{
  const raw = workday.match(/chisumArrivedIdxs\s*\|\|\s*\[\]\s*\)\s*\.map/g) || [];
  check('workday.html decodes only through lgArrivedIdxs', raw.length, 0);
}

/* ── every writer must persist ─────────────────────────────────────────
   setGroupArrivedCount edited only the in-memory echo. A group marked 2/2
   was lost on refresh, and turning it back down to 1/2 did nothing at all —
   the display unions the saved set with the local one, so the saved mark
   stayed and the row looked stuck. */
for (const fn of ['toggleArrived', 'markAllClientArrived', 'setGroupArrivedCount']) {
  const body = (workday.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
  check(`${fn} exists`, body.length > 0, true);
  check(`${fn} persists to Firebase`, /_persistArrivedIdxs\(/.test(body), true);
}

/* ── and no writer may compute its base state on its own ───────────────
   Every writer built the next set from lgArrivedIdxs(o.chisumArrivedIdxs)
   alone. o comes from allOrders, which the Firebase listener refreshes
   asynchronously, so a second click landing before the first write confirmed
   read stale state and dropped the first mark. On screen the local echo showed
   both, then the server push deleted one — which is what was reported: one
   click marking two rows, a row needing two clicks, the wrong row moving.

   _markedIdxSet unions the saved set with the session echo, so a mark still in
   flight is never lost. Every writer and every reader goes through it. */
for (const fn of ['toggleArrived', 'markAllClientArrived', 'setGroupArrivedCount']) {
  const body = (workday.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
  check(`${fn} bases its write on _markedIdxSet`, /_markedIdxSet\(/.test(body), true);
  check(`${fn} does not read chisumArrivedIdxs itself`,
        /lgArrivedIdxs\s*\(/.test(body), false);
}

/* only the helper itself decodes the raw field */
check('workday decodes the raw field in exactly one place',
      (workday.match(/lgArrivedIdxs\s*\(/g) || []).length, 1);

/* ── one denominator on the screen ─────────────────────────────────────
   The report header counted "marked this session out of not-yet-arrived"
   while the client cards counted "arrived out of total", so the same screen
   showed 7/15 next to 23/32. */
check('the report header counts arrived out of total',
      /arrivedAll\}\/\$\{totalChisum\} הגיעו/.test(workday), true);
check('the old session-based denominator is gone',
      /פריטים סומנו`/.test(workday), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll arrived-index checks passed.');
