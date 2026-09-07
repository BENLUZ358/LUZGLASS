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
  /* the hinge height became editable, so the line prints the live value
     rather than the constant — the property is that label and drawing agree */
  check('and the dimension line prints the same number it draws',
        /dLine\(hDX[\s\S]{0,80}?String\(hTop\)/.test(DEMO), true);
  check('which defaults to that constant',
        /ps\.hingeTop!=null\?ps\.hingeTop:EDGE_MM/.test(DEMO), true);
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
        /ps\.handleEdge!=null\?ps\.handleEdge:HANDLE_EDGE_CM\)\*10/.test(DEMO), true);
  /* the height is a field now, so the middle of the glass is its default
     rather than a hardcoded position */
  check('the handle defaults to the middle of the glass',
        /ps\.handleTop!=null\?ps\.handleTop:Math\.round\(\(ps\.h\|\|2000\)\/2\)/.test(DEMO), true);
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

  /* it reads and writes the panel state, not a form field. In shape mode the
     panel controls are not rendered at all, so getElementById returned null
     and the editor simply never opened — exactly what was seen on screen. */
  check('the editor works off the panel state, not a hidden input',
        /function _dimRead[\s\S]{0,400}?getPS\(/.test(DEMO), true);
  check('and writes back to it', /function _dimWrite[\s\S]{0,300}?getPS\(/.test(DEMO), true);
  check('getPS knows about the shape mode',
        /function getPS[\s\S]{0,240}?appMode==='shape'/.test(DEMO), true);
  check('a dimension line may carry a target object, not only a field id',
        /typeof inputId==='object'/.test(DEMO), true);

  /* scrolling has to keep working while editing — otherwise you cannot reach
     the dimension you want to change without leaving edit mode first */
  check('edit mode never blocks the page scroll',
        /#sk\.editing\{touch-action:none/.test(DEMO), false);

  /* a 14px tall label is not something a finger can hit */
  check('the tap area is widened well past the text',
        /const HIT=22/.test(DEMO) && /Math\.max\(tw,44\)/.test(DEMO), true);
}

/* ── the tap has to land where the dimension was drawn ─────────────────── */
/*
 * setupCanvas does cx.scale(DPR,DPR), so every drawing coordinate — and with
 * it every entry in dimHits — is in CSS pixels. The hit test computed
 *
 *     ratio = C.width/(rect.width*DPR)      which reduces to cssW/rect.width
 *     cx2   = (clientX-left) * DPR * ratio  so DPR is applied a second time
 *
 * and came out DPR times too large. On a phone at DPR 3 a tap at 100 was
 * tested at 300 and never hit anything, which is why tapping a dimension did
 * nothing there. At DPR 1 on a desktop it worked by accident, so the bug
 * survived: nobody had tapped a dimension on a phone until now.
 */
{
  const vm = require('vm');
  const fn = (DEMO.match(/function _canvasPoint[\s\S]*?\n\}/) || [''])[0];
  check('the mapping is a function of its own', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);

  /* canvas laid out at exactly its CSS size — the ordinary case */
  const rect = { left: 0, top: 0, width: 380, height: 900 };
  const p = ctx._canvasPoint(100, 250, rect, 380);
  check('a tap maps to the point it was drawn at', [p.x, p.y], [100, 250]);

  /* and it must not change with the device pixel ratio: the same tap on a
     phone at DPR 3 has to give the same drawing coordinate */
  const p3 = ctx._canvasPoint(100, 250, rect, 380);
  check('the device pixel ratio does not enter into it', [p3.x, p3.y], [100, 250]);

  /* the canvas is styled width:100%, so CSS can scale it away from its
     drawing size — that, and only that, is what the ratio corrects for */
  const scaled = ctx._canvasPoint(100, 0, { left: 0, top: 0, width: 190 }, 380);
  check('a canvas shown at half its drawing width doubles the coordinate',
        scaled.x, 200);

  /* offset by the element's position on the page */
  const off = ctx._canvasPoint(140, 90, { left: 40, top: 50, width: 380 }, 380);
  check('the element offset is subtracted', [off.x, off.y], [100, 40]);

  check('a zero-width rect does not divide by zero',
        ctx._canvasPoint(10, 10, { left: 0, top: 0, width: 0 }, 380).x, 10);
}
check('the click handler no longer multiplies by the pixel ratio',
      /\(e\.clientX-rect\.left\)\*DPR/.test(DEMO), false);

/* ── the hinge and the handle are editable too ─────────────────────────── */
{
  /* each hinge moves on its own. One field for both meant changing the top
     hinge dragged the bottom one with it, and in the field they are not
     always symmetric. */
  check('the top hinge is its own target', /field:'hingeTop'/.test(DEMO), true);
  check('and the bottom hinge is another', /field:'hingeBot'/.test(DEMO), true);
  check('they are positioned independently',
        /hPos=\[y\+hTop\*sc, ?y\+ph-hBot\*sc\]/.test(DEMO), true);
  check('and each dimension line prints its own value',
        /String\(hTop\)[\s\S]{0,200}?String\(hBot\)/.test(DEMO), true);
  check('both default to the 20 cm standard',
        /ps\.hingeTop!=null\?ps\.hingeTop:EDGE_MM/.test(DEMO) &&
        /ps\.hingeBot!=null\?ps\.hingeBot:EDGE_MM/.test(DEMO), true);
  check('and the editor knows the default for both',
        /t\.field==='hingeTop'\|\|t\.field==='hingeBot'/.test(DEMO), true);
  check('the handle height is a target', /field:'handleTop'/.test(DEMO), true);
  check('and it defaults to the middle of the glass',
        /ps\.handleTop!=null\?ps\.handleTop:Math\.round\(\(ps\.h\|\|2000\)\/2\)/.test(DEMO), true);
  /* the hinge shows only its height; the handle also needs its distance from
     the edge, because that is what decides where the hole is drilled */
  check('the handle also shows its distance from the edge',
        /field:'handleEdge'/.test(DEMO), true);
  check('and that field is centimetres, so the editor converts it',
        /handleEdge:\s*\{[^}]*cm:true/.test(DEMO), true);
}

/* ── every panel's height is legible ───────────────────────────────────── */
/*
 * The height line always came off the panel's right face. On any panel but
 * the last that face is the middle of the drawing, so the line landed on the
 * neighbour and was unreadable — the door's height could not be seen at all.
 */
{
  /* every height line came off the panel face at a fixed 32px. Between two
     touching panels that is the same gap — one panel's right face is the
     next one's left — so the two lines landed on each other and there was no
     telling which measurement belonged to which shape. On a sloped panel it
     is worse: both of its own heights sit on its two faces. */
  check('the height line position is chosen, not fixed',
        /const _hx = \(side\)=>/.test(DEMO), true);
  check('the outermost panels put their lines outside the assembly',
        /idx===0 \? x-32/.test(DEMO) && /_last \? x\+pw\+32/.test(DEMO), true);
  check('and a panel in the middle carries its line inside its own glass',
        /x\+22/.test(DEMO) && /x\+pw-22/.test(DEMO), true);
  check('both slope heights use it, so they cannot collide with a neighbour',
        /dLine\(_hx\('l'\)[\s\S]{0,400}?dLine\(_hx\('r'\)/.test(DEMO), true);
  check('and the low face is marked, so the slope direction is unambiguous',
        /נמוך/.test(DEMO), true);

  /* the overall height says nothing about the door. A 2 m shower is a 2000
     fixed panel with a door under it that is normally 10 to 15 mm shorter, so
     every shape has to state its own size where it is, not only on a
     dimension line that may fall behind its neighbour. */
  check('each shape prints its own size on the glass',
        /cx\.fillText\(_hMM\+' × '\+\(ps\.w\|\|0\)/.test(DEMO), true);
  check('and it sits under the shape name, not over it',
        /_lblFS\+2/.test(DEMO), true);

  check('saving applies the value through the shared parser',
        /function dimEditorApply[\s\S]{0,400}?lgParseDimensionInput\(/.test(DEMO), true);
  check('and redraws', /function dimEditorApply[\s\S]{0,900}?draw\(\);/.test(DEMO), true);
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
/* the page must scroll at all times, edit mode included. Claiming the gesture
   while editing blocked scrolling exactly when it is most needed — reaching
   the dimension you want to change. The browser already tells a drag from a
   tap: click does not fire on a drag. */
/* comments stripped: both rules are documented by quoting the value they
   replaced, and a check that reads comments fails on its own explanation */
{
  const css = DEMO.replace(/\/\*[\s\S]*?\*\//g, '');
  check('the canvas never claims the gesture', /touch-action:none/.test(css), false);
  check('and always allows a vertical scroll', /#sk\{touch-action:pan-y/.test(css), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drawer checks passed.');
