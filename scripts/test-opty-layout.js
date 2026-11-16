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

module.exports = { check, M290, il, geoOf, L, done: () => failed };
if (require.main === module) {
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
}
