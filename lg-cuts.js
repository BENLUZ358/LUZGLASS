// ═══════════════════════════════════════════════════════════════════
//  lg-cuts.js — גיאומטריית חיתוך מדויקת לכל זכוכית (חלונות ציר, חורים, חריצים)
//  נמדד מקבצי חיתוך אמיתיים של אופטי-ווי (בן, 16/11). טהור: דפדפן וגם Node.
// ═══════════════════════════════════════════════════════════════════

// הערכים נמדדו מ-2,372 צורות של אופטי-ווי (16/11, בן) על מידת החיתוך (לא מידת ההזמנה)
const LG_CUT = Object.freeze({
  allowance: 2,
  hinge:  Object.freeze({ w: 39, h: 80, edge: 10, end: 161 }),
  handle: Object.freeze({ dia: 12, edge: 61 }),
  open:   Object.freeze({ w: 20, l: 35, lSlope: 36, r: 10, end: 191 }),   // על צלע נטויה השקע עמוק 36 (13 מ-14 צורות)
  closed: Object.freeze({ dia: 20, edge: 26, end: 191 }),
  harm:   Object.freeze({ dia: 18, edge: 27, c1: 181, c2: 221 })
});

// קונטור חלון הציר, יחסית לפינת התיחום (x מצד קצה הזכוכית, y מתחתית החלון) — מ-274378.dat
// מקטע: [0,x1,y1,x2,y2] קו · [1,cx,cy,r,a0,a1] קשת (רדיאנים)
const LG_HINGE_CONTOUR = Object.freeze([
  [0,0,7.5,17.88,7.5],
  [1,17.88,5.5,2,1.5708,0.3844],
  [1,29,10,10,-2.7572,1.0472],
  [1,35,20.39,2,4.1888,3.1416],
  [0,33,20.39,33,59.61],
  [1,35,59.61,2,3.1416,2.0944],
  [1,29,70,10,-1.0472,2.7572],
  [1,17.88,74.5,2,5.8988,4.7124],
  [0,17.88,72.5,0,72.5]
].map(s => Object.freeze(s)));

// ── תבניות ─────────────────────────────────────────────────────────
//  side = הצלע הארוכה שמתחברת (לקיר או לזכוכית הקודמת):
//    דלת: צלע הצירים, ידית בצד השני · קבוע: צלע הזוויות; בקבוע שנושא דלת — הצירים בצד השני
//    הרמוניקה: צלע החורים, ידית בצד השני · דלת+הרמוניקה: צירים ב-side, חורי הרמוניקה וידית בצד השני
const LG_CUT_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries({
  'door':             { hinge: 'side', handle: 'other' },
  'fixed-open-door':  { open: 'side', hinge: 'other' },
  'fixed-closed-door':{ closed: 'side', hinge: 'other' },
  'fixed-open':       { open: 'side' },
  'fixed-closed':     { closed: 'side' },
  'harm':             { harm: 'side' },
  'harm-handle':      { harm: 'side', handle: 'other' },
  'door-harm':        { hinge: 'side', harm: 'other' },
  'door-harm-handle': { hinge: 'side', harm: 'other', handle: 'other' }
}).map(([k, v]) => [k, Object.freeze(v)])));

const _r2 = v => Math.round(v * 100) / 100, _r4 = v => Math.round(v * 10000) / 10000;
const LG_TOWEL_SPACING = 550;   // ברירת מחדל לידית מגבת — כמו LG_TOWEL_MM במנוע

//  שיפוע: {edge, a, b} או רשימה של כאלה (צלע ארוכה + קצה נטוי יחד).
//  a = ה-inset בתחילת הצלע (למטה בצלע ארוכה, משמאל בקצה), b = בסופה (למעלה / מימין)
const _lgSlope = (spec, edge) => [].concat(spec.slope || []).find(s => s && s.edge === edge) || null;
//  x של הצלע הארוכה בגובה y
function _lgEdgeX(spec, edge, y) {
  const sl = _lgSlope(spec, edge), inset = sl ? sl.a + (sl.b - sl.a) * y / spec.h : 0;
  return edge === 'left' ? inset : spec.w - inset;
}
//  y של הקצה הקצר ב-x — בקצה נטוי המרחקים נמדדים מהקו הנטוי
function _lgEndY(spec, end, x) {
  const sl = _lgSlope(spec, end), inset = sl ? sl.a + (sl.b - sl.a) * x / spec.w : 0;
  return end === 'bottom' ? inset : spec.h - inset;
}
const _lgOv = (o, end, def) => (o && o[end] != null ? o[end] : def);

//  מסגרת מקומית ליד צלע וקצה: u = מרחק פנימה מהצלע, v = מרחק לאורך הצלע מהקצה הקצר.
//  בצלע נטויה החיתוכים מסתובבים עם הקו (כמו באופטי-ווי); קצה נטוי — רק מזיז (shift) לאורך הצלע.
function _lgFrame(spec, edge, end, shift) {
  const xb = _lgEdgeX(spec, edge, 0), xt = _lgEdgeX(spec, edge, spec.h);
  const len = Math.hypot(xt - xb, spec.h), tx = (xt - xb) / len, ty = spec.h / len;
  const n = edge === 'left' ? [ty, -tx] : [-ty, tx];
  const s = end === 'bottom' ? [tx, ty] : [-tx, -ty];
  const o = end === 'bottom' ? [xb + shift * s[0], shift * s[1]] : [xt + shift * s[0], spec.h + shift * s[1]];
  const an = Math.atan2(n[1], n[0]), det = n[0] * s[1] - n[1] * s[0];
  const pt = (u, v) => [o[0] + u * n[0] + v * s[0], o[1] + u * n[1] + v * s[1]];
  const ang = a => det > 0 ? an + a : an - a;
  const seg = g => {
    if (g[0] === 0) { const a = pt(g[1], g[2]), b = pt(g[3], g[4]); return [0, _r2(a[0]), _r2(a[1]), _r2(b[0]), _r2(b[1])]; }
    const c = pt(g[1], g[2]);
    return [1, _r2(c[0]), _r2(c[1]), g[3], _r4(ang(g[4])), _r4(ang(g[5]))];
  };
  return { pt, seg };
}
//  המסגרת לחיתוך שמרכזו (uc, vc): בקצה נטוי לוקחים את גובה הקו ב-x של מרכז החיתוך,
//  ומזיזים את כל החיתוך בגובה הזה (לא מסובבים) — כך המרחק מהקצה נמדד מהקו הנטוי מול החיתוך
function _lgFrameAt(spec, edge, end, uc, vc) {
  const x = _lgFrame(spec, edge, end, 0).pt(uc, vc)[0];
  const ey = _lgEndY(spec, end, x);
  return _lgFrame(spec, edge, end, end === 'bottom' ? ey : spec.h - ey);
}

const _lgCircle = (kind, x, y, dia) => ({ kind, x: _r2(x), y: _r2(y), dia, contour: [[1, _r2(x), _r2(y), dia / 2, 0, _r4(2 * Math.PI)]] });

//  חיתוכים בקצה אחד (למטה/למעלה) של צלע אחת
function _lgCutAt(spec, kind, edge, end) {
  const K = LG_CUT[kind];
  if (kind === 'hinge') {
    const e = _lgOv(spec.hingeEnd, end, K.end), uc = K.edge + K.w / 2, vc = e + K.h / 2;
    const F = _lgFrameAt(spec, edge, end, uc, vc), c = F.pt(uc, vc);
    return [{ kind, x: _r2(c[0]), y: _r2(c[1]), contour: LG_HINGE_CONTOUR.map(g => F.seg(g[0] === 0
      ? [0, K.edge + g[1], e + g[2], K.edge + g[3], e + g[4]] : [1, K.edge + g[1], e + g[2], g[3], g[4], g[5]])) }];
  }
  if (kind === 'open') {   // שקע פתוח לצלע: מתחיל 1 מ"מ פנימה, קשת r10 בקצה; המרכז = מרכז הקשת (26 מהצלע)
    const e = _lgOv(spec.angleEnd, end, K.end), l = _lgSlope(spec, edge) ? K.lSlope : K.l;
    const u1 = 1, uc = u1 + l - K.r, vc = e + K.w / 2, F = _lgFrameAt(spec, edge, end, uc, vc), c = F.pt(uc, vc);
    return [{ kind, x: _r2(c[0]), y: _r2(c[1]), contour: [
      [0, u1, e + K.w, uc, e + K.w], [1, uc, vc, K.r, Math.PI / 2, -Math.PI / 2], [0, uc, e, u1, e]].map(F.seg) }];
  }
  if (kind === 'closed') {
    const vc = _lgOv(spec.angleEnd, end, K.end) + K.dia / 2, c = _lgFrameAt(spec, edge, end, K.edge, vc).pt(K.edge, vc);
    return [_lgCircle(kind, c[0], c[1], K.dia)];
  }
  if (kind === 'harm') {   // זוג חורים: הראשון ב-harmEnd מהקצה, השני 40 אחריו
    const v1 = _lgOv(spec.harmEnd, end, K.c1), u = spec.harmEdge != null ? spec.harmEdge : K.edge;
    return [v1, v1 + K.c2 - K.c1].map(v => { const c = _lgFrameAt(spec, edge, end, u, v).pt(u, v); return _lgCircle(kind, c[0], c[1], K.dia); });
  }
  return [];
}

//  ידית: knob = Ø12 אחד, towel = שניים זה מעל זה (y ± spacing/2). ברירת מחדל: אמצע הזכוכית, 61 מהצלע (גם מקו נטוי)
function _lgHandle(spec, edge) {
  const H = spec.handle || {}, into = edge === 'left' ? 1 : -1, off = H.edge != null ? H.edge : LG_CUT.handle.edge;
  let y = H.y;
  if (y == null) {
    const x = _lgEdgeX(spec, edge, spec.h / 2) + into * off;
    y = (_lgEndY(spec, 'bottom', x) + _lgEndY(spec, 'top', x)) / 2;
  }
  const sp = H.spacing ?? LG_TOWEL_SPACING;
  const ys = H.type === 'towel' ? [y - sp / 2, y + sp / 2] : [y];
  return ys.map(yy => _lgCircle('handle', _lgEdgeX(spec, edge, yy) + into * off, yy, LG_CUT.handle.dia));
}

function _lgCheckSpec(spec) {
  const bad = m => { throw new Error('lgCutTemplate: ' + m); };
  if (!spec || typeof spec !== 'object') bad('missing spec');
  if (spec.side !== 'left' && spec.side !== 'right') bad('side must be left|right, got ' + JSON.stringify(spec.side));
  for (const k of ['w', 'h']) if (!(Number.isFinite(spec[k]) && spec[k] > 0)) bad(k + ' must be a positive number, got ' + JSON.stringify(spec[k]));
  for (const s of [].concat(spec.slope || [])) {
    if (!s || !['left', 'right', 'top', 'bottom'].includes(s.edge)) bad('unknown slope edge ' + JSON.stringify(s && s.edge));
    if (!Number.isFinite(s.a) || !Number.isFinite(s.b)) bad('slope a/b must be numbers');
  }
  const ht = spec.handle && spec.handle.type;
  if (ht != null && ht !== 'knob' && ht !== 'towel') bad('unknown handle type ' + JSON.stringify(ht));
}

//  lgCutTemplate(key, spec) → { w, h, outline, cuts } — מ"מ במידת החיתוך, ראשית שמאל-למטה.
//  spec: { w, h, side, slope?, hingeEnd?, angleEnd?, harmEnd?, harmEdge?, handle? }
//  שימו לב: hingeEnd / angleEnd = מהקצה עד שפת התיבה של החיתוך; harmEnd = מהקצה עד מרכז החור הראשון.
//  spec שגוי זורק שגיאה — עדיף בלי קובץ מאשר זכוכית הפוכה או חיתוך במקום אקראי.
//  התבנית = ברירת המחדל שנמדדה; כל שדה חריג הוא שינוי ידני לפריט בודד (top/bottom לכל קצה).
function lgCutTemplate(key, spec) {
  const T = LG_CUT_TEMPLATES[key];
  if (!T) throw new Error('lgCutTemplate: unknown template ' + key);
  _lgCheckSpec(spec);
  const side = spec.side, other = side === 'left' ? 'right' : 'left';
  const cuts = [];
  for (const kind of Object.keys(T)) {
    const edge = T[kind] === 'side' ? side : other;
    if (kind === 'handle') cuts.push(..._lgHandle(spec, edge));
    else for (const end of ['bottom', 'top']) cuts.push(..._lgCutAt(spec, kind, edge, end));
  }
  //  פינה = חיתוך הצלע עם הקצה (כמה סבבים מספיקים לשיפועים קטנים)
  const corner = (edge, end) => {
    let x = edge === 'left' ? 0 : spec.w, y = end === 'bottom' ? 0 : spec.h;
    for (let i = 0; i < 4; i++) { y = _lgEndY(spec, end, x); x = _lgEdgeX(spec, edge, y); }
    return [_r2(x), _r2(y)];
  };
  const outline = [corner('left', 'bottom'), corner('right', 'bottom'), corner('right', 'top'), corner('left', 'top')];
  return { w: spec.w, h: spec.h, outline, cuts };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { LG_CUT, LG_HINGE_CONTOUR, LG_CUT_TEMPLATES, lgCutTemplate };
