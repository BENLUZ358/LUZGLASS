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
/* The chips became drawn cards, and the six shapes moved to lg-catalog.js.
   What must not change is that the gallery offers exactly those six and
   that not one of them describes its own hardware — the engine derives it.
   A chip that carried a bracket count would be a second source of truth,
   and that is what put a door's handle on its hinge side. */
{
  const CAT = fs.readFileSync(path.join(__dirname, '..', 'lg-catalog.js'), 'utf8');
  const kind = k => new RegExp("kind: '" + k + "'").test(CAT);
  check('a fixed panel is offered', kind('fixed'), true);
  /* One door, not two. The other hand comes from "הפוך", which is a
     transform on this definition — two entries were two definitions of
     one thing, free to drift. */
  check('a door is offered', /kind: 'door'/.test(CAT), true);
  check('and only one of it', (CAT.match(/kind: 'door'/g) || []).length, 1);
  check('with a flip to reach the other hand', /function lgFlipAdd/.test(CAT), true);
  check('a mirror', kind('mirror'), true);
  check('and a free shape', kind('shape'), true);
  /* the sloped panel is a shortcut, not a kind — a fixed with the slope on */
  check('a sloped fixed is a fixed with the slope already on',
        /kind: 'fixed', slope: true/.test(CAT), true);
  check('and the step notch is there too', /notch: true/.test(CAT), true);
  /* the SHIPPED set stays small enough to scan on a phone. What the
     factory adds later is the factory's business — this bounds what we
     put there without being asked. */
  check('the shipped set stays scannable', (CAT.match(/kind: '/g) || []).length <= 12, true);

  /* hardware is never baked into a gallery item */
  check('no entry carries a hinge count',   /hingeQty|hinges:/.test(CAT), false);
  check('and none carries a bracket count', /bracketQty|brackets:/.test(CAT), false);
  /* A shape may carry a hole that no meeting produces — a floor bracket,
     a free hole. It may NEVER carry a junction's hardware: hinges and wall
     brackets are derived from what the glass meets, and writing them by
     hand is what put a door's handle on its hinge side. */
  check('no junction hardware is written by hand',
        /'hinge'\s*:|'bracket-wall'|'bracket-gg'/.test(CAT.replace(/LG_CAT_OWN_ROLES[\s\S]*?\};/, '')), false);
  check('and only non-junction roles may be carried',
        /LG_CAT_OWN_ROLES = \{ 'bracket-floor'/.test(CAT), true);

  /* the cards are built from the catalogue, not written out by hand */
  check('the gallery is generated', /renderShapeGallery/.test(DEMO), true);
  check('and every card is drawn by the painter itself',
        DEMO.indexOf("engPaint({...L, dims:[]},'thumb'") > -1, true);
}

/* ── touch ─────────────────────────────────────────────────────────────── */
{
  /* the card is a frame now: a picture to pick, and a flip beneath it.
     Both must be reachable with a thumb. */
  const pick = (DEMO.match(/\.sc-pick\s*\{[^}]*\}/) || [''])[0];
  const flip = (DEMO.match(/\.sc-flip\s*\{[^}]*\}/) || [''])[0];
  check('the gallery card rules are found', pick.length > 0 && flip.length > 0, true);
  check('picking a shape is a 44px target',
        Number((pick.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
  check('and so is flipping it',
        Number((flip.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
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
  /* and sideways too, since the canvas can now be wider than the screen —
     a four-panel shower needs room for its dimensions, and without pan-x
     half the drawing cannot be reached with a finger */
  check('the canvas lets the page scroll vertically',
        /#sk\{touch-action:[^;}]*pan-y/.test(DEMO), true);
  check('and sideways, for a drawing wider than the screen',
        /#sk\{touch-action:[^;}]*pan-x/.test(DEMO), true);
  check('the canvas wrapper scrolls rather than clipping',
        /\.canvas-wrap\{[^}]*overflow-x:auto/.test(DEMO), true);
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
/* reordering by arrows is gone: a shape is added beside the pane whose +
   was pressed, so the order is chosen when it is placed. */
check('a shape lands on the side its + was pressed',
      /if\(at==='left'\) shapeList\.unshift\(item\); else shapeList\.push\(item\);/.test(DEMO), true);
/* and no path reaches the canvas without the rules: the check lives in
   shapeAdd, which every caller goes through */
check('the rules are enforced at the gate, not at one caller',
      /function shapeAdd[\s\S]{0,900}_arrangementErrors\(cand/.test(DEMO), true);
/* glass enters through the + only. Without a side there is no context to
   ask the rules about, so there is nothing to add. */
check('there is no adding without a +',
      DEMO.indexOf('const side=addSide;') > -1 && DEMO.indexOf('if(!side) return;') > -1, true);
check('and an empty canvas has a + of its own to start with',
      DEMO.indexOf('id="btnFirstShape"') > -1, true);
check('validation runs on every change',     /lgValidate\(/.test(DEMO), true);
check('and an error names the shape it is about',
      /lgValidate\([\s\S]{0,300}?\.at\b/.test(DEMO), true);
/* the list now carries glass as well as hardware, and lgOrderLines is what
   merges them — the screen counts nothing itself */
check('the picking list is shown from the engine, not recounted',
      /lgOrderLines\(/.test(DEMO), true);
check('and it covers glass, not hardware alone',
      /lgGlassTotals\(/.test(DEMO), true);

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
  /* the drawer now delegates its panel conversion to lg-layout.js, so any
     run that loads the drawer has to load the engine too */
  const ENG = [fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'),
               fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8')].join('\n');
  const panelsFn = (DEMO.match(/function _shapePanels\(list\)\{[\s\S]*?\n\}/) || [''])[0];
  const showerFn = (DEMO.match(/function _lgShowerOf\(allPanels, ?allPS\)\{[\s\S]*?\n\}/) || [''])[0];
  check('_shapePanels is found', panelsFn.length > 0, true);
  check('_lgShowerOf is found',  showerFn.length > 0, true);

  const ctx = vm.createContext({ selQ: 'zamak', selMM: 8, selG: 'שקוף' });
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

/* ── two kinds of fixed panel ──────────────────────────────────────────── */
/*
 * A fixed panel against a wall with nothing on its other face takes two
 * brackets, not four. The builder assumed a wall at both ends and drew four
 * for a lone panel. Which end is a wall depends on the site, so it is the
 * operator's choice and not something to infer from the shape count.
 *
 * A fixed panel with a door hanging on it is the other kind entirely: that
 * junction is glass-to-glass, the engine returns hinge-gg, and hinges are
 * drawn on the fixed so the door has something to meet.
 */
{
  const vm = require('vm');
  /* the drawer now delegates its panel conversion to lg-layout.js, so any
     run that loads the drawer has to load the engine too */
  const ENG = [fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'),
               fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8')].join('\n');
  const panelsFn = (DEMO.match(/function _shapePanels\(list\)\{[\s\S]*?\n\}/) || [''])[0];
  const showerFn = (DEMO.match(/function _lgShowerOf\(allPanels, ?allPS\)\{[\s\S]*?\n\}/) || [''])[0];

  const run = (list, bound) => {
    const ctx = vm.createContext({ selQ: 'zamak', selMM: 8, selG: 'שקוף' });
    vm.runInContext(ENG + '\nvar shapeBoundary=' + JSON.stringify(bound) +
      ';\nvar shapeList=' + JSON.stringify(list) + ';\n' + panelsFn + '\n' + showerFn, ctx);
    const bom = ctx.lgBOM(ctx._lgShowerOf(ctx._shapePanels(), {}));
    return t => (bom.find(b => b.type === t) || { qty: 0 }).qty;
  };

  const lone = run([{ id: 'a', kind: 'fixed', label: 'קבוע' }], { right: 'wall', left: 'open' });
  check('a fixed panel on one wall takes two brackets', lone('bracket-wall'), 2);

  const spanning = run([{ id: 'a', kind: 'fixed', label: 'קבוע' }], { right: 'wall', left: 'wall' });
  check('and four only when both ends really are walls', spanning('bracket-wall'), 4);

  /* the other kind: a door hangs on it */
  const withDoor = run([{ id: 'a', kind: 'fixed', label: 'קבוע' },
                        { id: 'b', kind: 'door', hingeSide: 'right', label: 'דלת' }],
                       { right: 'wall', left: 'open' });
  check('a fixed carrying a door still takes its two wall brackets',
        withDoor('bracket-wall'), 2);
  check('and the joint between them is a glass-to-glass hinge',
        withDoor('hinge-gg'), 2);
  /* and the hinge really is placed on the shared face. This used to be a
     regex over the drawer's source, which proved a string existed and
     nothing more. The geometry now lives in lg-layout.js and can answer the
     question itself. */
  {
    const vm2 = require('vm');
    const c2 = vm2.createContext({ Math, JSON, Object, Array, String, Number, console });
    vm2.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8') + '\n' +
                     fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), c2);
    const L = c2.lgLayout({ boundary: { right: 'wall', left: 'open' },
      finish: 'shahor', quality: 'zamak',
      shapes: [{ id: 'a', kind: 'fixed', w: 500, h: 2000 },
               { id: 'b', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }] },
      { canvasW: 900 });
    const joint = L.shapes[1].x;
    const hinges = L.hardware.filter(h => h.kind === 'hinge');
    check('so hinges are placed on the face the two panes share',
          hinges.length === 2 && hinges.every(h => Math.abs(h.x - joint) < 30), true);
  }
}

/* ── the drawer and the engine must mean the same face ─────────────────── */
/*
 * Two opposite conventions, and it showed on screen. In the engine 'right'
 * means "toward the previous shape in the array", which is LEFT on the canvas
 * because panels are drawn in array order. In the drawer,
 * hingeSide==='left' ? x : x+pw — 'left' is the canvas left.
 *
 * So the engine's 'right' is the drawer's 'left'. Without the flip, a door
 * hung on the fixed panel beside it was drawn with its hinges against the
 * opposite wall, while the engine separately marked hinges on the shared
 * face: both drawn at once, which cannot exist.
 *
 * The existing combinations settle which way round the drawer reads: p_kd
 * pairs hingeSide:'left' with hingeOnFixed:'prev', so 'left' faces the
 * previous panel.
 */
{
  const vm = require('vm');
  /* the drawer now delegates its panel conversion to lg-layout.js, so any
     run that loads the drawer has to load the engine too */
  const ENG = [fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'),
               fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8')].join('\n');
  const panelsFn = (DEMO.match(/function _shapePanels\(list\)\{[\s\S]*?\n\}/) || [''])[0];
  const showerFn = (DEMO.match(/function _lgShowerOf\(allPanels, ?allPS\)\{[\s\S]*?\n\}/) || [''])[0];

  const build = list => {
    const ctx = vm.createContext({ selQ: 'zamak', selMM: 8, selG: 'שקוף' });
    vm.runInContext(ENG + '\nvar shapeBoundary={right:"wall",left:"open"};\n' +
      'var shapeList=' + JSON.stringify(list) + ';\n' + panelsFn + '\n' + showerFn, ctx);
    const panels = ctx._shapePanels();
    return { panels, js: ctx.lgJunctions(ctx._lgShowerOf(panels, {})) };
  };

  /* the case from the screenshot: a fixed, then a door hinged right */
  const r = build([{ id: 'a', kind: 'fixed', label: 'קבוע' },
                   { id: 'b', kind: 'door', hingeSide: 'right', label: 'דלת' }]);

  /* the engine puts the hinge at the junction the two shapes share */
  check('the engine hinges the door onto the fixed beside it',
        r.js[1].type, 'hinge-gg');
  check('and leaves the far end without hardware', r.js[2].type, null);

  /* the drawer must hang it on that same face. Panels are drawn in array
     order, so the face shared with the previous panel is the canvas left. */
  check('the drawer hangs it on the face they share, not the far wall',
        r.panels[1].hingeSide, 'left');
  check('so the handle lands on the other side', r.panels[1].handleSide, 'right');
  check('and the neighbour marked for a hinge is the previous panel',
        r.panels[1].hingeOnFixed, 'prev');

  /* mirrored: the door hinged left leans on whatever follows it */
  const l = build([{ id: 'a', kind: 'door', hingeSide: 'left', label: 'דלת' },
                   { id: 'b', kind: 'fixed', label: 'קבוע' }]);
  check('a door hinged the other way hangs on the panel after it',
        l.panels[0].hingeSide, 'right');
  check('and names that neighbour', l.panels[0].hingeOnFixed, 'next');
  check('the engine agrees it is a glass-to-glass hinge', l.js[1].type, 'hinge-gg');

  /* a fixed panel carries no hinge side at all */
  check('a fixed panel has no hinge side', r.panels[0].hingeSide, undefined);
}

/* The ends are no longer set by hand. The + already answers the same
   question — may something connect here? — and it asks the rules engine
   rather than the operator. shapeBoundary stays as the state that feeds
   the engine; only its buttons are gone. */
check('the end buttons are gone', /function shapeSetEnd/.test(DEMO), false);
check('but the boundary that feeds the engine remains',
      /let shapeBoundary=/.test(DEMO), true);
check('and the + is what asks whether a side is free',
      /function canAddAt/.test(DEMO), true);
/* A shower has a wall side and an entrance. Glass leans on the wall, so a
   lone fixed takes TWO brackets, not four — a customer ordering one
   replacement pane must see exactly what is cut in it.
   What was broken is that the wall end was treated as a BARRIER, so the +
   never appeared there at all. A wall is what the next pane leans on. */
check('a lone panel has a wall on one side and the entrance on the other',
      /shapeBoundary=\{right:'wall',left:'open'\}/.test(DEMO), true);

/* the strip escapes what it prints — the page has no lgEsc of its own */
check('a shape label is escaped before it becomes html', /_shEsc\(/.test(DEMO), true);
check('and the escaper is defined here, not assumed from firebase-db',
      /function _shEsc\(/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll shape-UI checks passed.');
