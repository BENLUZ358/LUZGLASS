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
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
