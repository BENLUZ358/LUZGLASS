//  דוחות ותעודות (בן, 24/11): node scripts/test-opty-report.js
const L = require('../opty-layout.js'); Object.assign(global, L);
const R = require('../opty-report.js');
let fail = 0; const check = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + n + (ok ? '' : '\n   got ' + JSON.stringify(a) + '\n   exp ' + JSON.stringify(b))); };
const jobs = {
  M1: { job: 'M1', day: '2026-11-24', mat: '08S', matName: '8 mm clear', pieces: {
    1: { client: 'BathPlace', name: 'דרורית', w: 1885, h: 660, qty: 1, note: 'חיסום/ללא' },
    2: { client: 'BathPlace', name: 'דרורית', w: 1885, h: 375, qty: 1, note: 'חיסום/ללא' },   // הורד ביד
    3: { client: 'BathPlace', name: 'סון', w: 1885, h: 750, qty: 2, note: 'ללא חיסום/ללא' },
    4: { client: 'H.B.GLASS', name: 'אורלי', w: 660, h: 1885, qty: 1, note: 'חיסום/חור' },
    5: { client: 'T', name: 'ט', w: 1000, h: 500, qty: 1, note: 'טריפלקס' },
    6: { client: 'P', name: 'פ', w: 900, h: 400, qty: 1, note: 'חיסום/חור/צבע 7016' },
    7: { client: 'C', name: 'צ', w: 800, h: 300, qty: 1, note: 'CNC' } } },
  M2: { job: 'M2', day: '2026-11-24', mat: '05MIR', matName: '5 mm mirror', pieces: {
    1: { client: 'X', name: 'a', w: 500, h: 500, qty: 1, note: '' },   // בלי הערה — לא בחיסום
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
check('A1 chisum = only what says "חיסום" (no note / CNC / triplex / "ללא חיסום" out); other day out',
  keys('chisum'), ['M1_1', 'M1_4', 'M1_6', 'M2_2', 'm_k1', 'm_k3']);
check('A2 paint (also in chisum)', keys('paint'), ['M1_6', 'm_k3']);
check('A3 CNC (in chisum only if it also says חיסום)', keys('cnc'), ['M1_7']);
check('A4 triplex only', keys('triplex'), ['M1_5', 'm_k2']);
check('A5 hidden row kept in the page list', rows.find(r => r.key === 'M1_2').hidden, true);
check('A6 glass-type setting does not matter — only the note', R.lgOptyReportFor(R.lgOptyReportRows(jobs, '2026-11-24', { '08S': { chisum: true }, '05MIR': { chisum: true } }, {}), 'chisum').map(r => r.key), ['M1_1', 'M1_2', 'M1_4', 'M1_6', 'M2_2']);
check('A7 manual CNC is not in chisum, manual paint is', R.lgOptyReportFor(R.lgOptyReportRows({}, 'd', {}, { manual: { a: { kind: 'cnc', w: 1, h: 1, at: 1 }, b: { kind: 'paint', w: 1, h: 1, at: 2 } } }), 'chisum').map(r => r.key), ['m_b']);

const byC = R.lgOptyReportByClient(R.lgOptyReportFor(rows, 'report'));
check('B1 report = chisum rows by client, then order name', byC.map(c => [c.client, c.orders.map(o => o.name + ':' + o.rows.length)]),
  [['BathPlace', ['דרורית:1']], ['H.B.GLASS', ['אורלי:1']], ['P', ['פ:1']], ['X', ['b:1']], ['ידני', [':2']]]);

check('C0 thickness', ['08S', '10C', '03+3S', ''].map((m, i) => R.lgOptyReportThick(m, i === 3 ? '6 mm clear' : '')), ['8', '10', '3+3', '6']);
check('C1 chisum note: a row per glass, by thickness then width small→big, area m²', R.lgOptyNoteRows(rows, 'chisum').map(r => [r.item, r.h, r.w, r.qty, r.m2]),
  [['חיסום בלבד 5 מ"מ', 598, 598, 1, 0.36], ['חיסום בלבד 8 מ"מ', 898, 398, 1, 0.36], ['חיסום בלבד 8 מ"מ', 650, 650, 1, 0.42],
   ['חיסום בלבד 8 מ"מ', 1883, 658, 1, 1.24], ['חיסום בלבד 8 מ"מ', 658, 1883, 1, 1.24], ['חיסום בלבד 8 מ"מ', 660, 1885, 3, 3.73]]);
check('C1e like note 5900: OptyWay X 402 / Y 1452 → רוחב 1450, גובה 400; decimals rounded; OptyWay polish (grind 2) → as is', R.lgOptyReportRows({ M: { job: 'M', day: 'd', mat: '08S', pieces: {
  1: { w: 402, h: 1452, qty: 1, note: 'חיסום' }, 2: { w: 622.1, h: 345.8, qty: 1, note: 'חיסום' }, 3: { w: 534, h: 535, grind: 2, qty: 1, note: 'חיסום' } } } }, 'd', {}, {}).map(r => [r.w, r.h]), [[1450, 400], [344, 620], [535, 534]]);
check('C1f date on the page = next work day (Thu 26/11 → Sun 29/11)', [R.lgOptyReportOutDay('2026-11-23'), R.lgOptyReportOutDay('2026-11-26')], ['2026-11-24', '2026-11-29']);
check('C1b area like the old note: 1850×712×2 = 2.63', R.lgOptyNoteRows([{ w: 1850, h: 712, qty: 2, mat: '08S', chisum: true }], 'chisum')[0].m2, 2.63);
check('C1c paint item names carry the colour', R.lgOptyNoteRows(rows, 'paint').map(r => r.item), ['צבע 040NWC 8 מ"מ', 'צבע 7016 8 מ"מ']);
check('C1d triplex item names', R.lgOptyNoteRows(rows, 'triplex').map(r => r.item), ['טריפלקס 8 מ"מ', 'טריפלקס 10 מ"מ']);
const html = R.lgOptyReportHtml('chisum', rows, '2026-11-24', 5901);
check('C2 note has no client names', /BathPlace|דרורית|ידני/.test(html), false);
check('C3 chisum note: number, to Uzi, original, total', /הזמנה מס׳ 5901/.test(html) && /לכבוד: עוזי/.test(html) && /מקור/.test(html) && /סה"כ/.test(html), true);
const ht = R.lgOptyReportHtml('triplex', rows, 'x', 5902);
check('C5 other notes: empty line to fill "לכבוד" by hand', /לכבוד: <span class="blank">/.test(ht), true);
check('C4 triplex note says טריפלקס and has no chisum rows', /תעודת טריפלקס/.test(ht) && !/חיסום בלבד/.test(ht), true);
const h2 = R.lgOptyReportHtml('report', rows, '2026-11-24', 5901);
check('D1 report shows clients and orders, not triplex', /BathPlace/.test(h2) && /דרורית/.test(h2) && /ידני/.test(h2) && !/>T</.test(h2), true);
const h3 = R.lgOptyReportHtml('report-triplex', rows, '2026-11-24', 5902);
check('D5 triplex report (Ben 25/11): own page by client, only triplex, not in chisum report', /דוח טריפלקס/.test(h3) && />T</.test(h3) && !/BathPlace/.test(h3) && !/דוח חיסום/.test(h3) && !/>T</.test(h2), true);
check('D6 triplex report rows = triplex note rows', R.lgOptyReportFor(rows, 'report-triplex').map(r => r.key), ['M1_5', 'm_k2']);
check('D2 date line', R.lgOptyReportDate('2026-08-18'), 'יום שלישי 18 אוגוסט 2026');
check('D3 empty day', /אין זכוכית/.test(R.lgOptyReportHtml('report', [], '2026-11-24', 0)), true);
check('D4 escapes', /<b>x/.test(R.lgOptyReportHtml('report', [{ client: '<b>x', name: '', glass: '', w: 1, h: 1, qty: 1, chisum: true }], 'x', 0)), false);
const hz = R.lgOptyReportHtml('report', rows, '2026-11-26', 5901);
check('E1 date chosen by hand (Ben 26/11) wins; bad value → regular next work day', [/יום שלישי 1 דצמבר 2026/.test(R.lgOptyReportHtml('chisum', rows, '2026-11-26', 5901, '2026-12-01')), /יום ראשון 29 נובמבר 2026/.test(R.lgOptyReportHtml('chisum', rows, '2026-11-26', 5901, 'x')), /יום ראשון 29 נובמבר 2026/.test(hz)], [true, true, true]);
check('E2 stripes: every other glass row grey, also when printing (Ben 26/11)', [(h2.match(/<tr class="z">/g) || []).length, /print-color-adjust:exact/.test(h2), (R.lgOptyReportHtml('chisum', rows, 'd', 1).match(/<tr class="z">/g) || []).length], [3, true, 3]);
//  ישר ל-Brother (בן, 26/11): מודל עמודים
const pm = R.lgOptyReportPrintModel('report', rows, '2026-11-26', 5901, '2026-12-01');
check('F1 head: number, report name, chosen date', [pm.head.title, pm.head.sub, pm.head.date, pm.head.orig], ['הזמנה מס׳ 5901', 'דוח חיסום', 'יום שלישי 1 דצמבר 2026', false]);
check('F2 report lines = clients, orders, rows; stripes every other row', pm.pages[0].map(l => l.t + (l.z ? 'z' : '')).join(''), 'corcorzcorcorzcrrz');
const pn = R.lgOptyReportPrintModel('chisum', rows, '2026-11-26', 5901);
check('F3 note: rows + total, date = next work day, to Uzi', [pn.pages[0].length, pn.pages[0][6].t, pn.pages[0][6].cells[3], pn.head.date, pn.head.to], [7, 't', '8', 'יום ראשון 29 נובמבר 2026', 'לכבוד: עוזי']);
const big = {}; for (let i = 1; i <= 90; i++) big[i] = { client: 'C' + Math.floor(i / 10), name: 'n' + (i % 3), w: 500 + i, h: 600, qty: 1, note: 'חיסום' };
const pb = R.lgOptyReportPrintModel('report', R.lgOptyReportRows({ M: { job: 'M', day: 'd', mat: '08S', pieces: big } }, 'd', {}, {}), 'd', 1, '', 40);
const units = { c: 1.8, o: 1.3, r: 1, t: 1.5 };
check('F4 long report splits into pages, none over the limit, no client/order title left last on a page, all 90 rows kept',
  [pb.pages.length > 2, pb.pages.every(pg => pg.reduce((n, l) => n + units[l.t], 0) <= 40), pb.pages.every(pg => pg[pg.length - 1].t === 'r'), pb.pages.flat().filter(l => l.t === 'r').length], [true, true, true, 90]);
check('F5 empty day', R.lgOptyReportPrintModel('cnc', [], 'd', 1).empty, true);
check('G1 clients A-Z, English first then Hebrew, no name last (Ben 26/11)', ['מאור', 'בלי שם לקוח', 'zeta glass', 'א.א.פנדה', 'BathPlace', 'דודו עקיבא', 'H.B.GLASS', '3D זכוכית', 'S GLASS'].sort(R.lgOptyClientCmp),
  ['3D זכוכית', 'BathPlace', 'H.B.GLASS', 'S GLASS', 'zeta glass', 'א.א.פנדה', 'דודו עקיבא', 'מאור', 'בלי שם לקוח']);
check('G2 report groups follow that order', R.lgOptyReportByClient([{ client: 'מאור', name: 'a' }, { client: 'BathPlace', name: 'b' }, { client: 'א.א.פנדה', name: 'c' }]).map(c => c.client), ['BathPlace', 'א.א.פנדה', 'מאור']);
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
