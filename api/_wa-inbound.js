// ═══════════════════════════════════════════════════════════════════
//  api/_wa-inbound.js — סקיצה שהגיעה ב-WhatsApp → התור הקיים.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  אפיון: docs/superpowers/specs/2026-10-04-whatsapp-sketch-intake-design.md
//
//  ─── הזרימה ───────────────────────────────────────────────────────
//
//    webhook  → lgWaInboundParse → lgWaInboundRecord  (create-once) → 200
//    בנפרד    → lgWaInboundProcess: תפיסה → הורדה → זיהוי → כתיבה אטומית
//
//  ה-webhook לא מוריד ולא כותב הזמנות (D6). מה שמחבר בין השניים הוא
//  waInbound/<id> — ולכן גם אם העיבוד מת באמצע, ההודעה לא אובדת.
//
//  ─── שלושה כללים שלא רואים בקוד ────────────────────────────────────
//
//  1. **הכל או כלום.** ההזמנה, התמונה וה-state:'done' נכתבים בעדכון רב-
//     נתיבי אחד. אין מצב שבו יש הזמנה בלי תמונה, או תמונה שנקלטה פעמיים.
//  2. **מספר הזמנה פעם אחת.** refNum נשמר ברשומה לפני הכתיבה, ו-retry
//     משתמש בו שוב — אחרת כל ניסיון היה שורף מספר (אותו לקח כמו
//     lgUploadBatch בפורטל).
//  3. **סקיצת WhatsApp נשמרת ב-sketches/ בלבד** (§14). ברשומת ההזמנה רק
//     hasSketch:true — שכבת הסקיצה בדפדפן יודעת לטעון משם.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { sniffImage, stripJpegMeta } = require('./_wa-image');
const { waChatToLocal, lgClientFromWaSender, lgClientFromWaGroup } = require('./_wa-recipient');

const INBOX = 'waInbound';

// ארוך מ-maxDuration של הפונקציה (60 שניות), כדי שתפיסה חיה לא תיגנב
const CLAIM_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
// GREEN API שומרת את הקובץ 24 שעות. אחרי זה אין מה להוריד.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// תקרה קשיחה: מעבר לה הקובץ לא נקרא בכלל. base64 מנפח פי 4/3, ו-RTDB
// מגבילה כתיבה בודדת ל-16MB — 10MB משאירים מרווח.
const WA_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// החלטת בן (§13.3): מעל הסף הזה התמונה **נשמרת כמו שהיא** ומסומנת לבדיקה
// בפאנל הקליטות. ערך זמני עד שתיבדק דוגמת HD / "כמסמך" אמיתית, ולכן הוא
// קונפיגורציה אחת ולא מספר קסם.
const WA_IMAGE_FLAG_BYTES = () => Number(process.env.WA_IMAGE_FLAG_BYTES) || 800 * 1024;

const PDF_REASON = 'PDF עדיין לא נתמך — לטפל ידנית ב-WhatsApp';

//  RTDB אוסרת . # $ [ ] / במפתח. מזהי GREEN API הם hex, אבל לא סומכים.
const lgWaInboundKey = id => String(id || '').replace(/[.#$[\]/]/g, '_');

//  כיווץ רווחים, עד 80 תווים (§2.7)
const _caption = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

// ─── סינון ──────────────────────────────────────────────────────────
//  מחזיר { action:'record'|'ignore', reason, entry }.
function lgWaInboundParse(body) {
  const ignore = reason => ({ action: 'ignore', reason, entry: null });
  const b = body || {};
  if (b.typeWebhook !== 'incomingMessageReceived') return ignore('type');
  if (!b.idMessage) return ignore('no id');
  const sd = b.senderData || {};
  const chatId = String(sd.chatId || '');
  // קבוצה (בן, 06/10): הקבוצה היא שמזהה את הלקוח, לא מי שכתב בה. החבר
  // נשמר לתיעוד בלבד — וגם אם הוא lid מוסתר, ההודעה עדיין נקלטת.
  const groupId = /^\d+(-\d+)?@g\.us$/.test(chatId) ? chatId : '';
  const sender = groupId ? waChatToLocal(String(sd.sender || '')) : waChatToLocal(chatId);
  if (!groupId && !sender) return ignore('not a private chat or group');

  const md = b.messageData || {};
  const f  = md.fileMessageData || {};
  const mime = String(f.mimeType || '').toLowerCase();
  let kind = '';
  if (md.typeMessage === 'imageMessage') kind = 'image';
  else if (md.typeMessage === 'documentMessage') {
    if (mime.startsWith('image/')) kind = 'image';                 // נשלחה "כמסמך"
    else if (mime === 'application/pdf' || /\.pdf$/i.test(f.fileName || '')) kind = 'pdf';
  }
  if (!kind) return ignore('not a sketch');

  return { action: 'record', reason: '', entry: {
    idMessage:   String(b.idMessage),
    chatId,
    sender,
    typeMessage: String(md.typeMessage),
    kind,
    caption:     _caption(f.caption),
    fileName:    String(f.fileName || ''),
    mimeType:    mime,
    downloadUrl: String(f.downloadUrl || ''),
    timestamp:   (Number(b.timestamp) || 0) * 1000,
    // רק בקבוצה — רשומה פרטית נשארת בדיוק בצורה שהייתה
    ...(groupId ? { groupId, groupName: String(sd.chatName || '').slice(0, 120) } : {}),
  } };
}

// ─── רישום — create-once ────────────────────────────────────────────
//  מחזיר { key, created }. GREEN API שולחת שוב כשלא קיבלה 200, ולכן
//  אותה הודעה יכולה להגיע כמה פעמים. רק הראשונה נרשמת.
async function lgWaInboundRecord(db, entry, now) {
  const key = lgWaInboundKey(entry.idMessage);
  const t = now || Date.now();
  const rec = { ...entry, state: 'received', attempts: 0, createdAt: t, updatedAt: t };
  // החלטת בן (§13.4): PDF נרשם ומוצג, לא נבלע. בלי קישור הורדה — אין
  // מה לעשות איתו, ולא שומרים URL עם הרשאה סתם.
  if (entry.kind === 'pdf') { rec.state = 'rejected'; rec.reason = PDF_REASON; delete rec.downloadUrl; }

  const r = await db.ref(INBOX + '/' + key).transaction(cur => {
    // ⚠️ null-first — ר' lgWaClaim ב-_wa-outbox.js. כאן ההיפך: null הוא
    // בדיוק המקרה שבו כותבים, וכל ערך קיים פירושו "כבר נרשם".
    if (cur === null) return rec;
    return;   // abort — כבר קיים
  });
  return { key, created: !!r.committed };
}

// ─── תפיסה ──────────────────────────────────────────────────────────
//  מחזיר { claimed, entry, reason }. אותו דפוס כמו lgWaClaim.
async function lgWaInboundClaim(db, key, by, now) {
  const t = now || Date.now();
  const token = crypto.randomBytes(8).toString('hex');
  const r = await db.ref(INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;                                  // null-first
    if (!['received', 'failed', 'processing'].includes(cur.state)) return;   // סופי
    if (cur.state === 'processing' && cur.claimedAt && (t - cur.claimedAt) < CLAIM_TTL_MS) return;
    if ((cur.attempts || 0) >= MAX_ATTEMPTS) {
      return { ...cur, state: 'dead', claimedAt: null, updatedAt: t,
               reason: MAX_ATTEMPTS + ' ניסיונות נכשלו — ' + (cur.lastError || '') };
    }
    if (t - (cur.createdAt || t) > MAX_AGE_MS) {
      return { ...cur, state: 'dead', claimedAt: null, updatedAt: t,
               reason: 'עברו 24 שעות — הקובץ כבר לא זמין להורדה' };
    }
    // claimToken — מזהה **התפיסה הזו**, לא של התהליך. ר' _stillMine.
    return { ...cur, state: 'processing', claimedAt: t, claimedBy: String(by || ''),
             claimToken: token, attempts: (cur.attempts || 0) + 1, updatedAt: t };
  });
  if (!r.committed) { const cur = r.snapshot.val() || {}; return { claimed: false, entry: cur, reason: cur.state || 'לא נתפסה' }; }
  const entry = r.snapshot.val();
  if (!entry) return { claimed: false, entry: {}, reason: 'נעלמה' };
  if (entry.state === 'dead') return { claimed: false, entry, reason: 'dead' };
  return { claimed: true, entry, reason: '' };
}

// ─── הורדה ──────────────────────────────────────────────────────────
class Permanent extends Error {}

//  ⚠️ "התפיסה עדיין שלי?" — נבדק בטרנזקציה ממש לפני כל כתיבה.
//
//  CLAIM_TTL_MS (2 דק') ארוך מ-maxDuration (60 שניות), ולכן בפועל מעבד
//  לא אמור לחיות אחרי שהתפיסה שלו פגה. אבל "לא אמור" אינו ערובה: מעבד
//  שנתקע, תפיסה שפגה, ומעבד שני שסיים — ואז הראשון מתעורר וכותב. מזהה
//  ההזמנה דטרמיניסטי ולכן לא תיווצר **הזמנה שנייה**, אבל הכתיבה המאוחרת
//  הייתה דורסת את ההזמנה הקיימת — כולל sketchSeenAt של מי שכבר עבר עליה —
//  או הופכת done ל-failed. כאן זה נעצר.
//
//  touch: מה לכתוב ברשומה אם היא עדיין שלי (null = רק לבדוק ולרענן).
async function _stillMine(db, key, token, now, touch) {
  const r = await db.ref(INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;                                   // null-first
    if (cur.state !== 'processing' || cur.claimToken !== token) return;   // abort — לא שלי
    const next = { ...cur, claimedAt: now, updatedAt: now, ...(touch || {}) };
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
    return next;
  });
  return !!(r.committed && r.snapshot.val());
}

//  ⚠️ ב-GREEN API הטוקן בתוך ה-URL. כל הודעת שגיאה עוברת כאן לפני שהיא
//  נשמרת, וה-URL עצמו לעולם לא נרשם.
const _redact = s => {
  const tok = process.env.GREENAPI_TOKEN;
  return tok ? String(s).split(tok).join('***') : String(s);
};

async function _freshUrl(entry, fetchImpl) {
  const id = process.env.GREENAPI_ID_INSTANCE, tok = process.env.GREENAPI_TOKEN;
  if (!id || !tok) throw new Error('אין קישור הורדה, וחסרים אישורי GREEN API לבקש חדש');
  const r = await fetchImpl('https://api.green-api.com/waInstance' + id + '/downloadFile/' + tok, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: entry.chatId, idMessage: entry.idMessage }),
  });
  if (!r.ok) throw new Error('downloadFile החזיר HTTP ' + r.status);
  const j = await r.json();
  if (!j || !j.downloadUrl) throw new Error('downloadFile לא החזיר קישור');
  return j.downloadUrl;
}

async function _download(entry, fetchImpl) {
  let url = entry.downloadUrl || await _freshUrl(entry, fetchImpl);
  let r = await fetchImpl(url);
  // קישור שפג (4xx) — מבקשים חדש פעם אחת
  if (!r.ok && r.status >= 400 && r.status < 500 && entry.downloadUrl) {
    url = await _freshUrl(entry, fetchImpl);
    r = await fetchImpl(url);
  }
  if (!r.ok) throw new Error('הורדת הקובץ נכשלה — HTTP ' + r.status);
  const declared = Number(r.headers && r.headers.get && r.headers.get('content-length')) || 0;
  if (declared > WA_IMAGE_MAX_BYTES) throw new Permanent('הקובץ גדול מדי (' + Math.round(declared / 1048576) + 'MB)');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > WA_IMAGE_MAX_BYTES) throw new Permanent('הקובץ גדול מדי (' + Math.round(buf.length / 1048576) + 'MB)');
  if (!buf.length) throw new Error('התקבל קובץ ריק');
  return buf;
}

// ─── מספר הזמנה — פעם אחת להודעה ────────────────────────────────────
async function _refNum(db, key, entry) {
  if (entry.refNum) return entry.refNum;
  // אותה נוסחה בדיוק כמו lgNextOrderNum בדפדפן
  const c = await db.ref('meta/orderCounter').transaction(cur => Math.max(cur || 0, 999) + 1);
  const mine = 'L' + c.snapshot.val();
  const r = await db.ref(INBOX + '/' + key + '/refNum').transaction(cur => (cur === null ? mine : undefined));
  // מישהו קדם לנו — המספר שלו גובר, ושלנו מתבזבז (נדיר, ועדיף על כפילות)
  return r.committed ? mine : r.snapshot.val();
}

const _fmtLocal = p => (p.length === 10 ? p.slice(0, 3) + '-' + p.slice(3) : p);

// ─── עיבוד ──────────────────────────────────────────────────────────
//  מחזיר { ok, reason, orderIds }.
async function lgWaInboundProcess(db, key, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const fetchImpl = o.fetchImpl || fetch;

  const c = await lgWaInboundClaim(db, key, o.by, now);
  if (!c.claimed) return { ok: false, reason: c.reason, orderIds: [], claimed: false };
  const entry = c.entry;
  const base = INBOX + '/' + key + '/';

  try {
    if (entry.kind !== 'image') throw new Permanent(entry.kind === 'pdf' ? PDF_REASON : 'סוג קובץ לא נתמך');

    const raw  = await _download(entry, fetchImpl);
    const mime = sniffImage(raw);
    if (!mime) throw new Permanent('הקובץ שהתקבל אינו תמונה');
    const bytes = mime === 'image/jpeg' ? stripJpegMeta(raw) : raw;

    // קבוצה מקושרת מזהה את הלקוח; אחרת — לפי מספר השולח, כמו קודם
    const who = entry.groupId
      ? await lgClientFromWaGroup(db, entry.groupId, entry.sender)
      : await lgClientFromWaSender(db, entry.chatId);
    const refNum = await _refNum(db, key, entry);

    const id = 'wa_' + key + '_1';
    const when = new Date(entry.timestamp || now);
    const tz = { timeZone: 'Asia/Jerusalem' };
    // משתמש רשום בלי שם — המספר שלו, ולא שורה ריקה בתור
    const name = who.matched ? (who.name || _fmtLocal(who.phone)) : 'לא מזוהה · ' + _fmtLocal(who.phone);
    const order = {
      id, refNum, orderNum: refNum,
      orderClient: name, client: name,
      phone: who.loginPhone || who.phone,
      clientPhone: who.loginPhone || who.phone,
      sketchName: entry.caption || '',
      notes: '', read: false,
      fileName: entry.fileName || '',
      files: { f0: { name: entry.fileName || '', type: mime } },
      hasSketch: true,
      stage: '', status: 'ממתין לאישור',
      paymentStatus: 'unpaid',
      source: 'whatsapp',
      waMessageId: entry.idMessage, waPage: 1, waPages: 1,
      // בקבוצה — מי מבין החברים שלח; בפרטי — השולח עצמו
      waSender: entry.groupId ? (entry.sender || '') : who.phone, waReceivedAt: entry.timestamp || now,
      date: when.toLocaleDateString('he-IL', tz),
      time: when.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' }),
      createdAt: now, updatedAt: now,
    };
    order.customerId = who.customerId || '';
    if (who.matched && who.name) order.businessName = who.name;
    if (!who.matched) order.waUnassigned = true;
    // העדכון "הסקיצות טופלו" יוצא לקבוצה — ר' resolveRecipient
    if (entry.groupId) { order.waGroup = entry.groupId; order.waGroupName = entry.groupName || ''; }

    if (!await _stillMine(db, key, c.entry.claimToken, now)) return { ok: false, reason: 'lost-claim', orderIds: [] };

    // ⚠️ הכל או כלום — עדכון רב-נתיבי אחד
    const upd = {};
    upd['orders/' + id] = order;
    upd['sketches/' + id] = 'data:' + mime + ';base64,' + bytes.toString('base64');
    upd[base + 'state'] = 'done';
    upd[base + 'orderIds'] = [id];
    upd[base + 'refNum'] = refNum;
    upd[base + 'clientMatch'] = { via: who.via, customerId: who.customerId || '', name: who.name || '',
                                  ...(who.candidates ? { candidates: who.candidates } : {}) };
    upd[base + 'sizeBytes'] = bytes.length;
    upd[base + 'oversize'] = bytes.length > WA_IMAGE_FLAG_BYTES() ? true : null;
    upd[base + 'downloadUrl'] = null;
    upd[base + 'claimedAt'] = null;
    upd[base + 'claimToken'] = null;
    upd[base + 'lastError'] = null;
    upd[base + 'doneAt'] = now;
    upd[base + 'updatedAt'] = now;
    await db.ref().update(upd);
    return { ok: true, reason: '', orderIds: [id] };
  } catch (e) {
    const permanent = e instanceof Permanent;
    const msg = _redact((e && e.message) || 'עיבוד נכשל').slice(0, 300);
    const touch = { state: permanent ? 'rejected' : 'failed', claimedAt: null, claimToken: null, lastError: msg };
    if (permanent) { touch.reason = msg; touch.downloadUrl = null; }
    // הניסיון האחרון — נעצר כאן, ולא נשאר "failed" שאף אחד לא ייקח שוב
    else if ((c.entry.attempts || 0) >= MAX_ATTEMPTS) {
      touch.state = 'dead'; touch.reason = MAX_ATTEMPTS + ' ניסיונות נכשלו — ' + msg;
    }
    let mine = false;
    try { mine = await _stillMine(db, key, c.entry.claimToken, now, touch); }
    catch (e2) { console.warn('wa-inbound: could not record failure', e2 && e2.name); }
    // לא שלי עוד — מישהו אחר כבר סיים או נכשל בעצמו. לא דורסים את מה שכתב.
    if (!mine) return { ok: false, reason: 'lost-claim', orderIds: [] };
    return { ok: false, reason: msg, orderIds: [] };
  }
}

// ─── מה ממתין לעיבוד ────────────────────────────────────────────────
//  received, failed שעוד יש לו ניסיונות, ו-processing שהתפיסה שלו פגה
//  (מעבד שמת באמצע). לפי state ולא לפי createdAt — אותו לקח כמו
//  lgWaPending: רשומות סופיות נשארות לנצח, וחיתוך לפני סינון היה מחזיר
//  תור ריק. includeExhausted: גם failed שנגמרו לו הניסיונות, כדי שהתפיסה
//  תסמן אותו dead במקום שיישאר תלוי.
async function lgWaInboundPending(db, limit, now, opts) {
  const t = now || Date.now();
  const all = !!(opts && opts.includeExhausted);
  const byState = st => db.ref(INBOX).orderByChild('state').equalTo(st).once('value');
  const snaps = await Promise.all(['received', 'failed', 'processing'].map(byState));
  const rows = [];
  snaps.forEach(sn => sn.forEach(ch => {
    const v = ch.val() || {};
    const ok = v.state === 'received'
      || (v.state === 'failed' && (all || (v.attempts || 0) < MAX_ATTEMPTS))
      || (v.state === 'processing' && (!v.claimedAt || t - v.claimedAt >= CLAIM_TTL_MS));
    if (ok) rows.push({ key: ch.key, at: v.createdAt || 0 });
  }));
  rows.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.slice(0, limit || 20).map(r => r.key);
}

// ─── פעולות אדמין: "נסה שוב" ו"טופל ידנית" ──────────────────────────
//
//  שתיהן טרנזקציה על **אותה רשומה**. אין כאן יצירה של שום דבר: "נסה שוב"
//  מחזיר את הרשומה ל-received ומאפס ניסיונות, והעיבוד עצמו עובר דרך
//  lgWaInboundProcess — אותה תפיסה כמו ה-webhook. ולכן retry לעולם לא
//  יוצר הזמנה כשכבר יש (done נדחה), ושתי לחיצות מקבילות מתנגשות בטרנזקציה.

const _NOTE_MAX = 300;
const _fresh = (cur, t) => cur.state === 'processing' && cur.claimedAt && (t - cur.claimedAt) < CLAIM_TTL_MS;
const _audit = (cur, t, entry) => ({
  ...(cur.audit || {}),
  [t + '_' + entry.action + '_' + crypto.randomBytes(3).toString('hex')]: { at: t, ...entry },
});
const _dropNulls = o => { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };

//  למה אי אפשר לנסות שוב. '' = אפשר.
function _retryBlock(cur, t) {
  if (!cur) return { code: 'missing', message: 'הקליטה לא נמצאה' };
  if (cur.state === 'done') return { code: 'done', message: 'כבר נוצרה הזמנה ' + (cur.refNum || '') + ' מהקליטה הזו — לא נוצרת הזמנה נוספת' };
  if (cur.state === 'closed') return { code: 'closed', message: 'הקליטה סומנה כטופלה ידנית' };
  if (cur.state === 'rejected') return { code: 'rejected', message: 'לא יעזור לנסות שוב: ' + (cur.reason || 'הקובץ נדחה') };
  if (cur.state === 'received') return { code: 'queued', message: 'כבר ממתינה לעיבוד' };
  if (_fresh(cur, t)) return { code: 'processing', message: 'בעיבוד ממש עכשיו' };
  if (t - (cur.createdAt || t) > MAX_AGE_MS) return { code: 'expired', message: 'עברו 24 שעות — GREEN API כבר לא מחזיקה את הקובץ. לבקש מהלקוח לשלוח שוב.' };
  return null;
}

async function lgWaInboundRetry(db, key, by, now) {
  const t = now || Date.now();
  const r = await db.ref(INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;                                  // null-first
    if (_retryBlock(cur, t)) return;                                // abort
    return _dropNulls({
      ...cur, state: 'received', attempts: 0, claimedAt: null, claimToken: null, reason: null,
      retryCount: (cur.retryCount || 0) + 1, retriedAt: t, retriedBy: String(by || ''), updatedAt: t,
      audit: _audit(cur, t, { action: 'retry', by: String(by || ''), from: cur.state, to: 'received' }),
    });
  });
  const cur = r.snapshot.val();
  if (!r.committed || !cur) return { ok: false, ...(_retryBlock(cur, t) || { code: 'busy', message: 'לא נתפסה' }) };
  return { ok: true, code: '', message: '' };
}

async function lgWaInboundClose(db, key, by, note, now) {
  const t = now || Date.now();
  const who = String(by || ''), why = String(note || '').trim().slice(0, _NOTE_MAX);
  const block = cur => {
    if (!cur) return { code: 'missing', message: 'הקליטה לא נמצאה' };
    if (cur.state === 'closed' || (cur.state === 'done' && cur.handled)) return { code: 'closed', message: 'כבר סומנה כטופלה' };
    if (_fresh(cur, t)) return { code: 'processing', message: 'בעיבוד ממש עכשיו — לנסות שוב בעוד דקה' };
    return null;
  };
  const r = await db.ref(INBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;
    if (block(cur)) return;
    // הזמנה כבר נוצרה (למשל לקוח לא מזוהה) — סימון בלבד; done נשאר done
    if (cur.state === 'done') {
      return { ...cur, handled: { at: t, by: who, note: why }, updatedAt: t,
               audit: _audit(cur, t, { action: 'close', by: who, from: 'done', to: 'done', note: why }) };
    }
    return _dropNulls({
      ...cur, state: 'closed', closedFrom: cur.state, closedBy: who, closedAt: t, closedNote: why,
      claimedAt: null, claimToken: null, updatedAt: t,
      audit: _audit(cur, t, { action: 'close', by: who, from: cur.state, to: 'closed', note: why }),
    });
  });
  const cur = r.snapshot.val();
  if (!r.committed || !cur) return { ok: false, ...(block(cur) || { code: 'busy', message: 'לא נתפסה' }) };
  return { ok: true, code: '', message: '' };
}

module.exports = {
  lgWaInboundKey, lgWaInboundParse, lgWaInboundRecord, lgWaInboundClaim, lgWaInboundProcess,
  lgWaInboundPending, lgWaInboundRetry, lgWaInboundClose,
  INBOX, CLAIM_TTL_MS, MAX_ATTEMPTS, MAX_AGE_MS, WA_IMAGE_MAX_BYTES, WA_IMAGE_FLAG_BYTES, PDF_REASON,
};
