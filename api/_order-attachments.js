'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_order-attachments.js — צרופות להזמנה, בצד השרת (בן, 10/11).
//
//  עוזר משותף, לא route. אפיון: docs/superpowers/specs/2026-11-10-order-attachments-design.md
//  התמונה: sketches/<id>__att<k> (data URL). הרשומה: orders/<id>/attachments/<k> =
//  { kind:'graphic'|'hardware', at, by, from:{ order:<ההזמנה המקורית>, layer, base } }.
//  ⚠️ LG_ATT_KINDS ו-lgAttFindByMsg — העתק של order-attachments.js (הדפדפן).
// ═══════════════════════════════════════════════════════════════════

const LG_ATT_KINDS = { graphic: 'גרפיקה חלבי', hardware: 'שרטוט פרזול' };

//  [{ k, kind, label }] ממוין לפי k — בלי לקרוא תמונות
function lgAttListOf(order) {
  const a = (order && order.attachments) || {};
  return Object.keys(a).map(Number).filter(k => Number.isInteger(k) && a[k] && LG_ATT_KINDS[a[k].kind])
    .sort((x, y) => x - y)
    .map(k => ({ k, kind: a[k].kind, label: LG_ATT_KINDS[a[k].kind] }));
}

//  [{ k, kind, label, img:{mime,buf}|null }] — התמונה מ-sketches/<id>__att<k>
async function lgAttOf(db, orderId) {
  const id = String(orderId || '');
  if (!id || /[.#$[\]/]/.test(id)) return [];
  const atts = (await db.ref('orders/' + id + '/attachments').once('value')).val();
  if (!atts) return [];
  const { _dataUrl } = require('./_invoice-deliver');
  const out = [];
  for (const a of lgAttListOf({ attachments: atts })) {
    const d = _dataUrl((await db.ref('sketches/' + id + '__att' + a.k).once('value')).val());
    out.push({ ...a, img: d && d.buf.length && /^image\//.test(d.mime) ? d : null });
  }
  return out;
}

//  ההודעה בוואטסאפ של צרופה → { orderId, k } | null. orders: מערך עם id, או מפה id→הזמנה.
function lgAttFindByMsg(orders, waMessageId) {
  const id = String(waMessageId || '');
  if (!id) return null;
  const list = Array.isArray(orders) ? orders
    : Object.entries(orders || {}).map(([oid, o]) => (o ? { ...o, id: o.id || oid } : o));
  for (const o of list) {
    const a = (o && o.attachments) || {};
    for (const k of Object.keys(a)) {
      const f = a[k] && a[k].from && a[k].from.order;
      if (f && String(f.waMessageId || '') === id) return { orderId: o.id, k: Number(k) };
    }
  }
  return null;
}

module.exports = { LG_ATT_KINDS, lgAttListOf, lgAttOf, lgAttFindByMsg };
