#!/usr/bin/env node
/**
 * Tests the shape gallery and the assembly strip.
 *
 * The gallery is short on purpose — six shapes, two of which are shortcuts
 * rather than kinds of their own. A sloped fixed panel is a fixed panel with
 * hasSlope already on (the slope is a property that can be turned off again
 * after it is placed), and a free shape is the kind:'shape' the tool already
 * has. No gallery item bakes hardware in: the engine derives hardware from the
 * junctions, so a chip carrying its own hinge count would contradict it.
 *
 * The split between what is touched on the drawing and what is touched in the
 * strip is by TARGET SIZE, not by which surface it is:
 *
 *     a panel's dimension line   ~90×30px   on the drawing
 *     a slope button             ~30×30px   on the drawing
 *     a hinge or a bracket       ~10px      in the strip
 *
 * A dimension line is a big target on a phone. A hinge is not.
 *
 * Run: node scripts/test-shapes-ui.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the new mode sits beside the old ones, it does not replace them ───── */
/*
 * The combination path is what a contractor uses today: one tap for "fixed
 * and door". Removing it before the library exists would make the new tool
 * worse than the old one at the common case.
 */
check('the shape mode is a third tab', /setMode\('shape'\)/.test(DEMO), true);
check('and the combination mode is still there', /setMode\('combo'\)/.test(DEMO), true);
check('and so is item-by-item', /setMode\('item'\)/.test(DEMO), true);
{
  const fn = (DEMO.match(/function setMode\(m\)\{[\s\S]*?\n\}/) || [''])[0];
  check('setMode is found', fn.length > 0, true);
  check('it shows the shape panel for the shape mode', /shapeUI/.test(fn), true);
  check('and hides it for the others',
        /shapeUI'\)\.style\.display\s*=\s*m==='shape'/.test(fn), true);
}

/* ── the gallery ───────────────────────────────────────────────────────── */
check('a fixed panel is offered',       /data-shape="fixed"/.test(DEMO), true);
check('a door hinged right',            /data-shape="door"[^>]*data-hinge="right"/.test(DEMO), true);
check('a door hinged left',             /data-shape="door"[^>]*data-hinge="left"/.test(DEMO), true);
check('a mirror',                       /data-shape="mirror"/.test(DEMO), true);
check('and a free shape',               /data-shape="shape"/.test(DEMO), true);
/* the sloped panel is a shortcut, not a kind — it is a fixed with the slope on */
check('a sloped fixed is a fixed with the slope already on',
      /data-shape="fixed"[^>]*data-slope="1"/.test(DEMO), true);
check('the gallery stays short', (DEMO.match(/data-shape="/g) || []).length <= 8, true);

/* hardware is never baked into a gallery item — the engine derives it */
check('no chip carries a hinge count',   /data-shape="[^"]*"[^>]*data-hinge-qty/.test(DEMO), false);
check('and none carries a bracket count', /data-shape="[^"]*"[^>]*data-bracket/.test(DEMO), false);

/* ── touch ─────────────────────────────────────────────────────────────── */
{
  const css = (DEMO.match(/\.shape-chip\s*\{[^}]*\}/) || [''])[0];
  check('the gallery chip rule is found', css.length > 0, true);
  check('a chip is at least a 44px target',
        Number((css.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
}
{
  const css = (DEMO.match(/\.shape-strip\s*\{[^}]*\}/) || [''])[0];
  check('the strip rule is found', css.length > 0, true);
  check('the strip scrolls sideways rather than wrapping',
        /overflow-x\s*:\s*auto/.test(css), true);
}
{
  const css = (DEMO.match(/\.strip-item\s*\{[^}]*\}/) || [''])[0];
  check('a strip item is a 44px target too',
        Number((css.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
}
check('motion is dropped for anyone who asked for that',
      /prefers-reduced-motion[\s\S]{0,300}(shape-chip|strip-item)/.test(DEMO), true);
check('the small controls in the strip can be reached by keyboard',
      /\.strip-row button:focus-visible/.test(DEMO), true);
check('and so can a gallery chip',
      /\.shape-chip:focus-visible/.test(DEMO), true);

/* ── phone, iPad, desktop ──────────────────────────────────────────────── */
/*
 * The file already documents its breakpoints as lg-ui.css's 600 / 900 / 1200,
 * and uses max-width:600 and min-width:901. The gallery follows those rather
 * than inventing its own: three chips across a 375px phone leaves 116px for an
 * icon and two words, so the phone gets two.
 */
{
  const phone   = (DEMO.match(/@media \(max-width:600px\)\{[\s\S]*?\n\}/) || [''])[0];
  const tablet  = (DEMO.match(/@media \(min-width:601px\) and \(max-width:900px\)\{[\s\S]*?\n\}/) || [''])[0];
  const desktop = (DEMO.match(/@media \(min-width:901px\)\{[\s\S]*?\n\}/) || [''])[0];

  check('there is a phone rule',   phone.length > 0, true);
  check('there is an iPad rule',   tablet.length > 0, true);
  check('there is a desktop rule', desktop.length > 0, true);

  check('a phone gets two chips across',   /shape-gallery\{grid-template-columns:repeat\(2/.test(phone), true);
  check('an iPad portrait gets three',     /shape-gallery\{grid-template-columns:repeat\(3/.test(tablet), true);
  check('and a desktop fits all six',      /shape-gallery\{grid-template-columns:repeat\(6/.test(desktop), true);

  /* the strip is the only thing allowed to scroll sideways, and only where
     there is not room for it to wrap */
  check('the strip wraps instead of scrolling once there is room',
        /shape-strip\{flex-wrap:wrap;overflow-x:visible/.test(desktop), true);
  check('no rule makes the page itself scroll sideways',
        /body[^{]*\{[^}]*overflow-x\s*:\s*auto/.test(DEMO), false);

  /* the canvas must not swallow the page scroll. It carries a click listener
     and no gesture handler at all, so touch-action:none bought nothing and
     cost the ability to scroll — on a phone the canvas fills the screen and
     there is no margin left to drag from. */
  check('the canvas lets the page scroll vertically',
        /#sk\{touch-action:pan-y/.test(DEMO), true);
  check('and does not claim every gesture',
        /#sk\{touch-action:none/.test(DEMO), false);

  /* body type never drops below the floor */
  const sizes = (DEMO.match(/\.(shape-chip|strip-item|shape-err|shape-bom)[^{]*\{[^}]*font-size:(\d+)px/g) || [])
    .map(s => Number(s.match(/font-size:(\d+)px/)[1]));
  check('nothing in the builder is under 12px', sizes.every(n => n >= 12), true);
}

/* ── the engine drives what the screen says ────────────────────────────── */
check('adding a shape rebuilds the drawing', /function shapeAdd/.test(DEMO), true);
check('and a shape can be removed again',    /function shapeRemove/.test(DEMO), true);
check('the shapes can be reordered',         /function shapeMove/.test(DEMO), true);
check('validation runs on every change',     /lgValidate\(/.test(DEMO), true);
check('and an error names the shape it is about',
      /lgValidate\([\s\S]{0,300}?\.at\b/.test(DEMO), true);
check('the picking list is shown from the engine, not recounted',
      /lgBOM\(/.test(DEMO), true);

/* ── the shape mode actually reaches the drawing ───────────────────────── */
/*
 * getPanels decides what draw() renders. Without the shape mode in it, the
 * gallery would add shapes to a list that nothing ever drew — the screen
 * would look broken with every unit test green.
 */
{
  const fn = (DEMO.match(/function getPanels\(\)\{[\s\S]*?\n\}/) || [''])[0];
  check('getPanels is found', fn.length > 0, true);
  check('it feeds the shape mode into the same drawing path',
        /appMode==='shape'/.test(fn), true);
  const st = (DEMO.match(/function getPStates\(\)\{[\s\S]*?\n\}/) || [''])[0];
  check('and so does getPStates', /appMode==='shape'/.test(st), true);
}
check('the shape mode reuses drawComboMode rather than a second drawing path',
      /function drawShapeMode/.test(DEMO), false);

/* ── the bridge and the engine agree, run end to end ───────────────────── */
/*
 * _shapePanels writes wallSide onto the outer shapes because the bridge reads
 * the boundary from it. Without that a fixed panel in shape mode gets no wall
 * brackets at all, and the picking list quietly loses four pieces.
 */
{
  const vm = require('vm');
  const ENG = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');
  const panelsFn = (DEMO.match(/function _shapePanels\(\)\{[\s\S]*?\n\}/) || [''])[0];
  const showerFn = (DEMO.match(/function _lgShowerOf\(allPanels, ?allPS\)\{[\s\S]*?\n\}/) || [''])[0];
  check('_shapePanels is found', panelsFn.length > 0, true);
  check('_lgShowerOf is found',  showerFn.length > 0, true);

  const ctx = vm.createContext({ selQ: 'zamak' });
  vm.runInContext(ENG + '\n' +
    'var shapeBoundary={right:"wall",left:"wall"};\n' +
    'var shapeList=[{id:"a",kind:"fixed",label:"קבוע"},' +
                   '{id:"b",kind:"door",hingeSide:"right",label:"דלת"},' +
                   '{id:"c",kind:"fixed",label:"קבוע"}];\n' +
    panelsFn + '\n' + showerFn, ctx);

  const panels = ctx._shapePanels();
  check('the outer shapes carry the boundary', [panels[0].wallSide, panels[2].wallSide], ['right', 'left']);
  check('and a shape in the middle carries none', panels[1].wallSide, 'none');

  const bom = ctx.lgBOM(ctx._lgShowerOf(panels, {}));
  const q = t => (bom.find(b => b.type === t) || { qty: 0 }).qty;
  /* the count this whole engine exists for */
  check('fixed + door + fixed built from the gallery gives four wall brackets', q('bracket-wall'), 4);
  check('two hinges, not four',   q('hinge-gg'), 2);
  check('and one handle',         q('handle'), 1);
}

/* the strip escapes what it prints — the page has no lgEsc of its own */
check('a shape label is escaped before it becomes html', /_shEsc\(/.test(DEMO), true);
check('and the escaper is defined here, not assumed from firebase-db',
      /function _shEsc\(/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll shape-UI checks passed.');
