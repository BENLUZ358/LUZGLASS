// ═══════════════════════════════════════════════════════════════════
//  order-attachments.js — כמה תמונות על הזמנה אחת (בן, 10/11).
//  אפיון: docs/superpowers/specs/2026-11-10-order-attachments-design.md
//
//  להזמנה סקיצה אחת (sketches/<id>, כמו תמיד). אליה אפשר לצרף תמונות
//  "גרפיקה חלבי" / "שרטוט פרזול": התמונה ב-sketches/<id>__att<k> (כמו
//  __layer / __base הקיימים), והפרטים ב-orders/<id>/attachments/<k>.
//  איחוד = ההזמנה שנגררה נמחקת מהתור, ועותק מלא שלה נשמר ב-from כדי
//  ש"הפרד" יחזיר אותה בדיוק כמו שהייתה.
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-order-attachments.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const LG_ATT_KINDS = { graphic: 'גרפיקה חלבי', hardware: 'שרטוט פרזול' };

const _attMail = s => { const m = String(s || '').match(/<([^>]+)>/); return String(m ? m[1] : s || '').trim().toLowerCase(); };

function lgAttList(order) {
  const a = (order && order.attachments) || {};
  return Object.keys(a).map(Number).filter(k => Number.isInteger(k) && a[k] && LG_ATT_KINDS[a[k].kind])
    .sort((x, y) => x - y)
    .map(k => ({ k, kind: a[k].kind, label: LG_ATT_KINDS[a[k].kind], at: a[k].at || 0 }));
}

function lgAttSlides(order) {
  return [{ label: 'סקיצה', key: order.id },
          ...lgAttList(order).map(a => ({ label: a.label, key: order.id + '__att' + a.k, k: a.k }))];
}

function lgAttCanMerge(src, dst) {
  if (!src || !dst || !src.id || !dst.id) return { ok: false, why: 'הזמנה לא נמצאה' };
  if (src.id === dst.id) return { ok: false, why: 'אי אפשר לחבר הזמנה לעצמה' };
  if (src.stage) return { ok: false, why: 'אפשר לחבר רק תמונה שעוד בתור הסקיצות' };
  if (src.items && Object.keys(src.items).length) return { ok: false, why: 'לתמונה הזו כבר הוזנו פריטים — היא הזמנה, לא צרופה' };
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

//  ההזמנות שאפשר לחבר אליהן — אותו לקוח, כל שלב, החדשה למעלה, עד 12
function lgAttCandidates(src, orders) {
  return (orders || []).filter(o => o && o.id !== src.id && lgAttCanMerge(src, o).ok)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
}

function _attNextK(dst) {
  const ks = Object.keys((dst && dst.attachments) || {}).map(Number).filter(Number.isInteger);
  return (ks.length ? Math.max(...ks) : 0) + 1;
}

//  src/dst = רשומות ההזמנה. srcSketch = data URL של התמונה. extra = { layer, base } של עורך הסקיצות.
//  → { k, upd } — עדכון רב-נתיבי אחד (אטומי)
function lgAttMergePlan(src, dst, kind, srcSketch, extra, now, by) {
  if (!LG_ATT_KINDS[kind]) throw new Error('סוג צרופה לא מוכר');
  const k = _attNextK(dst);
  const e = extra || {};
  const upd = {};
  upd['sketches/' + dst.id + '__att' + k] = srcSketch;
  upd['orders/' + dst.id + '/attachments/' + k] = { kind, at: now, by: String(by || ''),
    from: { order: JSON.parse(JSON.stringify(src)), layer: e.layer || null, base: e.base || null } };
  upd['orders/' + dst.id + '/updatedAt'] = now;
  upd['orders/' + src.id] = null;
  upd['sketches/' + src.id] = null;
  upd['sketches/' + src.id + '__layer'] = null;
  upd['sketches/' + src.id + '__base'] = null;
  return { k, upd };
}

function lgAttSplitPlan(dst, k, attSketch) {
  const a = dst && dst.attachments && dst.attachments[k];
  if (!a || !a.from || !a.from.order || !a.from.order.id) throw new Error('הצרופה לא נמצאה');
  const o = a.from.order;
  const upd = {};
  upd['orders/' + o.id] = JSON.parse(JSON.stringify(o));
  upd['sketches/' + o.id] = attSketch;
  if (a.from.layer) upd['sketches/' + o.id + '__layer'] = a.from.layer;
  if (a.from.base) upd['sketches/' + o.id + '__base'] = a.from.base;
  upd['orders/' + dst.id + '/attachments/' + k] = null;
  upd['sketches/' + dst.id + '__att' + k] = null;
  upd['orders/' + dst.id + '/updatedAt'] = Date.now();
  return upd;
}

//  הודעת וואטסאפ שהפכה לצרופה → { orderId, k } | null
function lgAttFindByMsg(orders, waMessageId) {
  const id = String(waMessageId || '');
  if (!id) return null;
  for (const o of orders || []) {
    const a = (o && o.attachments) || {};
    for (const k of Object.keys(a)) {
      const f = a[k] && a[k].from && a[k].from.order;
      if (f && String(f.waMessageId || '') === id) return { orderId: o.id, k: Number(k) };
    }
  }
  return null;
}
