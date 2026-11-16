// ═══════════════════════════════════════════════════════════════════
//  opty-match.js — מחבר חלק מאופטי-ווי (מספר צורה) לפריט אצלנו (בן, 16/11).
//  לקוח + שם סקיצה + מידה. ודאי → נרשם לבד; ספק → "לבדיקה"; אין → "לא נמצא".
//  טהור: דפדפן וגם Node (scripts/test-opty-match.js).
//  אפיון: docs/superpowers/specs/2026-11-16-optyway-shape-link-design.md
// ═══════════════════════════════════════════════════════════════════

//  זוגות שבן נתן (16/11) — שם אצלנו ↔ שם באופטי-ווי. meta/optyClients מוסיף עליהם.
const LG_OPTY_CLIENTS_DEFAULT = [
  { ours: 'א.מ.מראות', opty: 'מאור' },
  { ours: 'נאור חזקיה', opty: 'א.א.פנדה' },
  { ours: 'טום גלאס', opty: 'טום גלס' },
  { ours: 'טום גלאס', opty: 'טום גלאס' },
  { ours: 'אביעד נחום', opty: 'אביעד נחום' },
  { ours: 'מורדי', opty: 'אור המראות' },
  { ours: 'אור המראות', opty: 'אור המראות' },   // כך הלקוח רשום אצלנו בפועל (16/11)
  { ours: 'המקום לאמבט', opty: 'BathPlace' },
  { ours: 'יצחק אביבי', opty: 'אביבי' },
  { ours: 'פלג מקלחונים', opty: 'פלג' },
];
const LG_OPTY_DIM_TOL = 3;          // מ"מ — השרטט מוסיף בדרך כלל 2 (405→407, 1885→1887) ולפעמים 222.1
const LG_OPTY_CLIENT_MAX = 12;      // אופטי-ווי חותך את שם הלקוח אחרי 12 תווים

//  בלי רווחים, גרשיים, נקודות ומקפים; אותיות לטיניות קטנות
const lgOptyNorm = s => String(s || '').toLowerCase().replace(/[\s"'`׳״.\-_/\\,]+/g, '');

//  שורות הטבלה → חלקים עם מספר צורה, מתאריך sinceISO ('YYYY-MM-DD') והלאה
function lgOptyPieces(rows, sinceISO) {
  return (rows || []).filter(r => r && String(r.SAGOMA || '').trim() && (!sinceISO || String(r.DATACONS || '') >= sinceISO))
    .map(r => ({
      shape: String(r.SAGOMA).trim(), client: String(r.CLIENTE || '').trim(), name: String(r.ORDINE || '').trim(),
      w: Number(r.DIMXPZ) || 0, h: Number(r.DIMYPZ) || 0, qty: Math.max(1, Number(r.QTAPZ) || 1),
      note: String(r.NOTE || '').trim(), mat: String(r.COD_MAT_COMP || '').trim(),
      job: String(r.CODCOM || '').trim(), date: String(r.DATACONS || ''),
    }));
}

//  שם לקוח באופטי-ווי → שמות הלקוח אצלנו (מנורמלים) — **רק** לפי הזוגות (בן, 16/11:
//  "תחבר את השמות רק שאמרתי לך" — באופטי-ווי יש הרבה לקוחות שלא במערכת). לקוח שאינו
//  בזוגות → "לא נמצא", ובדף משייכים אותו ידנית (meta/optyClients).
function _lgOptyClientKeys(optyClient, pairs) {
  const n = lgOptyNorm(optyClient); if (!n) return [];
  //  אופטי-ווי חותך אחרי 12 תווים — שם חתוך מתאים לזוג שהשם שלו מתחיל בו
  const cut = String(optyClient).trim().length >= LG_OPTY_CLIENT_MAX;
  return [...new Set((pairs || []).filter(p => { const o = lgOptyNorm(p.opty); return o === n || (cut && o.startsWith(n)); })
    .map(p => lgOptyNorm(p.ours)))];
}

//  שם סקיצה: שווה אחרי ניקוי, או (מספר של 4+ ספרות) סוף מספר ה-PO (אביבי)
//  וגם (16/11, נתונים אמיתיים): השם אצלנו ארוך יותר — 'מאיה' ↔ 'מאיה פיין', 'זבולון 2' ↔ 'זבולון 1/2/3'
function _lgOptyNameOk(pieceName, sketchName) {
  const a = lgOptyNorm(pieceName), b = lgOptyNorm(sketchName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^\d+$/.test(a)) return a.length >= 4 && b.replace(/\D/g, '').endsWith(a);
  const base = a.replace(/\d+$/, ''), n = a.slice(base.length);
  if (base.length < 2 || !b.startsWith(base)) return false;
  //  'אריאל 2' ≠ 'אריאל 1' — מספר באופטי-ווי חייב להופיע בשם אצלנו אם יש בו מספרים ('זבולון 1/2/3' ✓)
  const ours = String(sketchName).match(/\d+/g);
  return !n || !ours || ours.includes(n) || b.slice(base.length).replace(/\D/g, '').includes(n);
}

const _lgOptyDimOk = (p, it) => {
  const w = Number(it.w) || 0, h = Number(it.h) || 0, t = LG_OPTY_DIM_TOL;
  return (Math.abs(w - p.w) <= t && Math.abs(h - p.h) <= t) || (Math.abs(w - p.h) <= t && Math.abs(h - p.w) <= t);
};

//  pieces × orders → { auto:[{shape,job,orderId,idx}], review:[{piece,cands:[{orderId,idx}]}], notFound:[piece], already:[piece] }
//  orders: [{id, orderClient, sketchName, items:[{w,h,optyShape?}]}] — הקורא כבר סינן לפי תאריך.
function lgOptyMatch(pieces, orders, pairs) {
  const allPairs = LG_OPTY_CLIENTS_DEFAULT.concat(pairs || []);
  const out = { auto: [], review: [], notFound: [], already: [] };
  const taken = new Set();                                    // 'orderId#idx' שכבר קיבל צורה בריצה הזו
  const rows = [];                                             // כל הפריטים, עם מפתח לקוח
  (orders || []).forEach(o => {
    const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
    items.forEach((it, idx) => it && rows.push({ o, it, idx, key: o.id + '#' + idx, client: lgOptyNorm(o.orderClient || o.client) }));
  });
  const shapeAt = new Map(rows.filter(r => r.it.optyShape).map(r => [String(r.it.optyShape), r.key]));

  //  קבוצה = אותו לקוח+שם+מידה; שתי צורות שונות באותה מידה מתחלקות בין השורות לפי הסדר
  const groups = new Map();
  (pieces || []).forEach(p => {
    if (shapeAt.has(p.shape)) { out.already.push(p); return; }
    const k = [lgOptyNorm(p.client), lgOptyNorm(p.name), Math.round(Math.min(p.w, p.h)), Math.round(Math.max(p.w, p.h))].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });

  groups.forEach(list => {
    const p0 = list[0];
    const keys = _lgOptyClientKeys(p0.client, allPairs);
    //  השם אצלנו מתחיל בשם שבזוג — 'פלג מקלחונים בע"מ', 'טום גלאס  25701384'
    const sameClientSize = rows.filter(r => keys.some(k => r.client.startsWith(k)) && !r.it.optyShape && !taken.has(r.key) && _lgOptyDimOk(p0, r.it));
    //  שם תואם = שם הסקיצה, או מספר ההזמנה שלנו כתוב באופטי-ווי (L1281 — בן: מעכשיו נרשם שם)
    const nameOk = r => _lgOptyNameOk(p0.name, r.o.sketchName || r.o.type)
      || (!!r.o.orderNum && lgOptyNorm(p0.name).replace(/\s/g, '') === lgOptyNorm(r.o.orderNum).replace(/\s/g, ''));
    const named = p0.name ? sameClientSize.filter(nameOk) : [];
    const units = list.reduce((s, p) => s + p.qty, 0);
    if (named.length && named.length === units && new Set(named.map(r => r.o.id)).size === 1) {
      let i = 0;                                                // מספיק שורות, כולן מאותה הזמנה → ודאי
      list.forEach(p => { for (let q = 0; q < p.qty; q++, i++) {
        const r = named[i]; taken.add(r.key);
        out.auto.push({ shape: p.shape, job: p.job, orderId: r.o.id, idx: r.idx });
      } });
      return;
    }
    //  שם תואם אבל המידה רחוקה (השרטט שינה, 717→739) → לבדיקה עם כל הפריטים של אותה הזמנה
    const nameOnly = !named.length && p0.name ? rows.filter(r => keys.some(k => r.client.startsWith(k)) && !r.it.optyShape && !taken.has(r.key)
      && nameOk(r)) : [];
    const cands = (named.length ? named : nameOnly.length ? nameOnly : sameClientSize).map(r => ({ orderId: r.o.id, idx: r.idx }));
    const by = named.length || nameOnly.length ? 'name' : 'size';      // 'size' = רק לקוח+מידה, ההזמנה לא ידועה
    list.forEach(p => cands.length ? out.review.push({ piece: p, cands, by }) : out.notFound.push(p));
  });
  return out;
}

//  "לבדיקה" שהשם תאם (by:'name') וכל המועמדים שלו באותה הזמנה → ידוע של איזו הזמנה, רק לא לאיזה פריט (שני פריטים באותה
//  מידה וכו'). נשמר על ההזמנה (meta/optyPending/<orderId>/<shape>) ומחובר ביד בחיסום (בן, 16/11).
function lgOptyPendingByOrder(review) {
  const out = {};
  (review || []).forEach(v => {
    const ids = [...new Set((v.cands || []).map(c => c.orderId))];
    if (ids.length !== 1 || v.by !== 'name' || !v.piece || !v.piece.shape) return;
    const p = v.piece;
    (out[ids[0]] = out[ids[0]] || {})[p.shape] = { shape: String(p.shape), job: String(p.job || ''), w: Number(p.w) || 0, h: Number(p.h) || 0,
      qty: Number(p.qty) || 1, name: String(p.name || ''), note: String(p.note || '') };
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_OPTY_CLIENTS_DEFAULT, lgOptyNorm, lgOptyPieces, lgOptyMatch, lgOptyPendingByOrder };
}
