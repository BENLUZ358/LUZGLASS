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
const { lgEmailSenderLink, lgEmailAddr } = require('./_email-recipient');
const { renderText } = require('./_wa-provider');

const EM_OUTBOX    = 'waMeta/emailOutbox';
const LEASE_MS     = 5 * 60 * 1000;
const MAX_CLAIM    = 5;
const MAX_ATTEMPTS = 3;
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;   // "מוכן לאיסוף" של שלשום — לא שולחים

const _ids = ids => [...new Set((ids || []).map(String))].sort();
//  RTDB מחזירה מערך כאובייקט כשיש בו חורים
const _list = v => Array.isArray(v) ? v : Object.values(v || {});

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
                                    queuedBy, accountKey, invoiceKey, docNumber, fileCount, deliveryTomorrow, variant, delayMs, now,
                                    missingSketchNums, sendTo, extraLines, keySuffix, drafterBatch }) {
  //  משלוח לשרטט (בן, 10/11): מייל פנימי חדש לכתובת קבועה — אף פעם לא כתובת מהקורא
  const drafter = kind === 'drafter-batch';
  if (drafter) { email = require('./_drafter-batch').LG_DRAFTER_EMAIL; sendTo = email; }
  //  חשבונית: אותה הזמנה יכולה להיות בשתי חשבוניות (חלקית, בן 2/11) — המסמך במפתח
  const key = lgEmailMsgKey(kind === 'invoice' && docNumber ? 'invoice#' + docNumber
                          : keySuffix != null ? kind + '#' + keySuffix : kind, thread, orderIds);
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
      //  חשבונית (DB-00004): הקבצים נשלפים בנפרד (outbox-file), לא בתור
      invoiceKey: invoiceKey ? String(invoiceKey) : null, docNumber: docNumber ? String(docNumber) : null,
      deliveryTomorrow: deliveryTomorrow === true,
      //  בן, 4/11: הזמנות בחשבונית שאין להן סקיצה — נאמר בגוף המייל
      missingSketchNums: (missingSketchNums || []).map(String),
      //  מייל חשבוניות של הלקוח (בן, 9/11 — פלג: ההזמנות מכתובת אחת, החשבוניות לכתובת
      //  של מנהלת החשבונות). יש → מייל חדש לכתובת הזו במקום תשובה על מייל ההזמנה.
      sendTo: ((kind === 'invoice' || kind === 'broken-returned' || drafter) && lgEmailAddr(sendTo)) || null,
      drafterBatch: drafter ? Number(drafterBatch) : null,
      //  שבר בחיסום (בן, 10/11) — שורות מוכנות להודעה (api/_broken.js)
      extraLines: (extraLines || []).map(String),
      //  כמה קבצים בפועל (מ-2/11 בדרך כלל אחד — חשבונית + סקיצות). חסר (רשומה ישנה) → החשבון הישן
      fileCount: fileCount > 0 ? Number(fileCount) : null,
      //  נוסח אחר לאותו סוג (הזמנת רכש של אביבי, בן 4/11), ו"לא לפני" — דקה עד שהתשובה יוצאת
      variant: variant ? String(variant) : null,
      notBefore: delayMs > 0 ? at + Number(delayMs) : null,
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
    if (v.notBefore && v.notBefore > at) continue;                      // עוד לא הגיע הזמן — ריצה הבאה
    //  ⚠️ הגיל לפני הנעילה והקישור — אחרת הודעה חסומה הייתה נשארת בתור לנצח
    if ((at - (v.createdAt || at)) > MAX_AGE_MS) { await _close(db, key, at, 'expired', 'פג תוקף — לא נשלח'); continue; }
    //  בלי מזהה המייל של הלקוח אין על מה לענות בבטחה — לא מחכירים לנצח, סוגרים
    const drafter = v.kind === 'drafter-batch';   // מייל פנימי לשרטט — אין לקוח, אין שרשור
    if (!drafter && !v.messageId) { await _close(db, key, at, 'cancelled', 'אין מזהה מייל של הלקוח — לא נשלח'); continue; }
    if (!lgEmailSendGate(v.email).allowed) continue;                     // נעילת הסביבה — לא נוגעים
    if (v.sendTo && !lgEmailSendGate(v.sendTo).allowed) continue;       // גם הכתובת שהחשבונית יוצאת אליה
    const link = drafter ? null : await lgEmailSenderLink(db, v.email);
    if (!drafter && (!link || !v.accountKey || link.customerId !== String(v.accountKey))) {
      await _close(db, key, at, 'cancelled', 'הכתובת כבר לא מקושרת לכרטיס — לא נשלח');
      continue;
    }
    const token = crypto.randomBytes(16).toString('hex');
    const r = await db.ref(EM_OUTBOX + '/' + key).transaction(cur => {
      if (cur === null) return null;
      if (cur.state !== 'pending') return;                               // abort
      if (cur.leaseUntil && cur.leaseUntil > at) return;                 // abort — נתפסה בינתיים
      if (cur.notBefore && cur.notBefore > at) return;                   // abort — עוד לא הגיע הזמן
      if ((at - (cur.createdAt || at)) > MAX_AGE_MS) {
        return { ...cur, state: 'expired', leaseToken: null, leaseUntil: null, updatedAt: at, lastError: 'פג תוקף — לא נשלח' };
      }
      return { ...cur, leaseToken: token, leaseUntil: at + LEASE_MS, updatedAt: at };
    });
    const e = r.committed && r.snapshot.val();
    if (!e || e.state !== 'pending' || e.leaseToken !== token) continue;
    const item = { key, thread: e.thread, messageId: String(e.messageId || (drafter ? 'drafter-' + e.drafterBatch : '')), email: String(e.email), leaseToken: token,
               text: renderText({ kind: e.kind, clientName: e.clientName, orderNums: e.orderNums || [],
                                  sketchNames: e.sketchNames || [], docNumber: e.docNumber,
                                  deliveryTomorrow: e.deliveryTomorrow === true, variant: e.variant || '',
                                  missingSketchNums: e.missingSketchNums || [], extraLines: e.extraLines || [] }),
               //  כמה קבצים לצרף (חשבונית + סקיצה לכל הזמנה). הסקריפט מושך כל אחד ב-outbox-file.
               files: e.invoiceKey ? (e.fileCount > 0 ? e.fileCount : 1 + (e.orderIds || []).length)
                    : drafter ? (e.fileCount > 0 ? e.fileCount : 1) : 0 };
    //  חשבונית למייל החשבוניות של הלקוח — מייל חדש עם נושא, לא תשובה
    if (e.sendTo) {
      item.sendTo = String(e.sendTo);
      item.subject = drafter ? 'הזמנות לשרטוט — משלוח ' + e.drafterBatch + ' (' + (e.orderIds || []).length + ')'
        : e.kind === 'broken-returned'
        ? 'פריט שחזר מחיסום — לוז גלאס' + (e.clientName ? ' — ' + e.clientName : '')
        : 'חשבונית מס ' + (e.docNumber || '') + ' — לוז גלאס' + (e.clientName ? ' — ' + e.clientName : '');
    }
    //  "טופל" ידני (בן, 4/11): המיילים שכל הסקיצות שלהם טופלו — הסקריפט מוציא את
    //  השרשור לארכיון אחרי שהתשובה יצאה. ריק → אין שדה (כמו קודם).
    if (e.kind === 'sketches-handled') {
      const done = await lgEmailDoneMails(db, _ids(_list(e.orderIds)));
      if (done.length) item.doneMails = done;
    }
    out.push(item);
  }
  return out;
}

//  מזהי המיילים (של Gmail) שכל ההזמנות שנוצרו מהם כבר סומנו "טופל".
//  orderIds: ההזמנות שבתשובה. לכל מייל שלהן — כל ההזמנות שהוא יצר (emailInbound/<key>/orderIds),
//  וכולן חייבות sketchSeenAt. הזמנה שנמחקה לא מחזיקה את המייל. ⚠️ מייל שרשומת הקליטה
//  שלו חסרה — לא נכלל (לא יודעים מה עוד יצא ממנו).
//  ⚠️ אותו ניקוי מפתח כמו lgEmailInboundKey (_email-inbound.js) — לא מייבאים משם (מעגל).
async function lgEmailDoneMails(db, orderIds) {
  const mids = [];
  for (const id of orderIds || []) {
    const m = (await db.ref('orders/' + id + '/emailMessageId').once('value')).val();
    if (m && !mids.includes(String(m))) mids.push(String(m));
  }
  const out = [];
  for (const mid of mids) {
    const key = mid.replace(/[.#$[\]/]/g, '_');
    const ids = _ids(_list((await db.ref('emailInbound/' + key + '/orderIds').once('value')).val()));
    if (!ids.length) continue;
    let all = true;
    for (const oid of ids) {
      const o = (await db.ref('orders/' + oid).once('value')).val();
      if (o && !o.sketchSeenAt) { all = false; break; }
    }
    if (all) out.push(mid);
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
  if (e.invoiceKey && (e.state === 'sent' || e.state === 'failed')) {
    try {
      await db.ref('invoicePdf/' + e.invoiceKey + '/delivery').update({ state: e.state, channel: 'email', outboxKey: key,
        reason: e.state === 'sent' ? null : e.lastError || null, at });
    } catch (err) { console.error('email-outbox: invoice delivery stamp failed', key, err && err.name); }
  }
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

//  קובץ אחד מצורף לחשבונית שבתור, לסקריפט שמחזיק את ההשכרה שלה בלבד.
//  idx 0 = החשבונית, ואחריו הסקיצות. { ok, name, mime, b64 } | { ok:false, code }
async function lgEmailOutboxFile(db, key, leaseToken, idx, now) {
  if (!lgEmailOutboxKeyOk(key) || typeof leaseToken !== 'string' || !leaseToken) return { ok: false, code: 'stale' };
  const at = now || Date.now();
  const e = (await db.ref(EM_OUTBOX + '/' + key).once('value')).val();
  if (!e || e.state !== 'pending' || e.leaseToken !== leaseToken || !(e.leaseUntil > at)) return { ok: false, code: 'stale' };
  if (e.kind === 'drafter-batch' && e.drafterBatch) {
    const p = await require('./_drafter-batch').lgDrafterPdf(db, e.drafterBatch);
    if (!p.ok) return { ok: false, code: p.code };
    const f = p.files[Number(idx)];
    if (!Number.isInteger(Number(idx)) || !f) return { ok: false, code: 'bad-idx' };
    return { ok: true, name: f.name, mime: f.mime, b64: f.buf.toString('base64') };
  }
  if (!e.invoiceKey) return { ok: false, code: 'no-files' };
  const f = await require('./_invoice-deliver').lgInvoiceFiles(db, e.invoiceKey);
  if (!f.ok) return { ok: false, code: f.code };
  const one = f.files[Number(idx)];
  if (!Number.isInteger(Number(idx)) || !one) return { ok: false, code: 'bad-idx' };
  return { ok: true, name: one.name, mime: one.mime, b64: one.buf.toString('base64') };
}

module.exports = { lgEmailDoneMails, lgEmailOutboxFile, lgEmailMsgKey, lgEmailOutboxKeyOk, lgEmailEnqueue, lgEmailClaim, lgEmailComplete, lgEmailActiveIds,
                   EM_OUTBOX, LEASE_MS, MAX_CLAIM, MAX_ATTEMPTS, MAX_AGE_MS };
