'use strict';
// DB-00004 — שליחת החשבונית והסקיצות ללקוח, מיד, בערוץ שבו ההזמנות הגיעו (בן, 29/10).
//   • וואטסאפ → תור waOutbox + שליחה מיידית (drain) עם קבצים
//   • מייל (שולח מקושר) → תור המייל, הסקריפט מושך כל קובץ ב-outbox-file
//   • פורטל → לא נשלח כלום; חסרה סקיצה → לא נשלח כלום; ניסיון → מדלגים; פעם אחת בלבד
// Run: node scripts/test-invoice-deliver.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { fakeDb } = require('./_fake-db');

const sa = id => JSON.stringify({ project_id: id, client_email: 'x@y', private_key: 'k' });
process.env.FIREBASE_SERVICE_ACCOUNT = sa('luz-glass-test');
process.env.EMAIL_ONLY_TO = 'client@shop.co.il';
delete process.env.WA_PROVIDER;

const D = require('../api/_invoice-deliver');
const ob = require('../api/_email-outbox');
const core = require('../api/_wa-drain-core');
const { renderText } = require('../api/_wa-provider');
const { handleUpload } = require('../api/_invoice-upload');

const PDF = Buffer.from('%PDF-1.4 invoice').toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64');
const GROUP = '120363000000000001@g.us';
const NOW = 1793280000000;

const rec = over => ({ state: 'ready', docNumber: '67346', date: '2026-10-29', client: 'אגן ברזל', clientPhone: '0501234567',
  accountKey: '3150', orderIds: ['a', 'b'], orderNums: ['L1', 'L2'], sketchNames: ['מקלחון', 'מראה'],
  archivePath: '2026/10/x/2026-10-29_67346.pdf', ...over });
const waOrder = { source: 'whatsapp', waGroup: GROUP, waMessageId: 'w1', customerId: '3150', orderNum: 'L1' };
const emOrder = { source: 'email', emailMessageId: 'm1', emailThreadId: 't1', emailFrom: 'Client <client@shop.co.il>',
  customerId: '3150', orderNum: 'L1' };
const portal = { orderNum: 'L2', customerId: '3150' };
const base = (orders, over) => fakeDb({
  invoicePdf: { k1: rec(over) }, invoicePdfBlobs: { k1: { original: PDF, copy: PDF } },
  orders, sketches: { a: JPG, b: JPG },
  waGroups: { [GROUP.replace(/[.#$[\]/]/g, '_')]: { customerId: '3150' } },
  waMeta: { emailSenders: { 'client@shop,co,il': { customerId: '3150', customerName: 'אגן ברזל' } } },
});
const noDrain = async () => ({ results: [] });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }

(async () => {
  await test('text: invoice message names the document and counts the sketches', () => {
    const t = renderText({ kind: 'invoice', clientName: 'אגן ברזל', orderNums: ['L1', 'L2'], sketchNames: ['מקלחון', ''], docNumber: '67346' });
    assert.match(t, /חשבונית מס 67346/); assert.match(t, /2 סקיצות/); assert.match(t, /• מקלחון/);
    assert.doesNotMatch(t, /מוכנות לאיסוף/);
  });
  await test('files: invoice PDF first, then one sketch per order, named by order number', async () => {
    const f = await D.lgInvoiceFiles(base({ a: waOrder, b: portal }), 'k1');
    assert.equal(f.ok, true);
    assert.deepEqual(f.files.map(x => [x.name, x.mime]), [['חשבונית 67346.pdf', 'application/pdf'],
      ['סקיצה L1 - מקלחון.jpg', 'image/jpeg'], ['סקיצה L2 - מראה.jpg', 'image/jpeg']]);
    assert.equal(f.files[0].buf.toString(), '%PDF-1.4 invoice');
  });
  await test('whatsapp order: queued with the invoice key and sent right away to the same group', async () => {
    const db = base({ a: waOrder, b: portal });
    const calls = [];
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: async (_db, keys, by) => {
      calls.push([keys, by]); return { results: [{ key: keys[0], status: 'sent' }] }; } });
    assert.equal(r.state, 'sent');
    const [key] = calls[0][0];
    const q = db._data.waOutbox[key];
    assert.deepEqual([q.kind, q.to, q.invoiceKey, q.docNumber, q.state], ['invoice', GROUP, 'k1', '67346', 'pending']);
    assert.equal(db._data.invoicePdf.k1.delivery.channel, 'whatsapp');
  });
  await test('email order from a linked sender: reply queued in its thread, never WhatsApp', async () => {
    const db = base({ a: emOrder, b: portal });
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: async () => { throw new Error('no WA'); } });
    assert.deepEqual([r.state, r.channel], ['queued', 'email']);
    assert.equal(db._data.waOutbox, undefined);
    const [k] = Object.keys(db._data.waMeta.emailOutbox);
    const e = db._data.waMeta.emailOutbox[k];
    assert.deepEqual([e.kind, e.thread, e.messageId, e.invoiceKey], ['invoice', 't1', 'm1', 'k1']);
    //  הסקריפט מושך: 3 קבצים, כל אחד רק עם ההשכרה שלו
    const items = await ob.lgEmailClaim(db, 5, NOW);
    assert.equal(items[0].files, 3); assert.match(items[0].text, /חשבונית מס 67346/);
    const f0 = await ob.lgEmailOutboxFile(db, k, items[0].leaseToken, 0, NOW);
    assert.deepEqual([f0.ok, f0.mime, Buffer.from(f0.b64, 'base64').toString()], [true, 'application/pdf', '%PDF-1.4 invoice']);
    assert.equal((await ob.lgEmailOutboxFile(db, k, items[0].leaseToken, 2, NOW)).mime, 'image/jpeg');
    assert.equal((await ob.lgEmailOutboxFile(db, k, 'wrong', 0, NOW)).code, 'stale');
    assert.equal((await ob.lgEmailOutboxFile(db, k, items[0].leaseToken, 3, NOW)).code, 'bad-idx');
    //  הסקריפט מאשר → החשבונית מסומנת "נשלחה"
    await ob.lgEmailComplete(db, k, items[0].leaseToken, true, NOW);
    assert.deepEqual([db._data.invoicePdf.k1.delivery.state, db._data.invoicePdf.k1.delivery.channel], ['sent', 'email']);
  });
  await test('mixed channels → WhatsApp', async () => {
    const db = base({ a: emOrder, b: waOrder });
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(r.channel, 'whatsapp');
  });
  await test('portal-only orders: nothing is sent', async () => {
    const db = base({ a: portal, b: portal });
    assert.equal((await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain })).state, 'portal');
    assert.equal(db._data.waOutbox, undefined);
  });
  await test('a missing sketch blocks the whole message', async () => {
    const db = base({ a: waOrder, b: portal }); db._data.sketches = { a: JPG };
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(r.state, 'blocked'); assert.equal(db._data.waOutbox, undefined);
    assert.equal(db._data.invoicePdf.k1.delivery.reason, 'חסרה סקיצה');
  });
  await test('test invoice is skipped; an invoice already sent is not sent again', async () => {
    const db = base({ a: waOrder, b: portal }, { simulated: true });
    assert.equal((await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain })).state, 'skipped');
    const db2 = base({ a: waOrder, b: portal }, { delivery: { state: 'sent' } });
    let drained = false;
    await D.lgInvoiceDeliver(db2, 'k1', { now: NOW, drain: async () => { drained = true; return { results: [] }; } });
    assert.equal(drained, false); assert.equal(db2._data.waOutbox, undefined);
  });
  await test('drain sends invoice files to the live group and marks the invoice sent', async () => {
    const db = base({ a: waOrder, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    const sent = [];
    const provider = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
      gate: () => ({ allowed: true }), send: async () => { throw new Error('text send used'); },
      sendFiles: async facts => { sent.push(facts); return { ok: true, messageId: 'id1', httpStatus: 200 }; } };
    const r = await core.drainKeys(db, provider, [key], 'invoice-tool', Date.now());
    assert.equal(r.results[0].status, 'sent');
    assert.equal(sent[0].to, GROUP); assert.equal(sent[0].docNumber, '67346');
    assert.deepEqual(sent[0].files.map(f => f.mime), ['application/pdf', 'image/jpeg', 'image/jpeg']);
    assert.equal(db._data.invoicePdf.k1.delivery.state, 'sent');
    assert.ok(db._data.orders.a.whatsappInvoice); assert.equal(db._data.orders.a.whatsapp, undefined);
  });
  await test('a provider that cannot send files never sends a text in place of the invoice', async () => {
    const db = base({ a: waOrder, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    let texts = 0;
    const meta = { name: 'meta', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
      gate: () => ({ allowed: true }), send: async () => { texts++; return { ok: true }; } };
    const r = await core.drainKeys(db, meta, [key], 'x', Date.now());
    assert.equal(texts, 0); assert.equal(r.results[0].status, 'error');
    assert.equal(db._data.invoicePdf.k1.delivery.state, 'failed');
  });
  await test('upload: a matched print triggers delivery once, with its key', async () => {
    const TOKEN = 't'.repeat(40);
    const calls = [];
    const db = fakeDb({ invoicePdf: { k1: { state: 'awaiting', docNumber: '123456', accountKey: '99', client: 'x',
      clientPhone: '050', orderIds: ['a'], sketchNames: ['s'] } } });
    const t = 'חשבונית מס 123456 תאריך 27/10/2026 מפתח 99 ';
    const deps = { db, env: { INVOICE_UPLOAD_TOKEN: TOKEN }, now: 1000,
      pageTexts: async b => [t + (b.toString().includes('copy') ? 'העתק' : 'מקור')],
      deliver: async (_db, key) => calls.push(key) };
    const r = await handleUpload({ method: 'POST', headers: { authorization: 'Bearer ' + TOKEN },
      body: { original: Buffer.from('%PDF-1.4 o').toString('base64'), copy: Buffer.from('%PDF-1.4 copy').toString('base64') } }, deps);
    assert.equal(r.status, 200); assert.deepEqual(calls, ['k1']);
    assert.equal(r.body.sendAfter, 1000);   // מיד — בלי חלון המתנה
  });
  await test('GREEN API: each file is an upload to the media host; caption on the first only; token never leaks', async () => {
    const keep = { ...process.env };
    Object.assign(process.env, { WA_PROVIDER: 'green', GREENAPI_ID_INSTANCE: '7103', GREENAPI_TOKEN: 'SECRETTOKEN' });
    const realFetch = global.fetch;
    const seen = [];
    global.fetch = async (url, opts) => {
      seen.push({ url, fields: Object.fromEntries([...opts.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.type])) });
      if (seen.length === 3) return { status: 400, text: async () => JSON.stringify({ message: 'bad file at /SECRETTOKEN' }) };
      return { status: 200, text: async () => JSON.stringify({ idMessage: 'M' + seen.length }) };
    };
    try {
      delete require.cache[require.resolve('../api/_wa-provider')];
      const p = require('../api/_wa-provider').lgWaProvider();
      const files = [{ name: 'a.pdf', mime: 'application/pdf', buf: Buffer.from('x') },
                     { name: 'b.jpg', mime: 'image/jpeg', buf: Buffer.from('y') }];
      const ok = await p.sendFiles({ to: GROUP, kind: 'invoice', clientName: 'x', orderNums: ['L1'], docNumber: '5', files });
      assert.equal(ok.ok, true); assert.equal(ok.messageId, 'M1');
      assert.equal(seen[0].url, 'https://media.green-api.com/waInstance7103/sendFileByUpload/SECRETTOKEN');
      assert.deepEqual([seen[0].fields.chatId, seen[0].fields.file, !!seen[0].fields.caption, seen[1].fields.caption],
                       [GROUP, 'application/pdf', true, undefined]);
      const bad = await p.sendFiles({ to: GROUP, kind: 'invoice', files: files.slice(0, 1) });
      assert.equal(bad.ok, false); assert.doesNotMatch(bad.reason + bad.detail, /SECRETTOKEN/);
    } finally {
      global.fetch = realFetch;
      for (const k of ['WA_PROVIDER', 'GREENAPI_ID_INSTANCE', 'GREENAPI_TOKEN']) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
    }
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
