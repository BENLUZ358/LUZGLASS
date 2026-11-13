'use strict';
// הזמנה ידנית עם טלפון לעדכונים — רשומה מהימנה בצד השרת (waMeta/manualOrders/<orderId>)
// Run: node scripts/test-manual-order.js
const assert = require('node:assert/strict');
const { fakeDb } = require('./_fake-db');
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x@y', private_key: 'k' });

const M = require('../api/_manual-order');
const { handleAdmin } = require('../api/wa-inbound-drain');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }
const mk = () => fakeDb({
  hashavshevetAccounts: { '99': { name: 'מזדמן' }, '3150': { name: 'אגן ברזל' } },
  orders: {
    m99: { source: 'manual', customerId: '99' },
    m31: { source: 'manual', customerId: '3150' },
    w1: { source: 'whatsapp', customerId: '3150' },
    mx: { source: 'manual', customerId: '777' },
  },
});
const run = (db, body) => handleAdmin({ action: 'manual-order-set', ...body }, { db, by: '0500000000', now: 1 });

(async () => {
  await test('lgManualPhone normalizes', () => {
    assert.equal(M.lgManualPhone('054-800-0775'), '0548000775');
    assert.equal(M.lgManualPhone('+972548000775'), '0548000775');
    assert.equal(M.lgManualPhone('03-1234567'), '');
  });
  await test('set on manual order with key 99', async () => {
    const db = mk();
    const r = await run(db, { orderId: 'm99', phone: '054-800-0775', original: 'send', privateName: 'יוסי כהן' });
    assert.equal(r.ok, true);
    const rec = db._data.waMeta.manualOrders.m99;
    assert.equal(rec.phone, '0548000775'); assert.equal(rec.customerId, '99');
    assert.equal(rec.privateName, 'יוסי כהן'); assert.equal(rec.original, 'send');
    assert.equal(rec.at, 1); assert.equal(rec.by, '0500000000');
    const got = await M.lgManualOrderRec(db, 'm99');
    assert.equal(got.phone, '0548000775'); assert.equal(got.customerId, '99');
  });
  await test('default original is send', async () => {
    const db = mk();
    const r = await run(db, { orderId: 'm31', phone: '0548000775' });
    assert.equal(r.ok, true); assert.equal(db._data.waMeta.manualOrders.m31.original, 'send');
  });
  await test('need-name for 99 without name', async () => {
    const r = await run(mk(), { orderId: 'm99', phone: '0548000775', original: 'send', privateName: '' });
    assert.equal(r.code, 'need-name');
  });
  await test('rejections', async () => {
    assert.equal((await run(mk(), { orderId: 'w1', phone: '0548000775', original: 'send' })).code, 'bad-order');
    assert.equal((await run(mk(), { orderId: 'nope', phone: '0548000775' })).code, 'bad-order');
    assert.equal((await run(mk(), { orderId: 'a.b', phone: '0548000775' })).code, 'bad-order');
    assert.equal((await run(mk(), { orderId: 'm31', phone: '0548000775', original: 'x' })).code, 'bad-original');
    assert.equal((await run(mk(), { orderId: 'm31', phone: '123', original: 'send' })).code, 'bad-phone');
    assert.equal((await run(mk(), { orderId: 'mx', phone: '0548000775' })).code, 'unknown-customer');
  });
  await test('lgManualOrderRec null for bad id / missing', async () => {
    const db = mk();
    assert.equal(await M.lgManualOrderRec(db, 'a/b'), null);
    assert.equal(await M.lgManualOrderRec(db, 'a.b'), null);
    assert.equal(await M.lgManualOrderRec(db, 'm31'), null);
    assert.deepEqual(M.LG_MANUAL_KINDS, ['ready', 'invoice']);
  });
  await test('recipient for manual orders', async () => {
    const R = require('../api/_wa-recipient');
    const db = fakeDb({
      hashavshevetAccounts: { '99': { name: 'מזדמן', phone: '0501111111' } },
      waMeta: { manualOrders: { m99: { phone: '0548000775', original: 'send', customerId: '99', privateName: 'יוסי' } },
                invoiceToPrivate: { '99': { phone: '0522222222' } } },
    });
    const o = { id: 'm99', source: 'manual', customerId: '99' };
    for (const fn of [R.resolveRecipientWa, R.resolveRecipient]) {
      const a = await fn(db, o, 'ready');
      assert.equal(a.phone, '0548000775'); assert.equal(a.source, 'manual-phone');
      assert.equal(a.accountKey, '99'); assert.equal(a.linked, true); assert.equal(a.channel, 'whatsapp');
      assert.equal((await fn(db, o, 'invoice')).phone, '0548000775');
      const b = await fn(db, o, 'received');
      assert.equal(b.phone, ''); assert.equal(b.source, 'manual-kind-blocked'); assert.equal(b.linked, false);
      const c = await fn(db, { id: 'nr', source: 'manual', customerId: '99' }, 'ready');
      assert.equal(c.phone, ''); assert.equal(c.source, 'manual-missing'); assert.equal(c.linked, false);
    }
  });
  await test('hashavshevet: account key + price key + private name', async () => {
    const H = require('../api/hashavshevet-order');
    const db = fakeDb({
      hashavshevetAccounts: { '99': { name: 'מזדמן' } },
      users: { '0548000775': { customerId: '14201' } },
      waMeta: { manualOrders: { m99: { phone: '0548000775', original: 'send', customerId: '99', privateName: 'יוסי כהן' } } },
    });
    const o = { id: 'm99', source: 'manual', customerId: '99', phone: '' };
    assert.equal(await H.pickAccountKey(db, o), '99');
    assert.equal(await H.pickAccountKey(db, { id: 'nr', source: 'manual', customerId: '99', phone: '' }), null);
    assert.equal(await H.pickAccountKey(db, { id: 'w', phone: '0548000775' }), '14201');
    assert.equal(H.lgPriceClientName({ priceClient: 'א', orderClient: 'ב' }), 'א');
    assert.equal(H.lgPriceClientName({ orderClient: 'ב' }), 'ב');
    const prices = { global: { '8SMH': 190 }, clients: { '99': { '8SMH': 111 } }, clientKeys: { '99': 'מזדמן' } };
    const cp = H.clientPricesByName(prices);
    const ord = { source: 'manual', priceClient: 'מזדמן', orderClient: 'יוסי כהן', privateName: 'יוסי כהן',
      sketchName: 'א'.repeat(45), items: [{ sku: '8SMH', w: 1000, h: 1000, glassFullName: '8 מ"מ שקוף מחוסם' }] };
    const r = H.buildLines(ord, '99', '1', '31', '1', prices.global, cp);
    assert.equal(r.lines[0].price, '111.000');
    assert.ok(r.lines[0].itemname.includes('יוסי כהן'));
    assert.ok(r.lines[0].itemname.length <= 50, r.lines[0].itemname);
    const r2 = H.buildLines({ ...ord, sketchName: '' }, '99', '1', '31', '1', prices.global, cp);
    assert.equal(r2.lines[0].itemname, '8 מ"מ שקוף מחוסם יוסי כהן');
    const r3 = H.buildLines({ ...ord, source: 'whatsapp', privateName: '', sketchName: '' }, '99', '1', '31', '1', prices.global, cp);
    assert.equal(r3.lines[0].itemname, undefined);
  });
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
