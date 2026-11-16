#!/usr/bin/env node
/**
 * lg-cuts — קבועי חיתוך, קונטור חלון הציר מול 274378.dat, ותבניות מול 136 צורות אמיתיות.
 * Run:  node scripts/test-lg-cuts.js
 */
const fs = require('fs');
const path = require('path');
const { lgOptyShapeParse } = require(path.join(__dirname, '..', 'opty-shape.js'));
const { LG_CUT, LG_HINGE_CONTOUR, LG_CUT_TEMPLATES, lgCutTemplate } = require(path.join(__dirname, '..', 'lg-cuts.js'));
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
  const t = lgCutTemplate('fixed-closed', { w: 581, h: 1802, side: 'right', slope: { edge: 'right', a: 22, b: 20 } });
  const c = t.cuts.filter(k => k.kind === 'closed').sort((a, b) => a.y - b.y);
  const lineX = y => 559 + 2 * y / 1802;
  check('slope: closed 26 from the slanted line', c.map(k => near(lineX(k.y) - k.x, 26, 0.02)), [true, true]);
  check('slope: outline', t.outline, [[0, 0], [559, 0], [561, 1802], [0, 1802]]);
}
// זווית פתוחה על צלע נטויה — באופטי-ווי השקע עמוק 36 (מרכז הקשת 27 מהקו), 272267
{
  const g = loadDat('272267');
  const t = lgCutTemplate('fixed-open-door', { w: 507, h: 1902, side: 'right', slope: { edge: 'right', a: 20, b: 25 }, hingeEnd: { bottom: 176, top: 161 } });
  const open = t.cuts.filter(c => c.kind === 'open').sort((a, b) => a.y - b.y);
  check('slope open: contours = 272267', [sameSegs(open[0].contour, g.c[2]), sameSegs(open[1].contour, g.c[3])], [true, true]);
}
// חריגות לפריט: angleEnd / harmEnd / harmEdge / ידית מגבת / ידית לא באמצע
{
  const ys = (t, k) => t.cuts.filter(c => c.kind === k).map(c => c.y).sort((a, b) => a - b);
  check('angleEnd: closed centre = end + 10', ys(lgCutTemplate('fixed-closed', { w: 600, h: 1500, side: 'left', angleEnd: { bottom: 141, top: 191 } }), 'closed'), [151, 1299]);
  check('angleEnd: open centre = end + 10', ys(lgCutTemplate('fixed-open', { w: 600, h: 1500, side: 'left', angleEnd: { bottom: 171 } }), 'open'), [181, 1299]);
  const hm = lgCutTemplate('harm', { w: 400, h: 1939, side: 'left', harmEnd: { bottom: 131, top: 131 }, harmEdge: 31 });
  check('harmEnd: first hole + 40', ys(hm, 'harm'), [131, 171, 1768, 1808]);
  check('harmEdge', hm.cuts.every(c => c.x === 31), true);
  const tw = lgCutTemplate('harm-handle', { w: 497, h: 2000, side: 'left', handle: { type: 'towel', y: 1000, spacing: 145, edge: 71 } }).cuts.filter(c => c.kind === 'handle');
  check('handle towel: two Ø12, y ± spacing/2, edge override', tw.map(c => [c.x, c.y]), [[426, 927.5], [426, 1072.5]]);
  check('handle knob y', lgCutTemplate('door', { w: 600, h: 1900, side: 'left', handle: { y: 1000 } }).cuts.filter(c => c.kind === 'handle').map(c => [c.x, c.y]), [[539, 1000]]);
}
// קצה תחתון נטוי — מרחקי הקצה נמדדים מהקו הנטוי ב-x של החיתוך; ידית באמצע הזכוכית האמיתית
{
  const t = lgCutTemplate('door', { w: 500, h: 2000, side: 'left', slope: { edge: 'bottom', a: 20, b: 22 } });
  const hb = t.cuts.filter(c => c.kind === 'hinge').sort((a, b) => a.y - b.y)[0];
  const lineY = x => 20 + 2 * x / 500;
  check('end slope: hinge 201 from the slanted bottom', near(hb.y - lineY(hb.x), 201, 0.01), true);
  const hd = t.cuts.find(c => c.kind === 'handle');
  check('end slope: handle mid-glass', near(hd.y, (lineY(hd.x) + 2000) / 2, 0.01), true);
  check('end slope: outline', t.outline, [[0, 20], [500, 22], [500, 2000], [0, 2000]]);
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
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
//  סיווג קו מתאר בקובץ: עיגול לפי קוטר · חלון ציר 39×80 · שקע זווית פתוחה (~35×20, קשת r10) · קו שיפוע
function classify(shape) {
  const { w, h } = shape, cuts = [], variants = [], slopes = [];
  for (const c of shape.c) {
    if (c.length === 1 && c[0][0] === 1 && near(Math.abs(c[0][5] - c[0][4]), TAU, 0.01)) {
      const d = r1(2 * c[0][3]);
      const kind = near(d, 12, 0.5) ? 'handle' : near(d, 18, 0.5) ? 'harm' : near(d, 20, 0.5) ? 'closed' : '';
      if (kind) cuts.push({ kind, x: c[0][1], y: c[0][2] }); else variants.push(`Ø${d} @${r1(c[0][1])},${r1(c[0][2])}`);
      continue;
    }
    if (c.length === 1 && c[0][0] === 0) {
      const [, x1, y1, x2, y2] = c[0];
      if (Math.abs(y2 - y1) >= 0.9 * h) {              // צלע ארוכה נטויה: inset ב-y=0 (a) וב-y=h (b)
        const xAt = y => x1 + (x2 - x1) * (y - y1) / (y2 - y1);
        const edge = (x1 + x2) / 2 < w / 2 ? 'left' : 'right';
        slopes.push(edge === 'left' ? { edge, a: r2(xAt(0)), b: r2(xAt(h)) } : { edge, a: r2(w - xAt(0)), b: r2(w - xAt(h)) });
      } else if (Math.abs(x2 - x1) >= 0.85 * w) {      // קצה קצר נטוי: inset ב-x=0 (a) וב-x=w (b)
        const yAt = x => y1 + (y2 - y1) * (x - x1) / (x2 - x1);
        const edge = (y1 + y2) / 2 < h / 2 ? 'bottom' : 'top';
        slopes.push(edge === 'bottom' ? { edge, a: r2(yAt(0)), b: r2(yAt(w)) } : { edge, a: r2(h - yAt(0)), b: r2(h - yAt(w)) });
      } else variants.push(`קו ${r1(x1)},${r1(y1)}→${r1(x2)},${r1(y2)}`);
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
  return { cuts, variants, slopes };
}
//  הצד: הצלע של החיתוך המוביל בתבנית (ציר בדלת, זווית בקבוע, חורי הרמוניקה בהרמוניקה)
const PRIMARY = { door: 'hinge', 'door-harm': 'hinge', 'door-harm-handle': 'hinge', 'fixed-open-door': 'open', 'fixed-closed-door': 'closed',
  'fixed-open': 'open', 'fixed-closed': 'closed', harm: 'harm', 'harm-handle': 'harm' };
const END_KEY = { hinge: 'hingeEnd', open: 'angleEnd', closed: 'angleEnd', harm: 'harmEnd' };
const END_DEF = { hinge: LG_CUT.hinge.end, open: LG_CUT.open.end, closed: LG_CUT.closed.end, harm: LG_CUT.harm.c1 };
const byEnd = (list, end, h) => list.filter(c => (c.y < h / 2) === (end === 'bottom')).sort((a, b) => end === 'bottom' ? a.y - b.y : b.y - a.y);

//  בנייה: קוראים מהקובץ את החריגות לפריט (מרחק מהקצה לכל קבוצה, ידית, מרחק חורי הרמוניקה מהצלע) ומזינים לתבנית
function fitOverrides(tpl, spec, cuts) {
  const T = LG_CUT_TEMPLATES[tpl], h = spec.h, into = e => e === 'left' ? 1 : -1;
  const edgeOf = k => T[k] === 'side' ? spec.side : (spec.side === 'left' ? 'right' : 'left');
  const fh = cuts.filter(c => c.kind === 'handle');
  if (T.handle && fh.length) {
    spec.handle = { edge: LG_CUT.handle.edge };
    if (fh.length === 2 && Math.abs(fh[0].x - fh[1].x) < 2) Object.assign(spec.handle, { type: 'towel', y: r2((fh[0].y + fh[1].y) / 2), spacing: r2(Math.abs(fh[0].y - fh[1].y)) });
    else spec.handle.y = r2(fh[0].y);
  }
  const gx = (k, list) => { const a = list.filter(c => c.kind === k); return a.reduce((s, c) => s + c.x, 0) / a.length; };
  for (let it = 0; it < 3; it++) {
    const t = lgCutTemplate(tpl, spec);
    for (const k of Object.keys(END_KEY)) {
      if (!T[k]) continue;
      for (const end of ['bottom', 'top']) {
        const g = byEnd(t.cuts.filter(c => c.kind === k), end, h), f = byEnd(cuts.filter(c => c.kind === k), end, h);
        if (!g.length || !f.length) continue;
        const ov = spec[END_KEY[k]] || (spec[END_KEY[k]] = {});
        const cur = ov[end] != null ? ov[end] : END_DEF[k], d = f[0].y - g[0].y;
        ov[end] = r2(cur + (end === 'bottom' ? d : -d));
      }
    }
    if (T.harm && cuts.some(c => c.kind === 'harm'))
      spec.harmEdge = r2((spec.harmEdge != null ? spec.harmEdge : LG_CUT.harm.edge) + into(edgeOf('harm')) * (gx('harm', cuts) - gx('harm', t.cuts)));
    if (spec.handle) spec.handle.edge = r2(spec.handle.edge + into(edgeOf('handle')) * (gx('handle', cuts) - gx('handle', t.cuts)));
  }
  return spec;
}
//  השוואה: כמות + מיקום (עד 1.0 מ"מ) רק לסוגים שבתבנית
function compare(t, cuts) {
  const kinds = [...new Set(t.cuts.map(c => c.kind))], bad = [];
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
  return { kinds, bad };
}
//  החריגות שנקראו (רק מה שזז יותר מ-0.5 מברירת המחדל)
function fmtOv(spec, tpl) {
  const out = [];
  for (const k of ['hinge', 'open', 'closed', 'harm']) {
    const ov = spec[END_KEY[k]];
    if (!LG_CUT_TEMPLATES[tpl][k] || !ov) continue;
    for (const e of ['bottom', 'top']) if (ov[e] != null && Math.abs(ov[e] - END_DEF[k]) > 0.5) out.push(`${END_KEY[k]}.${e}=${r1(ov[e])}`);
  }
  if (spec.harmEdge != null && Math.abs(spec.harmEdge - LG_CUT.harm.edge) > 0.5) out.push('harmEdge=' + r1(spec.harmEdge));
  const H = spec.handle;
  if (H) {
    if (H.type === 'towel') out.push(`towel y=${r1(H.y)} spacing=${r1(H.spacing)}`);
    else if (Math.abs(H.y - spec.h / 2) > 0.5) out.push(`handle.y=${r1(H.y)} (h/2=${r1(spec.h / 2)})`);
    if (Math.abs(H.edge - LG_CUT.handle.edge) > 0.5) out.push('handle.edge=' + r1(H.edge));
  }
  return out;
}

const index = JSON.parse(fs.readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const excluded = index.filter(e => e.exclude), used = index.filter(e => !e.exclude);
const build = {}, dflt = {}, misses = [], variantLines = [], ovLines = [];
for (const e of used) {
  const shape = readShape(e.shape);
  const { cuts, variants, slopes } = classify(shape);
  const prim = cuts.filter(c => c.kind === PRIMARY[e.template]);
  const side = prim.length && prim.reduce((s, c) => s + c.x, 0) / prim.length > shape.w / 2 ? 'right' : 'left';
  const base = () => { const s = { w: shape.w, h: shape.h, side }; if (slopes.length) s.slope = slopes; return s; };
  const tag = e.shape + (shape.rotated ? '(rot)' : '') + (slopes.length ? '(slope:' + slopes.map(s => s.edge).join('+') + ')' : '');
  //  (א) בנייה — עם החריגות מהקובץ
  const spec = fitOverrides(e.template, base(), cuts);
  const res = compare(lgCutTemplate(e.template, spec), cuts);
  const b = build[e.template] || (build[e.template] = [0, 0]); b[1]++;
  if (res.bad.length) res.bad.forEach(x => misses.push(`${tag} ${e.template} → ${x}`)); else b[0]++;
  const ov = fmtOv(spec, e.template);
  if (ov.length) ovLines.push(`${tag} ${e.template}: ${ov.join(' · ')}`);
  //  (ב) ברירת מחדל — בלי חריגות (רק הצורה: צד + שיפוע)
  const d = dflt[e.template] || (dflt[e.template] = [0, 0]); d[1]++;
  if (!compare(lgCutTemplate(e.template, base()), cuts).bad.length) d[0]++;
  const extra = cuts.filter(c => !res.kinds.includes(c.kind)).map(c => `${c.kind} @${r1(c.x)},${r1(c.y)}`).concat(variants);
  if (extra.length) variantLines.push(`${e.shape} ${e.template}: ${extra.join(' · ')}`);
}
const tot = o => Object.values(o).reduce((s, v) => [s[0] + v[0], s[1] + v[1]], [0, 0]);
console.log(`\n── (a) construction with per-item overrides: ${tot(build)[0]}/${tot(build)[1]} ──`);
Object.keys(build).sort().forEach(k => console.log(`  ${k.padEnd(18)} ${build[k][0]}/${build[k][1]}`));
console.log(`\n── (b) matches defaults (no overrides; informational): ${tot(dflt)[0]}/${tot(dflt)[1]} ──`);
Object.keys(dflt).sort().forEach(k => console.log(`  ${k.padEnd(18)} ${dflt[k][0]}/${dflt[k][1]}`));
console.log(`\n── overrides read from the files (${ovLines.length} shapes) ──`); ovLines.forEach(l => console.log('  ' + l));
if (variantLines.length) { console.log(`\n── variants (${variantLines.length} shapes, not failures) ──`); variantLines.forEach(l => console.log('  ' + l)); }
console.log(`\n── excluded (${excluded.length}) ──`); excluded.forEach(e => console.log(`  ${e.shape} ${e.template}: ${e.exclude}`));
if (misses.length) { console.log(`\n── misses (${misses.length}) ──`); misses.forEach(l => console.log('  ' + l)); }
check('fixtures: every non-excluded shape is built within 1.0 mm', [used.length + excluded.length, misses.length], [136, 0]);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
