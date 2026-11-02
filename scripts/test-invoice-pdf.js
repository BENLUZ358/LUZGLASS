'use strict';
// DB-00004 — זיהוי חשבונית, שיוך, העלאה וארכיון. בלי PDF אמיתי של חשבשבת:
// טקסט העמודים מוזרק (pageTexts), ה-PDF רק צריך להתחיל ב-%PDF-.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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
  //  ── חשבונית שהופקה בחשבשבת מהזמנות סוכן: מספר ההזמנה בטור "מ.מקור" (בן, 29/10) ──
  const HS = (ref, acct, extra) => ({ orderNum: 'L' + ref, orderClient: 'א.מ.מראות', clientPhone: '054-8000775',
    sketchName: 'מראה ' + ref, hashavshevet: { httpOk: true, accountKey: acct, reference: String(ref) }, ...(extra || {}) });
  const PRINT = (role, refs) => 'חשבונית מס 67400  תאריך 29/10/2026  מפתח 509  מזהה 348049  א.מ.מראות  '
    + refs.map(r => `8 מ''מ שקוף מחוסם 1115.00 0.00 120.00   ${r} 1.00 1.00   1.00   1`).join('  ') + '  ' + role;
  const byOrders = (orders, refs) => {
    const t = { [Buffer.from('%PDF-1.4 o').toString()]: PRINT('מקור', refs), [Buffer.from('%PDF-1.4 c').toString()]: PRINT('העתק 1', refs) };
    return { db: fakeDb({ orders }), env: { INVOICE_UPLOAD_TOKEN: TOKEN }, now: 1000, deliver: async () => {},
      pageTexts: async buf => [t[buf.toString()] || ''] };
  };
  const PO = pdf('o'), PC = pdf('c');
  await test('refs: standalone integers only — prices with decimals are not order numbers', () => {
    const r = M.extractRefs(PRINT('מקור', [1115]));
    assert.ok(r.includes('1115')); assert.ok(r.includes('67400')); assert.ok(!r.includes('120'));
    assert.deepEqual(M.extractRefs('L1115 x 1115.00'), ['1115']);
  });
  await test('agent-order invoice: order numbers in the print + same account → matched now, no registration', async () => {
    const d = byOrders({ a: HS(1115, '509'), b: HS(1116, '509'), z: HS(1117, '509') }, [1115, 1116]);
    const r = await handleUpload(req({ original: PO, copy: PC }), d);
    assert.equal(r.status, 200); assert.equal(r.body.byOrders, true);
    const rec = d.db._data.invoicePdf[r.body.key];
    assert.deepEqual([rec.state, rec.docNumber, rec.accountKey, rec.orderIds, rec.client],
      ['ready', '67400', '509', ['a', 'b'], 'א.מ.מראות']);
    assert.equal(r.body.archivePath, '2026/10/א.מ.מראות/2026-10-29_67400.pdf');
  });
  await test('agent-order invoice: another customer\'s order with the same number is never taken', async () => {
    const d = byOrders({ a: HS(1115, '14201') }, [1115]);
    const r = await handleUpload(req({ original: PO, copy: PC }), d);
    assert.equal(r.status, 202); assert.equal(d.db._data.invoicePdf[r.body.key].state, 'printed');
  });
  await test('agent-order invoice: simulated runs and orders never sent to Hashavshevet are ignored', async () => {
    const sim = { ...HS(1115, '509', { isTest: true }), hashavshevet: { httpOk: true, simulated: true, accountKey: '509', reference: '1115' } };
    const d = byOrders({ a: sim, b: { ...HS(1115, '509'), hashavshevet: { httpOk: false, accountKey: '509', reference: '1115' } } }, [1115]);
    assert.equal((await handleUpload(req({ original: PO, copy: PC }), d)).status, 202);
  });
  //  בן, 2/11: 1117 ו-1121 של נאור סומנו "פיקטיבית" אחרי שנפתחו בחשבשבת באמת —
  //  החשבונית יצאה בלי הסקיצות שלהן. מסמך אמיתי בחשבשבת = הזמנה אמיתית.
  await test('agent-order invoice: an order marked fake AFTER a real Hashavshevet send is still matched', async () => {
    const d = byOrders({ a: HS(1115, '509'), b: HS(1116, '509', { isTest: true }) }, [1115, 1116]);
    const r = await handleUpload(req({ original: PO, copy: PC }), d);
    assert.equal(r.status, 200);
    assert.deepEqual(d.db._data.invoicePdf[r.body.key].orderIds, ['a', 'b']);
  });
  //  חשבונית חלקית (בן, 2/11): 4 חתיכות של L1115 בחשבונית 67400, החמישית אחר כך
  //  בחשבונית 67410 — אותה הזמנה, שתי חשבוניות. השנייה נתקעה כ"printed" ולא נשלחה.
  await test('partial invoice: a second invoice for the same order gets its own record', async () => {
    const d = byOrders({ a: HS(1115, '509') }, [1115]);
    const first = await handleUpload(req({ original: PO, copy: PC }), d);
    assert.equal(first.status, 200);
    const t2 = { [Buffer.from('%PDF-1.4 o2').toString()]: PRINT('מקור', [1115]).replace('67400', '67410'),
                 [Buffer.from('%PDF-1.4 c2').toString()]: PRINT('העתק 1', [1115]).replace('67400', '67410') };
    d.pageTexts = async buf => [t2[buf.toString()] || ''];
    const second = await handleUpload(req({ original: pdf('o2'), copy: pdf('c2') }), d);
    assert.equal(second.status, 200); assert.equal(second.body.byOrders, true);
    assert.notEqual(second.body.key, first.body.key);
    const rec = d.db._data.invoicePdf[second.body.key];
    assert.deepEqual([rec.state, rec.docNumber, rec.orderIds], ['ready', '67410', ['a']]);
    assert.equal(d.db._data.invoicePdf[first.body.key].docNumber, '67400');
  });
  await test('partial invoice: the station registering doc 2 for the same order opens a new record', async () => {
    const { handleCtl } = require('../api/_invoice-ctl');
    const db = fakeDb({ orders: { a: HS(1115, '509') }, users: { '0548000775': { customerId: '509' } } });
    const ctl = body => handleCtl({ method: 'POST', body: { action: 'register', ...body } },
                                  { db, now: 5, verify: async () => ({ ok: true, role: 'admin', phone: '050' }) });
    const r1 = await ctl({ docNumber: '67400', orderIds: ['a'] });
    db._data.invoicePdf[r1.body.key].state = 'ready';
    const r2 = await ctl({ docNumber: '67410', orderIds: ['a'] });
    assert.equal(r2.status, 200); assert.notEqual(r2.body.key, r1.body.key); assert.equal(r2.body.state, 'awaiting');
    assert.equal(db._data.invoicePdf[r2.body.key].docNumber, '67410');
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
  //  ── תיוק (בן, 2/11): לקוחות/<לקוח>/<שנה-חודש>/<מספר> <לקוח> מקור|העתק <תאריך>.pdf,
  //  מקור והעתק שניהם; שום תיקיית עזר בתוך תיקיית ההדפסות (שם שמרו בטעות ל-done) ──
  await test('watcher: filed names — customer / year-month / number customer role date', () => {
    const { filedPaths } = require('../tools/invoice-watcher/watcher');
    const root = path.resolve('/x/לקוחות');
    const f = filedPaths(root, '2026/11/נאור חזקיה/2026-11-02_67393.pdf');
    assert.equal(f.original, path.join(root, 'נאור חזקיה', '2026-11', '67393 נאור חזקיה מקור 02-11-2026.pdf'));
    assert.equal(f.copy,     path.join(root, 'נאור חזקיה', '2026-11', '67393 נאור חזקיה העתק 02-11-2026.pdf'));
    for (const bad of ['../x/y/2026-11-02_1.pdf', '2026/11/../2026-11-02_1.pdf', '2026/11/a/b.pdf', '2026/11/a\\b/2026-11-02_1.pdf', '', null])
      assert.equal(filedPaths(root, bad), null, String(bad));
  });
  await test('watcher: a matched pair files BOTH original and copy, raw files leave the print folder', async () => {
    const W = require('../tools/invoice-watcher/watcher');
    const os = require('os');
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
    const cfg = { watchDir: path.join(top, 'הדפסות'), sharedRoot: path.join(top, 'לקוחות') };
    fs.mkdirSync(cfg.watchDir);
    const o = path.join(cfg.watchDir, 'a.pdf'), c = path.join(cfg.watchDir, 'b.pdf');
    fs.writeFileSync(o, 'ORIG'); fs.writeFileSync(c, 'COPY');
    const post = async () => ({ status: 200, body: { ok: true, docNumber: '67393', archivePath: '2026/11/נאור חזקיה/2026-11-02_67393.pdf' } });
    assert.equal(await W.processPair(cfg, { original: o, copies: [c] }, post), 'ok');
    const dir = path.join(cfg.sharedRoot, 'נאור חזקיה', '2026-11');
    assert.equal(fs.readFileSync(path.join(dir, '67393 נאור חזקיה מקור 02-11-2026.pdf'), 'utf8'), 'ORIG');
    assert.equal(fs.readFileSync(path.join(dir, '67393 נאור חזקיה העתק 02-11-2026.pdf'), 'utf8'), 'COPY');
    assert.deepEqual(fs.readdirSync(cfg.watchDir), [], 'nothing left in the print folder — no done/ to save into by mistake');
    assert.equal(fs.readdirSync(W.sideDirs(cfg).done).length, 2);
    fs.rmSync(top, { recursive: true, force: true });
  });
  await test('watcher: a refused file goes to "לבדיקה" next to the print folder, not inside it', async () => {
    const W = require('../tools/invoice-watcher/watcher');
    const os = require('os');
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
    const cfg = { watchDir: path.join(top, 'הדפסות'), sharedRoot: path.join(top, 'לקוחות') };
    fs.mkdirSync(cfg.watchDir);
    const o = path.join(cfg.watchDir, 'a.pdf'), c = path.join(cfg.watchDir, 'b.pdf');
    fs.writeFileSync(o, 'ORIG'); fs.writeFileSync(c, 'COPY');
    const post = async () => ({ status: 422, body: { ok: false, code: 'bad' } });
    assert.equal(await W.processPair(cfg, { original: o, copies: [c] }, post), 'review');
    assert.equal(W.sideDirs(cfg).review, path.join(top, 'לבדיקה'));
    assert.equal(fs.readdirSync(path.join(top, 'לבדיקה')).length, 2);
    assert.deepEqual(fs.readdirSync(cfg.watchDir), []);
    fs.rmSync(top, { recursive: true, force: true });
  });
  //  ── חשבונית ארוכה (בן, 2/11 — 67395): המקור הוא קובץ של 2 עמודים, וההעתק קובץ
  //  נפרד של 2 עמודים. מספרי ההזמנות יכולים להופיע רק בעמוד השני. ──
  await test('upload: a 2-page original + 2-page copy is accepted; order numbers on page 2 count', async () => {
    const P1 = role => 'חשבונית מס 67400  תאריך 29/10/2026  מפתח 509  א.מ.מראות  מ.מקור  שם פריט  '
      + `8 מ''מ שקוף 1.00 120.00   1115 1.00 1.00   1   ${role}`;
    const P2 = role => `8 מ''מ שקוף 1.00 120.00   1116 1.00 1.00   1  סה"כ  ${role}`;
    const t = { [Buffer.from('%PDF-1.4 o').toString()]: [P1('מקור'), P2('מקור')],
                [Buffer.from('%PDF-1.4 c').toString()]: [P1('העתק 1'), P2('העתק 1')] };
    const d = { db: fakeDb({ orders: { a: HS(1115, '509'), b: HS(1116, '509') } }), env: { INVOICE_UPLOAD_TOKEN: TOKEN },
      now: 1000, deliver: async () => {}, pageTexts: async buf => t[buf.toString()] || [''] };
    const r = await handleUpload(req({ original: PO, copy: PC }), d);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(d.db._data.invoicePdf[r.body.key].orderIds, ['a', 'b']);
  });
  await test('upload: a copy page hiding inside the original file is refused', async () => {
    const t = { [Buffer.from('%PDF-1.4 o').toString()]: [PRINT('מקור', [1115]), PRINT('העתק 1', [1115])],
                [Buffer.from('%PDF-1.4 c').toString()]: [PRINT('העתק 1', [1115])] };
    const d = { db: fakeDb({ orders: { a: HS(1115, '509') } }), env: { INVOICE_UPLOAD_TOKEN: TOKEN },
      now: 1000, deliver: async () => {}, pageTexts: async buf => t[buf.toString()] || [''] };
    assert.equal((await handleUpload(req({ original: PO, copy: PC }), d)).status, 422);
  });
  await test('upload: an original page inside the copy file is refused', async () => {
    const t = { [Buffer.from('%PDF-1.4 o').toString()]: [PRINT('מקור', [1115])],
                [Buffer.from('%PDF-1.4 c').toString()]: [PRINT('העתק 1', [1115]), 'חשבונית מס 67401 מקור'] };
    const d = { db: fakeDb({ orders: { a: HS(1115, '509') } }), env: { INVOICE_UPLOAD_TOKEN: TOKEN },
      now: 1000, deliver: async () => {}, pageTexts: async buf => t[buf.toString()] || [''] };
    assert.equal((await handleUpload(req({ original: PO, copy: PC }), d)).status, 422);
  });
  await test('watcher: a 2-page file is split only when it is original+copy; a long invoice stays whole', () => {
    const { fileKind } = require('../tools/invoice-watcher/watcher');
    const p = (role, doc) => `חשבונית מס ${doc} תאריך 02/11/2026 ${role}`;
    assert.deepEqual(fileKind([p('מקור', 67400), p('העתק 1', 67400)]), { split: true });
    assert.deepEqual(fileKind([p('מקור', 67395), 'עמוד 2 בלי כותרת']), { split: false, role: 'original', doc: '67395' });
    assert.deepEqual(fileKind([p('העתק 1', 67395), 'עמוד 2']), { split: false, role: 'copy', doc: '67395' });
    assert.deepEqual(fileKind([p('מקור', 67395)]), { split: false, role: 'original', doc: '67395' });
    assert.equal(fileKind(['שום דבר']), null);
  });
  //  ── ההעתק לנייר (בן, 2/11): עד שתהיה חשבונית דיגיטלית מחשבשבת בן מתייק ידנית ──
  const printRun = async (body, cfgOver) => {
    const W = require('../tools/invoice-watcher/watcher');
    const os = require('os');
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
    const printed = [];
    const cfg = { watchDir: path.join(top, 'הדפסות'), sharedRoot: path.join(top, 'לקוחות'),
      printCopyTo: 'iR-ADV 525 III', printFn: async (file, printer) => { printed.push([path.basename(file), printer, fs.readFileSync(file, 'utf8')]); }, ...cfgOver };
    fs.mkdirSync(cfg.watchDir);
    const o = path.join(cfg.watchDir, 'a.pdf'), c = path.join(cfg.watchDir, 'b.pdf');
    fs.writeFileSync(o, 'ORIG'); fs.writeFileSync(c, 'COPY');
    if (cfgOver && cfgOver._alreadyFiled) {
      const d = path.join(cfg.sharedRoot, 'נאור חזקיה', '2026-11');
      fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '67395 נאור חזקיה העתק 02-11-2026.pdf'), 'COPY');
    }
    const out = await W.processPair(cfg, { original: o, copies: [c] },
      async () => ({ status: 200, body: { ok: true, docNumber: '67395', archivePath: '2026/11/נאור חזקיה/2026-11-02_67395.pdf', ...body } }));
    fs.rmSync(top, { recursive: true, force: true });
    return { out, printed };
  };
  await test('watcher: a newly filed invoice prints its COPY once, on the configured printer', async () => {
    const { out, printed } = await printRun({});
    assert.equal(out, 'ok');
    assert.deepEqual(printed, [['67395 נאור חזקיה העתק 02-11-2026.pdf', 'iR-ADV 525 III', 'COPY']]);
  });
  await test('watcher: printing the same invoice again from Hashavshevet does not print another copy', async () => {
    assert.deepEqual((await printRun({ reprint: true })).printed, []);
    assert.deepEqual((await printRun({ duplicate: true }, { _alreadyFiled: true })).printed, []);
  });
  await test('watcher: a retry after a failed filing still prints (copy was never filed)', async () => {
    assert.equal((await printRun({ duplicate: true })).printed.length, 1);
  });
  await test('watcher: no printer configured → nothing printed', async () => {
    assert.deepEqual((await printRun({}, { printCopyTo: '' })).printed, []);
  });
  await test('watcher: a printer failure does not hold the invoice back', async () => {
    const { out } = await printRun({}, { printFn: async () => { throw new Error('printer off'); } });
    assert.equal(out, 'ok');
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
