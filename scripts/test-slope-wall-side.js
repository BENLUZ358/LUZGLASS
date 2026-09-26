#!/usr/bin/env node
/**
 * A width slope is cut on the WALL side (QA doc 2026-09-25, TEST 02).
 *
 * "שיפוע ברוחב — קיר לא ישר": the edge that is not straight is the wall,
 * so that is the edge that gets cut. Two things were wrong:
 *
 *   1. THE SHEET SHOWED A SIDE NOBODY CHOSE. The toggle rendered
 *      `ps.slopeSideV || 'left'`, so "שמאל" looked selected on every panel
 *      while nothing was stored — and the engine, receiving nothing, used
 *      its own default. The screen said left, the drawing cut right.
 *
 *   2. A DOOR HUNG ON THE WALL WAS CUT ON ITS HANDLE SIDE. The engine's
 *      default for doors was "the side opposite the hinge". For a door that
 *      hangs from the wall the hinge side IS the wall side — and Ben decided
 *      (2026-09-26, option א) that the wall side wins, always.
 *
 * Where no edge of the panel touches a wall (a door hung on a fixed) there
 * is no wall to follow, and the old defaults stay exactly as they were.
 *
 * Run: node scripts/test-slope-wall-side.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const run = (expr, vars) => { Object.assign(ctx, vars || {}); return vm.runInContext(expr, ctx); };
const outline = sh => run('lgOutline(SH)', { SH: sh });

const shower = (shapes, boundary) => ({ boundary, finish: 'shahor', quality: 'zamak', shapes });
const slopeW = { slopeW1: 800, slopeW2: 750 };

/* ── the photograph: door | door | door, the left door hung on the wall ── */
{
  // engine convention: hingeSide 'right' faces the previous shape — canvas LEFT
  const sh = shower([
    Object.assign({ id: 'd1', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }, slopeW),
    { id: 'd2', kind: 'door', w: 800, h: 1985, hingeSide: 'left' },
    { id: 'd3', kind: 'door', w: 1000, h: 1985, hingeSide: 'left' },
  ], { right: 'wall', left: 'wall' });
  const js = run('lgJunctions(SH)', { SH: sh });
  check('the left door hangs from the wall on its left', js[0].type, 'hinge-wall');
  check('a door hung on the wall slopes down the WALL side', outline(sh)[0].slope.vSide, 'left');

  // and the cut is really on that edge: the left edge leans, the right is plumb
  const P = outline(sh)[0].poly;
  check('its left edge leans', Math.abs(P[0][0] - P[3][0]) > 1, true);
  check('its right edge stays straight — it meets the next door', Math.abs(P[1][0] - P[2][0]) < 0.5, true);
}

/* ── mirrored: the same door hung on the wall at the right end ── */
{
  const sh = shower([
    { id: 'f', kind: 'fixed', w: 500, h: 2000 },
    Object.assign({ id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'left' }, slopeW),
  ], { right: 'wall', left: 'wall' });
  const js = run('lgJunctions(SH)', { SH: sh });
  check('mirrored: the door hangs from the wall on its right', js[2].type, 'hinge-wall');
  check('mirrored: it slopes down the right side', outline(sh)[1].slope.vSide, 'right');
}

/* ── no wall on either edge: nothing to follow, the old rule stays ── */
{
  const sh = shower([
    { id: 'f', kind: 'fixed', w: 500, h: 2000 },
    Object.assign({ id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }, slopeW),
  ], { right: 'wall', left: 'open' });
  const js = run('lgJunctions(SH)', { SH: sh });
  check('a door hung on a fixed touches no wall', [js[1].type, js[2].type].some(t => /-wall$/.test(t || '')), false);
  check('so it still slopes down its handle side, as before', outline(sh)[1].slope.vSide, 'right');
}

/* ── a fixed against the wall: unchanged ── */
{
  const L = shower([Object.assign({ id: 'f', kind: 'fixed', w: 500, h: 2000 }, { slopeW1: 500, slopeW2: 455 }),
                    { id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }],
                   { right: 'wall', left: 'open' });
  check('a fixed still slopes down the face that meets the wall', outline(L)[0].slope.vSide, 'left');
}

/* ── the customer's explicit choice still wins over any default ── */
{
  const sh = shower([
    Object.assign({ id: 'd1', kind: 'door', w: 800, h: 1985, hingeSide: 'right', slopeSideV: 'right' }, slopeW),
    { id: 'f', kind: 'fixed', w: 500, h: 2000 },
  ], { right: 'wall', left: 'wall' });
  check('an explicit side overrides the wall default', outline(sh)[0].slope.vSide, 'right');
}

/* ── the sheet shows what the engine will cut, not a hard-coded 'left' ── */
{
  const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
  check("the width-slope toggle no longer falls back to a hard-coded 'left'",
        /_shSeg\('slopeSideV'[^\n]*\|\|'left'/.test(DEMO), false);
  check("nor does the step-cutout side",
        /_shSeg\('notchSide'[^\n]*\|\|'left'/.test(DEMO), false);
  check('both read the side the engine resolved',
        /_sheetResolved\(/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll wall-side slope checks passed.');
