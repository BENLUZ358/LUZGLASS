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
        if (c.pos != null) pieces.push({ order: pieces.length + 1, pos: c.pos, shape: c.shape || null, x: _lgLr1(cx), y: _lgLr1(cy), w: _lgLr1(cw), h: _lgLr1(ch) });
        place(c, cx, cy, cw, ch);
        off += c.size;
      }
    });
  })(root, sh.trimX / 2, sh.trimY / 2, sh.L - sh.trimX, sh.H - sh.trimY);
  return Object.assign(sh, { pieces });
}
function _lgLr1(v) { return Math.round(v * 10) / 10; }

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
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_lgLr1(W)} ${_lgLr1(H)}" class="${_lgEscX(o.cls || 'lg-opty-sheet')}" role="img" aria-label="לוח ${sheet.L}×${sheet.H}" style="direction:ltr">`
    + `<rect width="${_lgLr1(W)}" height="${_lgLr1(H)}" fill="#b9b9b9"/>`;
  (sheet.pieces || []).forEach(p => {
    const r = inf[p.pos] || {};
    const key = (r.client || '') + '|' + (r.name || '');
    if (!colors[key]) colors[key] = LG_OPTY_PAL[ci++ % LG_OPTY_PAL.length];
    const x = p.x * S, y = H - (p.y + p.h) * S, w = p.w * S, h = p.h * S;
    const sel = o.selected === p.order;
    g += `<g class="lg-opty-pc" data-order="${p.order}" data-pos="${p.pos}"><rect x="${_lgLr1(x)}" y="${_lgLr1(y)}" width="${_lgLr1(w)}" height="${_lgLr1(h)}" fill="${o.cut && o.cut[p.order] ? '#e5e5e5' : colors[key]}" stroke="${sel ? '#a93226' : '#333'}" stroke-width="${sel ? 3 : 1}"/>`;
    const geo = p.shape ? gs[p.shape] : null;
    if (geo && shapeSvg) {
      const m = /<path d="([^"]+)"/.exec(shapeSvg(geo));
      if (m) {
        const rot = Math.abs(geo.w - p.w) > 1 && Math.abs(geo.w - p.h) <= 1;
        const tf = rot ? `translate(${_lgLr1(x + w)},${_lgLr1(y)}) rotate(90) scale(${S})` : `translate(${_lgLr1(x)},${_lgLr1(y)}) scale(${S})`;
        g += `<path d="${m[1]}" transform="${tf}" fill="none" stroke="#c0392b" stroke-width="${_lgLr1(1.8 / S)}" stroke-linejoin="round"/>`;
      }
    }
    const size = (r.w && r.h) ? `${r.w}×${r.h}` : `${Math.round(p.w)}×${Math.round(p.h)}`;
    const lines = [[`#${p.order}`, 1.25, 'ltr'], [p.shape ? `שייפ ${p.shape}` : 'בלי שייפ', 1, 'rtl'], [r.client || '', 1, 'rtl'], [r.name || '', 1, 'rtl'], [size, 1, 'ltr']];
    const rotT = h > w * 1.6, Lx = rotT ? h : w, Tx = rotT ? w : h;
    const longest = Math.max(4, ...lines.map(l => l[0].length * l[1]));
    const f = Math.max(6, Math.min(22, Lx * 1.7 / longest, Tx / (lines.length * 1.35)));
    const tot = lines.reduce((a, l) => a + l[1] * f * 1.2, 0);
    let ty = -tot / 2;
    g += `<g transform="translate(${_lgLr1(x + w / 2)},${_lgLr1(y + h / 2)})${rotT ? ' rotate(-90)' : ''}" font-family="Heebo,Arial,sans-serif" text-anchor="middle" fill="#111">`;
    lines.forEach(([t, k, dir]) => {
      ty += k * f * 1.2;
      if (t) g += `<text x="0" y="${_lgLr1(ty - k * f * 0.3)}" font-size="${_lgLr1(k * f)}"${k > 1 ? ' font-weight="700"' : ''} direction="${dir}">${_lgEscX(t)}</text>`;
    });
    g += '</g>';
    if (o.cut && o.cut[p.order]) g += `<text x="${_lgLr1(x + 6)}" y="${_lgLr1(y + 16)}" font-size="14" fill="#1e7d32">✂</text>`;
    g += '</g>';
  });
  return g + '</svg>';
}

//  ─── רשומת אופטימיזציה (meta/optyJobs/<job>) — מקור מידע נפרד על מה שנחתך (בן, 17/11) ───
//  day = יום העבודה שבן בחר. pieces[pos] מ-Pezzi (מה שרשום באופטי-ווי), גם לזכוכית שלא מחוברת להזמנה.
function lgOptyJobRecord(job, r01Text, day, pezziRows, nowMs) {
  const rows = (pezziRows || []).filter(r => r && String(r.CODCOM || '').trim() === job);
  const pieces = {};
  rows.forEach(r => {
    const pos = Number(r.POSPZ); if (!(pos > 0)) return;
    pieces[pos] = { client: String(r.CLIENTE || '').trim(), name: String(r.ORDINE || '').trim(),
      w: Number(r.DIMXPZ) || 0, h: Number(r.DIMYPZ) || 0, qty: Number(r.QTAPZ) || 1,
      shape: String(r.SAGOMA || '').trim(), grind: Number(r.MOLATURA) || 0 };
  });
  const first = rows[0] || {};
  return { job, day, mat: String(first.COD_MAT_COMP || '').trim(), matName: String(first.DESCR_MAT_COMP || '').trim(),
    importedAt: nowMs || 0, sheets: lgOptyLayoutParse(r01Text), pieces };
}

//  ─── סימון "נחתך" על פריטים מחוברים ───
//  פריט עם optyJob שנשמר + optyShape שמופיע בלוחות של העבודה + עוד בלי optyCut → חותמת.
//  פריט עם optyCut כלשהו (גם "בוטל") — לא נוגעים (בן מבטל ביד; קליטה חוזרת לא מחזירה).
function lgOptyCutStamps(orders, jobsByNo) {
  const out = [];
  (orders || []).forEach(o => {
    const items = (o && o.items) || {};
    Object.keys(items).forEach(k => {
      const it = items[k];
      if (!it || it.optyCut || !it.optyJob || !it.optyShape) return;
      const rec = (jobsByNo || {})[it.optyJob];
      if (!rec) return;
      const has = (rec.sheets || []).some(s => (s.pieces || []).some(p => String(p.shape || '') === String(it.optyShape)));
      if (has) out.push({ orderId: o.id, key: String(k), value: { at: rec.day, job: rec.job } });
    });
  });
  return out;
}

//  מצב לתצוגה: null (אין/בוטל) | { label, cut }. נחתך = היום שלו עבר, או שהלוח סומן "נחתך".
function lgOptyCutState(c, todayIso) {
  if (!c || c.undone || !c.at) return null;
  const dm = String(c.at).slice(8, 10) + '/' + String(c.at).slice(5, 7);
  if (c.marked || c.at < todayIso) return { label: '✂ נחתך ' + dm, cut: true };
  if (c.at === todayIso) return { label: 'לחיתוך היום', cut: false };
  return { label: 'לחיתוך ' + dm, cut: false };
}

//  היום בישראל, 'YYYY-MM-DD'
function lgOptyTodayIso(ms) { const p = _lgIlParts(ms == null ? Date.now() : ms); return `${p.year}-${p.month}-${p.day}`; }

//  ─── שמות זכוכית בעברית (בן, 17/11: "08S 8 שקוף") ───
//  מהשם באנגלית של אופטי-ווי (Magaz.DB: "8 mm clear") → "8 שקוף". מילה לא מוכרת נשארת באנגלית; בן מתקן בהגדרות.
const LG_OPTY_WORDS = [['extra clear', 'אקסטרה קליר'], ['acid clear', 'חלבי שקוף'], ['master carre', 'מאסטר קרה'], ['master line', 'מאסטר ליין'],
  ['clear', 'שקוף'], ['mirror', 'מראה'], ['acid', 'חלבי'], ['bronze', 'ברונזה'], ['gray', 'אפור'], ['grey', 'אפור'], ['black', 'שחור'],
  ['mat', 'מט'], ['silk', 'משי'], ['lacobel', 'לקובל'], ['reflective', 'מחזיר אור'], ['granit', 'גרניט'], ['chinchilla', "צ'ינצ'ילה"],
  ['pepitte', 'פפיט'], ['savta', 'סבתא']];
function lgOptyMatHe(code, en) {
  let t = String(en || '').toLowerCase().replace(/\bmm\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return String(code || '');
  LG_OPTY_WORDS.forEach(([e, h]) => { t = t.replace(new RegExp('\\b' + e + '\\b', 'g'), h); });
  return t.replace(/\s+/g, ' ').trim();
}
//  "08S · 8 שקוף" — שם שבן שמר בהגדרות (meta/optyMats/<code>.he) גובר
function lgOptyMatLabel(code, mats) {
  const c = String(code || ''); if (!c) return '';
  const m = (mats || {})[c] || {};
  const he = m.he || (m.en ? lgOptyMatHe(c, m.en) : '');
  return he ? c + ' · ' + he : c;
}

//  ─── מדבקות לפי סדר החיתוך (בן, 17/11) ───
//  לפני כל לוח פיזי: מדבקת "לוח i/N" (האופטימיזציה, סוג הזכוכית, כמה זכוכיות), ואחריה הזכוכיות שלו לפי הסדר.
//  linked[shape] = מדבקה מההזמנה שלנו (lgLabelsForClient) כשהזכוכית מחוברת; אחרת — מה שרשום באופטי-ווי.
//  opts.sheet = רק לוח פיזי אחד · opts.order (עם sheet) = רק זכוכית אחת, בלי מדבקת לוח.
function lgOptyJobLabels(rec, linked, opts, matLabel) {
  const o = opts || {}, out = [], lk = linked || {}, info = (rec && rec.pieces) || {};
  lgOptySheetSeq((rec && rec.sheets) || []).forEach(({ sheetNo, total, sheet }) => {
    if (o.sheet && o.sheet !== sheetNo) return;
    const ps = (sheet.pieces || []).filter(p => !o.order || p.order === o.order);
    if (!o.order) out.push({ marker: 'לוח ' + sheetNo + '/' + total, job: rec.job, mat: matLabel || rec.mat || '', pieces: ps.length });
    ps.forEach(p => {
      const r = info[p.pos] || {}, ours = p.shape ? lk[p.shape] : null;
      if (ours) out.push(Object.assign({}, ours, { shape: p.shape, job: rec.job, withShape: true }));
      else out.push({ title: r.client || '', sketchName: r.name || '', dims: Math.round(r.w || p.w) + ' × ' + Math.round(r.h || p.h),
        glass: matLabel || rec.mat || '', orderNum: r.name || '', shape: p.shape || '', job: rec.job, withShape: !!p.shape });
    });
  });
  return out;
}

//  חלוקה לעבודות הדפסה (עד 70 בתור) — חלק אף פעם לא נגמר במדבקת לוח (היא עוברת לחלק הבא)
function lgOptyChunks(labels, max) {
  const out = []; let cur = [];
  (labels || []).forEach(l => {
    if (cur.length === max) {
      const carry = cur[cur.length - 1] && cur[cur.length - 1].marker ? [cur.pop()] : [];
      out.push(cur); cur = carry;
    }
    cur.push(l);
  });
  if (cur.length) out.push(cur);
  return out;
}

//  ─── חיפוש שייפ (בן, 17/11: "אם ארצה לחפש שייפ של צורה שנשברה") ───
//  בכל האופטימיזציות שנשמרו — גם לקוחות שלא מחוברים. q: מספר שייפ / לקוח / שם סקיצה / M00…
function lgOptyPieceSearch(jobs, q, f) {
  const flt = f || {}, n = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  const words = n(q).split(' ').filter(Boolean), out = [];
  Object.values(jobs || {}).forEach(rec => {
    if (!rec || !rec.sheets) return;
    if (flt.mat && rec.mat !== flt.mat) return;
    if (flt.from && rec.day < flt.from) return;
    if (flt.to && rec.day > flt.to) return;
    const seen = {};
    lgOptySheetSeq(rec.sheets).forEach(({ sheetNo, sheet }) => (sheet.pieces || []).forEach(p => {
      if (seen[p.pos]) return; seen[p.pos] = 1;
      const r = (rec.pieces || {})[p.pos] || {};
      const hay = n([p.shape, r.client, r.name, rec.job].join(' '));
      if (!words.every(w => hay.includes(w))) return;
      out.push({ job: rec.job, day: rec.day || '', mat: rec.mat || '', sheetNo, order: p.order, pos: p.pos, shape: p.shape || '',
        client: r.client || '', name: r.name || '', w: r.w || p.w, h: r.h || p.h });
    }));
  });
  return out.sort((a, b) => (b.day || '').localeCompare(a.day || ''));
}

//  מצב חיתוך של זכוכית מתוך האופטימיזציה עצמה — גם כשהיא לא מחוברת להזמנה (בן, 17/11: "אדע אם הם נחתכו").
//  לוח שסומן (או עותק זהה שלו, H5-6) = נחתך · סומן; היום עבר = נחתך; היום = לחיתוך היום; אחר כך = מתוכנן.
function lgOptyPieceCut(rec, sheetNo, todayIso) {
  const seq = lgOptySheetSeq((rec && rec.sheets) || []), me = seq[(sheetNo || 1) - 1], marks = (rec && rec.marks) || {};
  if (me && seq.some(x => x.sheet === me.sheet && marks[x.sheetNo])) return { cut: true, label: 'נחתך · סומן' };
  const day = (rec && rec.day) || '';
  if (day && day < todayIso) return { cut: true, label: 'נחתך' };
  if (day === todayIso) return { cut: false, label: 'לחיתוך היום' };
  return { cut: false, label: day ? 'מתוכנן ל-' + day.split('-').reverse().slice(0, 2).join('/') : 'לא ידוע' };
}

//  ─── חיסום (בן, 17/11): "נחתך ביום א', יום ב' בבוקר יוצא לחיסום, יום ג' בבוקר חוזר" ───
//  איזו זכוכית הולכת לחיסום — לפי סוג הזכוכית: מה שבן קבע בהגדרות (meta/optyMats/<קוד>.chisum) גובר;
//  אחרת: מראה / לקובל / סבתא / טריפלקס (+) — לא; 6 מ"מ ומעלה — כן (בהזמנות המחוברות: 112/112 של 8 מ"מ
//  ו-6 חלבי היו חיסום, מראות אף פעם).
function lgOptyMatChisum(code, en, mats) {
  const c = String(code || ''), m = (mats || {})[c] || {};
  if (m.chisum === true || m.chisum === false) return m.chisum;
  const t = (c + ' ' + String(en || m.en || '')).toLowerCase();
  if (/mir|mirror|lacobel|\bla\b|savta|sav\b/.test(t) || c.includes('+')) return false;
  const th = Number((c.match(/^(\d{1,2})/) || [])[1]);
  return th >= 6;
}
//  n ימי עבודה קדימה (א'–ה')
function lgOptyWorkAdd(iso, n) {
  let d = iso;
  for (let k = 0; k < n; k++) {
    d = _lgIsoAdd(d, 1);
    for (let i = 0; i < 3; i++) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd !== 5 && wd !== 6) break; d = _lgIsoAdd(d, 1); }
  }
  return d;
}
const LG_HE_DAYS = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\''];
function _lgWhen(iso, todayIso) {
  if (iso === _lgIsoAdd(todayIso, 1)) return 'מחר';
  return 'ביום ' + LG_HE_DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()] + ' ' + iso.split('-').reverse().slice(0, 2).join('/');
}
//  מצב "מוכן" לזכוכית בחיפוש: { cut, ready, label }. בלי חיסום — מוכן מרגע שנחתך.
//  חיסום: יום החיתוך → "יוצא לחיסום <יום העבודה הבא>"; למחרת → "בחיסום · חוזר <יום אחריו> בבוקר"; משם — מוכן.
function lgOptyPieceReady(rec, sheetNo, todayIso, chisum) {
  const c = lgOptyPieceCut(rec, sheetNo, todayIso);
  if (!c.cut) return Object.assign({ ready: false }, c, chisum ? { label: c.label + ' · חיסום' } : {});
  if (!chisum) return { cut: true, ready: true, label: c.label + ' · מוכן' };
  const day = (rec && rec.day) || todayIso, out = lgOptyWorkAdd(day, 1), back = lgOptyWorkAdd(day, 2);
  if (todayIso < out) return { cut: true, ready: false, label: 'נחתך · יוצא לחיסום ' + _lgWhen(out, todayIso) };
  if (todayIso < back) return { cut: true, ready: false, label: 'בחיסום · חוזר ' + _lgWhen(back, todayIso) + ' בבוקר' };
  return { cut: true, ready: true, label: 'חזר מחיסום · מוכן' };
}

//  ─── הערכת עבודה (בן, 17/11: "כמה עבודה יש היום והאם זה הרבה") ───
//  לוח → { pieces, m2, features }. features = חורים/חריצים/חיתוכי צורה מהשרטוט (lgOptyFeatures); בלי שרטוט = 0.
const LG_OPTY_W0 = { sheet: 1, piece: 0.15, m2: 0.02, feature: 0.3 };   // התחלה בלבד — נלמד מזמני הסימון
function _lgFeat() {
  if (typeof lgOptyFeatures === 'function') return lgOptyFeatures;
  try { return require('./opty-shape.js').lgOptyFeatures; } catch (e) { return () => []; }
}
function lgOptySheetStats(sheet, geos) {
  const feat = _lgFeat(), gs = geos || {};
  let m2 = 0, features = 0;
  (sheet.pieces || []).forEach(p => {
    m2 += (p.w * p.h) / 1e6;
    const g = p.shape ? gs[p.shape] : null;
    if (g) features += feat(g).length;
  });
  if (sheet.feat != null && !Object.keys(gs).length) features = Number(sheet.feat) || 0;   // נספר בקליטה (קבצי ה-.dat)
  return { pieces: (sheet.pieces || []).length, m2: Math.round(m2 * 100) / 100, features };
}
function lgOptyUnits(st, model) {
  const w = (model && model.weights) || LG_OPTY_W0, s = st || {};
  return Math.round(((w.sheet || 0) * (s.sheets == null ? 1 : s.sheets) + (w.piece || 0) * (s.pieces || 0)
    + (w.m2 || 0) * (s.m2 || 0) + (w.feature || 0) * (s.features || 0)) * 100) / 100;
}
//  יום עבודה → סכום הלוחות הפיזיים של כל האופטימיזציות שלו
function lgOptyDayStats(jobs, day, geos) {
  const out = { sheets: 0, pieces: 0, m2: 0, features: 0, jobs: 0 };
  Object.values(jobs || {}).forEach(r => {
    if (!r || r.day !== day || !r.sheets) return;
    out.jobs++;
    r.sheets.forEach(sh => {
      const n = sh.count || 1, st = lgOptySheetStats(sh, geos);
      out.sheets += n; out.pieces += n * st.pieces; out.m2 += n * st.m2; out.features += n * st.features;
    });
  });
  out.m2 = Math.round(out.m2 * 100) / 100;
  return out;
}
//  מול החציון של הימים הקודמים: < 0.8 קל, עד 1.2 רגיל, מעל — עמוס
function lgOptyDayVerdict(units, history) {
  const h = (history || []).filter(x => x > 0).slice(-20).sort((a, b) => a - b);
  if (!h.length || !(units > 0)) return { label: 'יום רגיל', ratio: null };
  const med = h.length % 2 ? h[(h.length - 1) / 2] : (h[h.length / 2 - 1] + h[h.length / 2]) / 2;
  const ratio = Math.round((units / med) * 10) / 10;
  return { label: ratio < 0.8 ? 'יום קל' : ratio <= 1.2 ? 'יום רגיל' : 'יום עמוס', ratio };
}
//  למידה מזמני הסימון: gaps = [{ stats, minutes }] (הזמן בין סימון לוח לסימון הקודם).
//  פער מתחת לחצי דקה או מעל 45 דקות — לא נחשב (סימונים ראשונים לא מדויקים, הפסקות). פחות מ-30 → null.
//  ריבועים פחותים בלי משקל שלילי (מוציאים משתנה שלילי ופותרים שוב).
function lgOptyFit(gaps) {
  const K = ['sheet', 'piece', 'm2', 'feature'];
  const rows = (gaps || []).filter(g => g && g.stats && g.minutes >= 0.5 && g.minutes <= 45)
    .map(g => ({ x: [1, g.stats.pieces || 0, g.stats.m2 || 0, g.stats.features || 0], y: g.minutes }));
  if (rows.length < 30) return null;
  let on = [0, 1, 2, 3];
  for (let it = 0; it < 4; it++) {
    const n = on.length, A = on.map(() => new Array(n + 1).fill(0));
    rows.forEach(r => on.forEach((i, a) => { on.forEach((j, b) => { A[a][b] += r.x[i] * r.x[j]; }); A[a][n] += r.x[i] * r.y; }));
    for (let c = 0; c < n; c++) {            // גאוס
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-9) { A[c][c] = 1e-9; }
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    const sol = on.map((_, a) => A[a][n] / A[a][a]);
    const neg = sol.reduce((m, v, a) => (v < 0 && (m < 0 || v < sol[m]) ? a : m), -1);
    if (neg < 0) {
      const weights = { sheet: 0, piece: 0, m2: 0, feature: 0 };
      on.forEach((i, a) => { weights[K[i]] = Math.round(sol[a] * 1000) / 1000; });
      return { weights, n: rows.length };
    }
    on = on.filter((_, a) => a !== neg);
    if (!on.length) return null;
  }
  return null;
}
//  שעות — רק כשיש מודל שנלמד (אז יחידה = דקה)
function lgOptyHours(units, model) {
  return model && model.n ? Math.round((units / 60) * 10) / 10 : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lgOptyLayoutParse, lgOptySheetSeq, lgOptyCutDay, lgOptyLayoutSvg, lgOptyJobRecord, lgOptyCutStamps, lgOptyCutState, lgOptyTodayIso, lgOptyJobLabels, lgOptyChunks, lgOptyPieceSearch, lgOptyPieceCut, lgOptyMatChisum, lgOptyWorkAdd, lgOptyPieceReady, lgOptyMatHe, lgOptyMatLabel, lgOptySheetStats, lgOptyUnits, lgOptyDayStats, lgOptyDayVerdict, lgOptyFit, lgOptyHours };
}
