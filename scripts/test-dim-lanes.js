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

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension-lane checks passed.');
