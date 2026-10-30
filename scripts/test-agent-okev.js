#!/usr/bin/env node
/**
 * עוקב — מציאת הזמנה ונוסח תשובה (מצב שקט, בלי DB).
 * Run:  node scripts/test-agent-okev.js
 */
const path = require('path');
const okev = require(path.join(__dirname, '..', 'api', '_agent-okev.js'));
const { OKEV_STATUS_TEXT, lgOkevCanChange, lgOkevFind, lgOkevReply, lgOkevRoute, AGENT_MENU_TEXT } = okev;
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const o = (id, orderNum, sketchName, stage, extra) => Object.assign({ id, orderNum, refNum: orderNum, sketchName, stage, waMessageId: 'W' + id, customerId: 'c1' }, extra || {});

// ── lgOkevCanChange ──
for (const s of ['', 'pending', 'chash', 'drafter', 'opty']) check('canChange ' + JSON.stringify(s), lgOkevCanChange({ stage: s }), true);
for (const s of ['workday', 'chisum', 'graphic', 'delivery', 'done', 'collected']) check('canChange ' + s, lgOkevCanChange({ stage: s }), false);
check('canChange בלי stage', lgOkevCanChange({}), true);

// ── טבלת סטטוס ──
check('status table', OKEV_STATUS_TEXT, {
  '': 'קיבלנו, ההזמנה בבדיקה', pending: 'קיבלנו, ההזמנה בבדיקה',
  chash: 'ההזמנה בהכנה', drafter: 'ההזמנה בהכנה', opty: 'ההזמנה בהכנה',
  workday: 'ההזמנה בייצור', chisum: 'ההזמנה בחיסום', graphic: 'ההזמנה בגרפיקה',
  delivery: 'מוכן, יוצא אליך במשלוח', done: 'מוכן, אפשר לבוא לאסוף', collected: 'ההזמנה כבר נאספה',
});

// ── lgOkevFind ──
const kohen = o('1', 'L1234', 'מטבח כהן', 'chisum');
const levi = o('2', 'L5678', 'אמבטיה לוי', 'workday');
const old = o('3', 'L9999', 'סלון', 'collected', { waMessageId: 'ABC' });
const gone = o('4', 'L1111', 'מבוטלת', 'pending', { agentCancelled: true });

let f = lgOkevFind([kohen, levi, old], { quotedId: 'ABC' });
check('quoted גם collected', [f.match, f.via, f.orders.map(x => x.id)], ['one', 'quoted', ['3']]);
f = lgOkevFind([kohen, levi, old], { quotedId: 'ABC', ref: 'כהן' });
check('quoted גובר על ref', [f.match, f.via, f.orders[0].id], ['one', 'quoted', '3']);
f = lgOkevFind([kohen, levi], { ref: 'כהן' });
check('ref טקסט includes', [f.match, f.via, f.orders[0].id], ['one', 'ref', '1']);
f = lgOkevFind([kohen, levi], { ref: '1234' });
check('ref מספר 1234', [f.match, f.orders[0].id], ['one', '1']);
f = lgOkevFind([kohen, levi], { ref: 'L1234' });
check('ref מספר L1234', [f.match, f.orders[0].id], ['one', '1']);
f = lgOkevFind([kohen, levi], { ref: ' l 1234 ' });
check('ref l 1234 עם רווחים', [f.match, f.orders[0].id], ['one', '1']);
f = lgOkevFind([kohen, levi], { ref: '123' });
check('R1: ספרות מדויקות, 123 לא תואם 1234', f.match, 'none');
f = lgOkevFind([kohen, levi], { ref: '234' });
check('R1: 234 לא תואם 1234', f.match, 'none');
f = lgOkevFind([kohen, levi], { ref: 'ה' });
check('R1: טקסט קצר מ-2 לא תואם', f.match, 'none');
f = lgOkevFind([o('5', 'L1', 'מטבח כהן', 'opty'), o('6', 'L2', 'כהן שני', 'pending')], { ref: 'כהן' });
check('ref לשתי פתוחות → many', [f.match, f.orders.length], ['many', 2]);
f = lgOkevFind([kohen], { ref: 'מטבח כהן' });
check('ref equal', f.match, 'one');
f = lgOkevFind([kohen], { ref: 'מטבח "כהן"' });
check('ref עם גרשיים מנורמל', f.match, 'one');
f = lgOkevFind([kohen], {});
check('open אחת', [f.match, f.via], ['one', 'open']);
f = lgOkevFind([kohen, levi, old, gone], {});
check('open שתיים (בלי collected ובלי agentCancelled)', [f.match, f.via, f.orders.length], ['many', 'open', 2]);
f = lgOkevFind([old, gone], {});
check('open אפס', [f.match, f.via, f.orders.length], ['none', '', 0]);
f = lgOkevFind([gone], { ref: 'מבוטלת' });
check('agentCancelled לא נמצאת גם לפי ref', f.match, 'none');
f = lgOkevFind([old], { ref: 'סלון' });
check('ref מוצא גם collected כשאין פתוחה', [f.match, f.orders[0].id], ['one', '3']);
f = lgOkevFind([], { quotedId: 'X' });
check('quoted לא קיים → none', f.match, 'none');
// ציטוט של הודעה שלא שייכת לאף הזמנה של הלקוח → ממשיכים ל-ref ואז לפתוחות
f = lgOkevFind([kohen, levi, old], { quotedId: 'NOPE', ref: 'לוי' });
check('quoted לא תואם → נופל ל-ref', [f.match, f.via, f.orders.map(x => x.id)], ['one', 'ref', ['2']]);
f = lgOkevFind([kohen, old], { quotedId: 'NOPE' });
check('quoted לא תואם, בלי ref → הפתוחות', [f.match, f.via, f.orders.map(x => x.id)], ['one', 'open', ['1']]);
f = lgOkevFind([kohen, levi], { quotedId: 'NOPE', ref: 'אין כזה' });
check('quoted ו-ref לא תואמים → none', [f.match, f.via], ['none', '']);

// ── lgOkevReply ──
const one = st => ({ match: 'one', orders: [o('1', 'L1234', 'כהן', st)], via: 'ref' });
check('reply status chisum', lgOkevReply('status', one('chisum')), 'הזמנה L1234 (סקיצה: כהן): ההזמנה בחיסום');
check('reply status done', lgOkevReply('status', one('done')), 'הזמנה L1234 (סקיצה: כהן): מוכן, אפשר לבוא לאסוף');
const many = { match: 'many', orders: [o('1', 'L1234', 'כהן', 'opty'), o('2', 'L5678', 'לוי', 'pending')], via: 'open' };
check('reply status many', lgOkevReply('status', many), 'על איזו הזמנה מדובר?\n1. L1234 — כהן\n2. L5678 — לוי');
check('reply status none', lgOkevReply('status', { match: 'none', orders: [], via: '' }), 'לא מצאתי את ההזמנה. אפשר לכתוב את שם הסקיצה?');
check('reply cancel none', lgOkevReply('cancel', { match: 'none', orders: [], via: '' }), 'לא מצאתי את ההזמנה. אפשר לכתוב את שם הסקיצה?');
check('reply cancel many מתחיל בשאלה', lgOkevReply('cancel', many).startsWith('על איזו הזמנה מדובר?'), true);
check('reply cancel opty', lgOkevReply('cancel', one('opty')), 'בטוח לבטל את הזמנה L1234 (סקיצה: כהן)?');
check('reply cancel workday', lgOkevReply('cancel', one('workday')), 'הזמנה L1234 כבר בייצור ואי אפשר לבטל או לשנות אותה');
check('reply change drafter', lgOkevReply('change', one('drafter')), 'מה בדיוק לשנות בהזמנה L1234 (סקיצה: כהן)?');
check('reply change done', lgOkevReply('change', one('done')), 'הזמנה L1234 כבר בייצור ואי אפשר לבטל או לשנות אותה');

// ── lgOkevRoute ──
const rt = (intent, extra) => lgOkevRoute(Object.assign({ intent, isGroup: false, linked: true, humanQuiet: false }, extra || {}));
check('route לא מקושר', rt('status', { linked: false }), 'shaul');
check('route humanQuiet', rt('status', { humanQuiet: true }), 'silent-human');
for (const i of ['status', 'cancel', 'change']) check('route ' + i, rt(i), 'okev');
check('route order', rt('order'), 'kolet');
check('route document', rt('document'), 'archive');
check('route quote', rt('quote'), 'quote');
check('route chitchat פרטי', rt('chitchat'), 'menu');
check('route chitchat קבוצה', rt('chitchat', { isGroup: true }), 'ignore');
check('route thanks', rt('thanks'), 'none');
check('route unclear', rt('unclear'), 'shaul');

// ── תפריט ──
check('menu', AGENT_MENU_TEXT, [
  "הצ'אט הזה מיועד לעבודה בלבד. אפשר:",
  '1. לבדוק איפה הזמנה', '2. לבטל או לשנות הזמנה', '3. לקבל חשבונית או סקיצה',
  '4. לקבל הצעת מחיר', '5. לשלוח הזמנה חדשה', 'לכל דבר אחר: שאול, 050-6824365',
].join('\n'));

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall ok');
