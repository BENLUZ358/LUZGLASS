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
  await test('upload: no registered invoice → kept as printed (202), never ready', async () => {
    const d = mk({ db: fakeDb({ invoicePdf: { k9: { state: 'awaiting', client: 'x', sketchNames: ['חלון'] } } }) });
    const r = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(r.status, 202); assert.equal(r.body.pending, true);
    assert.equal(d.db._data.invoicePdf[r.body.key].state, 'printed');
    assert.equal(d.db._data.invoicePdf.k9.state, 'awaiting');
  });
  await test('upload: registered doc number differing from the printed one never pairs', async () => {
    const d = mk(); d.db._data.invoicePdf.k1.docNumber = '999999';
    const r = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    assert.equal(r.status, 202); assert.equal(d.db._data.invoicePdf[r.body.key].state, 'printed');
    assert.equal(d.db._data.invoicePdf.k1.state, 'awaiting');
  });

  await test('upload: reprint of a settled invoice (other bytes) ends with the same archive path', async () => {
    const d = mk();
    texts[Buffer.from('%PDF-1.4 orig2').toString()] = texts[Buffer.from('%PDF-1.4 orig').toString()];
    const a = await handleUpload(req({ original: ORIG, copy: COPY }), d);
    const b = await handleUpload(req({ original: pdf('orig2'), copy: COPY }), { ...d, now: 5000 });
    assert.equal(b.status, 200); assert.equal(b.body.reprint, true);
    assert.equal(b.body.archivePath, a.body.archivePath); assert.equal(b.body.sendAfter, a.body.sendAfter);
    assert.equal(Object.keys(d.db._data.invoicePdf).length, 1);
  });
  await test('upload: reprint while still waiting as printed is not stored twice', async () => {
    const d = mk({ db: fakeDb({ invoicePdf: {} }) });
    assert.equal((await handleUpload(req({ original: ORIG, copy: COPY }), d)).status, 202);
    const b = await handleUpload(req({ original: pdf('orig2'), copy: COPY }), d);
    assert.equal(b.status, 202); assert.equal(b.body.reprint, true);
    assert.equal(Object.keys(d.db._data.invoicePdf).length, 1);
  });

  //  ── חשבונית אמיתית מחשבשבת (67346, 29/10) — הטקסט כפי ש-pdfjs מחלץ ──
  const REAL = n => '17:09  חשבונית מס 67346  תאריך 29/10/2026  מפתח 99  מזהה 348048  בדיקה  לכבוד :  מס\' :  אסמ\' 2 '
    + ' 8 מ\'\'מ שקוף מחוסם 1.00  סה"כ לתשלום: 0.00  תאריך תשלום 29/10/2026  513020198 : .מ.ע  ERP   הופק ע"י חשבשבת  ' + n;
  await test('real invoice: role, doc number, date, account key', () => {
    assert.equal(M.pageRole(REAL('מקור')), 'original');
    assert.equal(M.pageRole(REAL('העתק 1')), 'copy');
    assert.equal(M.extractDocNumber(REAL('מקור')), '67346');
    assert.equal(M.extractDate(REAL('מקור')), '2026-10-29');
    assert.equal(M.extractAccountKey(REAL('מקור')), '99');
    assert.equal(M.extractAccountKey('מפתח 9912345678'), null);
  });
  await test('real invoice: pairs by doc number + account key, not by sketch names', () => {
    const t = REAL('מקור');
    const p = (dn, ak) => ({ docNumber: dn, accountKey: ak, sketchNames: ['לא מודפס'] });
    assert.deepEqual(M.pickPending(t, { a: p('67346', '99') }), { ok: true, key: 'a' });
    assert.equal(M.pickPending(t, { a: p('67346', '98') }).code, 'no-match');
    assert.equal(M.pickPending(t, { a: p('67347', '99') }).code, 'no-match');
    //  שתי ממתינות של אותו לקוח, רק לאחת מספר המסמך הזה
    assert.deepEqual(M.pickPending(t, { a: p('67346', '99'), b: p('67350', '99') }), { ok: true, key: 'a' });
    //  שתיהן בלי מספר מסמך → לא חד-משמעי
    assert.equal(M.pickPending(t, { a: p(null, '99'), b: p(null, '99') }).code, 'ambiguous');
  });

  //  ── בקרה: רישום והדפסה בכל סדר, אדמין, לקוח ──
  const C = require('../api/_invoice-ctl');
  const ADMIN = { ok: true, phone: '0500000000', role: 'admin' };
  const cust = ph => ({ ok: true, phone: ph, role: 'customer' });
  const ctlDb = () => fakeDb({ orders: {
    a: { orderNum: 'L1', clientPhone: '0501234567', orderClient: 'משה כהן', sketchName: 'שער ראשי' },
    b: { orderNum: 'L2', clientPhone: '0501234567', orderClient: 'משה כהן', sketchName: 'דלת מקלחת' },
    z: { orderNum: 'L3', clientPhone: '0509999999', orderClient: 'אחר', sketchName: 'חלון' } } });
  const call = (db, user, method, query, body) => C.handleCtl({ method, query, body }, { db, now: 5000, verify: async () => user });
  const uploadTo = db => handleUpload(req({ original: ORIG, copy: COPY }),
    { db, env: { INVOICE_UPLOAD_TOKEN: TOKEN }, now: 6000, pageTexts: async buf => [texts[buf.toString()] || ''] });

  await test('order A: register then print → ready, copy path returned', async () => {
    const db = ctlDb();
    const r = await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['a', 'b'] });
    assert.equal(r.body.state, 'awaiting');
    const u = await uploadTo(db);
    assert.equal(u.status, 200);
    assert.equal(u.body.archivePath, '2026/10/משה כהן/2026-10-27_123456.pdf');
    assert.equal(db._data.invoicePdf[r.body.key].state, 'ready');
  });
  await test('order B: print then register → printed first, settled on register', async () => {
    const db = ctlDb();
    const u = await uploadTo(db);
    assert.equal(u.status, 202);
    const r = await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['a', 'b'] });
    assert.equal(r.body.state, 'ready'); assert.equal(r.body.settled, true);
    assert.equal(db._data.invoicePdf[u.body.key], undefined);
    assert.equal(db._data.invoicePdfBlobs[u.body.key], undefined);
    assert.ok(db._data.invoicePdfBlobs[r.body.key].original);
    const again = await uploadTo(db);              // הכלי מנסה שוב → תשובה סופית
    assert.equal(again.status, 200); assert.equal(again.body.archivePath, '2026/10/משה כהן/2026-10-27_123456.pdf');
  });
  await test('order B: register with a different doc number or other sketches does not settle', async () => {
    const db = ctlDb(); await uploadTo(db);
    const r1 = await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '777777', orderIds: ['a', 'b'] });
    assert.equal(r1.body.state, 'awaiting');
    const r2 = await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['z'] });
    assert.equal(r2.body.state, 'awaiting');
  });
  await test('register: admin only, bad input, mixed customers', async () => {
    const db = ctlDb();
    assert.equal((await call(db, cust('0501234567'), 'POST', { action: 'register' }, { docNumber: '1234', orderIds: ['a'] })).status, 403);
    assert.equal((await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: 'x', orderIds: ['a'] })).status, 400);
    assert.equal((await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '1234', orderIds: ['a', 'z'] })).status, 422);
    assert.equal((await call(db, { ok: false, status: 401 }, 'GET', { action: 'list' })).status, 401);
  });
  await test('admin list: range, search, stale flag; no hash/text leaked', async () => {
    const db = ctlDb();
    await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['a', 'b'] });
    await uploadTo(db);
    db._data.invoicePdf.old = { state: 'awaiting', client: 'ישן', createdAt: -1e12, orderNums: [], sketchNames: [] };
    db._data.invoicePdf.wait = { state: 'awaiting', client: 'ממתין', createdAt: 5000 - 2 * 86400000, orderNums: ['L9'], sketchNames: [] };
    const all = (await call(db, ADMIN, 'GET', { action: 'list', from: String(5000 - 3 * 86400000) })).body.items;
    assert.ok(!all.find(x => x.key === 'old'));
    assert.equal(all.find(x => x.key === 'wait').stale, true);
    assert.ok(all.every(x => !('originalHash' in x) && !('text' in x)));
    const hit = (await call(db, ADMIN, 'GET', { action: 'list', from: '1', q: 'דלת מקלחת' })).body.items;
    assert.equal(hit.length, 1); assert.equal(hit[0].docNumber, '123456');
  });
  await test('pdf: admin gets original only; customer only for own invoice', async () => {
    const db = ctlDb();
    const key = (await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['a', 'b'] })).body.key;
    await uploadTo(db);
    const adm = await call(db, ADMIN, 'GET', { action: 'pdf', key });
    assert.equal(adm.pdf.toString(), '%PDF-1.4 orig');                       // המקור, לא ההעתק
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'pdf', key })).status, 403);
    const own = await call(db, cust('0501234567'), 'GET', { action: 'minepdf', key });
    assert.equal(own.pdf.toString(), '%PDF-1.4 orig');
    assert.equal((await call(db, cust('0509999999'), 'GET', { action: 'minepdf', key })).status, 404);
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'minepdf', key: 'nope' })).status, 404);
    const list = (await call(db, cust('0501234567'), 'GET', { action: 'mine' })).body.items;
    assert.deepEqual(list.map(x => x.docNumber), ['123456']);
    assert.deepEqual(list[0].orderIds, ['a', 'b']);
    assert.equal((await call(db, cust('0509999999'), 'GET', { action: 'mine' })).body.items.length, 0);
  });
  await test('customer: foreign order inside the invoice blocks it; simulated and not-ready hidden', async () => {
    const db = ctlDb();
    const key = (await call(db, ADMIN, 'POST', { action: 'register' }, { docNumber: '123456', orderIds: ['a', 'b'] })).body.key;
    await uploadTo(db);
    db._data.orders.b.clientPhone = '0509999999';
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'minepdf', key })).status, 404);
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'mine' })).body.items.length, 0);
    db._data.orders.b.clientPhone = '0501234567';
    db._data.invoicePdf[key].simulated = true;
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'mine' })).body.items.length, 0);
    db._data.invoicePdf[key].simulated = null; db._data.invoicePdf[key].state = 'awaiting';
    assert.equal((await call(db, cust('0501234567'), 'GET', { action: 'minepdf', key })).status, 404);
  });
  await test('pdf key shared with hashavshevet-invoice; rules index the new fields', () => {
    assert.equal(S.lgInvoicePdfKey(['b', 'a']), S.lgInvoicePdfKey(['a', 'b']));
    const rules = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    for (const f of ['docNumber', 'createdAt', 'clientPhone']) assert.ok(rules.rules.invoicePdf['.indexOn'].includes(f), f);
    assert.equal(rules.rules.invoicePdfBlobs['.read'], false);
  });
  await test('watcher resolveArchive refuses traversal / absolute / backslash', () => {
    const root = path.resolve('/srv/share');
    assert.equal(resolveArchive(root, '2026/10/לקוח/f.pdf'), path.join(root, '2026', '10', 'לקוח', 'f.pdf'));
    for (const bad of ['../x.pdf', '/etc/x.pdf', '2026/../../x', 'a\\b.pdf', '', null, '2026//x.pdf']) {
      assert.equal(resolveArchive(root, bad), null, String(bad));
    }
  });
  await test('watcher: same reading as the server on the real invoice text', () => {
    const W = require('../tools/invoice-watcher/watcher');
    assert.equal(W.roleOf(REAL('מקור')), 'original');
    assert.equal(W.roleOf(REAL('העתק 1')), 'copy');
    assert.equal(W.docNumberOf(REAL('מקור')), M.extractDocNumber(REAL('מקור')));
  });
  await test('watcher: single-page files pair by invoice number; lone ones go to review after the wait', () => {
    const { groupSingles } = require('../tools/invoice-watcher/watcher');
    const e = (role, doc, at) => ({ role, doc, at });
    const { pairs, stale } = groupSingles([
      ['o1', e('original', '100', 0)], ['c1', e('copy', '100', 1)], ['c1b', e('copy', '100', 2)],
      ['o2', e('original', '200', 0)],               // מחכה להעתק, עוד לא עבר הזמן
      ['c3', e('copy', '300', 0)],                   // העתק בלי מקור, עבר הזמן
    ], 1000, 5000);
    assert.deepEqual(pairs, [{ doc: '100', original: 'o1', copies: ['c1', 'c1b'] }]);
    assert.deepEqual(stale, []);
    const later = groupSingles([['o2', e('original', '200', 0)], ['c3', e('copy', '300', 0)]], 9000, 5000);
    assert.deepEqual(later.pairs, []); assert.deepEqual(later.stale.sort(), ['c3', 'o2']);
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
