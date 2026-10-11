#!/usr/bin/env node
/**
 * כפתורי חלון "פרטי הזמנה" באדמין בטלפון (06/10).
 *
 * חמישה כפתורים בשורה אחת — מחק · סמן כפיקטיבית · קדם לשלב · שמור · ביטול.
 * בטלפון הם נדחסו: "ביטול" נשבר לאות בשורה, "שמור" לשלוש שורות.
 *
 * ≤600: אף כפתור לא נשבר באמצע מילה, וכולם 44px. בחלון ההזמנה:
 *   שמור (רחב) · ביטול
 *   קדם לשלב — רוחב מלא
 *   סמן כפיקטיבית · מחק הזמנה
 * הכלל הבסיסי (גלישה לשורות, בלי שבירה) חל על כל .mfoot באדמין.
 *
 * Run: node scripts/test-modal-footer-mobile.js
 */
const fs   = require('fs');
const path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const foot = (A.match(/<div class="mfoot">\s*<button[^>]*deleteOrderById[\s\S]*?<\/div>/) || [''])[0];
check('the order window footer is found', foot.length > 0, true);
check('the delete button can be placed by class', /class="mf-del"[^>]*deleteOrderById|deleteOrderById[^>]*class="mf-del"/.test(foot), true);

const css = (A.match(/\/\* ─ כפתורי חלונות בטלפון[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the phone rule exists', css.length > 0, true);
check('footers wrap instead of squeezing', /\.mfoot\{[^}]*flex-wrap:wrap/.test(css), true);
check('no button breaks mid-word', /\.mfoot (>\s*)?button\{[^}]*white-space:nowrap/.test(css), true);
check('every footer button is a 44px target', /\.mfoot (>\s*)?button\{[^}]*min-height:44px/.test(css), true);
check('save comes first and wide', /#ov \.btn-save\{[^}]*order:1[^}]*flex:1 1 55%/.test(css), true);
check('the stage action gets its own full row', /#modalAdvBtn\{[^}]*flex:1 1 100%/.test(css), true);
check('delete goes last', /#ov \.mf-del\{[^}]*order:5/.test(css), true);
/* בדפדפן: שלוש שורות כפתורים ירדו מתחת לקצה המסך, כי גובה הגוף היה
   נוסחה קבועה. החלון חייב להיות עמודה שבה הגוף נגלל והכפתורים קבועים. */
check('the window is a column as tall as the screen', /\.modal\{[^}]*flex-direction:column[^}]*max-height:100dvh/.test(css), true);
check('the body scrolls in whatever height is left', /\.modal > \.mbody\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*max-height:none/.test(css), true);
check('the buttons never shrink off the screen', /\.mhdr,\.mfoot\{flex-shrink:0/.test(css), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll modal-footer mobile checks passed.');
