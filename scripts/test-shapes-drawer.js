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

/* ── where the handle sits by default ──────────────────────────────────── */
/*
 * Six centimetres in from the side, and halfway up the glass. The contractor
 * can move it, but that is what is drawn until he does.
 *
 * Two bugs lived here, both the same unit mistake as the edge distance: the
 * input is labelled ס"מ while the drawing multiplied by sc, which converts
 * millimetres — so the handle sat 6 mm from the edge rather than 60. And the
 * height was y+100*sc for any door taller than 20 cm, putting the handle ten
 * centimetres below the top instead of at the middle.
 */
{
  const eh = DEMO.match(/const HANDLE_EDGE_CM=(\d+)/);
  check('the handle inset is named', !!eh, true);
  check('and it is 6 cm', Number(eh && eh[1]), 6);
  check('the drawing converts those centimetres to millimetres',
        /ps\.handleEdge\|\|HANDLE_EDGE_CM\)\*10\*sc/.test(DEMO), true);
  check('the handle is centred on the glass', /const handleY=y\+ph\/2/.test(DEMO), true);
  check('and no longer pinned near the top', /handleY=\(ps\.h\|\|2000\)>200/.test(DEMO), false);

  /* the same unit mistake sat next to it, on the towel-rail holes */
  const ts = DEMO.match(/const TOWEL_SPACING_CM=(\d+)/);
  check('the towel spacing is named too', !!ts, true);
  check('and it is converted the same way', /ps\.towelSpacing\|\|TOWEL_SPACING_CM\)\*10/.test(DEMO), true);
  check('its dimension line prints millimetres, like every other one',
        /dLine\([\s\S]{0,120}?String\(spMM\)/.test(DEMO), true);

  /* the defaults the panel starts with are the same constants, so the field
     and the drawing cannot drift apart */
  check('mkPS starts from the same constants',
        /handleEdge:HANDLE_EDGE_CM,towelSpacing:TOWEL_SPACING_CM/.test(DEMO), true);
  /* and the contractor can still change it */
  check('the inset is still an editable field', /id="\$\{pfx\}_hEd_\$\{i\}"/.test(DEMO), true);
}

/* ── edit mode ─────────────────────────────────────────────────────────── */
/*
 * Tapping a dimension used to scroll the page away from the drawing to a form
 * field below it — the opposite of what a contractor needs. Now a tap opens a
 * small editor at the dimension itself and the drawing follows.
 *
 * But a canvas that reacts to every touch cannot be scrolled past on a phone:
 * a drag to scroll lands as a tap and opens something. So the reaction is
 * behind an explicit edit mode. Off by default, the canvas is inert and the
 * page scrolls; on, dimensions become editable. Save turns it off again.
 */
{
  check('there is an edit mode', /function setEditMode/.test(DEMO), true);
  check('and it starts off, so the drawing is inert until asked',
        /let editMode\s*=\s*false/.test(DEMO), true);
  check('there is a control to turn it on', /id="btnEditMode"/.test(DEMO), true);

  const click = (DEMO.match(/C\.addEventListener\('click'[\s\S]*?\n\}\);/) || [''])[0];
  check('the canvas click handler is found', click.length > 0, true);
  check('it does nothing at all while edit mode is off', /if\(!editMode\)\s*return;/.test(click), true);
  /* the old behaviour: it scrolled you away to a form field */
  check('and it no longer scrolls the page away from the drawing',
        /scrollIntoView/.test(click), false);
  check('a tap opens the editor instead', /openDimEditor\(/.test(click), true);

  const ed = (DEMO.match(/function openDimEditor[\s\S]*?\n\}/) || [''])[0];
  check('the editor is found', ed.length > 0, true);
  check('it opens at the dimension that was tapped', /clientX|hit\.x/.test(ed), true);
  check('and it starts from the value that is there now', /\.value\s*=/.test(ed), true);

  check('saving applies the value through the shared parser',
        /function dimEditorApply[\s\S]{0,400}?lgParseDimensionInput\(/.test(DEMO), true);
  check('and redraws', /function dimEditorApply[\s\S]{0,500}?draw\(\)/.test(DEMO), true);
  check('the editor can be dismissed without changing anything',
        /function closeDimEditor/.test(DEMO), true);
  check('and Escape closes it', /Escape/.test(DEMO), true);
}
{
  const css = (DEMO.match(/#dimEditor\s*\{[^}]*\}/) || [''])[0];
  check('the editor has a rule', css.length > 0, true);
  const inp = (DEMO.match(/#dimEditorInput\s*\{[^}]*\}/) || [''])[0];
  check('its input is a 44px target',
        Number((inp.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
  /* iOS zooms the page when a focused input is under 16px */
  check('and 16px, so focusing it does not zoom the page on iOS',
        Number((inp.match(/font-size:\s*(\d+)px/) || [])[1]) >= 16, true);
}
{
  const css = (DEMO.match(/#btnEditMode\s*\{[^}]*\}/) || [''])[0];
  check('the edit-mode button is a 44px target',
        Number((css.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
}
/* while editing, the canvas may claim the touch; otherwise the page must scroll */
check('the canvas only claims gestures while editing',
      /#sk\.editing\{touch-action:none/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drawer checks passed.');
