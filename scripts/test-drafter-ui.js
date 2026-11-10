#!/usr/bin/env node
/**
 * הפס "שלח לשרטט" / "השרטט סיים" בלשונית "אצל שרטט" (בן, 10/11).
 * הפונקציות הטהורות של drafter-batch.js, ב-Node (כמו test-sq-assign.js).
 * Run: node scripts/test-drafter-ui.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'drafter-batch.js'), 'utf8'), ctx);
const T = vm.runInContext('({ drafterBarModel, drafterDoneText, drafterTag, drafterSendConfirm, drafterDoneConfirm, drafterTrayTitle, drafterItemLine, drafterAddedToast })', ctx);

const AT = Date.UTC(2026, 10, 10, 12, 30);   // 14:30 בישראל
check('empty basket', T.drafterBarModel({ basket: [], open: [] }),
  { basketText: 'הסל ריק', canSend: false, sendLabel: 'שלח לשרטט', open: [], canDone: false, resend: [] });
const m = T.drafterBarModel({ basket: [{ id: 'A' }, { id: 'B' }],
  open: [{ n: 3, at: AT, count: 4, emailState: 'pending' }, { n: 4, at: AT, count: 1, emailState: 'sent' }, { n: 5, at: AT, count: 2, emailState: 'failed' }] });
check('basket text', [m.basketText, m.canSend, m.sendLabel], ['בסל: 2 הזמנות', true, 'שלח לשרטט (2)']);
check('open lines', m.open, ['משלוח 3 · 14:30 · 4 הזמנות · המייל בדרך', 'משלוח 4 · 14:30 · הזמנה אחת · המייל נשלח', 'משלוח 5 · 14:30 · 2 הזמנות · המייל נכשל']);
check('can press done when something was sent', m.canDone, true);
check('one order basket', T.drafterBarModel({ basket: [{ id: 'A' }], open: [] }).basketText, 'בסל: הזמנה אחת');

check('send confirm', T.drafterSendConfirm(2), 'לשלוח 2 הזמנות לשרטט במייל?');
check('done confirm', T.drafterDoneConfirm(5), 'להעביר את כל מה שנשלח לשרטט (5) ל"בנה יום עבודה"?');

check('done text', T.drafterDoneText({ moved: [{ orderNum: 'L1' }, { orderNum: 'L2' }], skipped: [{ orderNum: 'L3', reason: 'כבר לא אצל שרטט' }] }),
  'עברו ל"בנה יום עבודה": 2 הזמנות\nלא הועברו:\nL3 — כבר לא אצל שרטט');
check('done text with held batch', T.drafterDoneText({ moved: [], skipped: [], held: [5] }),
  'עברו ל"בנה יום עבודה": 0 הזמנות\nמשלוח 5 לא הועבר — המייל שלו לא יצא. לחץ "שלח שוב" ליד המשלוח.');
check('failed batch can be resent', T.drafterBarModel({ basket: [], open: [{ n: 5, at: AT, count: 2, emailState: 'failed' }, { n: 6, at: AT, count: 1, emailState: 'sent' }] }).resend, [5]);
check('done text nothing', T.drafterDoneText({ moved: [], skipped: [] }), 'אין הזמנות שנשלחו לשרטט ומחכות');

check('tag basket', T.drafterTag({ stage: 'drafter' }), 'בטיוטה לשרטט');
check('tag held', T.drafterTag({ stage: 'drafter', drafterHold: true }), 'לא לשלוח עכשיו');
check('tag chash basket', T.drafterTag({ stage: 'chash' }), 'בטיוטה לשרטט');
check('tag sent', T.drafterTag({ stage: 'drafter', drafterBatch: 7 }), 'נשלח · משלוח 7');
check('tag other stage', T.drafterTag({ stage: 'opty', drafterBatch: 7 }), '');

// ⚠️ הזמנה שעוברת דרך lgNormalizeOrder ונשמרת שוב — לא מאבדת את מספר המשלוח
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
check('lgNormalizeOrder keeps drafterBatch', /drafterBatch:\s+o\.drafterBatch\s+\?\? null/.test(SRC), true);

// בן, 10/11: הפס בתור הסקיצות (שם הוא פותח הזמנות ברצף ושולח לחשבשבת), לא במסך הראשי
const ADM = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const lp = ADM.indexOf('<div id="sqListPanel">');
check('tray sits at the bottom of the sketch-queue list', lp > 0 && ADM.indexOf('id="drafterBar"') > ADM.indexOf('<div id="sqList">'), true);
check('tray is sticky at the bottom', /\.drb\{[^}]*position:sticky;[^}]*bottom:0/.test(ADM), true);
check('only one bar on the page', ADM.split('id="drafterBar"').length - 1, 1);
check('opening the queue shows the bar', /function openSketchQueue\(\)\{[\s\S]*?lgDrafterBarShow\(true\)[\s\S]*?\n\}/.test(ADM), true);
check('sending to Hashavshevet refreshes the basket', /updateStage\(id, 'chash'\)\.then\([\s\S]{0,80}lgDrafterBarShow/.test(ADM), true);
check('status filter no longer drives the bar', /lgDrafterBarShow\(s === 'אצל שרטט'\)/.test(ADM), false);

// מגירת "טיוטה לשרטט" (בן, 10/11)
check('tray title', [T.drafterTrayTitle({ basket: [1, 2, 3, 4, 5] }), T.drafterTrayTitle({ basket: [1] }), T.drafterTrayTitle({ basket: [] })],
  ['טיוטה לשרטט · 5 הזמנות', 'טיוטה לשרטט · הזמנה אחת', 'טיוטה לשרטט · ריקה']);
check('item line', T.drafterItemLine({ orderNum: 'L12', client: 'נאור', sketchName: 'מקלחון רון' }), 'L12 · נאור · מקלחון רון');
check('added toast', T.drafterAddedToast(6), 'נכנסה לטיוטה לשרטט (6)');
check('lgNormalizeOrder keeps drafterHold', /drafterHold:\s+o\.drafterHold\s+\?\? null/.test(SRC), true);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll drafter-ui checks passed.');
