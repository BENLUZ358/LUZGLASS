#!/usr/bin/env node
/**
 * lg-cuts — קבועי חיתוך, קונטור חלון הציר מול 274378.dat, ותבניות מול 136 צורות אמיתיות.
 * Run:  node scripts/test-lg-cuts.js
 */
const fs = require('fs');
const path = require('path');
const { lgOptyShapeParse } = require(path.join(__dirname, '..', 'opty-shape.js'));
const { LG_CUT, LG_HINGE_CONTOUR, lgCutTemplate } = require(path.join(__dirname, '..', 'lg-cuts.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

check('constants', [LG_CUT.hinge.end, LG_CUT.allowance], [161, 2]);

const geo = lgOptyShapeParse(fs.readFileSync(path.join(__dirname, 'fixtures', 'exact-glass', '274378.dat'), 'utf8'));
const c0 = geo.c[0];
const xs = [], ys = [];
for (const s of c0) {
  if (s[0] === 0) { xs.push(s[1], s[3]); ys.push(s[2], s[4]); }
  else for (let i = 0; i <= 400; i++) { const a = s[4] + (s[5] - s[4]) * i / 400; xs.push(s[1] + s[3] * Math.cos(a)); ys.push(s[2] + s[3] * Math.sin(a)); }
}
const x0 = Math.min(...xs), y0 = Math.min(...ys);
const bw = Math.max(...xs) - x0, bh = Math.max(...ys) - y0;
check('bbox 39x80', Math.abs(bw - 39) <= 0.5 && Math.abs(bh - 80) <= 0.5, true);

const shifted = c0.map(s => s[0] === 0 ? [0, s[1] - x0, s[2] - y0, s[3] - x0, s[4] - y0] : [1, s[1] - x0, s[2] - y0, s[3], s[4], s[5]]);
check('same segment count', LG_HINGE_CONTOUR.length, shifted.length);
const same = shifted.every((s, i) => { const e = LG_HINGE_CONTOUR[i]; return e && e.length === s.length && e.every((v, j) => Math.abs(v - s[j]) <= 0.01); });
check('contour matches 274378.dat', same, true);
check('contour deep-frozen', Object.isFrozen(LG_HINGE_CONTOUR) && LG_HINGE_CONTOUR.every(Object.isFrozen), true);

// ── תבניות ─────────────────────────────────────────────────────────
const FIX = path.join(__dirname, 'fixtures', 'exact-glass');
const TAU = 2 * Math.PI;
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
//  אותה צורה בדיוק (גם אם הקובץ עובר עליה בכיוון ההפוך): כל נקודה בכל צד עד 0.05 מ"מ מהצד השני
const densePts = c => c.flatMap(s => Array.from({ length: 41 }, (_, i) => {
  const t = i / 40;
  if (s[0] === 0) return [s[1] + (s[3] - s[1]) * t, s[2] + (s[4] - s[2]) * t];
  const a = s[4] + (s[5] - s[4]) * t; return [s[1] + s[3] * Math.cos(a), s[2] + s[3] * Math.sin(a)];
}));
const segDist = (p, s) => {
  if (s[0] === 0) {
    const dx = s[3] - s[1], dy = s[4] - s[2], L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - s[1]) * dx + (p[1] - s[2]) * dy) / L));
    return Math.hypot(p[0] - s[1] - t * dx, p[1] - s[2] - t * dy);
  }
  const lo = Math.min(s[4], s[5]), sw = Math.abs(s[5] - s[4]);
  const a = Math.atan2(p[1] - s[2], p[0] - s[1]), rel = ((a - lo) % TAU + TAU) % TAU;
  if (sw >= TAU - 1e-3 || rel <= sw) return Math.abs(Math.hypot(p[0] - s[1], p[1] - s[2]) - s[3]);
  return Math.min(...[s[4], s[5]].map(e => Math.hypot(p[0] - s[1] - s[3] * Math.cos(e), p[1] - s[2] - s[3] * Math.sin(e))));
};
const oneWay = (A, b) => A.every(p => Math.min(...b.map(s => segDist(p, s))) <= 0.05);
const sameSegs = (a, b) => oneWay(densePts(a), b) && oneWay(densePts(b), a);
const loadDat = name => lgOptyShapeParse(fs.readFileSync(path.join(FIX, name + '.dat'), 'utf8'));

// דלת 666×1902, צירים בשמאל — הקונטור זהה לקובץ 272156 (חלון תחתון ועליון)
{
  const t = lgCutTemplate('door', { w: 666, h: 1902, side: 'left' });
  const g = loadDat('272156');
  const hinges = t.cuts.filter(c => c.kind === 'hinge').sort((a, b) => a.y - b.y);
  const handle = t.cuts.find(c => c.kind === 'handle');
  check('door: 2 hinges + handle', [t.cuts.length, hinges.length], [3, 2]);
  check('door: hinge centres', hinges.map(c => [c.x, c.y]), [[29.5, 201], [29.5, 1701]]);
  check('door: handle opposite, h/2', [handle.x, handle.y, handle.dia], [605, 951, 12]);
  check('door: bottom hinge contour = 272156', sameSegs(hinges[0].contour, g.c[0]), true);
  check('door: top hinge contour = 272156', sameSegs(hinges[1].contour, g.c[2]), true);
  check('door: handle contour = 272156', sameSegs(handle.contour, g.c[1]), true);
  check('door: outline', t.outline, [[0, 0], [666, 0], [666, 1902], [0, 1902]]);
}
// דלת עם צירים בימין והרמוניקה בשמאל — 272152
{
  const t = lgCutTemplate('door-harm', { w: 392, h: 1972, side: 'right' });
  const g = loadDat('272152');
  const hinges = t.cuts.filter(c => c.kind === 'hinge').sort((a, b) => a.y - b.y);
  check('door-harm: right hinge contours = 272152', [sameSegs(hinges[0].contour, g.c[2]), sameSegs(hinges[1].contour, g.c[3])], [true, true]);
  check('door-harm: harm left, 4 holes', t.cuts.filter(c => c.kind === 'harm').map(c => [c.x, c.y]).sort((a, b) => a[1] - b[1]),
    [[27, 181], [27, 221], [27, 1751], [27, 1791]]);
}
// זווית פתוחה בימין — 272184 (צירים בצד השני, חלון תחתון ב-171)
{
  const t = lgCutTemplate('fixed-open-door', { w: 472, h: 2102, side: 'right', hingeEnd: { bottom: 171, top: 161 } });
  const g = loadDat('272184');
  const open = t.cuts.filter(c => c.kind === 'open').sort((a, b) => a.y - b.y);
  const hinges = t.cuts.filter(c => c.kind === 'hinge').sort((a, b) => a.y - b.y);
  check('fixed-open-door: open centres', open.map(c => [c.x, c.y]), [[446, 201], [446, 1901]]);
  check('fixed-open-door: open contours = 272184', [sameSegs(open[0].contour, g.c[1]), sameSegs(open[1].contour, g.c[2])], [true, true]);
  check('fixed-open-door: hinges opposite + hingeEnd', [sameSegs(hinges[0].contour, g.c[0]), sameSegs(hinges[1].contour, g.c[3])], [true, true]);
}
// שיפוע בימין — המרחק נמדד מהקו הנטוי בגובה החיתוך
{
  const t = lgCutTemplate('fixed-closed', { w: 581, h: 1802, side: 'right', slope: { edge: 'right', top: 20, bottom: 22 } });
  const c = t.cuts.filter(k => k.kind === 'closed').sort((a, b) => a.y - b.y);
  const lineX = y => 559 + 2 * y / 1802;
  check('slope: closed 26 from the slanted line', c.map(k => near(lineX(k.y) - k.x, 26, 0.02)), [true, true]);
  check('slope: outline', t.outline, [[0, 0], [559, 0], [561, 1802], [0, 1802]]);
}
// זווית פתוחה על צלע נטויה — באופטי-ווי השקע עמוק 36 (מרכז הקשת 27 מהקו), 272267
{
  const g = loadDat('272267');
  const t = lgCutTemplate('fixed-open-door', { w: 507, h: 1902, side: 'right', slope: { edge: 'right', top: 25, bottom: 20 }, hingeEnd: { bottom: 176, top: 161 } });
  const open = t.cuts.filter(c => c.kind === 'open').sort((a, b) => a.y - b.y);
  check('slope open: contours = 272267', [sameSegs(open[0].contour, g.c[2]), sameSegs(open[1].contour, g.c[3])], [true, true]);
}

// ── 136 צורות אמיתיות ─────────────────────────────────────────────
//  צורה שמורה לרוחב (w>h) מסובבת 90° נגד השעון: (x,y) → (h−y, x). התבנית תמיד עומדת.
const rotSeg = (s, H) => s[0] === 0 ? [0, H - s[2], s[1], H - s[4], s[3]] : [1, H - s[2], s[1], s[3], s[4] + Math.PI / 2, s[5] + Math.PI / 2];
function readShape(name) {
  const g = loadDat(name);
  return g.w > g.h ? { w: g.h, h: g.w, c: g.c.map(c => c.map(s => rotSeg(s, g.h))), rotated: true } : g;
}
const segPts = c => c.flatMap(s => s[0] === 0 ? [[s[1], s[2]], [s[3], s[4]]]
  : Array.from({ length: 65 }, (_, i) => { const a = s[4] + (s[5] - s[4]) * i / 64; return [s[1] + s[3] * Math.cos(a), s[2] + s[3] * Math.sin(a)]; }));
const r1 = v => Math.round(v * 10) / 10;
//  סיווג קו מתאר בקובץ: עיגול לפי קוטר · חלון ציר 39×80 · שקע זווית פתוחה (~35×20, קשת r10) · קו שיפוע
function classify(shape) {
  const { w, h } = shape, cuts = [], variants = [];
  let slope;
  for (const c of shape.c) {
    if (c.length === 1 && c[0][0] === 1 && near(Math.abs(c[0][5] - c[0][4]), TAU, 0.01)) {
      const d = r1(2 * c[0][3]);
      const kind = near(d, 12, 0.5) ? 'handle' : near(d, 18, 0.5) ? 'harm' : near(d, 20, 0.5) ? 'closed' : '';
      if (kind) cuts.push({ kind, x: c[0][1], y: c[0][2] }); else variants.push(`Ø${d} @${r1(c[0][1])},${r1(c[0][2])}`);
      continue;
    }
    if (c.length === 1 && c[0][0] === 0) {
      const [, x1, y1, x2, y2] = c[0];
      if (Math.abs(y2 - y1) >= 0.95 * h) {            // צלע ארוכה נטויה: מאריכים ל-y=0 ול-y=h
        const xAt = y => x1 + (x2 - x1) * (y - y1) / (y2 - y1);
        const edge = (x1 + x2) / 2 < w / 2 ? 'left' : 'right';
        slope = edge === 'left' ? { edge, bottom: r1(xAt(0)), top: r1(xAt(h)) } : { edge, bottom: r1(w - xAt(0)), top: r1(w - xAt(h)) };
      } else variants.push(Math.abs(x2 - x1) >= 0.95 * w ? 'שיפוע בצלע קצרה' : `קו ${r1(x1)},${r1(y1)}→${r1(x2)},${r1(y2)}`);
      continue;
    }
    //  כיוון הקו הישר הארוך → מסובבים למסגרת מקומית, תיבה, ומרכז
    const lines = c.filter(s => s[0] === 0).map(s => [Math.hypot(s[3] - s[1], s[4] - s[2]), Math.atan2(s[4] - s[2], s[3] - s[1])]).sort((a, b) => b[0] - a[0]);
    let th = lines.length ? lines[0][1] : 0;
    th = ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); if (th > Math.PI / 4) th -= Math.PI / 2;
    const co = Math.cos(th), si = Math.sin(th);
    const pts = segPts(c);
    const loc = pts.map(([x, y]) => [x * co + y * si, -x * si + y * co]);
    const lx = loc.map(p => p[0]), ly = loc.map(p => p[1]);
    const bw = Math.max(...lx) - Math.min(...lx), bh = Math.max(...ly) - Math.min(...ly);
    const arc10 = c.find(s => s[0] === 1 && near(s[3], 10, 0.05));
    if (near(bw, 39, 1) && near(bh, 80, 1)) {
      const mx = (Math.max(...lx) + Math.min(...lx)) / 2, my = (Math.max(...ly) + Math.min(...ly)) / 2;
      cuts.push({ kind: 'hinge', x: mx * co - my * si, y: mx * si + my * co });
    } else if (arc10 && near(bh, 20, 0.5) && bw >= 34 && bw <= 37) cuts.push({ kind: 'open', x: arc10[1], y: arc10[2] });
    else variants.push(`קונטור ${r1(bw)}×${r1(bh)} @${r1(Math.min(...pts.map(p => p[0])))},${r1(Math.min(...pts.map(p => p[1])))}`);
  }
  return { cuts, variants, slope };
}
//  הצד: הצלע של החיתוך המוביל בתבנית (ציר בדלת, זווית בקבוע, חורי הרמוניקה בהרמוניקה)
const PRIMARY = { door: 'hinge', 'door-harm': 'hinge', 'door-harm-handle': 'hinge', 'fixed-open-door': 'open', 'fixed-closed-door': 'closed',
  'fixed-open': 'open', 'fixed-closed': 'closed', harm: 'harm', 'harm-handle': 'harm' };
const index = JSON.parse(fs.readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const perTpl = {}, misses = [], variantLines = [], hingeEnds = {};
for (const e of index) {
  const shape = readShape(e.shape);
  const { cuts, variants, slope } = classify(shape);
  const prim = cuts.filter(c => c.kind === PRIMARY[e.template]);
  const side = prim.length && prim.reduce((s, c) => s + c.x, 0) / prim.length > shape.w / 2 ? 'right' : 'left';
  const spec = { w: shape.w, h: shape.h, side };
  if (slope) spec.slope = slope;
  if (/^fixed-.*-door$/.test(e.template)) {          // קבוע שנושא דלת: גובה חלונות הציר נלקח מהקובץ (משימה 3 תחשב)
    const hs = cuts.filter(c => c.kind === 'hinge');
    const lo = hs.filter(c => c.y < shape.h / 2), hi = hs.filter(c => c.y >= shape.h / 2);
    if (lo.length === 1 && hi.length === 1) {
      spec.hingeEnd = { bottom: Math.round((lo[0].y - 40) * 2) / 2, top: Math.round((shape.h - hi[0].y - 40) * 2) / 2 };
      const k = spec.hingeEnd.bottom + '/' + spec.hingeEnd.top; hingeEnds[k] = (hingeEnds[k] || 0) + 1;
    }
  }
  const t = lgCutTemplate(e.template, spec);
  const kinds = [...new Set(t.cuts.map(c => c.kind))];
  const bad = [];
  for (const k of kinds) {
    const gen = t.cuts.filter(c => c.kind === k), file = cuts.filter(c => c.kind === k);
    if (gen.length !== file.length) bad.push(`${k} → count ${gen.length} vs file ${file.length}`);
    const left = file.slice();
    for (const g of gen) {
      if (!left.length) break;
      let bi = 0, bd = Infinity;
      left.forEach((f, i) => { const d = Math.hypot(f.x - g.x, f.y - g.y); if (d < bd) { bd = d; bi = i; } });
      left.splice(bi, 1);
      if (bd > 1.0) bad.push(`${k} → ${r1(bd)} mm (template ${r1(g.x)},${r1(g.y)})`);
    }
  }
  const extra = cuts.filter(c => !kinds.includes(c.kind)).map(c => `${c.kind} @${r1(c.x)},${r1(c.y)}`).concat(variants);
  if (extra.length) variantLines.push(`${e.shape} ${e.template}: ${extra.join(' · ')}`);
  const p = perTpl[e.template] || (perTpl[e.template] = [0, 0]);
  p[1]++;
  if (bad.length) bad.forEach(b => misses.push(`${e.shape}${shape.rotated ? '(rot)' : ''}${slope ? '(slope)' : ''} ${e.template} → ${b}`)); else p[0]++;
}
console.log('\n── fixtures: per template (pass/total) ──');
Object.keys(perTpl).sort().forEach(k => console.log(`  ${k.padEnd(18)} ${perTpl[k][0]}/${perTpl[k][1]}`));
console.log('  hingeEnd taken from file (fixed-*-door) bottom/top: ' + JSON.stringify(hingeEnds));
if (variantLines.length) { console.log(`\n── variants (${variantLines.length} shapes, not failures) ──`); variantLines.forEach(l => console.log('  ' + l)); }
if (misses.length) { console.log(`\n── misses (${misses.length}) ──`); misses.forEach(l => console.log('  ' + l)); }
check('fixtures: all 136 match within 1.0 mm', [index.length, misses.length], [136, 0]);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
