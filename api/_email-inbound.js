// ═══════════════════════════════════════════════════════════════════
//  api/_email-inbound.js — סקיצה שהגיעה במייל (Orderluz) → התור הקיים.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.2
//  העתק של _wa-inbound.js במבנה; מה שמשותף באמת חי ב-_inbox-common.js.
//
//  ─── הזרימה ───────────────────────────────────────────────────────
//
//    סקריפט Gmail → lgEmailPutChunk × N   (emailParts/<key>/<idx>/<chunk>)
//                 → lgEmailCommit          (create-once + עיבוד)
//    "נסה שוב" / drain → lgEmailInboundProcess  (מאותן חתיכות שמורות)
//
//  ─── ההבדל מ-WhatsApp ──────────────────────────────────────────────
//
//  ב-WhatsApp הבייטים אצל GREEN API ל-24 שעות, ומורידים אותם בעיבוד.
//  כאן הסקריפט **מעלה** אותם אלינו לפני ה-commit, בחתיכות (גוף בקשה ל-
//  Vercel מוגבל ל-4.5MB). ולכן:
//    • אין כלל 24 שעות — הבייטים שלנו, ו-retry עובד גם אחרי שבוע.
//    • emailParts/<key> נמחק **רק** במצב סופי שאין ממנו retry: done,
//      rejected, ignored. ב-failed וב-dead הוא נשאר — "נסה שוב" צריך אותו.
//
//  ⚠️ כל חתיכה היא base64 **עצמאי** (אורך כפולה של 4). הבייטים של קובץ =
//  חיבור הפענוחים של חתיכות 0..chunks-1 לפי הסדר. הסקריפט מפצל בייטים
//  לפני הקידוד (או base64 בגבולות של 4 תווים) — חיבור מחרוזות לא נעשה כאן.
//
//  ─── שלושה כללים (כמו WhatsApp) ───────────────────────────────────
//
//  1. **הכל או כלום, לכל המייל.** כל ההזמנות, state:'done' ומחיקת החתיכות
//     — עדכון רב-נתיבי אחד. קובץ אחד פגום → אף הזמנה.
//     ⚠️ הסקיצות עצמן נכתבות **לפני** העדכון, כל אחת בכתיבה משלה: RTDB
//     מגבילה כתיבה בודדת ל-16MB, ושלוש תמונות של 5MB ב-base64 הן ~20MB —
//     בעדכון אחד המייל היה נכשל, נכשל, ומת עם שגיאה סתומה. סקיצה בלי הזמנה
//     לא מופיעה בשום מקום (התור קורא הזמנות), המזהה דטרמיניסטי ולכן ניסיון
//     חוזר דורס את אותו נתיב, וכל כתיבה עוברת בדיקת "התפיסה עדיין שלי".
//  2. **מספר הזמנה אחד למייל**, נשמר ברשומה לפני הכתיבה (lgInboxRefNum).
//     כל הזמנה מקבלת אותו מספר עם סיומת -1..n כשיש יותר מתמונה אחת — כמו
//     אצווה מהפורטל (upload.html). ברשומה נשמר המספר בלי סיומת.
//     PDF נפרש לעמודים (_pdf-pages.js) — כל עמוד הזמנה, במקום של ה-PDF
//     בסדר הקבצים. עד EM_MAX_SKETCHES לכל המייל.
//  3. **הסקיצה ב-sketches/ בלבד**; בהזמנה hasSketch:true.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { sniffImage, stripJpegMeta } = require('./_wa-image');
const { lgEmailAddr, lgClientFromEmail } = require('./_email-recipient');
const { lgInboxStillMine, lgInboxRefNum, lgInboxAudit, lgInboxDropNulls } = require('./_inbox-common');
// ⚠️ אותו סף "תמונה גדולה — לבדוק" כמו WhatsApp, מאותו משתנה סביבה — לא עותק שני
const { WA_IMAGE_FLAG_BYTES } = require('./_wa-inbound');

const EM_INBOX = 'emailInbound';
const EM_PARTS = 'emailParts';

// אותם ערכים כמו WhatsApp — ר' ההסברים ב-_wa-inbound.js
const CLAIM_TTL_MS = 2 * 60 * 1000;
const EM_MAX_ATTEMPTS = 3;
// תקרה לקובץ בודד: base64 מנפח פי 4/3, ו-RTDB מגבילה כתיבה ל-16MB
const EM_PART_MAX_BYTES = 10 * 1024 * 1024;
// גבולות הסקריפט — מעבר להם זו לא סקיצה אלא משהו שהשתבש
const EM_MAX_PARTS = 20;
const EM_MAX_CHUNKS = 10;

// תקרה לכל המייל, אחרי ש-PDF נפרש לעמודים (אפיון §3.3). מעבר לזה זה לא
// "כמה סקיצות" אלא קטלוג — בן מטפל ביד, ולא 41 שורות בתור.
const EM_MAX_SKETCHES = 40;
const _tooMany = n => 'במייל יש ' + n + ' סקיצות — יותר מ-' + EM_MAX_SKETCHES + ', לטפל ידנית';
// תקציב לרינדור כל הקבצים — מתחת ל-maxDuration של 60 שניות ב-Vercel, עם מקום
// לכתיבות שאחריו. נבדק לפני כל קובץ, לא באמצע אחד.
const EM_RENDER_BUDGET_MS = 40000;
const EM_SLOW = 'עיבוד הקבצים במייל לקח יותר מדי זמן — לטפל ידנית';
const EM_NO_SKETCH = 'אין קובץ סקיצה במייל';
const EM_MISSING = 'חסרים חלקים מהקובץ';

const FINAL = ['done', 'rejected', 'ignored', 'closed', 'dead'];

//  RTDB אוסרת . # $ [ ] / במפתח — אותו ניקוי כמו lgWaInboundKey
const lgEmailInboundKey = id => String(id || '').replace(/[.#$[\]/]/g, '_');

const _int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const _isB64 = s => typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

// ─── העלאת חתיכה ────────────────────────────────────────────────────
//  מחזיר { ok, code? }. כתיבה חוזרת של אותה חתיכה (הסקריפט ניסה שוב)
//  פשוט דורסת את אותו ערך.
async function lgEmailPutChunk(db, p) {
  const x = p || {};
  const key = lgEmailInboundKey(x.messageId);
  if (!key) return { ok: false, code: 'no-id' };
  if (!_int(x.idx, 0, EM_MAX_PARTS - 1)) return { ok: false, code: 'bad-idx' };
  if (!_int(x.chunks, 1, EM_MAX_CHUNKS)) return { ok: false, code: 'bad-chunks' };
  if (!_int(x.chunk, 0, x.chunks - 1)) return { ok: false, code: 'bad-chunk' };
  if (!_isB64(x.data)) return { ok: false, code: 'bad-data' };
  await db.ref(EM_PARTS + '/' + key + '/' + x.idx + '/' + x.chunk).set(x.data);
  return { ok: true };
}

// ─── תשובה מתוך רשומה ───────────────────────────────────────────────
const _answer = cur => {
  const c = cur || {};
  const out = { state: c.state || 'missing' };
  if (c.state === 'done') { out.refNum = c.refNum; out.orderIds = c.orderIds || []; }
  else if (c.reason) out.reason = c.reason;
  return out;
};

// ─── תפיסה ──────────────────────────────────────────────────────────
//  בדיוק lgWaInboundClaim, בלי כלל 24 השעות (הבייטים שלנו).
async function _claim(db, key, by, now) {
  const t = now || Date.now();
  const token = crypto.randomBytes(8).toString('hex');
  const r = await db.ref(EM_INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;                                  // null-first
    if (!['received', 'failed', 'processing'].includes(cur.state)) return;   // סופי
    if (cur.state === 'processing' && cur.claimedAt && (t - cur.claimedAt) < CLAIM_TTL_MS) return;
    if ((cur.attempts || 0) >= EM_MAX_ATTEMPTS) {
      return { ...cur, state: 'dead', claimedAt: null, updatedAt: t,
               reason: EM_MAX_ATTEMPTS + ' ניסיונות נכשלו — ' + (cur.lastError || '') };
    }
    return { ...cur, state: 'processing', claimedAt: t, claimedBy: String(by || ''),
             claimToken: token, attempts: (cur.attempts || 0) + 1, updatedAt: t };
  });
  if (!r.committed) { const cur = r.snapshot.val() || {}; return { claimed: false, entry: cur }; }
  const entry = r.snapshot.val();
  if (!entry) return { claimed: false, entry: {} };
  if (entry.state === 'dead') return { claimed: false, entry };
  return { claimed: true, entry };
}

//  סופי בלי retry: rejected / ignored. ה-state נישא על השגיאה.
class Final extends Error { constructor(msg, state) { super(msg); this.state = state || 'rejected'; } }

const _kind = p => {
  const mime = String(p.mime || '').toLowerCase();
  if (mime === 'application/pdf' || /\.pdf$/i.test(p.name || '')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
};

//  הבייטים של קובץ אחד מהחתיכות השמורות. חתיכה חסרה = שגיאה **זמנית**:
//  הסקריפט אולי נפל באמצע ההעלאה וישלים בריצה הבאה (Review Focus 2).
function _bytesOf(staged, p) {
  if (!_int(p.idx, 0, EM_MAX_PARTS - 1) || !_int(p.chunks, 1, EM_MAX_CHUNKS)) throw new Final('פרטי הקובץ ' + (p.name || '') + ' פגומים');
  const mine = staged && staged[p.idx];
  const bufs = [];
  for (let c = 0; c < p.chunks; c++) {
    const s = mine && mine[c];
    if (typeof s !== 'string' || !s) throw new Error(EM_MISSING);
    bufs.push(Buffer.from(s, 'base64'));
  }
  const raw = Buffer.concat(bufs);
  if (raw.length > EM_PART_MAX_BYTES) throw new Final('הקובץ ' + (p.name || '') + ' גדול מדי (' + Math.round(raw.length / 1048576) + 'MB)');
  if (!raw.length) throw new Error('התקבל קובץ ריק');
  return raw;
}

// ─── עיבוד ──────────────────────────────────────────────────────────
//  מחזיר { state, refNum?, orderIds?, reason? } — אותה צורה כמו lgEmailCommit.
async function lgEmailInboundProcess(db, key, opts) {
  const o = opts || {};
  const now = o.now || Date.now();

  const c = await _claim(db, key, o.by, now);
  if (!c.claimed) return _answer(c.entry);
  const entry = c.entry;
  const token = entry.claimToken;
  const base = EM_INBOX + '/' + key + '/';
  let skipped = [];

  try {
    const parts = (Array.isArray(entry.parts) ? entry.parts : Object.values(entry.parts || {}))
      .filter(Boolean).slice().sort((a, b) => a.idx - b.idx);
    // תמונות ו-PDF יחד, לפי סדר הקבצים במייל — הסדר הוא סדר ההזמנות (-1..n)
    const sketchParts = parts.filter(p => _kind(p) === 'image' || _kind(p) === 'pdf');
    // קבצים אחרים (docx, xlsx, zip) לא נקלטים — אבל השם נרשם, כדי שבן יראה
    skipped = parts.filter(p => _kind(p) === 'other').map(p => String(p.name || ''));
    if (!sketchParts.length) throw new Final(EM_NO_SKETCH, 'ignored');

    // תקרה לפי מה שהוצהר — לפני שקוראים 10MB+ מהבסיס
    const big = sketchParts.find(p => Number(p.size) > EM_PART_MAX_BYTES);
    if (big) throw new Final('הקובץ ' + (big.name || '') + ' גדול מדי (' + Math.round(big.size / 1048576) + 'MB)');

    const staged = (await db.ref(EM_PARTS + '/' + key).once('value')).val() || {};
    // ⚠️ "תמונה" ש-sniffImage לא מזהה (HEIC מהאייפון, GIF, TIFF, או בייטים שאינם
    // תמונה) מדולגת ונרשמת ב-skipped, כמו docx — ולא מפילה את כל המייל (R9).
    // תמונה טובה לצידה עדיין הופכת להזמנה, ובן רואה בפאנל מה נשאר בחוץ.
    // ⚠️ PDF הפוך: קובץ פגום / מוגן בסיסמה / יותר מדי עמודים (PdfError) דוחה את
    // **כל** המייל — לא מדלגים עליו בשקט, כי זה כמעט תמיד הסקיצה העיקרית.
    // כל שגיאה אחרת ברינדור (זיכרון, באג) נזרקת כמו שהיא → failed וניסיון חוזר.
    // ⚠️ נכשלים מהר וברור: הרינדור רץ בתוך בקשה של 60 שניות. בלי תקציב זמן
    // ובלי "כמה מקום נשאר", מייל ענק היה נהרג באמצע — ומת בלי סיבה שבן מבין.
    const clock = o.clock || Date.now;
    const t0 = clock();
    const files = [];
    for (const p of sketchParts) {
      if (clock() - t0 > EM_RENDER_BUDGET_MS) throw new Final(EM_SLOW);
      const raw = _bytesOf(staged, p);
      const name = String(p.name || '');
      if (_kind(p) === 'pdf') {
        // ⚠️ נטען רק כשיש PDF — כך drain של WhatsApp לא טוען את @napi-rs/canvas
        const pdf = require('./_pdf-pages');
        const pdfToJpegs = o.pdfToJpegs || pdf.lgPdfToJpegs;   // נקודת החלפה לבדיקות
        const room = Math.max(0, EM_MAX_SKETCHES - files.length);
        let pages;
        try { pages = await pdfToJpegs(raw, { maxPages: Math.min(pdf.PDF_MAX_PAGES, room) }); }
        catch (e) {
          if (!(e && e.name === 'PdfError')) throw e;
          // נפרצה התקרה של המייל (המקום שנשאר), לא כלל 30 העמודים של ה-PDF עצמו
          if (e.numPages > room && e.numPages <= pdf.PDF_MAX_PAGES) throw new Final(_tooMany(files.length + e.numPages));
          throw new Final(e.reason);
        }
        pages.forEach((pg, i) => files.push({
          name: name + ' · עמוד ' + (i + 1) + '/' + pages.length,
          fileName: name, mime: 'image/jpeg', bytes: pg.bytes,
        }));
        continue;
      }
      const mime = sniffImage(raw);
      if (!mime) { skipped.push(name); continue; }
      files.push({ name, mime, bytes: mime === 'image/jpeg' ? stripJpegMeta(raw) : raw });
    }
    if (files.length > EM_MAX_SKETCHES) throw new Final(_tooMany(files.length));
    if (!files.length) throw new Final(EM_NO_SKETCH, 'ignored');

    const who = await lgClientFromEmail(db, entry.from);
    const refNum = await lgInboxRefNum(db, EM_INBOX, key, entry);

    const when = new Date(entry.receivedAt || now);
    const tz = { timeZone: 'Asia/Jerusalem' };
    const email = who.email || lgEmailAddr(entry.from);
    // לקוח מזוהה בלי שם — הכתובת שלו, ולא שורה ריקה בתור
    const name = who.matched ? (who.name || email) : 'לא מזוהה · ' + email;
    const phone = who.loginPhone || who.phone || '';
    const total = files.length;

    const upd = {};
    const orderIds = [];
    const sketches = [];
    files.forEach((f, i) => {
      const n = i + 1;
      const id = 'em_' + key + '_' + n;
      const num = refNum + (total > 1 ? '-' + n : '');
      const order = {
        id, refNum: num, orderNum: num,
        orderClient: name, client: name,
        phone, clientPhone: phone,
        sketchName: '',                              // E6 — המייל לא נותן שם לסקיצה
        notes: '', read: false,
        fileName: f.fileName || f.name,             // לעמוד PDF — שם ה-PDF עצמו
        files: { f0: { name: f.name, type: f.mime } },
        hasSketch: true,
        stage: '', status: 'ממתין לאישור',
        paymentStatus: 'unpaid',
        source: 'email',
        emailMessageId: entry.messageId, emailThreadId: entry.threadId || '',
        emailFrom: email, emailReceivedAt: entry.receivedAt || now,
        emailPage: n, emailPages: total,
        date: when.toLocaleDateString('he-IL', tz),
        time: when.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' }),
        createdAt: now, updatedAt: now,
      };
      order.customerId = who.customerId || '';
      if (who.matched && who.name) order.businessName = who.name;
      if (!who.matched) order.emailUnassigned = true;
      upd['orders/' + id] = order;
      sketches.push([id, 'data:' + f.mime + ';base64,' + f.bytes.toString('base64')]);
      orderIds.push(id);
    });

    // ⚠️ סקיצה לכתיבה — ר' כלל 1 בראש הקובץ (16MB לכתיבה)
    for (const [id, data] of sketches) {
      if (!await lgInboxStillMine(db, EM_INBOX, key, token, now)) return _answer(await _read(db, key));
      await db.ref('sketches/' + id).set(data);
    }
    if (!await lgInboxStillMine(db, EM_INBOX, key, token, now)) return _answer(await _read(db, key));

    // ⚠️ הכל או כלום — ההזמנות, הרשומה ומחיקת החתיכות בעדכון רב-נתיבי אחד
    upd[base + 'state'] = 'done';
    upd[base + 'orderIds'] = orderIds;
    upd[base + 'refNum'] = refNum;
    upd[base + 'clientMatch'] = { via: who.via, customerId: who.customerId || '', name: who.name || '',
                                  ...(who.candidates ? { candidates: who.candidates } : {}) };
    upd[base + 'skipped'] = skipped.length ? skipped : null;
    upd[base + 'sizeBytes'] = files.reduce((s, f) => s + f.bytes.length, 0);
    // כמו WhatsApp: תמונה מעל הסף נשמרת כמו שהיא ומסומנת לבדיקה בפאנל.
    // לפי התמונה הגדולה (לא הסכום) — הסף הוא לתמונה אחת.
    upd[base + 'oversize'] = files.some(f => f.bytes.length > WA_IMAGE_FLAG_BYTES()) ? true : null;
    upd[base + 'claimedAt'] = null;
    upd[base + 'claimToken'] = null;
    upd[base + 'lastError'] = null;
    upd[base + 'reason'] = null;
    upd[base + 'doneAt'] = now;
    upd[base + 'updatedAt'] = now;
    upd[EM_PARTS + '/' + key] = null;
    await db.ref().update(upd);
    return { state: 'done', refNum, orderIds };
  } catch (e) {
    const final = e instanceof Final;
    const msg = String((e && e.message) || 'עיבוד נכשל').slice(0, 300);
    const touch = { state: final ? e.state : 'failed', claimedAt: null, claimToken: null, lastError: msg };
    if (skipped.length) touch.skipped = skipped;
    if (final) { touch.reason = msg; if (e.state === 'ignored') touch.lastError = null; }
    // הניסיון האחרון — נעצר כאן, ולא נשאר "failed" שאף אחד לא ייקח שוב
    else if ((entry.attempts || 0) >= EM_MAX_ATTEMPTS) {
      touch.state = 'dead'; touch.reason = EM_MAX_ATTEMPTS + ' ניסיונות נכשלו — ' + msg;
    }
    let mine = false;
    try { mine = await lgInboxStillMine(db, EM_INBOX, key, token, now, touch); }
    catch (e2) { console.warn('email-inbound: could not record failure', e2 && e2.name); }
    // לא שלי עוד — מישהו אחר כבר סיים או נכשל בעצמו. לא דורסים את מה שכתב.
    if (!mine) return _answer(await _read(db, key));
    // rejected / ignored — אין ממנו retry, ולכן אין סיבה לשמור את הבייטים
    if (final) await _dropParts(db, key);
    return { state: touch.state, reason: touch.state === 'failed' ? msg : touch.reason };
  }
}

//  ניקוי בלבד — כישלון כאן לא משנה את התשובה
async function _dropParts(db, key) {
  try { await db.ref(EM_PARTS + '/' + key).set(null); }
  catch (e) { console.warn('email-inbound: could not drop staged parts', e && e.name); }
}

const _read = async (db, key) => (await db.ref(EM_INBOX + '/' + key).once('value')).val();

// ─── commit — create-once ואז עיבוד ─────────────────────────────────
//  הסקריפט שולח commit אחרי שכל החתיכות עלו. אותו מייל יכול להגיע שוב
//  (הסקריפט נפל אחרי שהשרת סיים, לפני שהדביק תווית) — ואז הרשומה הקיימת
//  עונה, ושום דבר לא נכתב שוב (Review Focus 1).
async function lgEmailCommit(db, meta, opts) {
  const m = meta || {};
  const key = lgEmailInboundKey(m.messageId);
  // ⚠️ בלי מפתח הנתיב היה emailInbound/ — כל התיבה. לעולם לא.
  if (!key) throw new Error('lgEmailCommit: חסר messageId');
  const t = (opts && opts.now) || Date.now();
  const parts = (Array.isArray(m.parts) ? m.parts : []).map(p => ({
    idx: Number(p && p.idx), name: String((p && p.name) || '').slice(0, 200),
    mime: String((p && p.mime) || '').toLowerCase().slice(0, 100),
    size: Number(p && p.size) || 0, chunks: Number(p && p.chunks),
  }));
  const rec = {
    messageId: String(m.messageId), threadId: String(m.threadId || ''),
    from: String(m.from || '').slice(0, 300), subject: String(m.subject || '').slice(0, 300),
    receivedAt: Number(m.date) || t, parts,
    state: 'received', attempts: 0, createdAt: t, updatedAt: t,
  };
  const r = await db.ref(EM_INBOX + '/' + key).transaction(cur => {
    // ⚠️ null-first — null הוא בדיוק המקרה שבו כותבים; כל ערך קיים = כבר נרשם
    if (cur === null) return rec;
    return;   // abort — כבר קיים
  });
  if (!r.committed) {
    const cur = r.snapshot.val();
    if (cur && FINAL.includes(cur.state)) {
      // מייל שנשלח שוב אחרי מצב סופי — הסקריפט כבר העלה חתיכות מחדש, ואף
      // אחד לא יקרא אותן. dead נשאר: "נסה שוב" צריך אותן.
      if (cur.state !== 'dead') await _dropParts(db, key);
      return _answer(cur);
    }
  }
  return lgEmailInboundProcess(db, key, opts);
}

// ─── מה ממתין לעיבוד ────────────────────────────────────────────────
//  בדיוק lgWaInboundPending: לפי state ולא לפי createdAt (רשומות סופיות
//  נשארות לנצח). includeExhausted: גם failed שנגמרו לו הניסיונות, כדי
//  שהתפיסה תסמן אותו dead במקום שיישאר תלוי.
async function lgEmailInboundPending(db, limit, now, opts) {
  const t = now || Date.now();
  const all = !!(opts && opts.includeExhausted);
  const byState = st => db.ref(EM_INBOX).orderByChild('state').equalTo(st).once('value');
  const snaps = await Promise.all(['received', 'failed', 'processing'].map(byState));
  const rows = [];
  snaps.forEach(sn => sn.forEach(ch => {
    const v = ch.val() || {};
    const ok = v.state === 'received'
      || (v.state === 'failed' && (all || (v.attempts || 0) < EM_MAX_ATTEMPTS))
      || (v.state === 'processing' && (!v.claimedAt || t - v.claimedAt >= CLAIM_TTL_MS));
    if (ok) rows.push({ key: ch.key, at: v.createdAt || 0 });
  }));
  rows.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.slice(0, limit || 20).map(r => r.key);
}

// ─── פעולות אדמין: "נסה שוב" ו"טופל ידנית" ──────────────────────────
//  אותו חוזה כמו lgWaInboundRetry / lgWaInboundClose. "נסה שוב" מחזיר
//  ל-received; העיבוד עצמו מהחתיכות השמורות, דרך lgEmailInboundProcess.

const _NOTE_MAX = 300;
const _fresh = (cur, t) => cur.state === 'processing' && cur.claimedAt && (t - cur.claimedAt) < CLAIM_TTL_MS;

//  למה אי אפשר לנסות שוב. null = אפשר. (אין כאן "עברו 24 שעות".)
function _retryBlock(cur, t) {
  if (!cur) return { code: 'missing', message: 'הקליטה לא נמצאה' };
  if (cur.state === 'done') return { code: 'done', message: 'כבר נוצרה הזמנה ' + (cur.refNum || '') + ' מהמייל הזה — לא נוצרת הזמנה נוספת' };
  if (cur.state === 'closed') return { code: 'closed', message: 'הקליטה סומנה כטופלה ידנית' };
  if (cur.state === 'rejected') return { code: 'rejected', message: 'לא יעזור לנסות שוב: ' + (cur.reason || 'הקובץ נדחה') };
  if (cur.state === 'ignored') return { code: 'ignored', message: 'לא יעזור לנסות שוב: ' + (cur.reason || EM_NO_SKETCH) };
  if (cur.state === 'received') return { code: 'queued', message: 'כבר ממתינה לעיבוד' };
  if (_fresh(cur, t)) return { code: 'processing', message: 'בעיבוד ממש עכשיו' };
  return null;
}

async function lgEmailInboundRetry(db, key, by, now) {
  const t = now || Date.now();
  const r = await db.ref(EM_INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;                                  // null-first
    if (_retryBlock(cur, t)) return;                                // abort
    return lgInboxDropNulls({
      ...cur, state: 'received', attempts: 0, claimedAt: null, claimToken: null, reason: null,
      retryCount: (cur.retryCount || 0) + 1, retriedAt: t, retriedBy: String(by || ''), updatedAt: t,
      audit: lgInboxAudit(cur, t, { action: 'retry', by: String(by || ''), from: cur.state, to: 'received' }),
    });
  });
  const cur = r.snapshot.val();
  if (!r.committed || !cur) return { ok: false, ...(_retryBlock(cur, t) || { code: 'busy', message: 'לא נתפסה' }) };
  return { ok: true, code: '', message: '' };
}

async function lgEmailInboundClose(db, key, by, note, now) {
  const t = now || Date.now();
  const who = String(by || ''), why = String(note || '').trim().slice(0, _NOTE_MAX);
  const block = cur => {
    if (!cur) return { code: 'missing', message: 'הקליטה לא נמצאה' };
    if (cur.state === 'closed' || (cur.state === 'done' && cur.handled)) return { code: 'closed', message: 'כבר סומנה כטופלה' };
    if (_fresh(cur, t)) return { code: 'processing', message: 'בעיבוד ממש עכשיו — לנסות שוב בעוד דקה' };
    return null;
  };
  const r = await db.ref(EM_INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;
    if (block(cur)) return;
    // הזמנות כבר נוצרו (למשל שולח לא מזוהה) — סימון בלבד; done נשאר done
    if (cur.state === 'done') {
      return { ...cur, handled: { at: t, by: who, note: why }, updatedAt: t,
               audit: lgInboxAudit(cur, t, { action: 'close', by: who, from: 'done', to: 'done', note: why }) };
    }
    return lgInboxDropNulls({
      ...cur, state: 'closed', closedFrom: cur.state, closedBy: who, closedAt: t, closedNote: why,
      claimedAt: null, claimToken: null, updatedAt: t,
      audit: lgInboxAudit(cur, t, { action: 'close', by: who, from: cur.state, to: 'closed', note: why }),
    });
  });
  const cur = r.snapshot.val();
  if (!r.committed || !cur) return { ok: false, ...(block(cur) || { code: 'busy', message: 'לא נתפסה' }) };
  // נסגר ביד — אין ממנו retry, והחתיכות השמורות רק תופסות מקום
  await _dropParts(db, key);
  return { ok: true, code: '', message: '' };
}

module.exports = {
  lgEmailInboundKey, lgEmailPutChunk, lgEmailCommit, lgEmailInboundProcess,
  lgEmailInboundPending, lgEmailInboundRetry, lgEmailInboundClose,
  EM_INBOX, EM_PARTS, EM_MAX_ATTEMPTS, EM_PART_MAX_BYTES, EM_MAX_SKETCHES, EM_RENDER_BUDGET_MS,
};
