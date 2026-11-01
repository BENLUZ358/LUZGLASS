// ═══════════════════════════════════════════════════════════════════
//  api/_zgagi-inbound.js — פריט שנשלח מזגאגי → הזמנה בתור הסקיצות.
//
//  עוזר משותף, לא route. נקרא מ-_zgagi-route.js (op 'receive').
//  אפיון: docs/superpowers/specs/2026-11-01-zgagi-luzglass-link-design.md
//
//  ─── הזהות ─────────────────────────────────────────────────────────
//
//  פריט אחד בזגאגי = הזמנה אחת אצלנו (בן, 1/11: "כל הזמנה זה סקיצה
//  בנפרד כמו היום"). הזהות היא biz/order/itemId, והרשומה שלה יושבת ב-
//  waMeta/zgagiItems/<k> — **רק השרת כותב שם**. כל מה שמשנה הזמנה קיימת
//  (החלפה, ביטול, שלבים) עובר דרך הרשומה הזו, ולא דרך source:'zgagi'
//  שעל ההזמנה: את זה פורטל יכול לזייף, כי ה-rules לא חוסמים אותו.
//
//  ─── תיקון ─────────────────────────────────────────────────────────
//
//  טביעת אצבע (lgZgagiFingerprint) שונה + rev גבוה יותר = תיקון. מותר רק
//  לפני ייצור (lgOkevCanChange — אותו כלל של העוקב). מותר → הסקיצה והפריטים
//  מוחלפים **בכל מקום** (גם הציור של השרטט ושל תחנת הבדיקה נמחקים, כדי
//  שאף אחד לא יעבוד לפי הישנה), ואם ההזמנה כבר בחשבשבת — רישום בתיקון
//  הזמנות, שמישהו יתקן שם ביד.
// ═══════════════════════════════════════════════════════════════════

const { lgZgagiSkuResolver, lgZgagiItems, lgZgagiFingerprint } = require('./_zgagi-items');
const { lgInboxRefNum } = require('./_inbox-common');
const { lgOkevCanChange } = require('./_agent-okev');

const ITEMS = 'waMeta/zgagiItems';
// גוף הבקשה ב-Vercel מוגבל ל-4.5MB; תמונה אחת עד 3MB (base64)
const IMAGE_MAX_CHARS = 3 * 1024 * 1024;
const TYPES = ['sketch', 'measure', 'uploaded'];

//  RTDB אוסרת . # $ [ ] / במפתח
const key = s => String(s == null ? '' : s).replace(/[.#$[\]/]/g, '_');
const itemKey = (biz, order, itemId) => key(biz) + '_' + key(order) + '_' + key(itemId);

const _hsSent = o => { const h = o && (o.hashavshevet || o.hsOrder); return !!(h && h.sentAt && !h.simulated); };
const _list = v => (Array.isArray(v) ? v : Object.values(v || {}));

function _valid(b) {
  if (!b || typeof b !== 'object') return false;
  if (!b.biz || !b.order || !b.customerNo) return false;
  const it = b.item;
  if (!it || typeof it !== 'object' || !it.itemId || !TYPES.includes(it.type)) return false;
  if (b.imagePng != null) {
    const s = String(b.imagePng);
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) || s.length > IMAGE_MAX_CHARS) return false;
  }
  return true;
}

// ─── תיקון הזמנות — אותם רישומים כמו lgHsCorrectionsForEdit בדפדפן ───
//  (firebase-db.js; scripts/test-zgagi-inbound.js ה. בודק שהם זהים).
//  מחזיר { 'hsCorrections/<k>': {...} } — יחסית ל-orders/<id>.
function lgZgagiCorrections(order, before, after, by, at) {
  const out = {};
  if (!_hsSent(order)) return out;
  before = before || []; after = after || [];
  let seq = 0;
  const desc = it => (it.glassFullName || it.name || 'פריט') + (it.sku ? ' (' + it.sku + ')' : '') +
    ' ' + Math.round(Number(it.w) || 0) + '×' + Math.round(Number(it.h) || 0);
  const glassOf = it => (it.glassFullName || it.name || '') + (it.sku ? ' (' + it.sku + ')' : '');
  const dimsOf = it => Math.round(Number(it.w) || 0) + '×' + Math.round(Number(it.h) || 0);
  const same = (a, b) => dimsOf(a) === dimsOf(b) && (a.sku || '') === (b.sku || '') && (a.name || '') === (b.name || '');
  const add = (list, i, type, from, to) => {
    const it = list[i] || {};
    out['hsCorrections/c' + at.toString(36) + 'z' + (seq++)] = {
      itemIndex: i, hsLine: Number(it.hsLine) || null, type, from: String(from), to: String(to), by, at, done: false };
  };
  const compare = i => {
    const b = before[i], a = after[i];
    if (!b || !a || same(b, a)) return;
    if (!b.hsLine) { add(after, i, 'add', '', desc(a)); return; }
    if (dimsOf(b) !== dimsOf(a)) add(before, i, 'dims', dimsOf(b), dimsOf(a));
    if ((b.sku || '') !== (a.sku || '') || (b.name || '') !== (a.name || '')) add(before, i, 'glass', glassOf(b), glassOf(a));
  };
  if (after.length >= before.length) {
    for (let i = 0; i < before.length; i++) compare(i);
    for (let i = before.length; i < after.length; i++) add(after, i, 'add', '', desc(after[i]));
    return out;
  }
  let j = 0;
  before.forEach((b, i) => {
    if (j < after.length && same(b, after[j])) { j++; return; }
    if (b.hsLine) add(before, i, 'remove', desc(b), '');
  });
  return out;
}

async function _catalog(db) {
  const v = (await db.ref('skuCatalog').once('value')).val() || {};
  return Object.keys(v).map(code => ({ code, name: v[code] && v[code].name, active: !(v[code] && v[code].active === false) }));
}

//  body: { biz, bizName, order, orderNo, customerNo, rev, item, imagePng? }
//  → { code:'ok'|'unknown-customer'|'bad-input', items?:{ [itemId]: {refNum, orderId, state, stage?} } }
//  state: created | same | replaced | locked | gone
async function lgZgagiReceive(db, body, now) {
  const t = now || Date.now();
  if (!_valid(body)) return { code: 'bad-input' };
  const it = body.item;
  const rev = Number(body.rev) || 0;
  const acc = (await db.ref('hashavshevetAccounts/' + key(body.customerNo)).once('value')).val();
  if (!acc) return { code: 'unknown-customer' };

  const k = itemKey(body.biz, body.order, it.itemId);
  const id = 'zg_' + k;
  const rec = (await db.ref(ITEMS + '/' + k).once('value')).val();
  const fp = lgZgagiFingerprint(it);
  const reply = (state, extra) => ({ code: 'ok', items: { [it.itemId]: { refNum: (rec && rec.refNum) || (extra && extra.refNum) || null, orderId: id, state, ...(extra || {}) } } });

  const catalog = await _catalog(db);
  const resolve = lgZgagiSkuResolver(catalog);
  const active = new Set(catalog.filter(e => e.active).map(e => e.code));
  const mapped = lgZgagiItems(it, resolve, active);
  const title = String(it.title || '').slice(0, 80);
  const sketchName = [title, body.orderNo ? String(body.orderNo) : ''].filter(Boolean).join(' · ');
  const notes = mapped.notes.join(' · ');
  const zg = { biz: String(body.biz), order: String(body.order), item: String(it.itemId), orderNo: String(body.orderNo || ''), rev };

  // ── קיים: אותו דבר / תיקון ──
  if (rec && rec.orderId) {
    if (rev <= (Number(rec.rev) || 0) || fp === rec.fp) {
      if (rev > (Number(rec.rev) || 0)) await db.ref(ITEMS + '/' + k).update({ rev, updatedAt: t });
      return reply('same');
    }
    const order = (await db.ref('orders/' + id).once('value')).val();
    if (!order) return reply('gone');
    if (!lgOkevCanChange(order)) return reply('locked', { stage: order.stage || '' });

    const before = _list(order.items);
    // hsLine שייך לשורה בחשבשבת — נשאר על השורה באותו מקום
    const after = mapped.items.map((x, i) => (before[i] && before[i].hsLine && i < before.length ? { ...x, hsLine: before[i].hsLine } : x));
    const upd = {};
    const P = 'orders/' + id + '/';
    upd[P + 'items'] = after;
    upd[P + 'hardware'] = mapped.hardware;
    upd[P + 'sketchName'] = sketchName;
    upd[P + 'notes'] = notes;
    upd[P + 'zgagi'] = zg;
    upd[P + 'zgagiUpdatedAt'] = t;
    upd[P + 'updatedAt'] = t;
    upd[P + '_editedSketch'] = null;        // הציור של השרטט
    upd['checkEdits/' + id] = null;          // הציור של תחנת הבדיקה
    upd['sketches/' + id + '__layer'] = null;
    upd['sketches/' + id + '__base'] = null;
    if (body.imagePng) { upd['sketches/' + id] = String(body.imagePng); upd[P + 'hasSketch'] = true; }
    const corr = lgZgagiCorrections(order, before, after, 'זגאגי', t);
    Object.keys(corr).forEach(c => { upd[P + c] = corr[c]; });
    upd[ITEMS + '/' + k + '/fp'] = fp;
    upd[ITEMS + '/' + k + '/rev'] = rev;
    upd[ITEMS + '/' + k + '/updatedAt'] = t;
    await db.ref().update(upd);
    return reply('replaced');
  }

  // ── חדש ──
  const refNum = await lgInboxRefNum(db, ITEMS, k, rec || {});
  const when = new Date(t);
  const tz = { timeZone: 'Asia/Jerusalem' };
  const name = String(acc.name || body.bizName || body.customerNo);
  const skip = (await db.ref('waMeta/zgagiConfig/skipFirstTab').once('value')).val() === true;
  const order = {
    id, refNum, orderNum: refNum,
    orderClient: name, client: name,
    phone: String(acc.phone || ''), clientPhone: String(acc.phone || ''),
    customerId: String(acc.key || body.customerNo),
    businessName: name,
    sketchName, notes, read: false,
    items: mapped.items, hardware: mapped.hardware,
    hasSketch: !!body.imagePng,
    stage: '', status: 'ממתין לאישור', paymentStatus: 'unpaid',
    source: 'zgagi', zgagi: zg,
    date: when.toLocaleDateString('he-IL', tz),
    time: when.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' }),
    createdAt: t, updatedAt: t,
    // עתידי (בן, 1/11): בלי הלשונית הראשונה. ההודעה ללקוח — מרשת הביטחון
    ...(skip ? { sketchSeenAt: t } : {}),
  };
  const upd = { ['orders/' + id]: order };
  if (body.imagePng) upd['sketches/' + id] = String(body.imagePng);
  upd[ITEMS + '/' + k] = { orderId: id, refNum, fp, rev, biz: zg.biz, order: zg.order, itemId: zg.item, createdAt: t, updatedAt: t };
  await db.ref().update(upd);
  return reply('created', { refNum });
}

module.exports = { lgZgagiReceive, lgZgagiCorrections, lgZgagiItemKey: itemKey, ZGAGI_ITEMS: ITEMS };
