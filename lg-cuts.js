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

//  x של הצלע הארוכה בגובה y — בשיפוע: הקו הנטוי (inset מלמטה/מלמעלה)
function _lgEdgeX(spec, edge, y) {
  const sl = spec.slope && spec.slope.edge === edge ? spec.slope : null;
  const inset = sl ? sl.bottom + (sl.top - sl.bottom) * y / spec.h : 0;
  return edge === 'left' ? inset : spec.w - inset;
}

//  מסגרת מקומית ליד צלע וקצה: u = מרחק פנימה מהצלע, v = מרחק לאורך הצלע מהקצה הקצר.
//  בשיפוע הצירים מסתובבים עם הקו הנטוי (כמו באופטי-ווי).
function _lgFrame(spec, edge, end) {
  const xb = _lgEdgeX(spec, edge, 0), xt = _lgEdgeX(spec, edge, spec.h);
  const len = Math.hypot(xt - xb, spec.h), tx = (xt - xb) / len, ty = spec.h / len;
  const n = edge === 'left' ? [ty, -tx] : [-ty, tx];
  const o = end === 'bottom' ? [xb, 0] : [xt, spec.h];
  const s = end === 'bottom' ? [tx, ty] : [-tx, -ty];
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

const _lgCircle = (kind, x, y, dia) => ({ kind, x: _r2(x), y: _r2(y), dia, contour: [[1, _r2(x), _r2(y), dia / 2, 0, _r4(2 * Math.PI)]] });

//  חיתוך אחד בקצה אחד: מרכז + קונטור במסגרת המקומית
function _lgCutAt(spec, kind, edge, end) {
  const F = _lgFrame(spec, edge, end), K = LG_CUT[kind];
  if (kind === 'hinge') {
    const e = (spec.hingeEnd && spec.hingeEnd[end] != null) ? spec.hingeEnd[end] : K.end;
    const c = F.pt(K.edge + K.w / 2, e + K.h / 2);
    return [{ kind, x: _r2(c[0]), y: _r2(c[1]), contour: LG_HINGE_CONTOUR.map(g => F.seg(g[0] === 0
      ? [0, K.edge + g[1], e + g[2], K.edge + g[3], e + g[4]] : [1, K.edge + g[1], e + g[2], g[3], g[4], g[5]])) }];
  }
  if (kind === 'open') {   // שקע פתוח לצלע: מתחיל 1 מ"מ פנימה, קשת r10 בקצה; המרכז = מרכז הקשת (26 מהצלע)
    const l = spec.slope && spec.slope.edge === edge ? K.lSlope : K.l;
    const u1 = 1, uc = u1 + l - K.r, vc = K.end + K.w / 2, c = F.pt(uc, vc);
    return [{ kind, x: _r2(c[0]), y: _r2(c[1]), contour: [
      [0, u1, K.end + K.w, uc, K.end + K.w], [1, uc, vc, K.r, Math.PI / 2, -Math.PI / 2], [0, uc, K.end, u1, K.end]].map(F.seg) }];
  }
  if (kind === 'closed') { const c = F.pt(K.edge, K.end + K.dia / 2); return [_lgCircle(kind, c[0], c[1], K.dia)]; }
  if (kind === 'harm') return [K.c1, K.c2].map(v => { const c = F.pt(K.edge, v); return _lgCircle(kind, c[0], c[1], K.dia); });
  return [];
}

//  lgCutTemplate(key, {w, h, side, slope?, hingeEnd?}) → { w, h, outline, cuts } — מ"מ במידת החיתוך, ראשית שמאל-למטה
function lgCutTemplate(key, spec) {
  const T = LG_CUT_TEMPLATES[key];
  if (!T) throw new Error('lgCutTemplate: unknown template ' + key);
  const side = spec.side === 'right' ? 'right' : 'left', other = side === 'left' ? 'right' : 'left';
  const cuts = [];
  for (const kind of Object.keys(T)) {
    const edge = T[kind] === 'side' ? side : other;
    if (kind === 'handle') {   // ידית: בדיוק בחצי הגובה, 61 מהצלע (גם מקו נטוי)
      const y = spec.h / 2, x = _lgEdgeX(spec, edge, y) + (edge === 'left' ? 1 : -1) * LG_CUT.handle.edge;
      cuts.push(_lgCircle(kind, x, y, LG_CUT.handle.dia));
    } else for (const end of ['bottom', 'top']) cuts.push(..._lgCutAt(spec, kind, edge, end));
  }
  const outline = [[_lgEdgeX(spec, 'left', 0), 0], [_lgEdgeX(spec, 'right', 0), 0],
    [_lgEdgeX(spec, 'right', spec.h), spec.h], [_lgEdgeX(spec, 'left', spec.h), spec.h]].map(p => [_r2(p[0]), _r2(p[1])]);
  return { w: spec.w, h: spec.h, outline, cuts };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { LG_CUT, LG_HINGE_CONTOUR, LG_CUT_TEMPLATES, lgCutTemplate };
