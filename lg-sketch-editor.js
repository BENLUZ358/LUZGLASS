// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-sketch-editor.js
//  עורך הסקיצות היחיד במערכת: תור הסקיצות, תחנת הבדיקה, השרטט.
//  אפיון: docs/superpowers/specs/2026-10-19-sketch-editor-design.md
// ════════════════════════════════════════════════════════════════════════
//
//  בן, 19/10/2026: "שמתי את המידה באמצע הזכוכית והיא יצאה מעליה"; "כל נגיעה
//  כותבת את הכתב מחדש, אי אפשר לגלול ולהגדיל"; הוא רוצה כתב שגוררים ואז נועלים.
//
//  שני חלקים בקובץ:
//    lgSketchModel — המודל. בלי DOM, נבדק ב-Node (scripts/test-sketch-editor-model.js).
//    lgSketchEditor — המסך: שכבה על כל המסך, מגע, מקלדת. משתמש במודל בלבד.
//
//  ⚠️ הכל ביחידות של **פיקסלי הסקיצה** (התמונה המקורית). כך כתב שהונח על הזכוכית
//  האמצעית נשאר עליה בכל הגדלה, אחרי סיבוב האייפד ואחרי שהמקלדת נפתחת.

(function (root) {
  'use strict';

  const FONT = '"Heebo",system-ui,-apple-system,"Segoe UI",Arial,sans-serif';
  const WORK_MIN_W = 1200;
  const MIN_S = 0.05, MAX_S = 20;
  const r1 = v => Math.round(v * 10) / 10;

  // ─── המודל ─────────────────────────────────────────────────────────────
  function lgSketchModel(opts) {
    const w = opts.w, h = opts.h;
    const layer = opts.layer && opts.layer.v === 1 ? opts.layer : null;
    const m = {
      w, h,
      view: { s: 1, x: 0, y: 0 },
      texts: layer ? (layer.texts || []).map(t => Object.assign({}, t)) : [],
      strokes: layer ? (layer.strokes || []).map(s => Object.assign({}, s, { pts: s.pts.map(p => p.slice()) })) : [],
      sel: null,
      tool: 'move',
      color: '#d62828',
    };
    let nextId = m.texts.reduce((a, t) => Math.max(a, t.id || 0), 0) + 1;
    const undoStack = [];
    const pts = new Map();
    let g = null;              // the gesture in progress
    // מה שהשתנה בלי להיכנס למחסנית הביטול (תיקון כתב, נעילה) — כדי ש"לצאת בלי לשמור?" ישאל
    const edited = new Set();
    // לחיצה כפולה נספרת רק מאצבע אחת שלא זזה (לא סוף של צביטה, לא גרירה)
    let tap = null, lastTap = null;
    const push = a => { undoStack.push(a); if (undoStack.length > 100) undoStack.shift(); };

    m.defaultTextSize = () => Math.max(18, Math.round(w * 0.035));
    m.defaultStrokeW = kind => r1(kind === 'marker' ? Math.max(14, w * 0.022) : Math.max(3, w * 0.004));

    // ── מבט: הגדלה והזזה ──
    m.fit = (W, H) => {
      const s = Math.min(W / w, H / h) * 0.94;
      m.view = { s, x: (W - w * s) / 2, y: (H - h * s) / 2 };
    };
    m.toSketch = (sx, sy) => ({ x: (sx - m.view.x) / m.view.s, y: (sy - m.view.y) / m.view.s });
    m.toScreen = (x, y) => ({ x: x * m.view.s + m.view.x, y: y * m.view.s + m.view.y });
    m.zoomAt = (f, sx, sy) => {
      const s = Math.min(MAX_S, Math.max(MIN_S, m.view.s * f)), k = s / m.view.s;
      m.view = { s, x: sx - (sx - m.view.x) * k, y: sy - (sy - m.view.y) * k };
    };
    m.panBy = (dx, dy) => { m.view = { s: m.view.s, x: m.view.x + dx, y: m.view.y + dy }; };

    // ── כתב ──
    const find = id => m.texts.find(t => t.id === id) || null;
    m.addText = at => {
      const cur = find(m.sel);
      if (cur && !cur.txt.trim()) m.commitText(cur.id);   // ＋ כתב פעמיים בלי להקליד — לא משאיר כתב שקוף
      const t = { id: nextId++, x: r1(at.x), y: r1(at.y), txt: '', size: m.defaultTextSize(), color: m.color, locked: false };
      m.texts.push(t); m.sel = t.id; push({ type: 'add', t });
      return t;
    };
    m.setText = (id, txt) => { const t = find(id); if (t && t.txt !== String(txt)) { t.txt = String(txt); edited.add(id); } };
    m.setSize = (id, size) => { const t = find(id); if (t) { t.size = Math.max(8, Math.round(size)); edited.add(id); } };
    m.setColor = (id, color) => { const t = find(id); if (t && t.color !== color) { t.color = color; edited.add(id); } };
    m.commitText = id => {
      const t = find(id);
      if (t && !t.txt.trim()) {
        // כתב ריק נעלם בלי להשאיר עקבות: לא במחסנית הביטול, ולא כ"שינוי"
        m.texts = m.texts.filter(x => x !== t); if (m.sel === id) m.sel = null;
        for (let i = undoStack.length - 1; i >= 0; i--) if (undoStack[i].t === t) undoStack.splice(i, 1);
        edited.delete(id);
        return false;
      }
      return !!t;
    };
    m.removeText = id => {
      const t = find(id); if (!t) return;
      push({ type: 'del', t, at: m.texts.indexOf(t) });
      m.texts = m.texts.filter(x => x !== t); if (m.sel === id) m.sel = null;
    };
    m.toggleLock = id => { const t = find(id); if (t) { t.locked = !t.locked; edited.add(id); } };
    m.lockAll = () => m.texts.forEach(t => { if (!t.locked) { t.locked = true; edited.add(t.id); } });
    // התיבה סביב הכתב — מעוגן במרכז
    m.textBox = (t, measure) => {
      const tw = measure(t), pad = t.size * 0.3;
      return { x: t.x - tw / 2 - pad, y: t.y - t.size * 0.62 - pad, w: tw + pad * 2, h: t.size * 1.24 + pad * 2 };
    };
    m.hitText = (x, y, measure) => {
      for (let i = m.texts.length - 1; i >= 0; i--) {
        const b = m.textBox(m.texts[i], measure);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return m.texts[i];
      }
      return null;
    };
    const handleR = () => 26 / m.view.s;
    m.hitLockHandle = (t, x, y, measure) => {
      const b = m.textBox(t, measure);
      return Math.hypot(x - (b.x + b.w), y - b.y) <= handleR();
    };

    // ── מחיקת קו שלם ──
    // מרחק לקו כולו — לא רק לנקודות שנדגמו. קו ישר ארוך נדגם בשתי נקודות בלבד,
    // ונגיעה באמצעו פספסה אותו.
    function distToLine(p, pts) {
      let best = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[i + 1] || pts[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        const u = L ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L)) : 0;
        best = Math.min(best, Math.hypot(p.x - (a[0] + u * dx), p.y - (a[1] + u * dy)));
      }
      return best;
    }
    function eraseAt(p) {
      const R = 18 / m.view.s;
      for (let i = m.strokes.length - 1; i >= 0; i--) {
        const st = m.strokes[i];
        if (distToLine(p, st.pts) < R + st.w / 2) {
          push({ type: 'erase', st, at: i }); m.strokes.splice(i, 1); return true;
        }
      }
      return false;
    }

    // ── מגע: שתי אצבעות = הגדלה והזזה, תמיד. אצבע אחת — לפי מה שמתחתיה והכלי. ──
    m.pointerDown = (id, sx, sy, measure) => {
      pts.set(id, { x: sx, y: sy });
      if (pts.size === 1) tap = { x: sx, y: sy, id: null };
      else tap = null;                                   // שתי אצבעות — זו לא לחיצה
      if (pts.size === 2) {
        if (g && g.type === 'draw') m.strokes.pop();               // אצבע שנייה מבטלת קו שהתחיל
        if (g && g.type === 'drag') { g.t.x = g.from.x; g.t.y = g.from.y; }
        const [a, b] = [...pts.values()];
        g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: Object.assign({}, m.view) };
        return;
      }
      if (pts.size > 2) return;
      const p = m.toSketch(sx, sy);
      const sel = find(m.sel);
      if (sel && measure && m.hitLockHandle(sel, p.x, p.y, measure)) { m.toggleLock(sel.id); g = { type: 'none' }; return; }
      const t = measure ? m.hitText(p.x, p.y, measure) : null;
      if (tap) tap.id = t ? t.id : null;
      if (t) {
        m.sel = t.id;
        g = t.locked ? { type: 'pan', x0: sx, y0: sy, v0: Object.assign({}, m.view) }
                     : { type: 'drag', t, dx: p.x - t.x, dy: p.y - t.y, from: { x: t.x, y: t.y } };
        return;
      }
      m.sel = null;
      if (m.tool === 'pen' || m.tool === 'marker') {
        const st = { kind: m.tool, color: m.tool === 'marker' ? '#ffd400' : m.color, w: m.defaultStrokeW(m.tool), pts: [[r1(p.x), r1(p.y)]] };
        m.strokes.push(st); g = { type: 'draw', st };
      } else if (m.tool === 'erase') {
        eraseAt(p); g = { type: 'erase' };
      } else {
        g = { type: 'pan', x0: sx, y0: sy, v0: Object.assign({}, m.view) };
      }
    };
    m.pointerMove = (id, sx, sy) => {
      if (!pts.has(id)) return;
      pts.set(id, { x: sx, y: sy });
      if (tap && Math.hypot(sx - tap.x, sy - tap.y) > 8) tap = null;   // זזה — זו לא לחיצה
      if (!g) return;
      if (g.type === 'pinch') {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = Math.min(MAX_S, Math.max(MIN_S, g.v0.s * d / g.d0)), k = s / g.v0.s;
        m.view = { s, x: mid.x - (g.m0.x - g.v0.x) * k, y: mid.y - (g.m0.y - g.v0.y) * k };
        return;
      }
      const p = m.toSketch(sx, sy);
      if (g.type === 'drag') { g.t.x = r1(p.x - g.dx); g.t.y = r1(p.y - g.dy); }
      else if (g.type === 'draw') g.st.pts.push([r1(p.x), r1(p.y)]);
      else if (g.type === 'erase') eraseAt(p);
      else if (g.type === 'pan') m.view = { s: g.v0.s, x: g.v0.x + sx - g.x0, y: g.v0.y + sy - g.y0 };
    };
    m.pointerUp = id => {
      pts.delete(id);
      if (!pts.size) { lastTap = tap ? tap.id : null; tap = null; }
      if (!g) return;
      if (g.type === 'pinch') { if (pts.size < 2) g = pts.size ? { type: 'none' } : null; return; }
      if (pts.size) return;
      if (g.type === 'draw') { if (g.st.pts.length > 1) push({ type: 'stroke', st: g.st }); else m.strokes.pop(); }
      if (g.type === 'drag' && (g.t.x !== g.from.x || g.t.y !== g.from.y))
        push({ type: 'move', t: g.t, from: g.from, to: { x: g.t.x, y: g.t.y } });
      g = null;
    };
    // המערכת לקחה את המגע (iPad): קו באמצע לא נשמר
    m.pointerCancel = id => {
      if (g && g.type === 'draw') { m.strokes.pop(); g = null; }
      tap = null;
      m.pointerUp(id);
      lastTap = null;
    };
    m.lastTap = () => lastTap;
    m.busy = () => !!g;

    m.undo = () => {
      const a = undoStack.pop(); if (!a) return false;
      if (a.type === 'stroke') m.strokes = m.strokes.filter(s => s !== a.st);
      if (a.type === 'erase') m.strokes.splice(a.at, 0, a.st);
      if (a.type === 'add') m.texts = m.texts.filter(t => t !== a.t);
      if (a.type === 'del') m.texts.splice(a.at, 0, a.t);
      if (a.type === 'move') { a.t.x = a.from.x; a.t.y = a.from.y; }
      m.sel = null;
      return true;
    };
    m.canUndo = () => undoStack.length > 0;
    m.dirty = () => undoStack.length > 0 || edited.size > 0;

    // ── שכבה: כדי לערוך שוב מחר ──
    m.toLayer = sig => ({
      v: 1, w, h, sig: String(sig || ''),
      texts: m.texts.filter(t => t.txt.trim()).map(t => ({ id: t.id, x: t.x, y: t.y, txt: t.txt, size: t.size, color: t.color, locked: t.locked })),
      strokes: m.strokes.map(s => ({ kind: s.kind, color: s.color, w: s.w, pts: s.pts.map(p => p.slice()) })),
    });

    // ── ציור — בקואורדינטות הסקיצה; הקורא קובע את ההגדלה ──
    m.draw = (ctx, base, measure, opts) => {
      const clean = opts && opts.clean;                     // למיזוג: בלי מסגרת בחירה
      if (base) ctx.drawImage(base, 0, 0, w, h);
      m.strokes.forEach(st => {
        ctx.save();
        ctx.strokeStyle = st.color; ctx.lineWidth = st.w; ctx.lineJoin = 'round';
        ctx.lineCap = st.kind === 'marker' ? 'butt' : 'round';
        if (st.kind === 'marker') ctx.globalAlpha = 0.35;
        ctx.beginPath();
        st.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] + 0.1, st.pts[0][1]);
        ctx.stroke();
        ctx.restore();
      });
      m.texts.forEach(t => {
        if (!t.txt) return;
        ctx.save();
        ctx.font = '800 ' + t.size + 'px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, t.size * 0.16); ctx.strokeStyle = 'rgba(251,249,245,0.92)';
        ctx.strokeText(t.txt, t.x, t.y);
        ctx.fillStyle = t.color; ctx.fillText(t.txt, t.x, t.y);
        ctx.restore();
      });
      if (clean) return;
      const t = find(m.sel);
      if (t && measure) {
        const b = m.textBox(t, measure), s = m.view.s || 1;
        ctx.save();
        ctx.setLineDash([8 / s, 6 / s]); ctx.strokeStyle = '#2f8cff'; ctx.lineWidth = 2.5 / s;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
        ctx.fillStyle = t.locked ? '#b8922a' : '#2f8cff';
        ctx.beginPath(); ctx.arc(b.x + b.w, b.y, 20 / s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + (18 / s) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.locked ? '🔒' : '✥', b.x + b.w, b.y + 1 / s);
        ctx.restore();
      }
    };

    return m;
  }

  // ─── טביעה: האם הסקיצה שנשמרת היום היא עדיין זו שהעורך שמר? ─────────────
  //  אורך + FNV-1a על כל תו 97. זול, ומספיק כדי לזהות שהלקוח שלח תמונה אחרת.
  function lgSketchSig(src) {
    const s = String(src || '');
    if (!s) return '';
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 97) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length + ':' + h.toString(16);
  }

  // ─── מיזוג: התמונה שנשמרת היא מה שהיה על המסך ─────────────────────────────
  //  output: {mime, minW?, maxW?, maxB64?} — כל דף שומר בגודל ובפורמט שהוא שומר היום.
  function lgSketchMerge(img, model, output, makeCanvas) {
    const o = output || {};
    // ברירת המחדל: משטח העבודה (לפחות 1200). fromNatural: מהתמונה עצמה — השרטט שומר
    // max(טבעי, 600) כמו תמיד, כי _editedSketch יושב בתוך orders ונטען בכל מסך.
    let W = o.fromNatural ? (img.naturalWidth || model.w) : model.w;
    if (o.minW) W = Math.max(W, o.minW);
    if (o.maxW) W = Math.min(W, o.maxW);
    W = Math.round(W);
    const k = W / model.w, H = Math.round(model.h * k);
    const cv = makeCanvas ? makeCanvas(W, H)
      : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.save(); c.scale(k, k); model.draw(c, img, null, { clean: true }); c.restore();
    if (o.mime === 'image/png') return cv.toDataURL('image/png');
    const max = o.maxB64 || 6.5 * 1024 * 1024;
    let q = o.q0 || 0.92, out = cv.toDataURL('image/jpeg', q);
    while (out.length > max && q > 0.3) { q = Math.round((q - 0.1) * 100) / 100; out = cv.toDataURL('image/jpeg', q); }
    return out;
  }

  // ─── המסך ─────────────────────────────────────────────────────────────
  const CSS = `
.lg-se{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;background:#16181c;color:#eef0f3;
  font-family:${FONT};direction:rtl;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.lg-se-top{display:flex;align-items:center;gap:10px;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top,0px));background:#1f2329}
.lg-se-title{flex:1;min-width:0;font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lg-se-stage{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none}
.lg-se-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.lg-se-hint{position:absolute;inset-inline:12px;top:10px;display:flex;justify-content:center;pointer-events:none}
.lg-se-hint span{background:rgba(22,24,28,.88);border:1px solid #2a2f37;padding:7px 14px;border-radius:999px;font-size:14px;font-weight:600}
.lg-se-rail{display:flex;gap:8px;padding:8px 10px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));background:#1f2329;overflow-x:auto}
.lg-se-btn{flex:0 0 auto;min-width:64px;min-height:56px;padding:4px 12px;border-radius:12px;border:1px solid #2a2f37;background:#2a2f37;color:#eef0f3;
  font:600 14px/1.15 ${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer}
.lg-se-btn b{font-size:20px;line-height:1}
.lg-se-btn[aria-pressed="true"]{background:#b8922a;border-color:#b8922a;color:#1b1608}
.lg-se-btn.add{background:#2f8cff;border-color:#2f8cff;color:#fff}
.lg-se-btn.save{background:#b8922a;border-color:#b8922a;color:#1b1608}
.lg-se-btn:disabled{opacity:.45}
.lg-se-sep{flex:0 0 1px;background:#2a2f37;margin:6px 2px}
.lg-se-sheet{position:absolute;inset-inline:0;bottom:0;z-index:2;background:#1f2329;border-top:1px solid #2a2f37;padding:10px 12px;
  display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lg-se-sheet[hidden]{display:none}
.lg-se-sheet input{flex:1 1 200px;min-width:0;min-height:52px;font:700 20px ${FONT};border-radius:12px;border:2px solid #2f8cff;
  background:#fbf9f5;color:#1a1714;padding:0 14px;-webkit-user-select:text;user-select:text}
.lg-se-sheet button{min-height:52px;min-width:52px;border-radius:12px;border:1px solid #2a2f37;background:#2a2f37;color:#eef0f3;font:700 16px ${FONT};padding:0 12px;cursor:pointer}
.lg-se-sheet .done{background:#b8922a;border-color:#b8922a;color:#1b1608}
.lg-se-sheet .del{color:#ff8a7a}
.lg-se-sw{width:44px!important;min-width:44px!important;height:44px;min-height:44px!important;padding:0!important;border-radius:50%!important;border:3px solid transparent!important}
.lg-se-sw[aria-pressed="true"]{border-color:#eef0f3!important}
.lg-se-ask{position:absolute;inset:0;z-index:3;background:rgba(10,11,13,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.lg-se-ask div{background:#1f2329;border:1px solid #2a2f37;border-radius:16px;padding:18px;max-width:360px;display:flex;flex-direction:column;gap:12px}
.lg-se-ask p{margin:0;font-size:17px;font-weight:700}
.lg-se-ask .row{flex-direction:row;padding:0;border:0;display:flex;gap:8px}
.lg-se-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:#fbf9f5;color:#1a1714;font-weight:700;
  padding:9px 16px;border-radius:12px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:4}
.lg-se-toast.on{opacity:1}
.lg-se :focus-visible{outline:3px solid #2f8cff;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.lg-se-toast{transition:none}}`;

  const HINTS = {
    move: 'אצבע אחת מזיזה · שתי אצבעות מגדילות',
    pen: 'עט · שתי אצבעות עדיין מגדילות ומזיזות',
    marker: 'מרקר שקוף · מדגיש בלי להסתיר',
    erase: 'נוגעים בקו כדי למחוק אותו',
  };

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    if (html != null) e.innerHTML = html;
    return e;
  }

  //  opts: {title, baseSrc, layer, output, onSave({mergedSrc, layer, baseSrc}), onClose}
  function open(opts) {
    if (document.querySelector('.lg-se')) return null;   // ✎ פעמיים בזמן טעינה — עורך אחד בלבד
    if (!document.getElementById('lgSeCss')) {
      const st = el('style', { id: 'lgSeCss' }); st.textContent = CSS; document.head.appendChild(st);
    }
    const ov = el('div', { class: 'lg-se', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'עריכת סקיצה' });
    ov.innerHTML = `
      <div class="lg-se-top">
        <div class="lg-se-title"></div>
        <button type="button" class="lg-se-btn" data-act="cancel"><b>✕</b>ביטול</button>
        <button type="button" class="lg-se-btn save" data-act="save"><b>✓</b>שמור</button>
      </div>
      <div class="lg-se-stage">
        <canvas></canvas>
        <div class="lg-se-hint"><span>טוען…</span></div>
        <div class="lg-se-sheet" hidden>
          <input type="text" inputmode="text" enterkeyhint="done" autocomplete="off" maxlength="60" placeholder="מה לכתוב? למשל 1200" aria-label="הכתב">
          <button type="button" data-act="smaller" aria-label="הקטן כתב">A−</button>
          <button type="button" data-act="bigger" aria-label="הגדל כתב">A+</button>
          <button type="button" class="lg-se-sw" data-color="#d62828" style="background:#d62828" aria-label="אדום" aria-pressed="true"></button>
          <button type="button" class="lg-se-sw" data-color="#1d4ed8" style="background:#1d4ed8" aria-label="כחול" aria-pressed="false"></button>
          <button type="button" class="lg-se-sw" data-color="#111111" style="background:#111111" aria-label="שחור" aria-pressed="false"></button>
          <button type="button" class="del" data-act="delText">מחק</button>
          <button type="button" class="done" data-act="doneText">סיום ⌄</button>
        </div>
        <div class="lg-se-toast"></div>
      </div>
      <div class="lg-se-rail">
        <button type="button" class="lg-se-btn add" data-act="addText"><b>＋</b>＋ כתב</button>
        <span class="lg-se-sep"></span>
        <button type="button" class="lg-se-btn" data-tool="move" aria-pressed="true"><b>✋</b>הזזה</button>
        <button type="button" class="lg-se-btn" data-tool="pen" aria-pressed="false"><b>✎</b>עט</button>
        <button type="button" class="lg-se-btn" data-tool="marker" aria-pressed="false"><b>▬</b>מרקר</button>
        <button type="button" class="lg-se-btn" data-tool="erase" aria-pressed="false"><b>⌫</b>מחק קו</button>
        <span class="lg-se-sep"></span>
        <button type="button" class="lg-se-btn" data-act="undo"><b>↶</b>בטל</button>
        <button type="button" class="lg-se-btn" data-act="fit"><b>⤢</b>התאם</button>
        <button type="button" class="lg-se-btn" data-act="lockAll"><b>🔒</b>נעל הכל</button>
      </div>`;
    ov.querySelector('[data-act="addText"]').innerHTML = '<b>＋</b>כתב';   // the label reads "＋ כתב" as one control
    ov.querySelector('.lg-se-title').textContent = opts.title || 'עריכת סקיצה';
    document.body.appendChild(ov);

    const stage = ov.querySelector('.lg-se-stage'), cv = ov.querySelector('canvas'), cx = cv.getContext('2d');
    const sheet = ov.querySelector('.lg-se-sheet'), input = sheet.querySelector('input');
    const hintEl = ov.querySelector('.lg-se-hint span'), toastEl = ov.querySelector('.lg-se-toast');
    let model = null, img = null, closed = false, saving = false, lastTap = { t: 0, id: null };
    const hint = s => { hintEl.textContent = s; };
    let tt; const toast = s => { toastEl.textContent = s; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('on'), 1700); };
    const measure = t => { cx.save(); cx.font = '800 ' + t.size + 'px ' + FONT; const w = cx.measureText(t.txt || ' ').width; cx.restore(); return w; };

    function size() {
      const r = stage.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
      return r;
    }
    function render() {
      if (!model) return;
      const d = window.devicePixelRatio || 1;
      cx.setTransform(d, 0, 0, d, 0, 0);
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.save(); cx.translate(model.view.x, model.view.y); cx.scale(model.view.s, model.view.s);
      cx.shadowColor = 'rgba(0,0,0,.45)'; cx.shadowBlur = 20 / model.view.s;
      cx.drawImage(img, 0, 0, model.w, model.h); cx.shadowBlur = 0;
      model.draw(cx, null, measure);
      cx.restore();
      ov.querySelector('[data-act="undo"]').disabled = !model.canUndo();
    }
    // מקלדת שנפתחת, סיבוב, שינוי חלון: רק המשטח מתכייל. האובייקטים ביחידות הסקיצה — לא זזים עליה.
    const ro = new ResizeObserver(() => { size(); render(); });
    ro.observe(stage);
    const onVV = () => { size(); render(); };
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onVV);

    img = new Image();
    img.onload = () => {
      // משטח עבודה ברוחב 1200 לפחות. SVG בלי מידות (השרטוט שהשרטט מייצר כשאין תמונה)
      // מדווח 200×150 או 0, ותמונה קטנה הייתה נשמרת קטנה. התמונה מצוירת מוגדלת — היחס נשמר.
      const nat = img.naturalWidth || 0;
      const W = Math.max(nat, WORK_MIN_W), H = nat && img.naturalHeight ? Math.round(W * img.naturalHeight / nat) : Math.round(W * 0.75);
      const lay = opts.layer && opts.layer.w === W && opts.layer.h === H ? opts.layer : null;
      model = lgSketchModel({ w: W, h: H, layer: lay });
      const r = size(); model.fit(r.width, r.height); render();
      hint(lay && lay.texts && lay.texts.length ? 'הכתב מהפעם הקודמת עדיין זז · לחיצה כפולה לעריכה' : '＋ כתב להוספת מידה · שתי אצבעות להגדלה');
    };
    img.onerror = () => { hint('לא הצלחתי לטעון את הסקיצה'); };
    img.src = opts.baseSrc;

    // ── כתב ──
    const current = () => model && model.texts.find(t => t.id === model.sel);
    function openSheet(t) {
      sheet.hidden = false; input.value = t.txt;
      sheet.querySelectorAll('.lg-se-sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === t.color)));
      // בתוך הלחיצה עצמה — iPad פותח מקלדת רק למיקוד שקורה בתוך מגע של המשתמש
      input.focus(); input.select();
    }
    function closeSheet() {
      if (sheet.hidden) return;
      const t = current();
      input.blur(); sheet.hidden = true;
      if (t && !model.commitText(t.id)) { render(); return; }
      if (t) hint('גוררים את הכתב למקום · לחיצה על ✥ נועלת');
      render();
    }
    input.addEventListener('input', () => { const t = current(); if (t) { model.setText(t.id, input.value); render(); } });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closeSheet(); } e.stopPropagation(); });

    // ── מגע ──
    cv.addEventListener('pointerdown', e => {
      if (!model) return;
      if (!sheet.hidden) closeSheet();                      // נגיעה בסקיצה סוגרת את המקלדת
      cv.setPointerCapture(e.pointerId);
      model.pointerDown(e.pointerId, e.offsetX, e.offsetY, measure);
      render();
    });
    cv.addEventListener('pointermove', e => { if (model) { model.pointerMove(e.pointerId, e.offsetX, e.offsetY); if (model.busy()) render(); } });
    const up = e => {
      if (!model) return;
      model.pointerUp(e.pointerId); render();
      // לחיצה כפולה על כתב — עריכה. רק לחיצה של אצבע אחת שלא זזה (המודל יודע).
      const id = model.lastTap(), now = Date.now();
      const t = id != null ? model.texts.find(x => x.id === id) : null;
      if (t && lastTap.id === t.id && now - lastTap.t < 350) { model.sel = t.id; openSheet(t); lastTap = { t: 0, id: null }; render(); }
      else lastTap = { t: now, id: t ? t.id : null };
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => { if (model) { model.pointerCancel(e.pointerId); render(); } });
    cv.addEventListener('wheel', e => {                       // מחשב: גלגלת מגדילה סביב העכבר
      if (!model) return; e.preventDefault();
      model.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); render();
    }, { passive: false });

    // ── כפתורים ──
    function setTool(t) {
      model && (model.tool = t);
      ov.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      hint(HINTS[t]);
    }
    ov.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    const act = {
      addText() {
        if (!model) return;
        closeSheet();
        const r = stage.getBoundingClientRect();
        const t = model.addText(model.toSketch(r.width / 2, r.height * 0.42));   // במרכז מה שרואים
        openSheet(t); render(); hint('מקלידים · סיום · ואז גוררים למקום');
      },
      doneText: closeSheet,
      delText() { const t = current(); if (t) { model.removeText(t.id); } sheet.hidden = true; input.blur(); render(); toast('הכתב נמחק'); },
      bigger() { const t = current(); if (t) { model.setSize(t.id, t.size * 1.2); render(); } },
      smaller() { const t = current(); if (t) { model.setSize(t.id, t.size / 1.2); render(); } },
      undo() { closeSheet(); if (model && model.undo()) render(); },
      fit() { if (model) { const r = stage.getBoundingClientRect(); model.fit(r.width, r.height); render(); } },
      lockAll() { if (model) { closeSheet(); model.lockAll(); render(); toast('כל הכתבים ננעלו'); } },
      cancel() { if (model && model.dirty()) ask(); else close(); },
      save,
    };
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (b && act[b.dataset.act]) act[b.dataset.act]();
      const sw = e.target.closest('.lg-se-sw');
      if (sw) {
        model && (model.color = sw.dataset.color);
        sheet.querySelectorAll('.lg-se-sw').forEach(x => x.setAttribute('aria-pressed', String(x === sw)));
        const t = current(); if (t) { model.setColor(t.id, sw.dataset.color); render(); }
      }
    });
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (ov.querySelector('.lg-se-ask')) { ov.querySelector('.lg-se-ask').remove(); return; }
      if (!sheet.hidden) closeSheet(); else act.cancel();
    };
    document.addEventListener('keydown', onKey);

    function ask() {
      const a = el('div', { class: 'lg-se-ask' }, `<div><p>לצאת בלי לשמור את השינויים?</p>
        <div class="row"><button type="button" class="lg-se-btn" data-ask="stay">להישאר</button>
        <button type="button" class="lg-se-btn" data-ask="leave">לצאת בלי לשמור</button></div></div>`);
      a.addEventListener('click', e => {
        const b = e.target.closest('[data-ask]'); if (!b) return;
        a.remove(); if (b.dataset.ask === 'leave') close();
      });
      stage.appendChild(a);
    }

    async function save() {
      if (!model || saving) return;
      closeSheet();
      saving = true; const btn = ov.querySelector('[data-act="save"]'); btn.disabled = true;
      try {
        const mergedSrc = lgSketchMerge(img, model, opts.output);
        const layer = model.toLayer(lgSketchSig(mergedSrc));
        await opts.onSave({ mergedSrc, layer, baseSrc: opts.baseSrc });
        close();
      } catch (e) {
        console.error('lgSketchEditor save:', e);
        toast('השמירה נכשלה — נסה שוב');
        saving = false; btn.disabled = false;
      }
    }
    function close() {
      if (closed) return; closed = true;
      ro.disconnect();
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onVV);
      document.removeEventListener('keydown', onKey);
      ov.remove();
      if (opts.onClose) opts.onClose();
    }
    return { close };
  }

  const lgSketchEditor = { open };

  root.lgSketchModel = lgSketchModel;
  root.lgSketchSig = lgSketchSig;
  root.lgSketchMerge = lgSketchMerge;
  root.lgSketchEditor = lgSketchEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = { lgSketchModel, lgSketchSig, lgSketchMerge, lgSketchEditor };
})(typeof window !== 'undefined' ? window : this);
