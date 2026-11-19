'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_sketch-fit.js — חיתוך סקיצה לפני שהיא נכנסת לעמוד (בן, 19/11).
//
//  "לשרטט" — אצל המקום לאמבט הסקיצות יצאו קטנטנות: הן תמונה מהטלפון של דף
//  על השולחן. הדף תופס חלק מהתמונה, והציור עוד פחות (השולחן, דפים אחרים,
//  הברכיים של מי שצילם). העמוד הקטין את כל התמונה, כולל כל זה.
//
//  כאן: מוצאים את הדף (השטח הבהיר והאפור הגדול ביותר), בתוכו את מה שכתוב
//  עליו (דיו כהה או צבעוני), וחותכים לשם עם שוליים קטנים. סקיצה מהמערכת
//  (רקע לבן) — "הדף" הוא כל התמונה, ונחתכים רק השוליים הלבנים.
//  לא מצאנו כלום / החיתוך כמעט לא מרוויח / תקלה → התמונה כמו שהיא.
// ═══════════════════════════════════════════════════════════════════

const WORK = 480;          // צד ארוך של העותק המוקטן שעליו מחשבים
const MIN_PAPER = 0.12;    // דף קטן מזה (חלק מהתמונה) — לא סומכים עליו
const MIN_GAIN = 0.85;     // חיתוך שמשאיר יותר מזה מהשטח — לא שווה, משאירים
const PAD = 0.035;         // שוליים סביב הציור (חלק מהגודל שלו)

//  סף אוטסו על היסטוגרמה של 256 ערכים
function _otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 200;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

//  החלק הרציף הגדול ביותר במסכה (4 שכנים) → { size, x0,y0,x1,y1, rows:[[min,max]|null] }
function _largest(mask, w, h) {
  const lab = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    id++;
    let sp = 0, size = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    stack[sp++] = s; lab[s] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      size++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (!best || size > best.size) best = { id, size, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const rows = new Array(h).fill(null);
  for (let y = best.y0; y <= best.y1; y++) {
    let a = -1, b = -1;
    for (let x = best.x0; x <= best.x1; x++) if (lab[y * w + x] === best.id) { if (a < 0) a = x; b = x; }
    if (a >= 0) rows[y] = [a, b];
  }
  best.rows = rows;
  return best;
}

//  הרחבה (grow=1) או שחיקה (grow=0) בריבוע ברדיוס r — שני מעברים
function _morph(m, w, h, r, grow) {
  const pass = (src, horiz) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const X = horiz ? x + d : x, Y = horiz ? y : y + d;
        const s = X < 0 || Y < 0 || X >= w || Y >= h ? 0 : src[Y * w + X];
        if (grow ? s : !s) { v = grow ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
    return out;
  };
  return pass(pass(m, true), false);
}

//  מחזיר את השטח שנשחק: כל שורה רחבה ב-r לכל צד, ו-r שורות למעלה ולמטה
function _grow(c, w, h, r) {
  const rows = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    let a = w, b = -1;
    for (let d = Math.max(0, y - r); d <= Math.min(h - 1, y + r); d++) {
      const s = c.rows[d];
      if (s) { if (s[0] < a) a = s[0]; if (s[1] > b) b = s[1]; }
    }
    if (b >= 0) rows[y] = [Math.max(0, a - r), Math.min(w - 1, b + r)];
  }
  return { size: c.size, x0: Math.max(0, c.x0 - r), y0: Math.max(0, c.y0 - r),
           x1: Math.min(w - 1, c.x1 + r), y1: Math.min(h - 1, c.y1 + r), rows };
}

//  גבולות שחותכים קצוות דלילים (רעש): frac מהספירה מכל צד
function _span(counts, frac) {
  let total = 0;
  for (const c of counts) total += c;
  if (!total) return null;
  const cut = total * frac;
  let a = 0, acc = 0;
  while (a < counts.length - 1 && acc + counts[a] <= cut) acc += counts[a++];
  let b = counts.length - 1; acc = 0;
  while (b > a && acc + counts[b] <= cut) acc += counts[b--];
  return [a, b];
}

//  RGBA של עותק מוקטן → מלבן החיתוך בקואורדינטות שלו, או null (לא חותכים)
function lgSketchCropBox(data, w, h) {
  const n = w * h;
  const g = new Uint8Array(n), sat = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    //  שקוף = לבן (PNG מהעורך)
    const k = a / 255;
    const R = r * k + 255 * (1 - k), G = gg * k + 255 * (1 - k), B = b * k + 255 * (1 - k);
    const v = Math.round((R + G + B) / 3);
    g[i] = v; sat[i] = Math.round(Math.max(R, G, B) - Math.min(R, G, B));
    hist[v]++;
  }
  //  הדף: בהיר (מעל סף אוטסו, ולא פחות מ-120) וכמעט בלי צבע
  const th = Math.max(120, _otsu(hist, n));
  const paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) paper[i] = g[i] > th && sat[i] < 45 ? 1 : 0;
  //  קווי עט דקים לא חוצים את הדף לחלקים (סגירה), וגשר צר לדף שכן נשבר (שחיקה)
  const r = Math.max(1, Math.round(Math.max(w, h) / 240));
  const br = Math.max(r + 2, Math.round(Math.min(w, h) * 0.03));
  const core = _morph(_morph(_morph(paper, w, h, r, 1), w, h, r, 0), w, h, br, 0);
  let comp = _largest(core, w, h);
  if (comp) comp = _grow(comp, w, h, br);
  if (!comp || comp.size < MIN_PAPER * n) {
    comp = { x0: 0, y0: 0, x1: w - 1, y1: h - 1, rows: new Array(h).fill([0, w - 1]) };
  }
  //  רקע מקומי: הבהיר ביותר בסביבה (צל על הדף לא נחשב דיו)
  const R = 6;
  const tmp = new Uint8Array(n), bg = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let d = Math.max(0, x - R); d <= Math.min(w - 1, x + R); d++) if (g[y * w + d] > m) m = g[y * w + d];
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let d = Math.max(0, y - R); d <= Math.min(h - 1, y + R); d++) if (tmp[d * w + x] > m) m = tmp[d * w + x];
    bg[y * w + x] = m;
  }
  //  דיו בתוך הדף (קצת פנימה מהקצה — שם יש צל של הדף)
  const IN = Math.max(2, Math.round(Math.min(w, h) * 0.012));
  const colC = new Array(w).fill(0), rowC = new Array(h).fill(0);
  let ink = 0;
  for (let y = comp.y0 + IN; y <= comp.y1 - IN; y++) {
    const sp = comp.rows[y];
    if (!sp) continue;
    for (let x = sp[0] + IN; x <= sp[1] - IN; x++) {
      const i = y * w + x;
      const dark = g[i] < bg[i] * 0.8 && bg[i] - g[i] > 28;
      const color = sat[i] > 70 && g[i] < 235;
      if (dark || color) { colC[x]++; rowC[y]++; ink++; }
    }
  }
  if (ink < 20) return null;
  const sx = _span(colC, 0.004), sy = _span(rowC, 0.004);
  if (!sx || !sy) return null;
  const pw = Math.round((sx[1] - sx[0]) * PAD) + 4, ph = Math.round((sy[1] - sy[0]) * PAD) + 4;
  const x0 = Math.max(0, sx[0] - pw), x1 = Math.min(w - 1, sx[1] + pw);
  const y0 = Math.max(0, sy[0] - ph), y1 = Math.min(h - 1, sy[1] + ph);
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (box.w < w * 0.12 || box.h < h * 0.12) return null;        // נקודה קטנה — חשוד
  if (box.w * box.h > MIN_GAIN * w * h) return null;            // כמעט כל התמונה
  return box;
}

function _looksOk(b) {
  if (!b || b.length < 200) return false;
  const jpg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF && b[b.length - 2] === 0xFF && b[b.length - 1] === 0xD9;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b.slice(-8, -4).toString('latin1') === 'IEND';
  const webp = b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' && b.readUInt32LE(4) + 8 <= b.length;
  return jpg || png || webp;
}

//  { buf, mime } → { buf, mime, crop? } — JPEG חתוך, או המקור כמו שהוא
async function lgFitSketch(img) {
  if (!img || !img.buf || !/^image\//.test(String(img.mime || ''))) return img;
  //  ⚠️ קובץ שבור/קצר מפיל את @napi-rs/canvas עם panic שלא נתפס (כל התהליך נופל) —
  //  נוגעים רק במה שנראה כמו JPEG / PNG / WEBP שלם
  if (!_looksOk(img.buf)) return img;
  try {
    const { loadImage, createCanvas } = require('@napi-rs/canvas');
    const pic = await loadImage(img.buf);
    const W = pic.width, H = pic.height;
    if (!W || !H) return img;
    const k = Math.min(1, WORK / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(pic, 0, 0, w, h);
    const box = lgSketchCropBox(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!box) return img;
    const X = Math.floor(box.x / k), Y = Math.floor(box.y / k);
    const CW = Math.min(W - X, Math.ceil(box.w / k)), CH = Math.min(H - Y, Math.ceil(box.h / k));
    const out = createCanvas(CW, CH);
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, CW, CH);
    o.drawImage(pic, X, Y, CW, CH, 0, 0, CW, CH);
    return { buf: out.toBuffer('image/jpeg', 88), mime: 'image/jpeg', crop: { x: X, y: Y, w: CW, h: CH, of: [W, H] } };
  } catch (_) {
    return img;
  }
}

module.exports = { lgFitSketch, lgSketchCropBox };
