#!/usr/bin/env node
/**
 * טבלת ההזמנות הראשית באדמין — בטלפון כרטיס לכל הזמנה (גל 2, 06/10).
 *
 * הטבלה רחבה 735px. במסך של 390 העמודות נדחסו, שם הסקיצה נשבר מילה בשורה,
 * והמחיר / הסטטוס / "פרטים" ישבו מחוץ למסך בגלילה אופקית.
 *
 * ≤600: אותה טבלה, אותם תאים, אותם מטפלים — רק CSS. כל שורה הופכת לכרטיס:
 *   לקוח ............................ סטטוס
 *   מספר הזמנה · שם סקיצה ............ מחיר
 *   סוג מקלחון
 *   זכוכית · פרזול · שטח
 *   תאריך ........................... פרטים
 * התאים נושאים class לפי תוכן ולא לפי מיקום, כדי שהוספת עמודה לא תזיז
 * את הכרטיס בשקט.
 *
 * Run: node scripts/test-admin-table-mobile.js
 */
const fs   = require('fs');
const path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const render = (A.match(/function renderTable\(\)\{[\s\S]*?\n}/) || [''])[0];
check('renderTable is found', render.length > 0, true);

const CELLS = ['ot-sel', 'ot-client', 'ot-num', 'ot-type', 'ot-glass', 'ot-finish',
               'ot-area', 'ot-price', 'ot-status', 'ot-date', 'ot-act'];
const tds = [...render.matchAll(/<td class="(ot-[a-z]+)"/g)].map(m => m[1]);
check('every cell is named for what it holds, in table order', tds, CELLS);

const css = (A.match(/\/\* ─ טבלת ההזמנות בטלפון[\s\S]*?\r?\n}\r?\n/) || [''])[0];
check('the phone layout exists', css.length > 0, true);
check('the header row goes away', /\.ot thead\{display:none;?\}/.test(css), true);
check('each row becomes a wrapping card', /\.ot tr\{[^}]*display:flex[^}]*flex-wrap:wrap/.test(css), true);
check('nothing scrolls sideways', /\.table-wrap\{[^}]*overflow:visible/.test(css), true);
check('the details button is a real touch target', /\.ot-act \.cb-btn\{[^}]*min-height:44px/.test(css), true);
/* מספר השורה לא אומר כלום בכרטיס, אבל תיבת הבחירה לחשבונית חייבת להישאר */
/* בדפדפן: ".ot td{display:block}" גבר על ".ot-sel{display:none}" — המספר נשאר */
check('the row number hides, the invoice checkbox stays',
      /\.ot td\.ot-sel\{display:none/.test(css) && /\.ot td\.ot-sel:has\(input\)/.test(css), true);
check('tags with no value leave no empty box', /\.ot \.tag:empty\{display:none/.test(css), true);
check('an order with no area shows nothing, not a bare unit',
      /ot-area"[^>]*>\$\{o\.area \? o\.area \+ ' מ״ר' : ''\}/.test(render), true);
check('empty cells take no space', /\.ot td:empty\{display:none/.test(css), true);
for (const c of CELLS) check(`the card places ${c}`, new RegExp('\\.' + c + '\\b').test(css), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll admin-table mobile checks passed.');
