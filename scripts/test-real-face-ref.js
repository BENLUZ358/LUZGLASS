#!/usr/bin/env node
/**
 * Cutouts and free holes are measured from the REAL edge of the glass
 * (QA doc 2026-09-25, TEST 07).
 *
 * A cutout placed "1200 from the bottom" next to a sloped bottom edge was
 * measured from the bounding box — an imaginary rectangular line under the
 * real glass. The drafter reading 1200 measures from the edge that exists,
 * and gets a different glass. Declared free holes had the same fault in a
 * milder form: they measured from the corner of the side edge, not from the
 * edge directly below the hole.
 *
 * The rule now: every distance of a cutout or free hole starts on the
 * polygon's real boundary, straight across from the point being measured —
 * the cutout's start or centre (whichever was chosen), or the hole's centre.
 * On a rectangular glass that boundary IS the box, so nothing moves there.
 *
 * Run: node scripts/test-real-face-ref.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.6);

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const layout = (st, cW) => {
  ctx.PN = [{ type: 'shape', label: 'צורה' }]; ctx.PS = { 0: st };
  return vm.runInContext(`lgLayout(lgFromPanels(PN,PS,{}),{canvasW:${cW || 900}})`, ctx);
};
// y of the polygon's boundary directly below/above x (px)
const edgeYAt = (poly, x, below) => {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    if ((A[0] <= x && x < B[0]) || (B[0] <= x && x < A[0]))
      ys.push(A[1] + (B[1] - A[1]) * (x - A[0]) / (B[0] - A[0]));
  }
  return below ? Math.max(...ys) : Math.min(...ys);
};

const CUT = { w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 50 }, y: { from: 'bottom', mm: 1200 } };

/* ── the photograph: 500 wide, 2000 on the left, 1950 on the right, floor cut ── */
{
  const L = layout({ w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1950, slopeSideH: 'bottom',
                     cutouts: [CUT] });
  const s = L.shapes[0], sc = L.scale, k = L.cutouts[0];
  const refX = k.x + k.w;                       // "from the right, to the start" = its right side
  const realBottom = edgeYAt(s.poly, refX, true);
  check('the cutout bottom sits 1200 above the REAL edge under it',
        near((realBottom - (k.y + k.h)) / sc, 1200, 0.6), true);
  check('not 1200 above the bounding box',
        near((s.y + s.h - (k.y + k.h)) / sc, 1200, 0.6), false);

  const cy = L.dims.find(d => d.kind === 'cut-y');
  check('the 1200 dimension starts on the real edge', near(Math.max(cy.y1, cy.y2), realBottom), true);
  check('and ends at the cutout', near(Math.min(cy.y1, cy.y2), k.y + k.h), true);
}

/* ── all four slope sides, and the side the distance is taken from ── */
for (const [side, extra] of [
  ['bottom', { hasSlope: true, slopeH1: 2000, slopeH2: 1900, slopeSideH: 'bottom' }],
  ['top',    { hasSlope: true, slopeH1: 2000, slopeH2: 1900, slopeSideH: 'top' }],
  ['left',   { hasSlopeW: true, slopeW1: 500, slopeW2: 440, slopeSideV: 'left' }],
  ['right',  { hasSlopeW: true, slopeW1: 500, slopeW2: 440, slopeSideV: 'right' }],
]) {
  for (const [xf, yf] of [['left', 'bottom'], ['right', 'top'], ['right', 'bottom'], ['left', 'top']]) {
    for (const ref of ['edge', 'center']) {
      const c = { w: 100, h: 80, ref, x: { from: xf, mm: 120 }, y: { from: yf, mm: 400 } };
      const L = layout(Object.assign({ w: 500, h: 2000, cutouts: [c] }, extra));
      const s = L.shapes[0], sc = L.scale, k = L.cutouts[0];
      const px = ref === 'center' ? k.x + k.w / 2 : (xf === 'left' ? k.x : k.x + k.w);
      const py = ref === 'center' ? k.y + k.h / 2 : (yf === 'top' ? k.y : k.y + k.h);
      // horizontal: the real side edge at the reference height
      const xs = [];
      for (let i = 0; i < s.poly.length; i++) {
        const A = s.poly[i], B = s.poly[(i + 1) % s.poly.length];
        if ((A[1] <= py && py < B[1]) || (B[1] <= py && py < A[1]))
          xs.push(A[0] + (B[0] - A[0]) * (py - A[1]) / (B[1] - A[1]));
      }
      const fx = xf === 'left' ? Math.min(...xs) : Math.max(...xs);
      const fy = edgeYAt(s.poly, px, yf === 'bottom');
      check(`slope ${side}, from ${xf}/${yf}, to the ${ref}: 120 from the real side edge`,
            near(Math.abs(px - fx) / sc, 120), true);
      check(`slope ${side}, from ${xf}/${yf}, to the ${ref}: 400 from the real top/bottom edge`,
            near(Math.abs(py - fy) / sc, 400), true);
    }
  }
}

/* ── a free hole next to a sloped floor ── */
{
  const L = layout({ w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1900, slopeSideH: 'bottom',
                     holes: [{ role: 'hole', dia: 12, x: { from: 'left', mm: 400 }, y: { from: 'bottom', mm: 1000 } }] });
  const s = L.shapes[0], sc = L.scale, h = L.hardware.find(q => q.role === 'hole');
  check('a free hole sits 1000 above the real edge directly below it',
        near((edgeYAt(s.poly, h.x, true) - h.y) / sc, 1000), true);
}

/* ── a rectangle does not move at all ── */
{
  const L = layout({ w: 500, h: 2000, cutouts: [CUT] });
  const s = L.shapes[0], sc = L.scale, k = L.cutouts[0];
  check('on a rectangle the cutout is where it always was (right)', near((s.x + s.w - (k.x + k.w)) / sc, 50), true);
  check('on a rectangle the cutout is where it always was (bottom)', near((s.y + s.h - (k.y + k.h)) / sc, 1200), true);
}

/* ── the containment check uses the same geometry as the drawing ── */
{
  const out = vm.runInContext('lgOutline(SH)', Object.assign(ctx, { SH: vm.runInContext(
    'lgFromPanels(PN,{0:{w:500,h:2000,hasSlope:true,slopeH1:2000,slopeH2:1900,slopeSideH:"bottom",' +
    'cutouts:[{w:100,h:50,ref:"edge",x:{from:"right",mm:10},y:{from:"bottom",mm:5}}]}},{})', ctx) }));
  check('a cutout 5 above the real sloped edge is inside the glass', out[0].cutoutErrors, []);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll real-face reference checks passed.');
