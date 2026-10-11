#!/usr/bin/env node
/**
 * תחנת השרטט — הערת הלקוח מגיעה לשרטט.
 *
 * showOrder פותח את "💬 הערה על ההזמנה" כש-o.notes קיים, אבל load() בונה את התור
 * מרשימה סגורה של שדות, ו-notes לא היה בה. החלון מעולם לא נפתח. נמצא בהקלטת
 * סרטון ההדרכה (12/10). הבדיקה מריצה את מיפוי התור האמיתי מול הזמנה עם הערה.
 *
 * Run: node scripts/test-drafter-notes.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DR = fs.readFileSync(path.join(__dirname, '..', 'drafter.html'), 'utf8');

let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e)
  ? console.log('ok    ' + name) : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

const load = (DR.match(/function load\(\)\{[\s\S]*?\n\}/) || [''])[0];
check('load() was found', load.length > 0, true);
let queue = null;
const ctx = {
  _drafterUnsub: null, curOrder: null, _showingDoneBanner: true,
  lgSketchFields: () => ({}), renderSidebar() {}, updateCounter() {}, showOrder() {}, showAllDone() {},
  listenAllOrders(cb) {
    cb([{ id: 'ord_1', stage: 'chash', orderClient: 'זגגות הגליל', notes: 'לשים לב — קיר עקום' },
        { id: 'ord_2', stage: 'drafter', orderClient: 'אלומיניום דוד' },
        { id: 'ord_3', stage: 'opty', orderClient: 'לא בתור', notes: 'x' }]);
  },
};
vm.createContext(ctx);
vm.runInContext('let queue; ' + load + '; load(); this.__q = queue;', ctx);
queue = ctx.__q;
check('the queue holds the drafter orders only', queue.map(o => o.id), ['ord_1', 'ord_2']);
check('the client note reaches the drafter', queue[0].notes, 'לשים לב — קיר עקום');
check('an order without a note has none', queue[1].notes, '');
check('showOrder opens the note popup from o.notes', /if\(o\.notes\) setTimeout\(function\(\)\{ drShowNote\(o\.notes\); \}/.test(DR), true);
check('the note is shown as text, not HTML', /el\.textContent = txt;/.test(DR), true);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
