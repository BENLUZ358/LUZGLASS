#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — api/_zgagi-items.js: פריט מזגאגי → שורות תור לוז גלאס.
//  אפיון: docs/superpowers/specs/2026-11-01-zgagi-luzglass-link-design.md
//
//  א. מק"ט מהשם: כל שורת זכוכית של המחירון הבסיסי של זגאגי מקבלת את אותו
//     מק"ט שהמחירון שלו מצפה לו (ר' ZGAGI app/domain/base-pricelist.js).
//  ב. סקיצה → שורה לכל זכוכית.  ג. מידה + כמות.  ד. פרזול / העלאה.
//  ה. טביעת אצבע.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Z = require('../api/_zgagi-items');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

// הקטלוג האמיתי של המפעל (LG_SKU_MAP) — כפי שהוא יושב ב-skuCatalog
const DB = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(DB.match(/const LG_SKU_MAP = \{[\s\S]*?\n\};/)[0].replace('const LG_SKU_MAP', 'this.LG_SKU_MAP'), ctx);
const CATALOG = Object.entries(ctx.LG_SKU_MAP).map(([code, name]) => ({ code, name, active: true }));
// בחשבשבת השם נכתב לפעמים עם '' במקום "
CATALOG.push({ code: '8HMH', name: "8 מ''מ חלבי מחוסם", active: true });
CATALOG.push({ code: 'OLD1', name: '8 מ"מ ישן מחוסם', active: false });
const res = Z.lgZgagiSkuResolver(CATALOG);

// ── א. המחירון הבסיסי של זגאגי (עותק של GLASS / GRAPHIC) ──
const GLASS = [
  ['שקוף', [4, 5, 6, 8, 10, 12, 15], { litush: '{n}SM', chisum: '{n}SMH' }],
  ['קליר', [6, 8, 10, 12, 15], { litush: '{n}CM', chisum: '{n}CMH' }],
  ['אסיד', [6, 8, 10], { litush: '{n}AM', chisum: '{n}AMH' }],
  ['אסיד קליר', [6, 8, 10], { litush: '{n}ACM', chisum: '{n}ACMH' }],
  ['אפור', [6, 8], { litush: '{n}GRM', chisum: '{n}GRMH' }],
  ['ברונזה', [8, 10], { litush: '{n}BM', chisum: '{n}BMH' }],
  ['גרניט', [6, 8], { litush: '{n}GM', chisum: '{n}GMH' }],
  ['פיפטה', [8], { litush: '8PM', chisum: '8PMH' }],
  ['גלינה', [8], { litush: '8GLM', chisum: '8GLMH' }],
  ['גלינה קליר', [8, 10], { litush: '{n}GLCM', chisum: '{n}GLCMH' }],
  ['מראה', [4, 5, 6], { litush: '{n}MIRM', cut: '{n}MIRH' }],
  ['מראה ברונזה', [5], { litush: '5MIRBM', cut: '5MIRBH' }],
  ['מראה אפורה', [5], { litush: '5MIRAM', cut: null }],
];
let bad = [];
for (const [type, mms, procs] of GLASS) for (const n of mms) for (const [proc, pat] of Object.entries(procs)) {
  const want = pat ? pat.replace('{n}', n) : null;
  const got = res({ type, thickness: n, work: null, processing: proc });
  if (got !== want) bad.push(`${type} ${n} ${proc}: ${got} ≠ ${want}`);
}
for (const [type, p] of [['שקוף', 'SG'], ['קליר', 'CG']]) for (const n of [6, 8, 10]) {
  if (res({ type, thickness: n, work: 'graphic', processing: 'chisum' }) !== `${n}${p}MH`) bad.push(`${type} גרפיקה ${n}`);
  if (res({ type, thickness: n, work: 'graphic', processing: 'litush' }) !== `${n}${p}M`) bad.push(`${type} גרפיקה ${n} מלוטש`);
}
check('א. כל שורות המחירון הבסיסי של זגאגי → המק"ט הנכון', bad, []);
check('א. חלבי (שם עם \'\')', res({ type: 'שקוף', thickness: 8, work: 'chalavi', processing: 'chisum' }), '8HMH');
check('א. בלי עיבוד → מחוסם (כמו המנוע)', res({ type: 'שקוף', thickness: 8 }), '8SMH');
check('א. סוג לא קיים → null', res({ type: 'סוג לא קיים', thickness: 8, processing: 'chisum' }), null);
check('א. פריט לא פעיל לא נבחר', res({ type: 'ישן', thickness: 8, processing: 'chisum' }), null);

const pane = (label, cutW, cutH, glass, extra) => Object.assign({ id: 'p' + label, label, kind: 'fixed', cutW, cutH,
  glass, processing: { drilled: false, holes: [], cutouts: [] } }, extra || {});
const G8 = { type: 'שקוף', thickness: 8, work: null, processing: 'chisum' };
const ACTIVE = new Set(CATALOG.filter(e => e.active).map(e => e.code));

// ── ב. סקיצה ──
let r = Z.lgZgagiItems({ itemId: 'i1', type: 'sketch', title: 'מקלחון', qty: 1, withHardware: true,
  output: { panels: [pane('A', 900, 1950, G8), pane('B', 600, 1950, G8, { kind: 'door' })] },
  hardware: [{ name: 'ציר זכוכית-קיר', qty: 2, sku: '0001' }] }, res, ACTIVE);
check('ב. שורה לכל זכוכית', r.items.map(i => [i.sku, i.glass, i.mm, i.w, i.h, i.chisum, i.litush, i.paneLabel, i.locked]),
  [['8SMH', 'שקוף', 8, 900, 1950, true, false, 'A', true], ['8SMH', 'שקוף', 8, 600, 1950, true, false, 'B', true]]);
check('ב. השם מהקטלוג', r.items[0].name, '8 מ"מ שקוף מחוסם');
check('ב. פרזול עובר כמו שהוא', r.hardware, [{ name: 'ציר זכוכית-קיר', qty: 2, sku: '0001' }]);

r = Z.lgZgagiItems({ itemId: 'i2', type: 'sketch', qty: 1, withHardware: false,
  output: { panels: [pane('A', 900, 1950, { type: 'סוג לא קיים', thickness: 8, processing: 'chisum' })] },
  hardware: [{ name: 'x', qty: 1, sku: '1' }] }, res, ACTIVE);
check('ב. שורה בלי מק"ט נכנסת (skuMissing), לא נדחית', [r.items.length, r.items[0].sku, r.items[0].skuMissing], [1, null, true]);
check('ב. בלי פרזול', r.hardware, []);
check('ב. הלא-ממופה נמנה', r.unmapped, 1);

r = Z.lgZgagiItems({ itemId: 'i3', type: 'sketch', qty: 1,
  output: { panels: [pane('A', 500, 500, { type: 'משהו', thickness: 8, processing: 'chisum', key: 'glass:x' })] },
  skuHints: { 'pA': '8CMH' } }, res, ACTIVE);
check('ב. hint פעיל משמש כשאין התאמה', r.items[0].sku, '8CMH');
r = Z.lgZgagiItems({ itemId: 'i3', type: 'sketch', qty: 1,
  output: { panels: [pane('A', 500, 500, { type: 'משהו', thickness: 8, processing: 'chisum' })] },
  skuHints: { 'pA': 'OLD1' } }, res, ACTIVE);
check('ב. hint לא פעיל — לא', r.items[0].sku, null);

r = Z.lgZgagiItems({ itemId: 'i4', type: 'sketch', qty: 2,
  output: { panels: [pane('A', 900, 1950, G8)] } }, res, ACTIVE);
check('ב. כמות 2 בסקיצה → כל זכוכית פעמיים, בקבוצה', r.items.map(i => [i.paneLabel, i.originalQuantity, i.groupIndex]),
  [['A', 2, 0], ['A', 2, 1]]);

// ── ג. מידה ──
r = Z.lgZgagiItems({ itemId: 'm1', type: 'measure', title: 'מראה', qty: 3,
  measure: { glassType: 'מראה', thickness: 5, processing: 'cut', w: 600, h: 800, led: true } }, res, ACTIVE);
check('ג. 3 שורות', r.items.map(i => [i.sku, i.w, i.h, i.mm, i.groupIndex, i.originalQuantity]),
  [['5MIRH', 600, 800, 5, 0, 3], ['5MIRH', 600, 800, 5, 1, 3], ['5MIRH', 600, 800, 5, 2, 3]]);
check('ג. קבוצה אחת', new Set(r.items.map(i => i.quantityGroupId)).size, 1);
check('ג. לד בהערות', r.notes, ['עם לד']);
r = Z.lgZgagiItems({ itemId: 'm2', type: 'measure', qty: 1,
  measure: { glassType: 'שקוף', thickness: 8, milky: true, processing: 'chisum', w: 300, h: 400 } }, res, ACTIVE);
check('ג. חלבי במידה', [r.items[0].sku, r.items[0].chalavi], ['8HMH', true]);

// ── ד. העלאה ──
r = Z.lgZgagiItems({ itemId: 'u1', type: 'uploaded', qty: 1, output: { panels: [pane('A', 1, 1, G8)] } }, res, ACTIVE);
check('ד. העלאה → בלי שורות', r.items, []);

// ── ה. טביעת אצבע ──
const base = { itemId: 'i1', type: 'sketch', qty: 1, withHardware: true, output: { panels: [pane('A', 900, 1950, G8)] } };
const flip = { withHardware: true, qty: 1, type: 'sketch', itemId: 'i1', output: { panels: [pane('A', 900, 1950, G8)] } };
check('ה. יציבה כשהסדר משתנה', Z.lgZgagiFingerprint(base), Z.lgZgagiFingerprint(flip));
const moved = JSON.parse(JSON.stringify(base)); moved.output.panels[0].cutW = 901;
check('ה. משתנה כשמידה משתנה', Z.lgZgagiFingerprint(base) === Z.lgZgagiFingerprint(moved), false);
const titled = Object.assign({}, base, { title: 'שם אחר' });
check('ה. שם לא משנה (לא מסמן "עודכן" על שינוי שם)', Z.lgZgagiFingerprint(base), Z.lgZgagiFingerprint(titled));

if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
