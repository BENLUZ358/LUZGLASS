// ═══════════════════════════════════════════════════════════════════
//  print-labels.js — מדבקות מחיסום (בן, 3/11). דפדפן (workday, prints.html)
//  וגם Node (בדיקות). מדבקה 70×70 מ"מ ב-TSC TE210 (203dpi) = 560×560 נקודות.
//
//  הדפדפן מצייר כל מדבקה על canvas — אותו ציור לתצוגה המקדימה ולהדפסה, כך
//  שמה שרואים זה מה שיוצא. עברית רק כתמונה (אין גופן עברי במדפסת).
//  האריזה: 1 ביט לנקודה, 70 בתים לשורה, שחור = 0 (TSPL BITMAP מדפיס 0).
//  השרת: api/_print-jobs.js. ההדפסה: tools/invoice-watcher (tsplForBitmap).
// ═══════════════════════════════════════════════════════════════════

const LG_LABEL_PX = 560;

//  entries: [{ order, idxs }] — idxs = הזכוכיות שסומנו שהגיעו (הקורא מחליט).
//  מדבקה לכל זכוכית, לפי סדר הפריטים.
function lgLabelsForClient(entries) {
  const out = [];
  (entries || []).forEach(({ order, idxs }) => {
    const items = (order && order.items) || [];
    [...(idxs || [])].map(Number).sort((a, b) => a - b).forEach(i => {
      const it = items[i]; if (!it) return;
      out.push({
        title: String(order.orderClient || order.client || ''),
        dims: Math.round(Number(it.w) || 0) + ' × ' + Math.round(Number(it.h) || 0),
        sketchName: String(order.sketchName || ''),
        glass: String(it.name || '').trim(),        // סוג הזכוכית — כדי שיידעו מה לחתוך (בן, 16/11)
        orderNum: String(order.orderNum || ''),
        shape: String(it.optyShape || ''),          // מספר הצורה באופטי-ווי (opty.html, בן 16/11)
        job: String(it.optyJob || ''),              // מספר אופטימיזציה M00xxx (בן, 16/11)
        orderId: String(order.id || ''), idx: i,
      });
    });
  });
  return out;
}

//  גודל הגופן הגדול ביותר (עד max) שהטקסט נכנס בו ברוחב. גם min לא נכנס →
//  מקצרים עם "…" (גלוי במדבקה — לא חותכים בשקט).
function _fit(ctx, text, maxW, max, min, weight) {
  let size = max, t = String(text || '');
  for (; size > min; size -= 2) {
    ctx.font = weight + ' ' + size + 'px Heebo, Arial, sans-serif';
    if (ctx.measureText(t).width <= maxW) return { text: t, size, cut: false };
  }
  ctx.font = weight + ' ' + min + 'px Heebo, Arial, sans-serif';
  let cut = false;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) { t = t.slice(0, -1); cut = true; }
  return { text: cut ? t + '…' : t, size: min, cut };
}

//  מצייר מדבקה על ctx (560×560). מחזיר לכל שורה {size, width, cut} — לבדיקות.
function lgLabelDraw(ctx, label, W) {
  W = W || LG_LABEL_PX;
  const l = label || {};
  const M = 20, maxW = W - 2 * M;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const out = [];
  const line = (text, y, max, min, weight, dir) => {
    if (!text) return;
    const f = _fit(ctx, text, maxW, max, min, weight);
    ctx.font = weight + ' ' + f.size + 'px Heebo, Arial, sans-serif';
    ctx.direction = dir;
    ctx.fillText(f.text, W / 2, y);
    out.push({ size: f.size, width: ctx.measureText(f.text).width, cut: f.cut });
  };
  //  מדבקת לוח (בן, 17/11): לפני הזכוכיות של כל לוח — "לוח 3/10" גדול, האופטימיזציה, סוג הזכוכית, כמה זכוכיות
  if (l.marker) {
    ctx.fillRect(0, 0, W, 14); ctx.fillRect(0, W - 14, W, 14); ctx.fillRect(0, 0, 14, W); ctx.fillRect(W - 14, 0, 14, W);
    line(String(l.marker), 190, 150, 60, '900', 'rtl');
    line(String(l.job || ''), 320, 70, 30, '700', 'ltr');
    line(String(l.mat || ''), 405, 60, 26, '700', 'rtl');
    if (l.pieces) line(l.pieces + ' זכוכיות', 490, 46, 24, '700', 'rtl');
    return out;
  }
  //  "מדבקה עם צורה" (בן, 16/11): הצורה מאופטי-ווי משמאל, מימין המידה ושם הסקיצה; סוג הזכוכית
  //  גדול לכל הרוחב מתחת — "כדי שיידעו מה לחתוך". רוחב × גובה משמאל לימין, כמו בכל המסכים.
  const at = (text, x, y, w, max, min, dir) => {
    if (!text) return;
    const f = _fit(ctx, text, w, max, min, '700');
    ctx.font = '700 ' + f.size + 'px Heebo, Arial, sans-serif'; ctx.direction = dir;
    ctx.fillText(f.text, x, y);
    out.push({ size: f.size, width: ctx.measureText(f.text).width, cut: f.cut });
  };
  //  שם הלקוח; "שבר" (בן, 16/11 — כל מדבקה שמודפסת מהחיסום) = מלבן שחור בפינה השמאלית, השם לידו
  const head = (y, max) => {
    if (!l.broken) { line(l.title, y, max, 28, '700', 'rtl'); return; }
    ctx.fillRect(M, y - 34, 124, 68);
    ctx.fillStyle = '#fff'; ctx.font = '700 46px Heebo, Arial, sans-serif'; ctx.direction = 'rtl';
    ctx.fillText('שבר', M + 62, y + 2);
    ctx.fillStyle = '#000';
    at(l.title, (M + 136 + W - M) / 2, y, maxW - 136, max, 24, 'rtl');
  };
  //  מספר הצורה גדול, סוג הזכוכית קטן מעליו (בן, 17/11 — "מספר השייפ בגדול, סוג הזכוכית יכול להיות בקטן")
  const lower = y => {
    if (l.glass) line(l.glass, y, 30, 20, '700', 'rtl');
    line('צורה ' + l.shape, l.glass ? y + 54 : y + 40, 72, 36, '700', 'rtl');
  };
  if (l.geo && typeof lgOptyShapeDraw === 'function') {
    head(52, 56);
    ctx.fillRect(M, 100, maxW, 4);
    lgOptyShapeDraw(ctx, l.geo, M, 114, 250, 250);                     // הצורה — משמאל
    const cx = M + 266, cw = maxW - 266;                               // עמודה ימנית
    at(l.dims, cx + cw / 2, 190, cw, 64, 30, 'ltr');
    at(l.sketchName, cx + cw / 2, 300, cw, 44, 22, 'rtl');
    ctx.fillRect(M, 376, maxW, 4);
    if (l.shape) lower(406);
    else if (l.glass) line(l.glass, 432, 58, 26, '700', 'rtl');       // סוג הזכוכית — גדול
  } else {
    head(70, 60);
    ctx.fillRect(M, 124, maxW, 4);
    line(l.dims, 228, 104, 48, '700', 'ltr');                          // המידה — קצת קטנה יותר מבעבר
    ctx.fillRect(M, 326, maxW, 4);
    if (l.shape) { line(l.sketchName, 362, 40, 22, '700', 'rtl'); lower(406); }
    else if (l.glass) {
      line(l.sketchName, 372, 44, 24, '700', 'rtl');                   // שם הסקיצה
      line(l.glass, 442, 58, 26, '700', 'rtl');                        // סוג הזכוכית — גדול
    } else line(l.sketchName, 420, 64, 28, '700', 'rtl');
  }
  //  שורה תחתונה: מספר ההזמנה משמאל · מספר אופטימיזציה מימין (הצורה עברה למעלה, גדולה — 17/11)
  let left = M, right = W - M;
  if (l.orderNum) {
    ctx.font = '700 26px Heebo, Arial, sans-serif'; ctx.direction = 'ltr'; ctx.textAlign = 'left';
    ctx.fillText(String(l.orderNum), M, 535);
    left = M + ctx.measureText(String(l.orderNum)).width + 16;
    ctx.textAlign = 'center';
  }
  if (l.job) {                                                       // מספר אופטימיזציה (M00272) — באמצע, בין ההזמנה לצורה
    const t = String(l.job).slice(0, 10);
    let fz = 34;
    for (; fz > 18; fz -= 2) { ctx.font = '700 ' + fz + 'px Heebo, Arial, sans-serif'; if (ctx.measureText(t).width <= right - left) break; }
    ctx.font = '700 ' + fz + 'px Heebo, Arial, sans-serif'; ctx.direction = 'ltr'; ctx.textAlign = 'center';
    ctx.fillText(t, (left + right) / 2, 537);
  }
  return out;
}

//  imageData (RGBA, W×W) → base64 של 70 בתים × 560 שורות. כהה מ-128 = שחור = 0.
function lgLabelPack(imageData, W) {
  W = W || LG_LABEL_PX;
  const rowBytes = W / 8, d = imageData.data;
  const out = new Uint8Array(rowBytes * W).fill(0xFF);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const lum = d[p + 3] < 128 ? 255 : (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    if (lum < 128) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
  }
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

//  דפדפן: מצייר ואורז מדבקה אחת — {canvas, bitmap}
function lgLabelRender(label) {
  const c = document.createElement('canvas');
  c.width = c.height = LG_LABEL_PX;
  const ctx = c.getContext('2d');
  lgLabelDraw(ctx, label);
  return { canvas: c, bitmap: lgLabelPack(ctx.getImageData(0, 0, LG_LABEL_PX, LG_LABEL_PX)) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_LABEL_PX, lgLabelsForClient, lgLabelDraw, lgLabelPack, lgLabelRender };
}
