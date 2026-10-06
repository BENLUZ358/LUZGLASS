#!/usr/bin/env node
/**
 * תור הסקיצות בטלפון — הזנת מק"ט ומידות (בן, 06/10).
 *
 * מה היה:
 *   • שורת ההזנה (קוד · רוחב × גובה × כמות · הוסף) הייתה שורה אחת ברוחב
 *     ~600px. בטלפון הצד השמאלי נחתך — שדה הגובה, הכמות וכפתור "הוסף".
 *   • שדות המידה היו type="text" בלי inputmode, ולכן iOS פתח מקלדת עברית
 *     מלאה כדי להקליד 0.22.
 *   • שדה הקוד תיקן אוטומטית ("8SMH" → מילה) והגדיל אותיות לא עקבי.
 *   • שורת הסינון נשארה פתוחה מעל סקיצה שנפתחה, ולקחה חצי מסך.
 *
 * הבדיקות כאן סטטיות — על ה-markup וה-CSS — כי הפריסה עצמה נבדקת בדפדפן.
 *
 * Run: node scripts/test-sq-mobile.js
 */
const fs   = require('fs');
const path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const tag = id => (A.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>')) || [''])[0];

/* ── מקלדת ───────────────────────────────────────────────────────────── */
for (const id of ['iwW', 'iwH']) {
  check(`${id} opens the number pad with a decimal point`, /inputmode="decimal"/.test(tag(id)), true);
}
check('the quantity opens the number pad', /inputmode="numeric"/.test(tag('iwQty')), true);
const code = tag('iwCode');
check('the SKU field is not autocorrected', /autocorrect="off"/.test(code) && /spellcheck="false"/.test(code), true);
check('the SKU field capitalises as it is typed', /autocapitalize="characters"/.test(code), true);

/* שדות המידה בשורות הפריטים שכבר נוספו — אותו דבר */
const render = (A.match(/function iwRender\(\)[\s\S]*?\n}/) || [''])[0];
check('existing item dimensions open the number pad too',
      (render.match(/inputmode="decimal"/g) || []).length >= 2, true);

/* הערכים בשורת הפריט מוצגים במטרים (lgMmToMeterStr) — התווית אמרה מ"מ */
check('the item row says meters, which is what it shows',
      /lgMmToMeterStr[\s\S]*?<span[^>]*>מ׳<\/span>/.test(render) && !/>מ"מ<\/span>\s*\n\s*<span class="iw-item-proc/.test(render), true);

/* ── פריסה ──────────────────────────────────────────────────────────── */
const mobile = (A.match(/\/\* ─ שורת ההזנה בתור הסקיצות[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the entry row has a narrow-screen layout', mobile.length > 0, true);
check('which wraps instead of overflowing', /\.iw-input-row\{[^}]*flex-wrap:wrap/.test(mobile), true);
check('with 44px fields and 16px text (no iOS zoom)', /min-height:44px/.test(mobile) && /font-size:16px/.test(mobile), true);
check('and a full-width add button', /\.iw-add\{[^}]*flex:1 1 100%/.test(mobile), true);
/* בבדיקה בדפדפן: flex-basis 0 נתן לרוחב ולגובה 36px, כי ההמרה למ"מ נדחסה
   לאותה שורה. בסיס של רבע שורה דוחף אותה לשורה משלה. */
check('width and height keep a real share of the row',
      /#iwW,\.iw-input-row #iwH\{flex:1 1 25%/.test(mobile), true);

/* ── שורת הסינון נסגרת כשנפתחת סקיצה ───────────────────────────────── */
const show = (A.match(/function sqShowDetailPanel\(\)\{[\s\S]*?\n}/) || [''])[0];
check('opening a sketch folds the filter row away', /sqToggleFilters\(false\)/.test(show), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-queue mobile entry checks passed.');
