#!/usr/bin/env node
//  "מוכן" למספר קבוע לכרטיס (בן, 25/11 — פלג מקלחונים, לקוח הובלות שמזמין במייל).
//  Run: node scripts/test-ready-to.js
const assert = require('assert');
const fs = require('fs'), path = require('path');
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x@y', private_key: 'k' });
['WA_PROVIDER', 'GREENAPI_TOKEN', 'GREENAPI_ID_INSTANCE'].forEach(k => delete process.env[k]);
const { fakeDb } = require('./_fake-db');
const R = require('../api/_wa-recipient');
const N = require('../api/_ready-net');
const handler = require('../api/whatsapp-dispatch');

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log('ok ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + '\n   ' + (e && e.message)); }
};
const PH = '0500000001';
const base = () => ({
  waMeta: { readyTo: { '07': { phone: PH } },
            emailSenders: { 'a@b,co': { email: 'a@b.co', customerId: '07', customerName: 'פלג' } } },
  hashavshevetAccounts: { '07': { key: '07', name: 'פלג מקלחונים' }, '20': { key: '20', name: 'אחר', phone: '0500000002' } },
  orders: {
    p1: { id: 'p1', customerId: '07', orderClient: 'פלג מקלחונים', orderNum: 'L1-1', stage: 'delivery', deliveryAt: 1,
          source: 'email', emailThreadId: 't', emailMessageId: 'm', emailFrom: 'a@b.co' },
    p2: { id: 'p2', customerId: '07', orderClient: 'פלג מקלחונים', orderNum: 'L2-1', stage: 'chisum' },
    x1: { id: 'x1', customerId: '20', orderClient: 'אחר', orderNum: 'L3-1', stage: 'delivery' },
    x2: { id: 'x2', customerId: '20', orderClient: 'אחר', orderNum: 'L4-1', stage: 'done' },
  },
});
const call = async (db, body) => {
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: 'POST', headers: {}, body }, res, { db, auth: { ok: true, phone: 't' } });
  return out;
};

(async () => {
  await test('R1 ready → fixed number, even for a linked-email order', async () => {
    const db = fakeDb(base());
    const r = await R.resolveRecipient(db, base().orders.p1, 'ready');
    assert.deepStrictEqual([r.channel, r.phone, r.source, r.accountKey, r.linked], ['whatsapp', PH, 'ready-to', '07', true]);
  });
  await test('R2 other kinds unchanged (invoice still email), other cards unchanged', async () => {
    const db = fakeDb(base());
    assert.strictEqual((await R.resolveRecipient(db, base().orders.p1, 'invoice')).channel, 'email');
    assert.notStrictEqual((await R.resolveRecipientWa(db, base().orders.x2, 'ready')).source, 'ready-to');
  });
  await test('R3 drain (resolveRecipientWa) uses the same number', async () => {
    const r = await R.resolveRecipientWa(fakeDb(base()), base().orders.p2, 'ready');
    assert.strictEqual(r.phone, PH);
  });
  await test('D1 onlyReadyTo: Peleg goes to the number, other delivery client skipped', async () => {
    const db = fakeDb(base());
    const a = await call(db, { kind: 'ready', orderIds: ['p1'], onlyReadyTo: true });
    assert.strictEqual(a.status, 200); assert.strictEqual(a.body.to, PH); assert.strictEqual(a.body.phoneSource, 'ready-to');
    const b = await call(db, { kind: 'ready', orderIds: ['x1'], onlyReadyTo: true });
    assert.strictEqual(b.body.reason, 'אין הזמנות לשליחה');
  });
  await test('D2 delivery-stage order without a fixed number never gets "ready"; done order still does', async () => {
    const db = fakeDb(base());
    const b = await call(db, { kind: 'ready', orderIds: ['x1'] });
    assert.strictEqual(b.body.reason, 'אין הזמנות לשליחה');
    const c = await call(db, { kind: 'ready', orderIds: ['x2'] });
    assert.strictEqual(c.body.to, '0500000002');
  });
  await test('D3 already sent → not again', async () => {
    const d = base(); d.orders.p1.whatsapp = { sentAt: 5 };
    const a = await call(fakeDb(d), { kind: 'ready', orderIds: ['p1'], onlyReadyTo: true });
    assert.strictEqual(a.body.reason, 'אין הזמנות לשליחה');
  });
  await test('N1 safety net picks a delivery order only for a fixed-number card, by deliveryAt', async () => {
    const NOW = 10 * 60e3;
    const o = { a: { stage: 'delivery', customerId: '07', orderClient: 'פלג', deliveryAt: NOW - 2 * 60e3 },
                b: { stage: 'delivery', customerId: '20', orderClient: 'אחר', deliveryAt: NOW - 2 * 60e3 },
                c: { stage: 'done', customerId: '20', orderClient: 'אחר2', readyAt: NOW - 2 * 60e3 } };
    const ids = g => g.map(x => x.ids.join()).sort();
    assert.deepStrictEqual(ids(N.lgReadyNetPick(o, NOW, new Set(), {}, 0, new Set(['07']))), ['a', 'c']);
    assert.deepStrictEqual(ids(N.lgReadyNetPick(o, NOW, new Set(), {}, 0)), ['c']);
  });
  await test('P1 page: ready-watch also on delivery; workday sends onlyReadyTo for delivery', async () => {
    const F = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
    assert.ok(/nextStage === 'done' \|\| nextStage === 'delivery'\) && typeof _lgAuthPost/.test(F));
    const W = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
    assert.strictEqual((W.match(/onlyReadyTo: true \}\)/g) || []).length, 3);
  });
  console.log(fail ? fail + ' FAILED' : 'all passed (' + pass + ')'); process.exit(fail ? 1 : 0);
})();
