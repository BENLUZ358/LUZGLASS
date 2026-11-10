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

// ─── איחוד בשרת (מרכזן, 10/11) ──────────────────────────────────────
//  ⚠️ העתק של lgAttCanMerge / _attNextK / lgAttMergePlan מ-order-attachments.js (הדפדפן).
//  scripts/test-attach-suggest.js משווה את שניהם על אותם קלטים — שינוי באחד בלי השני נכשל שם.
const _attMail = s => { const m = String(s || '').match(/<([^>]+)>/); return String(m ? m[1] : s || '').trim().toLowerCase(); };

function lgAttCanMerge(src, dst) {
  if (!src || !dst || !src.id || !dst.id) return { ok: false, why: 'הזמנה לא נמצאה' };
  if (src.id === dst.id) return { ok: false, why: 'אי אפשר לחבר הזמנה לעצמה' };
  if (src.stage) return { ok: false, why: 'אפשר לחבר רק תמונה שעוד בתור הסקיצות' };
  if (src.items && Object.keys(src.items).length) return { ok: false, why: 'לתמונה הזו כבר הוזנו פריטים — היא הזמנה, לא צרופה' };
  if (lgAttListOf(src).length) return { ok: false, why: 'לתמונה הזו יש כבר תמונות נוספות — קודם הפרד אותן' };
  if (src.hashavshevet && Object.keys(src.hashavshevet).length) return { ok: false, why: 'התמונה הזו כבר נשלחה לחשבשבת' };
  const sc = String(src.customerId || ''), dc = String(dst.customerId || '');
  if (sc || dc) {
    if (sc !== dc) return { ok: false, why: 'אפשר לחבר רק בין הזמנות של אותו לקוח' };
  } else {
    const sameWa = src.waSender && String(src.waSender) === String(dst.waSender || '');
    const sameMail = src.emailFrom && _attMail(src.emailFrom) === _attMail(dst.emailFrom);
    if (!sameWa && !sameMail) return { ok: false, why: 'אפשר לחבר רק בין הזמנות של אותו שולח' };
  }
  return { ok: true };
}

function _attNextK(dst, attNext) {
  const ks = Object.keys((dst && dst.attachments) || {}).map(Number).filter(Number.isInteger);
  const n = Number(attNext);
  return Math.max((ks.length ? Math.max(...ks) : 0) + 1, Number.isInteger(n) && n > 0 ? n : 1);
}

function lgAttMergePlan(src, dst, kind, srcSketch, extra, now, by, kAlloc) {
  if (!LG_ATT_KINDS[kind]) throw new Error('סוג צרופה לא מוכר');
  const k = Number.isInteger(kAlloc) && kAlloc > 0 ? kAlloc : _attNextK(dst, dst && dst.attNext);
  const e = extra || {};
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.sketch; delete copy.files;
  const upd = {};
  upd['sketches/' + dst.id + '__att' + k] = srcSketch;
  upd['orders/' + dst.id + '/attachments/' + k] = { kind, at: now, by: String(by || ''),
    from: { order: copy, layer: e.layer || null, base: e.base || null } };
  upd['orders/' + dst.id + '/updatedAt'] = now;
  upd['orders/' + src.id] = null;
  upd['sketches/' + src.id] = null;
  upd['sketches/' + src.id + '__layer'] = null;
  upd['sketches/' + src.id + '__base'] = null;
  return { k, upd };
}

const _okId = id => !!id && !/[.#$[\]/]/.test(id);

//  srcId (שורה בתור) → צרופה של dstId. בדיוק כמו lgAttMerge בדפדפן: k מוקצה בטרנזקציה על
//  orders/<dst>/attNext, ואז עדכון רב-נתיבי אחד. opts: { by, now, attachedBy, srcPatch }
//  srcPatch — שדות שנכנסים לעותק ב-from (למשל attachSuggest, כדי ש"הפרד" יחזיר את ההצעה).
//  → { ok:true, k } | { ok:false, why }
async function lgAttMergeServer(db, srcId, dstId, kind, opts) {
  const o = opts || {};
  const sid = String(srcId || ''), did = String(dstId || '');
  if (!_okId(sid) || !_okId(did)) return { ok: false, why: 'מזהה לא תקין' };
  if (!LG_ATT_KINDS[kind]) return { ok: false, why: 'סוג צרופה לא מוכר' };
  const read = async id => { const v = (await db.ref('orders/' + id).once('value')).val(); return v ? { ...v, id: v.id || id } : null; };
  const [src0, dst] = await Promise.all([read(sid), read(did)]);
  if (!src0 || !dst) return { ok: false, why: 'ההזמנה לא נמצאה' };
  const src = o.srcPatch ? { ...src0, ...o.srcPatch } : src0;
  const ok = lgAttCanMerge(src, dst);
  if (!ok.ok) return ok;
  const img = (await db.ref('sketches/' + sid).once('value')).val();
  if (!img) return { ok: false, why: 'אין תמונה להעביר' };
  const [l, b] = await Promise.all([db.ref('sketches/' + sid + '__layer').once('value'), db.ref('sketches/' + sid + '__base').once('value')]);
  const minK = _attNextK(dst, dst.attNext);
  const tx = await db.ref('orders/' + did + '/attNext').transaction(cur => _attNextK(null, Math.max(Number(cur) || 0, minK)) + 1);
  if (!tx || !tx.committed) return { ok: false, why: 'לא הוקצה מקום לצרופה' };
  const k = Number(tx.snapshot.val()) - 1;
  const now = Number(o.now) || Date.now();
  const plan = lgAttMergePlan(src, dst, kind, img, { layer: l.val(), base: b.val() }, now, o.by, k);
  if (o.attachedBy) plan.upd['orders/' + did + '/attachments/' + k].attachedBy = String(o.attachedBy);
  await db.ref().update(plan.upd);
  return { ok: true, k };
}

// ─── חדר הסוכנים: בן צירף / הפריד בדפדפן (קולט, 11/11) ─────────────────
//  האיחוד וההפרדה נכתבים מהדפדפן (lgAttMerge / lgAttSplit), שלא כותב ל-waMeta — ולכן אחרי
//  ההצלחה הוא קורא ל-att-room, והשרת **מוודא שזה באמת קרה** לפני השורה בחדר:
//    merge — ל-orderId יש צרופה שמקורה srcId (ולא כזו שהמרכזן צירף לבד — הוא כותב שורה משלו)
//    split — srcId חזרה להיות הזמנה, ול-orderId כבר אין צרופה ממנה
//  השורה — lgAgentEvent של הקולט (כבוי → כלום; בלי הגדרות → אפור). בלי בדיקת כפילות: אדמין בלבד.
//  b: { op:'merge'|'split', orderId (ההזמנה שמקבלת/מאבדת), srcId }. o: { env, now }
async function lgAttRoomEvent(db, b, o) {
  const x = b || {}, opt = o || {};
  if (!['merge', 'split'].includes(x.op)) return { ok: false, code: 'bad-op', message: 'פעולה לא מוכרת' };
  const did = String(x.orderId || ''), sid = String(x.srcId || '');
  if (!_okId(did) || !_okId(sid) || did.length > 200 || sid.length > 200) return { ok: false, code: 'bad-key', message: 'מזהה לא תקין' };
  const dst = (await db.ref('orders/' + did).once('value')).val();
  if (!dst) return { ok: false, code: 'missing', message: 'ההזמנה לא נמצאה' };
  const atts = dst.attachments || {};
  const k = Object.keys(atts).find(i => atts[i] && atts[i].from && atts[i].from.order && String(atts[i].from.order.id) === sid);
  const a = k != null ? atts[k] : null;
  const where = 'הזמנה ' + String(dst.orderNum || dst.sketchName || did).slice(0, 40)
    + (dst.orderClient || dst.client ? ' · ' + String(dst.orderClient || dst.client).slice(0, 60) : '');
  let text;
  if (x.op === 'merge') {
    if (!a || a.attachedBy === 'markazan') return { ok: false, code: 'not-merged', message: 'הצרופה לא נמצאה' };
    text = 'בן צירף ' + (LG_ATT_KINDS[a.kind] || 'צרופה') + ' ל' + where + ' (מהתור)';
  } else {
    if (a || !(await db.ref('orders/' + sid).once('value')).val()) return { ok: false, code: 'not-split', message: 'הצרופה לא הופרדה' };
    text = 'בן הפריד צרופה מ' + where + ' — חזרה לתור הסקיצות';
  }
  await require('./_agent-watch').lgAgentEvent(db, 'kolet', { kind: 'info', text, ref: { orderId: did } }, { env: opt.env, now: opt.now });
  return { ok: true, code: '' };
}

module.exports = { lgAttRoomEvent, LG_ATT_KINDS, lgAttListOf, lgAttOf, lgAttFindByMsg, lgAttCanMerge, lgAttMergePlan, lgAttMergeServer };
