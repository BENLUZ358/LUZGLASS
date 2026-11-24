//  דוחות ותעודות (בן, 24/11): node scripts/test-opty-report.js
const L = require('../opty-layout.js'); Object.assign(global, L);
const R = require('../opty-report.js');
let fail = 0; const check = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + n + (ok ? '' : '\n   got ' + JSON.stringify(a) + '\n   exp ' + JSON.stringify(b))); };
const jobs = {
  M1: { job: 'M1', day: '2026-11-24', mat: '08S', matName: '8 mm clear', pieces: {
    1: { client: 'BathPlace', name: 'דרורית', w: 1885, h: 660, qty: 1, note: 'חיסום/ללא' },
    2: { client: 'BathPlace', name: 'דרורית', w: 1885, h: 375, qty: 1, note: '' },
    3: { client: 'BathPlace', name: 'סון', w: 1885, h: 750, qty: 2, note: 'ללא חיסום/ללא' },
    4: { client: 'H.B.GLASS', name: 'אורלי', w: 660, h: 1885, qty: 1, note: 'חיסום/חור' },
    5: { client: 'T', name: 'ט', w: 1000, h: 500, qty: 1, note: 'טריפלקס' },
    6: { client: 'P', name: 'פ', w: 900, h: 400, qty: 1, note: 'חיסום/חור/צבע 7016' },
    7: { client: 'C', name: 'צ', w: 800, h: 300, qty: 1, note: 'CNC' } } },
  M2: { job: 'M2', day: '2026-11-24', mat: '05MIR', matName: '5 mm mirror', pieces: {
    1: { client: 'X', name: 'a', w: 500, h: 500, qty: 1, note: '' },
    2: { client: 'X', name: 'b', w: 600, h: 600, qty: 1, note: 'חיסום' } } },
  M3: { job: 'M3', day: '2026-11-23', mat: '08S', matName: '8 mm clear', pieces: { 1: { client: 'Y', name: 'z', w: 1, h: 1, qty: 1, note: 'חיסום' } } },
};
const rep = { manual: {
  k1: { client: 'ידני', name: '', glass: '8 mm clear', w: 1885, h: 660, qty: 3, at: 5 },
  k2: { client: 'ידני', name: '', glass: '10 mm', w: 700, h: 700, qty: 1, at: 6, kind: 'triplex' },
  k3: { client: 'ידני', name: '', glass: '8', w: 650, h: 650, qty: 1, at: 7, kind: 'paint', color: '040NWC' } }, hide: { M1_2: true } };
const rows = R.lgOptyReportRows(jobs, '2026-11-24', {}, rep);
const keys = k => R.lgOptyReportFor(rows, k).map(r => r.key);

check('P1 note → process', ['חיסום/חור/צבע 7016', 'טריפלקס מט', 'CNC', 'חיסום/חור'].map(R.lgOptyReportProc),
  [{ triplex: '', paint: '7016', cnc: false }, { triplex: 'טריפלקס מט', paint: '', cnc: false }, { triplex: '', paint: '', cnc: true }, { triplex: '', paint: '', cnc: false }]);
check('A1 chisum: note wins; no-chisum out; mirror only by note; other day out; hidden out; triplex NOT in chisum',
  keys('chisum'), ['M1_1', 'M1_4', 'M1_6', 'M1_7', 'M2_2', 'm_k1', 'm_k3']);
check('A2 paint (also in chisum)', keys('paint'), ['M1_6', 'm_k3']);
check('A3 CNC (also in chisum)', keys('cnc'), ['M1_7']);
check('A4 triplex only', keys('triplex'), ['M1_5', 'm_k2']);
check('A5 hidden row kept in the page list', rows.find(r => r.key === 'M1_2').hidden, true);
check('A6 mat setting off → only note decides', R.lgOptyReportFor(R.lgOptyReportRows(jobs, '2026-11-24', { '08S': { chisum: false } }, {}), 'chisum').map(r => r.key), ['M1_1', 'M1_4', 'M1_6', 'M2_2']);

const byC = R.lgOptyReportByClient(R.lgOptyReportFor(rows, 'report'));
check('B1 report = chisum rows by client, then order name', byC.map(c => [c.client, c.orders.map(o => o.name + ':' + o.rows.length)]),
  [['BathPlace', ['דרורית:1']], ['H.B.GLASS', ['אורלי:1']], ['P', ['פ:1']], ['C', ['צ:1']], ['X', ['b:1']], ['ידני', [':2']]]);

check('C0 thickness', ['08S', '10C', '03+3S', ''].map((m, i) => R.lgOptyReportThick(m, i === 3 ? '6 mm clear' : '')), ['8', '10', '3+3', '6']);
check('C1 chisum note: a row per glass, by thickness then width small→big, area m²', R.lgOptyNoteRows(rows, 'chisum').map(r => [r.item, r.h, r.w, r.qty, r.m2]),
  [['חיסום בלבד 5 מ"מ', 600, 600, 1, 0.36], ['חיסום בלבד 8 מ"מ', 650, 650, 1, 0.42], ['חיסום בלבד 8 מ"מ', 1885, 660, 1, 1.24], ['חיסום בלבד 8 מ"מ', 300, 800, 1, 0.24],
   ['חיסום בלבד 8 מ"מ', 400, 900, 1, 0.36], ['חיסום בלבד 8 מ"מ', 660, 1885, 1, 1.24], ['חיסום בלבד 8 מ"מ', 660, 1885, 3, 3.73]]);
check('C1b area like the old note: 1850×712×2 = 2.63', R.lgOptyNoteRows([{ w: 1850, h: 712, qty: 2, mat: '08S', chisum: true }], 'chisum')[0].m2, 2.63);
check('C1c paint item names carry the colour', R.lgOptyNoteRows(rows, 'paint').map(r => r.item), ['צבע 040NWC 8 מ"מ', 'צבע 7016 8 מ"מ']);
check('C1d triplex item names', R.lgOptyNoteRows(rows, 'triplex').map(r => r.item), ['טריפלקס 8 מ"מ', 'טריפלקס 10 מ"מ']);
const html = R.lgOptyReportHtml('chisum', rows, '2026-11-24', 5901);
check('C2 note has no client names', /BathPlace|דרורית|ידני/.test(html), false);
check('C3 chisum note: number, to Uzi, original, total', /הזמנה מס׳ 5901/.test(html) && /לכבוד: עוזי/.test(html) && /מקור/.test(html) && /סה"כ/.test(html), true);
const ht = R.lgOptyReportHtml('triplex', rows, 'x', 5902);
check('C4 triplex note says טריפלקס and has no chisum rows', /תעודת טריפלקס/.test(ht) && !/חיסום בלבד/.test(ht), true);
const h2 = R.lgOptyReportHtml('report', rows, '2026-11-24', 5901);
check('D1 report shows clients and orders, not triplex', /BathPlace/.test(h2) && /דרורית/.test(h2) && /ידני/.test(h2) && !/>T</.test(h2), true);
check('D2 date line', R.lgOptyReportDate('2026-08-18'), 'יום שלישי 18 אוגוסט 2026');
check('D3 empty day', /אין זכוכית/.test(R.lgOptyReportHtml('report', [], '2026-11-24', 0)), true);
check('D4 escapes', /<b>x/.test(R.lgOptyReportHtml('report', [{ client: '<b>x', name: '', glass: '', w: 1, h: 1, qty: 1, chisum: true }], 'x', 0)), false);
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
