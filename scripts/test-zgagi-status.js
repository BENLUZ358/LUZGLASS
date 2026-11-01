#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — api/_zgagi-status.js: שלבים לזגאגי, וביטול פריט.
//  א. שלבים: מוכן / לא / נעול / נמחק / עסק אחר.  ב. ביטול.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { fakeDb } = require('./_fake-db');
const { lgZgagiReceive } = require('../api/_zgagi-inbound');
const S = require('../api/_zgagi-status');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const WORLD = () => ({
  hashavshevetAccounts: { 14201: { key: '14201', name: 'א.מ מראות' } },
  skuCatalog: { '8SMH': { name: '8 מ"מ שקוף מחוסם', active: true } },
});
const send = (db, itemId, biz) => lgZgagiReceive(db, { biz: biz || 'bizA', order: 'ord1', orderNo: '1024', customerNo: '14201', rev: 1,
  item: { itemId, type: 'measure', qty: 1, measure: { glassType: 'שקוף', thickness: 8, processing: 'chisum', w: 500, h: 600 } } }, 1000);
const T = 1762000000000;

(async () => {
  const db = fakeDb(WORLD());
  for (const i of ['a', 'b', 'c', 'd']) await send(db, i);
  const id = i => 'zg_' + require('../api/_zgagi-inbound').lgZgagiItemKey('bizA', 'ord1', i);
  db._data.orders[id('a')].stage = 'done';
  db._data.orders[id('b')].stage = 'chash';
  db._data.orders[id('c')].stage = 'workday';
  delete db._data.orders[id('d')];

  let r = await S.lgZgagiStages(db, { biz: 'bizA', order: 'ord1', items: ['a', 'b', 'c', 'd', 'never'] });
  check('א. מוכן', [r.items.a.ready, r.items.a.stage, r.items.a.refNum], [true, 'done', 'L1000']);
  check('א. בשרטוט — לא מוכן, אפשר לשנות', [r.items.b.ready, r.items.b.canChange], [false, true]);
  check('א. בייצור — נעול', [r.items.c.ready, r.items.c.canChange], [false, false]);
  check('א. נמחק אצלנו', r.items.d, { refNum: 'L1003', gone: true });
  check('א. פריט שלא נשלח — לא בתשובה', r.items.never, undefined);
  r = await S.lgZgagiStages(db, { biz: 'bizB', order: 'ord1', items: ['a'] });
  check('א. עסק אחר לא רואה', r.items, {});
  check('א. בלי רשימה', (await S.lgZgagiStages(db, { biz: 'bizA', order: 'ord1' })).code, 'bad-input');
  for (const s of ['delivery', 'collected']) { db._data.orders[id('a')].stage = s; check('א. ' + s + ' = מוכן', (await S.lgZgagiStages(db, { biz: 'bizA', order: 'ord1', items: ['a'] })).items.a.ready, true); }

  // ── ב. ביטול ──
  r = await S.lgZgagiCancel(db, { biz: 'bizA', order: 'ord1', itemId: 'b' }, T);
  check('ב. בשרטוט — בוטל', [r.code, db._data.orders[id('b')]], ['ok', undefined]);
  const card = db._data.waMeta.agentCancels[id('b')];
  check('ב. כרטיס בתיקון הזמנות', [card.confirmed, card.via, card.order.refNum, card.hsSent, card.done], [true, 'zgagi', 'L1001', false, false]);
  r = await S.lgZgagiCancel(db, { biz: 'bizA', order: 'ord1', itemId: 'c' }, T);
  check('ב. בייצור — נעול, נשאר', [r.code, r.stage, !!db._data.orders[id('c')], db._data.waMeta.agentCancels[id('c')]], ['locked', 'workday', true, undefined]);
  check('ב. עסק אחר לא מבטל', (await S.lgZgagiCancel(db, { biz: 'bizB', order: 'ord1', itemId: 'a' }, T)).code, 'not-found');
  check('ב. ביטול שני — כבר בוטל', (await S.lgZgagiCancel(db, { biz: 'bizA', order: 'ord1', itemId: 'b' }, T)).code, 'ok');

  // הכרטיס מוצג בדף בלי chatId, ועם "בוטל בזגאגי"
  const html = fs.readFileSync(path.join(__dirname, '..', 'hs-corrections.html'), 'utf8');
  check('ב. הדף מראה "בוטל בזגאגי"', /via === 'zgagi'[^\n]*בוטל בזגאגי/.test(html), true);

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
