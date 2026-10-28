#!/usr/bin/env node
/**
 * הזמנת רכש ב-PDF ממוחשב (אביבי, בן 28/10/2026) → שורות בהזמנה.
 * פריטי הטקסט למטה משחזרים את המבנה של הזמנה אמיתית (PO26H016504): אותן
 * עמודות ואותם מיקומים (x, y) — בלי פרטי הקשר שבראש הדף.
 *
 * Run:  node scripts/test-po-pdf.js
 */
const { lgPoParse, lgPoGroups, lgPoSupplier } = require('../api/_po-pdf.js');
const { lgWaTextItems } = require('../api/_wa-text-order.js');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const { PAGE, at } = require('./_po-fixture.js');

const po = lgPoParse(PAGE);
check('supplier is Avivi', po.supplier, 'avivi');
check('order number → sketch name', po.ref, 'PO26H016504');
check('three rows: length / width / units', po.rows.map(r => [r.line, r.code, r.l, r.w, r.qty]),
      [[1, '102400009', 501, 248, 4], [2, '102400009', 503, 248, 4], [3, '102400009', 552, 248, 4]]);
check('description from the customer row', po.rows[0].desc, 'זכוכית אקסטרה קליר 8 מ"מ ליטוש');
check('sizes agree with the m² column — no warnings', [po.rows.every(r => r.check), po.warnings], [true, []]);

const g = lgPoGroups(po);
check('Avivi 102400009 → our 8CM (Ben 28/10)', g.map(x => x.sku), ['8CM', '8CM', '8CM']);
const cat = { '8CM': { name: '8 מ"מ קליר מלוטש', glass: 'קליר', mm: 8, proc: 'litush' } };
const items = lgWaTextItems({ groups: g }, cat);
check('4 units per row = 12 items', items.length, 12);
check('item carries SKU, catalog name and size', [items[0].sku, items[0].name, items[0].w, items[0].h, items[0].litush, items[0].skuMissing],
      ['8CM', '8 מ"מ קליר מלוטש', 501, 248, true, undefined]);
check('items keep the quantity group', [items[3].originalQuantity, items[3].groupIndex, items[4].groupIndex], [4, 4, 1]);

// מק"ט שלא בטבלה — נכנס בלי מק"ט, בן בוחר בתור
const other = PAGE.map(i => i.str === '102400009' && i.y === 525 ? { ...i, str: '999999999' } : i);
const g2 = lgPoGroups(lgPoParse(other));
check('unknown Avivi code → no SKU, customer description kept', [g2[1].sku, g2[1].heading], [null, 'זכוכית אקסטרה קליר 8 מ"מ ליטוש']);
check('unknown code item is flagged skuMissing', lgWaTextItems({ groups: g2 }, cat)[4].skuMissing, true);

// מידות שלא מתאימות למ"ר — השורה נכנסת עם הערה לבדוק
const bad = PAGE.map(i => i.str === '503.00' ? { ...i, str: '50.30' } : i);
const pb = lgPoParse(bad);
check('size/m² mismatch → row kept, warning', [pb.rows.length, pb.rows[1].check, pb.warnings.length], [3, false, 1]);

// לא הזמנת רכש של אביבי — לא נוגעים (סקיצה רגילה)
check('a plain sketch PDF is not an order', lgPoParse(at(500, [[300, 'מקלחון'], [200, '90/190']])), null);
check('another supplier\'s purchase order is not read', lgPoSupplier(at(500, [[300, 'הזמנת רכש מספר'], [200, 'PO123456']])), null);
check('no table header → no rows, a warning', lgPoParse(PAGE.filter(i => i.y !== 617)).rows, []);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall ok');
