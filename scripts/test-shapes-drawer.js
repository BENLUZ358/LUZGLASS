#!/usr/bin/env node
/**
 * Tests that the drawer draws what the engine decided, and decides nothing.
 *
 * drwBracket, drwGGBracket, drwHinge, drwHingeOnFixed and drwFloorBracket each
 * encoded a rule as well as a picture: drawSinglePanel read wallSide, glassGlass
 * and hingeMarks off the combination and worked out how many pieces to draw.
 * As long as the decision lives inside the drawing, a picking list has to
 * restate it, and the two copies drift where nobody can see.
 *
 * The geometry is not touched. The 1,220 lines of drawing — hinges, brackets,
 * dimension lines, slopes, holes, recesses — are the expensive asset here and
 * they are kept exactly. What leaves is the decision.
 *
 * Run: node scripts/test-shapes-drawer.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the engine is loaded and consulted ────────────────────────────────── */
check('the page loads the engine', /<script src="lg-shapes\.js"><\/script>/.test(DEMO), true);
check('and it is loaded before the drawing code runs',
      DEMO.indexOf('lg-shapes.js') < DEMO.indexOf('function drawSinglePanel'), true);
check('the page asks the engine what is at each junction', /lgJunctions\(/.test(DEMO), true);
check('and it asks once for the whole shower, not once per panel',
      (DEMO.match(/lgJunctions\(/g) || []).length <= 2, true);

/* ── the pieces survive — they are the expensive part ──────────────────── */
for (const fn of ['drwBracket', 'drwGGBracket', 'drwHinge', 'drwHingeOnFixed', 'drwFloorBracket']) {
  check(`${fn} is still there to draw with`, new RegExp('function ' + fn + '\\(').test(DEMO), true);
}
check('drawSinglePanel is still the one drawing a panel',
      /function drawSinglePanel\(/.test(DEMO), true);

/* ── the hinge symbol ──────────────────────────────────────────────────── */
/*
 * A hinge is physically a plate, a pivot and a clamp on the glass. The old
 * symbol was a filled rectangle with a dot — in the right place, at the right
 * size, but not recognisable as a hinge to a contractor reading the drawing.
 * Same position, same size, same gold; the geometry is all that changes.
 */
/*
 * The symbol was replaced with a plate-pivot-clamp drawing and the operator
 * rejected it on sight: it read worse than the rectangle it replaced. It is
 * back to the original. A symbol is judged against the eye, not against a
 * description of what the part is — so the next attempt gets looked at before
 * it ships, not after.
 */
{
  const fn = (DEMO.match(/function drwHinge\(x,y\)\{[\s\S]*?\n\}/) || [''])[0];
  check('drwHinge is found', fn.length > 0, true);
  check('it is the original symbol the operator kept',
        /const hw=7,hh=14/.test(fn), true);
  check('and keeps the gold it always had', /#b8922a/.test(fn), true);
  /* the position is computed by the caller and must not move */
  check('the symbol itself computes no position',
        /hingeSide|x\+pw/.test(fn), false);
}
check('the hinge position rule is unchanged',
      /hingeSide==='left'\?x:x\+pw/.test(DEMO), true);

/* ── how far from the edge hardware sits ───────────────────────────────── */
/*
 * The standard is 20 cm from the top and from the bottom, for hinges and for
 * brackets alike. The drawing had 20 in all eight places and sc converts
 * millimetres to pixels, so every piece was drawn two centimetres from the
 * edge — a distance nothing can actually be installed at — and the dimension
 * line printed "20" beside it, carrying the wrong number onward.
 */
{
  const m = DEMO.match(/const EDGE_MM=(\d+)/);
  check('the edge distance is named, not repeated', !!m, true);
  check('and it is 200 mm — twenty centimetres', Number(m && m[1]), 200);
  check('no drawing site still hardcodes 20', /\b20\*sc\b/.test(DEMO), false);
  check('and the dimension line prints the same number it draws',
        /String\(EDGE_MM\)/.test(DEMO), true);
  /* every hinge and bracket row is placed from that one constant */
  check('all eight placements use it',
        (DEMO.match(/EDGE_MM\*sc/g) || []).length >= 8, true);
}

/* ── the position map ──────────────────────────────────────────────────── */
/*
 * Which shape landed in which rectangle on the canvas. Without it there is no
 * way to point at a shape later — not on this screen and not at the check
 * station — and adding it afterwards means going back into the drawing.
 */
check('the drawer reports where each shape landed', /_lgShapeRects/.test(DEMO), true);
check('and the map carries an id with each rectangle',
      /_lgShapeRects[\s\S]{0,400}?\bid\b/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drawer checks passed.');
