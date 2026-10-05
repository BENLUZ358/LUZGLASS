#!/usr/bin/env node
/**
 * קליטת סקיצות מ-WhatsApp — שלב 2 (תמונות בלבד).
 * אפיון: docs/superpowers/specs/2026-10-04-whatsapp-sketch-intake-design.md §2.1–2.7
 *
 * מה נבדק כאן, ולמה כל חלק קיים:
 *
 *   A. התמונה — passthrough. קובץ WhatsApp רגיל (בלי EXIF) יוצא **זהה
 *      בייט-לבייט** (החלטת בן 2, §11.1). רק כשמגיע EXIF — GPS ודומיו
 *      יורדים, ה-orientation נשאר, ונתוני ה-scan לא משתנים.
 *   B. זיהוי השולח — 972→0, users מדויק, אחרת כרטיס חשבשבת **יחיד**,
 *      אחרת "לא מזוהה". לא מנחשים.
 *   C. סינון ה-webhook — רק תמונה / מסמך בצ'אט פרטי.
 *   D. רשימת השולחים המורשים — חתומה על הפרויקט, כמו רשימת הלקוחות
 *      ביוצא. ריקה = אף אחד.
 *   E. רישום create-once, תפיסה ועיבוד — כפילות של GREEN API לא יוצרת
 *      שתי סקיצות, כשל לא משאיר חצי הזמנה, ו-PDF נרשם "לא נתמך".
 *   F. ה-webhook עצמו — token, מופע, 200 מהיר, 500 כשהרישום נכשל.
 *
 * Run: node scripts/test-wa-inbound.js
 */
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const img = require(path.join(ROOT, 'api', '_wa-image.js'));
const rcp = require(path.join(ROOT, 'api', '_wa-recipient.js'));
const env = require(path.join(ROOT, 'api', '_env.js'));
const inb = require(path.join(ROOT, 'api', '_wa-inbound.js'));

// ─── בוני JPEG סינתטיים ────────────────────────────────────────────
//  לא צריך שיהיו ניתנים לפענוח — רק מבנה סגמנטים נכון. נתוני ה-scan
//  הם רצף מזוהה, ולכן אפשר לבדוק שלא נגעו בהם בכלל.
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, marker, len >> 8, len & 0xFF]), payload]);
};
const JFIF = seg(0xE0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'));
const ICC  = seg(0xE2, Buffer.from('ICC_PROFILE\0\x01\x01fake-icc', 'binary'));
const DQT  = seg(0xDB, Buffer.alloc(65, 1));
const SOF  = seg(0xC0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0]));
const SCAN = Buffer.concat([seg(0xDA, Buffer.from([1, 1, 0, 0, 63, 0])),
                            Buffer.from([0x12, 0xFF, 0x00, 0x34, 0x56, 0xAB]),   // FF00 = stuffing, לא marker
                            Buffer.from([0xFF, 0xD9])]);
const SOI  = Buffer.from([0xFF, 0xD8]);

//  EXIF מינימלי: IFD0 עם Orientation, ועם מצביע GPS אם ביקשו.
function exifApp1({ orientation, gps, bigEndian }) {
  const le = !bigEndian;
  const u16 = v => le ? [v & 0xFF, v >> 8] : [v >> 8, v & 0xFF];
  const u32 = v => le ? [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, v >>> 24]
                      : [v >>> 24, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
  const entries = [];
  if (orientation) entries.push([...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0]);
  if (gps)         entries.push([...u16(0x8825), ...u16(4), ...u32(1), ...u32(8 + 2 + 12 * 2 + 4)]);
  const ifd = [...u16(entries.length), ...entries.flat(), ...u32(0)];
  const gpsIfd = gps ? [...u16(1), ...u16(0x0002), ...u16(5), ...u32(3), ...u32(0), ...u32(0)] : [];
  const tiff = [...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(42), ...u32(8), ...ifd, ...gpsIfd,
                ...Buffer.from('31.7683N 35.2137E')];
  return seg(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from(tiff)]));
}
const XMP = seg(0xE1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude="31"/>', 'binary'));
const APP13 = seg(0xED, Buffer.from('Photoshop 3.0\0fake', 'binary'));
const COM = seg(0xFE, Buffer.from('taken at home', 'binary'));

const jpeg = (...parts) => Buffer.concat([SOI, ...parts]);
const tail = b => b.subarray(b.indexOf(Buffer.from([0xFF, 0xDA])));   // מ-SOS ועד הסוף
const markers = b => {
  const out = []; let i = 2;
  while (i < b.length && b[i] === 0xFF && b[i + 1] !== 0xDA) {
    out.push(b[i + 1].toString(16)); i += 2 + b.readUInt16BE(i + 2);
  }
  return out;
};

// ═══ A. התמונה ══════════════════════════════════════════════════════
{
  const plain = jpeg(JFIF, DQT, SOF, SCAN);
  check('A1 JPEG is recognised by its bytes', img.sniffImage(plain), 'image/jpeg');
  check('A1 PNG is recognised', img.sniffImage(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'image/png');
  check('A1 WebP is recognised', img.sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary')), 'image/webp');
  check('A1 a PDF is not an image, whatever it is called', img.sniffImage(Buffer.from('%PDF-1.7\n')), null);
  check('A1 nor is an empty file', img.sniffImage(Buffer.alloc(0)), null);

  // החלטת בן 2: פלט WhatsApp רגיל נשמר בדיוק כפי שהתקבל
  const out = img.stripJpegMeta(plain);
  check('A2 a WhatsApp JPEG without EXIF comes back as the very same buffer', out === plain, true);

  const withIcc = jpeg(JFIF, ICC, DQT, SOF, SCAN);
  check('A2 a colour profile alone is not metadata to strip', img.stripJpegMeta(withIcc) === withIcc, true);

  // EXIF עם GPS וסיבוב 6 — GPS יורד, הסיבוב נשאר
  for (const bigEndian of [false, true]) {
    const tag = bigEndian ? 'big-endian' : 'little-endian';
    const dirty = jpeg(JFIF, exifApp1({ orientation: 6, gps: true, bigEndian }), XMP, APP13, ICC, COM, DQT, SOF, SCAN);
    const clean = img.stripJpegMeta(dirty);
    check(`A3 ${tag}: the scan data is untouched, byte for byte`, tail(clean).equals(tail(dirty)), true);
    check(`A3 ${tag}: JFIF, ICC, tables and frame are kept, XMP/APP13/COM are gone`,
          markers(clean), ['e0', 'e1', 'e2', 'db', 'c0']);
    check(`A3 ${tag}: no GPS survives`, clean.includes(Buffer.from('31.7683N')), false);
    check(`A3 ${tag}: and no XMP either`, clean.includes(Buffer.from('GPSLatitude')), false);
    check(`A3 ${tag}: the rotation is still 6`, img.jpegOrientation(clean), 6);
  }

  const upright = jpeg(JFIF, exifApp1({ orientation: 1, gps: true }), DQT, SOF, SCAN);
  check('A4 orientation 1 needs no EXIF at all', markers(img.stripJpegMeta(upright)), ['e0', 'db', 'c0']);
  check('A4 and reads back as upright', img.jpegOrientation(img.stripJpegMeta(upright)), 1);

  // קובץ שבור לא נזרק ולא "מתוקן" — חוזר כמו שהוא, וההחלטה למעלה
  const broken = Buffer.concat([SOI, Buffer.from([0xFF, 0xE1, 0xFF, 0xFF, 1, 2, 3])]);
  check('A5 a truncated JPEG is returned untouched rather than half-rewritten',
        img.stripJpegMeta(broken) === broken, true);
}

// ═══ B. זיהוי השולח ═════════════════════════════════════════════════
(async () => {
  check('B1 972 chat id becomes the local number', rcp.waChatToLocal('972501234567@c.us'), '0501234567');
  check('B1 a group is not a sender', rcp.waChatToLocal('120363025@g.us'), '');
  check('B1 nor is a hidden lid id', rcp.waChatToLocal('1234567890@lid'), '');

  const db = fakeDb({
    users: {
      '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201' },
    },
    hashavshevetAccounts: {
      '14300': { key: '14300', name: 'זגגות הצפון', phone: '052-111-2222' },
      '14400': { key: '14400', name: 'שותף א', phone: '053-333-4444' },
      '14401': { key: '14401', name: 'שותף ב', phone: '0533334444' },
    },
  });

  const viaUser = await rcp.lgClientFromWaSender(db, '972501234567@c.us');
  check('B2 a registered phone is matched through users', viaUser,
        { matched: true, via: 'users', phone: '0501234567', loginPhone: '0501234567',
          customerId: '14201', name: 'המקום לאמבט' });

  const viaCard = await rcp.lgClientFromWaSender(db, '972521112222@c.us');
  check('B3 otherwise a single Hashavshevet card with those digits', viaCard,
        { matched: true, via: 'hashavshevet', phone: '0521112222', loginPhone: '',
          customerId: '14300', name: 'זגגות הצפון' });

  const shared = await rcp.lgClientFromWaSender(db, '972533334444@c.us');
  check('B4 two cards on one number is not a match — nobody guesses', shared.matched, false);
  check('B4 and the sender is still known', shared.phone, '0533334444');

  const nobody = await rcp.lgClientFromWaSender(db, '972549999999@c.us');
  check('B5 an unknown number is unassigned', nobody,
        { matched: false, via: 'none', phone: '0549999999', loginPhone: '', customerId: '', name: '' });
})().then(async () => {

// ═══ C. סינון ה-webhook ══════════════════════════════════════════════
  const hook = (over = {}) => ({
    typeWebhook: 'incomingMessageReceived',
    instanceData: { idInstance: 7100, wid: '972500000000@c.us', typeInstance: 'whatsapp' },
    timestamp: 1759650000,
    idMessage: 'BAE5F4886F6F2D05',
    senderData: { chatId: '972501234567@c.us', sender: '972501234567@c.us', senderName: 'דנה' },
    messageData: {
      typeMessage: 'imageMessage',
      fileMessageData: { downloadUrl: 'https://do-media.green-api.com/x/abc.jpg',
                         caption: '  מקלחון   חדר הורים  ', fileName: 'abc.jpg', mimeType: 'image/jpeg' },
    },
    ...over,
  });
  const P = b => inb.lgWaInboundParse(b);

  const img1 = P(hook());
  check('C1 an image in a private chat is recorded', img1.action, 'record');
  check('C1 with what processing needs, and nothing more', img1.entry,
        { idMessage: 'BAE5F4886F6F2D05', chatId: '972501234567@c.us', sender: '0501234567',
          typeMessage: 'imageMessage', kind: 'image', caption: 'מקלחון חדר הורים', fileName: 'abc.jpg',
          mimeType: 'image/jpeg', downloadUrl: 'https://do-media.green-api.com/x/abc.jpg',
          timestamp: 1759650000000 });

  check('C2 text is ignored', P(hook({ messageData: { typeMessage: 'textMessage' } })).action, 'ignore');
  check('C2 our own outgoing messages are ignored', P(hook({ typeWebhook: 'outgoingMessageReceived' })).action, 'ignore');
  check('C2 status webhooks are ignored', P(hook({ typeWebhook: 'stateInstanceChanged' })).action, 'ignore');
  check('C2 a group is ignored', P(hook({ senderData: { chatId: '120363@g.us' } })).action, 'ignore');
  check('C2 a lid chat is ignored', P(hook({ senderData: { chatId: '123@lid' } })).action, 'ignore');
  check('C2 a message without an id is ignored', P(hook({ idMessage: '' })).action, 'ignore');
  check('C2 a video is ignored', P(hook({ messageData: { typeMessage: 'videoMessage', fileMessageData: {} } })).action, 'ignore');

  const asDoc = P(hook({ messageData: { typeMessage: 'documentMessage',
    fileMessageData: { downloadUrl: 'u', fileName: 'IMG_1.JPG', mimeType: 'image/jpeg', caption: '' } } }));
  check('C3 an image sent "as a document" is still an image', [asDoc.action, asDoc.entry.kind], ['record', 'image']);

  const pdf = P(hook({ messageData: { typeMessage: 'documentMessage',
    fileMessageData: { downloadUrl: 'u', fileName: 'מקלחון.pdf', mimeType: 'application/pdf' } } }));
  check('C4 a PDF is recorded, so it shows up — not silently dropped', [pdf.action, pdf.entry.kind], ['record', 'pdf']);

  const other = P(hook({ messageData: { typeMessage: 'documentMessage',
    fileMessageData: { downloadUrl: 'u', fileName: 'a.docx', mimeType: 'application/msword' } } }));
  check('C4 any other document is ignored, as today', other.action, 'ignore');

  const long = P(hook({ messageData: { typeMessage: 'imageMessage',
    fileMessageData: { downloadUrl: 'u', caption: 'א'.repeat(200), mimeType: 'image/jpeg' } } }));
  check('C5 the caption is cut to 80 characters', long.entry.caption.length, 80);

  check('C6 an id with characters Firebase rejects gets a safe key',
        inb.lgWaInboundKey('3EB0.12$#[x]/y'), '3EB0_12___x__y');

// ═══ D. רשימת השולחים המורשים ══════════════════════════════════════
  const withEnv = (vars, fn) => {
    const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
    try { return fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  };
  const SA = JSON.stringify({ project_id: 'luz-glass-test' });
  const allow = (list, phone) => withEnv({ FIREBASE_SERVICE_ACCOUNT: SA, GREENAPI_INBOUND_ALLOWED: list },
                                          () => env.lgWaInboundAllowed(phone).allowed);
  check('D1 a listed sender is allowed', allow('luz-glass-test:0501234567', '0501234567'), true);
  check('D1 digits are compared, not formatting', allow('luz-glass-test:050-123-4567', '0501234567'), true);
  check('D2 anyone else is not', allow('luz-glass-test:0501234567', '0529999999'), false);
  check('D3 an empty list lets nobody in', allow('', '0501234567'), false);
  check('D4 a list signed for another project lets nobody in', allow('lussglass:0501234567', '0501234567'), false);

// ═══ E. רישום, תפיסה, עיבוד ══════════════════════════════════════════
  const PHOTO = jpeg(JFIF, DQT, SOF, SCAN);
  const okFetch = (bytes, calls) => async (url) => {
    calls && calls.push(url);
    return { ok: true, status: 200, headers: { get: () => String(bytes.length) },
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
  };
  const seed = () => fakeDb({
    meta: { orderCounter: 1041 },
    users: { '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201' } },
  });
  const NOW = 1759650005000;

  {
    const db = seed();
    const r1 = await inb.lgWaInboundRecord(db, img1.entry, NOW);
    const r2 = await inb.lgWaInboundRecord(db, img1.entry, NOW + 50);
    check('E1 the first webhook records the message', r1, { key: 'BAE5F4886F6F2D05', created: true });
    check('E1 GREEN API resending it changes nothing', r2, { key: 'BAE5F4886F6F2D05', created: false });
    const rec = db._data.waInbound.BAE5F4886F6F2D05;
    check('E1 recorded as received, with no attempts yet', [rec.state, rec.attempts, rec.createdAt], ['received', 0, NOW]);

    const calls = [];
    const res = await inb.lgWaInboundProcess(db, 'BAE5F4886F6F2D05', { fetchImpl: okFetch(PHOTO, calls), now: NOW + 100, by: 't' });
    check('E2 processing succeeds', res.ok, true);
    check('E2 the file was downloaded once, from GREEN API', calls, ['https://do-media.green-api.com/x/abc.jpg']);

    const id = 'wa_BAE5F4886F6F2D05_1';
    const o = db._data.orders[id];
    check('E3 one sketch lands in the existing queue', Object.keys(db._data.orders), [id]);
    check('E3 as a new, unseen sketch', [o.stage, o.status, o.sketchSeenAt], ['', 'ממתין לאישור', undefined]);
    check('E3 marked as WhatsApp', [o.source, o.waMessageId, o.waPage, o.waPages, o.waSender, o.waReceivedAt],
          ['whatsapp', 'BAE5F4886F6F2D05', 1, 1, '0501234567', 1759650000000]);
    check('E3 for the identified client, so it shows in their portal (D2)',
          [o.orderClient, o.client, o.phone, o.clientPhone, o.customerId, o.businessName, o.waUnassigned],
          ['המקום לאמבט', 'המקום לאמבט', '0501234567', '0501234567', '14201', 'המקום לאמבט', undefined]);
    check('E3 named from the caption', o.sketchName, 'מקלחון חדר הורים');
    check('E3 with the next order number, no page suffix for a single image',
          [o.refNum, o.orderNum, db._data.meta.orderCounter], ['L1042', 'L1042', 1042]);
    check('E3 unpaid, like every portal upload', o.paymentStatus, 'unpaid');

    // §14: סקיצת WhatsApp נשמרת ב-sketches/ בלבד
    check('E4 the image lives in sketches/ only', [o.hasSketch, 'sketch' in o], [true, false]);
    check('E4 exactly the bytes WhatsApp sent', db._data.sketches[id],
          'data:image/jpeg;base64,' + PHOTO.toString('base64'));

    const done = db._data.waInbound.BAE5F4886F6F2D05;
    check('E5 the log says done and points at the order', [done.state, done.orderIds, done.refNum],
          ['done', [id], 'L1042']);
    check('E5 the signed download link is not kept', 'downloadUrl' in done, false);
    check('E5 the match is recorded', done.clientMatch, { via: 'users', customerId: '14201' });

    const again = await inb.lgWaInboundProcess(db, 'BAE5F4886F6F2D05', { fetchImpl: okFetch(PHOTO), now: NOW + 200, by: 't' });
    check('E6 processing a finished message again does nothing', [again.ok, again.reason], [false, 'done']);
    check('E6 still one order, still one number', [Object.keys(db._data.orders).length, db._data.meta.orderCounter], [1, 1042]);

    // הזמנה שעברה lgNormalizeOrder חייבת להיראות כמו שהתור מצפה
    const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext('function lgStatusToStage(){return "";}\nfunction lgStageToStatus(){return "ממתין לאישור";}\n'
                    + SRC.match(/function lgNormalizeOrder[\s\S]*?\n}/)[0], ctx);
    const n = ctx.lgNormalizeOrder(o);
    check('E7 the queue sees it with a sketch and no inline copy', [n.hasSketch, n.sketch, n.source], [true, null, 'whatsapp']);
  }

  {
    const db = seed();
    const e = P(hook({ idMessage: 'UNK1', senderData: { chatId: '972549999999@c.us' } })).entry;
    await inb.lgWaInboundRecord(db, e, NOW);
    await inb.lgWaInboundProcess(db, 'UNK1', { fetchImpl: okFetch(PHOTO), now: NOW + 1, by: 't' });
    const o = db._data.orders.wa_UNK1_1;
    check('E8 an unknown sender is marked unassigned, with their number visible',
          [o.waUnassigned, o.orderClient, o.clientPhone, o.customerId], [true, 'לא מזוהה · 054-9999999', '0549999999', '']);
  }

  {
    const db = seed();
    const e = P(hook({ idMessage: 'NOCAP', messageData: { typeMessage: 'imageMessage',
      fileMessageData: { downloadUrl: 'u', mimeType: 'image/jpeg' } } })).entry;
    await inb.lgWaInboundRecord(db, e, NOW);
    await inb.lgWaInboundProcess(db, 'NOCAP', { fetchImpl: okFetch(PHOTO), now: NOW + 1, by: 't' });
    check('E9 no caption means no name — never an invented one', db._data.orders.wa_NOCAP_1.sketchName, '');
  }

  // כשל הורדה — אפס הזמנות, אפס מספרים, ונשאר לניסיון חוזר
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'F1' }, NOW);
    const bad = async () => ({ ok: false, status: 502, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await inb.lgWaInboundProcess(db, 'F1', { fetchImpl: bad, now: NOW + 1, by: 't' });
    const rec = db._data.waInbound.F1;
    check('E10 a failed download fails visibly', [r.ok, rec.state, rec.attempts], [false, 'failed', 1]);
    check('E10 and leaves nothing half-written', [db._data.orders, db._data.sketches], [undefined, undefined]);
    check('E10 the claim is released for a retry', !rec.claimedAt, true);
    check('E10 the reason is kept for the panel', /502/.test(rec.lastError), true);

    const r2 = await inb.lgWaInboundProcess(db, 'F1', { fetchImpl: okFetch(PHOTO), now: NOW + 2, by: 't' });
    check('E11 a retry succeeds and creates exactly one sketch',
          [r2.ok, Object.keys(db._data.orders)], [true, ['wa_F1_1']]);
  }

  // תפיסה טרייה חוסמת עיבוד מקביל
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'C1' }, NOW);
    const c1 = await inb.lgWaInboundClaim(db, 'C1', 'a', NOW + 1);
    const c2 = await inb.lgWaInboundClaim(db, 'C1', 'b', NOW + 2);
    check('E12 two processors cannot hold the same message', [c1.claimed, c2.claimed], [true, false]);
    const c3 = await inb.lgWaInboundClaim(db, 'C1', 'b', NOW + 1 + inb.CLAIM_TTL_MS + 1);
    check('E12 but a claim abandoned by a dead function expires', c3.claimed, true);
  }

  // שלושה כשלונות → dead, נשאר גלוי
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'D1' }, NOW);
    const bad = async () => ({ ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    for (let i = 0; i < 3; i++) await inb.lgWaInboundProcess(db, 'D1', { fetchImpl: bad, now: NOW + i, by: 't' });
    const r = await inb.lgWaInboundProcess(db, 'D1', { fetchImpl: okFetch(PHOTO), now: NOW + 9, by: 't' });
    check('E13 after three failures it stops retrying by itself', [r.ok, db._data.waInbound.D1.state], [false, 'dead']);
    check('E13 and nothing was created', db._data.orders, undefined);
  }

  // קובץ שאינו תמונה למרות השם
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'NI' }, NOW);
    await inb.lgWaInboundProcess(db, 'NI', { fetchImpl: okFetch(Buffer.from('<html>expired</html>')), now: NOW + 1, by: 't' });
    const rec = db._data.waInbound.NI;
    check('E14 bytes that are not an image are rejected for good, not retried', rec.state, 'rejected');
    check('E14 with nothing in the queue', db._data.orders, undefined);
  }

  // החלטת בן §13.3: מעל התקרה נשמר כמו שהוא, ומסומן לבדיקה
  {
    const db = seed();
    const big = Buffer.concat([jpeg(JFIF, DQT, SOF), seg(0xDA, Buffer.from([1, 1, 0, 0, 63, 0])),
                               Buffer.alloc(inb.WA_IMAGE_FLAG_BYTES() + 10, 0x11), Buffer.from([0xFF, 0xD9])]);
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'BIG' }, NOW);
    await inb.lgWaInboundProcess(db, 'BIG', { fetchImpl: okFetch(big), now: NOW + 1, by: 't' });
    const rec = db._data.waInbound.BIG;
    check('E15 an oversized image is still saved', [rec.state, !!db._data.sketches.wa_BIG_1], ['done', true]);
    check('E15 and flagged for a look in the intake panel', rec.oversize, true);
    check('E15 the flag threshold is the one configured value, 800KB by default', inb.WA_IMAGE_FLAG_BYTES(), 800 * 1024);
  }

  // תקרה קשיחה — מעבר לה לא נכנס ל-RTDB בכלל
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'HUGE' }, NOW);
    const huge = async () => ({ ok: true, status: 200, headers: { get: () => String(inb.WA_IMAGE_MAX_BYTES + 1) },
                                arrayBuffer: async () => { throw new Error('must not read the body'); } });
    await inb.lgWaInboundProcess(db, 'HUGE', { fetchImpl: huge, now: NOW + 1, by: 't' });
    check('E16 a file over the hard limit is rejected before it is read', db._data.waInbound.HUGE.state, 'rejected');
  }

  // PDF: נרשם, נדחה בבירור, בלי הורדה
  {
    const db = seed();
    const r = await inb.lgWaInboundRecord(db, { ...pdf.entry, idMessage: 'PDF1' }, NOW);
    const rec = db._data.waInbound.PDF1;
    check('E17 a PDF is recorded as unsupported, not lost', [r.created, rec.state, rec.reason],
          [true, 'rejected', 'PDF עדיין לא נתמך — לטפל ידנית ב-WhatsApp']);
    check('E17 without keeping a download link', 'downloadUrl' in rec, false);
    let fetched = false;
    await inb.lgWaInboundProcess(db, 'PDF1', { fetchImpl: async () => { fetched = true; }, now: NOW + 1, by: 't' });
    check('E17 and processing never downloads it', fetched, false);
  }

  // אין downloadUrl → downloadFile של GREEN API
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'NOURL', downloadUrl: '' }, NOW);
    const calls = [];
    const f = async (url, init) => {
      calls.push(url.replace(/\/[^/]*$/, '/<token>'));
      if (/downloadFile/.test(url)) {
        check('E18 downloadFile is asked for this exact message', JSON.parse(init.body),
              { chatId: '972501234567@c.us', idMessage: 'NOURL' });
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ downloadUrl: 'https://media/fresh.jpg' }) };
      }
      return okFetch(PHOTO)(url);
    };
    const keep = [process.env.GREENAPI_ID_INSTANCE, process.env.GREENAPI_TOKEN];
    process.env.GREENAPI_ID_INSTANCE = '7100'; process.env.GREENAPI_TOKEN = 'secret-token';
    let r;
    try { r = await inb.lgWaInboundProcess(db, 'NOURL', { fetchImpl: f, now: NOW + 1, by: 't' }); }
    finally {
      if (keep[0] === undefined) delete process.env.GREENAPI_ID_INSTANCE; else process.env.GREENAPI_ID_INSTANCE = keep[0];
      if (keep[1] === undefined) delete process.env.GREENAPI_TOKEN; else process.env.GREENAPI_TOKEN = keep[1];
    }
    check('E18 a missing link is fetched fresh from GREEN API', [r.ok, calls],
          [true, ['https://api.green-api.com/waInstance7100/downloadFile/<token>', 'https://media/<token>']]);
    check('E18 the token never reaches the log', JSON.stringify(db._data).includes('secret-token'), false);
  }

  // משתמש רשום בלי שם (למשל מספר אדמין ב-TEST) — לא שורה ריקה בתור
  {
    const db = fakeDb({ meta: { orderCounter: 1 }, users: { '0501234567': { role: 'admin' } } });
    await inb.lgWaInboundRecord(db, { ...img1.entry, idMessage: 'NONAME' }, NOW);
    await inb.lgWaInboundProcess(db, 'NONAME', { fetchImpl: okFetch(PHOTO), now: NOW + 1, by: 't' });
    check('E19 a registered user with no name shows their number, not a blank client',
          db._data.orders.wa_NONAME_1.orderClient, '050-1234567');
  }

// ═══ F. ה-webhook ════════════════════════════════════════════════════
  const hookMod = require(path.join(ROOT, 'api', 'wa-inbound.js'));
  const ENV = { FIREBASE_SERVICE_ACCOUNT: SA, GREENAPI_WEBHOOK_TOKEN: 'hook-secret',
                GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0501234567' };
  const call = async (req, deps) => {
    const keep = {}; for (const k of Object.keys(ENV)) { keep[k] = process.env[k]; process.env[k] = ENV[k]; }
    try { return await hookMod.handleInbound(req, deps); }
    finally { for (const k of Object.keys(ENV)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  };
  const req = (body, auth = 'Bearer hook-secret', method = 'POST') => ({ method, headers: { authorization: auth }, body });

  {
    const db = seed(); const later = [];
    const r = await call(req(hook()), { db, waitUntil: p => later.push(p), now: NOW, fetchImpl: okFetch(PHOTO) });
    check('F1 a valid image webhook answers 200', r.status, 200);
    check('F1 and is recorded before answering', !!(db._data.waInbound || {}).BAE5F4886F6F2D05, true);
    check('F1 processing is handed to waitUntil, not awaited in the request', later.length, 1);
    check('F1 nothing is in the queue yet when the answer leaves', db._data.orders, undefined);
    await Promise.all(later);
    check('F1 and once waitUntil runs, the sketch is in the queue', !!(db._data.orders || {}).wa_BAE5F4886F6F2D05_1, true);
  }
  {
    const db = seed();
    check('F2 a wrong token is refused', (await call(req(hook(), 'Bearer nope'), { db, waitUntil: () => {} })).status, 401);
    check('F2 a missing token is refused', (await call(req(hook(), ''), { db, waitUntil: () => {} })).status, 401);
    check('F2 and writes nothing', db._data.waInbound, undefined);
    const other = hook({ instanceData: { idInstance: 9999 } });
    check('F3 a webhook from another instance is refused', (await call(req(other), { db, waitUntil: () => {} })).status, 403);
    check('F4 GET is not accepted', (await call(req(hook(), 'Bearer hook-secret', 'GET'), { db, waitUntil: () => {} })).status, 405);
  }
  {
    const db = seed();
    const stranger = hook({ senderData: { chatId: '972529999999@c.us' } });
    const r = await call(req(stranger), { db, waitUntil: () => {} });
    check('F5 a sender not on the rollout list gets 200 and no record', [r.status, db._data.waInbound], [200, undefined]);
    const text = await call(req(hook({ messageData: { typeMessage: 'textMessage' } })), { db, waitUntil: () => {} });
    check('F5 a text message gets 200 and no record', [text.status, db._data.waInbound], [200, undefined]);
  }
  {
    const broken = { ref: () => ({ transaction: async () => { throw new Error('rtdb down'); } }) };
    const r = await call(req(hook()), { db: broken, waitUntil: () => {} });
    check('F6 if recording fails the webhook answers 500, so GREEN API sends it again', r.status, 500);
  }
  {
    const prev = process.env.GREENAPI_WEBHOOK_TOKEN;
    const db = seed();
    const r = await (async () => {
      const keep = { ...process.env };
      Object.assign(process.env, ENV); delete process.env.GREENAPI_WEBHOOK_TOKEN;
      try { return await hookMod.handleInbound(req(hook(), 'Bearer '), { db, waitUntil: () => {} }); }
      finally { for (const k of Object.keys(ENV)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
    })();
    check('F7 with no token configured nothing gets in — not even an empty bearer', r.status, 401);
    if (prev !== undefined) process.env.GREENAPI_WEBHOOK_TOKEN = prev;
  }

  const SRC = fs.readFileSync(path.join(ROOT, 'api', 'wa-inbound.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'api', '_wa-inbound.js'), 'utf8');
  check('F8 neither the token nor the download link is ever logged',
        /console\.[a-z]+\([^)]*(downloadUrl|GREENAPI_TOKEN|GREENAPI_WEBHOOK_TOKEN|authorization)/i.test(SRC), false);
  check('F8 the token is compared in constant time', /timingSafeEqual/.test(SRC), true);

  const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  check('F9 the webhook has a duration long enough for waitUntil to finish',
        ((VJ.functions || {})['api/wa-inbound.js'] || {}).maxDuration >= 30, true);
  const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('F9 @vercel/functions is a declared dependency, not an accident of node_modules',
        !!(PKG.dependencies || {})['@vercel/functions'], true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll WhatsApp inbound checks passed.');
}).catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
