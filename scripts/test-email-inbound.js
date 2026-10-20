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
 *   E. מה נקלט: PDF נדחה (חלק 2), docx לבד → ignored (Review Focus 5),
 *      docx לצד תמונה → מדולג ונרשם; "תמונה" שלא מזוהה (HEIC, GIF, בייטים
 *      שאינם תמונה) → מדולגת ונרשמת כמו docx (R9); גדול מדי → נדחה.
 *      תמונה גדולה → oversize, כמו WhatsApp.
 *   F. שולח לא מזוהה, שלושה ניסיונות → dead, תפיסה של מישהו אחר.
 *   G. "נסה שוב" / "טופל ידנית" / מה ממתין — אותו חוזה כמו WhatsApp.
 *   H. רשימת השולחים המורשים — חתומה על הפרויקט.
 *
 * Run: node scripts/test-email-inbound.js
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const env = require(path.join(ROOT, 'api', '_env.js'));
const em  = require(path.join(ROOT, 'api', '_email-inbound.js'));

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
    check('A4 the constants', [em.EM_INBOX, em.EM_PARTS, em.EM_MAX_ATTEMPTS, em.EM_PART_MAX_BYTES, em.EM_PDF_REASON],
          ['emailInbound', 'emailParts', 3, 10 * 1024 * 1024, 'PDF עדיין לא נתמך במייל — לטפל ידנית']);
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
    const parts = await stage(db, 'P', [
      { idx: 0, name: 'תכנית.pdf', mime: 'application/pdf', buf: Buffer.from('%PDF-1.7 x') },
      { idx: 1, name: 'a.jpg', mime: 'image/jpeg', buf: JPEG },
    ]);
    const r = await em.lgEmailCommit(db, meta('P', parts), { now: NOW, by: 't' });
    check('E1 a PDF beside an image rejects the whole email (part 2 will render it)', r, { state: 'rejected', reason: em.EM_PDF_REASON });
    check('E1 zero orders', ordersOf('P'), []);
    check('E1 the staged bytes are dropped — a rejected email is never retried', db._data.emailParts.P, undefined);
    check('E1 a PDF known only by its name counts too',
          (await em.lgEmailCommit(db, meta('P2', [{ idx: 0, name: 'X.PDF', mime: 'application/octet-stream', size: 5, chunks: 1 }]), { now: NOW })).state,
          'rejected');
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
    const raw = seed();
    const writes = [];
    // עוטף את הכפיל ורושם כל set / update: נתיב, אילו מפתחות, וכמה בייטים
    const rec = {
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
    const files = [0, 1, 2].map(i => ({ idx: i, name: i + '.png', mime: 'image/png', buf: Buffer.concat([PNG, Buffer.alloc(300000, i)]) }));
    const parts = await stage(rec, 'I', files);
    writes.length = 0;
    const r = await em.lgEmailCommit(rec, meta('I', parts), { now: NOW, by: 't' });
    check('I1 three images complete', [r.state, r.orderIds.length], ['done', 3]);
    const sk = w => w.paths.filter(x => x.startsWith('sketches/')).length;
    check('I1 no single write carries more than one sketch', writes.every(w => sk(w) <= 1), true);
    check('I1 each sketch is its own write', writes.filter(w => sk(w) === 1).length, 3);
    const withOrders = writes.filter(w => w.paths.some(x => x.startsWith('orders/')));
    check('I2 all the orders go in one update — still all or nothing', withOrders.map(w => [w.op, w.paths.filter(x => x.startsWith('orders/')).length]), [['update', 3]]);
    check('I2 that update also closes the record and drops the chunks',
          ['emailInbound/I/state', 'emailParts/I'].every(x => withOrders[0].paths.includes(x)), true);
    check('I2 and it carries no image bytes', withOrders[0].bytes < 20000, true);
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
