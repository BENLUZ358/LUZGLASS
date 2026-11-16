#!/usr/bin/env node
/** lg-dxf — כתיבת DXF לכל זכוכית + קורא קטן שמפענח בחזרה.  Run: node scripts/test-lg-dxf.js */
const path = require('path');
const { lgCutTemplate } = require(path.join(__dirname, '..', 'lg-cuts.js'));
const { lgDxf, lgDxfName } = require(path.join(__dirname, '..', 'lg-dxf.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const near = (a, b) => Math.abs(a - b) < 0.01;

// קורא DXF מינימלי: זוגות קוד/ערך
function readDxf(s) {
  const L = s.split('\n'); if (L[L.length - 1] === '') L.pop();
  const pairs = []; for (let i = 0; i < L.length; i += 2) pairs.push([+L[i], L[i + 1]]);
  const hdr = {}, layers = [], ents = []; let sec = null, cur = null, lastVar = null;
  for (const [c, v] of pairs) {
    if (c === 0 && v === 'SECTION') continue;
    if (c === 2 && sec === null && ['HEADER', 'TABLES', 'ENTITIES'].includes(v)) { sec = v; continue; }
    if (c === 0 && v === 'ENDSEC') { cur = null; sec = null; continue; }
    if (sec === 'HEADER') { if (c === 9) lastVar = v; else if (lastVar) hdr[lastVar] = v; }
    if (sec === 'TABLES' && c === 0 && v === 'LAYER') { cur = {}; layers.push(cur); }
    else if (sec === 'TABLES' && cur && c === 2) cur.name = v;
    if (sec === 'ENTITIES') {
      if (c === 0) { cur = { type: v }; ents.push(cur); }
      else if (cur) cur[c] = c === 8 ? v : +v;
    }
  }
  return { hdr, layers, ents };
}
const pt = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];

const glass = Object.assign({ idx: 0, key: 'door', issues: [] }, lgCutTemplate('door', { w: 802, h: 2152, side: 'left' }));
const dxf = lgDxf(glass);
check('starts SECTION', dxf.startsWith('0\nSECTION\n'), true);
check('ends EOF', dxf.endsWith('0\nEOF\n') || dxf.endsWith('0\nEOF'), true);
check('no exponent', /\d[eE][+-]?\d/.test(dxf), false);
const d = readDxf(dxf);
check('ACADVER', d.hdr['$ACADVER'], 'AC1009');
check('INSUNITS', d.hdr['$INSUNITS'], '4');
check('layers', d.layers.map(l => l.name).sort(), ['CUTS', 'OUTLINE']);
check('entity types', [...new Set(d.ents.map(e => e.type))].every(t => ['LINE', 'ARC', 'CIRCLE'].includes(t)), true);
const out = d.ents.filter(e => e[8] === 'OUTLINE'), cut = d.ents.filter(e => e[8] === 'CUTS');
check('4 outline LINEs', out.map(e => e.type), ['LINE', 'LINE', 'LINE', 'LINE']);
const xs = [], ys = [];
for (const e of d.ents) {
  if (e.type === 'LINE') { xs.push(e[10], e[11]); ys.push(e[20], e[21]); }
  else if (e.type === 'CIRCLE') { xs.push(e[10] - e[40], e[10] + e[40]); ys.push(e[20] - e[40], e[20] + e[40]); }
}
check('extents', [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 802, 0, 2152]);
const handle = glass.cuts.find(c => c.kind === 'handle');
const circ = cut.filter(e => e.type === 'CIRCLE');
check('one circle', circ.length, 1);
check('circle centre+radius', [circ[0][10], circ[0][20], circ[0][40]], [handle.x, handle.y, 6]);
const hinges = glass.cuts.filter(c => c.kind === 'hinge');
const segCount = hinges.reduce((n, h) => n + h.contour.length, 0);
check('cut entity count', cut.length, segCount + 1);
check('LINE/ARC split', [cut.filter(e => e.type === 'LINE').length, cut.filter(e => e.type === 'ARC').length],
  [hinges.reduce((n, h) => n + h.contour.filter(s => !s[0]).length, 0), hinges.reduce((n, h) => n + h.contour.filter(s => s[0]).length, 0)]);
// קשתות הלוך-חזור: התחלה/סוף של הקשת ב-DXF (נגד השעון) = קצוות הקטע, לפי כיוון הקטע
const arcs = cut.filter(e => e.type === 'ARC');
let arcOk = true;
for (const h of hinges) for (const s of h.contour) if (s[0] === 1) {
  const [, cx, cy, r, a0, a1] = s;
  const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  const [s0, s1] = a1 > a0 ? [p0, p1] : [p1, p0];
  const found = arcs.some(e => near(e[10], cx) && near(e[20], cy) && near(e[40], r) && e[50] >= 0 && e[51] >= 0 && e[50] < 360 && e[51] < 360 &&
    (a => a.every(Boolean))([pt(cx, cy, r, e[50]), pt(cx, cy, r, e[51])].map((q, i) => near(q[0], [s0, s1][i][0]) && near(q[1], [s0, s1][i][1]))));
  if (!found) arcOk = false;
}
check('hinge arcs round-trip', arcOk, true);
check('name', lgDxfName('L1290', 2, { w: 802, h: 2152 }, 1), 'L1290-2_802x2152.dxf');
check('name qty2', lgDxfName('L1290', 2, { w: 802, h: 2152 }, 2), 'L1290-2_802x2152_x2.dxf');
const thr = g => { try { lgDxf(g); return false; } catch (e) { return true; } };
check('throws on issues', thr(Object.assign({}, glass, { issues: ['x'] })), true);
check('throws on NaN', thr(Object.assign({}, glass, { cuts: [{ kind: 'handle', x: NaN, y: 5, dia: 12 }] })), true);
check('throws on Infinity', thr(Object.assign({}, glass, { cuts: [{ kind: 'handle', x: 5, y: 5, dia: Infinity }] })), true);
check('3 decimals max', /\d\.\d{4,}/.test(dxf), false);
if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
