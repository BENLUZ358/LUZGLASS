'use strict';
// DB-00004 — זיהוי חשבונית, שיוך, העלאה וארכיון. בלי PDF אמיתי של חשבשבת:
// טקסט העמודים מוזרק (pageTexts), ה-PDF רק צריך להתחיל ב-%PDF-.
const assert = require('node:assert/strict');
const path = require('node:path');
const { fakeDb } = require('./_fake-db');
const M = require('../api/_invoice-match');
const S = require('../api/_invoice-send');
const { handleUpload } = require('../api/_invoice-upload');
const { resolveArchive } = require('../tools/invoice-watcher/watcher');

const TOKEN = 't'.repeat(40);
const pdf = tag => Buffer.from('%PDF-1.4 ' + tag).toString('base64');
const ORIG = pdf('orig'), COPY = pdf('copy');
const req = (body, auth = 'Bearer ' + TOKEN) => ({ method: 'POST', headers: { authorization: auth }, body });
const texts = { [Buffer.from('%PDF-1.4 orig').toString()]: 'חשבונית מס 123456 תאריך 27/10/2026 מקור שער ראשי דלת מקלחת',
                [Buffer.from('%PDF-1.4 copy').toString()]: 'חשבונית מס 123456 העתק שער ראשי דלת מקלחת' };
const mk = (over = {}) => ({
  db: fakeDb({ invoicePdf: { k1: { state: 'awaiting', client: 'משה כהן', clientPhone: '0501234567',
    orderIds: ['a', 'b'], sketchNames: ['שער ראשי', 'דלת מקלחת'] } } }),
  env: { INVOICE_UPLOAD_TOKEN: TOKEN }, now: 1000,
  pageTexts: async buf => [texts[buf.toString()] || ''], ...over });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }

(async () => {
  await test('page role: copy wins, original needs no "copy"', () => {
    assert.equal(M.pageRole('חשבונית מקור'), 'original');
    assert.equal(M.pageRole('חשבונית העתק'), 'copy');
    assert.equal(M.pageRole('העתק נאמן למקור'), 'copy');
    assert.equal(M.pageRole('חשבונית'), null);
    assert.equal(M.pageRole('‫רוקמ'), 'original');   // סדר ויזואלי הפוך
  });
  await test('doc number and date extraction; ambiguity gives null', () => {
    assert.equal(M.extractDocNumber('חשבונית מס 123456'), '123456');
    assert.equal(M.extractDocNumber('אין כאן כלום'), null);
    assert.equal(M.extractDate('תאריך 27/10/2026'), '2026-10-27');
    assert.equal(M.extractDate('תאריך 31/02/2026'), null);
    assert.equal(M.extractDate('x'), null);
  });
  await test('pickPending: exactly one match, duplicates/empty names refused', () => {
    const t = 'שער ראשי דלת מקלחת';
    const p = n => ({ sketchNames: n });
    assert.deepEqual(M.pickPending(t, { a: p(['שער ראשי', 'דלת מקלחת']) }), { ok: true, key: 'a' });
    assert.equal(M.pickPending(t, { a: p(['שער ראשי']), b: p(['דלת מקלחת']) }).code, 'ambiguous');
    assert.equal(M.pickPending(t, { a: p(['חלון']) }).code, 'no-match');
    assert.equal(M.pickPending(t, { a: p(['שער ראשי', '']) }).code, 'no-match');
    assert.equal(M.pickPending(t, { a: p(['שער ראשי', 'שער ראשי']) }).code, 'no-match');
  });
  await test('archive path: year/month/customer, unsafe names cleaned, bad input null', () => {
    assert.equal(S.lgInvoiceArchivePath('2026-10-27', 'משה כהן', '123456'), '2026/10/משה כהן/2026-10-27_123456.pdf');
    assert.equal(S.lgInvoiceArchivePath('2026-10-27', 'a/b:c*?.', '1234'), '2026/10/a b c/2026-10-27_1234.pdf');
    assert.equal(S.lgInvoiceArchivePath(null, 'x', '1234'), null);
    assert.equal(S.lgInvoiceArchivePath('2026-10-27', 'x', 'abc'), null);
  });
  await test('send key deterministic; package stops on missing sketch', () => {
    assert.equal(S.lgInvoiceSendKey('050', '1234'), S.lgInvoiceSendKey('050', '1234'));
    assert.notEqual(S.lgInvoiceSendKey('050', '1234'), S.lgInvoiceSendKey('051', '1234'));
    const rec = { orderIds: ['a', 'b'] };
    assert.equal(S.lgInvoiceBuildPackage(rec, { a: 'x', b: 'y' }).attachments.length, 3);
    const bad = S.lgInvoiceBuildPackage(rec, { a: 'x' });
    assert.deepEqual([bad.ok, bad.code, bad.orderIds], [false, 'sketch-missing', ['b']]);
    assert.equal(S.lgInvoiceBuildPackage({ orderIds: [] }, {}).ok, false);
  });
  await test('upload: bad token / non-PDF / oversize rejected before any DB read', async () => {
    const d = mk();
    assert.equal((await handleUpload(req({ original: ORIG, copy: COPY }, 'Bearer wrong'), d)).status, 401);
    assert.equal((await handleUpload(req({ original: ORIG, copy: COPY }, ''), { ...d, env: {} })).status, 401);
    assert.equal((await handleUpload(req({ original: Buffer.from('nope').toString('base64'), copy: COPY }), d)).body.code, 'bad-pdf');
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(700 * 1024)]).toString('base64');
    assert.equal((await handleUpload(req({ original: big, copy: COPY }), d)).body.code, 'bad-pdf');
    assert.equal(d.db._data.invoicePdf.k1.state, 'awaiting');
  });
  await test('upload: happy path marks ready, returns archive path, stores blobs', async () => {
    const d = mk();
    const r = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(r.status, 200);
    assert.equal(r.body.archivePath, '2026/10/משה כהן/2026-10-27_123456.pdf');
    assert.equal(r.body.sendAfter, 1000 + S.CANCEL_WINDOW_MS);
    assert.equal(d.db._data.invoicePdf.k1.state, 'ready');
    assert.ok(d.db._data.invoicePdfBlobs.k1.copy);
  });
  await test('upload twice (tool retry) answers the same and never re-processes', async () => {
    const d = mk();
    const a = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    const b = await handleUpload(req({ original: ORIG, copy: COPY }), { ...d, now: 99999 });
    assert.equal(b.status, 200); assert.equal(b.body.duplicate, true);
    assert.equal(b.body.sendAfter, a.body.sendAfter);
  });
  await test('upload: swapped pages (copy as original) refused, nothing becomes ready', async () => {
    const d = mk();
    const r = await handleUpload(req({ original: COPY, copy: ORIG }), d);
    assert.equal(r.status, 422); assert.equal(r.body.code, 'role-unverified');
    assert.equal(d.db._data.invoicePdf.k1.state, 'awaiting');
  });
  await test('upload: ready links invoicePdfKey on every order', async () => {
    const d = mk();
    await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(d.db._data.orders.a.invoicePdfKey, 'k1');
    assert.equal(d.db._data.orders.b.invoicePdfKey, 'k1');
  });
  await test('upload: print before register is parked as printed (202), same retry stays 202', async () => {
    const d = mk({ db: fakeDb({ invoicePdf: { k9: { state: 'awaiting', client: 'x', sketchNames: ['חלון'] } } }) });
    const r = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(r.status, 202); assert.equal(r.body.code, 'printed-waiting');
    const printed = Object.values(d.db._data.invoicePdf).filter(x => x.state === 'printed');
    assert.equal(printed.length, 1); assert.equal(printed[0].docNumber, '123456');
    const again = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(again.status, 202);
    assert.equal(Object.values(d.db._data.invoicePdf).filter(x => x.state === 'printed').length, 1);
  });
  await test('upload: awaiting record with a different doc number is not matched', async () => {
    const d = mk({ db: fakeDb({ invoicePdf: { k1: { state: 'awaiting', docNumber: '999999', client: 'x',
      orderIds: ['a'], sketchNames: ['שער ראשי', 'דלת מקלחת'] } } }) });
    const r = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(r.status, 202);
    assert.equal(d.db._data.invoicePdf.k1.state, 'awaiting');
  });
  const ctl = require('../api/_invoice-ctl');
  const ordersDb = extra => fakeDb({ orders: {
    a: { orderClient: 'משה כהן', clientPhone: '0501234567', orderNum: '11', sketchName: 'שער ראשי' },
    b: { orderClient: 'משה כהן', clientPhone: '0501234567', orderNum: '12', sketchName: 'דלת מקלחת' },
    c: { orderClient: 'אחר', clientPhone: '0509999999', orderNum: '13', sketchName: 'חלון' } }, ...extra });
  const ctlDeps = db => ({ db, now: 5000,
    verifyAdmin: async () => ({ ok: true, phone: '0500000000' }),
    verifyUser: async r => (r.headers.who ? { ok: true, phone: r.headers.who } : { ok: false, status: 401 }) });
  const call = (body, deps, who) => ctl.handleCtl({ method: 'POST', headers: { who }, body }, deps);
  await test('ctl register-then-print: awaiting, then upload makes it ready', async () => {
    const db = ordersDb(); const deps = ctlDeps(db);
    const r = await call({ action: 'register', orderIds: ['a', 'b'], docNumber: '123456' }, deps);
    assert.equal(r.body.state, 'awaiting');
    const u = await handleUpload(req({ original: ORIG, copy: COPY }), { ...mk(), db, pageTexts: mk().pageTexts });
    assert.equal(u.status, 200);
    assert.equal(db._data.invoicePdf[r.body.key].state, 'ready');
    assert.equal(db._data.orders.a.invoicePdfKey, r.body.key);
  });
  await test('ctl print-then-register: printed is promoted, blobs moved, orders linked', async () => {
    const db = ordersDb(); const deps = ctlDeps(db);
    const u = await handleUpload(req({ original: ORIG, copy: COPY }), { ...mk(), db, pageTexts: mk().pageTexts });
    assert.equal(u.status, 202);
    const r = await call({ action: 'register', orderIds: ['a', 'b'], docNumber: '123456' }, deps);
    assert.equal(r.body.state, 'ready'); assert.equal(r.body.matchedPrinted, true);
    const rows = Object.values(db._data.invoicePdf);
    assert.equal(rows.length, 1); assert.equal(rows[0].archivePath, '2026/10/משה כהן/2026-10-27_123456.pdf');
    assert.equal(Object.keys(db._data.invoicePdfBlobs).length, 1);
    assert.equal(db._data.orders.b.invoicePdfKey, r.body.key);
    const again = await handleUpload(req({ original: ORIG, copy: COPY }), { ...mk(), db, pageTexts: mk().pageTexts });
    assert.equal(again.status, 200); assert.equal(again.body.duplicate, true);
  });
  await test('ctl register: different doc number does not take the printed one; mixed clients refused', async () => {
    const db = ordersDb(); const deps = ctlDeps(db);
    await handleUpload(req({ original: ORIG, copy: COPY }), { ...mk(), db, pageTexts: mk().pageTexts });
    const r = await call({ action: 'register', orderIds: ['a', 'b'], docNumber: '777777' }, deps);
    assert.equal(r.body.state, 'awaiting');
    assert.equal((await call({ action: 'register', orderIds: ['a', 'c'], docNumber: '888888' }, deps)).body.code, 'mixed-clients');
    assert.equal((await call({ action: 'register', orderIds: ['a'], docNumber: 'abc' }, deps)).body.code, 'bad-doc');
  });
  await test('ctl customerPdf: owner gets original only; other customer / anonymous / not-ready refused', async () => {
    const db = ordersDb(); const deps = ctlDeps(db);
    const r = await call({ action: 'register', orderIds: ['a', 'b'], docNumber: '123456' }, deps);
    assert.equal((await call({ action: 'customerPdf', key: r.body.key }, deps, '0501234567')).body.code, 'not-ready');
    await handleUpload(req({ original: ORIG, copy: COPY }), { ...mk(), db, pageTexts: mk().pageTexts });
    const ok = await call({ action: 'customerPdf', key: r.body.key }, deps, '050-123-4567');
    assert.equal(ok.status, 200); assert.equal(ok.body.pdf, ORIG); assert.equal(ok.body.copy, undefined);
    assert.equal((await call({ action: 'customerPdf', key: r.body.key }, deps, '0509999999')).status, 403);
    assert.equal((await call({ action: 'customerPdf', key: r.body.key }, deps)).status, 401);
  });
  await test('ctl admin actions refuse a non-admin; list hides text and blobs', async () => {
    const db = ordersDb(); const deps = ctlDeps(db);
    await call({ action: 'register', orderIds: ['a'], docNumber: '123456' }, deps);
    const denied = { ...deps, verifyAdmin: async () => ({ ok: false, status: 403 }) };
    for (const action of ['register', 'list', 'pdf']) assert.equal((await call({ action }, denied)).status, 403);
    const l = await call({ action: 'list', sinceMs: 0 }, deps);
    assert.equal(l.body.rows.length, 1); assert.equal(l.body.rows[0].text, undefined);
    assert.equal((await call({ action: 'list', sinceMs: 9999 }, deps)).body.rows.length, 0);
  });
  await test('watcher resolveArchive refuses traversal / absolute / backslash', () => {
    const root = path.resolve('/srv/share');
    assert.equal(resolveArchive(root, '2026/10/לקוח/f.pdf'), path.join(root, '2026', '10', 'לקוח', 'f.pdf'));
    for (const bad of ['../x.pdf', '/etc/x.pdf', '2026/../../x', 'a\\b.pdf', '', null, '2026//x.pdf']) {
      assert.equal(resolveArchive(root, bad), null, String(bad));
    }
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
