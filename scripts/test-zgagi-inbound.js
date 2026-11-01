#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — api/_zgagi-inbound.js: פריט מזגאגי → הזמנה בתור (פעם אחת),
//  והחלפה כשהזגג תיקן.
//
//  א. קליטה ראשונה.  ב. אותה שליחה שוב.  ג. דחיות.
//  ד. תיקון: החלפה בכל מקום / תיקון הזמנות / נעילה בייצור / rev ישן.
//  ה. זהה ל-lgHsCorrectionsForEdit שבדפדפן.
//  ו. מתג "דילוג על הלשונית הראשונה".
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fakeDb } = require('./_fake-db');
const Z = require('../api/_zgagi-inbound');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const PNG = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nfake').toString('base64');
const PNG2 = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nfake-2').toString('base64');
const G8 = { type: 'שקוף', thickness: 8, work: null, processing: 'chisum' };
const pane = (label, cutW, cutH) => ({ id: 'p' + label, label, kind: 'fixed', cutW, cutH, glass: G8, processing: { holes: [] } });
const WORLD = () => ({
  hashavshevetAccounts: { 14201: { key: '14201', name: 'א.מ מראות', phone: '0501234567' } },
  skuCatalog: { '8SMH': { name: '8 מ"מ שקוף מחוסם', active: true }, '10SMH': { name: '10 מ"מ שקוף מחוסם', active: true } },
});
const body = (over, itemOver) => Object.assign({
  biz: 'bizA', bizName: 'א.מ מראות', order: 'ord1', orderNo: '1024', customerNo: '14201', rev: 1, imagePng: PNG,
  item: Object.assign({ itemId: 'it1', type: 'sketch', title: 'מקלחון חזיתי', qty: 1, withHardware: true,
    output: { panels: [pane('A', 900, 1950), pane('B', 600, 1950)] },
    hardware: [{ name: 'ציר', qty: 2, sku: '0001' }] }, itemOver || {}),
}, over || {});
const T = 1762000000000;

(async () => {
  // ── א. קליטה ראשונה ──
  let db = fakeDb(WORLD());
  let r = await Z.lgZgagiReceive(db, body(), T);
  const id = 'zg_bizA_ord1_it1';
  check('א. נוצרה', [r.code, r.items.it1.state, r.items.it1.refNum, r.items.it1.orderId], ['ok', 'created', 'L1000', id]);
  let o = db._data.orders[id];
  check('א. שדות ההזמנה', [o.source, o.customerId, o.orderClient, o.client, o.stage, o.status, o.hasSketch, o.refNum, o.orderNum, o.sketchName, o.paymentStatus],
    ['zgagi', '14201', 'א.מ מראות', 'א.מ מראות', '', 'ממתין לאישור', true, 'L1000', 'L1000', 'מקלחון חזיתי · 1024', 'unpaid']);
  check('א. zgagi', o.zgagi, { biz: 'bizA', order: 'ord1', item: 'it1', orderNo: '1024', rev: 1 });
  check('א. פריטים עם מק"ט', o.items.map(i => [i.sku, i.w, i.h]), [['8SMH', 900, 1950], ['8SMH', 600, 1950]]);
  check('א. פרזול', o.hardware, [{ name: 'ציר', qty: 2, sku: '0001' }]);
  check('א. לשונית ראשונה — בלי sketchSeenAt', o.sketchSeenAt, undefined);
  check('א. התמונה ב-sketches/', db._data.sketches[id], PNG);
  check('א. רשומת זהות', [db._data.waMeta.zgagiItems.bizA_ord1_it1.orderId, db._data.waMeta.zgagiItems.bizA_ord1_it1.rev], [id, 1]);
  check('א. תאריך ושעה בשעון ישראל', [typeof o.date, typeof o.time, o.createdAt], ['string', 'string', T]);

  // ── ב. אותה שליחה שוב ──
  r = await Z.lgZgagiReceive(db, body(), T + 5);
  check('ב. same, אותו מספר', [r.items.it1.state, r.items.it1.refNum], ['same', 'L1000']);
  check('ב. המונה לא זז', db._data.meta.orderCounter, 1000);
  r = await Z.lgZgagiReceive(db, body({}, { itemId: 'it2', title: 'שני' }), T + 6);
  check('ב. פריט שני → הזמנה שנייה', [r.items.it2.state, r.items.it2.refNum], ['created', 'L1001']);

  // ── ג. דחיות ──
  db = fakeDb(WORLD());
  r = await Z.lgZgagiReceive(db, body({ customerNo: '99999' }), T);
  check('ג. לקוח לא קיים', [r.code, db._data.orders, (db._data.waMeta || {}).zgagiItems], ['unknown-customer', undefined, undefined]);
  check('ג. בלי פריט', (await Z.lgZgagiReceive(db, body({ item: null }), T)).code, 'bad-input');
  check('ג. בלי biz', (await Z.lgZgagiReceive(db, body({ biz: '' }), T)).code, 'bad-input');
  check('ג. תמונה לא PNG', (await Z.lgZgagiReceive(db, body({ imagePng: 'data:text/html;base64,PGI+' }), T)).code, 'bad-input');
  check('ג. תמונה גדולה מדי', (await Z.lgZgagiReceive(db, body({ imagePng: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024 + 10) }), T)).code, 'bad-input');
  check('ג. סוג פריט לא מוכר', (await Z.lgZgagiReceive(db, body({}, { type: 'x' }), T)).code, 'bad-input');
  check('ג. שום דבר לא נכתב', db._data.orders, undefined);
  r = await Z.lgZgagiReceive(db, body({ imagePng: null }, { type: 'uploaded', output: null }), T);
  check('ג. העלאה בלי תמונה — נכנסת בלי פריטים', [r.code, db._data.orders[id].items, db._data.orders[id].hasSketch], ['ok', [], false]);

  // ── ד. תיקון ──
  const fixed = () => body({ rev: 2, imagePng: PNG2 }, { output: { panels: [pane('A', 950, 1950), pane('B', 600, 1950), pane('C', 300, 1950)] } });
  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  db._data.orders[id]._editedSketch = 'data:image/png;base64,xx';
  db._data.checkEdits = { [id]: { strokes: 1 } };
  db._data.sketches[id + '__layer'] = 'layer'; db._data.sketches[id + '__base'] = 'base';
  r = await Z.lgZgagiReceive(db, fixed(), T + 100);
  o = db._data.orders[id];
  check('ד. בלשונית הראשונה — הוחלף', r.items.it1.state, 'replaced');
  check('ד. פריטים חדשים', o.items.map(i => i.w), [950, 600, 300]);
  check('ד. תמונה חדשה', db._data.sketches[id], PNG2);
  check('ד. ציורים ישנים נמחקו (שרטט / תחנת בדיקה / שכבה)',
    [o._editedSketch, (db._data.checkEdits || {})[id], db._data.sketches[id + '__layer'], db._data.sketches[id + '__base']],
    [undefined, undefined, undefined, undefined]);
  check('ד. סימון "עודכן מזגאגי"', [o.zgagiUpdatedAt, o.zgagi.rev], [T + 100, 2]);
  check('ד. לא נשלח לחשבשבת → בלי תיקון הזמנות', o.hsCorrections, undefined);
  check('ד. אותו מספר', o.refNum, 'L1000');

  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  Object.assign(db._data.orders[id], { stage: 'chash', hashavshevet: { sentAt: T + 50, docNumber: 7 } });
  db._data.orders[id].items[0].hsLine = 1; db._data.orders[id].items[1].hsLine = 2;
  r = await Z.lgZgagiReceive(db, fixed(), T + 100);
  o = db._data.orders[id];
  const corr = Object.values(o.hsCorrections || {}).map(c => [c.type, c.itemIndex, c.hsLine, c.from, c.to, c.done]);
  check('ד. בשרטוט, אחרי חשבשבת — הוחלף', r.items.it1.state, 'replaced');
  check('ד. תיקון הזמנות: מידה + שורה נוספה', corr.sort(),
    [['add', 2, null, '', '8 מ"מ שקוף מחוסם (8SMH) 300×1950', false], ['dims', 0, 1, '900×1950', '950×1950', false]].sort());
  check('ד. hsLine נשמר על השורות הקיימות', o.items.map(i => i.hsLine || null), [1, 2, null]);
  check('ד. השלב לא זז', o.stage, 'chash');

  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  db._data.orders[id].stage = 'workday';
  const before = JSON.stringify(db._data);
  r = await Z.lgZgagiReceive(db, fixed(), T + 100);
  check('ד. בייצור — נעול', [r.items.it1.state, r.items.it1.stage], ['locked', 'workday']);
  check('ד. בייצור — שום דבר לא השתנה', JSON.stringify(db._data), before);

  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  r = await Z.lgZgagiReceive(db, body({ rev: 3 }), T + 100);
  check('ד. rev חדש בלי שינוי תוכן → same, בלי סימון', [r.items.it1.state, db._data.orders[id].zgagiUpdatedAt], ['same', undefined]);
  await Z.lgZgagiReceive(db, fixed(), T + 200);      // rev 2 < 3 שנשמר
  check('ד. rev ישן שהגיע באיחור — לא נוגעים', db._data.orders[id].items.length, 2);

  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  delete db._data.orders[id];
  r = await Z.lgZgagiReceive(db, fixed(), T + 100);
  check('ד. ההזמנה נמחקה אצלנו → gone, לא נוצרת מחדש', [r.items.it1.state, db._data.orders && db._data.orders[id]], ['gone', undefined]);

  // ── ה. זהה לדפדפן ──
  const DB = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
  const ctx = vm.createContext({ Math, Date, Number, String, Object, Array, JSON });
  ['function lgHsWasSent\\(order\\) \\{[\\s\\S]*?\\n\\}', 'function lgAddHsCorrection\\([\\s\\S]*?\\n\\}', 'function lgHsCorrectionsForEdit\\([\\s\\S]*?\\n\\}']
    .forEach(re => vm.runInContext(DB.match(new RegExp(re))[0], ctx));
  const cases = [
    [[{ w: 900, h: 1950, sku: '8SMH', name: 'a', hsLine: 1 }], [{ w: 950, h: 1950, sku: '8SMH', name: 'a' }]],
    [[{ w: 900, h: 1950, sku: '8SMH', name: 'a', hsLine: 1 }], [{ w: 900, h: 1950, sku: '10SMH', name: 'b' }]],
    [[{ w: 1, h: 2, sku: 'X', name: 'a', hsLine: 1 }, { w: 3, h: 4, sku: 'Y', name: 'b', hsLine: 2 }], [{ w: 3, h: 4, sku: 'Y', name: 'b' }]],
    [[{ w: 1, h: 2, sku: 'X', name: 'a', hsLine: 1 }], [{ w: 1, h: 2, sku: 'X', name: 'a' }, { w: 5, h: 6, sku: 'Z', name: 'c' }]],
  ];
  const strip = u => Object.values(u).map(c => [c.itemIndex, c.hsLine, c.type, c.from, c.to]);
  const diff = cases.filter(([b, a]) => {
    const order = { hsOrder: { sentAt: 1 }, items: b };
    const u1 = {}; ctx.U = u1; ctx.O = order; ctx.B = b; ctx.A = a;
    vm.runInContext('lgHsCorrectionsForEdit(U, O, B, A, "zgagi")', ctx);
    const u2 = Z.lgZgagiCorrections({ hashavshevet: { sentAt: 1 }, items: b }, b, a, 'zgagi', 1);
    return JSON.stringify(strip(u1)) !== JSON.stringify(strip(u2));
  });
  check('ה. אותם רישומים כמו בדפדפן', diff.length, 0);

  // ── ו. מתג ──
  db = fakeDb(Object.assign(WORLD(), { waMeta: { zgagiConfig: { skipFirstTab: true } } }));
  await Z.lgZgagiReceive(db, body(), T);
  check('ו. מתג דלוק → ישר ללשונית השנייה', db._data.orders[id].sketchSeenAt, T);
  // ההודעה ללקוח: רשת הביטחון הקיימת ("טופלו וממתינים לעדכון") מציגה אותה — ר' Task 8

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
