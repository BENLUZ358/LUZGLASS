// ═══════════════════════════════════════════════════════════════════════
//  לשונית "אביבי" ביום עבודה — עטיפה ומוכן להובלה (בן, 17/11)
//  אפיון: docs/superpowers/specs/2026-11-17-avivi-wrap-tab-design.md
//
//  זכוכית של אביבי נחתכת, מונחת בצד, ובסוף היום עוטפים אותה וכותבים את
//  מספר ה-PO על העטיפה. כאן רק החישוב: מי אביבי, מה עטוף, מה מוכן, והחיפוש
//  לפי מה שכתוב על מדבקת אופטי-ווי (סוף ה-PO + מידות). התצוגה ב-workday.html.
//
//  שמירה: orders/<id>/avWrap/<idx> = זמן. זה סימון בלבד — אין שלב חדש, ולכן
//  החשבוניות, הפורטל וההודעות לא יודעים עליו כלום.
// ═══════════════════════════════════════════════════════════════════════

const LG_AV_CARD = '450';

function lgAvIsAvivi(o) {
  if (!o) return false;
  if (String(o.customerId == null ? '' : o.customerId) === LG_AV_CARD) return true;
  return String(o.orderClient || '').includes('אביבי');
}

//  Firebase מחזיר אינדקסים רצופים כמערך — שתי הצורות נקראות אותו דבר.
//  אינדקס של פריט שכבר לא קיים לא נספר.
function lgAvWrappedIdxs(o) {
  const w = (o && o.avWrap) || {}, n = ((o && o.items) || []).length, out = [];
  Object.keys(w).forEach(k => {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < n && w[k]) out.push(i);
  });
  return out.sort((a, b) => a - b);
}

//  הזמנה בלי פריטים לעולם אינה מוכנה — כדי שלא תצא בהובלה בטעות.
function lgAvIsReady(o) {
  const n = ((o && o.items) || []).length;
  return n > 0 && lgAvWrappedIdxs(o).length === n;
}

//  לסינון (בן, 17/11): 'none' = אף זכוכית לא נעטפה, 'partial', 'ready'.
function lgAvState(o) {
  if (lgAvIsReady(o)) return 'ready';
  return lgAvWrappedIdxs(o).length ? 'partial' : 'none';
}

//  סדר ברשימה: חלקיות קודם (באמצע עבודה), אחר כך לא התחילו, מוכנות בסוף.
const LG_AV_ORDER = { partial: 0, none: 1, ready: 2 };
function lgAvSort(list) {
  return (list || []).slice().sort((a, b) => LG_AV_ORDER[lgAvState(a)] - LG_AV_ORDER[lgAvState(b)]
    || String(a.sketchName || '').localeCompare(String(b.sketchName || '')));
}

const LG_AV_PAST =['delivery', 'done', 'collected'];
function lgAvSplit(orders) {
  const out = { notReady: [], ready: [], inWork: [] };
  (orders || []).forEach(o => {
    if (!lgAvIsAvivi(o)) return;
    const st = o.stage || '';
    if (st === 'delivery') (lgAvIsReady(o) ? out.ready : out.notReady).push(o);
    else if (!LG_AV_PAST.includes(st)) out.inWork.push(o);
  });
  return out;
}

//  q: סוף PO ("16504"), PO מלא, מידה ("600*800" / "800x600" / "600 800"),
//  או צלע אחת. idxs = הזכוכיות שהמידה שלהן מתאימה (להדגשה).
function lgAvMatch(o, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return { hit: true, idxs: [] };
  const items = (o && o.items) || [];
  //  קוד מהמדבקה ('1247-3') — ההזמנה הזו והזכוכית הזו
  const sc = lgAvParseScan(s);
  if (sc && String((o && o.orderNum) || '').replace(/\D/g, '') === sc.num)
    return { hit: true, idxs: sc.idx < items.length ? [sc.idx] : [] };
  const po = String((o && o.sketchName) || '').toLowerCase();
  const nums = s.match(/\d+/g) || [];
  const letters = /[a-z֐-׿]/.test(s.replace(/[x×]/g, ''));

  if (letters) {                                   // טקסט — חלק משם ה-PO
    const t = s.replace(/\s+/g, '');
    return { hit: !!t && po.replace(/\s+/g, '').includes(t), idxs: [] };
  }
  if (nums.length >= 2) {                          // מידה, בכל כיוון
    const a = Number(nums[0]), b = Number(nums[1]);
    const idxs = [];
    items.forEach((it, i) => {
      const w = Number(it.w) || 0, h = Number(it.h) || 0;
      if ((w === a && h === b) || (w === b && h === a)) idxs.push(i);
    });
    return { hit: idxs.length > 0, idxs };
  }
  const d = nums[0];                               // מספר אחד: סוף PO או צלע
  const poHit = d.length >= 3 && po.replace(/\D/g, '').endsWith(d);
  const idxs = [];
  items.forEach((it, i) => { if (Number(it.w) === Number(d) || Number(it.h) === Number(d)) idxs.push(i); });
  return { hit: poHit || idxs.length > 0, idxs: poHit ? [] : idxs };
}

// ─── ברקוד על המדבקה (בן, 17/11) — רק אביבי ───
//  הקוד: ספרות מספר ההזמנה + "-" + מספר הזכוכית (מ-1): "1247-3". רק ספרות ומקף —
//  נכון בכל שפת מקלדת, וגם מוקלד ביד בחיפוש.
//  הברקוד עצמו הוא כתובת באותיות גדולות (HTTPS://<אתר>/AV/1247-3): המצלמה הרגילה
//  של כל טלפון פותחת אותה, ו-vercel.json מפנה ל-workday.html?av=1247-3.
function lgAvScanCode(o, idx) {
  if (!lgAvIsAvivi(o)) return '';
  const n = String((o && o.orderNum) || '').replace(/\D/g, '');
  const i = Number(idx);
  if (!n || !Number.isInteger(i) || i < 0) return '';
  return n + '-' + (i + 1);
}
function lgAvScanUrl(code, host) {
  if (!code) return '';
  return ('HTTPS://' + String(host || 'luzglass.vercel.app') + '/AV/' + code).toUpperCase();
}
//  "1247-3" (גם בתוך כתובת, או "L1247-3") → {num:'1247', idx:2}; אחרת null
function lgAvParseScan(text) {
  const m = String(text || '').trim().match(/(?:^|\/AV\/|[^0-9])(\d{3,7})-(\d{1,3})\s*$/i);
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  return idx >= 0 ? { num: m[1], idx } : null;
}
//  ההזמנה של אביבי שהקוד מצביע עליה (לפי מספר ההזמנה), או null
function lgAvFindScan(orders, scan) {
  if (!scan) return null;
  return (orders || []).find(o => lgAvIsAvivi(o) && String(o.orderNum || '').replace(/\D/g, '') === scan.num) || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_AV_CARD, lgAvIsAvivi, lgAvWrappedIdxs, lgAvIsReady, lgAvState, lgAvSort, lgAvSplit, lgAvMatch,
    lgAvScanCode, lgAvScanUrl, lgAvParseScan, lgAvFindScan };
}
