#!/usr/bin/env node
/**
 * עריכת פריטים מחלון הסקיצה (בן, 26/11): סימן על כל שורה ששונתה (בשביל מי שמפיק חשבונית
 * בחשבשבת), ומחיקת שורה לא מזיזה את סימוני "הגיע" / "נבדק" לשורה הלא נכונה.
 * Run: node scripts/test-items-edit-marks.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const writes = [];
const ctx = {
  console,
  lgVerifiedSession: () => ({ name: 'עובד חיסום', phone: '0500000000' }),
  lgStageToStatus: s => s, lgStatusToStage: s => s,
  _lgDb: { ref: p => ({ update: async u => { writes.push({ path: p, update: u }); } }) },
};
vm.createContext(ctx);
const pick = re => { const m = FB.match(re); if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); } return m[0]; };
vm.runInContext([
  pick(/function _lgClean[\s\S]*?\n}/),
  pick(/function lgNormalizeOrder[\s\S]*?\n}/),
  pick(/function lgPriceClientName[\s\S]*?\n}/),
  pick(/\/\/ ─── 9א\.[\s\S]*?\nasync function lgMarkInvoiced[\s\S]*?\n}/),
  pick(/function lgCalcAreaM2[\s\S]*?\n}/),
  pick(/function lgCalcOrderM2[\s\S]*?\n}/),
  pick(/function lgGroupByQuantityId[\s\S]*?\n}/),
  pick(/function lgRepriceLockedItems[\s\S]*?\n}/),
  pick(/function lgHsWasSent[\s\S]*?\n}/),
  pick(/function lgAddHsCorrection[\s\S]*?\n}/),
  pick(/function lgHsCorrectionsForEdit[\s\S]*?\n}/),
  pick(/function lgItemsEditMarks[\s\S]*?\n}/),
  pick(/function lgShiftIdxFields[\s\S]*?\n}/),
  pick(/async function lgSaveOrderItemsEdit[\s\S]*?\n}/),
].join('\n').replace(/^const /gm, 'var '), ctx);

const it = (w, h, extra) => Object.assign({ name: "8 מ''מ קליר מחוסם", sku: '8CMH', w, h, chisum: true }, extra);
const copy = a => a.map(x => Object.assign({}, x));

// ── סימנים ──
const B = [it(600, 1490, { hsLine: 1 }), it(873, 1900, { hsLine: 2 }), it(357, 1890, { hsLine: 3 })];
let A = copy(B); A[1].w = 433;
let m = ctx.lgItemsEditMarks(B, A, 'בן', 100);
check('A1 size change → "was" kept on the line', [m.items[1].editedFrom, m.items[1].editedBy, m.items[1].editedAt, m.items[0].editedFrom, m.removed], ['873×1900', 'בן', 100, undefined, []]);
let A2 = copy(m.items); A2[1].w = 434;
check('A2 second change keeps the FIRST "was" (what Hashavshevet still has)', ctx.lgItemsEditMarks(m.items, A2, 'x', 200).items[1].editedFrom, '873×1900');
let A3 = copy(m.items); A3[1].w = 873;
check('A3 changed back to the original → mark goes away', ctx.lgItemsEditMarks(m.items, A3, 'x', 300).items[1].editedFrom, undefined);
let G = copy(B); G[2].sku = '8CGMH'; G[2].name = "8 מ''מ קליר גרפיקה מחוסם"; G[2].graphic = true;
check('A4 glass change → "was" glass', ctx.lgItemsEditMarks(B, G, 'x', 1).items[2].editedGlassFrom, "8 מ''מ קליר מחוסם (8CMH)");
let N = copy(B).concat([it(500, 500)]);
m = ctx.lgItemsEditMarks(B, N, 'x', 7);
check('A5 new line → "new" mark, others untouched', [m.items[3].addedAt, m.items[3].addedBy, m.items[0].editedAt], [7, 'x', undefined]);
m = ctx.lgItemsEditMarks(B, [B[0], B[2]].map(x => Object.assign({}, x)), 'x', 9);
check('A6 removed line → its place reported', m.removed, [1]);

// ── הזזת סימונים אחרי מחיקה ──
const ord = {
  wdDoneIdxs: [true, true, true], chisumArrivedIdxs: [true, null, true], chisumClosedIdxs: { 2: true },
  triplexArrivedIdxs: null, brokenChisum: { 2: { at: 5 } }, avWrap: [11, 12, 13],
  hsCorrections: { c1: { itemIndex: 2, done: false }, c2: { itemIndex: 0, done: false }, c3: { itemIndex: 2, done: true } },
};
const sh = ctx.lgShiftIdxFields(ord, [1]);
check('B1 marks after the removed line move up one', [sh.wdDoneIdxs, sh.chisumArrivedIdxs, sh.chisumClosedIdxs, sh.brokenChisum, sh.avWrap],
  [{ 0: true, 1: true }, { 0: true, 1: true }, { 1: true }, { 1: { at: 5 } }, { 0: 11, 1: 13 }]);
check('B2 open corrections follow their line; done ones stay; empty fields untouched',
  [sh['hsCorrections/c1/itemIndex'], 'hsCorrections/c2/itemIndex' in sh, 'hsCorrections/c3/itemIndex' in sh, 'triplexArrivedIdxs' in sh], [1, false, false, false]);
check('B3 nothing removed → nothing written', ctx.lgShiftIdxFields(ord, []), {});
check('B4 removing the only marked line → field cleared', ctx.lgShiftIdxFields({ chisumClosedIdxs: { 1: true } }, [1]).chisumClosedIdxs, null);

// ── השמירה ──
(async () => {
  const order = ctx.lgNormalizeOrder({ id: 'o1', orderNum: 'L1375', orderClient: 'ערן נאור', stage: 'chisum',
    hashavshevet: { sentAt: 1, httpOk: true }, items: B, chisumArrivedIdxs: [true, null, true], wdDoneIdxs: [true, true, true] });
  writes.length = 0;
  const after = [B[0], B[2]].map(x => Object.assign({}, x));
  await ctx.lgSaveOrderItemsEdit(order, after, {});
  const u = writes[0].update, rk = Object.keys(u).filter(k => k.startsWith('removedItems/'));
  check('C1 save: removed line recorded for the invoice, arrived marks shifted, Hashavshevet correction logged',
    [rk.length, rk.length && u[rk[0]].w, rk.length && u[rk[0]].hsLine, rk.length && u[rk[0]].by, u.chisumArrivedIdxs, Object.keys(u).filter(k => k.startsWith('hsCorrections/')).length],
    [1, 873, 2, 'עובד חיסום', { 0: true, 1: true }, 1]);
  writes.length = 0;
  const ed = copy(B); ed[1].w = 433;
  await ctx.lgSaveOrderItemsEdit(order, ed, {});
  check('C2 save: size edit carries the mark into the stored items', [writes[0].update.items[1].w, writes[0].update.items[1].editedFrom], [433, '873×1900']);
  writes.length = 0;
  const addThenRemove = Object.assign({}, order, { items: copy(B).concat([it(1, 1, { addedAt: 5 })]) });
  await ctx.lgSaveOrderItemsEdit(addThenRemove, copy(B), {});
  check('C3 a line added and removed again leaves no "removed" note', Object.keys(writes[0].update).filter(k => k.startsWith('removedItems/')).length, 0);
  check('C4 normalizer keeps removedItems', !!ctx.lgNormalizeOrder({ id: 'x', removedItems: { r1: { w: 1 } } }).removedItems, true);
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
