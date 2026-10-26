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
//    • המפתח = sha1(kind|thread|מזהים ממוינים). לחיצה כפולה = אותו מפתח,
//      והרשומה נוצרת פעם אחת בלבד (create-once).
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

async function lgEmailEnqueue(db, { kind, thread, email, clientName, orderNums, sketchNames, orderIds,
                                    queuedBy, accountKey, now }) {
  const key = lgEmailMsgKey(kind, thread, orderIds);
  const at  = now || Date.now();
  const r = await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
    if (cur) return;   // abort — create-once: בתור, נשלחה, או נכשלה
    return {
      kind: String(kind), thread: String(thread), email: String(email),
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
  return { key, queued: false, reason: cur.state === 'sent' ? 'כבר נשלחה' : cur.state === 'pending' ? 'כבר בתור' : 'כבר טופלה (' + (cur.state || '?') + ')' };
}

async function _cancel(db, key, now, why) {
  await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
    if (cur === null) return null;
    if (cur.state !== 'pending' || (cur.leaseUntil && cur.leaseUntil > now)) return;   // abort
    return { ...cur, state: 'cancelled', leaseToken: null, leaseUntil: null, updatedAt: now, lastError: why };
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
    if (!lgEmailSendGate(v.email).allowed) continue;                     // נעילת הסביבה — לא נוגעים
    const link = await lgEmailSenderLink(db, v.email);
    if (!link || !v.accountKey || link.customerId !== String(v.accountKey)) {
      await _cancel(db, key, at, 'הכתובת כבר לא מקושרת לכרטיס — לא נשלח');
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
    out.push({ key, thread: e.thread, leaseToken: token,
               text: renderText({ kind: e.kind, clientName: e.clientName, orderNums: e.orderNums || [], sketchNames: e.sketchNames || [] }) });
  }
  return out;
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
  const e = r.snapshot.val() || {};
  if (e.state === 'sent') {
    // ⚠️ רק הזמנה שקיימת: עדכון על הזמנה שנמחקה היה מחייה שלד ריק שלה
    const upd = {};
    for (const id of _ids(e.orderIds)) {
      const o = (await db.ref('orders/' + id).once('value')).val();
      if (o) upd['orders/' + id + '/emailNotices/' + e.kind] = { sentAt: at, key };
    }
    if (Object.keys(upd).length) await db.ref().update(upd);
  }
  return { ok: true };
}

module.exports = { lgEmailMsgKey, lgEmailOutboxKeyOk, lgEmailEnqueue, lgEmailClaim, lgEmailComplete,
                   EM_OUTBOX, LEASE_MS, MAX_CLAIM, MAX_ATTEMPTS, MAX_AGE_MS };
