#!/usr/bin/env node
/**
 * לוח בדיקת סקיצות ביום העבודה (בן, 19/10/2026).
 *
 * בן עובר סקיצה-סקיצה מול OptyWay: מסנן סוג זכוכית (8 שקוף), מדפדף באותו סדר
 * שאופטי ווי מראה, ובכל סקיצה תקינה לוחץ "הוסף סקיצה" — שמכניס לטיוטה רק את
 * ה-8 שקוף שלה. סקיצה עם 8 + 6 נשארת בתור של ה-6 עד שגם הוא יורד.
 *
 * הסדר: לפי השם של הלקוח *באופטי ווי* (מאור, א.א.פנדה, BathPlace), אנגלית קודם,
 * ובתוך לקוח — מה שנכנס לאופטי ווי ראשון (optyAt; בלי — createdAt).
 *
 * Spec: docs/superpowers/specs/2026-10-19-workday-sketch-board-design.md
 * Run:  node scripts/test-workday-sketch-board.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); failed++; return ''; }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};
const constOf = (src, name) => {
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*[\\s\\S]*?\\];'));
  if (!m) { console.error('FAIL  missing const ' + name); failed++; return ''; }
  return m[0].replace(/^const/, 'var');
};

const it = (glass, mm, extra) => Object.assign({ glass, mm, w: 600, h: 1500 }, extra || {});
const ord = (id, client, optyAt, items, extra) =>
  Object.assign({ id, orderClient: client, orderNum: 'L' + id, stage: 'opty', optyAt, createdAt: 1, items }, extra || {});

function makeCtx(orders, opts) {
  opts = opts || {};
  const ctx = vm.createContext({
    Math, JSON, Object, Array, String, Number, Set, console,
    allOrders: orders, draftItems: opts.draft || [], skuCatalogMap: {},
    workDay: { inWork: [], inChisum: [], itemsSel: opts.itemsSel || {} },
    document: { getElementById: id => (id === 'fClient' ? { value: opts.client || '' } : null) },
  });
  vm.runInContext([
    bodyOf(DB, 'lgGlassLabelOf'), bodyOf(DB, 'lgIdxsObj'), bodyOf(DB, 'lgArrivedIdxs'), bodyOf(DB, 'lgWorkdayLeft'),
    bodyOf(WD, 'glassMatches'), bodyOf(WD, '_wdBuildable'), bodyOf(WD, '_wdUnavailIdxs'),
    constOf(WD, 'WD_OPTY_DEFAULTS'),
    bodyOf(WD, 'wdOptyNamesFrom'), bodyOf(WD, 'wdOptyName'), bodyOf(WD, 'wdBoardCompare'),
    bodyOf(WD, 'wdBoardAvail'), bodyOf(WD, 'wdBoardOrders'), bodyOf(WD, 'wdBoardGlassTypes'), bodyOf(WD, 'wdBoardLeft'),
  ].join('\n'), ctx);
  return ctx;
}
const ids = list => list.map(o => o.id);

/* ── names map ── */
{
  const ctx = makeCtx([]);
  const def = JSON.parse(JSON.stringify(ctx.WD_OPTY_DEFAULTS));
  check('defaults: the three clients Ben gave', def, [
    { client: 'נאור חזקיה', opty: 'א.א.פנדה' },
    { client: 'המקום לאמבט', opty: 'BathPlace' },
    { client: 'א.מ.מראות', opty: 'מאור' },
  ]);
  check('nothing saved yet → the defaults', ctx.wdOptyNamesFrom(null).length, 3);
  check('a saved list wins, empty rows dropped',
    JSON.parse(JSON.stringify(ctx.wdOptyNamesFrom([{ client: 'x', opty: 'y' }, { client: '', opty: 'z' }, { client: 'q', opty: ' ' }]))),
    [{ client: 'x', opty: 'y' }]);
  check('saved as an object by Firebase still reads', ctx.wdOptyNamesFrom({ 0: { client: 'x', opty: 'y' } }).length, 1);
  check('a client with an OptyWay name shows it', ctx.wdOptyName('א.מ.מראות', def), 'מאור');
  check('a client without one keeps its own name', ctx.wdOptyName('לקוח חדש', def), 'לקוח חדש');
}

/* ── order: OptyWay names, English first, then entry time ── */
{
  const orders = [
    ord('m2', 'א.מ.מראות', 300, [it('שקוף', 8)]),
    ord('n1', 'נאור חזקיה', 100, [it('שקוף', 8)]),
    ord('m1', 'א.מ.מראות', 200, [it('שקוף', 8)]),
    ord('b1', 'המקום לאמבט', 500, [it('שקוף', 8)]),
    ord('z1', '3M זכוכית', 50, [it('שקוף', 8)]),
    ord('old', 'א.מ.מראות', 0, [it('שקוף', 8)], { createdAt: 250 }),
  ];
  const ctx = makeCtx(orders);
  check('BathPlace, 3M first (English/digits), then א.א.פנדה, then מאור by entry time',
    ids(ctx.wdBoardOrders('8 שקוף', ctx.WD_OPTY_DEFAULTS)), ['z1', 'b1', 'n1', 'm1', 'old', 'm2']);
  const ctx2 = makeCtx(orders, { client: 'א.מ.מראות' });
  check('the client filter keeps only that client', ids(ctx2.wdBoardOrders('8 שקוף', ctx2.WD_OPTY_DEFAULTS)), ['m1', 'old', 'm2']);
}

/* ── one sketch, two glass types ── */
{
  const mixed = ord('x', 'א.מ.מראות', 1, [it('שקוף', 8), it('שקוף', 6), it('שקוף', 8), it('שקוף', 6)]);
  const ctx = makeCtx([mixed]);
  check('8 שקוף: only the 8mm pieces', JSON.parse(JSON.stringify(ctx.wdBoardAvail(mixed, '8 שקוף'))), [0, 2]);
  check('what is left is named with its count', ctx.wdBoardLeft(mixed, '8 שקוף'), '6 שקוף ×2');
  check('glass types on the board, with piece counts, thinnest first',
    JSON.parse(JSON.stringify(ctx.wdBoardGlassTypes())), [{ label: '6 שקוף', count: 2 }, { label: '8 שקוף', count: 2 }]);

  const drafted = makeCtx([mixed], { draft: [{ orderId: 'x', itemIdx: 0 }, { orderId: 'x', itemIdx: 2 }] });
  check('after the 8mm are in the draft, the sketch leaves the 8 שקוף queue', drafted.wdBoardOrders('8 שקוף', []).length, 0);
  check('…and stays in the 6 שקוף queue', ids(drafted.wdBoardOrders('6 שקוף', [])), ['x']);
  check('…and nothing is "left" beside the 6', drafted.wdBoardLeft(mixed, '6 שקוף'), '');

  const sent = makeCtx([Object.assign({}, mixed, { stage: 'workday' })], { itemsSel: { x: [0, 2] } });
  check('pieces already in work count as taken too', sent.wdBoardOrders('8 שקוף', []).length, 0);
  check('the rest of a partly sent sketch is still on the board', ids(sent.wdBoardOrders('6 שקוף', [])), ['x']);
}
{
  const ctx = makeCtx([ord('e', 'לקוח', 1, [])]);
  check('an order with no items is not on the board', ctx.wdBoardOrders('8 שקוף', []).length, 0);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-board checks passed.');
