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
  const K = Z.lgZgagiItemKey('bizA', 'ord1', 'it1');
  const id = 'zg_' + K;
  check('א. נוצרה', [r.code, r.items.it1.state, r.items.it1.refNum, r.items.it1.orderId], ['ok', 'created', 'L1000', id]);
  let o = db._data.orders[id];
  check('א. שדות ההזמנה', [o.source, o.customerId, o.orderClient, o.client, o.stage, o.status, o.hasSketch, o.refNum, o.orderNum, o.sketchName, o.paymentStatus],
    ['zgagi', '14201', 'א.מ מראות', 'א.מ מראות', '', 'ממתין לאישור', true, 'L1000', 'L1000', 'מקלחון חזיתי · 1024', 'unpaid']);
  check('א. zgagi', o.zgagi, { biz: 'bizA', order: 'ord1', item: 'it1', orderNo: '1024', rev: 1 });
  check('א. פריטים עם מק"ט', o.items.map(i => [i.sku, i.w, i.h]), [['8SMH', 900, 1950], ['8SMH', 600, 1950]]);
  check('א. פרזול', o.hardware, [{ name: 'ציר', qty: 2, sku: '0001' }]);
  check('א. לשונית ראשונה — בלי sketchSeenAt', o.sketchSeenAt, undefined);
  check('א. התמונה ב-sketches/', db._data.sketches[id], PNG);
  check('א. רשומת זהות', [db._data.waMeta.zgagiItems[K].orderId, db._data.waMeta.zgagiItems[K].rev], [id, 1]);
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

  // ── ה. שורות חשבשבת לפי הזכוכית, לא לפי המקום (סקירה I2) ──
  const sent = () => { Object.assign(db._data.orders[id], { stage: 'chash', hashavshevet: { sentAt: T + 50 } }); };
  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  sent(); db._data.orders[id].items[0].hsLine = 1; db._data.orders[id].items[1].hsLine = 2;
  await Z.lgZgagiReceive(db, body({ rev: 2 }, { output: { panels: [pane('B', 600, 1950)] } }), T + 100);
  o = db._data.orders[id];
  check('ה. A נמחקה — B שומרת את השורה שלה (2), לא של A', o.items.map(i => [i.paneLabel, i.hsLine]), [['B', 2]]);
  check('ה. נרשם רק "להסיר A"', Object.values(o.hsCorrections).map(c => [c.type, c.hsLine]), [['remove', 1]]);

  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body({}, { qty: 2 }), T);
  sent(); db._data.orders[id].items.forEach((x, i) => { x.hsLine = 10 + i; });   // A0 A1 B0 B1
  await Z.lgZgagiReceive(db, body({ rev: 2 }, { qty: 3 }), T + 100);
  o = db._data.orders[id];
  check('ה. כמות 2→3: כל זכוכית שומרת את השורות שלה', o.items.map(i => [i.paneLabel, i.groupIndex, i.hsLine || null]),
    [['A', 0, 10], ['A', 1, 11], ['A', 2, null], ['B', 0, 12], ['B', 1, 13], ['B', 2, null]]);
  check('ה. נרשמו רק 2 תוספות, בלי "מידה" מזויפת', Object.values(o.hsCorrections).map(c => c.type).sort(), ['add', 'add']);

  // ── ה2. תיקון בלי תמונה חדשה — לא מוחקים את ציור השרטט (סקירה M1) ──
  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body(), T);
  db._data.orders[id]._editedSketch = 'x'; db._data.checkEdits = { [id]: { s: 1 } };
  await Z.lgZgagiReceive(db, body({ rev: 2, imagePng: null }, { output: { panels: [pane('A', 950, 1950)] } }), T + 100);
  check('ה2. ציורים נשארו', [db._data.orders[id]._editedSketch, !!db._data.checkEdits[id], db._data.sketches[id]], ['x', true, PNG]);

  // ── ה3. זהות: גיבוב, תווים, רשומה של מישהו אחר (סקירה I3) ──
  check('ה3. a + b_c ≠ a_b + c', Z.lgZgagiItemKey('a', 'b_c', 'X') === Z.lgZgagiItemKey('a_b', 'c', 'X'), false);
  db = fakeDb(WORLD());
  check('ה3. מזהה עם / נדחה', (await Z.lgZgagiReceive(db, body({ order: 'a/b' }), T)).code, 'bad-input');
  check('ה3. מזהה ארוך מ-64 נדחה', (await Z.lgZgagiReceive(db, body({ biz: 'x'.repeat(65) }), T)).code, 'bad-input');
  check('ה3. מספר לקוח לא ספרות נדחה', (await Z.lgZgagiReceive(db, body({ customerNo: '../x' }), T)).code, 'bad-input');
  await Z.lgZgagiReceive(db, body(), T);
  db._data.waMeta.zgagiItems[K].biz = 'אחר';
  check('ה3. רשומה שלא שלו → נדחה', (await Z.lgZgagiReceive(db, body({ rev: 2 }, { output: { panels: [pane('A', 1, 1)] } }), T)).code, 'bad-input');

  // ── ה4. תקרות (סקירה I4) ──
  db = fakeDb(WORLD());
  check('ה4. כמות 101 נדחית', (await Z.lgZgagiReceive(db, body({}, { qty: 101 }), T)).code, 'bad-input');
  check('ה4. כמות שבר נדחית', (await Z.lgZgagiReceive(db, body({}, { qty: 1.5 }), T)).code, 'bad-input');
  check('ה4. 51 זכוכיות נדחות', (await Z.lgZgagiReceive(db, body({}, { output: { panels: Array.from({ length: 51 }, (_, i) => pane('P' + i, 1, 1)) } }), T)).code, 'bad-input');
  check('ה4. 101 פרזול נדחה', (await Z.lgZgagiReceive(db, body({}, { hardware: Array.from({ length: 101 }, () => ({ name: 'x', qty: 1 })) }), T)).code, 'bad-input');
  check('ה4. שום דבר לא נכתב, גם לא המונה', [db._data.orders, (db._data.meta || {}).orderCounter], [undefined, undefined]);

  // ── ה5. פרזול בהערות; מק"ט רק אם פעיל אצלנו (סקירה I6) ──
  db = fakeDb(WORLD());
  await Z.lgZgagiReceive(db, body({}, { hardware: [{ name: 'ציר', qty: 2, sku: '8SMH' }, { name: 'ידית', qty: 1, sku: 'NOPE' }] }), T);
  check('ה5. הערה', db._data.orders[id].notes, 'פרזול (להוסיף בחשבשבת ידנית): ציר ×2 (8SMH), ידית ×1');

  // ── ה6. בעלות (סקירה C1) ──
  check('ה6. הזמנה שלנו — שייכת', await Z.lgZgagiOwned(db, id), true);
  db._data.orders.fake = { id: 'fake', source: 'zgagi', zgagi: { biz: 'x' } };
  check('ה6. הזמנה מזויפת מהפורטל — לא', await Z.lgZgagiOwned(db, 'fake'), false);
  check('ה6. zg_ בלי רשומה — לא', await Z.lgZgagiOwned(db, 'zg_' + 'a'.repeat(24)), false);
  db._data.waMeta.zgagiItems[K].cancelledAt = 5;
  check('ה6. אחרי ביטול — לא', await Z.lgZgagiOwned(db, id), false);
  r = await Z.lgZgagiReceive(db, body(), T + 1);
  check('ה6. שליחה חוזרת של פריט שבוטל → gone (סקירה M3)', r.items.it1.state, 'gone');

  // ── ו. מתג ──
  db = fakeDb(Object.assign(WORLD(), { waMeta: { zgagiConfig: { skipFirstTab: true } } }));
  await Z.lgZgagiReceive(db, body(), T);
  check('ו. מתג דלוק → ישר ללשונית השנייה', db._data.orders[id].sketchSeenAt, T);
  // ההודעה ללקוח: רשת הביטחון הקיימת ("טופלו וממתינים לעדכון") מציגה אותה — ר' Task 8

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
