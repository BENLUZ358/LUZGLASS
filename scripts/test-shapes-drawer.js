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
{
  const fn = (DEMO.match(/function drwHinge\(x,y\)\{[\s\S]*?\n\}/) || [''])[0];
  check('drwHinge is found', fn.length > 0, true);
  check('it draws a pivot', /arc\(/.test(fn), true);
  check('and a plate and a clamp either side of it',
        (fn.match(/fillRect\(/g) || []).length >= 2, true);
  check('and keeps the gold it always had', /#b8922a/.test(fn), true);
  /* the position is computed by the caller and must not move */
  check('the symbol itself computes no position',
        /hingeSide|x\+pw/.test(fn), false);
}
check('the hinge position rule is unchanged',
      /hingeSide==='left'\?x:x\+pw/.test(DEMO), true);

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
