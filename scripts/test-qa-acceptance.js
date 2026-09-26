#!/usr/bin/env node
/**
 * The acceptance list of the QA doc (2026-09-25, chapter 6), run as one.
 *
 * Each TEST 01–09 has its own focused test file; this one runs the doc's
 * cross-cutting regression list against the engine, so a fix for one case
 * cannot quietly break another:
 *
 *   ☐ the same sketch before and after Flip keeps every side, number and owner
 *   ☐ a cutout in each of the four corners
 *   ☐ start-of-cutout vs centre-of-cutout moves the reference
 *   ☐ very narrow and very wide glass stay readable
 *   ☐ stress: slope + 3 cutouts + 2 holes + hardware, no confusion
 *   ☐ "blind drafter": the legend + position lines alone rebuild every element
 *
 * The iPhone scroll item is test-viewport-stable.js plus a check on a real
 * phone; the rest are in their own files (see the summary at the end).
 *
 * Run: node scripts/test-qa-acceptance.js
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
const layout = (panels, ps, cW) => {
  ctx.PN = panels; ctx.PS = ps;
  return vm.runInContext(`lgLayout(lgFromPanels(PN,PS,{finish:'shahor',quality:'zamak'}),{canvasW:${cW || 900}})`, ctx);
};
const issuesOf = (panels, ps) => { ctx.PN = panels; ctx.PS = ps;
  return vm.runInContext("lgGeometryIssues(lgFromPanels(PN,PS,{}))", ctx); };
const labelX = d => d.x1 + (d.x2 - d.x1) * (d.t == null ? 0.5 : d.t);
const labelY = d => d.y1 + (d.y2 - d.y1) * (d.t == null ? 0.5 : d.t);
const box = d => { const len = Math.max(String(d.text).length * (d.size || 10) * 0.64 + 8, (d.size || 10) * 2.2);
  const w = d.rot ? (d.size || 10) * 1.5 : len, h = d.rot ? len : (d.size || 10) * 1.5;
  return { l: labelX(d) - w / 2, r: labelX(d) + w / 2, t: labelY(d) - h / 2, b: labelY(d) + h / 2 }; };
const overlaps = ds => { let n = 0;
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const a = box(ds[i]), b = box(ds[j]);
    if (a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1) n++;
  } return n; };
const ownedInside = L => L.dims.filter(d => d.owner).every(d => {
  const s = L.shapes.find(q => q.idx === d.owner.idx);
  return labelX(d) >= s.x - 0.5 && labelX(d) <= s.x + s.w + 0.5; });

// mirror a whole arrangement: order reversed, every side swapped
const other = v => v === 'left' ? 'right' : v === 'right' ? 'left' : v;
const prevNext = v => v === 'prev' ? 'next' : v === 'next' ? 'prev' : v;
function mirror(panels, ps) {
  const n = panels.length;
  const P = panels.slice().reverse().map(p => Object.assign({}, p, {
    wallSide: other(p.wallSide), hingeSide: other(p.hingeSide), hingeOnFixed: prevNext(p.hingeOnFixed) }));
  const S = {};
  for (let i = 0; i < n; i++) {
    const s = JSON.parse(JSON.stringify(ps[n - 1 - i]));
    if (s.notchSide) s.notchSide = other(s.notchSide);
    if (s.slopeSideV) s.slopeSideV = other(s.slopeSideV);
    if (s.hasSlope) { const t = s.slopeH1; s.slopeH1 = s.slopeH2; s.slopeH2 = t; }
    (s.cutouts || []).forEach(c => { c.x.from = other(c.x.from); });
    (s.holes || []).forEach(h => { h.x.from = other(h.x.from); });
    S[i] = s;
  }
  return [P, S];
}

/* ── Flip: same sketch mirrored keeps sides, numbers and owners ── */
{
  const panels = [{ type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
                  { type: 'door', label: 'דלת', hingeSide: 'right', hingeOnFixed: 'prev' }];
  const ps = { 0: { w: 600, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1950,
      cutouts: [{ w: 150, h: 80, ref: 'edge', x: { from: 'left', mm: 100 }, y: { from: 'bottom', mm: 900 } }],
      holes: [{ role: 'hole', dia: 12, x: { from: 'right', mm: 120 }, y: { from: 'top', mm: 400 } }] },
    1: { w: 800, h: 1985, handleType: 'towel', handleEdge: 9 } };
  const A = layout(panels, ps), [MP, MS] = mirror(panels, ps), B = layout(MP, MS);
  const swapWords = t => t.replace(/משמאל|מימין/g, w => w === 'משמאל' ? 'מימין' : 'משמאל')
                          .replace(/^(\S+) \d+: /, '');
  check('flip: the legend says the same thing with left and right swapped',
        A.legend.map(l => swapWords(l.text)), B.legend.map(l => l.text.replace(/^(\S+) \d+: /, '')));
  check('flip: every owned number stays on its own glass, before and after', [ownedInside(A), ownedInside(B)], [true, true]);
  const nums = L => L.dims.map(d => d.kind + ':' + d.text).sort();
  check('flip: the same set of dimensions, number for number', nums(A), nums(B));
  const mirrorX = (L, x) => L.canvas.w - x;   // not used for equality — widths may differ by margins
  const cA = A.cutouts[0], cB = B.cutouts[0], sA = A.shapes[0], sB = B.shapes[B.shapes.length - 1];
  check('flip: the cutout keeps its distance from its (now other) edge',
        Math.abs((cA.x - sA.x) / A.scale - (sB.x + sB.w - (cB.x + cB.w)) / B.scale) < 1, true);
}

/* ── a cutout in each of the four corners ── */
for (const [xf, yf] of [['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']]) {
  const L = layout([{ type: 'shape', label: 'צורה' }], { 0: { w: 700, h: 1800,
    cutouts: [{ w: 120, h: 90, ref: 'edge', x: { from: xf, mm: 60 }, y: { from: yf, mm: 70 } }] } });
  const s = L.shapes[0], k = L.cutouts[0], sc = L.scale;
  const dx = xf === 'left' ? (k.x - s.x) / sc : (s.x + s.w - k.x - k.w) / sc;
  const dy = yf === 'top' ? (k.y - s.y) / sc : (s.y + s.h - k.y - k.h) / sc;
  check(`corner ${yf}-${xf}: sits 60 / 70 from its two edges`, [Math.round(dx), Math.round(dy)], [60, 70]);
  check(`corner ${yf}-${xf}: both positions are drawn and owned`,
        L.dims.filter(d => d.owner && d.owner.feat === 'cut:1').map(d => d.text).sort(), ['60', '70']);
  check(`corner ${yf}-${xf}: numbers on the glass`, ownedInside(L), true);
}

/* ── start vs centre: same numbers, different reference ── */
{
  const mk = ref => layout([{ type: 'shape', label: 'צורה' }], { 0: { w: 700, h: 1800,
    cutouts: [{ w: 200, h: 100, ref, x: { from: 'left', mm: 300 }, y: { from: 'bottom', mm: 500 } }] } });
  const E = mk('edge'), M = mk('center');
  const dxE = (E.cutouts[0].x - E.shapes[0].x) / E.scale, dxM = (M.cutouts[0].x + M.cutouts[0].w / 2 - M.shapes[0].x) / M.scale;
  check('start: 300 reaches the cutout\'s near side', Math.round(dxE), 300);
  check('centre: 300 reaches the cutout\'s middle', Math.round(dxM), 300);
  const cx = L => L.dims.find(d => d.kind === 'cut-x');
  check('and the dimension line ends where the reference is',
        [Math.abs(Math.max(cx(E).x1, cx(E).x2) - E.cutouts[0].x) < 0.6,
         Math.abs(Math.max(cx(M).x1, cx(M).x2) - (M.cutouts[0].x + M.cutouts[0].w / 2)) < 0.6], [true, true]);
  check('the legend names the reference each time',
        [/תחילת הפינוי/.test(E.legend[0].text), /מרכז הפינוי/.test(M.legend[0].text)], [true, true]);
}

/* ── very narrow and very wide glass ── */
for (const [w, cW] of [[180, 375], [180, 900], [3000, 375], [3000, 900]]) {
  const L = layout([{ type: 'shape', label: 'צורה' }], { 0: { w, h: 2000,
    cutouts: [{ w: Math.min(100, w / 3), h: 80, ref: 'edge', x: { from: 'left', mm: Math.round(w / 3) }, y: { from: 'bottom', mm: 900 } }],
    holes: [{ role: 'hole', dia: 12, x: { from: 'right', mm: Math.round(w / 4) }, y: { from: 'top', mm: 300 } }] } }, cW);
  check(`${w} wide @${cW}: no two owned numbers on top of each other`, overlaps(L.dims.filter(d => d.owner)), 0);
  check(`${w} wide @${cW}: owned numbers stay on the glass`, ownedInside(L), true);
  check(`${w} wide @${cW}: nothing flagged`, issuesOf([{ type: 'shape' }], { 0: { w, h: 2000 } }), []);
}

/* ── stress: slope + 3 cutouts + 2 holes + hardware ── */
{
  const panels = [{ type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
                  { type: 'door', label: 'דלת', hingeSide: 'right', hingeOnFixed: 'prev' }];
  const ps = { 0: { w: 900, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1940, floorBracket: true,
      cutouts: [{ w: 150, h: 80, ref: 'edge', x: { from: 'left', mm: 120 }, y: { from: 'bottom', mm: 400 } },
                { w: 150, h: 80, ref: 'center', x: { from: 'right', mm: 300 }, y: { from: 'top', mm: 500 } },
                { w: 100, h: 100, ref: 'edge', x: { from: 'left', mm: 450 }, y: { from: 'bottom', mm: 1300 } }],
      holes: [{ role: 'hole', dia: 16, x: { from: 'left', mm: 200 }, y: { from: 'top', mm: 250 } },
              { role: 'hole', dia: 8, x: { from: 'right', mm: 150 }, y: { from: 'bottom', mm: 900 } }] },
    1: { w: 800, h: 1985, handleType: 'towel', handleEdge: 9 } };
  for (const cW of [375, 900]) {
    const L = layout(panels, ps, cW);
    check(`stress @${cW}: five elements, five tags`, L.tags.map(t => t.text), ['ק1', 'ק2', 'פ1', 'פ2', 'פ3']);
    check(`stress @${cW}: five legend lines, in order`, L.legend.map(l => l.tag), ['פ1', 'פ2', 'פ3', 'ק1', 'ק2']);
    check(`stress @${cW}: every element owns its two position numbers`,
          ['cut:1', 'cut:2', 'cut:3', 'hole:1', 'hole:2'].map(f => L.dims.filter(d => d.owner && d.owner.feat === f).length),
          [2, 2, 2, 2, 2]);
    check(`stress @${cW}: all of them on the glass they describe`, ownedInside(L), true);
    check(`stress @${cW}: no two owned numbers on top of each other`, overlaps(L.dims.filter(d => d.owner)), 0);
  }
  check('stress: and the geometry is legal', issuesOf(panels, ps), []);
}

/* ── blind drafter: legend + position lines alone rebuild every element ── */
{
  const L = layout([{ type: 'shape', label: 'צורה' }], { 0: { w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1950,
    cutouts: [{ w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 50 }, y: { from: 'bottom', mm: 1200 } }],
    holes: [{ role: 'hole', dia: 12, x: { from: 'left', mm: 150 }, y: { from: 'bottom', mm: 1600 } }] } });
  const cut = L.legend.find(l => l.tag === 'פ1').text, hole = L.legend.find(l => l.tag === 'ק1').text;
  const parse = t => ({ w: +(t.match(/רוחב (\d+)/) || [])[1], h: +(t.match(/גובה (\d+)/) || [])[1],
                        x: +(t.match(/(?:משמאל|מימין) (\d+)/) || [])[1], y: +(t.match(/(?:מלמטה|מלמעלה) (\d+)/) || [])[1],
                        d: +(t.match(/Ø(\d+)/) || [])[1] });
  check('blind drafter: the cutout line alone gives size, both positions and reference',
        [parse(cut).w, parse(cut).h, parse(cut).x, parse(cut).y, /ייחוס/.test(cut)], [200, 100, 50, 1200, true]);
  check('blind drafter: the hole line gives diameter and both positions',
        [parse(hole).d, parse(hole).x, parse(hole).y], [12, 150, 1600]);
  check('blind drafter: the drawing shows the same positions on its lines',
        L.dims.filter(d => d.owner).map(d => d.text).sort(), ['1200', '150', '1600', '50']);
  check('blind drafter: both sloped heights are on the drawing',
        ['2000', '1950'].every(t => L.dims.some(d => d.kind === 'height' && d.text === t)), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll QA acceptance checks passed.');
console.log('Also covered: test-real-face-ref (slopes on 4 sides), test-dim-ownership (2 cutouts + hole,');
console.log('two doors + towel), test-hardware-symbol (Ø8–Ø30), test-geometry-validate (step cutouts),');
console.log('test-slope-wall-side (TEST 02), test-sheet-units (TEST 03), test-viewport-stable (TEST 06).');
