#!/usr/bin/env node
/**
 * לקוח הובלות לפי מפתח כרטיס (בן, 9/11): הזמנות מייל של אביבי (450) נפתחות בלי
 * טלפון — לפי הטלפון בלבד הן היו עוברות ל"מוכן לאיסוף" עם הודעה במקום להובלות.
 * Run: node scripts/test-delivery-by-account.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const WD  = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
const ADM = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };

const fn = WD.match(/function _isDeliveryClient\(orderClient, phone, customerId\)\{[\s\S]*?\n\}/);
check('helper found', !!fn, true);
const ctx = { _deliveryPhones: new Set(['0528322277']), _deliveryAccounts: new Set(['450']) };
vm.createContext(ctx); vm.runInContext(fn[0] + '\nthis.f = _isDeliveryClient;', ctx);
check('by phone, as before', ctx.f('x', '052-832-2277', ''), true);
check('email order, no phone, delivery card → delivery', ctx.f('אביבי', '', '450'), true);
check('no phone, regular card → not delivery', ctx.f('פלג', '', '07'), false);
check('nothing → not delivery', ctx.f('', '', ''), false);
check('every call site passes the card', (WD.match(/_isDeliveryClient\(o\.orderClient, o\.phone\)/g) || []).length, 0);
check('call sites with the card', (WD.match(/_isDeliveryClient\(o\.orderClient, o\.phone, o\.customerId\)/g) || []).length, 12);
check('cards loaded from users with isDelivery', /_deliveryAccounts = new Set\(\s*users\s*\.filter\(u => u\.isDelivery && u\.customerId\)/.test(WD), true);

const pf = ADM.match(/async function _propagateDeliveryToOrders[\s\S]*?\n\}/)[0];
const actx = { orders: [], updates: [], showToast() {}, console,
  getAllOrders: async () => actx.orders, updateOrder: async (id, p) => { actx.updates.push([id, p.deliveryClient]); } };
vm.createContext(actx); vm.runInContext(pf + '\nthis.p = _propagateDeliveryToOrders;', actx);
actx.orders = [
  { id: 'a', customerId: '450', stage: 'workday' },          // מייל, פתוחה → מסומנת
  { id: 'b', customerId: '450', stage: 'done' },             // כבר מוכנה → לא נוגעים
  { id: 'c', customerId: '07',  stage: 'workday' },          // כרטיס אחר
  { id: 'd', phone: '0528322277', stage: 'collected' },      // לפי טלפון — כמו קודם, כולל ישנות
  { id: 'e', customerId: '450', stage: '', deliveryClient: true },   // כבר מסומנת
];
actx.p('0528322277', true, '450').then(n => {
  check('propagate: open orders of the card + phone matches', actx.updates, [['a', true], ['d', true]]);
  check('propagate: count', n, 2);
  check('toggle passes the card', /_propagateDeliveryToOrders\(user\.phone, true, user\.customerId\)/.test(ADM), true);
  console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
});
