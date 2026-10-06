#!/usr/bin/env node
/**
 * חלון "פרטי הזמנה" באדמין (בן, 06/10): "שאני לוחץ על פירוט הפורמט של
 * הפריטים משתנה", "אי אפשר לחזור אחורה", "עיצוב וסדר יותר נוח".
 *
 *   • פריטים: פורמט אחד. קודם 3 הראשונים הוצגו כשורות פשוטות, ו"ראה עוד"
 *     צייר את כולם מחדש בפורמט אחר (תגים, רקע) — זה ה"משתנה".
 *   • סדר: תקציר (מספר, סטטוס, לקוח, טלפון, תאריך) → פריטים → סקיצה →
 *     שינוי סטטוס. קודם הכל בעמודה אחת והפריטים אחרי הסקיצה.
 *   • טלפון לחיץ (tel:).
 *   • מחוות "חזור" באייפון סוגרת את החלון במקום לצאת מהדף (history).
 *
 * Run: node scripts/test-order-modal.js
 */
const fs   = require('fs');
const path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const open = (A.match(/function openMod\(id\) \{[\s\S]*?\n}/) || [''])[0];
check('openMod is found', open.length > 0, true);

/* פורמט אחד */
check('items are drawn by one function', /_modItemsHtml\(/.test(open), true);
const all = (A.match(/function showAllItems\(\)\{[\s\S]*?\n}/) || [''])[0];
check('"show all", if it exists, uses the same function', !all || /_modItemsHtml\(/.test(all), true);
check('no separate 3-line preview format any more', /previewItems/.test(open), false);

/* סדר */
const at = s => open.indexOf(s);
check('order: summary, items, sketch, status',
      [at('class="msum"'), at('id="itemsPreview"'), at('data-sketch-for'), at('id="mst"')].every((v, i, a) => v > -1 && (i === 0 || v > a[i - 1])), true);
check('the status is a clearly labelled menu', /שנה סטטוס/.test(open), true);
check('the phone can be tapped to call', /href="tel:/.test(open), true);
check('the summary shows the status as a coloured tag', /class="msum-st"/.test(open), true);

/* חזרה */
check('opening pushes a history entry', /history\.pushState\(\{\s*lgModal:\s*'ov'\s*\}/.test(open), true);
const close = (A.match(/function closeMod\(e\) \{[\s\S]*?\n}/) || [''])[0];
check('closing by ✕ rewinds that entry', /history\.back\(\)/.test(close), true);
check('the back gesture closes the window', /addEventListener\('popstate'/.test(A) && /lgModal/.test(A), true);

/* פריסה בטלפון */
check('the phone keeps two columns in the summary', /\.msum\{[^}]*grid-template-columns:1fr 1fr/.test(A), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-window checks passed.');
