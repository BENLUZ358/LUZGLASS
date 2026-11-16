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
    const u = spec.angleEdge != null ? spec.angleEdge : K.edge;   // מרחק שהוקלד לפריט (bracketInset)
    const vc = _lgOv(spec.angleEnd, end, K.end) + K.dia / 2, c = _lgFrameAt(spec, edge, end, u, vc).pt(u, vc);
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
//  spec: { w, h, side, slope?, hingeEnd?, angleEnd?, angleEdge? /* זווית סגורה בלבד */, harmEnd?, harmEdge?, handle? }
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

// ═══════════════════════════════════════════════════════════════════
//  מהמקלחון של המנוע לחיתוכים לכל זכוכית
// ═══════════════════════════════════════════════════════════════════
//
//  מקור אחד: lgLayout מחליט איפה כל ציר / זווית / ידית יושבים (כולל תקרת 215, ציר שהוזן ביד,
//  יישור ידיות, שיפוע). כאן רק מתרגמים את ההחלטות שלו לתבנית החיתוך:
//    • איזו צלע נושאת מה  → מפתח התבנית + side
//    • הגובה של כל פרזול  → hingeEnd / angleEnd / harmEnd / handle.y — כך ש**מרכז** החיתוך נופל בדיוק
//      בגובה שהמנוע קבע. ציר 200 מקצה הדלת = 201 במידת החיתוך = 161 עד שפת החלון (ברירת המחדל).
//      ציר משותף נמדד בכל זכוכית מהקצה שלה — בקבוע שהדלת תלויה עליו יוצא 176 למטה (215+1−40).
//      חורי הרמוניקה של דלת וכנף — אותו גובה מוחלט, גם כשהכנף נמוכה.
//    • המרחקים מהצלע (10 / 26 / 27 / 61) — מהתבנית שנמדדה, לא מהמנוע.
//  זכוכית שאינה מקלחון (מראה, צורה חופשית) → key null, קו מתאר בלבד, בלי חיתוכים.
//  זכוכית מקלחון ששום תבנית לא מתאימה לה → key null + issue (חוסם DXF — עדיף מקובץ שגוי).

const LG_CUT_ISSUE = Object.freeze({
  outside: 'חיתוך יוצא מהזכוכית',
  close: 'חיתוכים קרובים מדי',
  noTemplate: 'אין תבנית חיתוך לזכוכית הזו — לבדוק ביד',
  notTwo: 'לא שני חיתוכים בצלע — לבדוק ביד',
  notch: 'פינוי מדרגה בצלע עם פרזול — אין תבנית, לבדוק ביד',
  openInset: 'זווית פתוחה עם מרחק מהפאה שהוקלד — לבדוק ביד',
  handleEdge: 'הידית במנוע בצלע אחרת מהתבנית — לבדוק ביד',
  sliding: 'זכוכית הזזה — עדיין אין תבנית, לבדוק ביד',
  glassAngle: 'זווית זכוכית-זכוכית — עדיין אין תבנית, לבדוק ביד',
  cutout: 'חיתוך חופשי — עדיין לא בקובץ, לבדוק ביד',
  slopeNotch: 'שיפוע יחד עם מדרגה — עדיין אין תבנית, לבדוק ביד',
  badNumber: 'מספר לא תקין — לבדוק ביד',
  edge: 'חיתוך קרוב מדי לקצה הזכוכית — לבדוק ביד',
  solve: 'מיקום החיתוך לא התכנס — לבדוק ביד'
});
const LG_CUT_MIN_GAP = 5;   // מ"מ בין שני חיתוכים (החלטה #5)
//  מ"מ זכוכית לפחות בין חיתוך לקצה שהוא לא אמור לגעת בו (סקירה סופית, 16/11). חלון הציר נמדד 10 מהצלע
//  שלו — 9.5 משאיר לו מרווח עיגול; השקע הפתוח פתוח לצלע שלו ולכן פטור ממנה בלבד.
const LG_CUT_MIN_EDGE = 9.5;

//  המנוע: בדפדפן — הגלובליים של lg-shapes.js + lg-layout.js. ב-Node — טוען אותם להקשר נפרד
//  (lg-layout קורא ל-lgJunctions כגלובלי, ולכן require רגיל לא מספיק).
let _lgCutEng = null;
function _lgEngine() {
  if (typeof lgLayout === 'function' && typeof lgOutline === 'function' && typeof lgJunctions === 'function')
    return { lgLayout, lgOutline, lgGeometryIssues: typeof lgGeometryIssues === 'function' ? lgGeometryIssues : null };
  if (_lgCutEng) return _lgCutEng;
  if (typeof require === 'function' && typeof __dirname === 'string') {
    const fs = require('fs'), path = require('path'), vm = require('vm');
    const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
    ['lg-shapes.js', 'lg-layout.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx));
    return (_lgCutEng = { lgLayout: ctx.lgLayout, lgOutline: ctx.lgOutline, lgGeometryIssues: ctx.lgGeometryIssues });
  }
  throw new Error('lgCuts: engine not loaded (lg-shapes.js + lg-layout.js)');
}

const _LG_SHOWER_KIND = { fixed: 1, door: 1 };
const _lgCutOther = e => (e === 'left' ? 'right' : 'left');

//  קו המתאר של lgOutline (y למטה מהראש) → מידת חיתוך: y למעלה, נגד כיוון השעון מהפינה
//  השמאלית-תחתונה (כמו בתבנית), וכל צלע זזה allowance/2 החוצה לאורך הנורמל שלה.
function _lgCutOutline(poly, mmH) {
  const d = LG_CUT.allowance / 2, a = poly.map(p => [p[0] + d, mmH - p[1] + d]);
  let area = 0;
  for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; area += p[0] * q[1] - q[0] * p[1]; }
  const P = area < 0 ? a.slice().reverse() : a, n = P.length;
  //  נגד כיוון השעון: הנורמל החיצוני של צלע (dx,dy) הוא (dy,−dx)
  const lines = P.map((p, i) => {
    const q = P[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L;
    return { p: [p[0] + nx * d, p[1] + ny * d], v: [q[0] - p[0], q[1] - p[1]], nx, ny };
  });
  const out = P.map((p, i) => {
    const A = lines[(i - 1 + n) % n], B = lines[i], den = A.v[0] * B.v[1] - A.v[1] * B.v[0];
    if (Math.abs(den) < 1e-9) return [p[0] + B.nx * d, p[1] + B.ny * d];
    const t = ((B.p[0] - A.p[0]) * B.v[1] - (B.p[1] - A.p[1]) * B.v[0]) / den;
    return [A.p[0] + A.v[0] * t, A.p[1] + A.v[1] * t];
  });
  const s = out.reduce((b, p, i) => (p[0] + p[1] < out[b][0] + out[b][1] - 1e-9 ? i : b), 0);
  return out.slice(s).concat(out.slice(0, s)).map(p => [_r2(p[0]), _r2(p[1])]);
}

//  שיפוע לתבנית מתוך מרובע במידת החיתוך [LB, RB, RT, LT]: כל צלע מוארכת עד y=0/h או x=0/w
function _lgSlopeOf(o, w, h) {
  if (o.length !== 4) return null;
  const [LB, RB, RT, LT] = o, out = [];
  const xAt = (A, B, y) => (Math.abs(B[1] - A[1]) < 1e-9 ? A[0] : A[0] + (B[0] - A[0]) * (y - A[1]) / (B[1] - A[1]));
  const yAt = (A, B, x) => (Math.abs(B[0] - A[0]) < 1e-9 ? A[1] : A[1] + (B[1] - A[1]) * (x - A[0]) / (B[0] - A[0]));
  const add = (edge, a, b) => { if (Math.abs(a) > 1e-6 || Math.abs(b) > 1e-6) out.push({ edge, a: _r4(a), b: _r4(b) }); };
  add('left', xAt(LB, LT, 0), xAt(LB, LT, h));
  add('right', w - xAt(RB, RT, 0), w - xAt(RB, RT, h));
  add('bottom', yAt(LB, RB, 0), yAt(LB, RB, w));
  add('top', h - yAt(LT, RT, 0), h - yAt(LT, RT, w));
  return out.length ? out : null;
}

//  מה המנוע שם על כל צלע של כל זכוכית (y בקנבס, גדל כלפי מטה).
//  ציר של צומת שייך לשתי הזכוכיות (כל אחת נקדחת); זווית — רק לזו שהמנוע מבריג אליה (host).
//  זווית זכוכית-זכוכית (jType 'bracket-gg') נקדחת בשתיהן ואין לה תבנית → gg מסומן בשתי הזכוכיות.
function _lgFeatures(L, n) {
  const F = Array.from({ length: n }, () => ({ left: {}, right: {}, handle: [], holes: [], gg: false }));
  const put = (i, edge, kind, y) => { if (F[i]) (F[i][edge][kind] || (F[i][edge][kind] = [])).push(y); };
  for (const h of L.hardware) {
    const i = h.idx;
    if (!F[i]) continue;
    if (h.kind === 'hole' && h.role === 'handle') { F[i].handle.push(h); continue; }
    //  צומת j יושב בין זכוכית j−1 (הצלע הימנית שלה) לזכוכית j (השמאלית)
    const edge = h.junction != null ? (h.junction === i ? 'left' : 'right') : (h.into === -1 ? 'right' : 'left');
    if (h.kind === 'hinge') {
      const k = h.variant === 'harmonica' ? 'harm' : 'hinge';
      put(i, edge, k, h.y);
      if (h.junction != null) {   // הזכוכית שממול בצומת
        const m = edge === 'left' ? h.junction - 1 : h.junction;
        if (m >= 0 && m < n && m !== i) put(m, _lgCutOther(edge), k, h.y);
      }
    } else if (h.kind === 'bracket' && h.role !== 'bracket-floor') {
      put(i, edge, 'angle', h.y);
      if (h.jType === 'bracket-gg') {
        F[i].gg = true;
        const m = h.junction != null ? (edge === 'left' ? h.junction - 1 : h.junction) : -1;
        if (F[m]) F[m].gg = true;
      }
    }
    else F[i].holes.push(h);   // קדח חופשי / זווית רצפה — עיגול במקום שהמנוע קבע
  }
  return F;
}

//  מפתח התבנית + side מהצלעות. null = אין תבנית שמתאימה
function _lgPickTemplate(s, f) {
  const edges = k => ['left', 'right'].filter(e => !!f[e][k]);
  const angle = edges('angle'), hinge = edges('hinge'), harm = edges('harm');
  if (s.kind === 'fixed') {
    if (harm.length || angle.length !== 1 || hinge.length > 1) return null;
    const a = s.bracketType === 'open' ? 'open' : 'closed';
    if (!hinge.length) return { key: 'fixed-' + a, side: angle[0] };
    if (hinge[0] === angle[0]) return null;
    return { key: 'fixed-' + a + '-door', side: angle[0] };
  }
  if (s.kind !== 'door' || angle.length) return null;
  const handle = f.handle.length > 0;
  if (hinge.length === 1 && !harm.length) return { key: 'door', side: hinge[0] };
  if (hinge.length === 1 && harm.length === 1 && harm[0] !== hinge[0])
    return { key: handle ? 'door-harm-handle' : 'door-harm', side: hinge[0] };
  if (!hinge.length && harm.length === 1) return { key: handle ? 'harm-handle' : 'harm', side: harm[0] };
  return null;
}

//  ההיסט לקצה כך שמרכז החיתוך (ובהרמוניקה — אמצע הזוג) יפול בגובה המבוקש, מ"מ במידת החיתוך.
//  הקשר ליניארי (בצלע / קצה נטויים הגורם קרוב ל-1), ולכן כמה סבבים מתכנסים.
const _LG_END_FIELD = { hinge: 'hingeEnd', open: 'angleEnd', closed: 'angleEnd', harm: 'harmEnd' };
const _LG_END_DEF = { hinge: LG_CUT.hinge.end, open: LG_CUT.open.end, closed: LG_CUT.closed.end, harm: LG_CUT.harm.c1 };
function _lgSolveEnd(spec, kind, edge, end, yTarget) {
  const field = _LG_END_FIELD[kind], sg = end === 'bottom' ? 1 : -1;
  let v = _LG_END_DEF[kind];
  for (let i = 0; i < 8; i++) {
    const cs = _lgCutAt(Object.assign({}, spec, { [field]: { [end]: v } }), kind, edge, end);
    const err = yTarget - cs.reduce((t, c) => t + c.y, 0) / cs.length;
    if (Math.abs(err) < 1e-4) return _r2(v);
    v += sg * err;
  }
  //  לא התכנס תוך הסבבים — null, והזכוכית נחסמת (עדיף בלי קובץ מחיתוך בגובה לא נכון)
  const cs = _lgCutAt(Object.assign({}, spec, { [field]: { [end]: v } }), kind, edge, end);
  return Math.abs(yTarget - cs.reduce((t, c) => t + c.y, 0) / cs.length) <= 0.05 ? _r2(v) : null;
}

//  דגימת קונטור לנקודות (≤ 1 מ"מ) — לבדיקות "בתוך הזכוכית" ו"מרחק בין חיתוכים"
function _lgSample(contour) {
  const pts = [];
  for (const s of contour) {
    if (s[0] === 0) {
      const k = Math.max(1, Math.ceil(Math.hypot(s[3] - s[1], s[4] - s[2])));
      for (let i = 0; i <= k; i++) pts.push([s[1] + (s[3] - s[1]) * i / k, s[2] + (s[4] - s[2]) * i / k]);
    } else {
      const k = Math.max(4, Math.ceil(Math.abs(s[5] - s[4]) * s[3]));
      for (let i = 0; i <= k; i++) { const a = s[4] + (s[5] - s[4]) * i / k; pts.push([s[1] + s[3] * Math.cos(a), s[2] + s[3] * Math.sin(a)]); }
    }
  }
  return pts;
}
function _lgInPoly(p, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function _lgSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const _lgPolyDist = (pts, P) => Math.min(...pts.map(p => Math.min(...P.map((a, i) => _lgSegDist(p, a, P[(i + 1) % P.length])))));
const _lgBox = P => [Math.min(...P.map(p => p[0])), Math.max(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[1]))];

function _lgIssues(outline, cuts) {
  const issues = [], S = cuts.map(c => _lgSample(c.contour || []));
  if (S.some(pts => pts.some(p => !_lgInPoly(p, outline) && _lgPolyDist([p], outline) > 0.01))) issues.push(LG_CUT_ISSUE.outside);
  let close = false;
  for (let i = 0; i < S.length && !close; i++) for (let j = i + 1; j < S.length && !close; j++) {
    const A = S[i], B = S[j];
    if (!A.length || !B.length) continue;
    const a = _lgBox(A), b = _lgBox(B), g = LG_CUT_MIN_GAP;
    if (a[0] - b[1] >= g || b[0] - a[1] >= g || a[2] - b[3] >= g || b[2] - a[3] >= g) continue;   // רחוקים
    if (A.some(p => _lgInPoly(p, B)) || B.some(p => _lgInPoly(p, A)) || Math.min(_lgPolyDist(A, B), _lgPolyDist(B, A)) < g) close = true;
  }
  if (close) issues.push(LG_CUT_ISSUE.close);
  //  מרחק מהקצוות: כל חיתוך ≥ LG_CUT_MIN_EDGE מכל צלע של קו המתאר; שקע פתוח — חוץ מהצלע הקרובה למרכזו
  const n = outline.length;
  const near = cuts.some((c, i) => {
    if (!S[i].length) return false;
    let skip = -1;
    if (c.kind === 'open') {
      let bd = Infinity;
      for (let k = 0; k < n; k++) { const d = _lgSegDist([c.x, c.y], outline[k], outline[(k + 1) % n]); if (d < bd) { bd = d; skip = k; } }
    }
    for (let k = 0; k < n; k++) {
      if (k === skip) continue;
      const a = outline[k], b = outline[(k + 1) % n];
      if (S[i].some(p => _lgSegDist(p, a, b) < LG_CUT_MIN_EDGE)) return true;
    }
    return false;
  });
  if (near) issues.push(LG_CUT_ISSUE.edge);
  return issues;
}

//  ניתוח המקלחון פעם אחת: לכל זכוכית — המקום שלה בפריסה, הקו, הצלעות, התבנית
function _lgAnalyse(shower) {
  const E = _lgEngine(), shapes = (shower && shower.shapes) || [];
  const L = E.lgLayout(shower, { canvasW: 2000 }), O = E.lgOutline(shower);
  const F = _lgFeatures(L, shapes.length);
  return shapes.map((s, i) => {
    const isShower = !!(s && _LG_SHOWER_KIND[s.kind]), ol = O[i];
    let pick = isShower ? _lgPickTemplate(s, F[i]) : null;
    const block = [], stop = msg => { pick = null; block.push(msg); };
    const outline = ol ? _lgCutOutline(ol.poly, ol.mmH) : null;
    //  זווית זכוכית-זכוכית — בכל צלע, מארחת או שכנה: אין תבנית שנמדדה (גם לא לזכוכית שלא מבריגה אליה)
    if (isShower && F[i] && F[i].gg) stop(LG_CUT_ISSUE.glassAngle);
    //  פינוי מדרגה בצלע שיש בה פרזול: המנוע מזיז את הזווית לפאה הפנימית / מודד מהכתף — לא נמדד
    //  בשום תבנית. חוסמים כל צלע כזו (גם 'shoulder'), לא רק כשהחור יוצא מהזכוכית.
    const nt = ol && ol.notch, ne = nt && (nt.side === 'right' ? 'right' : 'left');
    if (pick && ne && ['angle', 'hinge', 'harm'].some(k => F[i][ne][k])) stop(LG_CUT_ISSUE.notch);
    //  זכוכית הזזה (s.sliding מ-lgFromPanels, פאנל type:'slider') — מחוץ לשלב הזה; המנוע מצייר אותה
    //  כקבוע, אבל תבנית של קבוע עליה היא קובץ שגוי. עדיף בלי קובץ.
    if (isShower && s && s.sliding) stop(LG_CUT_ISSUE.sliding);
    //  פינוי חופשי (s.cutouts) — עוד לא נכתב לקובץ; קובץ בלעדיו הוא זכוכית בלי החור
    if (isShower && s && (s.cutouts || []).length) stop(LG_CUT_ISSUE.cutout);
    //  שיפוע בקו מתאר שאינו מרובע (שיפוע + מדרגה): _lgSlopeOf לא קורא אותו, והחיתוכים היו יוצאים ישרים
    if (isShower && pick && outline && outline.length > 4 && outline.some((p, k) => {
      const q = outline[(k + 1) % outline.length];
      return Math.abs(q[0] - p[0]) > 0.01 && Math.abs(q[1] - p[1]) > 0.01;
    })) stop(LG_CUT_ISSUE.slopeNotch);
    return { s: s || {}, sh: L.shapes[i], ol, outline, f: F[i], sc: L.scale, isShower, pick, block };
  });
}

//  lgTemplateOf(shower, i) → מפתח תבנית, או null (לא זכוכית מקלחון / אין תבנית שמתאימה — lgCuts מסביר)
function lgTemplateOf(shower, i) {
  const a = _lgAnalyse(shower)[i];
  return a && a.pick ? a.pick.key : null;
}

//  lgCuts(shower) → [{ idx, key, side, w, h, outline, cuts, issues }] — מ"מ במידת החיתוך, ראשית שמאל-למטה
//  ידית: knob → Ø12 אחד · vertical → תבנית towel (זוג זה מעל זה) · towel (אופקית) → שני Ø12 באותו גובה,
//  השני gap פנימה · towel-center → Ø12 61 מכל צלע · none → בלי חור ידית (ובהרמוניקה — המפתח בלי -handle).
function lgCuts(shower) {
  //  בעיות הצורה של המנוע (חוצה את עצמה, מדרגה שלא נסגרת, פינוי/קדח שחורג) — לכל זכוכית, בנוסח של המנוע
  const E = _lgEngine(), geo = {};
  if (E.lgGeometryIssues) (E.lgGeometryIssues(shower) || []).forEach(q => { (geo[q.idx] || (geo[q.idx] = [])).push(q.msg); });
  return _lgAnalyse(shower).map((A, idx) => {
    const g = _lgCutsOne(A, idx);
    if (A.isShower && geo[idx]) g.issues = g.issues.concat(geo[idx].filter(m => !g.issues.includes(m)));
    return g;
  });
}
const _lgFin = v => typeof v === 'number' && Number.isFinite(v);
function _lgCutsOne(A, idx) {
  {
    const { s, sh, ol, f, sc, pick, outline } = A;
    const w = ol.mmW + LG_CUT.allowance, h = ol.mmH + LG_CUT.allowance;
    const base = { idx, key: null, side: null, w, h, outline, cuts: [], issues: [] };
    if (!A.isShower) return base;
    if (!pick) return Object.assign(base, { issues: A.block.length ? A.block : [LG_CUT_ISSUE.noTemplate] });
    //  קנבס → מ"מ במידת החיתוך: מתחתית / משמאל תיבת הזכוכית, +1
    const half = LG_CUT.allowance / 2;
    const yCut = y => (sh.y + sh.h - y) / sc + half, xCut = x => (x - sh.x) / sc + half;
    const spec = { w, h, side: pick.side };
    const slope = _lgSlopeOf(outline, w, h);
    if (slope) spec.slope = slope;
    const T = LG_CUT_TEMPLATES[pick.key], other = _lgCutOther(pick.side);
    for (const kind of Object.keys(T)) {
      if (kind === 'handle') continue;
      const edge = T[kind] === 'side' ? pick.side : other;
      const ys = f[edge][kind === 'open' || kind === 'closed' ? 'angle' : kind] || [];
      if (ys.length !== 2) return Object.assign(base, { key: pick.key, side: pick.side, issues: [LG_CUT_ISSUE.notTwo] });
      const [top, bot] = ys.slice().sort((a, b) => a - b);   // בקנבס הקטן למעלה
      const eb = _lgSolveEnd(spec, kind, edge, 'bottom', yCut(bot)), et = _lgSolveEnd(spec, kind, edge, 'top', yCut(top));
      if (eb == null || et == null) return Object.assign(base, { key: pick.key, side: pick.side, issues: [LG_CUT_ISSUE.solve] });
      spec[_LG_END_FIELD[kind]] = { bottom: eb, top: et };
    }
    //  ידית: בדיוק בחצי גובה הזכוכית החתוכה (נתוני המפעל, 547/589) — **בלי** תקרת המטר של המנוע;
    //  רק מרחק שהלקוח הקליד (handleDist) גובר, ואז הגובה מהמנוע. המרחק מהצלע — 61, או handleEdge (ס"מ).
    const ht = s.handleType, H = f.handle;
    const edgeOff = s.handleEdge != null ? Number(s.handleEdge) * 10 + half : LG_CUT.handle.edge;
    let extra = [], handleMismatch = false;
    //  מרחק זווית שהוקלד (bracketInset — מ"מ, כמו במנוע): בסגורה עובר לחיתוך; בפתוחה אין לו משמעות → חסום
    const inset = s.bracketInset != null && s.bracketInset !== '' ? Number(s.bracketInset) : null;
    if (inset != null && T.closed) spec.angleEdge = inset + half;
    if (T.handle && H.length) {
      const hEdge = T.handle === 'side' ? pick.side : other;
      //  הצלע שבה המנוע שם את הידית (החור הקרוב ביותר לצלע) חייבת להיות צלע התבנית
      if (ht !== 'towel-center') {
        const fromL = x => x.x - sh.x, fromR = x => sh.x + sh.w - x.x, dist = x => Math.min(fromL(x), fromR(x));
        const hn = H.reduce((a, b) => (dist(b) < dist(a) ? b : a));
        if ((fromL(hn) <= fromR(hn) ? 'left' : 'right') !== hEdge) handleMismatch = true;
      }
      const y = s.handleDist != null && s.handleDist !== ''
        ? _r2(yCut(H.reduce((t, x) => t + x.y, 0) / H.length))
        : _lgHandle(Object.assign({}, spec, { handle: { type: 'knob', edge: edgeOff } }), hEdge)[0].y;
      if (ht === 'vertical' && H.length === 2) {
        spec.handle = { type: 'towel', y, spacing: _r2(Math.abs(H[0].y - H[1].y) / sc), edge: edgeOff };
      } else {
        spec.handle = { type: 'knob', y, edge: edgeOff };
        //  מגבת אופקית ומרכוז אין בתבניות שנמדדו — החור השני נבנה מאותו Ø12
        const more = e => _lgHandle(Object.assign({}, spec, { handle: { type: 'knob', y, edge: e } }), hEdge);
        if (ht === 'towel' && H.length === 2) extra = more(_r2(edgeOff + Math.abs(H[0].x - H[1].x) / sc));
        else if (ht === 'towel-center' && H.length === 2)
          extra = _lgHandle(Object.assign({}, spec, { handle: { type: 'knob', y, edge: edgeOff } }), _lgCutOther(hEdge));
      }
    }
    let cuts;
    try { cuts = lgCutTemplate(pick.key, spec).cuts.concat(extra); }
    catch (e) { return Object.assign(base, { key: pick.key, side: pick.side, issues: [LG_CUT_ISSUE.badNumber] }); }
    //  'none' בדלת רגילה: אין מפתח 'door' בלי ידית — מורידים את חור הידית מהתבנית
    if (T.handle && !H.length) cuts = cuts.filter(c => c.kind !== 'handle');
    const pre = [];
    if (inset != null && T.open) pre.push(LG_CUT_ISSUE.openInset);
    if (handleMismatch) pre.push(LG_CUT_ISSUE.handleEdge);
    //  קדח חופשי / זווית רצפה — עיגול בדיוק איפה שהמנוע שם אותו
    for (const hl of f.holes) cuts.push(_lgCircle('hole', xCut(hl.x), yCut(hl.y), hl.dia));
    //  מספר שלא נקרא (bracketInset / handleEdge שהוקלדו לא כמספר) → NaN בחיתוך. חוסמים כאן, לא רק ב-DXF
    const finite = c => [c.x, c.y].concat(c.dia != null ? [c.dia] : []).every(_lgFin) &&
      (c.contour || []).every(sg => sg.slice(1).every(_lgFin));
    if (!cuts.every(finite)) return Object.assign(base, { key: pick.key, side: pick.side, cuts, issues: pre.concat([LG_CUT_ISSUE.badNumber]) });
    return Object.assign(base, { key: pick.key, side: pick.side, cuts, issues: pre.concat(_lgIssues(outline, cuts)) });
  }
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { LG_CUT, LG_HINGE_CONTOUR, LG_CUT_TEMPLATES, LG_CUT_ISSUE, lgCutTemplate, lgTemplateOf, lgCuts, lgCutIssues: _lgIssues };
