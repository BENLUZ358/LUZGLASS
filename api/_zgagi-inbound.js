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
//  waMeta/zgagiItems/<k> — **רק השרת כותב שם** (waMeta סגור לדפדפן).
//  ⚠️ ההזמנה עצמה (source:'zgagi', zgagi:{…}) **אינה הוכחה**: ה-rules של
//  orders מאפשרים לפורטל ליצור הזמנה עם השדות האלה. כל מה שפועל על "הזמנה
//  מזגאגי" — החלפה, ביטול, שלבים, ו"הסקיצות טופלו" עם תמונות — בודק את
//  הרשומה (lgZgagiOwned), לא את ההזמנה.
//
//  k = גיבוב של [biz, order, itemId] — חיבור במחרוזת היה מתנגש (a + b_c
//  מול a_b + c), וזו הייתה החלפה של הזמנה של עסק אחר.
//
//  ─── תיקון ─────────────────────────────────────────────────────────
//
//  טביעת אצבע (lgZgagiFingerprint) שונה + rev גבוה יותר = תיקון. מותר רק
//  לפני ייצור (lgOkevCanChange — אותו כלל של העוקב), ונבדק **בתוך
//  הטרנזקציה** על ההזמנה: מישהו שמעביר אותה לייצור באותה שנייה — מנצח.
//  עם סקיצה חדשה, גם הציור של השרטט ושל תחנת הבדיקה נמחקים, כדי שאף אחד לא
//  יעבוד לפי הישנה. ואם ההזמנה כבר בחשבשבת — רישום בתיקון הזמנות.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgZgagiSkuResolver, lgZgagiItems, lgZgagiFingerprint } = require('./_zgagi-items');
const { lgInboxRefNum } = require('./_inbox-common');
const { lgOkevCanChange } = require('./_agent-okev');

const ITEMS = 'waMeta/zgagiItems';
// גוף הבקשה ב-Vercel מוגבל ל-4.5MB; תמונה אחת עד 3MB (base64)
const IMAGE_MAX_CHARS = 3 * 1024 * 1024;
const TYPES = ['sketch', 'measure', 'uploaded'];
//  תקרות — זגאגי אמין, אבל באג אחד שם (כמות 10⁷) לא יפיל כאן את הפונקציה
const MAX_QTY = 100, MAX_PANELS = 50, MAX_HARDWARE = 100;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const itemKey = (biz, order, itemId) =>
  crypto.createHash('sha1').update(JSON.stringify([String(biz), String(order), String(itemId)])).digest('hex').slice(0, 24);

const _hsSent = o => { const h = o && (o.hashavshevet || o.hsOrder); return !!(h && h.sentAt && !h.simulated); };
const _list = v => (Array.isArray(v) ? v : Object.values(v || {}));
const _recOf = (rec, biz, order, itemId) => !!(rec && rec.orderId && rec.biz === String(biz) && rec.order === String(order) && rec.itemId === String(itemId));

function _valid(b) {
  if (!b || typeof b !== 'object') return false;
  if (!ID_RE.test(String(b.biz || '')) || !ID_RE.test(String(b.order || ''))) return false;
  if (!/^\d{1,10}$/.test(String(b.customerNo || '').trim())) return false;
  const it = b.item;
  if (!it || typeof it !== 'object' || !ID_RE.test(String(it.itemId || '')) || !TYPES.includes(it.type)) return false;
  const qty = Number(it.qty == null ? 1 : it.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return false;
  if (it.output && it.output.panels && (!Array.isArray(it.output.panels) || it.output.panels.length > MAX_PANELS)) return false;
  if (it.hardware && (!Array.isArray(it.hardware) || it.hardware.length > MAX_HARDWARE)) return false;
  if (b.imagePng != null) {
    const s = String(b.imagePng);
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) || s.length > IMAGE_MAX_CHARS) return false;
  }
  return true;
}

//  שורה ↔ שורה לפי הזכוכית והעותק (paneId + groupIndex), לא לפי המקום ברשימה:
//  שינוי כמות מזיז את כל השורות שאחריו, ומחיקה מזיזה את מה שאחריה. בלי
//  paneId (מידה) — לפי העותק בלבד.
const _rowKey = (it, i) => (it.paneId || it.quantityGroupId ? `${it.paneId || 'm'}|${Number(it.groupIndex) || 0}` : `#${i}`);

// ─── תיקון הזמנות — אותו מבנה רשומה כמו lgAddHsCorrection בדפדפן ───
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
  const add = (it, i, type, from, to) => {
    out['hsCorrections/c' + at.toString(36) + 'z' + (seq++)] = {
      itemIndex: i, hsLine: Number(it.hsLine) || null, type, from: String(from), to: String(to), by, at, done: false };
  };
  const was = new Map(before.map((b, i) => [_rowKey(b, i), { b, i }]));
  after.forEach((a, i) => {
    const m = was.get(_rowKey(a, i));
    if (!m) { add(a, i, 'add', '', desc(a)); return; }
    was.delete(_rowKey(a, i));
    const b = m.b;
    if (!b.hsLine) { if (dimsOf(b) !== dimsOf(a) || (b.sku || '') !== (a.sku || '')) add(a, i, 'add', '', desc(a)); return; }
    if (dimsOf(b) !== dimsOf(a)) add(b, m.i, 'dims', dimsOf(b), dimsOf(a));
    if ((b.sku || '') !== (a.sku || '') || (b.name || '') !== (a.name || '')) add(b, m.i, 'glass', glassOf(b), glassOf(a));
  });
  was.forEach(({ b, i }) => { if (b.hsLine) add(b, i, 'remove', desc(b), ''); });
  return out;
}

//  hsLine שייך לשורה בחשבשבת — עובר לאותה זכוכית ואותו עותק, לא לאותו מקום
function _carryHsLines(before, after) {
  const by = new Map(before.map((b, i) => [_rowKey(b, i), b]));
  return after.map((a, i) => { const b = by.get(_rowKey(a, i)); return b && b.hsLine ? { ...a, hsLine: b.hsLine } : a; });
}

async function _catalog(db) {
  const v = (await db.ref('skuCatalog').once('value')).val() || {};
  return Object.keys(v).map(code => ({ code, name: v[code] && v[code].name, active: !(v[code] && v[code].active === false) }));
}

//  הפרזול: חשבשבת אצלנו מקבלת רק שורות זכוכית לפי מ"ר, ולכן הוא לא נכנס לשורות
//  — אבל הוא חייב להיראות. שורה בהערות, ומק"ט רק אם הוא באמת פריט פעיל אצלנו.
function _hardwareNote(hw, active) {
  if (!hw.length) return '';
  return 'פרזול (להוסיף בחשבשבת ידנית): ' + hw.map(h => `${String(h.name).slice(0, 60)} ×${h.qty}` +
    (h.sku && active.has(String(h.sku).toUpperCase()) ? ` (${h.sku})` : '')).join(', ');
}

//  האם ההזמנה הזו באמת נוצרה מזגאגי — לפי הרשומה שרק השרת כותב.
async function lgZgagiOwned(db, orderId) {
  const id = String(orderId || '');
  if (!/^zg_[0-9a-f]{24}$/.test(id)) return false;
  const rec = (await db.ref(ITEMS + '/' + id.slice(3)).once('value')).val();
  return !!(rec && rec.orderId === id && !rec.cancelledAt);
}

//  body: { biz, bizName, order, orderNo, customerNo, rev, item, imagePng? }
//  → { code:'ok'|'unknown-customer'|'bad-input', items?:{ [itemId]: {refNum, orderId, state, stage?} } }
//  state: created | same | replaced | locked | gone
async function lgZgagiReceive(db, body, now) {
  const t = now || Date.now();
  if (!_valid(body)) return { code: 'bad-input' };
  const it = body.item;
  const rev = Number(body.rev) || 0;
  const acc = (await db.ref('hashavshevetAccounts/' + String(body.customerNo).trim()).once('value')).val();
  if (!acc) return { code: 'unknown-customer' };

  const k = itemKey(body.biz, body.order, it.itemId);
  const id = 'zg_' + k;
  let rec = (await db.ref(ITEMS + '/' + k).once('value')).val();
  if (rec && rec.orderId && !_recOf(rec, body.biz, body.order, it.itemId)) return { code: 'bad-input' };
  const fp = lgZgagiFingerprint(it);
  const reply = (state, extra) => ({ code: 'ok', items: { [it.itemId]: { refNum: (rec && rec.refNum) || null, orderId: id, state, ...(extra || {}) } } });

  const catalog = await _catalog(db);
  const resolve = lgZgagiSkuResolver(catalog);
  const active = new Set(catalog.filter(e => e.active).map(e => e.code));
  const mapped = lgZgagiItems(it, resolve, active);
  const title = String(it.title || '').slice(0, 80);
  const sketchName = [title, body.orderNo ? String(body.orderNo).slice(0, 30) : ''].filter(Boolean).join(' · ');
  const notes = [...mapped.notes, _hardwareNote(mapped.hardware, active)].filter(Boolean).join(' · ').slice(0, 1500);
  const zg = { biz: String(body.biz), order: String(body.order), item: String(it.itemId), orderNo: String(body.orderNo || '').slice(0, 30), rev };

  // ── קיים: אותו דבר / תיקון ──
  if (rec && rec.orderId) {
    if (rec.cancelledAt) return reply('gone');
    if (rev <= (Number(rec.rev) || 0) || fp === rec.fp) {
      if (rev > (Number(rec.rev) || 0)) await db.ref(ITEMS + '/' + k).update({ rev, updatedAt: t });
      return reply('same');
    }
    let why = '', stage = '', order = null;
    const tx = await db.ref('orders/' + id).transaction(cur => {
      why = ''; order = null;
      if (cur === null) { why = 'gone'; return null; }      // null-first: null → פיירבייס מביא את הערך האמיתי
      if (!lgOkevCanChange(cur)) { why = 'locked'; stage = String(cur.stage || ''); return; }
      const before = _list(cur.items);
      const after = _carryHsLines(before, mapped.items);
      const next = { ...cur, items: after, hardware: mapped.hardware, sketchName, notes, zgagi: zg, zgagiUpdatedAt: t, updatedAt: t };
      if (body.imagePng) { next.hasSketch = true; delete next._editedSketch; }   // הציור של השרטט
      const corr = lgZgagiCorrections(cur, before, after, 'זגאגי', t);
      if (Object.keys(corr).length) {
        next.hsCorrections = { ...(cur.hsCorrections || {}) };
        Object.keys(corr).forEach(c => { next.hsCorrections[c.slice('hsCorrections/'.length)] = corr[c]; });
      }
      order = next;
      return next;
    });
    if (!tx.committed || !order) return reply(why || 'gone', why === 'locked' ? { stage } : undefined);
    const upd = {};
    if (body.imagePng) {
      upd['sketches/' + id] = String(body.imagePng);
      upd['checkEdits/' + id] = null;          // הציור של תחנת הבדיקה
      upd['sketches/' + id + '__layer'] = null;
      upd['sketches/' + id + '__base'] = null;
    }
    upd[ITEMS + '/' + k + '/fp'] = fp;
    upd[ITEMS + '/' + k + '/rev'] = rev;
    upd[ITEMS + '/' + k + '/updatedAt'] = t;
    await db.ref().update(upd);
    return reply('replaced');
  }

  // ── חדש ──
  const refNum = await lgInboxRefNum(db, ITEMS, k, rec || {});
  rec = { ...(rec || {}), refNum };
  // רק הראשון יוצר: שתי קריאות במקביל — השנייה רואה orderId ועונה same
  const claim = await db.ref(ITEMS + '/' + k + '/orderId').transaction(cur => (cur === null ? id : undefined));
  if (!claim.committed) return reply('same');
  const when = new Date(t);
  const tz = { timeZone: 'Asia/Jerusalem' };
  const name = String(acc.name || body.bizName || body.customerNo).slice(0, 120);
  const skip = (await db.ref('waMeta/zgagiConfig/skipFirstTab').once('value')).val() === true;
  const order = {
    id, refNum, orderNum: refNum,
    orderClient: name, client: name,
    phone: String(acc.phone || ''), clientPhone: String(acc.phone || ''),
    customerId: String(acc.key || body.customerNo).trim(),
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
  return reply('created');
}

module.exports = { lgZgagiReceive, lgZgagiCorrections, lgZgagiOwned, lgZgagiItemKey: itemKey, ZGAGI_ITEMS: ITEMS };
