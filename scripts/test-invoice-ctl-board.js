'use strict';
// חשבונית בחלון ההזמנה בלוח (בן, 19/11) — /api/invoice-ctl: order · resend · print
// Run: node scripts/test-invoice-ctl-board.js
const assert = require('node:assert/strict');
const { fakeDb } = require('./_fake-db');
const { handleCtl } = require('../api/_invoice-ctl');

const NOW = 1793280000000;
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);   // base64 מתחיל ב-/9j/
const admin = { ok: true, role: 'admin', phone: '0500000000' };
const client = { ok: true, role: 'client', phone: '0501234567' };

const rec = over => ({ state: 'ready', docNumber: '67346', date: '2026-11-19', client: 'אגן ברזל', clientPhone: '0501234567',
  orderIds: ['a', 'b'], orderNums: ['L1', 'L2'], sketchNames: ['מקלחון', 'מראה'], createdAt: NOW - 1000,
  delivery: { state: 'sent', channel: 'whatsapp' }, ...over });
const db0 = () => fakeDb({
  orders: { a: { orderNum: 'L1', invoiceDone: { docNumber: '67346', markedAt: 1 } },
            b: { orderNum: 'L2', invoiceDone: { docNumber: '67346', markedAt: 1 } },
            p: { orderNum: 'L3', invoiceDone: { pieces: { 0: '67400', 1: '67401' } } },
            n: { orderNum: 'L4' } },
  invoicePdf: { k1: rec(), k2: rec({ docNumber: '67346', orderIds: ['zz'] }), k3: rec({ docNumber: '67400', orderIds: ['p'] }) },
  invoicePdfBlobs: { k1: { original: PDF, copy: PDF } },
  users: { '0500000000': { name: 'בן' } },
});
const call = (db, u, method, query, body, extra) =>
  handleCtl({ method, query, body }, { db, now: NOW, verify: async () => u, ...(extra || {}) });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }

(async () => {
  await test('order: the invoices of one order, only records that include it', async () => {
    const r = await call(db0(), admin, 'GET', { action: 'order', id: 'a' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.docs, ['67346']);
    assert.deepEqual(r.body.items.map(i => i.key), ['k1']);
    assert.deepEqual(r.body.items[0].delivery, { state: 'sent', channel: 'whatsapp', reason: '' });
  });
  await test('order: partial invoices — every document number, even one with no PDF yet', async () => {
    const r = await call(db0(), admin, 'GET', { action: 'order', id: 'p' });
    assert.deepEqual(r.body.docs.sort(), ['67400', '67401']);
    assert.deepEqual(r.body.items.map(i => i.key), ['k3']);
  });
  await test('order: no invoice → empty lists, not an error', async () => {
    const r = await call(db0(), admin, 'GET', { action: 'order', id: 'n' });
    assert.deepEqual([r.status, r.body.docs, r.body.items], [200, [], []]);
  });
  await test('order: admin only; a bad id is refused', async () => {
    assert.equal((await call(db0(), client, 'GET', { action: 'order', id: 'a' })).status, 403);
    assert.equal((await call(db0(), admin, 'GET', { action: 'order', id: 'a/b' })).status, 400);
    assert.equal((await call(db0(), admin, 'GET', { action: 'order', id: 'missing' })).status, 404);
  });

  await test('resend: calls the delivery with resend:true and reports the outcome', async () => {
    const seen = [];
    const deliver = async (_db, key, o) => { seen.push([key, o.resend, o.now]); return { state: 'sent', channel: 'whatsapp' }; };
    const r = await call(db0(), admin, 'POST', { action: 'resend' }, { key: 'k1' }, { deliver });
    assert.deepEqual(r.body, { ok: true, state: 'sent', channel: 'whatsapp' });
    assert.deepEqual(seen, [['k1', true, NOW]]);
  });
  await test('resend: admin only; unknown key / not-ready invoice refused', async () => {
    const deliver = async () => { throw new Error('must not be called'); };
    assert.equal((await call(db0(), client, 'POST', { action: 'resend' }, { key: 'k1' }, { deliver })).status, 403);
    assert.equal((await call(db0(), admin, 'POST', { action: 'resend' }, { key: 'nope' }, { deliver })).status, 404);
    const db = db0(); db._data.invoicePdf.k1.state = 'awaiting';
    assert.equal((await call(db, admin, 'POST', { action: 'resend' }, { key: 'k1' }, { deliver })).status, 409);
  });

  await test('print: the original becomes A4 pages in the print queue (sheets → Brother)', async () => {
    const db = db0(); const seen = [];
    const pdfToJpegs = async (buf, o) => { seen.push([buf.toString(), o.targetW]); return [{ bytes: JPG }, { bytes: JPG }]; };
    const r = await call(db, admin, 'POST', { action: 'print' }, { key: 'k1' }, { pdfToJpegs });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(seen, [['%PDF-1.4 fake', 1240]]);
    const job = db._data.waMeta.printJobs[r.body.id];
    assert.deepEqual([job.kind, job.printer, job.count, job.state], ['sheets', 'a4', 2, 'queued']);
    assert.match(job.client, /חשבונית 67346/);
    assert.deepEqual(job.orderIds, ['a', 'b']);
  });
  await test('print: no PDF stored → refused, nothing queued', async () => {
    const db = db0();
    const r = await call(db, admin, 'POST', { action: 'print' }, { key: 'k3' }, { pdfToJpegs: async () => [{ bytes: JPG }] });
    assert.equal(r.status, 404);
    assert.equal((db._data.waMeta || {}).printJobs, undefined);
    assert.equal((await call(db, client, 'POST', { action: 'print' }, { key: 'k1' })).status, 403);
  });

  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
