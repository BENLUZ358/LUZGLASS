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

const src = ['_dimLanesReset', '_dimPlace']
  .map(n => (DEMO.match(new RegExp('function ' + n + '[\\s\\S]*?\\n\\}')) || [''])[0])
  .join('\n');
check('the placer is found',    /function _dimPlace\(/.test(src), true);
check('and so is the reset',    /function _dimLanesReset\(/.test(src), true);

const ctx = vm.createContext({ Math });
vm.runInContext('var LANE_FIRST=24, LANE_STEP=32, LANE_PAD=6, _dimLanes={};\n' + src, ctx);
const place = (zone, a, b, t) => ctx._dimPlace(zone, a, b, t || 0);

/* ── what actually moves a dimension outward ───────────────────────────── */
/*
 * The first version handed out a lane per dimension, in order, checking
 * nothing. So 500 and 800 — sitting at completely different points along the
 * axis, unable to touch — were pushed onto two separate rows for no reason,
 * and the drawing looked ridiculous.
 *
 * What moves a dimension out is an actual overlap, not the mere existence of
 * another dimension. That is what a draughtsman does by hand: keep them on
 * one row as long as they do not touch.
 */
ctx._dimLanesReset();
check('the first dimension sits closest to the object', place('top', 0, 100), 24);
check('one beside it, not touching, stays on the same row', place('top', 200, 300), 24);
check('and a third further along, also', place('top', 400, 500), 24);
check('but one that overlaps is pushed out', place('top', 50, 250), 56);
check('and a third overlapping both goes further still', place('top', 0, 500), 88);

/* the case from the screenshot: two panel widths side by side */
ctx._dimLanesReset();
check('two adjacent panel widths share a row',
      [place('top', 100, 400, 40), place('top', 400, 900, 40)], [24, 24]);
check('and the overall width, spanning both, goes above them',
      place('top', 100, 900, 40), 56);

/* heights all span the same vertical range, so they genuinely do collide */
ctx._dimLanesReset();
check('two heights over the same range cannot share a row',
      [place('left', 0, 2000, 20), place('left', 0, 1985, 20)], [24, 56]);

/* a short line with a long label takes the label's width, not the line's */
ctx._dimLanesReset();
place('top', 100, 110, 60);
check('a long label reserves room for itself',
      place('top', 130, 140, 60), 56);

/* zones are independent — a height and a width are not even in the same
   direction, so they can never contend for the same space */
ctx._dimLanesReset();
check('a different zone starts over', [place('left', 0, 100), place('top', 0, 100)], [24, 24]);

/* a redraw starts from nothing, or lanes creep outward every frame and the
   drawing walks off the canvas */
ctx._dimLanesReset();
check('a redraw resets every zone', [place('left', 0, 100), place('top', 0, 100)], [24, 24]);

/* an unknown zone must not throw — a new dimension type should degrade, not
   take the whole drawing down with it */
ctx._dimLanesReset();
check('an unseen zone still gets a lane', typeof place('nowhere', 0, 10), 'number');

/* lanes only ever move outward, by a fixed step, so the drawing stays regular */
ctx._dimLanesReset();
const stacked = [];
for (let i = 0; i < 4; i++) stacked.push(place('right', 0, 1000, 20));
check('stacked dimensions step outward evenly', stacked, [24, 56, 88, 120]);

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
  check('the width lane is asked for',    /_dimPlace\('top'/.test(code), true);
  check('the height lane is asked for',   /_dimPlace\('left'/.test(code), true);
  check('the hardware lane is asked for', /_dimPlace\('right'/.test(code), true);
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

  /* every height is stated. Shapes that share one share a single line rather
     than repeating it — 2000 covers both fixed panels, 1985 the door. Two
     measurements for three shapes, and neither is missing.
     Measuring exceptions only, as the first version did, left the drafter
     without an answer: if the door has no line, is it 2000 or was it simply
     not measured? Glass is cut from that number. */
  check('all the same height gives one dimension', call([2000, 2000, 2000]).length, 1);
  check('and it covers every shape',
        call([2000, 2000, 2000])[0].idxs, [0, 1, 2]);
  check('so it needs no leader lines',
        call([2000, 2000, 2000])[0].overall, true);

  /* the ordinary shower: a door 15 mm shorter than the fixed panels */
  const t = call([2000, 1985, 2000]);
  check('one door out of three gives two dimensions', t.length, 2);
  check('the taller comes first',    [t[0].mm, t[0].idxs], [2000, [0, 2]]);
  check('and the door is stated too, not left blank',
        [t[1].mm, t[1].idxs], [1985, [1]]);
  check('both need leaders, since neither covers everything',
        [t[0].overall, t[1].overall], [false, false]);

  /* nothing is hidden, and nothing is repeated */
  check('five different heights give five', call([1000, 1200, 1400, 1600, 1800]).length, 5);
  check('two doors both shorter give three',
        call([2000, 1985, 2000, 1990, 2000]).length, 3);
  check('and five shapes at one height still give one',
        call([2000, 2000, 2000, 2000, 2000]).length, 1);
  check('a single shape gives one', call([2000]).length, 1);
  check('no shapes, no dimensions',  call([]).length, 0);
  check('a shape with no height is skipped, not measured as zero',
        call([2000, 0, 2000]).length, 1);

  /* ── the shape the drawing actually hands it ─────────────────────────── */
  /*
   * getPStates returns an OBJECT keyed by position, not an array — in every
   * mode: panelState in combinations, Object.fromEntries in shapes and items.
   * The first version called .map on it directly, threw, and the drawing died
   * after the first width line: the screen showed "800" and nothing else.
   *
   * The unit test above passed throughout, because it fed an array. It tested
   * the logic and was blind to the interface. This is the check that would
   * have caught it.
   */
  const asObj = hs => c2._heightDims(Object.fromEntries(hs.map((h, i) => [i, { h }])));
  check('an object keyed by position works exactly like an array',
        asObj([2000, 1985, 2000]).length, 2);
  check('and picks out the same exception',
        [asObj([2000, 1985, 2000])[1].mm, asObj([2000, 1985, 2000])[1].idx], [1985, 1]);
  check('a single shape as an object gives one dimension',
        asObj([2000]).length, 1);
  check('an empty object gives none', c2._heightDims({}), []);
  check('and neither null nor undefined throws',
        [c2._heightDims(null).length, c2._heightDims(undefined).length], [0, 0]);
  /* the order has to follow position, not object key order */
  check('positions are read in order, not in whatever order the keys came',
        c2._heightDims({ 2: { h: 1900 }, 0: { h: 2000 }, 1: { h: 2000 } })[1].idx, 2);
}

/* ── the leader line ───────────────────────────────────────────────────── */
/* without it, "1985" floating beside the drawing does not say which shape it
   belongs to */
check('a measurement is tied to its shapes by leaders', /function _leaderTo/.test(DEMO), true);
/* a line that covers every shape needs no leader — there is nothing to
   distinguish it from. Any other gets one per shape it describes. */
check('and one that covers everything does not get them',
      /if\(!d\.overall\) d\.idxs\.forEach\(i=>_leaderTo\(/.test(DEMO), true);

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

/* ── the lanes have to fit on the canvas ───────────────────────────────── */
/*
 * The margin was a bare 64. A third lane sits 88 from the panel face, so the
 * right-hand door's hinge dimensions were drawn and simply fell off the
 * canvas — present in the code, invisible on screen, which reads as "the
 * hinges have no dimensions".
 */
{
  check('the margin is computed, not a bare number', /const MG=_marginFor\(cW/.test(DEMO), true);
  check('the item view sizes its margin the same way',
        /const MG=_marginFor\(cW,2\), GAP=/.test(DEMO), true);
  check('no margin is a bare literal any more', /const MG=\d+[,;]/.test(DEMO), false);
  check('and the lane spacing follows the screen too',
        /function _lanesForWidth/.test(DEMO), true);

  /* the fixed 128 margin took 256 off a 375px phone — two thirds of the
     screen — and the glass was left with crumbs. The margin has to leave the
     drawing the greater part of the width on every device. */
  const src2 = ['_lanesForWidth', '_marginFor']
    .map(n => (DEMO.match(new RegExp('function ' + n + '[\\s\\S]*?\\n\\}')) || [''])[0]).join('\n');
  const c3 = vm.createContext({ Math });
  vm.runInContext('var LANE_FIRST=24, LANE_STEP=32;\n' + src2, c3);
  const share = cW => { c3._lanesForWidth(cW); return (cW - c3._marginFor(cW, 3) * 2) / cW; };

  check('a phone keeps most of the width for the glass', share(375) > 0.5, true);
  check('an iPad more still',                            share(768) > 0.7, true);
  check('and a desktop most of all',                     share(1440) > 0.8, true);
  check('the margin never takes more than a fifth a side',
        [375, 414, 768, 1440].every(w => { c3._lanesForWidth(w);
          return c3._marginFor(w, 3) <= Math.round(w * 0.22); }), true);
  /* and the lanes themselves tighten on a small screen, so three of them
     still fit inside that margin */
  c3._lanesForWidth(375);
  check('a phone uses tighter lanes', c3.LANE_STEP < 32, true);
}

/* ── the label must be readable over its own line ──────────────────────── */
/*
 * An editable dimension was tinted rgba(184,146,42,0.2) — 80% transparent —
 * so the dimension line showed straight through the number and blurred it.
 */
{
  const fn = (DEMO.match(/function dLine[\s\S]*?\n\}/) || [''])[0];
  check('the label gets an opaque backing first', /fillStyle='#fbf9f5'/.test(fn), true);
  check('and the editable tint goes on top of it',
        /fillStyle='#fbf9f5'[\s\S]{0,140}?rgba\(184,146,42,0\.18\)/.test(fn), true);
  check('the tint is no longer the only backing',
        /fillStyle=inputId\?'rgba\(184,146,42,0\.2\)'/.test(fn), false);
}

/* ── the handle's edge distance goes through the placer too ────────────── */
/*
 * It kept a fixed offset of 22, so two doors meeting in the middle put both
 * of their edge distances in the same spot and they read as "6060".
 */
check('the handle edge distance is placed, not offset by hand',
      /_dimPlace\('handle'/.test(DEMO), true);
check('and no dimension call still passes a bare 22',
      /String\(hEdgeMM\),22,true/.test(DEMO), false);

/* ── the overall width sits above the panel widths, not on a fixed offset ── */
/*
 * It kept -52 and -46, which put it outside the lane system entirely: the
 * panel widths were placed by collision and the overall by a constant, so
 * they could not be reasoned about together — and the rows came out uneven.
 * ISO 129 puts the smallest dimension nearest the object, which falls out of
 * placing the overall last.
 */
check('the overall width asks for a lane like everything else',
      /const _tLane=_dimPlace\('top'/.test(DEMO), true);
check('and no width still carries a fixed offset',
      /ס״מ`,-(52|46),true/.test(DEMO), false);
{
  /* placed after the panel widths, it lands outside them */
  ctx._dimLanesReset();
  const p0 = place('top', 82, 163, 40);
  const p1 = place('top', 163, 293, 40);
  const all = place('top', 82, 293, 60);
  check('two adjacent panel widths share the nearest row', [p0, p1], [24, 24]);
  check('and the overall, covering both, sits one row out', all > p0, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension-lane checks passed.');
