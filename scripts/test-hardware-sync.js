#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — הסנכרון מחשבשבת מביא גם פרזול ("פריט רגיל") — בן, 1/11:
//  "הגדרנו בהתחלה לא למשוך את המקטים של פריט רגיל אלא רק פריט מכפלה".
//
//  א. lgHbItemsForCatalog: מכפלה → זכוכית כמו היום; פריט רגיל → kind:'hardware';
//     סוגים אחרים לא נכנסים; מחיר 0 לא דורס.
//  ב. syncSkuCatalogFromHashavshevet: לפרזול אין ניחוש זכוכית מהשם ("מגנט ישר
//     שקוף" אינו זכוכית שקופה); לזכוכית — כמו היום.
//  ג. מסכי הזכוכית לא רואים פרזול: lgResolveSkuCode, רשימת הקודים בשורת
//     הזכוכית, lgGlassTypesWithCatalog.
//  ד. הסנכרון מבקש את כל הסוגים.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8').replace(/\r\n/g, '\n');
const pick = (src, re) => { const m = src.match(re); if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); } return m[0]; };

const store = {};
const ctx = vm.createContext({
  console, Date, JSON, Object, Array, String, Number, Set,
  _lgDb: { ref: p => ({
    once: async () => ({ val: () => store[p] || null }),
    set: async v => { store[p] = v; },
  }) },
});
vm.runInContext([
  pick(DB, /function _lgClean[\s\S]*?\n}/),
  pick(DB, /const LG_GLASS_DEFAULT_BASE = [^;]+;/),
  pick(DB, /const LG_GLASS_TYPES_BY_LENGTH = [\s\S]*?;\n/),
  pick(DB, /const LG_IMPLIES_BASE_GLASS = [^;]+;/),
  pick(DB, /function lgGuessOperationalFromName[\s\S]*?\n}/),
  pick(DB, /const LG_SKU_BUSINESS_FIELDS\s*=[^;]+;/),
  pick(DB, /const LG_SKU_OPERATIONAL_FIELDS\s*=[^;]+;/),
  pick(DB, /async function syncSkuCatalogFromHashavshevet[\s\S]*?\n}/),
  pick(DB, /function lgResolveSkuCode[\s\S]*?\n}/),
  (DB.match(/function lgHbItemsForCatalog[\s\S]*?\n}/) || ['function lgHbItemsForCatalog(){ return []; }'])[0],
].join('\n').replace(/^const /gm, 'var '), ctx);

(async () => {
  // ── א ──
  const rows = [
    { code: '8SMH', name: "8 מ''מ שקוף מחוסם", price: 210, itemType: 'מכפלה' },
    { code: '300', name: 'ציר ק/זכ זהב מוברש פליז', price: 70, itemType: 'פריט רגיל' },
    { code: '1014', name: 'מגנט ישר שקוף', price: 0, itemType: 'פריט רגיל' },
    { code: 'X1', name: 'הובלה', price: 50, itemType: 'שירות' },
    // בדוח האמיתי הסוג כתוב "רגיל" (בן, 1/11 — הדוח החזיר "רגיל: 404, מכפלה: 183, מונה: 1")
    { code: '1004', name: 'זווית ק/זכ 90 ניקל זאמק', price: 12, itemType: 'רגיל' },
    { code: 'M1', name: 'מונה', price: 0, itemType: 'מונה' },
  ];
  const out = ctx.lgHbItemsForCatalog(rows);
  check('א. מכפלה + פריט רגיל / רגיל נכנסים, שירות ומונה לא', out.map(x => x.code), ['8SMH', '300', '1014', '1004']);
  check('א. רגיל = פרזול', out.map(x => x.fields.kind || ''), ['', 'hardware', 'hardware', 'hardware']);
  check('א. מחיר רק כשיש', out.map(x => x.price), [210, 70, 0, 12]);

  // ── ב ──
  for (const x of out) await ctx.syncSkuCatalogFromHashavshevet(x.code, x.fields);
  check('ב. פרזול — בלי ניחוש זכוכית מהשם', [store['skuCatalog/1014'].glass, store['skuCatalog/1014'].mm, store['skuCatalog/1014'].opAuto], [undefined, undefined, undefined]);
  check('ב. פרזול נשמר עם kind', [store['skuCatalog/300'].kind, store['skuCatalog/300'].name], ['hardware', 'ציר ק/זכ זהב מוברש פליז']);
  check('ב. זכוכית — כמו היום', [store['skuCatalog/8SMH'].glass, store['skuCatalog/8SMH'].mm, store['skuCatalog/8SMH'].proc, store['skuCatalog/8SMH'].kind], ['שקוף', 8, 'chisum', undefined]);

  // ── ג ──
  const map = { '300': store['skuCatalog/300'], '1014': store['skuCatalog/1014'], '8SMH': store['skuCatalog/8SMH'] };
  check('ג. lgResolveSkuCode — פרזול אינו זכוכית', ctx.lgResolveSkuCode('300', map), null);
  check('ג. רשימת הקודים בשורת הזכוכית מסננת פרזול', /function _lgRenderIwCodeList[\s\S]*?e\.kind !== 'hardware'[\s\S]*?\n}/.test(ADMIN), true);

  // ── ג2. פורטל הלקוח: המחירון שלו מציג "למ"ר" — פרזול לא שם (עוד לא הוחלט שהלקוח רואה מחירי פרזול) ──
  const PORTAL = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8').replace(/\r\n/g, '\n');
  check('ג2. הפורטל מסנן פרזול מהמחירון', /Object\.values\(_portalSkuCatalog\)\s*\n\s*\.filter\(e => e && e\.kind !== 'hardware'\)/.test(PORTAL), true);
  const BF = fs.readFileSync(path.join(ROOT, 'scripts', 'backfill-sku-operational.js'), 'utf8');
  check('ג2. סקריפט המילוי לא מנחש זכוכית לפרזול', /row\.kind === 'hardware'\) continue;/.test(BF), true);

  // ── ג3. מסך המחירונים: פרזול מוצג כפרזול — מחיר ליחידה, בלי מ"מ/מספריים, בלי "ערוך תפעולי", אחרי הזכוכית ──
  check('ג3. מחיר ליחידה לפרזול', /e\.kind==='hardware'\?'\/יח׳':'\/מ"ר'/.test(ADMIN), true);
  check('ג3. תא תפעולי: "🔩 פרזול"', /e\.kind==='hardware'\?'🔩 פרזול'/.test(ADMIN), true);
  check('ג3. אין "ערוך תפעולי" לפרזול', /e\.kind==='hardware'\?'':`<button onclick="_skuEditCode=/.test(ADMIN), true);
  check('ג3. זכוכית קודם, פרזול אחריה', /\(a\.kind==='hardware'\)-\(b\.kind==='hardware'\)/.test(ADMIN), true);

  // ── ד ──
  const sync = pick(ADMIN, /async function syncFromHashavshevetNow[\s\S]*?\n}/);
  check('ד. מבקש את כל הסוגים', /hashavshevet-items\?itemType=all/.test(sync), true);
  check('ד. עובר דרך lgHbItemsForCatalog', /lgHbItemsForCatalog\(data\.items\)/.test(sync), true);

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
