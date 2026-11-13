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
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'm99', source: 'manual', customerId: '99' }]), 'send');
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'm99', source: 'manual', customerId: '99' }, { id: 'p', source: 'manual', customerId: '99' }]), 'paper');
    assert.equal(await M.lgManualInvoiceMode(db, [{ id: 'zz', source: 'manual', customerId: '99' }]), 'paper');
  });
  //  ── סקירה סופית: תיקונים ──
  await test('F8: two manual orders, different phones on one invoice → paper; same phone → send', async () => {
    const db = fakeDb({ waMeta: { manualOrders: {
      a: { phone: '0548000775', original: 'send', customerId: '99' },
      b: { phone: '0521234567', original: 'send', customerId: '99' },
      c: { phone: '054-800-0775', original: 'send', customerId: '99' } } } });
    const o = id => ({ id, source: 'manual', customerId: '99' });
    assert.equal(await M.lgManualInvoiceMode(db, [o('a'), o('b')]), 'paper');
    assert.equal(await M.lgManualInvoiceMode(db, [o('a'), o('c')]), 'send');
  });
  await test('F8: deliver with two manual phones → paper, nothing queued', async () => {
    const db = invDb({ ...MAN, m2: { source: 'manual', customerId: '99', orderNum: 'L2' } },
      { m99: { phone: '0548000775', original: 'send', customerId: '99' }, m2: { phone: '0521234567', original: 'send', customerId: '99' } });
    assert.equal((await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: noDrain })).state, 'paper');
    noQueue(db);
  });
  await test('F7: record of another card = no record (recipient, account key, invoice mode)', async () => {
    const R = require('../api/_wa-recipient');
    const H = require('../api/hashavshevet-order');
    const db = fakeDb({ hashavshevetAccounts: { '99': { name: 'מזדמן' }, '3150': { name: 'אגן ברזל' } },
      waMeta: { manualOrders: { m: { phone: '0548000775', original: 'send', customerId: '3150' } } } });
    const o = { id: 'm', source: 'manual', customerId: '99' };
    for (const fn of [R.resolveRecipientWa, R.resolveRecipient]) {
      const a = await fn(db, o, 'ready');
      assert.equal(a.phone, ''); assert.equal(a.source, 'manual-missing');
    }
    assert.equal(await H.pickAccountKey(db, o), null);
    assert.equal(await M.lgManualInvoiceMode(db, [o]), 'paper');
    assert.equal(await M.lgManualRecFor(db, { ...o, customerId: '' }), null);
    //  אותו כרטיס → עובד
    assert.equal((await R.resolveRecipientWa(db, { ...o, customerId: '3150' }, 'ready')).phone, '0548000775');
    assert.equal(await H.pickAccountKey(db, { ...o, customerId: '3150' }), '3150');
  });
  await test('F5: manual order without an account key → manual-specific message', async () => {
    const H = require('../api/hashavshevet-order');
    const db = fakeDb({ hashavshevetAccounts: { '99': { name: 'מזדמן' } },
      waMeta: { manualOrders: { k: { phone: '0548000775', original: 'send', customerId: '777' } } } });
    assert.deepEqual(await H.manualAccountError(db, { id: 'nr', source: 'manual', customerId: '99' }),
      { error: 'הטלפון של ההזמנה הידנית לא נשמר — שמור אותו בשורה האדומה בתור הסקיצות', code: 'manual-missing' });
    assert.deepEqual(await H.manualAccountError(db, { id: 'k', source: 'manual', customerId: '777' }),
      { error: 'כרטיס הלקוח של ההזמנה הידנית לא נמצא — סנכרן לקוחות', code: 'manual-unknown-card' });
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'hashavshevet-order.js'), 'utf8');
    //  המזהה מהנתיב נכנס לחיפוש, והבדיקה הידנית לפני "אין טלפון לקוח"
    assert.ok(src.includes('pickAccountKey(db, { ...order, id: orderId })'));
    assert.ok(src.indexOf('manualAccountError(db, { ...order, id: orderId })') < src.indexOf('להזמנה אין טלפון לקוח'));
  });
  await test('F1: mixed invoice (group order sorted first) → real drainNow sends to the manual phone', async () => {
    const pmod = require('../api/_wa-provider');
    const orig = pmod.lgWaProvider;
    const sent = [];
    pmod.lgWaProvider = () => ({ name: 'fake', configured: true, checksState: false, globalSlot: false, maxPerRun: 5,
      nextGap: () => 0, gate: () => ({ allowed: true }), send: async () => { throw new Error('text send used'); },
      sendFiles: async facts => { sent.push(facts); return { ok: true, messageId: 'id1', httpStatus: 200 }; } });
    delete require.cache[require.resolve('../api/_wa-drain-core')];
    try {
      const core = require('../api/_wa-drain-core');
      //  'g1' < 'm99' — ההזמנה של הקבוצה ראשונה ב-orderIds הממוינים של התור
      const db = invDb({ g1: { source: 'whatsapp', waGroup: GROUP, waMessageId: 'w1', customerId: '99', orderNum: 'L2' }, ...MAN },
        { m99: { phone: '0548000775', original: 'send', customerId: '99' } });
      const r = await D.lgInvoiceDeliver(db, 'k1', { now: 5, drain: core.drainNow });
      const q = Object.values(db._data.waOutbox);
      assert.equal(q.length, 1); assert.equal(q[0].orderIds[0], 'g1');
      assert.equal(sent.length, 1); assert.equal(sent[0].to, '0548000775');
      assert.ok(!sent.some(f => f.to === GROUP));
      assert.equal(r.state, 'sent'); assert.equal(db._data.invoicePdf.k1.delivery.state, 'sent');
    } finally {
      pmod.lgWaProvider = orig;
      delete require.cache[require.resolve('../api/_wa-drain-core')];
    }
  });
  await test('F2: ready-net groups: manual apart from the card, and per phone for card 99', async () => {
    const N = require('../api/_ready-net');
    const NOW = Date.UTC(2026, 10, 13, 9);
    const base = { stage: 'done', readyAt: NOW - 10 * 60 * 1000 };
    const orders = {
      a: { ...base, orderClient: 'אגן ברזל', source: 'whatsapp' },
      b: { ...base, orderClient: 'אגן ברזל', source: 'manual', manualNotify: { phone: '0548000775' } },
      c: { ...base, orderClient: 'יוסי', source: 'manual', customerId: '99', manualNotify: { phone: '0548000775' } },
      d: { ...base, orderClient: 'יוסי', source: 'manual', customerId: '99', manualNotify: { phone: '0521234567' } },
      e: { ...base, orderClient: 'אגן ברזל', source: 'whatsapp' },
    };
    const g = N.lgReadyNetPick(orders, NOW, new Set(), {}, 0);
    assert.deepEqual(g.map(x => x.client + ':' + x.ids.join(',')).sort(),
      ['אגן ברזל:a,e', 'אגן ברזל:b', 'יוסי:c', 'יוסי:d'].sort());
    //  תאום של wdReadyGroupKey — אותה חלוקה בדיוק
    const vm = require('vm'), fs = require('fs'), path = require('path');
    const SQ = fs.readFileSync(path.join(__dirname, '..', 'sq-new-order.js'), 'utf8');
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(SQ.match(/function wdReadyGroupKey[\s\S]*?\n}/)[0] + ';this.K=wdReadyGroupKey;', ctx);
    const byKey = {};
    for (const id of Object.keys(orders)) (byKey[ctx.K(orders[id])] = byKey[ctx.K(orders[id])] || []).push(id);
    assert.deepEqual(Object.values(byKey).map(x => x.join(',')).sort(), g.map(x => x.ids.join(',')).sort());
  });
  await test('F11: whatsapp-send skips manual orders before resolvePhone', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'whatsapp-send.js'), 'utf8');
    const i = src.indexOf("order.source === 'manual'"), j = src.indexOf('await resolvePhone(db, order)');
    assert.ok(i > 0 && i < j); assert.ok(src.includes("reason: 'הזמנה ידנית — רק דרך התור'"));
  });
  await test('F10: invoices + check-station load the current firebase-db', async () => {
    const fs = require('fs'), path = require('path');
    const v = f => (fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(/firebase-db\.js\?v=(\w+)/) || [])[1];
    assert.equal(v('invoices.html'), v('workday.html')); assert.equal(v('check-station.html'), v('admin.html'));
    assert.equal(v('workday.html'), '20261113');
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
  await test('F6: upload matched to an awaiting invoice → printOriginal for paper', async () => {
    const mkDb = original => fakeDb({
      orders: { m1: { source: 'manual', customerId: '99', orderNum: 'L1115', orderClient: 'מזדמן', clientPhone: '' } },
      invoicePdf: { k9: { state: 'awaiting', docNumber: '67400', accountKey: '99', client: 'מזדמן', orderIds: ['m1'] } },
      waMeta: { manualOrders: { m1: { phone: '0548000775', original, customerId: '99' } } } });
    const a = await upl('paper', mkDb('paper'));
    assert.equal(a.status, 200); assert.equal(a.body.key, 'k9'); assert.equal(a.body.printOriginal, true);
    const b = await upl('send', mkDb('send'));
    assert.equal(b.status, 200); assert.equal(b.body.key, 'k9'); assert.ok(!b.body.printOriginal);
  });
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
