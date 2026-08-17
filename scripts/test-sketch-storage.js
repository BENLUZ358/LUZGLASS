#!/usr/bin/env node
/**
 * Tests stage 1 of moving sketches out of the order record.
 *
 * The measurement that started this: 23 orders occupy 4,659 KB in `orders`, of
 * which 99% is sketch base64. Four pages listen with on('value') on the whole
 * `orders` node, and Firebase re-sends the entire subtree on any change — so
 * ticking one checkbox in the check station re-downloads 4.6 MB on every open
 * client. At the ten-fold volume this is being built for, that is 46 MB a tick.
 *
 * The fix is to store the image at sketches/<id> and leave a marker on the
 * order. It arrives in four stages, so that at no moment does a sketch exist in
 * only one place:
 *
 *   1. write to both                    ← this file
 *   2. read the new one, fall back
 *   3. migrate what already exists
 *   4. drop the old field — and only here does anything get faster
 *
 * Stages 1 and 2 buy nothing on their own. They exist so that stage 4, which is
 * the only irreversible one, is safe when it comes. This suite therefore checks
 * two things: that every writer now writes both places, and that the old field
 * is still written untouched.
 *
 * Run: node scripts/test-sketch-storage.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB    = read('firebase-db.js');
const ADMIN = read('admin.html');
const RULES = JSON.parse(read('database.rules.json'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── every writer writes both places ───────────────────────────────────── */
/* There are exactly three. Anything that appears here later and writes only
   one of them leaves a sketch that stage 4 would delete without a copy. */
const bodyOf = (src, name) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

for (const fn of ['saveOrder', 'saveSubmission']) {
  const body = bodyOf(DB, fn);
  check(`${fn} still writes the old field`,
        /_lgDb\.ref\('orders\/' \+ id\)\.set\(record\)/.test(body), true);
  check(`${fn} also writes the new node`,
        /if \(record\.sketch\) await lgSaveSketch\(id, record\.sketch\)/.test(body), true);
  /* the marker rides in the record's own write — see the rules check below for
     why a client cannot afford a second write to orders/<id> */
  check(`${fn} marks the order in the same write`,
        /hasSketch:\s+!!data\.sketch,/.test(body), true);
}

check('the sketch editor writes the old field',
      /updateOrder\(sqCurrent\.id, \{ sketch: newSrc, hasSketch: true \}\)/.test(ADMIN), true);
check('and the new node too',
      /lgSaveSketch\(sqCurrent\.id, newSrc\)/.test(ADMIN), true);

/* the writer list itself — a new one must be caught here, not in production */
{
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  const writers = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/updateOrder\([^)]*\bsketch\s*:/g)) writers.push(f);
    for (const m of src.matchAll(/\bsketch:\s+(imgData|newSrc|dataUrl|base64)/g)) writers.push(f);
  }
  check('the known writers are the only ones', [...new Set(writers)].sort(),
        ['admin.html', 'upload.html']);
}

/* ── a failed new-node write must not cost the old one ─────────────────── */
{
  /* Order matters: the old field is written first and unconditionally. If the
     new node is unreachable — rules not deployed, quota, offline — the sketch
     is still saved exactly where it has always been saved. */
  const body = bodyOf(DB, 'lgSaveSketch');
  check('lgSaveSketch swallows its own failure', /catch \(e\) \{[\s\S]{0,140}return false;/.test(body), true);
  check('and never touches the old field', /orders\//.test(body), false);
}

/* ── reading back, for stage 2 ─────────────────────────────────────────── */
{
  const body = bodyOf(DB, 'lgGetSketch');
  check('lgGetSketch prefers the new node', /ref\('sketches\/' \+ orderId\)/.test(body), true);
  check('and falls back to the old field', /orders\/' \+ orderId \+ '\/sketch/.test(body), true);
}

/* ── the marker travels to every screen ────────────────────────────────── */
check('the normaliser carries the marker', /hasSketch:\s+!!\(o\.hasSketch \|\| o\.sketch\)/.test(DB), true);
for (const f of ['drafter.html', 'check-station.html', 'admin.html', 'portal.html']) {
  check(`${f} carries the marker`, /hasSketch:\s+!!\(o\.hasSketch/.test(read(f)), true);
}

/* ── the rules, which Vercel does not deploy ───────────────────────────── */
{
  const s = RULES.rules.sketches;
  check('the new node has rules at all', !!s, true);
  /* No .read on the node itself. Granting one would let a screen fetch every
     sketch in one request, which is the exact cost this whole exercise exists
     to remove. Reads are per order id only. */
  check('the node cannot be read whole', s['.read'] === undefined, true);
  const perId = s.$orderId;
  check('a client may read the sketch of their own order',
        /root\.child\('orders'\)\.child\(\$orderId\)\.child\('clientPhone'\)/.test(perId['.read']), true);
  check('an admin may read any', /role'\)\.val\(\) === 'admin'/.test(perId['.read']), true);
  /* mirrors the orders rule: a client may create, never overwrite */
  check('a client may create but not overwrite', /!data\.exists\(\)/.test(perId['.write']), true);
  check('and only on an order of theirs that has not started',
        /child\('stage'\)\.val\(\) === ''/.test(perId['.write']), true);
  check('the value is a string', perId['.validate'], 'newData.isString()');
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-storage checks passed.');
