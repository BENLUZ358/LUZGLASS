// ═══════════════════════════════════════════════════════════════════
//  api/_email-outbox.js — תור המיילים היוצאים ללקוח (בן, 26/10).
//
//  עוזר משותף, לא route (קידומת _). אפיון:
//  docs/superpowers/specs/2026-10-26-email-link-senders-design.md
//
//  ─── מי שולח ───────────────────────────────────────────────────────
//
//  לא השרת. אין ל-Vercel cron תכוף ואין לו גישה לתיבה. הסקריפט בג'ימייל
//  כבר רץ כל דקה; הוא שואל כאן "מה לשלוח" (lgEmailClaim), עונה בשרשרת,
//  ומאשר (lgEmailComplete). שניהם דרך /api/email-inbound עם אותו טוקן.
//
//  ─── למה אין מייל כפול ─────────────────────────────────────────────
//
//    • המפתח = sha1(kind|thread|מזהים ממוינים). לחיצה כפולה = אותו מפתח:
//      רשומה בתור (pending) או שנשלחה (sent) לא נדרסת. failed / expired /
//      cancelled — הלקוח לא קיבל, ולכן לחיצה חוזרת מתחילה רשומה טרייה.
//    • תפיסה = lease של 5 דקות עם טוקן אקראי. ריצה שנייה בתוך החלון לא
//      מקבלת את ההודעה. אישור עם טוקן ישן נדחה (stale) — כך ריצה שנתקעה
//      לא מסמנת הודעה שריצה אחרת תפסה מאז.
//    • אם האישור אבד והחלון פג — ההודעה נתפסת שוב, והסקריפט יודע מהסימון
//      המקומי שלו שכבר שלח: הוא רק מאשר, לא שולח שוב (משימה 4).
//
//  ─── למה אין מייל ללקוח שלא קושר ──────────────────────────────────
//
//  בהכנסה לתור (whatsapp-dispatch) הנמען נפתר מהקישור. ובתפיסה — רגע לפני
//  שהסקריפט שולח — בודקים שוב: הכתובת עדיין מקושרת לאותו כרטיס? אם לא,
//  ההודעה מבוטלת (cancelled). ונעילת הסביבה (lgEmailSendGate) נבדקת שוב.
//
//  ⚠️ waMeta: קריאה לאדמין, כתיבה חסומה — רק השרת כותב. אין שינוי חוקים.
//  ⚠️ טרנזקציות: פיירבייס קוראת קודם עם null. כל handler מחזיר ערך על null.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgEmailSendGate } = require('./_env');
const { lgEmailSenderLink } = require('./_email-recipient');
const { renderText } = require('./_wa-provider');

const EM_OUTBOX    = 'waMeta/emailOutbox';
const LEASE_MS     = 5 * 60 * 1000;
const MAX_CLAIM    = 5;
const MAX_ATTEMPTS = 3;
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;   // "מוכן לאיסוף" של שלשום — לא שולחים

const _ids = ids => [...new Set((ids || []).map(String))].sort();

function lgEmailMsgKey(kind, thread, orderIds) {
  return crypto.createHash('sha1')
    .update(String(kind) + '|' + String(thread) + '|' + _ids(orderIds).join(','))
    .digest('hex').slice(0, 20);
}

// המפתח מגיע מהסקריפט — רק מה ש-lgEmailMsgKey מייצר עובר
const lgEmailOutboxKeyOk = k => typeof k === 'string' && /^[0-9a-f]{20}$/.test(k);

//  messageId = מזהה Gmail של המייל של הלקוח שהסקריפט עונה עליו (msg.reply).
//  ⚠️ לא thread.reply: הוא עונה למי ששלח את ההודעה **האחרונה** בשרשור — ההודעה
//  שלנו, תשובה ידנית של בן, או צד שלישי. הסקריפט גם בודק שהמייל הזה (Reply-To,
//  אחרת From) הוא בדיוק email — הכתובת המקושרת.
async function lgEmailEnqueue(db, { kind, thread, messageId, email, clientName, orderNums, sketchNames, orderIds,
                                    queuedBy, accountKey, now }) {
  const key = lgEmailMsgKey(kind, thread, orderIds);
  const at  = now || Date.now();
  const r = await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
    if (cur && (cur.state === 'pending' || cur.state === 'sent')) return;   // abort — בתור / נשלחה
    return {
      kind: String(kind), thread: String(thread), messageId: String(messageId || ''), email: String(email),
      accountKey: accountKey == null ? '' : String(accountKey),
      clientName: String(clientName || ''),
      orderNums: (orderNums || []).map(String),
      sketchNames: (orderNums || []).map((_, i) => String((sketchNames || [])[i] || '')),
      orderIds: _ids(orderIds),
      state: 'pending', attempts: 0,
      createdAt: at, updatedAt: at, queuedBy: String(queuedBy || ''),
      leaseToken: null, leaseUntil: null, sentAt: null, lastError: null,
    };
  });
  if (r.committed) return { key, queued: true, reason: '' };
  const cur = r.snapshot.val() || {};
  return { key, queued: false, reason: cur.state === 'sent' ? 'כבר נשלחה' : 'כבר בתור' };
}

async function _close(db, key, now, state, why) {
  await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;
    if (cur.state !== 'pending' || (cur.leaseUntil && cur.leaseUntil > now)) return;   // abort
    return { ...cur, state, leaseToken: null, leaseUntil: null, updatedAt: now, lastError: why };
  });
}

async function lgEmailClaim(db, limit, now) {
  const at  = now || Date.now();
  const max = Math.max(1, Math.min(MAX_CLAIM, Number(limit) || MAX_CLAIM));
  const snap = await db.ref(EM_OUTBOX).orderByChild('state').equalTo('pending').once('value');
  const rows = [];
  snap.forEach(ch => { rows.push({ key: ch.key, v: ch.val() || {} }); });
  rows.sort((a, b) => (a.v.createdAt || 0) - (b.v.createdAt || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const out = [];
  for (const { key, v } of rows) {
    if (out.length >= max) break;
    if (v.leaseUntil && v.leaseUntil > at) continue;                    // באוויר אצל ריצה אחרת
    //  ⚠️ הגיל לפני הנעילה והקישור — אחרת הודעה חסומה הייתה נשארת בתור לנצח
    if ((at - (v.createdAt || at)) > MAX_AGE_MS) { await _close(db, key, at, 'expired', 'פג תוקף — לא נשלח'); continue; }
    //  בלי מזהה המייל של הלקוח אין על מה לענות בבטחה — לא מחכירים לנצח, סוגרים
    if (!v.messageId) { await _close(db, key, at, 'cancelled', 'אין מזהה מייל של הלקוח — לא נשלח'); continue; }
    if (!lgEmailSendGate(v.email).allowed) continue;                     // נעילת הסביבה — לא נוגעים
    const link = await lgEmailSenderLink(db, v.email);
    if (!link || !v.accountKey || link.customerId !== String(v.accountKey)) {
      await _close(db, key, at, 'cancelled', 'הכתובת כבר לא מקושרת לכרטיס — לא נשלח');
      continue;
    }
    const token = crypto.randomBytes(16).toString('hex');
    const r = await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
      if (cur === null) return null;
      if (cur.state !== 'pending') return;                               // abort
      if (cur.leaseUntil && cur.leaseUntil > at) return;                 // abort — נתפסה בינתיים
      if ((at - (cur.createdAt || at)) > MAX_AGE_MS) {
        return { ...cur, state: 'expired', leaseToken: null, leaseUntil: null, updatedAt: at, lastError: 'פג תוקף — לא נשלח' };
      }
      return { ...cur, leaseToken: token, leaseUntil: at + LEASE_MS, updatedAt: at };
    });
    const e = r.committed && r.snapshot.val();
    if (!e || e.state !== 'pending' || e.leaseToken !== token) continue;
    out.push({ key, thread: e.thread, messageId: String(e.messageId), email: String(e.email), leaseToken: token,
               text: renderText({ kind: e.kind, clientName: e.clientName, orderNums: e.orderNums || [], sketchNames: e.sketchNames || [] }) });
  }
  return out;
}

//  הזמנות שכבר בהודעת מייל מאותו סוג שבדרך (pending) או שנשלחה ביממה האחרונה.
//  ⚠️ המפתח מגן רק מאותה קבוצה בדיוק: [X] ואז [X,Y] הם שני מפתחות, ו-X היה מקבל
//  שתי הודעות. כמו lgSketchAckActiveIds ל"הסקיצות טופלו".
//  "נשלחה" — רק ביממה האחרונה: "יצא להובלה" הוא אירוע, והובלה חדשה ביום אחר
//  צריכה הודעה חדשה. "מוכן לאיסוף" מוגן לתמיד בנפרד (orders/<id>/emailNotices).
//  failed / expired / cancelled — הלקוח לא קיבל, ולכן לא חוסמים.
async function lgEmailActiveIds(db, kind, now) {
  const at = now || Date.now();
  const all = (await db.ref(EM_OUTBOX).once('value')).val() || {};
  const ids = new Set();
  for (const v of Object.values(all)) {
    if (!v || v.kind !== kind) continue;
    const live = v.state === 'pending' || (v.state === 'sent' && (at - (v.sentAt || 0)) <= MAX_AGE_MS);
    if (live) (v.orderIds || []).forEach(id => ids.add(String(id)));
  }
  return ids;
}

async function lgEmailComplete(db, key, leaseToken, ok, now) {
  if (!lgEmailOutboxKeyOk(key) || typeof leaseToken !== 'string' || !leaseToken) return { ok: false, code: 'stale' };
  const at = now || Date.now();
  const sent = ok === true;
  const r = await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;
    if (cur.leaseToken !== leaseToken || cur.state !== 'pending') return;   // abort — ישן, או כבר נסגרה
    if (sent) return { ...cur, state: 'sent', sentAt: at, leaseUntil: null, updatedAt: at, lastError: null };
    const attempts = (cur.attempts || 0) + 1;
    return { ...cur, attempts, state: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
             leaseToken: null, leaseUntil: null, updatedAt: at, lastError: 'הסקריפט דיווח שהשליחה נכשלה' };
  });
  if (!r.committed) {
    const cur = r.snapshot.val();
    // אישור חוזר על הודעה שכבר סומנה כנשלחה, באותו טוקן — כבר בוצע
    if (cur && cur.state === 'sent' && cur.leaseToken === leaseToken && sent) return { ok: true };
    return { ok: false, code: 'stale' };
  }
  const e = r.snapshot.val();
  if (!e) return { ok: false, code: 'stale' };   // מפתח תקין שלא קיים
  if (e.state === 'sent') {
    // ⚠️ רק הזמנה שקיימת: עדכון על הזמנה שנמחקה היה מחייה שלד ריק שלה
    //  ⚠️ ההודעה כבר יצאה ונרשמה כ-sent; כשל בחותמת לא הופך אותה לכישלון
    try {
      const upd = {};
      for (const id of _ids(e.orderIds)) {
        const o = (await db.ref('orders/' + id).once('value')).val();
        if (o) upd['orders/' + id + '/emailNotices/' + e.kind] = { sentAt: at, key };
      }
      if (Object.keys(upd).length) await db.ref().update(upd);
    } catch (err) { console.error('email-outbox: order stamp failed', key, err && err.name); }
  }
  return { ok: true };
}

module.exports = { lgEmailMsgKey, lgEmailOutboxKeyOk, lgEmailEnqueue, lgEmailClaim, lgEmailComplete, lgEmailActiveIds,
                   EM_OUTBOX, LEASE_MS, MAX_CLAIM, MAX_ATTEMPTS, MAX_AGE_MS };
