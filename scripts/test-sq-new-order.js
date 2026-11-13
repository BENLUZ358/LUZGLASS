#!/usr/bin/env node
/**
 * "+ הזמנה חדשה" בתור הסקיצות — הזמנה ידנית עם טלפון לעדכונים (13/11).
 *
 * בן פותח הזמנה בעצמו: סקיצה, כרטיס חשבשבת (גם מזדמן 99 עם שם פרטי),
 * ונייד. רק "מוכן" והחשבונית יוצאים לנייד הזה. כאן נבדק:
 *   • הבדיקה לפני שמירה — מה חובה ומה ההודעה.
 *   • הרשומה שנשמרת — בלי phone, שם פרטי ב-orderClient, שם הכרטיס במחירון.
 *   • הקיבוץ ב"מוכן" ביום עבודה — אותו שם עם נייד אחר = קבוצה אחרת.
 *   • שורת המצב — נשמר / לא נשמר.
 *   • admin.html / workday.html טוענים את הקובץ, והנרמול לא מוחק את השדות.
 *
 * Run: node scripts/test-sq-new-order.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const plain = v => JSON.parse(JSON.stringify(v));

const ctx = vm.createContext({ console });
const SRC = fs.readFileSync(path.join(ROOT, 'sq-new-order.js'), 'utf8');
vm.runInContext(SRC, ctx);

const IMG = 'data:image/jpeg;base64,AAAA';
const CARD99 = { key: '99', name: 'לקוחות מזדמנים' };
const CARD = { key: '14201', name: 'המקום לאמבט' };
const full99 = { image: IMG, sketchName: 'מקלחון', acc: CARD99, privateName: 'יוסי כהן', phone: '050-123-4567', original: 'send' };

// ─── הטלפון — תאום של lgManualPhone בשרת ───────────────────────────
check('P1 dashes and spaces are dropped', ctx.sqNewOrderPhone('050-123 4567'), '0501234567');
check('P1 a leading 972 becomes 0', ctx.sqNewOrderPhone('+972501234567'), '0501234567');
check('P1 a landline is refused', ctx.sqNewOrderPhone('031234567'), '');
check('P1 too short is refused', ctx.sqNewOrderPhone('05012345'), '');

// ─── בדיקה לפני שמירה ──────────────────────────────────────────────
{
  const r = ctx.sqNewOrderValidate({ ...full99, phone: '' });
  check('V1 missing phone → errors.phone', [r.ok, typeof r.errors.phone], [false, 'string']);
}
{
  const r = ctx.sqNewOrderValidate({ ...full99, phone: '03-1234567' });
  check('V1 a landline → errors.phone', [r.ok, typeof r.errors.phone], [false, 'string']);
}
{
  const r = ctx.sqNewOrderValidate({ ...full99, privateName: '  ' });
  check('V2 card 99 without a name → errors.privateName', [r.ok, typeof r.errors.privateName], [false, 'string']);
}
{
  const r = ctx.sqNewOrderValidate({ ...full99, acc: CARD, privateName: '' });
  check('V2 a regular card needs no private name', r.ok, true);
}
{
  const r = ctx.sqNewOrderValidate({ ...full99, image: '' });
  check('V3 no sketch → errors.image', [r.ok, typeof r.errors.image], [false, 'string']);
}
{
  const r = ctx.sqNewOrderValidate({ ...full99, acc: null });
  check('V3 no card → errors.acc', [r.ok, typeof r.errors.acc], [false, 'string']);
}
check('V4 a full valid form → ok, no errors', plain(ctx.sqNewOrderValidate(full99)), { ok: true, errors: {} });
check('V5 the messages are Hebrew, no English words',
      Object.values(plain(ctx.sqNewOrderValidate({})).errors).some(m => /[A-Za-z]/.test(m)), false);

// ─── הרשומה ────────────────────────────────────────────────────────
{
  const r = plain(ctx.sqNewOrderRecord(full99, 'L1300'));
  check('R1 card 99 → orderClient is the private name', r.orderClient, 'יוסי כהן');
  check('R1 client too', r.client, 'יוסי כהן');
  check('R1 priceClient is the card name', r.priceClient, 'לקוחות מזדמנים');
  check('R1 privateName is kept', r.privateName, 'יוסי כהן');
  check('R1 customerId is the card key', r.customerId, '99');
  check('R1 there is no phone key', ['phone', 'clientPhone'].some(k => k in r), false);
  check('R1 source manual, stage empty, order number', [r.source, r.stage, r.orderNum], ['manual', '', 'L1300']);
  check('R1 the phone sits only in manualNotify, normalised', r.manualNotify, { phone: '0501234567', original: 'send' });
  check('R1 the sketch goes through saveOrder', r.sketch, IMG);
  check('R1 sketch name', r.sketchName, 'מקלחון');
}
{
  const r = plain(ctx.sqNewOrderRecord({ ...full99, acc: CARD, privateName: 'לא אמור להיכנס' }, 'L1301'));
  check('R2 card 14201 → orderClient is the card name', r.orderClient, 'המקום לאמבט');
  check('R2 businessName is the card name', r.businessName, 'המקום לאמבט');
  check('R2 no privateName on a regular card', r.privateName || '', '');
}
{
  const r = plain(ctx.sqNewOrderRecord({ ...full99, original: undefined }, 'L1302'));
  check('R3 default original is send', r.manualNotify.original, 'send');
  check('R3 default original in the form too', vm.runInContext('SQ_NEW_ORDER_DEFAULT_ORIGINAL', ctx), 'send');
  const p = plain(ctx.sqNewOrderRecord({ ...full99, original: 'paper' }, 'L1303'));
  check('R3 paper is kept', p.manualNotify.original, 'paper');
}

// ─── שורת המצב ─────────────────────────────────────────────────────
const mo = { source: 'manual', manualNotify: { phone: '0501234567', original: 'send' } };
check('S1 saved → ok', ctx.sqManualStatus(mo, true), 'ok');
check('S1 not saved → missing', ctx.sqManualStatus(mo, false), 'missing');
check('S1 no manualNotify → missing even if saved', ctx.sqManualStatus({ source: 'manual' }, true), 'missing');
check('S2 the line text', ctx.sqManualLine(mo), '📱 עדכונים ל-050-1234567 · מקור: לנייד');
check('S2 paper', ctx.sqManualLine({ manualNotify: { phone: '0501234567', original: 'paper' } }), '📱 עדכונים ל-050-1234567 · מקור: הדפסה');

// ─── קיבוץ "מוכן" ביום עבודה ───────────────────────────────────────
{
  const a = { orderClient: 'יוסי כהן', source: 'manual', manualNotify: { phone: '0501111111' } };
  const b = { orderClient: 'יוסי כהן', source: 'manual', manualNotify: { phone: '0502222222' } };
  check('W1 same name, different phones → different groups', ctx.wdReadyGroupKey(a) !== ctx.wdReadyGroupKey(b), true);
  check('W2 a non-manual order → orderClient + "|"', ctx.wdReadyGroupKey({ orderClient: 'אגן ברזל', source: 'whatsapp' }), 'אגן ברזל|');
  check('W2 a non-manual order ignores a stray manualNotify',
        ctx.wdReadyGroupKey({ orderClient: 'אגן ברזל', manualNotify: { phone: '0501111111' } }), 'אגן ברזל|');
}

// ─── הדפים ─────────────────────────────────────────────────────────
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
check('H1 admin.html loads sq-new-order.js', /<script src="sq-new-order\.js(?:\?v=[^"<>]+)?"><\/script>/.test(A), true);
check('H1 admin.html has the button', /id="sqBtnNewOrder"/.test(A), true);
check('H2 the button text', />\s*\+ הזמנה חדשה\s*</.test(A), true);
check('H3 the queue items carry the manual fields',
      /manualNotify:\s*o\.manualNotify/.test(A) && /manualNotifySaved:\s*!!o\.manualNotifySaved/.test(A), true);
check('H3 and the price card name', /priceClient:\s*o\.priceClient/.test(A), true);
check('H4 a "ידנית" tag in the list', /source==='manual'[^\n]*ידנית/.test(A), true);
check('H5 a place for the status line under the assign box', /id="sqAssignWrap"[^\n]*\n[^\n]*\n?\s*<div id="sqManualWrap" hidden><\/div>/.test(A), true);
check('H5 and the detail view fills it', /sqManualShow\(o\)/.test(A), true);

const W = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
check('H6 workday loads sq-new-order.js', /<script src="sq-new-order\.js(?:\?v=[^"<>]+)?"><\/script>/.test(W), true);
const grp = (W.match(/async function _waSendReadyGrouped[\s\S]*?\n}/) || [''])[0];
check('H6 ready grouping keys on wdReadyGroupKey', /const k = wdReadyGroupKey\(o\b/.test(grp), true);
check('H6 the toast still shows the client name, not the key', /nameOf\.get\(client\)/.test(grp) && !/\+ client \+/.test(grp), true);

// ─── הנרמול לא מוחק את השדות ───────────────────────────────────────
{
  const F = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const body = (F.match(/function lgNormalizeOrder[\s\S]*?\n}/) || [''])[0];
  const c2 = vm.createContext({ console });
  vm.runInContext('function lgStatusToStage(s){return s||"";} function lgStageToStatus(s){return s;}\n' + body, c2);
  const n = plain(c2.lgNormalizeOrder({ id: 'ord_1', source: 'manual', priceClient: 'לקוחות מזדמנים', privateName: 'יוסי כהן',
                                       manualNotify: { phone: '0501234567', original: 'paper' }, manualNotifySaved: true }));
  check('N1 the normaliser carries priceClient', n.priceClient, 'לקוחות מזדמנים');
  check('N1 privateName', n.privateName, 'יוסי כהן');
  check('N1 manualNotify', n.manualNotify, { phone: '0501234567', original: 'paper' });
  check('N1 manualNotifySaved', n.manualNotifySaved, true);
  const e = plain(c2.lgNormalizeOrder({ id: 'ord_2' }));
  check('N2 ordinary order → empty defaults', [e.priceClient, e.privateName, e.manualNotify, e.manualNotifySaved], ['', '', null, false]);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll new-manual-order checks passed.');
