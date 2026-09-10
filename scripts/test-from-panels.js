#!/usr/bin/env node
/**
 * Tests lgFromPanels — the one place where the drawer's model and the
 * engine's model touch.
 *
 * The drawer holds `panels` (what a pane is) and `pStates` (how big it is).
 * The engine holds one shape per pane. Everything the drawer knows has to
 * survive the crossing, and two things here have already caused real bugs:
 *
 *   • pStates arrives as an OBJECT keyed by index, not an array. Calling
 *     .map on it killed the drawing after the first width line.
 *   • the hinge convention is INVERTED between the two. The engine's
 *     'right' faces the previous shape, which is canvas LEFT. Doors were
 *     drawn with the hinges on the handle side.
 *
 * Run: node scripts/test-from-panels.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgFromPanels, lgLayout, lgValidate } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

console.log('');

/* ── pStates is an object, not an array ─────────────────────────────────── */
{
  const panels = [{ type: 'fixed', label: 'קבוע' }, { type: 'door', label: 'דלת', hingeSide: 'left' }];
  const asObject = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } };
  const asArray = [{ w: 500, h: 2000 }, { w: 800, h: 1985 }];

  check('an object keyed by index is read correctly',
        lgFromPanels(panels, asObject).shapes.map(s => [s.w, s.h]), [[500, 2000], [800, 1985]]);
  check('and an array gives the same result',
        JSON.stringify(lgFromPanels(panels, asArray).shapes),
        JSON.stringify(lgFromPanels(panels, asObject).shapes));
  check('a missing state falls back rather than throwing',
        lgFromPanels(panels, {}).shapes.map(s => [s.w, s.h]), [[500, 2000], [800, 2000]]);
}

/* ── the inverted hinge convention ──────────────────────────────────────── */
/* The drawer says 'left' meaning canvas-left. The engine says 'right'
   meaning "toward the previous shape", which IS canvas-left. They are
   mirror images, and the crossing has to flip. */
{
  const conv = side => lgFromPanels(
    [{ type: 'fixed' }, { type: 'door', hingeSide: side }],
    { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } }).shapes[1].hingeSide;
  check("the drawer's 'left' becomes the engine's 'right'", conv('left'), 'right');
  check("and the drawer's 'right' becomes the engine's 'left'", conv('right'), 'left');

  /* hingeOnFixed names the NEIGHBOUR rather than a side of the canvas, so it
     is direct and it wins. The four old fields disagree with each other, and
     only this one says what is actually joined to what. */
  const byNeighbour = v => lgFromPanels(
    [{ type: 'fixed' }, { type: 'door', hingeSide: 'right', hingeOnFixed: v }],
    { 0: { w: 500 }, 1: { w: 800 } }).shapes[1].hingeSide;
  check("hingeOnFixed:'prev' overrides a contradicting hingeSide", byNeighbour('prev'), 'right');
  check("and 'next' does too", byNeighbour('next'), 'left');

  /* and the flip has to land the hinge on the shared face, not the wall */
  const sh = lgFromPanels([{ type: 'fixed' }, { type: 'door', hingeSide: 'left' }],
                          { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } },
                          { boundary: { right: 'wall', left: 'open' } });
  const L = lgLayout(sh, { canvasW: 900 });
  const joint = L.shapes[1].x;
  const hinges = L.hardware.filter(h => h.kind === 'hinge');
  check('so the hinge lands on the face the two panes share',
        hinges.length > 0 && hinges.every(h => Math.abs(h.x - joint) < 30), true);
  check('and the handle hole sits on the far side from it',
        L.hardware.filter(h => h.kind === 'hole').every(h => h.x > joint + 50), true);
}

/* ── slope: axis + side becomes a pair of measurements ──────────────────── */
{
  const withSlope = (axis, side) => lgFromPanels([{ type: 'fixed' }],
    { 0: { w: 500, h: 2000, hasSlope: true, slopeAxis: axis, slopeSide: side,
           slopeH1: 2000, slopeH2: 1750 } }).shapes[0];

  const h = withSlope('height', 'bottom');
  check('a height slope becomes two heights', [h.slopeH1, h.slopeH2], [2000, 1750]);
  check('and carries the side chosen', h.slopeSideH, 'bottom');
  check('without inventing a width slope', h.slopeW1, undefined);

  const w = withSlope('width', 'left');
  check('a width slope becomes two widths', [w.slopeW1, w.slopeW2], [2000, 1750]);
  check('and carries its side', w.slopeSideV, 'left');
  check('without inventing a height slope', w.slopeH1, undefined);

  check('and no slope flag means no slope at all',
        lgFromPanels([{ type: 'fixed' }],
          { 0: { w: 500, h: 2000, slopeH1: 2000, slopeH2: 1750 } }).shapes[0].slopeH1, undefined);
}

/* ── everything the customer set has to survive the crossing ────────────── */
{
  const st = { w: 500, h: 2000, notchW: 200, notchH: 500, notchHIn: 470,
               notchRest: 290, notchSide: 'left', notchBracket: 'both',
               hingeTop: 150, hingeBot: 340, bracketTop: 180, bracketBot: 220,
               bracketInset: 40, handleEdge: 8, handleDist: 900, handleRef: 'top',
               thickness: 10, floorBracket: true };
  const s = lgFromPanels([{ type: 'door', hingeSide: 'left' }], { 0: st }).shapes[0];

  check('the notch crosses whole',
        [s.notchW, s.notchH, s.notchHIn, s.notchRest, s.notchSide, s.notchBracket],
        [200, 500, 470, 290, 'left', 'both']);
  check('hinge and bracket positions cross',
        [s.hingeTop, s.hingeBot, s.bracketTop, s.bracketBot, s.bracketInset],
        [150, 340, 180, 220, 40]);
  check('handle settings cross', [s.handleEdge, s.handleDist, s.handleRef], [8, 900, 'top']);
  check('thickness and floor bracket cross', [s.thickness, s.floorBracket], [10, true]);

  /* zero is a real value, not "unset" — a hinge 0mm from the edge is wrong,
     but silently turning it into 200 hides the mistake from the fitter */
  const z = lgFromPanels([{ type: 'door' }], { 0: { w: 800, h: 1985, hingeTop: 0 } }).shapes[0];
  check('zero survives instead of turning into the default', z.hingeTop, 0);
}

/* ── the wall comes off the end panels ──────────────────────────────────── */
/* The drawer keeps wallSide on each panel; the engine keeps a boundary on
   the shower. That boundary is what decides whether the first joint is a
   wall bracket or an open edge — get it wrong and the hardware list is
   wrong too. */
{
  const b = (first, last) => lgFromPanels(
    [{ type: 'fixed', wallSide: first }, { type: 'fixed', wallSide: last }],
    { 0: { w: 500, h: 2000 }, 1: { w: 500, h: 2000 } }).boundary;

  check('a panel against the wall on the right gives a wall there',
        b('right', 'none').right, 'wall');
  /* Glass at the end of a RUN meets a wall even when the panel does not
     say so. Without it the last fixed came out with no brackets at all —
     nothing holding it, and nothing to build. A single pane is the one
     exception: it has no inner neighbour, so its declared side stands and
     it keeps two brackets, which is what a replacement order needs. */
  check('but glass at the end of a run meets a wall',
        b('right', 'none').left, 'wall');
  check('while a single pane keeps the side it declared',
        lgFromPanels([{ type: 'fixed', wallSide: 'right' }],
                     { 0: { w: 500, h: 2000 } }).boundary.left, 'open');
  check('"both" counts on either side', [b('both', 'both').right, b('both', 'both').left],
        ['wall', 'wall']);
  check('an explicit boundary still wins',
        lgFromPanels([{ type: 'fixed', wallSide: 'none' }], { 0: {} },
                     { boundary: { right: 'wall', left: 'wall' } }).boundary.right, 'wall');
}

/* ── the result is something the engine accepts ─────────────────────────── */
{
  const sh = lgFromPanels(
    [{ type: 'fixed', wallSide: 'right' }, { type: 'door', hingeSide: 'left' },
     { type: 'fixed', wallSide: 'left' }],
    { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 }, 2: { w: 500, h: 2000 } });
  check('a normal combination passes validation', lgValidate(sh), []);
  check('and lays out without throwing', lgLayout(sh, { canvasW: 900 }).shapes.length, 3);

  check('an empty list gives an empty shower', lgFromPanels([], {}).shapes, []);
  check('and nothing at all does not throw', lgFromPanels(null, null).shapes, []);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll conversion checks passed.');
