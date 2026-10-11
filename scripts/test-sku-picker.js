#!/usr/bin/env node
/**
 * בורר מק"טים בעברית — תור הסקיצות (בן, 06/10).
 *
 * iOS לא מאפשר לאתר לבחור את שפת המקלדת, ולכן שדה הקוד נפתח בעברית
 * והקלדת "8SMH" דרשה החלפת מקלדת בכל פריט. הבורר מקבל עברית ("8 שקוף
 * חיסום") או קוד, מציג רשימה, ולחיצה ממלאת את הקוד ועוברת לרוחב.
 *
 * כללים שנבדקים כאן:
 *   • מילים בכל סדר; מספר = עובי בדיוק (8 לא תופס 18)
 *   • חיסום ↔ מחוסם, ליטוש ↔ מלוטש; מ''מ / מ״מ / מ"מ — אותו דבר
 *   • קוד: התאמה מדויקת ראשונה, אחר כך קידומת
 *   • רק מק"טים שאפשר באמת להוסיף: active ועם proc (lgResolveSkuCode
 *     דוחה כל השאר — הצעה שלהם הייתה מובילה ל"קוד לא מוכר")
 *   • "אחרונים": 6, הכי חדש ראשון, בלי כפילות; אחסון שנכשל לא שובר כלום
 *
 * Run: node scripts/test-sku-picker.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sku-picker.js'), 'utf8'), ctx);
const { lgSkuSearch, lgSkuRecentPush, lgSkuRecentList } = ctx;

const CAT = {
  '8SMH':  { code: '8SMH',  name: "8 מ''מ שקוף מחוסם",       mm: 8,  glass: 'שקוף', proc: 'chisum' },
  '8SM':   { code: '8SM',   name: "8 מ''מ שקוף מלוטש",       mm: 8,  glass: 'שקוף', proc: 'litush' },
  '8CMH':  { code: '8CMH',  name: "8 מ''מ קליר מחוסם",       mm: 8,  glass: 'קליר', proc: 'chisum' },
  '18SMH': { code: '18SMH', name: "18 מ''מ שקוף מחוסם",      mm: 18, glass: 'שקוף', proc: 'chisum' },
  '6SMH':  { code: '6SMH',  name: "6 מ''מ שקוף מחוסם",       mm: 6,  glass: 'שקוף', proc: 'chisum' },
  '8SH':   { code: '8SH',   name: "8 מ''מ שקוף חתוך",        mm: 8,  glass: 'שקוף' },                    // בלי proc
  '8OLD':  { code: '8OLD',  name: "8 מ''מ שקוף מחוסם ישן",   mm: 8,  glass: 'שקוף', proc: 'chisum', active: false },
  '50006': { code: '50006', name: 'שכר חיסום' },                                                       // שירות
};
const codes = q => JSON.parse(JSON.stringify(lgSkuSearch(q, CAT, 10))).map(r => r.code);

check('Hebrew words find the SKU', codes('8 שקוף חיסום'), ['8SMH']);
check('in any order', codes('חיסום שקוף 8'), ['8SMH']);
check('a number is the thickness exactly — 8 does not catch 18', codes('8 מחוסם').includes('18SMH'), false);
check('ליטוש finds מלוטש', codes('8 שקוף ליטוש'), ['8SM']);
check('the catalog spelling works too', codes('שקוף מלוטש'), ['8SM']);
check('any quote style for מ"מ', codes('8 מ"מ קליר'), ['8CMH']);
check('an exact code comes first', codes('8SM')[0], '8SM');
check('a code prefix lists all that start with it', codes('8SM'), ['8SM', '8SMH']);
check('codes are case-insensitive', codes('8smh'), ['8SMH']);
check('cut-only SKUs (no processing) are not offered', codes('8 שקוף').includes('8SH'), false);
check('inactive SKUs are not offered', codes('ישן'), []);
check('services are not offered', codes('שכר'), []);
check('thinner first when the rest is equal', codes('שקוף מחוסם'), ['6SMH', '8SMH', '18SMH']);
check('an empty query offers nothing', codes('  '), []);
check('results carry the name to show', JSON.parse(JSON.stringify(lgSkuSearch('8SMH', CAT, 5)))[0],
      { code: '8SMH', name: "8 מ''מ שקוף מחוסם" });
check('the limit is honoured', lgSkuSearch('מחוסם', CAT, 2).length, 2);

/* ── אחרונים ─────────────────────────────────────────────────────────── */
const mem = {};
const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
['8SMH', '6SMH', '8SM', '8SMH', '8CMH', '18SMH', '8SM', '6SMH', '8SMH'].forEach(c => lgSkuRecentPush(c, store));
check('recent: newest first, no repeats, six at most',
      JSON.parse(JSON.stringify(lgSkuRecentList(CAT, store))).map(r => r.code), ['8SMH', '6SMH', '8SM', '18SMH', '8CMH']);
const broken = { getItem: () => { throw new Error('private mode'); }, setItem: () => { throw new Error('private mode'); } };
check('a storage that throws does not break the picker', (() => { lgSkuRecentPush('8SMH', broken); return lgSkuRecentList(CAT, broken).length; })(), 0);
mem.lgSkuRecent = JSON.stringify(['8SH', 'GONE', '8SMH']);
check('recent never offers what can no longer be added',
      JSON.parse(JSON.stringify(lgSkuRecentList(CAT, store))).map(r => r.code), ['8SMH']);
for (let i = 0; i < 9; i++) lgSkuRecentPush('X' + i, store);
check('the stored list stays capped at six', JSON.parse(mem.lgSkuRecent).length, 6);

/* ── השדה באדמין ────────────────────────────────────────────────────── */
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const field = (A.match(/<input[^>]*id="iwCode"[^>]*>/) || [''])[0];
check('admin loads the picker', /<script src="sku-picker\.js"><\/script>/.test(A), true);
check('the code field takes a Hebrew phrase — no 8-character cap', /maxlength/.test(field), false);
check('the native datalist no longer competes with the picker', /list="iwCodeList"/.test(field), false);
check('the field is announced as a combobox', /role="combobox"/.test(field) && /aria-controls="iwSkuList"/.test(field), true);
check('the result list exists', /<div id="iwSkuList" role="listbox"/.test(A), true);
check('the placeholder says Hebrew works', /placeholder="[^"]*עברית|placeholder="[^"]*שקוף/.test(field), true);
const add = (A.match(/function iwAdd\(\)\{[\s\S]*?\n}/) || [''])[0];
check('a successful add is remembered as recent', /lgSkuRecentPush\(/.test(add), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll SKU-picker checks passed.');
