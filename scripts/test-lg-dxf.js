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
// M2 — גם אמצע הקשת: נקודת האמצע של הקשת ב-DXF (נגד השעון מ-50 ל-51) = נקודת האמצע של הקטע במקור
//  (קצוות נכונים עם כיוון סריקה הפוך היו עוברים את הבדיקה הקודמת)
let midOk = true, arcN = 0;
for (const h of hinges) for (const s of h.contour) if (s[0] === 1) {
  const [, cx, cy, r, a0, a1] = s, am = (a0 + a1) / 2, want = [cx + r * Math.cos(am), cy + r * Math.sin(am)];
  const hit = arcs.some(e => {
    if (!(near(e[10], cx) && near(e[20], cy) && near(e[40], r))) return false;
    const sweep = ((e[51] - e[50]) % 360 + 360) % 360, q = pt(cx, cy, r, e[50] + sweep / 2);
    return Math.abs(q[0] - want[0]) < 0.02 && Math.abs(q[1] - want[1]) < 0.02;
  });
  arcN++; if (!hit) midOk = false;
}
check('hinge arcs: each ARC midpoint = the source contour mid-angle (' + arcN + ' arcs)', midOk && arcN > 0, true);
check('name', lgDxfName('L1290', 2, { w: 802, h: 2152 }, 1), 'L1290-2_802x2152.dxf');
check('name qty2', lgDxfName('L1290', 2, { w: 802, h: 2152 }, 2), 'L1290-2_802x2152_x2.dxf');
const thr = g => { try { lgDxf(g); return false; } catch (e) { return true; } };
check('throws on issues', thr(Object.assign({}, glass, { issues: ['x'] })), true);
check('throws on NaN', thr(Object.assign({}, glass, { cuts: [{ kind: 'handle', x: NaN, y: 5, dia: 12 }] })), true);
check('throws on Infinity', thr(Object.assign({}, glass, { cuts: [{ kind: 'handle', x: 5, y: 5, dia: Infinity }] })), true);
check('3 decimals max', /\d\.\d{4,}/.test(dxf), false);
// M3 — זכוכית בלי תבנית (key null) לא נכתבת לעולם; וכל ערך לא סופי זורק
check('throws on key null', thr(Object.assign({}, glass, { key: null })), true);
check('throws on key undefined', thr(Object.assign({}, glass, { key: undefined })), true);
check('throws on NaN in an outline point', thr(Object.assign({}, glass, { outline: [[0, 0], [NaN, 0], [802, 2152], [0, 2152]] })), true);
check('throws on -Infinity in a contour', thr(Object.assign({}, glass, { cuts: [{ kind: 'hinge', contour: [[0, 0, 0, -Infinity, 5]] }] })), true);
check('throws on a string number', thr(Object.assign({}, glass, { cuts: [{ kind: 'handle', x: '5', y: 5, dia: 12 }] })), true);
// I6 — "כל ה-DXF" = קובץ zip אחד (Chrome חוסם הורדה שנייה). store בלבד, בלי תלות, שמות UTF-8 (ביט 11)
{
  const { lgZip } = require(path.join(__dirname, '..', 'lg-dxf.js'));
  const zlib = require('zlib');
  //  קורא zip קטן: EOCD → central directory → local header → בתים
  function readZip(buf) {
    const B = Buffer.from(buf), u16 = o => B.readUInt16LE(o), u32 = o => B.readUInt32LE(o);
    const e = B.length - 22;
    if (u32(e) !== 0x06054b50) throw new Error('no EOCD');
    const n = u16(e + 10), cdSize = u32(e + 12), cdOff = u32(e + 16), out = [];
    if (cdOff + cdSize !== e) throw new Error('central directory not where EOCD says');
    let o = cdOff;
    for (let k = 0; k < n; k++) {
      if (u32(o) !== 0x02014b50) throw new Error('bad central header');
      const flags = u16(o + 8), method = u16(o + 10), crc = u32(o + 16), cs = u32(o + 20), us = u32(o + 24);
      const nl = u16(o + 28), xl = u16(o + 30), cl = u16(o + 32), lo = u32(o + 42), name = B.slice(o + 46, o + 46 + nl).toString('utf8');
      if (u32(lo) !== 0x04034b50) throw new Error('bad local header');
      const lnl = u16(lo + 26), lxl = u16(lo + 28), lname = B.slice(lo + 30, lo + 30 + lnl).toString('utf8');
      const data = B.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + cs);
      out.push({ name, lname, flags, lflags: u16(lo + 6), method, crc, lcrc: u32(lo + 14), cs, us, data });
      o += 46 + nl + xl + cl;
    }
    return out;
  }
  const g2 = Object.assign({ idx: 1, key: 'fixed-closed', issues: [] }, lgCutTemplate('fixed-closed', { w: 502, h: 2002, side: 'left' }));
  const files = [{ name: 'L1290א-1_802x2152.dxf', text: lgDxf(glass) }, { name: 'L1290א-2_502x2002.dxf', text: lgDxf(g2) }];
  const z = readZip(lgZip(files.map(f => ({ name: f.name, data: f.text }))));
  check('zip: entry count', z.length, 2);
  check('zip: Hebrew names round-trip (central + local)', z.map(e => [e.name, e.lname]), files.map(f => [f.name, f.name]));
  check('zip: UTF-8 flag (bit 11) set, stored (method 0)', z.map(e => [e.flags & 0x800, e.lflags & 0x800, e.method]), [[0x800, 0x800, 0], [0x800, 0x800, 0]]);
  check('zip: each entry bytes = lgDxf output', z.map(e => e.data.equals(Buffer.from(files[z.indexOf(e)].text, 'utf8'))), [true, true]);
  check('zip: sizes', z.map(e => [e.cs, e.us]), files.map(f => [Buffer.byteLength(f.text), Buffer.byteLength(f.text)]));
  check('zip: CRC32 matches (central + local)', z.map(e => [e.crc, e.lcrc]), files.map(f => { const c = zlib.crc32(Buffer.from(f.text, 'utf8')); return [c, c]; }));
  check('zip: empty list is a valid empty zip', readZip(lgZip([])).length, 0);
  //  lgDxfSaveZip: בודק את כל הקבצים לפני שמוריד, ומוריד zip אחד
  const vm = require('vm'), fs = require('fs'), saved = [];
  const ctx = vm.createContext({ setTimeout: f => f(), URL: { createObjectURL: b => { saved.push({ blob: b }); return 'x'; }, revokeObjectURL() {} },
    Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; }, Uint8Array, document: { createElement: () => ({ click() { saved.push(this); } }), body: {} },
    Math, String, Number, Array, Error });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lg-dxf.js'), 'utf8'), ctx);
  vm.runInContext('lgDxfSaveZip', ctx)('L1290א_DXF.zip', [{ name: files[0].name, cut: glass }, { name: files[1].name, cut: g2 }]);
  check('lgDxfSaveZip: one download, a .zip', saved.filter(x => x.download).map(x => x.download), ['L1290א_DXF.zip']);
  const blob = saved.find(x => x.blob).blob;
  check('lgDxfSaveZip: blob type application/zip', blob.type, 'application/zip');
  check('lgDxfSaveZip: the zip holds both DXF files', readZip(blob.parts[0]).map(e => e.name), files.map(f => f.name));
  const thrZ = () => { try { vm.runInContext('lgDxfSaveZip', ctx)('a.zip', [{ name: 'a.dxf', cut: glass }, { name: 'b.dxf', cut: Object.assign({}, glass, { issues: ['x'] }) }]); return false; } catch (e) { return true; } };
  const before = saved.length;
  check('lgDxfSaveZip: one bad glass → throws, nothing downloaded', [thrZ(), saved.length - before], [true, 0]);
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
