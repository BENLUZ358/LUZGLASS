'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_sample-suspect.js — מרכזן: תמונה לדוגמה, לא הזמנה (שיפור 1, חדר הסוכנים, 11/11).
//
//  עוזר משותף, לא route. מקרה נאור 8/11: לקוח שלח תמונה ואחריה "צריבה כזאת" — התמונה
//  הייתה דוגמה, ונכנסה לתור כהזמנה לייצור.
//
//  • webhook (wa-inbound.js): הודעת טקסט קצרה "כזאת" / "כזה" / "דוגמה" / "משהו כזה"…
//    → lgSampleSuspectMark (ב-waitUntil): רשומות תמונה מאותו צ'אט מ-3 הדקות האחרונות
//    (waInbound, createdAt). הרשומה מסומנת sampleSuspect (אם ההזמנה עוד לא נוצרה —
//    lgWaInboundProcess בודק אחרי הכתיבה); הזמנה שכבר קיימת → lgSampleApply.
//    גם כיתוב כזה על התמונה עצמה מסמן.
//  • lgSampleApply: רק הזמנה בתור (stage ''), של לקוח מקושר (customerId), פעם אחת
//    (sampleSuspectAt בטרנזקציה) → sampleSuspect:true + sampleText. **לא מוחקים** —
//    ההזמנה נשארת בתור עם התג "אולי דוגמה — לא הזמנה?". שאלה בחדר למרכזן
//    ("הזמנה או דוגמה?") דרך lgAgentEvent — לפי המתג (כבוי → כלום; בלי הגדרות → אפור).
//    התג עצמו — תמיד, גם כשהסוכנים כבויים: עזר לאדמין, לא פעולה מול לקוח.
//  • lgSampleDecide (wa-inbound-drain 'sample-decide', מאחורי verifyAdmin):
//    'order' → התג יורד; 'sample' → isSample:true — התור מסתיר אותה (buildSQItems),
//    הנתונים נשארים. השאלה בחדר נסגרת.
//  ⚠️ לא נרשם ללוג: טקסט ההודעה. רק e.name.
// ═══════════════════════════════════════════════════════════════════

const SAMPLE_WINDOW_MS = 3 * 60 * 1000;
const SAMPLE_TEXT_MAX = 40;
const _WORD = /(^|[^א-ת])(כזאת|כזה|כזו|דוגמה|דוגמא|לדוגמה|לדוגמא)(?![א-ת])/;

//  טקסט קצר שאומר "כזאת" / "דוגמה" — לא הזמנה מפורטת
function lgSampleTextIs(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t || t.length > SAMPLE_TEXT_MAX) return false;
  return _WORD.test(t);
}

//  גוף ה-webhook → { chatId, groupId, text } כשזו הודעת טקסט "לדוגמה"; אחרת null. טהור.
function lgSampleFromBody(body) {
  const b = body || {};
  if (b.typeWebhook !== 'incomingMessageReceived') return null;
  const md = b.messageData || {};
  const t = md.typeMessage === 'textMessage' ? (md.textMessageData || {}).textMessage
    : (md.typeMessage === 'extendedTextMessage' || md.typeMessage === 'quotedMessage') ? (md.extendedTextMessageData || {}).text : '';
  if (!lgSampleTextIs(t)) return null;
  const chatId = String((b.senderData || {}).chatId || '');
  if (!chatId) return null;
  return { chatId, groupId: /@g\.us$/.test(chatId) ? chatId : '', text: String(t).trim().slice(0, 120) };
}

//  הזמנה אחת → מסומנת (פעם אחת) + שאלה בחדר. → true אם סומנה עכשיו. לא זורק.
async function lgSampleApply(db, orderId, info, now, env) {
  try {
    const id = String(orderId || '');
    if (!id || /[.#$[\]/]/.test(id)) return false;
    const o = (await db.ref('orders/' + id).once('value')).val();
    if (!o || (o.stage && o.stage !== '') || !String(o.customerId || '').trim() || o.isSample || o.sampleDecision) return false;
    const t = Number(now) || Date.now();
    const cl = await db.ref('orders/' + id + '/sampleSuspectAt').transaction(cur => (cur ? undefined : t));
    if (!cl.committed) return false;
    const text = String((info && info.text) || '').slice(0, 120);
    await db.ref('orders/' + id).update({ sampleSuspect: true, sampleText: text });
    const who = String(o.orderClient || o.businessName || o.client || 'לקוח').slice(0, 60);
    const r = await require('./_agent-watch').lgAgentEvent(db, 'markazan', { kind: 'ask', ref: { orderId: id },
      text: 'הזמנה או דוגמה? ' + who + ' שלח תמונה ואחריה "' + text + '" — ' + String(o.orderNum || o.refNum || id)
            + ' מסומנת בתור "אולי דוגמה" (לא הוצאה). בתור: "זו הזמנה" או "דוגמה — הוצא מהתור"' },
      { env: env || process.env, now: t });
    if (r && r.roomKey) await db.ref('orders/' + id).update({ sampleRoomKey: r.roomKey });
    return true;
  } catch (e) {
    console.warn('sample-suspect: apply', e && e.name);
    return false;
  }
}

//  הודעת "כזאת" → רשומות התמונה של אותו צ'אט מ-3 הדקות האחרונות. → { marked:[orderId], pending:[recordKey] }
async function lgSampleSuspectMark(db, p) {
  const x = p || {}, out = { marked: [], pending: [] };
  try {
    const now = Number(x.now) || Date.now();
    const chatId = String(x.chatId || ''), groupId = String(x.groupId || '');
    if (!chatId) return out;
    const recs = (await db.ref('waInbound').orderByChild('createdAt').startAt(now - SAMPLE_WINDOW_MS).once('value')).val() || {};
    for (const [k, r] of Object.entries(recs)) {
      if (!r || r.kind !== 'image' || ['rejected', 'closed'].includes(r.state) || (Number(r.createdAt) || 0) > now) continue;
      const same = groupId ? r.groupId === groupId : (!r.groupId && r.chatId === chatId);
      if (!same) continue;
      if (!r.sampleSuspect) await db.ref('waInbound/' + k + '/sampleSuspect').set({ at: now, text: String(x.text || '').slice(0, 120) });
      const ids = Array.isArray(r.orderIds) ? r.orderIds : [];
      if (!ids.length) { out.pending.push(k); continue; }
      for (const id of ids) if (await lgSampleApply(db, id, { text: x.text }, now, x.env)) out.marked.push(String(id));
    }
  } catch (e) { console.warn('sample-suspect: mark', e && e.name); }
  return out;
}

//  אחרי שהתמונה הפכה להזמנה (lgWaInboundProcess): "כזאת" שהגיע לפני כן, או כיתוב כזה
async function lgSampleAfterOrder(db, key, entry, orderId, now) {
  try {
    if (!entry || entry.kind !== 'image') return false;
    const flag = (await db.ref('waInbound/' + key + '/sampleSuspect').once('value')).val() || entry.sampleSuspect;
    const text = flag ? String(flag.text || '') : lgSampleTextIs(entry.caption) ? String(entry.caption) : '';
    if (!text) return false;
    return await lgSampleApply(db, orderId, { text }, now, process.env);
  } catch (e) { console.warn('sample-suspect: after order', e && e.name); return false; }
}

//  "זו הזמנה" / "דוגמה — הוצא מהתור". b: { orderId, decision:'order'|'sample', by }
async function lgSampleDecide(db, b, now) {
  const x = b || {}, t = Number(now) || Date.now();
  const id = typeof x.orderId === 'string' ? x.orderId : '';
  if (!id || id.length > 200 || /[.#$[\]/]/.test(id)) return { ok: false, code: 'bad-key', message: 'מזהה הזמנה לא תקין' };
  if (!['order', 'sample'].includes(x.decision)) return { ok: false, code: 'bad-decision', message: 'החלטה לא מוכרת' };
  const o = (await db.ref('orders/' + id).once('value')).val();
  if (!o) return { ok: false, code: 'missing', message: 'ההזמנה לא נמצאה' };
  if (o.sampleSuspect !== true) return { ok: false, code: 'not-suspect', message: 'ההזמנה לא מסומנת כדוגמה' };
  const decision = { as: x.decision, at: t, by: String(x.by || '').slice(0, 60) };
  await db.ref('orders/' + id).update(x.decision === 'sample'
    ? { isSample: true, sampleSuspect: null, sampleDecision: decision, updatedAt: t }
    : { sampleSuspect: null, sampleDecision: decision, updatedAt: t });
  if (o.sampleRoomKey) {
    try { await require('./_agent-room').lgRoomClose(db, String(o.sampleRoomKey), t, { by: 'ben' }); }
    catch (e) { console.warn('sample-suspect: room close', e && e.name); }
  }
  return { ok: true, code: '' };
}

module.exports = { SAMPLE_WINDOW_MS, lgSampleTextIs, lgSampleFromBody, lgSampleApply, lgSampleSuspectMark, lgSampleAfterOrder, lgSampleDecide };
