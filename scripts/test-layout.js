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

/* THE rule, and it holds for every vertical dimension without exception:
   a number sits beside the thing it measures.

   Two attempts broke it. Hinge heights were pushed outside the whole
   assembly to keep them off the symbols, and a hinge on the left face ended
   up measured by a number on the far right. Then the two cut heights of a
   sloped door were sent out to the margins, where they read as belonging to
   the fixed panels on either side — nothing tied them to the door at all.

   Both times the honest fix was to move the number back, not to draw a
   longer line to it. When space is tight the type gets smaller and the lanes
   narrower. The number does not leave. */
const MAX_AWAY = 56;
const HW_KINDS = /^(hinge|bracket|handle-dist)/;
const strayDims = L => L.dims.filter(d => d.near != null)
  .filter(d => Math.abs(d.x1 - d.near) > MAX_AWAY)
  .map(d => `${d.kind}:${d.text} is ${Math.round(Math.abs(d.x1 - d.near))}px from what it measures`);

/* and no vertical dimension may leave out what it is anchored to */
const unanchored = L => L.dims.filter(d => d.rot && d.near == null)
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

/* A number the dimension line runs straight through is unreadable. When the
   line is shorter than the label, the label has to step off the end of it —
   the handle's 60mm span is four pixels wide and the text is twenty-two. */
const struckThrough = L => L.dims.filter(d => {
  const len = Math.abs(d.x2 - d.x1) + Math.abs(d.y2 - d.y1);
  const need = Math.max(String(d.text).length * 7 + 8, 22);
  const t = d.t == null ? 0.5 : d.t;
  return len < need && t > 0.02 && t < 0.98;
}).map(d => d.kind + ':' + d.text);

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
  ['three fixed two doors', shower([fixed('a'), fixed('b'), door('c', 'right'), door('d', 'left'), fixed('e')], { right: 'wall', left: 'wall' })],
  ['all the same height',  shower([fixed('a', 2000), fixed('b', 2000), fixed('c', 2000)], { right: 'wall', left: 'wall' })],
  ['a lone fixed',         shower([fixed('a')])],
  /* the ones the drawing really gets handed: sloped tops, hinges moved off
     the 200 default, a handle measured from the top, a five-panel run */
  ['a sloped fixed',       shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1750 }), door('b', 'right')], { right: 'wall', left: 'wall' })],
  ['a sloped door',        shower([fixed('a'), Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1700 })], { right: 'wall', left: 'wall' })],
  ['hinges moved off 200', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150, hingeBot: 340 })], { right: 'wall', left: 'wall' })],
  ['handle from the top',  shower([fixed('a'), Object.assign(door('b', 'right'), { handleRef: 'top', handleDist: 1000 })], { right: 'wall', left: 'wall' })],
  ['two doors, hinges differ', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150 }), Object.assign(door('c', 'left'), { hingeTop: 250 }), fixed('d')], { right: 'wall', left: 'wall' })],
  ['five panels, mixed heights', shower([fixed('a', 2000), door('b', 'right', 1985), door('c', 'left', 1985), fixed('d', 1990), fixed('e', 2000)], { right: 'wall', left: 'wall' })],
  /* slopes, on every face */
  ['slope at the floor',   shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1950 }), door('b', 'right')], { right: 'wall', left: 'wall' })],
  ['slope at the top',     shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1750, slopeSide: 'top' }), door('b', 'right')], { right: 'wall', left: 'wall' })],
  ['slope down a wall face', shower([fixed('a', 2000, { slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['a door sloped down its handle side', shower([fixed('a'), Object.assign(door('b', 'right'), { slopeW1: 800, slopeW2: 750 })], { right: 'wall', left: 'wall' })],
  ['a sloped panel in the middle', shower([fixed('a'), Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1800 }), fixed('c')], { right: 'wall', left: 'wall' })],
  ['sloped in both directions', shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1950, slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
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
    check(`${label}: every dimension sits beside what it measures`, strayDims(L), []);
    check(`${label}: and says what that is`, unanchored(L), []);
    check(`${label}: every hinge and bracket has its height stated`, unmeasuredHardware(L), []);
    check(`${label}: no leader runs diagonally across the glass`, diagonalLeaders(L), []);
    check(`${label}: no dimension line runs through its own number`, struckThrough(L), []);
  }
}

/* ── which side a height is written on ─────────────────────────────────── */
/* Both heights ended up stacked on the left while the right margin sat
   empty, so the drawing said 2000 and 1985 in one column and left you to
   work out which panel each belonged to. Each END of the assembly carries
   the height of the panel that sits in it; a panel with no end — a door in
   the middle — carries its height inside its own glass. */
{
  const at = (L, mm) => L.dims.find(d => d.kind === 'height' && Number(d.text) === mm);
  const asmL = L => Math.min(...L.shapes.map(s => s.x));
  const asmR = L => Math.max(...L.shapes.map(s => s.x + s.w));

  /* fixed | door — one panel at each end, so one height at each end */
  const fd = lgLayout(shower([fixed('a', 2000), door('b', 'right', 1985)],
                             { right: 'wall', left: 'wall' }), { canvasW: 768 });
  check('the panel on the left has its height on the left', at(fd, 2000).x1 < asmL(fd), true);
  check('and the panel on the right has its height on the right', at(fd, 1985).x1 > asmR(fd), true);

  /* fixed | door | door | fixed — the doors have no end to sit at */
  const fddf = lgLayout(shower([fixed('a', 2000), door('b', 'right', 1985),
                                door('c', 'left', 1985), fixed('d', 2000)],
                               { right: 'wall', left: 'wall' }), { canvasW: 768 });
  const ends = fddf.dims.filter(d => d.kind === 'height' && Number(d.text) === 2000);
  check('a fixed panel at each end is measured at each end', ends.length, 2);
  check('one on the left and one on the right',
        [ends.some(d => d.x1 < asmL(fddf)), ends.some(d => d.x1 > asmR(fddf))], [true, true]);

  const mid = fddf.dims.filter(d => d.kind === 'height' && Number(d.text) === 1985);
  check('two doors of the same height are measured once, not twice', mid.length, 1);
  check('and that measurement sits inside the door itself',
        mid[0].x1 > asmL(fddf) && mid[0].x1 < asmR(fddf), true);

  /* nothing to distinguish — one number is enough */
  const same = lgLayout(shower([fixed('a', 2000), fixed('b', 2000), fixed('c', 2000)],
                               { right: 'wall', left: 'wall' }), { canvasW: 768 });
  check('when every panel is the same height, one number says so',
        same.dims.filter(d => d.kind === 'height').length, 1);
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
  check('both heights are measured, neither is left blank',
        [...new Set(heights)], [2000, 1985]);

  /* widths: one per shape, and the overall */
  check('every shape has its width measured',
        L.dims.filter(d => d.kind === 'width').length, 3);
  check('and the assembly has one too',
        L.dims.filter(d => d.kind === 'total').length, 1);

  /* heights on the left of the assembly, hardware on the right — two sides
     that cannot reach each other */
  const asmL = Math.min(...L.shapes.map(s => s.x));
  const asmR = Math.max(...L.shapes.map(s => s.x + s.w));
  /* hardware is measured beside the face it hangs on, wherever that face is —
     checked for every case at every width by strandedDims above */

  /* a height now sits beside the panel it belongs to, so it needs no leader
     at all — checked by side above */
  check('heights need no leaders once they sit beside their own panel',
        L.dims.filter(d => d.kind === 'height' && d.ext).length, 0);
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
        [L.shapes[0].slope.h1, L.shapes[0].slope.h2], [2000, 1750]);
}

/* ── slopes ────────────────────────────────────────────────────────────── */
/* A shower cubicle slopes at the FLOOR by default — the tray drains, so the
   glass is cut along the bottom. It can also be cut at the top, or down
   either vertical face where the wall is out of plumb. The customer picks;
   these are only the defaults for when they haven't.
   Sloped glass is cut from BOTH measurements, so both are stated: each face
   carries its own, the same rule as each end carrying its panel's height. */
{
  const sq = (extra, kind) => Object.assign({ id: 'x', kind: kind || 'fixed', w: 500, h: 2000 }, extra);
  const heightsOf = L => L.dims.filter(d => d.kind === 'height').map(d => Number(d.text));
  const widthsOf  = L => L.dims.filter(d => d.kind === 'width').map(d => Number(d.text));

  /* every shape is handed over as a polygon — the drawer never has to know
     what a slope is, it just draws the points it is given */
  const plain = lgLayout(shower([fixed('a')]), { canvasW: 768 }).shapes[0];
  check('a plain panel is handed over as a polygon too', plain.poly.length, 4);
  check('and that polygon is a rectangle',
        Math.abs(plain.poly[0][1] - plain.poly[1][1]) < 0.5 &&
        Math.abs(plain.poly[2][1] - plain.poly[3][1]) < 0.5, true);

  /* default side: the floor */
  const bot = lgLayout(shower([sq({ slopeH1: 2000, slopeH2: 1950 }), door('b', 'right')],
                              { right: 'wall', left: 'wall' }), { canvasW: 768 });
  check('with no side given, the slope is at the floor', bot.shapes[0].slope.hSide, 'bottom');
  check('the head stays straight — the lintel is level',
        Math.abs(bot.shapes[0].poly[0][1] - bot.shapes[0].poly[1][1]) < 0.5, true);
  check('and both cut heights are stated',
        [heightsOf(bot).includes(2000), heightsOf(bot).includes(1950)], [true, true]);

  /* the customer can put it at the top instead */
  const top = lgLayout(shower([sq({ slopeH1: 2000, slopeH2: 1750, slopeSide: 'top' }), door('b', 'right')],
                              { right: 'wall', left: 'wall' }), { canvasW: 768 });
  check('asked for the top, the slope goes to the top', top.shapes[0].slope.hSide, 'top');
  check('and then it is the floor edge that is straight',
        Math.abs(top.shapes[0].poly[2][1] - top.shapes[0].poly[3][1]) < 0.5, true);

  /* a vertical slope is measured in two WIDTHS, not two heights */
  const wall = lgLayout(shower([sq({ slopeW1: 500, slopeW2: 455 }), door('b', 'right')],
                               { right: 'wall', left: 'open' }), { canvasW: 768 });
  check('a fixed panel slopes down the face that meets the wall', wall.shapes[0].slope.vSide, 'left');
  check('and it is measured top and bottom, in widths',
        [widthsOf(wall).includes(500), widthsOf(wall).includes(455)], [true, true]);
  check('the top width sits above the glass and the bottom width below it',
        (() => {
          const ws = wall.dims.filter(d => d.kind === 'width' && [500, 455].includes(Number(d.text)));
          const oy = Math.min(...wall.shapes.map(s => s.y));
          const ab = Math.max(...wall.shapes.map(s => s.y + s.h));
          return [ws.find(d => Number(d.text) === 500).y1 < oy,
                  ws.find(d => Number(d.text) === 455).y1 > ab];
        })(), [true, true]);

  /* a door slopes down its handle side — never the side it hangs from */
  const dL = lgLayout(shower([fixed('a'),
                              Object.assign(door('b', 'right'), { slopeW1: 800, slopeW2: 760 })],
                             { right: 'wall', left: 'wall' }), { canvasW: 768 });
  const dS = dL.shapes[1], hingeX = dL.hardware.filter(h => h.kind === 'hinge')[0].x;
  check('a door slopes down its handle side, not its hinge side',
        Math.abs((dS.slope.vSide === 'left' ? dS.x : dS.x + dS.w) - hingeX) > 1, true);

  /* whatever the default, the customer's choice wins */
  check('an explicit side overrides the default',
        lgLayout(shower([sq({ slopeW1: 500, slopeW2: 455, slopeSide: 'right' }), door('b', 'right')],
                        { right: 'wall', left: 'open' }), { canvasW: 768 }).shapes[0].slope.vSide, 'right');

  /* a sloped panel keeps to its own column */
  const pair = lgLayout(shower([sq({ slopeW1: 500, slopeW2: 455 }), fixed('b')],
                               { right: 'wall', left: 'wall' }), { canvasW: 768 });
  check('a vertically sloped panel stays inside its own column',
        pair.shapes[0].poly.every(p => p[0] >= pair.shapes[0].x - 0.5 &&
                                       p[0] <= pair.shapes[0].x + pair.shapes[0].w + 0.5), true);
  check('and does not overlap the panel beside it',
        Math.max(...pair.shapes[0].poly.map(p => p[0])) <= pair.shapes[1].x + 0.5, true);

  /* Glass is cut against a wall that is out of plumb AND a floor that
     drains, and then all four faces differ. Four measurements, one per
     face — anything less and the cutter is guessing at a corner. */
  {
    const dbl = lgLayout(shower([Object.assign(fixed('a'), {
                                   slopeH1: 2000, slopeH2: 1950,
                                   slopeW1: 500,  slopeW2: 455 }),
                                 door('b', 'right')],
                                { right: 'wall', left: 'open' }), { canvasW: 900 });
    const s0 = dbl.shapes[0];
    check('a doubly sloped panel keeps both slopes',
          [s0.slope.hSide, s0.slope.vSide], ['bottom', 'left']);
    check('its two heights are both measured',
          [2000, 1950].every(mm => dbl.dims.some(d => d.kind === 'height' && Number(d.text) === mm)), true);
    check('and its two widths as well',
          [500, 455].every(mm => dbl.dims.some(d => d.kind === 'width' && Number(d.text) === mm)), true);

    /* the polygon has to agree with all four numbers */
    const P = s0.poly, sc = dbl.scale;
    const near = (a, b) => Math.abs(a - b) < 1;
    check('the top edge is the top width',   near(P[1][0] - P[0][0], 500 * sc), true);
    check('the bottom edge is the bottom width', near(P[2][0] - P[3][0], 455 * sc), true);
    check('the left face is the left height',  near(P[3][1] - P[0][1], 2000 * sc), true);
    check('the right face is the right height', near(P[2][1] - P[1][1], 1950 * sc), true);
    check('so no two corners coincide — it is a proper quadrilateral',
          new Set(P.map(p => Math.round(p[0]) + ',' + Math.round(p[1]))).size, 4);
  }

  /* Both cut heights of a sloped panel stay ON that panel — one at each of
     its own two faces. Sending them out to the margins made them read as if
     they belonged to the neighbours. */
  const mid = lgLayout(shower([fixed('a'),
                               Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1800 }),
                               fixed('c')], { right: 'wall', left: 'wall' }), { canvasW: 768 });
  const dr = mid.shapes[1];
  const h1985 = mid.dims.find(d => d.kind === 'height' && Number(d.text) === 1985);
  const h1800 = mid.dims.find(d => d.kind === 'height' && Number(d.text) === 1800);
  check('the tall face of a middle slope is measured at that face',
        Math.abs(h1985.x1 - dr.x) <= MAX_AWAY, true);
  check('and the short face at its own face',
        Math.abs(h1800.x1 - (dr.x + dr.w)) <= MAX_AWAY, true);
  check('both of them land on the sloped panel, not on its neighbours',
        [h1985, h1800].every(d => d.x1 > dr.x - MAX_AWAY && d.x1 < dr.x + dr.w + MAX_AWAY), true);
  check('and neither needs a leader to explain itself',
        [h1985.ext, h1800.ext].every(e => !e || !e.length), true);
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
