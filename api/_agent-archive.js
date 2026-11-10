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

// ─── שיפור 4 (חדר הסוכנים, 11/11): "כל החשבוניות של אוקטובר" ─────────────
//  חודש בשם עברי (עם/בלי שנה, עם תחילית ב/ל/מ/ו/ש/ה) או MM/YYYY / M/YY.
//  בלי שנה → המופע האחרון שאינו בעתיד (שעון ישראל). תאריך מלא (15/10/2026) — לא חודש.
//  החיפוש: invoicePdf בטווח createdAt של החודש (+45 יום — חשבונית שהודפסה אחר כך),
//  רק 'ready' של אותו כרטיס (accountKey === customerId), לפי date של החשבונית.
//  עד 10 → נשלחות (שכבת השליחה בודקת שוב כל קובץ); יותר → הודעה עם הכמות + בן.
//  ⚠️ רק כשיש הגדרות במסך (byMonth מ-_agent-act) — בלעדיהן כמו קודם.
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const _HE_ALT = { 'מרס': 3 };
const ARCHIVE_MONTH_MAX = 10;
const _monthRe = () => new RegExp('(^|[^א-ת])[בלמושה]?(' + [...HE_MONTHS, ...Object.keys(_HE_ALT)].join('|')
  + ')(?![א-ת])(?:\\s*(\\d{4}))?');
const _NUM_MONTH = /(^|[^\d./-])(\d{1,2})[./-](\d{4}|\d{2})(?![\d]|[./-]\d)/;
function _ilYm(now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { y: Number(p.year), m: Number(p.month) };
}
//  → { ym:'YYYY-MM', token } או null
function _monthOf(text, now) {
  const t = String(text == null ? '' : text);
  const cur = _ilYm(Number(now) || Date.now());
  const he = t.match(_monthRe());
  let m = 0, y = 0, token = '';
  if (he) {
    m = HE_MONTHS.indexOf(he[2]) + 1 || _HE_ALT[he[2]];
    y = he[3] ? Number(he[3]) : (m > cur.m ? cur.y - 1 : cur.y);
    token = he[0];
  } else {
    const n = t.match(_NUM_MONTH);
    if (!n) return null;
    m = Number(n[2]); y = n[3].length === 2 ? 2000 + Number(n[3]) : Number(n[3]);
    //  סקירת שחרור 11/11: "12/10" / "5/11" — יום/חודש, לא חודש/שנה
    if (n[3].length === 2 && Number(n[3]) >= 1 && Number(n[3]) <= 12 && m <= 31) return null;
    //  מספרים: רק שנה בטווח [השנה − 3, השנה]
    if (y < cur.y - 3 || y > cur.y) return null;
    token = n[0];
  }
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) return null;
  return { ym: y + '-' + String(m).padStart(2, '0'), token };
}
const lgArchiveMonth = (text, now) => { const r = _monthOf(text, now); return r ? r.ym : ''; };
//  "אוקטובר 2026"
const lgArchiveMonthName = ym => { const [y, m] = String(ym).split('-').map(Number); return (HE_MONTHS[m - 1] || '') + ' ' + y; };
//  "מאוקטובר 2026" / "ממרץ 2026"
const _fromMonth = ym => 'מ' + lgArchiveMonthName(ym);

async function _findMonth(db, cid, ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) - 3 * 24 * 3600 * 1000;
  const end = Date.UTC(y, m, 1) + 45 * 24 * 3600 * 1000;
  const v = (await db.ref('invoicePdf').orderByChild('createdAt').startAt(start).endAt(end).once('value')).val() || {};
  const keys = Object.keys(v).filter(k => {
    const r = v[k];
    return r && r.state === 'ready' && cid && String(r.accountKey || '') === cid && String(r.date || '').slice(0, 7) === ym;
  }).sort((a, b) => String(v[a].date).localeCompare(String(v[b].date)) || (Number(v[a].docNumber) || 0) - (Number(v[b].docNumber) || 0));
  if (!keys.length) return null;
  if (keys.length > ARCHIVE_MONTH_MAX) return { kind: 'invoices-many', month: ym, count: keys.length };
  return { kind: 'invoices', month: ym, invoiceKeys: keys, count: keys.length };
}
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
  //  שיפור 4: חודש בלי מספר חשבונית → כל החשבוניות של החודש
  const mo = p.byMonth === true && w.want === 'invoice' ? _monthOf(text, p.now) || _monthOf(ref, p.now) : null;
  const strip = s => (mo ? String(s || '').split(mo.token).join(' ') : s);
  const digits = mo ? _docDigits(strip(ref).replace(_NUM_MONTH, ' '), strip(text)) : _docDigits(ref, text);
  if (mo && !digits) return (await _findMonth(db, cid, mo.ym)) || { kind: 'none', month: mo.ym };
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
  if (f.kind === 'invoices') {
    const files = (f.invoiceKeys || []).map(k => ({ kind: 'invoice-copy', invoiceKey: k }));
    const text = files.length === 1 ? ARCHIVE_OK_TEXT : 'מצורפות ' + files.length + ' חשבוניות ' + _fromMonth(f.month);
    return { actions: [{ type: 'files', text, files }], archived: true };
  }
  if (f.kind === 'invoices-many') {
    return { actions: [{ type: 'ask', who, question: String(r.text || '').trim(),
      hold: 'יש ' + f.count + ' חשבוניות ' + _fromMonth(f.month) + ' — יותר מדי לשלוח כאן. אנחנו בודקים ונחזור אליך בהקדם.',
      note: 'ביקשו את כל החשבוניות ' + _fromMonth(f.month) + ' — ' + f.count + ' חשבוניות, יותר מ-' + ARCHIVE_MONTH_MAX }], archived: true };
  }
  if (f.kind === 'none' && f.month) {
    return { actions: [{ type: 'ask', who, question: String(r.text || '').trim(), note: 'ביקשו חשבוניות ' + _fromMonth(f.month) + ' — לא נמצא' }], archived: true };
  }
  if (f.kind === 'sketch') return { actions: [{ type: 'files', text: ARCHIVE_OK_TEXT, files: [{ kind: 'sketch', orderId: f.orderId }] }], archived: true };
  if (f.kind === 'many') {
    return { actions: [{ type: 'reply', text: lgOkevReply('status', { match: 'many', orders: f.orders }) }],
             conv: { await: 'which', intent: 'document', orderIds: f.orders.map(o => o.id), at: now }, archived: true };
  }
  const w = lgArchiveWants(r.text);
  const what = w.want === 'sketch' || (w.want === 'any' && !/^\s*\d+\s*$/.test(String(r.ref || ''))) ? 'סקיצה' : 'חשבונית';
  //  לא נמצא → "לא יודע → בן" (חדר הסוכנים, בן 10/11): צהוב בחדר + "קיבלנו" ללקוח (הביצוע ב-_agent-act)
  const note = ['ביקשו', what, String(r.ref || '').trim()].filter(Boolean).join(' ') + ' — לא נמצא';
  return { actions: [{ type: 'ask', who, question: String(r.text || '').trim(), note }], archived: true };
}

module.exports = { ARCHIVE_OK_TEXT, ARCHIVE_HOLD_TEXT, ARCHIVE_MONTH_MAX, lgArchiveMonth, lgArchiveMonthName, lgArchiveWants, lgArchiveFind, lgArchiveActions };
