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
        sketch: String(order.sketchName || ''),
        orderNum: String(order.orderNum || ''),
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
  line(l.title, 80, 64, 28, '900', 'rtl');                       // שם הלקוח
  ctx.fillRect(M, 140, maxW, 4);
  //  רוחב × גובה — משמאל לימין, כמו בכל המסכים (lgDimsText)
  line(l.dims, 275, 130, 48, '900', 'ltr');
  ctx.fillRect(M, 400, maxW, 4);
  line(l.sketch, 465, 64, 28, '700', 'rtl');                     // שם הסקיצה
  if (l.orderNum) {
    ctx.font = '700 26px Heebo, Arial, sans-serif'; ctx.direction = 'ltr'; ctx.textAlign = 'left';
    ctx.fillText(String(l.orderNum), M, 535);
    ctx.textAlign = 'center';
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
