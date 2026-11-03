// פורטל (בן, 4/11): "צפוי להגיע", צור קשר לשאול, חוב ותאריך איסוף מוסתרים,
// הודעות → וואטסאפ, deliveryAt נרשם במעבר להובלה.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'portal.html'), 'utf8');
const fdb = fs.readFileSync(path.join(root, 'firebase-db.js'), 'utf8');
const deliver = fs.readFileSync(path.join(root, 'api', '_invoice-deliver.js'), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };

// lgPortalArrival + הרשימה — נשלפים מהדף ורצים כאן
const listSrc = html.match(/const LG_PORTAL_TOMORROW_ACCOUNTS = \[[^\]]*\];/)[0];
const fnSrc = html.match(/function lgPortalArrival\(o, now\)\{[\s\S]*?\n\}/)[0];
const lgPortalArrival = new Function(listSrc + '\n' + fnSrc + '\nreturn lgPortalArrival;')();

// 4/11/2026 = יום ד'. שעון ישראל UTC+2.
const T = (s) => Date.parse(s);
const dlv = (cid, at) => ({ stage: 'delivery', customerId: cid, deliveryAt: at });

ok('A1 same list as the invoice message', () => {
  const a = eval(listSrc.replace(/^const \w+ = /, ''));
  const b = eval(deliver.match(/const LG_DELIVERY_TOMORROW_ACCOUNTS = (\[[^\]]*\]);/)[1]);
  assert.deepStrictEqual(a, b);
});
ok('A2 delivery today → tomorrow shown', () => {
  const s = lgPortalArrival(dlv('9117', T('2026-11-04T08:00:00Z')), T('2026-11-04T10:00:00Z'));
  assert.ok(/^צפוי להגיע: /.test(s) && /5/.test(s), s);
});
ok('A3 next day → "היום"', () => {
  assert.strictEqual(lgPortalArrival(dlv('14201', T('2026-11-04T08:00:00Z')), T('2026-11-05T06:00:00Z')), 'מגיע אליך היום');
});
ok('A4 day passed → nothing', () => {
  assert.strictEqual(lgPortalArrival(dlv('9117', T('2026-11-04T08:00:00Z')), T('2026-11-06T06:00:00Z')), '');
});
ok('A5 Friday → skips Saturday to Sunday', () => {
  // 6/11/2026 יום ו' → א' 8/11
  const s = lgPortalArrival(dlv('9117', T('2026-11-06T08:00:00Z')), T('2026-11-07T10:00:00Z'));
  assert.ok(/8/.test(s) && !/7\./.test(s), s);
});
ok('A6 late evening Israel time counts as that Israeli day', () => {
  // 23:30 שעון ישראל ב-4/11 = 21:30Z → מחר = 5/11
  assert.strictEqual(lgPortalArrival(dlv('9117', T('2026-11-04T21:30:00Z')), T('2026-11-05T07:00:00Z')), 'מגיע אליך היום');
});
ok('A7 other customer / no deliveryAt / other stage → nothing', () => {
  const now = T('2026-11-04T10:00:00Z'), at = T('2026-11-04T08:00:00Z');
  assert.strictEqual(lgPortalArrival(dlv('509', at), now), '');
  assert.strictEqual(lgPortalArrival(dlv('9117', 0), now), '');
  assert.strictEqual(lgPortalArrival({ stage: 'done', customerId: '9117', deliveryAt: at }, now), '');
});
ok('B1 deliveryAt written when moving to delivery', () => {
  assert.ok(/if\(nextStage === 'delivery'\) update\.deliveryAt = update\.updatedAt;/.test(fdb));
});
ok('B2 portal reads customerId and deliveryAt', () => {
  assert.ok(/customerId: o\.customerId\|\| ''/.test(html) && /deliveryAt: o\.deliveryAt\|\| 0/.test(html));
});
ok('C1 contact → Shaul, no placeholder number', () => {
  assert.ok(!/972X{3,}/.test(html));
  assert.ok(/const LG_PORTAL_SHAUL_WA = '972506824365';/.test(html));
  assert.ok(/function contactUs\(\)\{window\.open\("https:\/\/wa\.me\/"\+LG_PORTAL_SHAUL_WA/.test(html));
});
ok('C2 debt hidden everywhere', () => {
  assert.ok(/const LG_PORTAL_SHOW_DEBT = false;/.test(html));
  assert.ok(/<div class="hstat" style="display:none"><div class="n" id="statDebt">/.test(html));
  assert.ok(/if\(LG_PORTAL_SHOW_DEBT && unpaid > 0\)/.test(html));
});
ok('C3 pickup date hidden', () => {
  assert.ok(/const LG_PORTAL_SHOW_PICKUP = false;/.test(html));
  assert.ok(/if\(!LG_PORTAL_SHOW_PICKUP\) return orderCard\(o\);/.test(html));
});
ok('C4 messages tab opens WhatsApp, input hidden', () => {
  assert.ok(/onclick="contactFactory\(\)"/.test(html));
  assert.ok(/#view-chat \.chat-wrap/.test(html));
});
ok('C5 quote tab hidden', () => {
  assert.ok(/id="tab-quote"[^>]*style="display:none"/.test(html));
});
console.log(`\nAll ${n} portal checks passed.`);
