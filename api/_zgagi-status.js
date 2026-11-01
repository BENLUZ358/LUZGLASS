// ═══════════════════════════════════════════════════════════════════
//  api/_zgagi-status.js — מה השלב של פריטים מזגאגי, וביטול פריט.
//
//  עוזר משותף, לא route. נקרא מ-_zgagi-route.js (op 'stages' / 'cancel').
//  אפיון: docs/superpowers/specs/2026-11-01-zgagi-luzglass-link-design.md
//
//  זגאגי שואל כל 15 דקות (בן, 1/11: "מוכן" לכל פריט, ההזמנה כשכולם) — ולכן
//  אין כאן שום דבר ששולח לזגאגי, ושום דף אצלנו שמזיז שלב לא צריך לדעת עליו.
//  כל קריאה עוברת דרך waMeta/zgagiItems, שרק השרת כותב: עסק רואה רק את שלו.
// ═══════════════════════════════════════════════════════════════════

const { lgOkevCanChange } = require('./_agent-okev');
const { lgZgagiItemKey, ZGAGI_ITEMS } = require('./_zgagi-inbound');

const READY = ['delivery', 'done', 'collected'];
const MAX_ITEMS = 200;
const _hsSent = o => { const h = o && (o.hashavshevet || o.hsOrder); return !!(h && h.sentAt && !h.simulated); };

//  q: { biz, order, items:[itemId…] } → { code, items:{ [itemId]: {refNum, stage, ready, canChange} | {gone:true} } }
//  פריט שלא נשלח אלינו מעולם — לא מופיע בתשובה.
async function lgZgagiStages(db, q) {
  const b = q || {};
  if (!b.biz || !b.order || !Array.isArray(b.items) || b.items.length > MAX_ITEMS) return { code: 'bad-input' };
  const out = {};
  for (const itemId of b.items) {
    const rec = (await db.ref(ZGAGI_ITEMS + '/' + lgZgagiItemKey(b.biz, b.order, itemId)).once('value')).val();
    if (!rec || rec.biz !== String(b.biz)) continue;
    const o = (await db.ref('orders/' + rec.orderId).once('value')).val();
    if (!o) { out[itemId] = { refNum: rec.refNum, gone: true }; continue; }
    const stage = String(o.stage || '');
    out[itemId] = { refNum: rec.refNum, stage, ready: READY.includes(stage), canChange: lgOkevCanChange(o) };
  }
  return { code: 'ok', items: out };
}

//  q: { biz, order, itemId } → { code:'ok'|'locked'|'not-found'|'bad-input', stage? }
//  כמו lgAgentCancel (_agent-act.js): קודם כרטיס ב-waMeta/agentCancels, אחר כך
//  מחיקה בטרנזקציה שבודקת שוב שעוד אפשר. הכרטיס מופיע בתיקון הזמנות.
async function lgZgagiCancel(db, q, now) {
  const b = q || {};
  if (!b.biz || !b.order || !b.itemId) return { code: 'bad-input' };
  const t = now || Date.now();
  const k = lgZgagiItemKey(b.biz, b.order, b.itemId);
  const rec = (await db.ref(ZGAGI_ITEMS + '/' + k).once('value')).val();
  if (!rec || rec.biz !== String(b.biz)) return { code: 'not-found' };
  const ref = db.ref('orders/' + rec.orderId);
  const pre = (await ref.once('value')).val();
  if (!pre) return { code: 'ok', already: true };
  if (!lgOkevCanChange(pre)) return { code: 'locked', stage: String(pre.stage || '') };

  const card = db.ref('waMeta/agentCancels/' + rec.orderId);
  await card.set({ order: pre, at: t, chatId: '', via: 'zgagi', done: false, confirmed: false });
  let taken = null, late = '';
  const tx = await ref.transaction(cur => {
    taken = null; late = '';
    if (cur === null) return null;                   // null-first
    if (!lgOkevCanChange(cur)) { late = String(cur.stage || ''); return; }
    taken = cur;
    return null;
  });
  if (!tx.committed) { await card.set(null); return { code: 'locked', stage: late }; }
  if (!taken) { await card.set(null); return { code: 'ok', already: true }; }
  await card.update({ order: taken, hsSent: _hsSent(taken), confirmed: true });
  await db.ref(ZGAGI_ITEMS + '/' + k).update({ cancelledAt: t, updatedAt: t });
  return { code: 'ok', stage: String(taken.stage || '') };
}

module.exports = { lgZgagiStages, lgZgagiCancel };
