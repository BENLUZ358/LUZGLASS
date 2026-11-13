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
  //  ── חשבונית: נייד או מקור על נייר ──
  const { PDFDocument } = require('pdf-lib');
  const { createCanvas } = require('@napi-rs/canvas');
  const D = require('../api/_invoice-deliver');
  const { handleUpload } = require('../api/_invoice-upload');
  const d0 = await PDFDocument.create(); d0.addPage([595, 842]);
  const PDF = Buffer.from(await d0.save()).toString('base64');
  const cv = createCanvas(40, 30); cv.getContext('2d').fillRect(0, 0, 40, 30);
  const JPG = 'data:image/jpeg;base64,' + cv.toBuffer('image/jpeg').toString('base64');
  const GROUP = '120363000000000001@g.us';
  const invDb = (orders, manual) => fakeDb({
    invoicePdf: { k1: { state: 'ready', docNumber: '67346', date: '2026-11-13', client: 'מזדמן', accountKey: '99',
      orderIds: Object.keys(orders), orderNums: Object.keys(orders).map((_, i) => 'L' + (i + 1)), sketchNames: [],
      archivePath: '2026/11/x/f.pdf' } },
    invoicePdfBlobs: { k1: { original: PDF, copy: PDF } },
    orders, sketches: { m99: JPG, g1: JPG },
    waGroups: { [GROUP.replace(/[.#$[\]/]/g, '_')]: { customerId: '99' } },
    waMeta: { manualOrders: manual },
  });
  const MAN = { m99: { source: 'manual', customerId: '99', orderNum: 'L1' } };
  const noDrain = async () => ({ results: [] });
  const noQueue = db => assert.ok(!db._data.waOutbox || !Object.keys(db._data.waOutbox).length);
  await test('manual send: queued to the trusted phone, deliveryTomorrow false', async () => {
    const db = invDb(MAN, { m99: { phone: '0548000775', original: 'send', customerId: '99' } });
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: noDrain });
    assert.equal(r.state, 'queued');
    const q = Object.values(db._data.waOutbox);
    assert.equal(q.length, 1);
    assert.equal(q[0].to, '0548000775'); assert.equal(q[0].kind, 'invoice'); assert.equal(q[0].deliveryTomorrow, false);
  });
  await test('manual paper: state paper, nothing queued, reprint does not send', async () => {
    const db = invDb(MAN, { m99: { phone: '0548000775', original: 'paper', customerId: '99' } });
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: noDrain });
    assert.equal(r.state, 'paper'); assert.equal(db._data.invoicePdf.k1.delivery.state, 'paper');
    noQueue(db);
    db._data.waMeta.manualOrders.m99.original = 'send';
    const r2 = await D.lgInvoiceDeliver(db, 'k1', { now: 6, drain: noDrain });
    assert.equal(r2.state, 'paper'); noQueue(db);
  });
  await test('manual without a record: paper', async () => {
    const db = invDb(MAN, {});
    assert.equal((await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: noDrain })).state, 'paper');
    noQueue(db);
  });
  await test('manual send + whatsapp group order on one invoice: only the trusted phone', async () => {
    const db = invDb({ ...MAN, g1: { source: 'whatsapp', waGroup: GROUP, waMessageId: 'w1', customerId: '99', orderNum: 'L2' } },
      { m99: { phone: '0548000775', original: 'send', customerId: '99' } });
    await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: noDrain });
    const q = Object.values(db._data.waOutbox);
    assert.equal(q.length, 1); assert.equal(q[0].to, '0548000775');
  });
  await test('lgManualInvoiceMode', async () => {
    const db = invDb(MAN, { m99: { phone: '0548000775', original: 'send', customerId: '99' }, p: { phone: '0548000775', original: 'paper' } });
    assert.equal(await M.lgManualInvoiceMode(db, [{ source: 'whatsapp' }]), null);
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'm99', source: 'manual' }]), 'send');
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'm99', source: 'manual' }, { id: 'p', source: 'manual' }]), 'paper');
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'zz', source: 'manual' }]), 'paper');
  });
  const TOKEN = 't'.repeat(40);
  const PRINT = role => 'חשבונית מס 67400  תאריך 13/11/2026  מפתח 99  מזהה 348049  מזדמן  '
    + `8 מ''מ שקוף מחוסם 1115.00 0.00 120.00   1115 1.00 1.00   1.00   1  ` + role;
  const upl = async (original, db0) => {
    const t = { [Buffer.from('%PDF-1.4 o').toString()]: PRINT('מקור'), [Buffer.from('%PDF-1.4 c').toString()]: PRINT('העתק 1') };
    const db = db0 || fakeDb({ orders: { m1: { source: 'manual', customerId: '99', orderNum: 'L1115', orderClient: 'מזדמן', clientPhone: '',
        hashavshevet: { httpOk: true, accountKey: '99', reference: '1115' } } },
      waMeta: { manualOrders: { m1: { phone: '0548000775', original, customerId: '99' } } } });
    return handleUpload({ method: 'POST', headers: { authorization: 'Bearer ' + TOKEN }, body: {
      original: Buffer.from('%PDF-1.4 o').toString('base64'), copy: Buffer.from('%PDF-1.4 c').toString('base64') } },
      { db, env: { INVOICE_UPLOAD_TOKEN: TOKEN }, now: 1000, deliver: async () => {}, pageTexts: async b => [t[b.toString()] || ''] });
  };
  await test('upload byOrders: printOriginal true only for paper', async () => {
    const a = await upl('paper'); assert.equal(a.status, 200); assert.equal(a.body.byOrders, true); assert.equal(a.body.printOriginal, true);
    const b = await upl('send'); assert.equal(b.status, 200); assert.ok(!b.body.printOriginal);
  });
  await test('upload retry (same file) keeps printOriginal; flag on read error', async () => {
    const first = await upl('paper');
    assert.equal(first.body.printOriginal, true);
    //  אותו קובץ שוב על אותו db: מסלול ההעלאה החוזרת
    const db = fakeDb({ orders: { m1: { source: 'manual', customerId: '99', orderNum: 'L1115', orderClient: 'מזדמן', clientPhone: '',
        hashavshevet: { httpOk: true, accountKey: '99', reference: '1115' } } },
      waMeta: { manualOrders: { m1: { phone: '0548000775', original: 'paper', customerId: '99' } } } });
    const a = await upl('paper', db), b = await upl('paper', db);
    assert.equal(a.body.byOrders, true); assert.equal(b.body.duplicate, true); assert.equal(b.body.printOriginal, true);
    const bad = { ref: () => ({ once: async () => { throw new Error('boom'); } }) };
    assert.deepEqual(await require('../api/_invoice-upload').printFlag(bad, ['m1']), { printOriginal: true });
    assert.deepEqual(await require('../api/_invoice-upload').printFlag(db, []), {});
  });
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
