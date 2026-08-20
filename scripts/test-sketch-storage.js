#!/usr/bin/env node
/**
 * Tests moving sketches out of the order record.
 *
 * Measured on the live database, most recently at 40 orders: `orders` is
 * 7,589 KB, of which 7,509 KB — 99% — is sketch base64. Without them it would
 * be 80 KB. Four pages listen with on('value') on the whole node, and Firebase
 * re-sends the entire subtree on any change, so ticking one checkbox in the
 * check station re-downloads 7.5 MB on every open client. Ninety-four times
 * more than the data anyone is looking at, and it grew from 23 orders to 40 in
 * a week.
 *
 * The image moves to sketches/<id> and the order keeps a marker. Four stages,
 * so that at no moment does a sketch exist in only one place:
 *
 *   1. write to both                    ← done, deployed, confirmed live
 *   2. read the new one, fall back      ← here
 *   3. migrate what already exists
 *   4. drop the old field — and only here does anything get faster
 *
 * Stages 1 and 2 buy nothing on their own. They exist so that stage 4, the only
 * irreversible one, is boring when it arrives.
 *
 * Stage 2 is NOT finished. The admin sketch queue reads through the new loader;
 * the check station, drafter, portal and order-view still read order.sketch
 * directly, and the queue's own list thumbnails show every sketch at once.
 * Stage 4 cannot happen until each of those is either wired or made lazy.
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

/* ── stage 2 · reading ─────────────────────────────────────────────────── */
{
  const body = bodyOf(DB, 'lgGetSketch');
  check('lgGetSketch prefers the new node', /ref\('sketches\/' \+ orderId\)/.test(body), true);
  check('and falls back to the old field', /orders\/' \+ orderId \+ '\/sketch/.test(body), true);
  check('a fetched sketch is cached, not fetched per render',
        /if \(_lgSketchCache\.has\(orderId\)\) return _lgSketchCache\.get\(orderId\);/.test(body), true);
}

/*
 * The switch is the whole point of this stage.
 *
 * While the old field still exists it is what gets read — it is already in
 * memory and a second fetch would be pure waste. But that leaves the new node
 * untested until stage 4, which is the one stage that deletes. So the source is
 * switchable at runtime: run the entire system against sketches/<id> without
 * removing a byte, and switch back the moment something misbehaves.
 *
 *   lgSketchSource('new')   in any page's console
 *   lgSketchSource('old')   to go back
 *
 * Stage 4 is meant to be boring by the time it arrives.
 */
{
  const body = bodyOf(DB, 'lgSketchSource');
  check('the source defaults to the old field', /localStorage\.getItem\('lgSketchSource'\) \|\| 'old'/.test(body), true);
  check('the choice survives a refresh', /localStorage\.setItem\('lgSketchSource', mode\)/.test(body), true);
  check('and switching clears the cache', /_lgSketchCache\.clear\(\);/.test(body), true);
  check('only the two known modes are accepted',
        /if \(mode === 'new' \|\| mode === 'old'\)/.test(body), true);

  const load = bodyOf(DB, 'lgLoadSketch');
  check('the old field is used directly while it is the source',
        /if \(lgSketchSource\(\) === 'old' && inline\) return inline;/.test(load), true);
  check('and the inline value is the last resort, never dropped',
        /return fromNode \|\| inline;/.test(load), true);
}

/* one loader for the screens, so stage 4 does not touch them again */
{
  const into = bodyOf(DB, 'lgSketchIntoImg');
  check('what is already in memory is shown at once',
        /if \(inline\) done\(inline\);/.test(into), true);
  /* open one sketch, switch to another before the first answers: the late
     reply must not overwrite what is now on screen */
  check('a late answer for a different order is discarded',
        /if \(!src \|\| imgEl\.dataset\.lgFor !== want\) return;/.test(into), true);
  check('the sketch queue goes through it',
        /lgSketchIntoImg\(img, o\);/.test(read('admin.html')), true);
  /* the marker, not the image, decides whether there is one to show */
  check('and asks the marker rather than the payload',
        /if\(o\.hasSketch \|\| o\.sketch\)\{/.test(read('admin.html')), true);
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
