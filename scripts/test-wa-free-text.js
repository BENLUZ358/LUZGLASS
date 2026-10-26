#!/usr/bin/env node
/**
 * הזמנה מהודעת טקסט חופשית בוואטסאפ, לפי לקוח (בן, 26/10).
 * אפיון: docs/superpowers/specs/2026-10-26-wa-free-text-orders-design.md
 *
 *   • "מראה" לבד = מראה 5 מלוטש; אין כמות = 1; שני מספרים = רוחב×גובה בס"מ
 *   • העובי ("מראה 5", "5 מ"מ") אינו מידה; "50*89" זוג מידות, "X2" כמות
 *   • צ'אט רגיל עם מספרים אינו הזמנה; מק"ט לא חד-משמעי נשאר ריק
 *   • רק לקוח שבן הגדיר; תבנית אגן ברזל לא משתנה
 *
 * Run: node scripts/test-wa-free-text.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ft = require(path.join(ROOT, 'api', '_wa-free-text.js'));

const CAT = {
  '5MIRM':  { name: "5 מ''מ מראה מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRH':  { name: "5 מ''מ מראה חתוך", glass: 'מראה', mm: 5, active: true },
  '5MIRBM': { name: "5 מ''מ מראה ברונזה מלוטש", glass: 'מראה ברונזה', mm: 5, proc: 'litush', active: true },
  '5MIRAM': { name: "5 מ''מ מראה אפורה מלוטש", glass: 'מראה אפורה', mm: 5, proc: 'litush', active: true },
  '5MIRR':  { name: "מראה 5 מ''מ עגול מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRS':  { name: "מראה 5 מ''מ צורתית מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRG':  { name: "מראה 5 מ''מ מלוטש גרפיקה", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '8SM':    { name: "8 מ''מ שקוף מלוטש", glass: 'שקוף', mm: 8, proc: 'litush', active: true },
  '8SH':    { name: "8 מ''מ שקוף חתוך", glass: 'שקוף', mm: 8, active: true },
  '8SMH':   { name: "8 מ''מ שקוף מחוסם", glass: 'שקוף', mm: 8, proc: 'chisum', active: true },
};
// כל השורות של כל הקבוצות, עם המק"ט של הקבוצה — מה שבן יראה בתור
const rows = text => {
  const p = ft.lgWaFreeTextResolve(ft.lgWaFreeTextParse(text), CAT);
  return p.groups.flatMap(g => g.lines.map(l => [l.w, l.h, l.qty, g.sku]));
};

(async () => {

// ═══ 1. הדוגמאות של בן ═══════════════════════════════════════════════
check('ben 1', rows('מה קורה אחי תכין לי בבקשה מראה 5 מ״מ 89 על 123'), [[890, 1230, 1, '5MIRM']]);
check('ben 2', rows('אני צריך מראה 50*89'), [[500, 890, 1, '5MIRM']]);
check('ben 3', rows('מראה 5 76 54 X2'), [[760, 540, 2, '5MIRM']]);
check('ben 4', rows('תכין לי בבקשה מראה 5 מלוטש 70 120'), [[700, 1200, 1, '5MIRM']]);

// ═══ 2. צורות כתיבה ═══════════════════════════════════════════════════
check('variants 70x120', rows('מראה 70x120'), [[700, 1200, 1, '5MIRM']]);
check('variants 70 x 120', rows('מראה 70 x 120'), [[700, 1200, 1, '5MIRM']]);
check('variants x 3 at the end', rows('מראה 5 70 120 x 3'), [[700, 1200, 3, '5MIRM']]);
check("variants 2 יח'", rows("מראה 70 120 2 יח'"), [[700, 1200, 2, '5MIRM']]);
check('variants decimal cm', rows('מראה 70.5 120'), [[705, 1200, 1, '5MIRM']]);

// ═══ 3. צבע ועיבוד ════════════════════════════════════════════════════
check('bronze mirror', rows('מראה ברונזה 60 80'), [[600, 800, 1, '5MIRBM']]);
check('black mirror = grey', rows('מראה שחורה 60 80'), [[600, 800, 1, '5MIRAM']]);
check('cut mirror', rows('מראה חתוך 60 80'), [[600, 800, 1, '5MIRH']]);

// ═══ 4. זכוכית ════════════════════════════════════════════════════════
check('glass with processing', rows('זכוכית 8 שקוף מלוטש 100 על 200'), [[1000, 2000, 1, '8SM']]);
check('glass without processing: sku left empty', rows('זכוכית 8 שקוף 100 על 200'), [[1000, 2000, 1, null]]);

// ═══ 5. כמה פריטים ════════════════════════════════════════════════════
check('product line then size lines', rows('מראה 5\n60 80\n70 90 x2'), [[600, 800, 1, '5MIRM'], [700, 900, 2, '5MIRM']]);

// ═══ 6. לא הזמנה ══════════════════════════════════════════════════════
check('chat with numbers is not an order', ['נדבר מחר ב-10 על 2 דברים', 'מתי מוכן? 3 ימים?', 'מראה יפה תודה', ''].map(ft.lgWaFreeTextIsOrder),
      [false, false, false, false]);
check('an order is an order', ft.lgWaFreeTextIsOrder('מראה 70 120'), true);

// ═══ 7. שורות שלא פוענחו ══════════════════════════════════════════════
{
  const p = ft.lgWaFreeTextParse('מראה 5 60 80\nעוד 30 40 50');
  check('unparsed line is kept aside', [p.groups.flatMap(g => g.lines).length, p.unparsed], [1, ['עוד 30 40 50']]);
}
{
  const p = ft.lgWaFreeTextParse('מראה 500 80');
  check('over 4 m is not an item', [ft.lgWaFreeTextIsOrder('מראה 500 80'), p.unparsed], [false, ['מראה 500 80']]);
}

// ═══ 8. בחירת מק"ט ═══════════════════════════════════════════════════
check('sku: inactive is never chosen',
      ft.lgWaFreeTextSku({ kind: 'mirror', color: '', mm: 5, proc: 'מלוטש' }, { ...CAT, '5MIRM': { ...CAT['5MIRM'], active: false } }), null);
check('sku: two equal matches → none', ft.lgWaFreeTextSku({ kind: 'mirror', color: '', mm: 5, proc: 'מלוטש' },
      { ...CAT, X: { name: "5 מ''מ מראה מלוטש", active: true } }), null);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
