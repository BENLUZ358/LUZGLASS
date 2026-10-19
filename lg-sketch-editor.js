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
      const t = { id: nextId++, x: r1(at.x), y: r1(at.y), txt: '', size: m.defaultTextSize(), color: m.color, locked: false };
      m.texts.push(t); m.sel = t.id; push({ type: 'add', t });
      return t;
    };
    m.setText = (id, txt) => { const t = find(id); if (t) t.txt = String(txt); };
    m.setSize = (id, size) => { const t = find(id); if (t) t.size = Math.max(8, Math.round(size)); };
    m.setColor = (id, color) => { const t = find(id); if (t) t.color = color; };
    m.commitText = id => {
      const t = find(id);
      if (t && !t.txt.trim()) { m.texts = m.texts.filter(x => x !== t); if (m.sel === id) m.sel = null; return false; }
      return !!t;
    };
    m.removeText = id => {
      const t = find(id); if (!t) return;
      push({ type: 'del', t, at: m.texts.indexOf(t) });
      m.texts = m.texts.filter(x => x !== t); if (m.sel === id) m.sel = null;
    };
    m.toggleLock = id => { const t = find(id); if (t) t.locked = !t.locked; };
    m.lockAll = () => m.texts.forEach(t => { t.locked = true; });
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
      if (!g) return;
      if (g.type === 'pinch') { if (pts.size < 2) g = pts.size ? { type: 'none' } : null; return; }
      if (pts.size) return;
      if (g.type === 'draw') { if (g.st.pts.length > 1) push({ type: 'stroke', st: g.st }); else m.strokes.pop(); }
      if (g.type === 'drag' && (g.t.x !== g.from.x || g.t.y !== g.from.y))
        push({ type: 'move', t: g.t, from: g.from, to: { x: g.t.x, y: g.t.y } });
      g = null;
    };
    m.pointerCancel = id => m.pointerUp(id);
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
    m.dirty = () => undoStack.length > 0;

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

  root.lgSketchModel = lgSketchModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = { lgSketchModel };
})(typeof window !== 'undefined' ? window : this);
