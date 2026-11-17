// ═══════════════════════════════════════════════════════════════════════
//  lg-qr.js — ציור ברקוד QR, בלי ספרייה חיצונית (בן, 17/11 — ברקוד על מדבקות אביבי)
//
//  רק מה שצריך למדבקה: מצב אותיות-ומספרים (0-9 A-Z רווח $%*+-./:), גרסאות 1–3,
//  רמת תיקון L או M, בלוק אחד. הטלפון (מצלמה רגילה, אייפון ואנדרואיד) קורא
//  כתובת באותיות גדולות ופותח אותה — ולכן אין צורך בקורא בתוך האתר.
//  המבנה לפי התקן ISO 18004 (ובעקבות המימוש של Nayuki, כולל שמות).
//  lgQrMatrix(text, ecl) → מערך שורות של true(שחור)/false, או null אם לא נכנס.
// ═══════════════════════════════════════════════════════════════════════

const LG_QR_ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
//  [קודי מידע, קודי תיקון] לכל גרסה (בלוק אחד בגרסאות 1–3 ברמות L/M)
const LG_QR_CAP = { L: [null, [19, 7], [34, 10], [55, 15]], M: [null, [16, 10], [28, 16], [44, 26]] };
const LG_QR_ECL_BITS = { L: 1, M: 0 };

function _lgQrGf() {
  const exp = new Array(512), log = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log, mul: (a, b) => (a && b ? exp[log[a] + log[b]] : 0) };
}

//  קודי תיקון Reed-Solomon לקודי המידע
function lgQrEcc(data, n) {
  const g = _lgQrGf();
  let gen = [1];                                     // (x-α^0)(x-α^1)…  — מקדם עליון ראשון
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= g.mul(c, g.exp[i]); });
    gen = next;
  }
  const res = new Array(n).fill(0);
  data.forEach(b => {
    const f = b ^ res.shift(); res.push(0);
    for (let j = 0; j < n; j++) res[j] ^= g.mul(gen[j + 1], f);
  });
  return res;
}

//  קודי המידע (לפני תיקון) לטקסט בגרסה ורמה נתונות; null אם לא נכנס
function lgQrData(text, ver, ecl) {
  const t = String(text), cap = LG_QR_CAP[ecl][ver][0] * 8, bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  for (const ch of t) if (LG_QR_ALNUM.indexOf(ch) < 0) return null;
  put(2, 4); put(t.length, 9);
  for (let i = 0; i < t.length; i += 2) {
    const a = LG_QR_ALNUM.indexOf(t[i]);
    if (i + 1 < t.length) put(a * 45 + LG_QR_ALNUM.indexOf(t[i + 1]), 11); else put(a, 6);
  }
  if (bits.length > cap) return null;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; out.length < cap / 8; p++) out.push(p % 2 ? 17 : 236);
  return out;
}

//  15 ביטי הפורמט (רמה + מסכה), עם BCH ו-XOR של התקן
function lgQrFormatBits(ecl, mask) {
  const data = (LG_QR_ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const _lgQrMasks = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function _lgQrBuild(ver, ecl, codewords, mask) {
  const size = 17 + 4 * ver;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = !!d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }      // קווי תזמון
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {                           // שלוש פינות
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  });
  if (ver >= 2) {                                                                          // ריבוע יישור
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const fmt = bits => {
    const b = i => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);                                                                // המודול הכהה הקבוע
  };
  fmt(lgQrFormatBits(ecl, mask));
  let i = 0;                                                                               // זיגזג מלמטה-ימין
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const mk = _lgQrMasks[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && mk(x, y)) m[y][x] = !m[y][x];
  return m;
}

//  ניקוד עונש מקוצר (כללים 1, 2, 4 של התקן) — לבחירת מסכה נוחה לקריאה. כל מסכה תקינה לקורא.
function _lgQrPenalty(m) {
  const n = m.length; let p = 0, dark = 0;
  for (let k = 0; k < 2; k++) for (let a = 0; a < n; a++) {
    let run = 1;
    for (let b = 1; b < n; b++) {
      const cur = k ? m[b][a] : m[a][b], prev = k ? m[b - 1][a] : m[a][b - 1];
      if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  m.forEach(r => r.forEach(c => { if (c) dark++; }));
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

function lgQrMatrix(text, ecl, opts) {
  const e = ecl || 'L', o = opts || {};
  for (let ver = 1; ver <= 3; ver++) {
    const data = lgQrData(text, ver, e);
    if (!data) continue;
    const cw = data.concat(lgQrEcc(data, LG_QR_CAP[e][ver][1]));
    if (o.mask != null) return _lgQrBuild(ver, e, cw, o.mask);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mm = _lgQrBuild(ver, e, cw, mask), pp = _lgQrPenalty(mm);
      if (pp < bestP) { bestP = pp; best = mm; }
    }
    return best;
  }
  return null;
}

//  מצייר על canvas: x,y פינה שמאלית-עליונה, mod = נקודות לכל ריבוע. מחזיר את הגודל בנקודות.
function lgQrDraw(ctx, matrix, x, y, mod) {
  if (!matrix) return 0;
  matrix.forEach((row, r) => row.forEach((d, c) => { if (d) ctx.fillRect(x + c * mod, y + r * mod, mod, mod); }));
  return matrix.length * mod;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_QR_ALNUM, lgQrData, lgQrEcc, lgQrFormatBits, lgQrMatrix, lgQrDraw };
}
