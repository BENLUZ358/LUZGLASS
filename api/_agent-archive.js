// ═══════════════════════════════════════════════════════════════════
//  api/_agent-archive.js — ארכיון: העתק חשבונית / סקיצה ללקוח (שלב 2, משימה 5).
//
//  עוזר משותף, לא route. lgArchiveFind קורא מה-DB (invoicePdf, orders,
//  sketches); lgArchiveActions טהור — ממפה תוצאת חיפוש לפעולות (מוזן ל-
//  lgAgentDecide מהשכבה הלא-טהורה ב-_agent-act.js).
//
//  ⚠️ Review Focus 5: חשבונית נשלחת רק אם state==='ready' וגם
//     accountKey === customerId. חשבונית של לקוח אחר, לא מוכנה, או שלא
//     קיימת — **אותה תוצאה** ('none') ואותה תשובה ללקוח: לא מגלים שהיא קיימת.
//     (שליחת הקובץ עצמה בודקת שוב בזמן השליחה — _agent-send.js.)
//  ⚠️ זיהוי "חשבונית" מול "סקיצה" — לפי תת-מחרוזות עבריות ב-text של הרשומה:
//     'סקיצ' (סקיצה/סקיצות) → סקיצה; 'חשבונית' / 'חשבוניות' / 'ריכוז' → חשבונית.
//     שניהם ("חשבונית 34472 עם הסקיצות") → חשבונית + סקיצות של ההזמנות שלה.
//     אף אחד → לפי ref: ספרות בלבד = חשבונית (ואם אין — הזמנה), אחרת סקיצה.
//  ⚠️ סקיצה בלי ref (אין מספר/שם) → 'none' → שאול. לא מנחשים "ההזמנה הפתוחה".
//  ⚠️ לא נרשם ללוג: טקסט, ref, base64. החיפוש לא קורא את sketches/ (תיקון סופי 7).
// ═══════════════════════════════════════════════════════════════════

const { lgOkevFind, lgOkevReply } = require('./_agent-okev');

const ARCHIVE_OK_TEXT = 'מצורף';
const ARCHIVE_HOLD_TEXT = 'אני בודק ואחזור אליך';

// מה ביקשו: { want:'invoice'|'sketch'|'any', withSketches }
function lgArchiveWants(text) {
  const t = String(text == null ? '' : text);
  const inv = /חשבונית|חשבוניות|ריכוז/.test(t);
  const sk = /סקיצ/.test(t);
  if (inv) return { want: 'invoice', withSketches: sk };
  if (sk) return { want: 'sketch', withSketches: false };
  return { want: 'any', withSketches: false };
}

// מספר החשבונית: ספרות מה-ref, ואם אין — מהטקסט (הספרות הארוכה ביותר).
// ⚠️ תיקון סופי 8: L+ספרות הוא מספר **הזמנה** ("חשבונית להזמנה L1001") — לא
//    חשבונית 1001. נזרק מה-ref ומהטקסט לפני שמחפשים ספרות.
const ORDER_REF = /(?<![a-z\d])l\d+(?!\d)/gi;
function _docDigits(ref, text) {
  const strip = s => String(s || '').replace(ORDER_REF, ' ');
  const grab = s => (strip(s).match(/\d+/g) || []).sort((a, b) => b.length - a.length)[0] || '';
  return grab(ref) || grab(text);
}

// הזמנת הלקוח עם סקיצה קיימת? ⚠️ תיקון סופי 7: לפי הסימון בהזמנה (hasSketch,
// כמו lgHasSketch בדפדפן, או סקיצה ישנה בתוך ההזמנה) — **בלי** להוריד את ה-base64
// מ-sketches/ רק כדי לדעת שהוא קיים. השליחה טוענת את הקובץ ובודקת שוב.
// (sketchName לבד אינו סקיצה — זה שם; הזמנה בלי תמונה הייתה נחסמת בשליחה.)
function _hasSketch(order) {
  return !!(order && (order.hasSketch || order.sketch));
}

async function _findInvoice(db, cid, digits, orders, withSketches) {
  if (!digits) return null;
  // docNumber יכול להישמר כמחרוזת או כמספר — שתי השאילתות
  const hits = {};
  for (const v of [digits, Number(digits)]) {
    const s = (await db.ref('invoicePdf').orderByChild('docNumber').equalTo(v).once('value')).val() || {};
    Object.assign(hits, s);
  }
  const keys = Object.keys(hits).filter(k => { const r = hits[k]; return r && r.state === 'ready' && cid && String(r.accountKey || '') === cid; }).sort();
  if (!keys.length) return null;
  const rec = hits[keys[0]];
  const out = { kind: 'invoice', invoiceKey: keys[0], docNumber: rec.docNumber, orderIds: [] };
  if (withSketches) {
    // רק הזמנות של הלקוח עצמו שיש להן סקיצה
    for (const id of Array.isArray(rec.orderIds) ? rec.orderIds : []) {
      const o = orders.find(x => x.id === String(id));
      if (o && _hasSketch(o)) out.orderIds.push(o.id);
    }
  }
  return out;
}

async function _findSketch(db, orders, ref) {
  if (!String(ref || '').trim()) return null;
  const found = lgOkevFind(orders, { ref });
  if (found.match === 'none') return null;
  const withSk = [];
  for (const o of found.orders) if (_hasSketch(o)) withSk.push(o);
  if (!withSk.length) return null;
  if (withSk.length === 1) return { kind: 'sketch', orderId: withSk[0].id, orderIds: [withSk[0].id] };
  return { kind: 'many', orders: withSk.map(o => ({ id: o.id, orderNum: o.orderNum, refNum: o.refNum, sketchName: o.sketchName })) };
}

//  { kind:'invoice', invoiceKey, docNumber, orderIds[] (סקיצות מצורפות)}
//  | { kind:'sketch', orderId, orderIds:[orderId] }
//  | { kind:'many', orders[] }   — כמה הזמנות מתאימות (הרחבה לממשק; שואלים "על איזו")
//  | { kind:'none' }
//  p.orders (אופציונלי) = הזמנות הלקוח כבר טעונות; אחרת נקראות וממוינות לפי customerId.
async function lgArchiveFind(db, p) {
  const cid = String((p && p.customerId) || '');
  const ref = String((p && p.ref) || '');
  const text = (p && p.text) || '';
  if (!cid) return { kind: 'none' };
  let orders = p.orders;
  if (!Array.isArray(orders)) {
    const all = (await db.ref('orders').once('value')).val() || {};
    orders = Object.entries(all).filter(([, x]) => x && String(x.customerId || '') === cid).map(([id, x]) => ({ ...x, id }));
  }
  const w = lgArchiveWants(text);
  const digits = _docDigits(ref, text);
  let hit = null;
  if (w.want === 'invoice') hit = await _findInvoice(db, cid, digits, orders, w.withSketches);
  else if (w.want === 'sketch') hit = await _findSketch(db, orders, ref);
  else {
    // בלי מילת מפתח: ref של ספרות בלבד = חשבונית; אם אין כזו — הזמנה
    if (/^\s*\d+\s*$/.test(ref)) hit = await _findInvoice(db, cid, digits, orders, false);
    if (!hit) hit = await _findSketch(db, orders, ref);
  }
  return hit || { kind: 'none' };
}

// ─── טהור: תוצאת חיפוש → { actions, conv } ──────────────────────────
//  who = שם הלקוח לשאול. 'many' → שאלת "על איזו הזמנה" (conv which, intent document).
function lgArchiveActions(r, found, now) {
  const f = found || { kind: 'none' };
  const who = String(r.customerName || r.sender || '');
  if (f.kind === 'invoice') {
    const files = [{ kind: 'invoice-copy', invoiceKey: f.invoiceKey }, ...(f.orderIds || []).map(id => ({ kind: 'sketch', orderId: id }))];
    return { actions: [{ type: 'files', text: ARCHIVE_OK_TEXT, files }], archived: true };
  }
  if (f.kind === 'sketch') return { actions: [{ type: 'files', text: ARCHIVE_OK_TEXT, files: [{ kind: 'sketch', orderId: f.orderId }] }], archived: true };
  if (f.kind === 'many') {
    return { actions: [{ type: 'reply', text: lgOkevReply('status', { match: 'many', orders: f.orders }) }],
             conv: { await: 'which', intent: 'document', orderIds: f.orders.map(o => o.id), at: now }, archived: true };
  }
  const w = lgArchiveWants(r.text);
  const what = w.want === 'sketch' || (w.want === 'any' && !/^\s*\d+\s*$/.test(String(r.ref || ''))) ? 'סקיצה' : 'חשבונית';
  return { actions: [{ type: 'staff', text: 'ביקשו ' + what + ' ' + String(r.ref || '') + ' — לא נמצא אצל ' + who },
                     { type: 'reply', text: ARCHIVE_HOLD_TEXT }], archived: true };
}

module.exports = { ARCHIVE_OK_TEXT, ARCHIVE_HOLD_TEXT, lgArchiveWants, lgArchiveFind, lgArchiveActions };
