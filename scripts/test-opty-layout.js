#!/usr/bin/env node
/**
 * opty-layout.js — קובצי חיתוך של אופטי-ווי (M00xxx.R01): לוחות, סדר חיתוך, יום עבודה,
 * ציור לוח, רשומת אופטימיזציה, סימון נחתך, מדבקות, הערכת עבודה (בן, 17/11).
 * Run: node scripts/test-opty-layout.js
 */
const fs = require('fs'), path = require('path');
const L = require('../opty-layout.js');
const S = require('../opty-shape.js');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const geoOf = n => S.lgOptyShapeParse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opty-shapes', n + '.dat'), 'utf8'));

// ── Task 1: parse ──
const M290 = '[P1H1R7D64R57E4x190y190X15A4Y4E34ZBCCS<n=274380>N4Z9D8S<n=274381>N1X66F8Y571CZ26A2W4DD0Q15F4S<n=274379>N3Q10AES<n=274378>N2]';
const sh = L.lgOptyLayoutParse(M290 + '\r\nN1 B\r\nN2 B\r\n');
check('M00290: one sheet 3210×2250, trim 20', [sh.length, sh[0].L, sh[0].H, sh[0].trimX], [1, 3210, 2250, 20]);
check('M00290: cut order of pieces (pos)', sh[0].pieces.map(p => p.pos), [4, 1, 3, 2]);
check('M00290: shapes in order', sh[0].pieces.map(p => p.shape), ['274380', '274381', '274379', '274378']);
check('M00290: first piece 302×2002 at 10,10', (({ w, h, x, y, order }) => ({ w, h, x, y, order }))(sh[0].pieces[0]), { w: 302, h: 2002, x: 10, y: 10, order: 1 });
const rng = L.lgOptyLayoutParse('[P1H5-6R80E8R639Cx190y190X8020Y32DCZ2724NE]');
check('H5-6 → two identical sheets, index 5', [rng[0].count, rng[0].index], [2, 5]);
const rep = L.lgOptyLayoutParse('[P1H1R7D64R639Cx12CX6928V3Y1180Z3494S<n=272350>N1]');
check('V3 → three pieces, all pos 1', rep[0].pieces.map(p => p.pos), [1, 1, 1]);
check('bad line → error', (() => { try { L.lgOptyLayoutParse('[P1H1R7D64R639CK12]'); return 'no'; } catch (e) { return 'threw'; } })(), 'threw');

// ── Task 1: sheet sequence ──
const seq = L.lgOptySheetSeq([{ count: 1, index: 1 }, { count: 2, index: 2 }, { count: 1, index: 4 }]);
check('sheet seq: 4 physical sheets', seq.map(s => [s.sheetNo, s.total]), [[1, 4], [2, 4], [3, 4], [4, 4]]);
check('sheet seq: repeats share the layout', seq[1].sheet === seq[2].sheet, true);

// ── Task 1: work day suggestion (Israel time; winter = UTC+2) ──
const il = (d, t) => Date.parse(d + 'T' + t + ':00+02:00');
check('16/11 17:10 → 17/11', L.lgOptyCutDay(il('2026-11-16', '17:10')), '2026-11-17');
check('17/11 07:15 → 17/11', L.lgOptyCutDay(il('2026-11-17', '07:15')), '2026-11-17');
check('17/11 12:00 → 18/11', L.lgOptyCutDay(il('2026-11-17', '12:00')), '2026-11-18');
check('Thu 19/11 13:00 → Sun 22/11', L.lgOptyCutDay(il('2026-11-19', '13:00')), '2026-11-22');
check('Fri 20/11 08:00 → Sun 22/11', L.lgOptyCutDay(il('2026-11-20', '08:00')), '2026-11-22');

// ── Task 1: sheet SVG ──
const plain = L.lgOptyLayoutSvg(sh[0], {}, {});
check('svg without shapes: labels, no cut path', [plain.includes('שייפ 274380'), plain.includes('<path')], [true, false]);
const withGeo = L.lgOptyLayoutSvg(sh[0], { 4: { client: 'אומנות הזכוכ', name: '510', w: 302, h: 2002 } }, { 274378: geoOf('274378') });
check('svg with a shape: cut path, thin stroke, client shown', [withGeo.includes('<path'), withGeo.includes('vector-effect'), withGeo.includes('אומנות הזכוכ')], [true, false, true]);

// ── Task 3: job record, cut stamps, cut state ──
const ROWS = [
  { CODCOM: 'M00290', POSPZ: 4, QTAPZ: 1, SAGOMA: '274380', DIMXPZ: 302, DIMYPZ: 2002, MOLATURA: 0, CLIENTE: 'אומנות הזכוכ', ORDINE: '510', COD_MAT_COMP: '08S', DESCR_MAT_COMP: '8 mm clear' },
  { CODCOM: 'M00290', POSPZ: 1, QTAPZ: 1, SAGOMA: '274381', DIMXPZ: 252, DIMYPZ: 2002, CLIENTE: 'אומנות הזכוכ', ORDINE: '510', COD_MAT_COMP: '08S', DESCR_MAT_COMP: '8 mm clear' },
  { CODCOM: 'M00291', POSPZ: 1, QTAPZ: 1, SAGOMA: '274328', DIMXPZ: 502, DIMYPZ: 1902, CLIENTE: 'BathPlace', ORDINE: 'איציק', COD_MAT_COMP: '08S' },
];
const rec = L.lgOptyJobRecord('M00290', M290, '2026-11-17', ROWS, 123);
check('record: day, mat, 1 sheet with 4 pieces', [rec.job, rec.day, rec.mat, rec.matName, rec.sheets.length, rec.sheets[0].pieces.length, rec.importedAt], ['M00290', '2026-11-17', '08S', '8 mm clear', 1, 4, 123]);
check('record: piece info from Pezzi (only this job)', rec.pieces[4], { client: 'אומנות הזכוכ', name: '510', w: 302, h: 2002, qty: 1, shape: '274380', grind: 0 });
check('record: other job rows ignored', Object.keys(rec.pieces).sort(), ['1', '4']);
const bare = L.lgOptyJobRecord('M00290', M290, '2026-11-17', [], 1);
check('record without Pezzi rows: still the sheet', [bare.sheets.length, bare.pieces, bare.mat], [1, {}, '']);
const ORD = [
  { id: 'o1', items: { 0: { optyJob: 'M00290', optyShape: '274380' }, 1: { optyJob: 'M00290', optyShape: '274380', optyCut: { undone: true, at: '2026-11-17', job: 'M00290' } }, 2: { optyJob: 'M00999', optyShape: '1' }, 3: { w: 1 } } },
  { id: 'o2', items: [{ optyJob: 'M00290', optyShape: '999999' }] },
];
check('stamps: linked item only; undone, unknown job, shape not in job → none', L.lgOptyCutStamps(ORD, { M00290: rec }), [{ orderId: 'o1', key: '0', value: { at: '2026-11-17', job: 'M00290' } }]);
check('cut state: future → לחיתוך', L.lgOptyCutState({ at: '2026-11-19', job: 'M1' }, '2026-11-18'), { label: 'לחיתוך 19/11', cut: false });
check('cut state: today → לחיתוך היום', L.lgOptyCutState({ at: '2026-11-18', job: 'M1' }, '2026-11-18'), { label: 'לחיתוך היום', cut: false });
check('cut state: past → נחתך', L.lgOptyCutState({ at: '2026-11-17', job: 'M1' }, '2026-11-18'), { label: '✂ נחתך 17/11', cut: true });
check('cut state: sheet marked today → נחתך', L.lgOptyCutState({ at: '2026-11-18', job: 'M1', marked: true }, '2026-11-18'), { label: '✂ נחתך 18/11', cut: true });
check('cut state: undone / none → null', [L.lgOptyCutState({ at: '2026-11-17', undone: true }, '2026-11-18'), L.lgOptyCutState(null, '2026-11-18')], [null, null]);

// ── Task 5: labels in cut order, chunks, shape search ──
{
  const two = { job: 'M00337', day: '2026-11-17', mat: '10S', matName: '10 mm clear',
    sheets: [L.lgOptyLayoutParse('[P1H1R7D64R639CX1F54Y5410S<n=500>N1X1F54Y5410N2]')[0], L.lgOptyLayoutParse('[P1H2-3R7D64R639CX1F54Y5410S<n=501>N3]')[0]],
    pieces: { 1: { client: 'נאור', name: 'דני', w: 800, h: 2150, shape: '500' }, 2: { client: 'אגן ברזל', name: 'PHR#1', w: 800, h: 2150, shape: '' }, 3: { client: 'נאור', name: 'רון', w: 800, h: 2150, shape: '501' } } };
  const ours = { '500': { title: 'נאור חזקיה', dims: '800 × 2150', sketchName: 'דני כהן', glass: 'שקוף 10', orderNum: 'L1300', shape: '500', job: 'M00337', orderId: 'o9', idx: 0 } };
  const all = L.lgOptyJobLabels(two, ours, {}, 'M 10S · 10 שקוף');
  check('job labels: marker before every physical sheet, then its pieces in cut order', all.map(l => l.marker || l.sketchName), ['לוח 1/3', 'דני כהן', 'PHR#1', 'לוח 2/3', 'רון', 'לוח 3/3', 'רון']);
  check('marker carries job, glass, piece count', (({ marker, job, mat, pieces }) => ({ marker, job, mat, pieces }))(all[0]), { marker: 'לוח 1/3', job: 'M00337', mat: 'M 10S · 10 שקוף', pieces: 2 });
  check('linked piece: our order label + shape drawing', [all[1].title, all[1].orderNum, all[1].withShape, all[1].job], ['נאור חזקיה', 'L1300', true, 'M00337']);
  check('unlinked piece: OptyWay data, no drawing without a shape', [all[2].title, all[2].dims, all[2].withShape, all[2].glass], ['אגן ברזל', '800 × 2150', false, 'M 10S · 10 שקוף']);
  check('one sheet only', L.lgOptyJobLabels(two, ours, { sheet: 2 }, '').map(l => l.marker || l.sketchName), ['לוח 2/3', 'רון']);
  check('one piece: no marker', L.lgOptyJobLabels(two, ours, { sheet: 1, order: 2 }, '').map(l => l.marker || l.sketchName), ['PHR#1']);
  const big = Array.from({ length: 75 }, (_, i) => (i === 69 ? { marker: 'לוח 2/2' } : { title: 'x' + i }));
  check('chunks of 70 never end on a marker', L.lgOptyChunks(big, 70).map(c => c.length), [69, 6]);
  check('chunk: marker as the last of 70 moves to the next', L.lgOptyChunks(Array.from({ length: 71 }, (_, i) => (i === 69 ? { marker: 'm' } : {})), 70).map(c => c.length), [69, 2]);
  const jobs = { M00337: two, M00290: Object.assign({}, rec, { mat: '08S' }) };
  const hit = q => L.lgOptyPieceSearch(jobs, q, {}).map(h => h.job + ':' + h.pos);
  check('shape search by client (also unlinked)', hit('אגן'), ['M00337:2']);
  check('shape search by sketch name', hit('רון'), ['M00337:3']);
  check('shape search by shape number', hit('274380'), ['M00290:4']);
  check('shape search: glass filter', L.lgOptyPieceSearch(jobs, '', { mat: '08S' }).length, 4);
  check('shape search: result has sheet + day', (({ sheetNo, day, client, w, h }) => ({ sheetNo, day, client, w, h }))(L.lgOptyPieceSearch(jobs, 'דני', {})[0]), { sheetNo: 1, day: '2026-11-17', client: 'נאור', w: 800, h: 2150 });
  check('shape search: repeated sheet listed once', hit('נאור'), ['M00337:1', 'M00337:3']);
}

module.exports = { check, M290, il, geoOf, L, done: () => failed };
if (require.main === module) {
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
}
