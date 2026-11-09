'use strict';
// DB-00004 — שליחת החשבונית והסקיצות ללקוח, מיד, בערוץ שבו ההזמנות הגיעו (בן, 29/10).
//   • וואטסאפ → תור waOutbox + שליחה מיידית (drain) עם קבצים
//   • מייל (שולח מקושר) → תור המייל, הסקריפט מושך כל קובץ ב-outbox-file
//   • פורטל → לא נשלח כלום; חסרה סקיצה → נשלח עם הסקיצות שיש (בן, 4/11); ניסיון → מדלגים; פעם אחת בלבד
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

//  קבצים אמיתיים — מאז 2/11 החשבונית והסקיצות מתאחדות לקובץ PDF אחד, וזה דורש PDF ותמונה קריאים
const { PDFDocument } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
let PDF, JPG;
async function fixtures() {
  const d = await PDFDocument.create(); d.addPage([595, 842]);
  PDF = Buffer.from(await d.save()).toString('base64');
  const c = createCanvas(40, 30); c.getContext('2d').fillRect(0, 0, 40, 30);
  JPG = 'data:image/jpeg;base64,' + c.toBuffer('image/jpeg').toString('base64');
}
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
  await fixtures();
  await test('text: invoice message names the document and counts the sketches', () => {
    const t = renderText({ kind: 'invoice', clientName: 'אגן ברזל', orderNums: ['L1', 'L2'], sketchNames: ['מקלחון', ''], docNumber: '67346' });
    assert.match(t, /חשבונית מס 67346/); assert.match(t, /2 סקיצות/); assert.match(t, /• מקלחון/);
    assert.doesNotMatch(t, /מוכנות לאיסוף/);
  });
  await test('files: ONE pdf — the invoice, then a page per sketch (בן, 2/11)', async () => {
    const f = await D.lgInvoiceFiles(base({ a: waOrder, b: portal }), 'k1');
    assert.equal(f.ok, true, JSON.stringify(f).slice(0, 200));
    assert.deepEqual(f.files.map(x => [x.name, x.mime]), [['חשבונית 67346 - אגן ברזל.pdf', 'application/pdf']]);
    assert.equal((await PDFDocument.load(f.files[0].buf)).getPageCount(), 3);
  });
  //  בן, 4/11: סקיצה חסרה / שבורה לא עוצרת — יוצאות הסקיצות שיש
  await test('files: an unreadable sketch is left out, the rest still go (בן, 4/11)', async () => {
    const db = base({ a: waOrder, b: portal });
    db._data.sketches.b = 'data:image/jpeg;base64,' + Buffer.from('broken').toString('base64');
    const f = await D.lgInvoiceFiles(db, 'k1');
    assert.equal(f.ok, true, JSON.stringify(f).slice(0, 200));
    assert.deepEqual(f.missing, ['L2']);
    assert.equal((await PDFDocument.load(f.files[0].buf)).getPageCount(), 2);
  });
  await test('files: a missing sketch is left out; too big → separate files without it', async () => {
    const db = base({ a: waOrder, b: portal }); db._data.sketches = { b: JPG };
    const f = await D.lgInvoiceFiles(db, 'k1');
    assert.deepEqual([f.ok, f.missing], [true, ['L1']]);
    assert.equal((await PDFDocument.load(f.files[0].buf)).getPageCount(), 2);
    const big = await D.lgInvoiceFiles(db, 'k1', { maxMergedBytes: 10 });
    assert.deepEqual(big.files.map(x => x.name), ['חשבונית 67346.pdf', 'סקיצה L2 - מראה.jpg']);
    assert.deepEqual(Object.keys(big.files[1]).sort(), ['buf', 'mime', 'name']);
  });
  await test('files: no sketch at all → the invoice alone', async () => {
    const db = base({ a: waOrder, b: portal }); db._data.sketches = {};
    const f = await D.lgInvoiceFiles(db, 'k1');
    assert.deepEqual([f.ok, f.missing], [true, ['L1', 'L2']]);
    assert.equal((await PDFDocument.load(f.files[0].buf)).getPageCount(), 1);
  });
  await test('text: says which order has no sketch', () => {
    const f = { kind: 'invoice', clientName: 'אגן ברזל', orderNums: ['L1', 'L2'], sketchNames: [], docNumber: '67346' };
    assert.match(renderText(f), /2 סקיצות, והסקיצות שלהן\./);
    assert.match(renderText({ ...f, missingSketchNums: ['L2'] }), /והסקיצות שלהן \(בלי סקיצה לL2\)\./);
    assert.match(renderText({ ...f, missingSketchNums: ['L1', 'L2'] }), /עבור 2 סקיצות\.\n/);
  });
  await test('files: too big to merge → sent as separate files, as before', async () => {
    const f = await D.lgInvoiceFiles(base({ a: waOrder, b: portal }), 'k1', { maxMergedBytes: 10 });
    assert.deepEqual(f.files.map(x => x.mime), ['application/pdf', 'image/jpeg', 'image/jpeg']);
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
  //  ── חשבוניות לפרטי (בן, 2/11: המקום לאמבט ונאור חזקיה) — waMeta/invoiceToPrivate/<מפתח> ──
  const privDb = (on, phone) => {
    const db = base({ a: waOrder, b: portal });
    db._data.hashavshevetAccounts = { 3150: { name: 'אגן ברזל', ...(phone ? { phone } : {}) } };
    if (on) db._data.waMeta.invoiceToPrivate = { 3150: { customerName: 'אגן ברזל', addedAt: 1 } };
    return db;
  };
  const R = require('../api/_wa-recipient');
  await test('private: switch on → the invoice goes to the card phone, not the group', async () => {
    const db = privDb(true, '050-111-2222');
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const q = Object.values(db._data.waOutbox)[0];
    assert.equal(q.to, '0501112222');
    const live = await R.resolveRecipientWa(db, waOrder, 'invoice');   // ה-drain פותר שוב — אותה תשובה
    assert.deepEqual([live.phone, live.accountKey, live.linked], ['0501112222', '3150', true]);
  });
  await test('private: switch off → the group, as today', async () => {
    const db = privDb(false, '0501112222');
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(Object.values(db._data.waOutbox)[0].to, GROUP);
  });
  await test('private: "ready" and other messages still go to the group', async () => {
    const db = privDb(true, '0501112222');
    assert.equal((await R.resolveRecipientWa(db, waOrder, 'ready')).phone, GROUP);
  });
  await test('private: switch on but no phone on the card → blocked, never the group', async () => {
    const db = privDb(true, '');
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(r.state, 'blocked');
    assert.equal(db._data.waOutbox, undefined);
    assert.match(db._data.invoicePdf.k1.delivery.reason, /פרטי/);
  });
  await test('private: set from קליטות through the admin endpoint; needs a card with a phone', async () => {
    const adm = require('../api/wa-inbound-drain');
    const db = privDb(false, '0501112222');
    db._data.hashavshevetAccounts['99'] = { name: 'בלי טלפון' };
    const act = b => adm.handleAdmin({ channel: 'whatsapp', ...b }, { db, by: '0520000000', now: NOW });
    assert.equal((await act({ action: 'invoice-private-add', customerId: '3150' })).ok, true);
    assert.equal(db._data.waMeta.invoiceToPrivate['3150'].customerName, 'אגן ברזל');
    assert.equal((await R.resolveRecipientWa(db, waOrder, 'invoice')).phone, '0501112222');
    assert.equal((await act({ action: 'invoice-private-add', customerId: '99' })).code, 'no-phone');
    assert.equal((await act({ action: 'invoice-private-add', customerId: '777' })).code, 'unknown-customer');
    assert.equal((await act({ action: 'invoice-private-remove', customerId: '3150' })).ok, true);
    assert.equal((await R.resolveRecipientWa(db, waOrder, 'invoice')).phone, GROUP);
    assert.equal((await act({ action: 'invoice-private-remove', customerId: '3150' })).code, 'not-enabled');
  });
  await test('email order from a linked sender: reply queued in its thread, never WhatsApp', async () => {
    const db = base({ a: emOrder, b: portal });
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: async () => { throw new Error('no WA'); } });
    assert.deepEqual([r.state, r.channel], ['queued', 'email']);
    assert.equal(db._data.waOutbox, undefined);
    const [k] = Object.keys(db._data.waMeta.emailOutbox);
    const e = db._data.waMeta.emailOutbox[k];
    assert.deepEqual([e.kind, e.thread, e.messageId, e.invoiceKey], ['invoice', 't1', 'm1', 'k1']);
    //  הסקריפט מושך: קובץ אחד (חשבונית + סקיצות, 2/11), רק עם ההשכרה שלו
    const items = await ob.lgEmailClaim(db, 5, NOW);
    assert.equal(items[0].files, 1); assert.match(items[0].text, /חשבונית מס 67346/);
    const f0 = await ob.lgEmailOutboxFile(db, k, items[0].leaseToken, 0, NOW);
    assert.deepEqual([f0.ok, f0.mime], [true, 'application/pdf']);
    assert.equal((await PDFDocument.load(Buffer.from(f0.b64, 'base64'))).getPageCount(), 3);   // חשבונית + 2 סקיצות
    assert.equal((await ob.lgEmailOutboxFile(db, k, 'wrong', 0, NOW)).code, 'stale');
    assert.equal((await ob.lgEmailOutboxFile(db, k, items[0].leaseToken, 1, NOW)).code, 'bad-idx');
    //  הסקריפט מאשר → החשבונית מסומנת "נשלחה"
    await ob.lgEmailComplete(db, k, items[0].leaseToken, true, NOW);
    assert.deepEqual([db._data.invoicePdf.k1.delivery.state, db._data.invoicePdf.k1.delivery.channel], ['sent', 'email']);
  });
  await test('invoice email of the card (9/11): a new mail to that address, not a reply', async () => {
    const db = base({ a: emOrder, b: portal });
    const acct = String(emOrder.customerId);
    db._data.waMeta.invoiceEmail = { [acct]: 'ILANATA@bdo.co.il' };
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.deepEqual([r.state, r.channel], ['queued', 'email']);
    //  נעילת הסביבה חלה גם על כתובת החשבוניות — לא מורשית → לא יוצא
    assert.equal((await ob.lgEmailClaim(db, 5, NOW)).length, 0);
    process.env.EMAIL_ONLY_TO = 'client@shop.co.il,ilanata@bdo.co.il';
    let items;
    try { items = await ob.lgEmailClaim(db, 5, NOW); } finally { process.env.EMAIL_ONLY_TO = 'client@shop.co.il'; }
    assert.equal(items[0].sendTo, 'ilanata@bdo.co.il');
    assert.match(items[0].subject, /חשבונית מס 67346/);
    assert.equal(items[0].files, 1);
  });
  await test('no invoice email for the card → plain reply (no sendTo)', async () => {
    const db = base({ a: emOrder, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const items = await ob.lgEmailClaim(db, 5, NOW);
    assert.equal(items[0].sendTo, undefined);
  });
  await test('Peleg (07) is in the built-in list', async () => {
    assert.equal(D.LG_INVOICE_EMAIL['07'], 'ILANATA@bdo.co.il');
    const db = base({ a: emOrder, b: portal });
    assert.equal(await D.lgInvoiceEmailFor(db, '07'), 'ilanata@bdo.co.il');
    assert.equal(await D.lgInvoiceEmailFor(db, '../x'), '');
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
  await test('a missing sketch no longer blocks: queued, and the entry names the order without one', async () => {
    const db = base({ a: waOrder, b: portal }); db._data.sketches = { a: JPG };
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(r.state, 'queued');
    const e = Object.values(db._data.waOutbox)[0];
    assert.deepEqual(e.missingSketchNums, ['L2']);
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
    assert.deepEqual(sent[0].files.map(f => f.mime), ['application/pdf']);
    assert.equal(db._data.invoicePdf.k1.delivery.state, 'sent');
    assert.ok(db._data.orders.a.whatsappInvoice); assert.equal(db._data.orders.a.whatsapp, undefined);
  });
  //  בן, 2/11: הזמנה שנפתחה בחשבשבת באמת וסומנה "פיקטיבית" אחר כך — החשבונית
  //  עליה אמיתית ויוצאת. הודעה רגילה (מוכן לאיסוף וכו') על הזמנה כזו — עדיין חסומה.
  const fileProvider = sent => ({ name: 'fake', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
    gate: () => ({ allowed: true }), send: async () => { throw new Error('text send used'); },
    sendFiles: async facts => { sent.push(facts); return { ok: true, messageId: 'id1', httpStatus: 200 }; } });
  await test('invoice: an order marked fake after a real Hashavshevet send does not block the invoice', async () => {
    const db = base({ a: { ...waOrder, isTest: true, hashavshevet: { httpOk: true, accountKey: '3150', reference: '1' } }, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    const sent = [];
    const r = await core.drainKeys(db, fileProvider(sent), [key], 'invoice-tool', Date.now());
    assert.equal(r.results[0].status, 'sent');
    assert.equal(sent.length, 1);
  });
  await test('invoice: a simulated (never really sent) fake order still blocks', async () => {
    const db = base({ a: { ...waOrder, isTest: true, hashavshevet: { httpOk: true, simulated: true } }, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    const sent = [];
    const r = await core.drainKeys(db, fileProvider(sent), [key], 'invoice-tool', Date.now());
    assert.equal(r.results[0].status, 'blocked');
    assert.equal(sent.length, 0);
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
  await test('a stuck WhatsApp send is retried by a reprint; a sent one is not', async () => {
    const db = base({ a: waOrder, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    const calls = [];
    const drain = async (_db, keys) => { calls.push(keys[0]); return { results: [{ key: keys[0], status: 'sent' }] }; };
    const r = await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain });
    assert.deepEqual([calls, r.state, r.retried], [[key], 'sent', true]);
    db._data.waOutbox[key].state = 'sent';
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain });
    assert.equal(calls.length, 1);
  });
  await test('an exception while sending closes the message with a reason, never leaves it hanging', async () => {
    const db = base({ a: waOrder, b: portal });
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    const [key] = Object.keys(db._data.waOutbox);
    const boom = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
      gate: () => ({ allowed: true }), sendFiles: async () => { const e = new TypeError('fetch failed https://x/waInstance1/SECRET'); throw e; } };
    const r = await core.drainKeys(db, boom, [key], 'x', Date.now());
    assert.equal(r.results[0].status, 'error');
    const dv = db._data.invoicePdf.k1.delivery;
    assert.equal(dv.state, 'failed'); assert.match(dv.reason, /TypeError/); assert.doesNotMatch(dv.reason, /SECRET/);
    assert.equal(db._data.waOutbox[key].claimedAt, null);
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
      assert.equal(seen[0].url, 'https://7103.api.greenapi.com/waInstance7103/sendFileByUpload/SECRETTOKEN');
      assert.deepEqual([seen[0].fields.chatId, seen[0].fields.file, !!seen[0].fields.caption, seen[1].fields.caption],
                       [GROUP, 'application/pdf', true, undefined]);
      const bad = await p.sendFiles({ to: GROUP, kind: 'invoice', files: files.slice(0, 1) });
      assert.equal(bad.ok, false); assert.doesNotMatch(bad.reason + bad.detail, /SECRETTOKEN/);
    } finally {
      global.fetch = realFetch;
      for (const k of ['WA_PROVIDER', 'GREENAPI_ID_INSTANCE', 'GREENAPI_TOKEN']) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
    }
  });
  //  ── 'הסחורה תגיע מחר' — המקום לאמבט ונאור חזקיה (בן, 3/11) ──
  await test('tomorrow: the line is in the text only when asked for', () => {
    const facts = { kind: 'invoice', clientName: 'המקום לאמבט', orderNums: ['L1'], sketchNames: ['דינה'], docNumber: '5' };
    assert.match(renderText({ ...facts, deliveryTomorrow: true }), /הסחורה תגיע אליך מחר במהלך היום/);
    assert.doesNotMatch(renderText(facts), /מחר/);
    assert.doesNotMatch(renderText({ ...facts, kind: 'ready', deliveryTomorrow: true }), /מחר/);
  });
  const tomorrowDb = cid => base({ a: { ...waOrder, customerId: cid }, b: { ...portal, customerId: cid } });
  await test('tomorrow: 14201 / 9117 invoice → the line reaches the customer', async () => {
    for (const cid of ['14201', '9117']) {
      const db = tomorrowDb(cid);
      await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
      const [key] = Object.keys(db._data.waOutbox);
      assert.equal(db._data.waOutbox[key].deliveryTomorrow, true, cid);
      const sent = [];
      await core.drainKeys(db, fileProvider(sent), [key], 'invoice-tool', Date.now());
      assert.equal(sent[0].deliveryTomorrow, true, cid);
    }
  });
  await test('tomorrow: other customers — no line', async () => {
    const db = tomorrowDb('3150');
    await D.lgInvoiceDeliver(db, 'k1', { now: NOW, drain: noDrain });
    assert.equal(Object.values(db._data.waOutbox)[0].deliveryTomorrow, false);
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
