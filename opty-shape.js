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

if (typeof module !== 'undefined' && module.exports) module.exports = { lgOptyShapeParse, lgOptyShapeSvg, lgOptyShapeDraw };
