#!/usr/bin/env node
/**
 * Tests the dimension lane allocator.
 *
 * Every dimension used to compute its own offset from the panel face, and two
 * dimensions in the same place was a bug waiting for someone to notice. Height
 * lines on touching panels landed on each other and there was no telling which
 * measurement belonged to which shape — the door's height could not be read at
 * all.
 *
 * Technical drawing solved this a century ago (ISO 129): each dimension gets a
 * lane at a fixed distance, the smallest nearest the object, so a large
 * dimension's line never crosses a small one's. Collision is not avoided by
 * care — it is made impossible. A dimension asks for a lane and is given a
 * free one.
 *
 * Run: node scripts/test-dim-lanes.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const src = ['_dimLanesReset', '_dimLane']
  .map(n => (DEMO.match(new RegExp('function ' + n + '[\\s\\S]*?\\n\\}')) || [''])[0])
  .join('\n');
check('the allocator is found', /function _dimLane\(/.test(src), true);
check('and so is the reset',    /function _dimLanesReset\(/.test(src), true);

const ctx = vm.createContext({});
vm.runInContext('var LANE_FIRST=24, LANE_STEP=32, _dimLanes={};\n' + src, ctx);

ctx._dimLanesReset();
check('the first lane sits closest to the object', ctx._dimLane('left'), 24);
check('the next one is further out',                ctx._dimLane('left'), 56);
check('and the one after that further still',       ctx._dimLane('left'), 88);

/* each zone counts on its own — a height and a width never share a lane
   because they are not even in the same direction */
check('a different zone starts over',   ctx._dimLane('top'), 24);
check('and advances on its own',        ctx._dimLane('top'), 56);
check('without disturbing the first',   ctx._dimLane('left'), 120);

/* a redraw starts from nothing, or lanes would creep outward every frame */
ctx._dimLanesReset();
check('a redraw resets every zone', [ctx._dimLane('left'), ctx._dimLane('top')], [24, 24]);

/* the property that matters, stated directly */
ctx._dimLanesReset();
const got = [];
for (let i = 0; i < 6; i++) got.push(ctx._dimLane('right'));
check('no two dimensions in a zone ever share a distance', got.length, new Set(got).size);
check('and they only ever move outward',
      got.every((v, i) => i === 0 || v > got[i - 1]), true);

/* the smallest dimension nearest the object is the ISO 129 rule, and the
   reason for it: a large dimension's line must not cross a small one's */
check('lanes grow by a fixed step, so the drawing stays regular',
      got.map((v, i) => i === 0 ? 0 : v - got[i - 1]).slice(1),
      [32, 32, 32, 32, 32]);

/* an unknown zone must not throw — a new dimension type should degrade, not
   take the whole drawing down with it */
ctx._dimLanesReset();
check('an unseen zone still gets a lane', typeof ctx._dimLane('nowhere'), 'number');
check('and it starts at the first lane',  ctx._dimLane('elsewhere'), 24);

/* ── the drawing resets the lanes on every pass ────────────────────────── */
/*
 * Without this the lanes creep further out on every redraw and the drawing
 * walks off the canvas — slowly enough that it looks like a rendering bug
 * rather than a missing reset.
 */
check('the combo drawing resets the lanes',
      /function drawComboMode[\s\S]{0,1200}?_dimLanesReset\(\)/.test(DEMO), true);
check('and so does the item drawing',
      /function drawItemMode[\s\S]{0,1200}?_dimLanesReset\(\)/.test(DEMO), true);

/* ── every dimension goes through the allocator ────────────────────────── */
/*
 * The point of the allocator is that nothing bypasses it. One dimension that
 * keeps its own hardcoded offset is one dimension that can land on another,
 * and it will be the one nobody tests.
 */
{
  const code = DEMO.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the width lane is asked for',    /_dimLane\('top'\)/.test(code), true);
  check('the height lane is asked for',   /_dimLane\('left'\)/.test(code), true);
  check('the hardware lane is asked for', /_dimLane\('right'\)/.test(code), true);
  /* the old hand-picked offsets are gone from the panel dimension calls */
  check('no panel dimension still carries a hand-picked distance',
        /dLine\(x[^;]{0,60},\s*-?(26|28|32)\s*,/.test(code), false);
}

/* ── exceptions, not repetition ────────────────────────────────────────── */
/*
 * A typical shower is 2000 2000 1985 2000 2000 — five heights, four of them
 * identical. Measuring every one is what made the drawing unreadable. The
 * overall height is dimensioned once and only a shape that differs gets a
 * line of its own, with a leader pointing at it.
 *
 * The saving must never hide a measurement: five different heights still
 * produce five.
 */
{
  const fn = (DEMO.match(/function _heightDims[\s\S]*?\n\}/) || [''])[0];
  check('the height chooser is found', fn.length > 0, true);
  const c2 = vm.createContext({});
  vm.runInContext(fn, c2);
  const call = hs => c2._heightDims(hs.map(h => ({ h })));

  check('all the same height gives one dimension', call([2000, 2000, 2000]).length, 1);
  check('and it is the overall height',            call([2000, 2000, 2000])[0].mm, 2000);

  /* the ordinary shower: a door 15 mm shorter than the fixed panels */
  const t = call([2000, 1985, 2000]);
  check('one door out of three gives two dimensions', t.length, 2);
  check('the overall comes first',                    [t[0].mm, t[0].overall], [2000, true]);
  check('then the exception, tied to its shape',      [t[1].mm, t[1].idx], [1985, 1]);

  /* nothing is hidden */
  check('five different heights give five', call([1000, 1200, 1400, 1600, 1800]).length, 5);
  check('two doors both shorter give three',
        call([2000, 1985, 2000, 1990, 2000]).length, 3);
  check('a single shape gives one', call([2000]).length, 1);
  check('no shapes, no dimensions',  call([]).length, 0);
  check('a shape with no height is skipped, not measured as zero',
        call([2000, 0, 2000]).length, 1);
}

/* ── the leader line ───────────────────────────────────────────────────── */
/* without it, "1985" floating beside the drawing does not say which shape it
   belongs to */
check('an exception is tied to its shape by a leader', /function _leaderTo/.test(DEMO), true);
check('and only an exception gets one',
      /if\(!d\.overall\)\s*_leaderTo\(/.test(DEMO), true);

/* ── the glass carries no measurements ─────────────────────────────────── */
/*
 * Printing "1985 × 800" on the glass was a patch for the collisions. Lanes
 * solve those properly, and text on the glass hides the drawing — a
 * contractor drawing by hand does not write measurements inside the glass.
 */
check('the size is no longer printed on the glass',
      /fillText\(_hMM\+' × '/.test(DEMO), false);
/* the number is what a leader line points at, so it has to stay */
check('the shape number stays', /String\.fromCharCode\(9312\+/.test(DEMO), true);
check('and it is capped so a twenty-first shape does not print a stray glyph',
      /Math\.min\(idx,19\)/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension-lane checks passed.');
