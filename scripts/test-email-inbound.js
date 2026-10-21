#!/usr/bin/env node
/**
 * קליטת סקיצות מהמייל — ליבת הקליטה (חלק 1: תמונות בלבד).
 * אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.2
 * תוכנית: docs/superpowers/plans/2026-10-20-email-intake-1-images.md (Task 3)
 *
 * מה נבדק כאן, ולמה כל חלק קיים:
 *
 *   A. חתיכות — emailParts/<key>/<idx>/<chunk>, עם הגבולות (20 קבצים,
 *      10 חתיכות, base64 בלבד). הסקריפט ב-Gmail שולח בחתיכות כי גוף בקשה
 *      ל-Vercel מוגבל ל-4.5MB.
 *   B. מייל עם שתי תמונות → שתי הזמנות, מספר הזמנה אחד, הכל או כלום.
 *   C. אותו מייל פעמיים (הסקריפט נפל אחרי שהשרת סיים) → אין סט שני
 *      (Review Focus 1).
 *   D. commit לפני שכל החתיכות הגיעו → failed, לא חצי הזמנה; העלאה מלאה
 *      אחר כך מצליחה (Review Focus 2).
 *   E. מה נקלט: PDF פגום לצד תמונה → כל המייל נדחה, docx לבד → ignored (Review Focus 5),
 *      docx לצד תמונה → מדולג ונרשם; "תמונה" שלא מזוהה (HEIC, GIF, בייטים
 *      שאינם תמונה) → מדולגת ונרשמת כמו docx (R9); גדול מדי → נדחה.
 *      תמונה גדולה → oversize, כמו WhatsApp.
 *   F. שולח לא מזוהה, שלושה ניסיונות → dead, תפיסה של מישהו אחר.
 *   G. "נסה שוב" / "טופל ידנית" / מה ממתין — אותו חוזה כמו WhatsApp.
 *   J. PDF → הזמנה לכל עמוד, לפי סדר הקבצים; יותר מ-40 סקיצות → נדחה;
 *      קריסת רינדור → זמנית (failed, ניסיון חוזר); דדליין מוחלט שעובר
 *      באמצע PDF → נדחה בלי כתיבות (J8).
 *   H. רשימת השולחים המורשים — חתומה על הפרויקט.
 *
 * Run: node scripts/test-email-inbound.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const env = require(path.join(ROOT, 'api', '_env.js'));
const em  = require(path.join(ROOT, 'api', '_email-inbound.js'));
// ⚠️ נבדק מיד, לפני ששום PDF עובד: drain של WhatsApp טוען את המודול הזה, ואסור
// שיגרור איתו את @napi-rs/canvas
const pdfLoadedAtRequire = Object.keys(require.cache).some(k => /[\\/]_pdf-pages\.js$/.test(k));

// ─── קבצים סינתטיים ────────────────────────────────────────────────
//  לא צריך שיהיו ניתנים לפענוח — רק שהבייטים הראשונים יזוהו כתמונה.
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, marker, len >> 8, len & 0xFF]), payload]);
};
const JFIF = seg(0xE0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'));
const COM  = seg(0xFE, Buffer.from('taken at home', 'binary'));
const DQT  = seg(0xDB, Buffer.alloc(65, 1));
const SCAN = Buffer.concat([seg(0xDA, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0xFF, 0xD9])]);
const JPEG     = Buffer.concat([Buffer.from([0xFF, 0xD8]), JFIF, DQT, SCAN]);
const JPEG_COM = Buffer.concat([Buffer.from([0xFF, 0xD8]), JFIF, COM, DQT, SCAN]);
const PNG  = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 7)]);
const NOT_IMAGE = Buffer.from('%PDF-1.7\n this is not a picture at all');

// ⚠️ כל חתיכה היא base64 עצמאי — הבייטים מפוצלים לפני הקידוד
const chunksOf = (buf, n) => {
  const size = Math.ceil(buf.length / n), out = [];
  for (let i = 0; i < n; i++) out.push(buf.subarray(i * size, (i + 1) * size).toString('base64'));
  return out;
};
//  files: [{idx, name, mime, buf, chunks?, skip?:[chunk...]}] → meta.parts, ואת החתיכות מעלים
async function stage(db, messageId, files) {
  for (const f of files) {
    if (!f.buf) continue;
    const n = f.chunks || 1;
    const parts = chunksOf(f.buf, n);
    for (let c = 0; c < n; c++) {
      if ((f.skip || []).includes(c)) continue;
      const r = await em.lgEmailPutChunk(db, { messageId, idx: f.idx, chunk: c, chunks: n, data: parts[c] });
      if (!r.ok) throw new Error('put failed: ' + JSON.stringify(r));
    }
  }
  return files.map(f => ({ idx: f.idx, name: f.name, mime: f.mime, size: f.buf ? f.buf.length : 0, chunks: f.chunks || 1 }));
}
const meta = (messageId, parts, from) => ({
  messageId, threadId: 'T-' + messageId, from: from || '"Dana" <Dana@Client.co.il>', to: 'orderluz@gmail.com',
  subject: 'סקיצות', date: 1760950000000, parts,
});

const seed = () => fakeDb({
  meta: { orderCounter: 1041 },
  hashavshevetAccounts: { '14201': { key: '14201', name: 'כרטיס אגן', phone: '050-1234567', email: 'dana@client.co.il; office@x.com' } },
  users: { '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201' } },
});
const NOW = 1760950005000;

//  עוטף את הכפיל ורושם כל set / update: נתיב, אילו מפתחות, וכמה בייטים
function recorder(raw) {
  const writes = [];
  const db = {
    _data: raw._data,
    ref(p) {
      const r = raw.ref(p);
      return { ...r,
        orderByChild: r.orderByChild, equalTo: r.equalTo, limitToFirst: r.limitToFirst, once: r.once,
        transaction: r.transaction,
        set: async v => { writes.push({ op: 'set', paths: [String(p || '')], bytes: JSON.stringify(v).length }); return r.set(v); },
        update: async v => { writes.push({ op: 'update', paths: Object.keys(v).map(k => (p ? p + '/' : '') + k), bytes: JSON.stringify(v).length }); return r.update(v); },
      };
    },
  };
  return { db, writes };
}
const sketchWrites = w => w.paths.filter(x => x.startsWith('sketches/')).length;

(async () => {
// ═══ A. חתיכות ═══════════════════════════════════════════════════════
  {
    const db = seed();
    const put = x => em.lgEmailPutChunk(db, { messageId: 'M1', idx: 0, chunk: 0, chunks: 1, data: 'QUJD', ...x });
    check('A1 a valid chunk is stored', await put({}), { ok: true });
    check('A1 under emailParts/<key>/<idx>/<chunk>', db._data.emailParts.M1['0']['0'], 'QUJD');
    check('A2 a 21st file is refused', (await put({ idx: 20 })).ok, false);
    check('A2 a file in 11 chunks is refused', (await put({ chunks: 11 })).ok, false);
    check('A2 a chunk past the declared count is refused', (await put({ chunk: 1, chunks: 1 })).ok, false);
    check('A2 a negative index is refused', (await put({ idx: -1 })).ok, false);
    check('A3 data that is not base64 is refused', (await put({ data: 'not base64!' })).ok, false);
    check('A3 nor is empty data', (await put({ data: '' })).ok, false);
    check('A3 refusals carry a code', typeof (await put({ idx: 20 })).code, 'string');
    check('A4 a message id with characters Firebase rejects gets a safe key',
          em.lgEmailInboundKey('<abc.1$#[x]/y@mail>'), '<abc_1___x__y@mail>');
    check('A4 the constants', [em.EM_INBOX, em.EM_PARTS, em.EM_MAX_ATTEMPTS, em.EM_PART_MAX_BYTES, em.EM_MAX_SKETCHES],
          ['emailInbound', 'emailParts', 3, 10 * 1024 * 1024, 40]);
    check('A4 the old "PDF not supported" reason is gone', 'EM_PDF_REASON' in em, false);
    check('A5 requiring the module does not load the PDF renderer', pdfLoadedAtRequire, false);
    check('A5 the render budget leaves room under the 60s function limit', em.EM_RENDER_BUDGET_MS, 40000);
  }

// ═══ B. שתי תמונות, לקוח מזוהה ══════════════════════════════════════
  const db = seed();
  const K = 'K';
  {
    const parts = await stage(db, K, [
      { idx: 0, name: 'מטבח.jpg', mime: 'image/jpeg', buf: JPEG_COM },
      { idx: 1, name: 'אמבטיה.png', mime: 'image/png', buf: PNG, chunks: 2 },
    ]);
    const r = await em.lgEmailCommit(db, meta(K, parts), { now: NOW, by: 't' });
    check('B1 the email is done, with one order number and two orders', r,
          { state: 'done', refNum: 'L1042', orderIds: ['em_K_1', 'em_K_2'] });
    check('B1 exactly two orders in the queue', Object.keys(db._data.orders), ['em_K_1', 'em_K_2']);

    const o1 = db._data.orders.em_K_1, o2 = db._data.orders.em_K_2;
    check('B2 one number with -1..n, like a portal batch, in idx order',
          [o1.refNum, o1.orderNum, o2.refNum, o2.orderNum, o1.fileName, o2.fileName],
          ['L1042-1', 'L1042-1', 'L1042-2', 'L1042-2', 'מטבח.jpg', 'אמבטיה.png']);
    check('B2 page n of total', [o1.emailPage, o1.emailPages, o2.emailPage, o2.emailPages], [1, 2, 2, 2]);
    check('B2 marked as email, with the thread to answer in',
          [o1.source, o1.emailMessageId, o1.emailThreadId, o1.emailFrom, o1.emailReceivedAt],
          ['email', 'K', 'T-K', 'dana@client.co.il', 1760950000000]);
    check('B2 a new, unseen sketch with no name (E6)', [o1.stage, o1.status, o1.sketchName, o1.paymentStatus, o1.read],
          ['', 'ממתין לאישור', '', 'unpaid', false]);
    check('B2 for the identified client, through their portal user',
          [o1.orderClient, o1.client, o1.phone, o1.clientPhone, o1.customerId, o1.businessName, o1.emailUnassigned],
          ['המקום לאמבט', 'המקום לאמבט', '0501234567', '0501234567', '14201', 'המקום לאמבט', undefined]);
    check('B2 the file type is the sniffed one', [o1.files.f0.type, o2.files.f0.type], ['image/jpeg', 'image/png']);
    check('B3 the image lives in sketches/ only', [o1.hasSketch, 'sketch' in o1], [true, false]);
    check('B3 the PNG is byte for byte, rejoined from its two chunks', db._data.sketches.em_K_2,
          'data:image/png;base64,' + PNG.toString('base64'));
    const s1 = Buffer.from(db._data.sketches.em_K_1.split(',')[1], 'base64');
    check('B3 the JPEG went through stripJpegMeta (the comment is gone)', [s1.includes(Buffer.from('taken at home')), s1.equals(JPEG)], [false, true]);
    check('B4 the staged chunks are gone', db._data.emailParts && db._data.emailParts.K, undefined);
    const rec = db._data.emailInbound.K;
    check('B4 the record says done and points at the orders', [rec.state, rec.orderIds, rec.refNum, rec.attempts],
          ['done', ['em_K_1', 'em_K_2'], 'L1042', 1]);
    check('B4 the record keeps who sent it and what', [rec.messageId, rec.threadId, rec.from, rec.subject, rec.receivedAt, rec.parts.length],
          ['K', 'T-K', '"Dana" <Dana@Client.co.il>', 'סקיצות', 1760950000000, 2]);
    check('B4 the match is recorded', rec.clientMatch, { via: 'email', customerId: '14201', name: 'המקום לאמבט' });
    check('B4 no claim left behind', [rec.claimToken, rec.claimedAt, rec.doneAt], [undefined, undefined, NOW]);

// ═══ C. אותו מייל פעמיים ════════════════════════════════════════════
    const again = await em.lgEmailCommit(db, meta(K, parts), { now: NOW + 60000, by: 't' });
    check('C1 committing the same email again answers done, with the same number', again,
          { state: 'done', refNum: 'L1042', orderIds: ['em_K_1', 'em_K_2'] });
    check('C1 still two orders, counter unchanged', [Object.keys(db._data.orders).length, db._data.meta.orderCounter], [2, 1042]);

    // הסקריפט שלח שוב והעלה חתיכות מחדש — אף אחד לא יקרא אותן
    await stage(db, K, [{ idx: 0, name: 'מטבח.jpg', mime: 'image/jpeg', buf: JPEG_COM }]);
    check('C2 re-staged chunks are there before the commit', !!db._data.emailParts.K, true);
    check('C2 a re-sent email still answers done', (await em.lgEmailCommit(db, meta(K, parts), { now: NOW + 70000 })).state, 'done');
    check('C2 and its re-staged chunks are dropped', db._data.emailParts.K, undefined);
  }

// ═══ D. חתיכה חסרה ══════════════════════════════════════════════════
  {
    const parts = await stage(db, 'D', [{ idx: 0, name: 'a.png', mime: 'image/png', buf: PNG, chunks: 2, skip: [1] }]);
    const r = await em.lgEmailCommit(db, meta('D', parts), { now: NOW, by: 't' });
    check('D1 a missing chunk fails, transiently', r, { state: 'failed', reason: 'חסרים חלקים מהקובץ' });
    check('D1 and no order is written', Object.keys(db._data.orders).filter(k => k.startsWith('em_D')), []);
    check('D1 the chunk that did arrive is kept for the retry', !!db._data.emailParts.D, true);
    check('D1 no order number was burned', db._data.meta.orderCounter, 1042);

    await em.lgEmailPutChunk(db, { messageId: 'D', idx: 0, chunk: 1, chunks: 2, data: chunksOf(PNG, 2)[1] });
    const r2 = await em.lgEmailCommit(db, meta('D', parts), { now: NOW + 1000, by: 't' });
    check('D2 once the chunk arrives, the same email completes', r2, { state: 'done', refNum: 'L1043', orderIds: ['em_D_1'] });
    check('D2 the image is whole', db._data.sketches.em_D_1, 'data:image/png;base64,' + PNG.toString('base64'));
    check('D2 on the second attempt', db._data.emailInbound.D.attempts, 2);
    check('D2 a single image keeps the bare number', [db._data.orders.em_D_1.refNum, db._data.orders.em_D_1.orderNum], ['L1043', 'L1043']);
  }

// ═══ E. מה נקלט ═════════════════════════════════════════════════════
  const ordersOf = k => Object.keys(db._data.orders).filter(x => x.startsWith('em_' + k + '_'));
  {
    // PDF פגום לצד תמונה טובה — הכל או כלום: אף הזמנה, גם לא מהתמונה
    const parts = await stage(db, 'P', [
      { idx: 0, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG },
      { idx: 1, name: 'תכנית.pdf', mime: 'application/pdf', buf: Buffer.from('%PDF-1.7 x') },
    ]);
    const r = await em.lgEmailCommit(db, meta('P', parts), { now: NOW, by: 't' });
    check('E1 a corrupt PDF beside a good image rejects the whole email', r, { state: 'rejected', reason: 'קובץ ה-PDF פגום ולא נפתח' });
    check('E1 zero orders, and no sketch written',
          [ordersOf('P'), Object.keys(db._data.sketches).filter(x => x.startsWith('em_P_'))], [[], []]);
    check('E1 the staged bytes are dropped — a rejected email is never retried', db._data.emailParts.P, undefined);
    // PDF שמזוהה רק לפי השם — עובר דרך הרינדור כמו כל PDF
    const named = await stage(db, 'P2', [{ idx: 0, name: 'X.PDF', mime: 'application/octet-stream', buf: Buffer.from('not a pdf') }]);
    check('E1 a PDF known only by its name is rendered too (and this one is corrupt)',
          (await em.lgEmailCommit(db, meta('P2', named), { now: NOW })).reason, 'קובץ ה-PDF פגום ולא נפתח');
  }
  {
    const parts = await stage(db, 'W', [{ idx: 0, name: 'הצעה.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf: Buffer.from('PK..') }]);
    const r = await em.lgEmailCommit(db, meta('W', parts), { now: NOW, by: 't' });
    check('E2 only a .docx → ignored, so Ben still sees it', r, { state: 'ignored', reason: 'אין קובץ סקיצה במייל' });
    check('E2 zero orders', ordersOf('W'), []);
    check('E2 the record says what was skipped', [db._data.emailInbound.W.state, db._data.emailInbound.W.skipped], ['ignored', ['הצעה.docx']]);
    check('E2 nothing staged is left', db._data.emailParts.W, undefined);
    check('E3 an email with no attachment at all → ignored',
          (await em.lgEmailCommit(db, meta('N', []), { now: NOW })).state, 'ignored');
  }
  {
    const parts = await stage(db, 'S', [
      { idx: 0, name: 'מידות.xlsx', mime: 'application/vnd.ms-excel', buf: Buffer.from('xls') },
      { idx: 1, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG },
    ]);
    const r = await em.lgEmailCommit(db, meta('S', parts), { now: NOW, by: 't' });
    check('E4 a spreadsheet beside an image: the image becomes an order', [r.state, r.orderIds], ['done', ['em_S_1']]);
    check('E4 page 1 of 1, from the image', [db._data.orders.em_S_1.emailPages, db._data.orders.em_S_1.fileName], [1, 'a.jpg']);
    check('E4 the skipped file is named on the record', db._data.emailInbound.S.skipped, ['מידות.xlsx']);
  }
  {
    const parts = await stage(db, 'F', [
      { idx: 0, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG },
      { idx: 1, name: 'fake.jpg', mime: 'image/jpeg', buf: NOT_IMAGE },
    ]);
    const r = await em.lgEmailCommit(db, meta('F', parts), { now: NOW, by: 't' });
    check('E5 a "jpg" whose bytes are not an image is skipped, not fatal (R9)', [r.state, r.orderIds], ['done', ['em_F_1']]);
    check('E5 the good image becomes the order', db._data.orders.em_F_1.fileName, 'a.jpg');
    check('E5 the unreadable file is named on the record', db._data.emailInbound.F.skipped, ['fake.jpg']);
  }
  {
    // HEIC מהאייפון — sniffImage לא קורא אותו. לבד במייל → ignored, והשם גלוי
    const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'binary'), Buffer.alloc(40, 3)]);
    const parts = await stage(db, 'H', [{ idx: 0, name: 'IMG_1.HEIC', mime: 'image/heic', buf: HEIC }]);
    const r = await em.lgEmailCommit(db, meta('H', parts), { now: NOW, by: 't' });
    check('E5b only an unreadable image → ignored, no order', [r.state, ordersOf('H')], ['ignored', []]);
    check('E5b …with the file name visible', [db._data.emailInbound.H.state, db._data.emailInbound.H.skipped], ['ignored', ['IMG_1.HEIC']]);
    check('E5b nothing staged is left', db._data.emailParts.H, undefined);
  }
  {
    // oversize — אותו סף כמו WhatsApp (WA_IMAGE_FLAG_BYTES, ברירת מחדל 800KB)
    const p1 = await stage(db, 'O1', [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG }]);
    await em.lgEmailCommit(db, meta('O1', p1), { now: NOW, by: 't' });
    check('E7 a small image is not flagged', db._data.emailInbound.O1.oversize, undefined);
    const keep = process.env.WA_IMAGE_FLAG_BYTES;
    process.env.WA_IMAGE_FLAG_BYTES = String(PNG.length + 1);
    try {
      const p2 = await stage(db, 'O2', [{ idx: 0, name: 'a.png', mime: 'image/png', buf: PNG },
                                        { idx: 1, name: 'b.jpg', mime: 'image/jpeg', buf: JPEG }]);
      await em.lgEmailCommit(db, meta('O2', p2), { now: NOW, by: 't' });
    } finally { if (keep === undefined) delete process.env.WA_IMAGE_FLAG_BYTES; else process.env.WA_IMAGE_FLAG_BYTES = keep; }
    check('E7 an image over the WhatsApp threshold flags the record', db._data.emailInbound.O2.oversize, true);
  }
  {
    const BIG = Buffer.concat([JPEG, Buffer.alloc(em.EM_PART_MAX_BYTES, 0)]);
    const parts = await stage(db, 'B', [{ idx: 0, name: 'big.jpg', mime: 'image/jpeg', buf: BIG, chunks: 3 }]);
    const r = await em.lgEmailCommit(db, meta('B', parts), { now: NOW, by: 't' });
    check('E6 a file over the cap is rejected', [r.state, ordersOf('B')], ['rejected', []]);
    // הסקריפט הצהיר גודל קטן — הבייטים עצמם הם שקובעים
    const lie = await stage(db, 'B2', [{ idx: 0, name: 'big.jpg', mime: 'image/jpeg', buf: BIG, chunks: 3 }]);
    lie[0].size = 100;
    const r2 = await em.lgEmailCommit(db, meta('B2', lie), { now: NOW, by: 't' });
    check('E6 even when the declared size lies', [r2.state, r2.reason, ordersOf('B2')], ['rejected', 'הקובץ big.jpg גדול מדי (10MB)', []]);
  }

// ═══ F. שולח לא מזוהה, ניסיונות, תפיסה ══════════════════════════════
  {
    const parts = await stage(db, 'U', [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG }]);
    const r = await em.lgEmailCommit(db, meta('U', parts, 'Nobody <Nobody@Z.com>'), { now: NOW, by: 't' });
    const o = db._data.orders.em_U_1;
    check('F1 an unknown sender still lands in the queue', r.state, 'done');
    check('F1 marked unassigned, with the address visible',
          [o.emailUnassigned, o.orderClient, o.client, o.phone, o.clientPhone, o.customerId, 'businessName' in o],
          [true, 'לא מזוהה · nobody@z.com', 'לא מזוהה · nobody@z.com', '', '', '', false]);
    check('F1 the record says none', db._data.emailInbound.U.clientMatch, { via: 'none', customerId: '', name: '' });
  }
  {
    const parts = await stage(db, 'X', [{ idx: 0, name: 'a.png', mime: 'image/png', buf: PNG, chunks: 2, skip: [1] }]);
    const m = meta('X', parts);
    const r1 = await em.lgEmailCommit(db, m, { now: NOW, by: 't' });
    const r2 = await em.lgEmailCommit(db, m, { now: NOW + 1, by: 't' });
    const r3 = await em.lgEmailCommit(db, m, { now: NOW + 2, by: 't' });
    check('F2 failed, failed, then dead on the third attempt', [r1.state, r2.state, r3.state], ['failed', 'failed', 'dead']);
    check('F2 dead says why', r3.reason, '3 ניסיונות נכשלו — חסרים חלקים מהקובץ');
    const r4 = await em.lgEmailCommit(db, m, { now: NOW + 3, by: 't' });
    check('F2 a dead email is final — committing again changes nothing', [r4.state, db._data.emailInbound.X.attempts], ['dead', 3]);
    check('F2 its staged chunk is kept, so "retry" can still work', !!db._data.emailParts.X, true);

    // "נסה שוב" אחרי dead — אותה רשומה, והחתיכה שהגיעה בינתיים
    await em.lgEmailPutChunk(db, { messageId: 'X', idx: 0, chunk: 1, chunks: 2, data: chunksOf(PNG, 2)[1] });
    check('G1 retry on a dead email', await em.lgEmailInboundRetry(db, 'X', 'admin', NOW + 10), { ok: true, code: '', message: '' });
    check('G1 back to received, attempts reset', [db._data.emailInbound.X.state, db._data.emailInbound.X.attempts], ['received', 0]);
    check('G1 it shows as pending', await em.lgEmailInboundPending(db, 20, NOW + 11), ['X']);
    const p = await em.lgEmailInboundProcess(db, 'X', { now: NOW + 12, by: 'drain' });
    check('G1 processing from the staged parts completes it', [p.state, p.orderIds], ['done', ['em_X_1']]);
    check('G2 retry on a done email does not create another order',
          [(await em.lgEmailInboundRetry(db, 'X', 'admin', NOW + 20)).code, ordersOf('X').length], ['done', 1]);
    check('G2 retry on a rejected email is refused', (await em.lgEmailInboundRetry(db, 'P', 'admin', NOW + 20)).code, 'rejected');
  }
  {
    // מישהו אחר מחזיק את התפיסה, טרייה
    const parts = await stage(db, 'C', [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG }]);
    db._data.emailInbound.C = { messageId: 'C', parts, state: 'processing', claimedAt: NOW, claimToken: 'other',
                                attempts: 1, createdAt: NOW, updatedAt: NOW };
    const r = await em.lgEmailCommit(db, meta('C', parts), { now: NOW + 1000, by: 't' });
    check('F3 someone else is on it — no second write', [r.state, ordersOf('C')], ['processing', []]);
  }
  {
    // פאנל: failed נסגר ידנית, ואז commit חוזר מחזיר closed
    const parts = await stage(db, 'Z', [{ idx: 0, name: 'a.png', mime: 'image/png', buf: PNG, chunks: 2, skip: [1] }]);
    await em.lgEmailCommit(db, meta('Z', parts), { now: NOW, by: 't' });
    check('G3 a failed email is pending', (await em.lgEmailInboundPending(db, 20, NOW + 1)).includes('Z'), true);
    check('G3 close it by hand', await em.lgEmailInboundClose(db, 'Z', 'admin', ' טופל בטלפון ', NOW + 5), { ok: true, code: '', message: '' });
    const z = db._data.emailInbound.Z;
    check('G3 closed with who, why and an audit line', [z.state, z.closedFrom, z.closedBy, z.closedNote, Object.keys(z.audit).length],
          ['closed', 'failed', 'admin', 'טופל בטלפון', 1]);
    check('G3 closing drops the staged chunks', db._data.emailParts.Z, undefined);
    check('G3 committing again answers closed', (await em.lgEmailCommit(db, meta('Z', parts), { now: NOW + 6 })).state, 'closed');
    check('G3 and it is no longer pending', (await em.lgEmailInboundPending(db, 20, NOW + 7)).includes('Z'), false);
  }

// ═══ I. אין כתיבה בודדת ענקית (RTDB: 16MB לכתיבה) ═════════════════
  {
    const { db: rec, writes } = recorder(seed());
    const files = [0, 1, 2].map(i => ({ idx: i, name: i + '.png', mime: 'image/png', buf: Buffer.concat([PNG, Buffer.alloc(300000, i)]) }));
    const parts = await stage(rec, 'I', files);
    writes.length = 0;
    const r = await em.lgEmailCommit(rec, meta('I', parts), { now: NOW, by: 't' });
    check('I1 three images complete', [r.state, r.orderIds.length], ['done', 3]);
    const sk = sketchWrites;
    check('I1 no single write carries more than one sketch', writes.every(w => sk(w) <= 1), true);
    check('I1 each sketch is its own write', writes.filter(w => sk(w) === 1).length, 3);
    const withOrders = writes.filter(w => w.paths.some(x => x.startsWith('orders/')));
    check('I2 all the orders go in one update — still all or nothing', withOrders.map(w => [w.op, w.paths.filter(x => x.startsWith('orders/')).length]), [['update', 3]]);
    check('I2 that update also closes the record and drops the chunks',
          ['emailInbound/I/state', 'emailParts/I'].every(x => withOrders[0].paths.includes(x)), true);
    check('I2 and it carries no image bytes', withOrders[0].bytes < 20000, true);
  }

// ═══ J. PDF → הזמנה לכל עמוד (חלק 2, אפיון §3.3) ══════════════════
  const PDF3 = fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf', 'synthetic-3p.pdf'));
  const isJpegUrl = s => typeof s === 'string' && s.startsWith('data:image/jpeg;base64,')
    && Buffer.from(s.split(',')[1], 'base64').subarray(0, 2).equals(Buffer.from([0xFF, 0xD8]));
  {
    const { db: rec, writes } = recorder(seed());
    const parts = await stage(rec, 'K', [{ idx: 0, name: 'תכנית.pdf', mime: 'application/pdf', buf: PDF3, chunks: 2 }]);
    writes.length = 0;
    const r = await em.lgEmailCommit(rec, meta('K', parts), { now: NOW, by: 't' });
    check('J1 a 3-page PDF → done, three orders', r, { state: 'done', refNum: 'L1042', orderIds: ['em_K_1', 'em_K_2', 'em_K_3'] });
    const os = [1, 2, 3].map(n => (rec._data.orders || {})['em_K_' + n] || {});
    check('J1 numbered -1..-3', os.map(o => o.refNum), ['L1042-1', 'L1042-2', 'L1042-3']);
    check('J1 each page named "<pdf> · עמוד k/N", as a JPEG',
          os.map(o => [o.files && o.files.f0.name, o.files && o.files.f0.type, o.fileName]),
          [1, 2, 3].map(n => ['תכנית.pdf · עמוד ' + n + '/3', 'image/jpeg', 'תכנית.pdf']));
    check('J1 page n of 3', os.map(o => [o.emailPage, o.emailPages]), [[1, 3], [2, 3], [3, 3]]);
    check('J1 each sketch is a JPEG data URL', [1, 2, 3].map(n => isJpegUrl((rec._data.sketches || {})['em_K_' + n])), [true, true, true]);
    check('J1 no single write carries more than one sketch', writes.every(w => sketchWrites(w) <= 1), true);
    check('J1 each page is its own write', writes.filter(w => sketchWrites(w) === 1).length, 3);
    check('J1 the staged chunks are gone', rec._data.emailParts && rec._data.emailParts.K, undefined);
  }
  {
    const dbj = seed();
    const parts = await stage(dbj, 'K', [
      { idx: 1, name: 'תכנית.pdf', mime: 'application/pdf', buf: PDF3 },
      { idx: 0, name: 'מטבח.jpg', mime: 'image/jpeg', buf: JPEG },
    ]);
    const r = await em.lgEmailCommit(dbj, meta('K', parts), { now: NOW, by: 't' });
    check('J2 an image + a 3-page PDF → four orders', [r.state, (r.orderIds || []).length], ['done', 4]);
    const os = [1, 2, 3, 4].map(n => (dbj._data.orders || {})['em_K_' + n] || {});
    check('J2 attachment order: the image first, then the PDF pages',
          os.map(o => o.files && o.files.f0.name),
          ['מטבח.jpg', 'תכנית.pdf · עמוד 1/3', 'תכנית.pdf · עמוד 2/3', 'תכנית.pdf · עמוד 3/3']);
    check('J2 the position is in the whole email', os.map(o => [o.emailPage, o.emailPages]), [[1, 4], [2, 4], [3, 4], [4, 4]]);
    check('J2 the image is the image', (dbj._data.sketches || {}).em_K_1, 'data:image/jpeg;base64,' + JPEG.toString('base64'));
  }
  {
    // 41 סקיצות — מעבר לתקרה. הרינדור מוחלף בכפיל (opts.pdfToJpegs) — 41 JPEG קטנים
    const dbj = seed();
    const parts = await stage(dbj, 'K', [{ idx: 0, name: 'ענק.pdf', mime: 'application/pdf', buf: Buffer.from('%PDF-1.7 stub') }]);
    const pages = n => async () => Array.from({ length: n }, () => ({ bytes: JPEG, w: 1, h: 1 }));
    const r = await em.lgEmailCommit(dbj, meta('K', parts), { now: NOW, by: 't', pdfToJpegs: pages(41) });
    check('J3 41 sketches → rejected, with the reason', r, { state: 'rejected', reason: 'במייל יש 41 סקיצות — יותר מ-40, לטפל ידנית' });
    check('J3 nothing written', [Object.keys(dbj._data.orders || {}), Object.keys(dbj._data.sketches || {})], [[], []]);
    check('J3 no order number burned', dbj._data.meta.orderCounter, 1041);

    const dbk = seed();
    const p40 = await stage(dbk, 'K', [{ idx: 0, name: 'ענק.pdf', mime: 'application/pdf', buf: Buffer.from('%PDF-1.7 stub') }]);
    const r40 = await em.lgEmailCommit(dbk, meta('K', p40), { now: NOW, by: 't', pdfToJpegs: pages(40) });
    check('J3 exactly 40 sketches is fine', [r40.state, (r40.orderIds || []).length], ['done', 40]);
  }
  {
    // תקלה שאינה של הקובץ (זיכרון, באג) — זמנית: failed, החתיכות נשמרות לניסיון חוזר
    const dbj = seed();
    const parts = await stage(dbj, 'K', [{ idx: 0, name: 'a.pdf', mime: 'application/pdf', buf: PDF3 }]);
    const boom = async () => { throw new Error('out of memory'); };
    const r = await em.lgEmailCommit(dbj, meta('K', parts), { now: NOW, by: 't', pdfToJpegs: boom });
    check('J4 a render crash is transient', r, { state: 'failed', reason: 'out of memory' });
    check('J4 the staged bytes are kept for the retry', !!(dbj._data.emailParts || {}).K, true);
    const r2 = await em.lgEmailInboundProcess(dbj, 'K', { now: NOW + 1000, by: 'drain' });
    check('J4 the retry renders it for real', [r2.state, (r2.orderIds || []).length], ['done', 3]);
  }
  {
    // כפיל שמכבד את maxPages כמו הרינדור האמיתי — לפי תוכן הקובץ: 'A' / 'B' / 'C'
    const sizes = { A: 30, B: 20, C: 3, D: 35 };
    const calls = [];
    const spy = async (buf, opts) => {
      const which = buf.toString(), n = sizes[which];
      calls.push([which, opts && opts.maxPages]);
      if (n > opts.maxPages) {
        throw Object.assign(new Error('x'), { name: 'PdfError', reason: 'ב-PDF יש ' + n + ' עמודים — יותר מ-' + opts.maxPages + ', לטפל ידנית',
                                              numPages: n, maxPages: opts.maxPages });
      }
      return Array.from({ length: n }, () => ({ bytes: JPEG, w: 1, h: 1 }));
    };
    const pdfs = names => names.map((x, i) => ({ idx: i, name: x + '.pdf', mime: 'application/pdf', buf: Buffer.from(x) }));

    const dbj = seed();
    const r = await em.lgEmailCommit(dbj, meta('K', await stage(dbj, 'K', pdfs(['A', 'B', 'C']))), { now: NOW, by: 't', pdfToJpegs: spy });
    check('J6 two PDFs past 40 → rejected with the 40 reason, counting both', r,
          { state: 'rejected', reason: 'במייל יש 50 סקיצות — יותר מ-40, לטפל ידנית' });
    check('J6 the renderer is told how much room is left, and the third PDF is never rendered',
          calls, [['A', 30], ['B', 10]]);
    check('J6 nothing written', [Object.keys(dbj._data.orders || {}), Object.keys(dbj._data.sketches || {})], [[], []]);

    // PDF של 35 עמודים לבד — זה כלל ה-30 של ה-PDF, לא תקרת המייל
    const dbk = seed();
    const r2 = await em.lgEmailCommit(dbk, meta('K', await stage(dbk, 'K', pdfs(['D']))), { now: NOW, by: 't', pdfToJpegs: spy });
    check('J6 a 35-page PDF alone keeps its own 30-page reason', r2.reason, 'ב-PDF יש 35 עמודים — יותר מ-30, לטפל ידנית');

    // 15 תמונות + PDF של 35 עמודים: נשאר מקום ל-25, אבל ה-PDF עצמו מעל 30 —
    // הסיבה נוקבת ב-30 (כלל ה-PDF), לא ב-25 (המקום שנשאר) שהיה מבלבל את בן
    const dbm = seed();
    calls.length = 0;
    const imgs = Array.from({ length: 15 }, (_, i) => ({ idx: i, name: 'i' + i + '.jpg', mime: 'image/jpeg', buf: JPEG }));
    const pm = await stage(dbm, 'K', imgs.concat([{ idx: 15, name: 'D.pdf', mime: 'application/pdf', buf: Buffer.from('D') }]));
    const r3 = await em.lgEmailCommit(dbm, meta('K', pm), { now: NOW, by: 't', pdfToJpegs: spy });
    check('J6 15 images + a 35-page PDF: the renderer had room for 25', calls, [['D', 25]]);
    check('J6 15 images + a 35-page PDF: the reason names 30, not 25', r3,
          { state: 'rejected', reason: 'ב-PDF יש 35 עמודים — יותר מ-30, לטפל ידנית' });
  }
  {
    // תקציב זמן: כל רינדור "לוקח" 41 שניות בשעון מזויף — הקובץ השני לא מתחיל
    let t = 0;
    const calls = [];
    const slow = async () => { calls.push(t); t += 41000; return [{ bytes: JPEG, w: 1, h: 1 }]; };
    const dbj = seed();
    const parts = await stage(dbj, 'K', [{ idx: 0, name: 'a.pdf', mime: 'application/pdf', buf: Buffer.from('a') },
                                         { idx: 1, name: 'b.pdf', mime: 'application/pdf', buf: Buffer.from('b') }]);
    const r = await em.lgEmailCommit(dbj, meta('K', parts), { now: NOW, by: 't', pdfToJpegs: slow, clock: () => t });
    check('J7 over the render budget → rejected, plainly', r,
          { state: 'rejected', reason: 'עיבוד הקבצים במייל לקח יותר מדי זמן — לטפל ידנית' });
    check('J7 the second file was never started', calls.length, 1);
    check('J7 nothing written', Object.keys(dbj._data.orders || {}), []);
  }
  {
    // דדליין מוחלט באמצע PDF: הרינדור האמיתי, ושעון שמתקדם 10 שניות בכל
    // קריאה. הדדליין (25) עובר לפני עמוד 2 של ה-PDF — לא "40 שניות לקובץ"
    let t = 0;
    const clock = () => (t += 10);
    const dbj = seed();
    const parts = await stage(dbj, 'K', [{ idx: 0, name: 'a.pdf', mime: 'application/pdf', buf: PDF3 }]);
    const r = await em.lgEmailCommit(dbj, meta('K', parts), { now: NOW, by: 't', clock, deadline: 25 });
    check('J8 the deadline passes mid-PDF → rejected, plainly', r,
          { state: 'rejected', reason: 'עיבוד הקבצים במייל לקח יותר מדי זמן — לטפל ידנית' });
    check('J8 the clock was read before the file and before pages 1 and 2 only', t, 30);
    check('J8 nothing written', [Object.keys(dbj._data.orders || {}), Object.keys(dbj._data.sketches || {})], [[], []]);
    check('J8 no order number burned', dbj._data.meta.orderCounter, 1041);

    // בלי opts.deadline — ברירת המחדל היא 40 שניות מתחילת העיבוד, והיא מגיעה לרינדור
    const seen = [];
    const spy = async (buf, o) => { seen.push(o.deadline); return [{ bytes: JPEG, w: 1, h: 1 }]; };
    const dbk = seed();
    const pk = await stage(dbk, 'K', [{ idx: 0, name: 'a.pdf', mime: 'application/pdf', buf: Buffer.from('a') }]);
    await em.lgEmailCommit(dbk, meta('K', pk), { now: NOW, by: 't', pdfToJpegs: spy, clock: () => 1000 });
    check('J8 default deadline = start + 40s, handed to the renderer', seen, [1000 + em.EM_RENDER_BUDGET_MS]);
  }
  {
    // תקרת הגודל המוצהר חלה גם על PDF — לפני שקוראים מהבסיס
    const dbj = seed();
    const big = [{ idx: 0, name: 'big.pdf', mime: 'application/pdf', size: em.EM_PART_MAX_BYTES + 1, chunks: 1 }];
    const r = await em.lgEmailCommit(dbj, meta('K', big), { now: NOW, by: 't' });
    check('J5 a declared-oversize PDF is rejected', [r.state, r.reason], ['rejected', 'הקובץ big.pdf גדול מדי (10MB)']);
  }

// ═══ H. רשימת השולחים המורשים ══════════════════════════════════════
  {
    const withEnv = (vars, fn) => {
      const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
      try { return fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
    };
    const allow = (project, list, addr) => withEnv(
      { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: project }), EMAIL_INBOUND_ALLOWED: list },
      () => env.lgEmailInboundAllowed(addr).allowed);
    check('H1 a listed address is allowed, whatever its case', allow('luz-glass-test', 'luz-glass-test:ben@x.com', 'Ben@X.com'), true);
    check('H1 also written as "Name" <addr>', allow('luz-glass-test', 'luz-glass-test:ben@x.com', '"Ben" <BEN@x.com>'), true);
    check('H2 anyone else is not', allow('luz-glass-test', 'luz-glass-test:ben@x.com', 'a@b.com'), false);
    check('H3 * under its own project lets everyone in', allow('lussglass', 'lussglass:*', 'anyone@client.co.il'), true);
    check('H4 * signed for another project lets nobody in', allow('luz-glass-test', 'lussglass:*', 'ben@x.com'), false);
    check('H5 an empty list lets nobody in', allow('luz-glass-test', '', 'ben@x.com'), false);
    check('H5 refusals say why', typeof withEnv({ EMAIL_INBOUND_ALLOWED: '' }, () => env.lgEmailInboundAllowed('a@b.com').reason), 'string');
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll email inbound checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
