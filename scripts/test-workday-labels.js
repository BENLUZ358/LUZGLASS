#!/usr/bin/env node
/**
 * כפתור "🏷 מדבקות" בטאב חיסום/טריפלקס (workday.html). בן, 3/11.
 *   A. הכפתור בשורת כל לקוח, ליד "✓ סמן הכל", בשני המסלולים.
 *   B. החלון בונה מדבקות רק ממה שמסומן שהגיע ועוד פתוח בדוח (_markedIdxSet ∩ _pendingIdxsOf).
 *   C. ההדפסה: כל מדבקה מצוירת ונארזת (lgLabelRender) ונשלחת ל-/api/print create.
 *   D. אחרי השליחה — מצב ההדפסה, וקישור ללוח ההדפסות.
 *   E. ההיגיון עצמו (A+B) רץ על נתונים: קבוצה של 3 שסומנו 2 → 2 מדבקות.
 * Run: node scripts/test-workday-labels.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const W = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

check('A0 print-labels.js is loaded', /<script src="print-labels\.js[^"]*"><\/script>/.test(W), true);
const card = (W.match(/function _chisumClientCardHtml[\s\S]*?\n}\n/) || [''])[0];
check('A1 the client row has the labels button', /openLabelsModal\(/.test(card) && /🏷 מדבקות/.test(card), true);
check('A2 registered per row for the modal (both tracks share the function)', /_lblGroups\[/.test(card), true);
const modal = (W.match(/function _lblEntries[\s\S]*?\n}\n/) || [''])[0];
check('B1 only marked-and-still-open glass', /_markedIdxSet\(/.test(modal) && /_pendingIdxsOf\(/.test(modal), true);
const send = (W.match(/async function _lblPrint[\s\S]*?\n}\n/) || [''])[0];
check('C1 each label is drawn and packed', /lgLabelRender\(/.test(send), true);
check('C2 sent to the print center', /_lgAuthPost\('\/api\/print'/.test(send) && /action: 'create'/.test(send), true);
check('D1 status is followed', /action: 'get'/.test(W) && /prints\.html/.test(W), true);

/* E — run _lblEntries on data */
const ctx = {
  allOrders: [{ id: 'o1', orderClient: 'המקום לאמבט', items: [{ w: 1, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 3 }] }],
  _markedIdxSet: () => new Set([0, 2]),
  _pendingIdxsOf: () => [0, 1, 2],
  _lblGroups: { k: { clientName: 'המקום לאמבט', orderIds: ['o1'], track: 'chisum' } },
};
vm.createContext(ctx);
vm.runInContext(modal, ctx);
const e = ctx._lblEntries('k');
check('E1 2 of 3 marked → 2 glasses', e.map(x => [x.order.id, x.idxs]), [['o1', [0, 2]]]);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
