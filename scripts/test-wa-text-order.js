#!/usr/bin/env node
/**
 * הזמנות מראות מהודעת טקסט בוואטסאפ (בן, 20/10/2026 — אגן ברזל).
 * "תתייחס רק לשורות המידות, הכותרת שלהן היא המק"ט, ומספר ההזמנה על שם הסקיצה — בלי רעש."
 * ההודעות למטה הן שלוש ההודעות האמיתיות מהצילומים של בן.
 *
 * Spec: docs/superpowers/specs/2026-10-20-wa-text-mirror-orders-design.md
 * Run:  node scripts/test-wa-text-order.js
 */
const { lgWaTextParse, lgWaTextIsOrder, lgWaTextSvg, lgWaTextItems } = require('../api/_wa-text-order.js');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const plain = x => JSON.parse(JSON.stringify(x));

const PHR26034 = `הזמנת מראות מרכזת מס' PHR#26034
תאריך: 15.10.2026
מראה ללא מסגרת לפי מידה
179/74 ס"מ — כמות: 1
179/74 ס"מ — כמות: 1
200/110 ס"מ — כמות: 1
89/139 ס"מ — כמות: 1`;

const PHR26037 = `הזמנת מראות מרכזת מס' PHR#26037
תאריך: 18.10.2026
מראה ללא מסגרת לפי מידה
90/145 ס"מ — כמות: 1
194/49 ס"מ — כמות: 1
100/50 ס"מ — כמות: 1
100/50 ס"מ — כמות: 1
זכוכית מאסטר ליין 8 מ"מ — מלוטש
110/41.5 ס"מ — כמות: 1
מראה שחורה ללא מסגרת לפי מידה
194/49 ס"מ — כמות: 1`;

const AGN00001 = `הועברה
שאול אנ' ח'י עדן ,
הזמנה מספר AGN#00001
מראות 5 מ"מ
תאריך: 19.10.2026
179.6/49.6 ס"מ כמות: 10`;

{
  const p = lgWaTextParse(PHR26034);
  check('PHR#26034: the order number', p.orderRef, 'PHR#26034');
  check('…one heading → 5MIRM', p.groups.map(g => g.sku), ['5MIRM']);
  check('…four size lines in mm, as written', plain(p.groups[0].lines),
        [{ w: 1790, h: 740, qty: 1 }, { w: 1790, h: 740, qty: 1 }, { w: 2000, h: 1100, qty: 1 }, { w: 890, h: 1390, qty: 1 }]);
}
{
  const p = lgWaTextParse(PHR26037);
  check('PHR#26037: three headings → 5MIRM, 8MM, 5MIRAM', p.groups.map(g => g.sku), ['5MIRM', '8MM', '5MIRAM']);
  check('…the heading text is kept', p.groups[1].heading, 'זכוכית מאסטר ליין 8 מ"מ — מלוטש');
  check('…a decimal cm size', plain(p.groups[1].lines), [{ w: 1100, h: 415, qty: 1 }]);
  check('…lines per group', p.groups.map(g => g.lines.length), [4, 1, 1]);
}
{
  const p = lgWaTextParse(AGN00001);
  check('AGN#00001: order number after "הועברה" and a name', p.orderRef, 'AGN#00001');
  check('…the date line between heading and sizes is not the heading', p.groups[0].heading, 'מראות 5 מ"מ');
  check('…a size line without a dash, quantity 10', plain(p.groups[0].lines), [{ w: 1796, h: 496, qty: 10 }]);
}

/* the SKU words (Ben, 20/10) */
const skuOf = heading => lgWaTextParse('X#1\n' + heading + '\n100/50 ס"מ — כמות: 1').groups[0].sku;
check('"מראה ברונזה" → 5MIRBM', skuOf('מראה ברונזה ללא מסגרת לפי מידה'), '5MIRBM');
check('"מראה אפורה" → 5MIRAM', skuOf('מראה אפורה לפי מידה'), '5MIRAM');
check('"3+3 חתוך" → 6TSH', skuOf('טריפלקס 3+3 שקוף חתוך'), '6TSH');
check('"3+3 מלוטש" → 6TSM', skuOf('טריפלקס 3+3 שקוף — מלוטש'), '6TSM');
check('an unknown heading → no SKU (the only flag)', skuOf('זכוכית חלבית 10 מ"מ'), null);

/* punctuation the phone may send */
{
  const p = lgWaTextParse('PHR#5\nמראה\n‏179 / 74 ס״מ - כמות:2‎\n90/50 סמ –כמות: 3');
  check('״, RTL marks, spaces, "-" / "–", no quote', plain(p.groups[0].lines), [{ w: 1790, h: 740, qty: 2 }, { w: 900, h: 500, qty: 3 }]);
}

/* not an order: nothing happens, exactly like today */
check('a normal chat message is not an order', lgWaTextIsOrder('מתי ההזמנה מוכנה?'), false);
check('an order number with no sizes is not an order', lgWaTextIsOrder('לגבי PHR#26037 — אפשר לאסוף מחר?'), false);
check('sizes with no order number are not an order', lgWaTextIsOrder('מראה\n100/50 ס"מ — כמות: 1'), false);
check('a real message is an order', lgWaTextIsOrder(PHR26037), true);

/* the picture of the message (instead of a sketch) */
{
  const svg = lgWaTextSvg('PHR#1\n<מראה> & ש"ב\n100/50 ס"מ — כמות: 1', { client: 'אגן ברזל', when: '20.10.2026 16:52' });
  const body = decodeURIComponent(svg.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  check('the picture is an SVG data URL', svg.startsWith('data:image/svg+xml;charset=utf-8,'), true);
  check('every line is in it, escaped', /&lt;מראה&gt; &amp; ש&quot;ב/.test(body) && /100\/50/.test(body), true);
  check('right-to-left', /direction="rtl"/.test(body), true);
  check('the client and the time are on top', /אגן ברזל/.test(body) && /20\.10\.2026 16:52/.test(body), true);
  const h = s => Number((decodeURIComponent(s).match(/height="(\d+)"/) || [])[1]);
  check('a longer message makes a taller picture', h(lgWaTextSvg(PHR26037, {})) > h(lgWaTextSvg('PHR#1\nמראה\n100/50 ס"מ — כמות: 1', {})), true);
}

/* items for the sketch queue — the same shape iwAdd builds (lgMakeQuantityGroup) */
{
  const CAT = {
    '5MIRM':  { code: '5MIRM',  name: "5 מ''מ מראה מלוטש", glass: 'מראה', mm: 5, proc: 'litush' },
    '5MIRAM': { code: '5MIRAM', name: "5 מ''מ מראה אפורה מלוטש", glass: 'מראה אפורה', mm: 5, proc: 'litush' },
  };
  const items = lgWaTextItems(lgWaTextParse('X#1\nמראה\n100/50 ס"מ — כמות: 2\nמראה שחורה\n90/40 ס"מ — כמות: 1\nזכוכית חלבית\n30/30 ס"מ — כמות: 1'), CAT);
  check('quantity 2 → two items (one per piece), like the queue', items.filter(x => x.sku === '5MIRM').length, 2);
  check('…sharing one quantity group, numbered 1..2', items.slice(0, 2).map(x => [x.originalQuantity, x.groupIndex, x.quantityGroupId === items[0].quantityGroupId]), [[2, 1, true], [2, 2, true]]);
  check('the item carries the catalog name, glass, mm, sizes and processing', (({ sku, name, glass, mm, w, h, litush, chisum }) => ({ sku, name, glass, mm, w, h, litush, chisum }))(items[0]),
        { sku: '5MIRM', name: "5 מ''מ מראה מלוטש", glass: 'מראה', mm: 5, w: 1000, h: 500, litush: true, chisum: false });
  check('a different line is its own group', items[2].quantityGroupId !== items[0].quantityGroupId, true);
  const missing = items[3];
  check('an unknown heading: the item has no SKU, keeps the heading as its name, and is marked', [missing.sku, missing.name, missing.skuMissing, missing.w], [undefined, 'זכוכית חלבית', true, 300]);
  const noCat = lgWaTextItems(lgWaTextParse('X#1\nמראה\n100/50 ס"מ — כמות: 1'), {});
  check('a SKU missing from the catalog is still set (priced by SKU), named by the heading', [noCat[0].sku, noCat[0].name], ['5MIRM', 'מראה']);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll WhatsApp text-order checks passed.');
