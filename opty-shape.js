// ═══════════════════════════════════════════════════════════════════
//  opty-shape.js — הצורה כמו שהיא בנויה באופטי-ווי (בן, 16/11).
//  קובץ <מספר צורה>.dat (הקבצים שעוברים לשולחן החיתוך):
//    שורה 1: רוחב גובה · שורה 2: מספר קווי מתאר · אז 30 שורות "מקטע-ראשון מקטע-אחרון 0 0"
//    ואז מקטע בשורה, עד 999999:
//      קו:   y1 y2 0 x1 x2 1000          (רדיוס 0)
//      קשת:  cx cy r a0 a1 1000          (זווית ברדיאנים, מ-a0 אל a1 — עולה = נגד כיוון השעון)
//  המלבן רוחב×גובה הוא הזכוכית; קווי המתאר = חורים, שקעים, חיתוכים.
//  טהור: דפדפן וגם Node (scripts/test-opty-shape.js).
// ═══════════════════════════════════════════════════════════════════

//  טקסט .dat → { w, h, c: [[ [0,x1,y1,x2,y2] | [1,cx,cy,r,a0,a1] ]] } או null
function lgOptyShapeParse(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/).map(Number));
  if (lines.length < 2 || lines[0].length < 2 || !(lines[0][0] > 0) || !(lines[0][1] > 0)) return null;
  const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 10000) / 10000;
  const nC = lines[1][0] | 0;
  const ranges = lines.slice(2, 2 + 30).slice(0, nC).map(l => [l[0] | 0, l[1] | 0]);
  const segs = [];
  for (let i = 32; i < lines.length; i++) {
    const l = lines[i];
    if (l[0] >= 999999) break;
    if (l.length < 5 || l.some(v => !isFinite(v))) return null;
    segs.push(l[2] === 0 ? [0, r2(l[3]), r2(l[0]), r2(l[4]), r2(l[1])] : [1, r2(l[0]), r2(l[1]), r2(l[2]), r4(l[3]), r4(l[4])]);
  }
  const c = ranges.map(([a, b]) => segs.slice(a - 1, b)).filter(s => s.length);
  return { w: r2(lines[0][0]), h: r2(lines[0][1]), c };
}

//  geo → נתיב SVG בתוך מלבן ‎0..w × 0..h, הפוך ב-y (0 למטה, כמו באופטי-ווי)
function lgOptyShapeSvg(geo, opts) {
  if (!geo) return '';
  const o = opts || {}, W = geo.w, H = geo.h, pad = Math.max(W, H) * 0.03;
  const Y = y => +(H - y).toFixed(2), X = x => +x.toFixed(2);
  const pt = (cx, cy, r, a) => [X(cx + r * Math.cos(a)), Y(cy + r * Math.sin(a))];
  let d = '';
  (geo.c || []).forEach(segs => {
    let last = null;
    segs.forEach(s => {
      let a, b;
      if (s[0] === 0) { a = [X(s[1]), Y(s[2])]; b = [X(s[3]), Y(s[4])]; }
      else { a = pt(s[1], s[2], s[3], s[4]); b = pt(s[1], s[2], s[3], s[5]); }
      if (!last || Math.abs(last[0] - a[0]) > 0.5 || Math.abs(last[1] - a[1]) > 0.5) d += `M${a[0]} ${a[1]}`;
      if (s[0] === 0) d += `L${b[0]} ${b[1]}`;
      else {
        const sweep = s[5] - s[4], r = s[3], f = sweep > 0 ? 0 : 1;       // y הפוך → כיוון הפוך ב-SVG
        if (Math.abs(Math.abs(sweep) - 2 * Math.PI) < 0.01) {              // עיגול שלם = שני חצאים
          const m = pt(s[1], s[2], r, s[4] + sweep / 2);
          d += `A${r} ${r} 0 0 ${f} ${m[0]} ${m[1]}A${r} ${r} 0 0 ${f} ${b[0]} ${b[1]}`;
        } else d += `A${r} ${r} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${f} ${b[0]} ${b[1]}`;
      }
      last = b;
    });
  });
  const sw = Math.max(W, H) / (o.px || 160) * 1.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}"`
    + (o.cls ? ` class="${o.cls}"` : '') + ` role="img" aria-label="צורה ${W}×${H}">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${o.fill || '#eef5f8'}" stroke="currentColor" stroke-width="${sw}"/>`
    + (d ? `<path d="${d}" fill="none" stroke="${o.cut || '#c0392b'}" stroke-width="${sw * 1.4}" stroke-linecap="round" stroke-linejoin="round"/>` : '')
    + `</svg>`;
}

//  ציור על canvas בתוך תיבה (bx,by,bw,bh) — למדבקה. שחור על לבן.
function lgOptyShapeDraw(ctx, geo, bx, by, bw, bh) {
  if (!geo || !(geo.w > 0) || !(geo.h > 0)) return false;
  const s = Math.min(bw / geo.w, bh / geo.h);
  const ox = bx + (bw - geo.w * s) / 2, oy = by + (bh + geo.h * s) / 2;     // מקור למטה-שמאל
  ctx.save();
  ctx.translate(ox, oy); ctx.scale(s, -s);
  ctx.lineWidth = 3 / s; ctx.strokeStyle = '#000';
  ctx.strokeRect(0, 0, geo.w, geo.h);
  ctx.lineWidth = 4 / s;
  (geo.c || []).forEach(segs => {
    ctx.beginPath();
    segs.forEach((g, i) => {
      if (g[0] === 0) { if (i === 0) ctx.moveTo(g[1], g[2]); else ctx.lineTo(g[1], g[2]); ctx.lineTo(g[3], g[4]); }
      else {
        const sx = g[1] + g[3] * Math.cos(g[4]), sy = g[2] + g[3] * Math.sin(g[4]);
        if (i === 0) ctx.moveTo(sx, sy);
        ctx.arc(g[1], g[2], g[3], g[4], g[5], g[5] < g[4]);
      }
    });
    ctx.stroke();
  });
  ctx.restore();
  return true;
}

//  דפדפן: מדבקות עם withShape → טוען את הצורה מ-meta/optyGeo/<מספר> (נשמרה בקליטה, opty.html)
async function lgOptyLoadGeos(labels) {
  if (typeof _lgDb === 'undefined') return labels;
  const want = [...new Set((labels || []).filter(l => l && l.withShape && l.shape && !l.geo).map(l => l.shape))];
  const got = {};
  await Promise.all(want.map(s => _lgDb.ref('meta/optyGeo/' + s).once('value').then(v => { got[s] = v.val(); }).catch(() => {})));
  (labels || []).forEach(l => { if (l && l.withShape && got[l.shape]) l.geo = got[l.shape]; });
  return labels;
}

//  דפדפן: חלון "הצורה מאופטי-ווי" לפריט — תחנת הבדיקה (בן, 16/11). ציור גדול, מספר צורה,
//  פקודת חיתוך, ומדבקה רגילה / עם צורה (order-labels.js). order = הזמנה, idx = מספר הפריט.
function lgOptyShapeView(order, idx) {
  if (typeof document === 'undefined' || !order) return;
  const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
  const it = items[idx]; if (!it) return;
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let ov = document.getElementById('lgOptyView');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'lgOptyView';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:12px;';
    ov.addEventListener('click', ev => { if (ev.target === ov || ev.target.closest('[data-ov-close]')) ov.remove(); });
    document.body.appendChild(ov);
  }
  const dims = Math.round(Number(it.w) || 0) + ' × ' + Math.round(Number(it.h) || 0);
  const btn = 'min-height:48px;padding:0 16px;border-radius:8px;font:700 15px Heebo,sans-serif;cursor:pointer;border:1px solid #ccc;background:#fff;color:#222;';
  ov.innerHTML = `<div style="background:#fff;color:#222;border-radius:12px;width:100%;max-width:520px;max-height:94vh;overflow:auto;padding:16px;direction:rtl;font-family:Heebo,sans-serif;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="flex:1;font-weight:900;font-size:17px;">${e(order.orderClient || '')}${order.sketchName ? ' — ' + e(order.sketchName) : ''}</div>
      <button type="button" data-ov-close aria-label="סגור" style="${btn}min-width:48px;padding:0;">✕</button></div>
    <div style="font-size:14px;margin-bottom:4px;">${e(it.name || 'פריט')} · <b dir="ltr">${dims}</b> מ"מ</div>
    <div style="font-size:15px;font-weight:900;color:#a93226;margin-bottom:10px;">${it.optyShape ? 'צורה ' + e(it.optyShape) + (it.optyJob ? ' · פקודה ' + e(it.optyJob) : '') : 'לפריט הזה עוד אין מספר צורה מאופטי-ווי'}</div>
    <div id="lgOptyViewGeo" style="display:flex;justify-content:center;min-height:120px;align-items:center;color:#777;font-size:13px;">${it.optyShape ? 'טוען את הצורה…' : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      ${it.w && it.h ? `<button type="button" id="lgOptyLbl" style="${btn}flex:1;">🏷 מדבקה</button>` : ''}
      ${it.optyShape && it.w && it.h ? `<button type="button" id="lgOptyLblSh" style="${btn}flex:1;background:#b8922a;border-color:#b8922a;color:#fff;">🏷 מדבקה עם צורה</button>` : ''}
    </div></div>`;
  const print = withShape => { if (window.lgPrintOrderLabels) window.lgPrintOrderLabels(order, [idx], withShape ? { withShape: true } : undefined); };
  const l1 = ov.querySelector('#lgOptyLbl'), l2 = ov.querySelector('#lgOptyLblSh');
  if (l1) l1.onclick = () => print(false);
  if (l2) l2.onclick = () => print(true);
  if (it.optyShape && typeof _lgDb !== 'undefined') {
    _lgDb.ref('meta/optyGeo/' + it.optyShape).once('value').then(v => {
      const g = v.val(), box = document.getElementById('lgOptyViewGeo'); if (!box) return;
      box.innerHTML = g ? lgOptyShapeSvg(g, { px: 420 }).replace('<svg ', '<svg style="width:100%;max-height:62vh;color:#222;" ')
        : 'הציור של הצורה עוד לא נקלט — "קליטה מאופטי-ווי" עם קבצי הצורות מהדיסק-און-קי';
    }).catch(() => { const box = document.getElementById('lgOptyViewGeo'); if (box) box.textContent = 'הציור לא נטען — בדוק חיבור'; });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgOptyShapeParse, lgOptyShapeSvg, lgOptyShapeDraw };
