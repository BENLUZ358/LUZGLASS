// ═══════════════════════════════════════════════════════════════════
//  opty-layout.js — קובצי החיתוך של אופטי-ווי (M00xxx.R01): לוחות, איפה כל זכוכית
//  יושבת ובאיזה סדר חותכים (בן, 17/11). טהור: דפדפן וגם Node (scripts/test-opty-layout.js).
//
//  פוענח ונבדק על 293 עבודות (4206/4206 זכוכיות תואמות למידות ב-Pezzi):
//    שורה [..] = לוח. מספרים בהקס, יחידה 0.1 מ"מ.
//    כותרת: P<כמות> H<מס' לוח> (H5-6 = שני לוחות זהים) R<אורך> R<רוחב> x<שוליים> y<שוליים> T<?>
//      (סה"כ שוליים במ"מ = הערך/20)
//    חיתוכים מקוננים X→Y→Z→W→Q→R (ציר מתחלף, X לאורך הלוח), כל ערך = מידה, בלי עובי חיתוך.
//    V<n> = הצומת הבא חוזר n פעמים · S<n=צורה> · N<הקס> = POSPZ של הזכוכית ב-Pezzi.
//    סדר הזכוכיות בקובץ = סדר החיתוך = סדר המדבקות.
// ═══════════════════════════════════════════════════════════════════

const LG_OPTY_DEPTH = { X: 1, Y: 2, Z: 3, W: 4, Q: 5, R: 6 };

function _lgOptySheet(line) {
  const re = /S<n=(\d+)>|([A-Za-z])([0-9A-F]*)(?:-([0-9A-F]+))?/g;
  const sh = { index: 0, count: 1, L: 0, H: 0, trimX: 0, trimY: 0 };
  const root = { d: 0, children: [] }, stack = [root];
  let header = true, rs = 0, rep = 1, cur = null;
  for (let m; (m = re.exec(line));) {
    if (m[1]) { if (cur) cur.shape = m[1]; continue; }
    const k = m[2], v = parseInt(m[3] || '0', 16);
    if (header) {
      if (k === 'P') { sh.count = v || 1; continue; }
      if (k === 'H') { sh.index = v; if (m[4]) sh.count *= Math.max(1, parseInt(m[4], 16) - v + 1); continue; }
      if (k === 'R' && rs < 2) { if (rs++ === 0) sh.L = v / 10; else sh.H = v / 10; continue; }
      if (k === 'x') { sh.trimX = v / 20; continue; }
      if (k === 'y') { sh.trimY = v / 20; continue; }
      if (k === 'T') continue;
      if (k !== 'X') throw new Error('קובץ חיתוך: אות לא מוכרת בכותרת ' + k);
      header = false;
    }
    if (k === 'V') { rep = v || 1; continue; }
    if (k === 'N') { if (cur) cur.pos = v; continue; }
    const d = LG_OPTY_DEPTH[k];
    if (!d) throw new Error('קובץ חיתוך: אות לא מוכרת ' + k);
    if (!stack[d - 1]) throw new Error('קובץ חיתוך: קפיצת רמה ב-' + k);
    cur = { d, size: v / 10, rep, children: [] }; rep = 1;
    stack[d - 1].children.push(cur);
    stack[d] = cur; stack.length = d + 1;
  }
  if (!(sh.L > 0) || !(sh.H > 0)) throw new Error('קובץ חיתוך: אין מידת לוח');
  const pieces = [];
  (function place(node, x0, y0, w, h) {
    let off = 0;
    node.children.forEach(c => {
      for (let r = 0; r < c.rep; r++) {
        const odd = c.d % 2 === 1;
        const cx = odd ? x0 + off : x0, cy = odd ? y0 : y0 + off, cw = odd ? c.size : w, ch = odd ? h : c.size;
        if (c.pos != null) pieces.push({ order: pieces.length + 1, pos: c.pos, shape: c.shape || null, x: _r1(cx), y: _r1(cy), w: _r1(cw), h: _r1(ch) });
        place(c, cx, cy, cw, ch);
        off += c.size;
      }
    });
  })(root, sh.trimX / 2, sh.trimY / 2, sh.L - sh.trimX, sh.H - sh.trimY);
  return Object.assign(sh, { pieces });
}
function _r1(v) { return Math.round(v * 10) / 10; }

//  טקסט הקובץ → לוחות. זורק על קובץ שלא מובן (עדיף מאשר לצייר לא נכון).
function lgOptyLayoutParse(text) {
  return String(text || '').split(/\r?\n/).filter(l => l.startsWith('[') && l.includes(']'))
    .map(l => _lgOptySheet(l.slice(1, l.lastIndexOf(']'))));
}

//  לוחות פיזיים לפי הסדר: לוח שחוזר (H5-6) נפרס לפי הכמות → "לוח i/N"
function lgOptySheetSeq(sheets) {
  const out = [];
  (sheets || []).forEach(s => { for (let i = 0; i < (s.count || 1); i++) out.push({ sheet: s }); });
  return out.map((o, i) => ({ sheetNo: i + 1, total: out.length, sheet: o.sheet }));
}

//  ─── יום עבודה מוצע (בן, 17/11 — בן מאשר או משנה בקליטה) ───
//  אופטימיזציה שנעשתה לפני 12:00 → אותו יום; 12:00 ואחרי → יום העבודה הבא (א'–ה'). שעון ישראל.
function _lgIlParts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p;
}
function _lgIsoAdd(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lgOptyCutDay(ms) {
  const p = _lgIlParts(ms);
  let day = `${p.year}-${p.month}-${p.day}`;
  if ((Number(p.hour) % 24) >= 12) day = _lgIsoAdd(day, 1);
  for (let i = 0; i < 3; i++) {
    const wd = new Date(day + 'T12:00:00Z').getUTCDay();   // 5 = שישי, 6 = שבת
    if (wd !== 5 && wd !== 6) break;
    day = _lgIsoAdd(day, 1);
  }
  return day;
}

//  ─── ציור לוח (SVG) ───
//  info[pos] = { client, name, w, h } · geos[shape] = geo (lgOptyShapeParse).
//  קו החיתוך בגודל אמיתי ביחס לזכוכית (בן, 17/11: "הסימנים לא פרופורציונליים") — קו דק, לא non-scaling.
function _lgEscX(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
const LG_OPTY_PAL = ['#cfe8ff', '#ffe2b8', '#d6f5d6', '#f3d1f0', '#fff3b0', '#d9d4ff', '#ffd1d1', '#c9f0ec'];
function _lgShapeSvgFn() {
  if (typeof lgOptyShapeSvg === 'function') return lgOptyShapeSvg;          // דפדפן — opty-shape.js נטען לפני
  try { return require('./opty-shape.js').lgOptyShapeSvg; } catch (e) { return null; }
}
function lgOptyLayoutSvg(sheet, info, geos, opts) {
  const o = opts || {}, S = o.scale || 0.32, W = sheet.L * S, H = sheet.H * S;
  const inf = info || {}, gs = geos || {}, shapeSvg = _lgShapeSvgFn();
  const colors = {}; let ci = 0;
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_r1(W)} ${_r1(H)}" class="${_lgEscX(o.cls || 'lg-opty-sheet')}" role="img" aria-label="לוח ${sheet.L}×${sheet.H}" style="direction:ltr">`
    + `<rect width="${_r1(W)}" height="${_r1(H)}" fill="#b9b9b9"/>`;
  (sheet.pieces || []).forEach(p => {
    const r = inf[p.pos] || {};
    const key = (r.client || '') + '|' + (r.name || '');
    if (!colors[key]) colors[key] = LG_OPTY_PAL[ci++ % LG_OPTY_PAL.length];
    const x = p.x * S, y = H - (p.y + p.h) * S, w = p.w * S, h = p.h * S;
    const sel = o.selected === p.order;
    g += `<g class="lg-opty-pc" data-order="${p.order}" data-pos="${p.pos}"><rect x="${_r1(x)}" y="${_r1(y)}" width="${_r1(w)}" height="${_r1(h)}" fill="${o.cut && o.cut[p.order] ? '#e5e5e5' : colors[key]}" stroke="${sel ? '#a93226' : '#333'}" stroke-width="${sel ? 3 : 1}"/>`;
    const geo = p.shape ? gs[p.shape] : null;
    if (geo && shapeSvg) {
      const m = /<path d="([^"]+)"/.exec(shapeSvg(geo));
      if (m) {
        const rot = Math.abs(geo.w - p.w) > 1 && Math.abs(geo.w - p.h) <= 1;
        const tf = rot ? `translate(${_r1(x + w)},${_r1(y)}) rotate(90) scale(${S})` : `translate(${_r1(x)},${_r1(y)}) scale(${S})`;
        g += `<path d="${m[1]}" transform="${tf}" fill="none" stroke="#c0392b" stroke-width="${_r1(1.8 / S)}" stroke-linejoin="round"/>`;
      }
    }
    const size = (r.w && r.h) ? `${r.w}×${r.h}` : `${Math.round(p.w)}×${Math.round(p.h)}`;
    const lines = [[`#${p.order}`, 1.25, 'ltr'], [p.shape ? `שייפ ${p.shape}` : 'בלי שייפ', 1, 'rtl'], [r.client || '', 1, 'rtl'], [r.name || '', 1, 'rtl'], [size, 1, 'ltr']];
    const rotT = h > w * 1.6, Lx = rotT ? h : w, Tx = rotT ? w : h;
    const longest = Math.max(4, ...lines.map(l => l[0].length * l[1]));
    const f = Math.max(6, Math.min(22, Lx * 1.7 / longest, Tx / (lines.length * 1.35)));
    const tot = lines.reduce((a, l) => a + l[1] * f * 1.2, 0);
    let ty = -tot / 2;
    g += `<g transform="translate(${_r1(x + w / 2)},${_r1(y + h / 2)})${rotT ? ' rotate(-90)' : ''}" font-family="Heebo,Arial,sans-serif" text-anchor="middle" fill="#111">`;
    lines.forEach(([t, k, dir]) => {
      ty += k * f * 1.2;
      if (t) g += `<text x="0" y="${_r1(ty - k * f * 0.3)}" font-size="${_r1(k * f)}"${k > 1 ? ' font-weight="700"' : ''} direction="${dir}">${_lgEscX(t)}</text>`;
    });
    g += '</g>';
    if (o.cut && o.cut[p.order]) g += `<text x="${_r1(x + 6)}" y="${_r1(y + 16)}" font-size="14" fill="#1e7d32">✂</text>`;
    g += '</g>';
  });
  return g + '</svg>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lgOptyLayoutParse, lgOptySheetSeq, lgOptyCutDay, lgOptyLayoutSvg };
}
