#!/usr/bin/env node
/**
 * Turning something on in the properties sheet has to turn it on.
 *
 * "שיפוע בגובה" did nothing. The box ticked and un-ticked itself on the
 * next repaint, while "שיפוע ברוחב" right underneath it worked fine. Two
 * separate causes, and they hid each other:
 *
 *   1. The toggle only wrote a default when the field was `== null`. In
 *      JavaScript `false == null` is FALSE, and mkPS hands every pane a
 *      `hasSlope: false`. So the flag could never be set. The width slope
 *      escaped only because `hasSlopeW` is absent from mkPS entirely —
 *      which is exactly the difference that showed on screen.
 *
 *   2. Behind that, mkPS also hands over slopeH1: 2000 and slopeH2: 1800.
 *      Those are "what you would get if you switched it on", not state,
 *      and the `== null` guard preserved them as though someone had typed
 *      them. A 2200mm pane would have been given a 2000/1800 slope —
 *      shorter than the glass it is describing.
 *
 * So switching on now WRITES the values, and switching off deletes them.
 * Nothing is lost that was not already lost: switching off has always
 * deleted, so off-and-on has always reset.
 *
 * Run: node scripts/test-sheet-toggle.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const grab = n => {
  const i = DEMO.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
};

/* the real mkPS, the real sheetToggle, and the real engine behind them */
function pane(over) {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var DOOR_H_MM=1985, HANDLE_EDGE_CM=6, TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'var sheetPfx="shape"; function _sheetIdx(){ return 0; }' +
    'function renderShapeSheet(){} function renderShapeUI(){} function draw(){}', ctx);
  vm.runInContext(grab('mkPS'), ctx);
  vm.runInContext(grab('sheetToggle'), ctx);
  vm.runInContext('var PS=mkPS({type:"fixed"}); function getPS(){ return PS; }', ctx);
  Object.assign(ctx.PS, over || {});
  return {
    ps: () => ctx.PS,
    run: e => vm.runInContext(e, ctx),
    /* what the sheet would offer for this pane, computed the way it does */
    drop: v => Math.max(1, v - Math.min(50, Math.round(v / 10))),
    /* all the way to the glass outline the cutter receives */
    poly: () => {
      ctx.P = [{ type: 'fixed', wallSide: 'both' }]; ctx.S = { 0: ctx.PS };
      ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
      return vm.runInContext('lgLayout(SH,{canvasW:600})', ctx).shapes[0].poly;
    },
  };
}
const slanted = (p, a, b) => Math.abs(p[a][1] - p[b][1]) > 1;

console.log('');

/* ── the trap itself ──────────────────────────────────────────────────── */
{
  check('mkPS really does hand over a false, not an absent field',
        /hasSlope:false/.test(DEMO), true);
  check('and it is only the height axis that has one — the width has none',
        /hasSlopeW:\s*false/.test(DEMO), false);
  check('so the toggle can no longer ask whether the field is empty',
        /if\(ps\[k\]==null\)/.test(DEMO), false);
}

/* ── switching the height slope on ────────────────────────────────────── */
{
  const p = pane({ h: 2200, w: 255 });
  check('it starts off', p.ps().hasSlope, false);

  p.run('sheetToggle("slopeH",true,{hasSlope:true,slopeH1:2200,slopeH2:' + p.drop(2200) + '})');
  check('switching on sets the flag', p.ps().hasSlope, true);
  check('and the heights come from this pane, not from mkPS',
        [p.ps().slopeH1, p.ps().slopeH2], [2200, 2150]);
  check('not the 2000/1800 that were sitting there',
        p.ps().slopeH1 === 2000 && p.ps().slopeH2 === 1800, false);

  const poly = p.poly();
  check('and the glass is actually cut on a slant', slanted(poly, 2, 3), true);
  check('with the head left level — a shower drains at the floor',
        slanted(poly, 0, 1), false);
}

/* ── switching it off ─────────────────────────────────────────────────── */
{
  const p = pane({ h: 2200 });
  p.run('sheetToggle("slopeH",true,{hasSlope:true,slopeH1:2200,slopeH2:2150})');
  p.run('sheetToggle("slopeH",false,{hasSlope:true,slopeH1:2200,slopeH2:2150})');
  check('switching off clears the flag and both numbers',
        ['hasSlope', 'slopeH1', 'slopeH2'].filter(k => k in p.ps()), []);
  check('and the glass is a rectangle again', slanted(p.poly(), 2, 3), false);

  p.run('sheetToggle("slopeH",true,{hasSlope:true,slopeH1:2200,slopeH2:2150})');
  check('and it comes back on', p.ps().hasSlope, true);
}

/* ── the width slope, which was the one that worked ───────────────────── */
{
  const p = pane({ h: 2200, w: 255 });
  p.run('sheetToggle("slopeW",true,{hasSlopeW:true,slopeW1:255,slopeW2:' + p.drop(255) + '})');
  check('the width slope still switches on', p.ps().hasSlopeW, true);
  check('with widths from this pane', [p.ps().slopeW1, p.ps().slopeW2], [255, 229]);
  p.run('sheetToggle("slopeW",false,{hasSlopeW:true,slopeW1:255,slopeW2:229})');
  check('and off again', 'hasSlopeW' in p.ps(), false);
}

/* ── both at once: four different faces ───────────────────────────────── */
{
  const p = pane({ h: 2200, w: 600 });
  p.run('sheetToggle("slopeH",true,{hasSlope:true,slopeH1:2200,slopeH2:2150})');
  p.run('sheetToggle("slopeW",true,{hasSlopeW:true,slopeW1:600,slopeW2:550})');
  check('a pane can slope on both axes at once',
        [p.ps().hasSlope, p.ps().hasSlopeW], [true, true]);
  check('and neither switch erased the other',
        [p.ps().slopeH1, p.ps().slopeW1], [2200, 600]);
}

/* ── the notch, which shares the same switch ──────────────────────────── */
{
  const p = pane({ h: 2000, w: 900 });
  p.run('sheetToggle("notch",true,NOTCH_DEF)');
  check('the notch still switches on', [p.ps().notchW, p.ps().notchH], [200, 500]);
  p.run('sheetToggle("notch",false,NOTCH_DEF)');
  check('and off', ['notchW', 'notchH'].filter(k => k in p.ps()), []);
}

/* ── a small pane must not switch on into nothing ─────────────────────── */
/* the engine draws a slope only when both numbers are positive AND
   differ. A flat 50 would have made the same silent failure on anything
   shorter than 50mm — the box ticks and the glass does not change. */
{
  [2200, 500, 120, 40, 12].forEach(h => {
    const p = pane({ h: h, w: 900 });
    const low = p.drop(h);
    check(`  a ${h}mm pane gets a slope that is real`, low > 0 && low !== h, true);
    p.run('sheetToggle("slopeH",true,{hasSlope:true,slopeH1:' + h + ',slopeH2:' + low + '})');
    /* below about 40mm the whole pane is a few pixels tall and one
       millimetre is thinner than a line, so the DRAWING cannot show it.
       The state is still right, which is what reaches the cutter. */
    if (h >= 40)
      check(`  and ${h}mm is actually cut on a slant`, slanted(p.poly(), 2, 3), true);
    else
      check(`  and ${h}mm carries it in the state, too small to draw`,
            [p.ps().slopeH1, p.ps().slopeH2], [h, low]);
  });
  check('the offered drop is a tenth, capped at 50 — never a flat 50',
        /Math\.max\(1, v-Math\.min\(50, Math\.round\(v\/10\)\)\)/.test(DEMO), true);
  check('and both axes are offered it',
        (DEMO.match(/drop\([HW]\)/g) || []).sort(), ['drop(H)', 'drop(W)']);
}

/* ── the sheet shows what the engine will do ──────────────────────────── */
{
  /* nobody writes slopeSideH until it is clicked, so the sheet's selected
     button and the engine's fallback have to agree on the same face */
  check('the sheet shows the floor as the cut side by default',
        /slopeSideH[\s\S]{0,80}ps\.slopeSideH\|\|'bottom'/.test(DEMO), true);
  check('and the engine falls back to the same one',
        /pick\(one,\['top','bottom'\]\) \|\| 'bottom'/
          .test(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8')), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sheet-toggle checks passed.');
