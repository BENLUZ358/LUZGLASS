#!/usr/bin/env node
/**
 * Tests lg-layout.js — where everything on the sketch goes.
 *
 * Every drawing bug in this project passed every test, because the tests
 * matched source text. `/_dimPlace\('top'/.test(SRC)` proves a string exists
 * in a file. It says nothing about where anything landed, so it was green
 * while dimensions sat on top of the hinges they described, fell off the
 * canvas, and were drawn on an object that had no .map.
 *
 * The layout is a pure function: shower in, coordinates out. That makes the
 * question testable as what it actually is — do these two rectangles
 * intersect, is this point inside the canvas — instead of as a string search.
 *
 * Same move as lg-shapes.js. The rules were trapped in the drawer, so we took
 * them out; the geometry was trapped there too.
 *
 * Run: node scripts/test-layout.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx  = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgLayout } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the geometry helpers the checks are built on ──────────────────────── */
/* the label sits at fraction t along the dimension line — the layout says
   where, and the drawer must use the same number or the two disagree */
/* a label on a vertical line is rotated to read bottom-up, so its footprint
   is the text box turned on its side — 16 wide instead of 38 */
const box = d => {
  const t = d.t == null ? 0.5 : d.t;
  const mx = d.x1 + (d.x2 - d.x1) * t, my = d.y1 + (d.y2 - d.y1) * t;
  const len = Math.max(String(d.text).length * 7 + 10, 26);
  const w = d.rot ? 16 : len, h = d.rot ? len : 16;
  return { lo: mx - w / 2, hi: mx + w / 2, top: my - h / 2, bot: my + h / 2, d };
};
const hits = (a, b) => a.lo < b.hi && a.hi > b.lo && a.top < b.bot && a.bot > b.top;
const overlappingLabels = L => {
  const bs = L.dims.map(box), out = [];
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++)
      if (hits(bs[i], bs[j])) out.push([bs[i].d.text + '/' + bs[i].d.kind,
                                        bs[j].d.text + '/' + bs[j].d.kind]);
  return out;
};
const outsideCanvas = L => L.dims.filter(d =>
  Math.min(d.x1, d.x2) < 0 || Math.max(d.x1, d.x2) > L.canvas.w ||
  Math.min(d.y1, d.y2) < 0 || Math.max(d.y1, d.y2) > L.canvas.h)
  .map(d => d.kind + ':' + d.text);
const onHardware = L => {
  const out = [];
  L.dims.forEach(d => {
    const b = box(d);
    L.hardware.forEach(h => {
      if (b.lo < h.x + 9 && b.hi > h.x - 9 && b.top < h.y + 9 && b.bot > h.y - 9)
        out.push(d.kind + ':' + d.text + ' on ' + h.kind);
    });
  });
  return out;
};

/* A dimension has to sit beside the thing it measures. Pushing hinge heights
   outside the whole assembly kept them off the symbols, but left a hinge on
   the left face measured by a number on the far right, joined by a dashed
   line across the entire drawing. That is not a dimension, it is a puzzle. */
/* A dimension is either tight against its face, or out at the margin with a
   straight extension line reaching back to it. Orphaned in the middle is not
   an option. */
const HW_KINDS = /^(hinge|bracket|handle-dist)/;
const reaches = (d) => (d.ext || []).some(e =>
  Math.abs(e.x1 - d.face) < 2 || Math.abs(e.x2 - d.face) < 2);
const strandedDims = L => L.dims.filter(d => HW_KINDS.test(d.kind))
  .filter(d => d.face == null || (Math.abs(d.x1 - d.face) > 46 && !reaches(d)))
  .map(d => d.kind + ':' + d.text);

/* And every piece of hardware has to be measured. A hinge or a wall bracket
   with no height beside it leaves the fitter guessing where to drill. */
const unmeasuredHardware = L => {
  const dims = L.dims.filter(d => HW_KINDS.test(d.kind));
  return L.hardware.filter(h => h.kind === 'handle' ? false : !dims.some(d =>
      Math.abs((d.face == null ? 1e9 : d.face) - h.x) < 1 &&
      (Math.abs(d.y1 - h.y) < 1 || Math.abs(d.y2 - h.y) < 1)))
    .map(h => h.kind + '@' + Math.round(h.x) + ',' + Math.round(h.y));
};

/* Leaders may only run straight. The diagonal ones crossed the glass corner
   to corner and turned the drawing into a thicket. */
const diagonalLeaders = L => {
  const out = [];
  L.dims.forEach(d => (d.ext || []).forEach(e => {
    if (Math.abs(e.y1 - e.y2) > 0.5 && Math.abs(e.x1 - e.x2) > 0.5)
      out.push(d.kind + ':' + d.text);
  }));
  return out;
};

/* ── the cases ─────────────────────────────────────────────────────────── */
const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'open' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, extra) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, extra || {});
const door  = (id, hingeSide, h) => ({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hingeSide || 'right' });

const CASES = [
  ['a single door',        shower([door('a', 'right')], { right: 'wall', left: 'wall' })],
  ['fixed and door',       shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'wall' })],
  ['fixed door fixed',     shower([fixed('a'), door('b', 'right'), fixed('c')], { right: 'wall', left: 'wall' })],
  ['two doors',            shower([fixed('a'), door('b', 'right'), door('c', 'left'), fixed('d')], { right: 'wall', left: 'wall' })],
  ['three fixed two doors', shower([fixed('a'), door('b', 'right'), fixed('c'), door('d', 'left'), fixed('e')], { right: 'wall', left: 'wall' })],
  ['all the same height',  shower([fixed('a', 2000), fixed('b', 2000), fixed('c', 2000)], { right: 'wall', left: 'wall' })],
  ['a lone fixed',         shower([fixed('a')])],
  /* the ones the drawing really gets handed: sloped tops, hinges moved off
     the 200 default, a handle measured from the top, a five-panel run */
  ['a sloped fixed',       shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1750 }), door('b', 'right')], { right: 'wall', left: 'wall' })],
  ['a sloped door',        shower([fixed('a'), Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1700 })], { right: 'wall', left: 'wall' })],
  ['hinges moved off 200', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150, hingeBot: 340 })], { right: 'wall', left: 'wall' })],
  ['handle from the top',  shower([fixed('a'), Object.assign(door('b', 'right'), { handleRef: 'top', handleDist: 1000 })], { right: 'wall', left: 'wall' })],
  ['two doors, hinges differ', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150 }), Object.assign(door('c', 'left'), { hingeTop: 250 }), fixed('d')], { right: 'wall', left: 'wall' })],
  ['five panels, mixed heights', shower([fixed('a', 2000), door('b', 'right', 1985), fixed('c', 1990), door('d', 'left', 1985), fixed('e', 2000)], { right: 'wall', left: 'wall' })],
];

const WIDTHS = [375, 768, 1440];

console.log('');
for (const [name, s] of CASES) {
  for (const cw of WIDTHS) {
    const L = lgLayout(s, { canvasW: cw });
    const label = `${name} @${cw}`;
    check(`${label}: no two dimension labels overlap`, overlappingLabels(L), []);
    check(`${label}: every dimension is inside the canvas`, outsideCanvas(L), []);
    check(`${label}: no dimension sits on a hardware symbol`, onHardware(L), []);
    check(`${label}: every hardware dimension sits beside its own face`, strandedDims(L), []);
    check(`${label}: every hinge and bracket has its height stated`, unmeasuredHardware(L), []);
    check(`${label}: no leader runs diagonally across the glass`, diagonalLeaders(L), []);
  }
}

/* ── the properties that make it a layout and not a guess ──────────────── */
{
  const L = lgLayout(CASES[2][1], { canvasW: 768 });

  check('every shape is placed', L.shapes.length, 3);
  check('and they sit side by side, left to right',
        L.shapes.every((s, i) => i === 0 || s.x >= L.shapes[i - 1].x + L.shapes[i - 1].w - 0.5), true);
  check('none of them overlaps another',
        L.shapes.filter((s, i) => i > 0 && s.x < L.shapes[i - 1].x + L.shapes[i - 1].w - 0.5).length, 0);

  /* every height that exists is stated, and shapes sharing one share a line */
  const heights = L.dims.filter(d => d.kind === 'height').map(d => Number(d.text)).sort((a, b) => b - a);
  check('both heights are measured, neither is left blank', heights, [2000, 1985]);

  /* widths: one per shape, and the overall */
  check('every shape has its width measured',
        L.dims.filter(d => d.kind === 'width').length, 3);
  check('and the assembly has one too',
        L.dims.filter(d => d.kind === 'total').length, 1);

  /* heights on the left of the assembly, hardware on the right — two sides
     that cannot reach each other */
  const asmL = Math.min(...L.shapes.map(s => s.x));
  const asmR = Math.max(...L.shapes.map(s => s.x + s.w));
  check('heights sit left of the glass',
        L.dims.filter(d => d.kind === 'height').every(d => d.x1 < asmL), true);
  /* hardware is measured beside the face it hangs on, wherever that face is —
     checked for every case at every width by strandedDims above */

  /* a dimension that does not describe every shape says which it describes */
  check('a height shared by fewer than all shapes carries extension lines',
        L.dims.filter(d => d.kind === 'height' && d.ext).length > 0, true);
  check('and one shared by all of them needs none',
        lgLayout(shower([fixed('a', 2000), fixed('b', 2000)], { right: 'wall', left: 'wall' }),
                 { canvasW: 768 }).dims.filter(d => d.kind === 'height' && d.ext).length, 0);
}

/* ── a sloped panel is cut from two heights, so it needs both ──────────── */
{
  const L = lgLayout(shower([{ id: 'a', kind: 'fixed', w: 500, slopeH1: 2000, slopeH2: 1750 },
                             door('b', 'right')], { right: 'wall', left: 'wall' }),
                     { canvasW: 768 });
  const texts = L.dims.filter(d => d.kind === 'height').map(d => Number(d.text));
  check('the tall side of a slope is measured', texts.includes(2000), true);
  check('and so is the short side — the cutter needs both', texts.includes(1750), true);
  check('a sloped shape is drawn as a slope, not a rectangle',
        L.shapes[0].slope, { h1: 2000, h2: 1750 });
}

/* ── it must not throw on the shapes the drawing really hands it ───────── */
check('an empty shower lays out to an empty drawing',
      lgLayout(shower([]), { canvasW: 375 }).shapes.length, 0);
check('and a missing one does not throw',
      typeof lgLayout(null, { canvasW: 375 }).canvas.w, 'number');
check('a shape with no size falls back rather than collapsing',
      lgLayout(shower([{ id: 'a', kind: 'fixed' }]), { canvasW: 375 }).shapes[0].w > 0, true);

/* ── the canvas is big enough for what was placed in it ────────────────── */
for (const [name, s] of CASES) {
  const L = lgLayout(s, { canvasW: 375 });
  const glass = L.shapes.reduce((n, sh) => n + sh.w, 0);
  check(`${name}: the glass keeps most of a phone's width`,
        glass / L.canvas.w > 0.45, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll layout checks passed.');
