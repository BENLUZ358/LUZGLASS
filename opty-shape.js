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

//  מידות לכל דבר בצורה (בן, 16/11: "שייראו בדיוק את הנתונים") — כל קו מתאר הופך לפריט עם מספר:
//    חור (עיגול שלם): קוטר + מרכז מהקצוות הקרובים · פינה מעוגלת: רדיוס + איזו פינה
//    חריץ (קו פתוח שיוצא מקצה אחד): מאיזה צד, עומק, רוחב, ומרחק מהקצה הקרוב
//    חיתוך פינה (קו פתוח בין שני קצוות): רוחב × גובה מהפינה · שקע (כל השאר): גודל + מרחק מהקצוות
//  הכל במסגרת של אופטי-ווי (המידה שם, לרוב שלנו +2), מהקצה הקרוב — "מלמטה/מלמעלה", "משמאל/מימין".
const LG_OPTY_EDGE = 12;     // נקודת קצה של חריץ עד 12 מ"מ מקצה הזכוכית = יוצא מהקצה (צירים מתחילים ב-10)
function lgOptyFeatures(geo) {
  if (!geo || !(geo.w > 0) || !(geo.h > 0)) return [];
  const W = geo.w, H = geo.h, TAU = 2 * Math.PI;
  const n1 = v => String(Math.round(v * 10) / 10);
  const fx = x => x <= W - x ? [x, 'משמאל'] : [W - x, 'מימין'];
  const fy = y => y <= H - y ? [y, 'מלמטה'] : [H - y, 'מלמעלה'];
  const ends = s => s[0] === 0 ? [[s[1], s[2]], [s[3], s[4]]]
    : [[s[1] + s[3] * Math.cos(s[4]), s[2] + s[3] * Math.sin(s[4])], [s[1] + s[3] * Math.cos(s[5]), s[2] + s[3] * Math.sin(s[5])]];
  const edgeOf = p => { const d = [[p[0], 'L'], [W - p[0], 'R'], [p[1], 'B'], [H - p[1], 'T']].sort((a, b) => a[0] - b[0])[0]; return d[0] <= LG_OPTY_EDGE ? d[1] : ''; };
  const SIDE = { L: 'משמאל', R: 'מימין', B: 'מלמטה', T: 'מלמעלה' };
  const corner = (x, y) => (x < W / 2 ? 'שמאל' : 'ימין') + ' ' + (y < H / 2 ? 'למטה' : 'למעלה');
  const out = [];
  (geo.c || []).forEach(segs => {
    if (!segs || !segs.length) return;
    //  תיבה סביב הקו: קצוות + נקודות לאורך כל קשת
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    segs.forEach(s => {
      if (s[0] === 0) { add(s[1], s[2]); add(s[3], s[4]); return; }
      const sw = s[5] - s[4], k = Math.max(8, Math.ceil(Math.abs(sw) / 0.05));
      for (let i = 0; i <= k; i++) { const a = s[4] + sw * i / k; add(s[1] + s[3] * Math.cos(a), s[2] + s[3] * Math.sin(a)); }
    });
    const r2 = v => Math.round(v * 100) / 100;
    const box = { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) };
    const f = { n: out.length + 1, box };
    const s0 = segs[0];
    const first = ends(s0)[0], last = ends(segs[segs.length - 1])[1];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5;
    if (segs.length === 1 && s0[0] === 1 && Math.abs(Math.abs(s0[5] - s0[4]) - TAU) < 0.01) {
      const [dx, sx] = fx(s0[1]), [dy, sy] = fy(s0[2]);
      Object.assign(f, { kind: 'hole', d: r2(s0[3] * 2), cx: s0[1], cy: s0[2],
        text: `חור Ø${n1(s0[3] * 2)} · ${n1(dx)} ${sx} · ${n1(dy)} ${sy}` });
    } else if (segs.length === 1 && s0[0] === 1 && edgeOf(first) && edgeOf(last) && edgeOf(first) !== edgeOf(last)) {
      Object.assign(f, { kind: 'corner', r: s0[3], text: `פינה מעוגלת R${n1(s0[3])} · ${corner(s0[1], s0[2])}` });
    } else if (!closed && edgeOf(first) && edgeOf(last) && edgeOf(first) !== edgeOf(last)) {
      const cx = edgeOf(first) === 'L' || edgeOf(last) === 'L' ? 0 : W, cy = edgeOf(first) === 'B' || edgeOf(last) === 'B' ? 0 : H;
      const ww = cx === 0 ? x1 : W - x0, hh = cy === 0 ? y1 : H - y0;
      Object.assign(f, { kind: 'cornercut', text: `חיתוך פינה ${corner(cx, cy)} · ${n1(ww)} × ${n1(hh)}` });
    } else if (!closed && edgeOf(first) && edgeOf(first) === edgeOf(last)) {
      const e = edgeOf(first), vert = e === 'L' || e === 'R';
      const depth = e === 'L' ? x1 : e === 'R' ? W - x0 : e === 'B' ? y1 : H - y0;
      const width = vert ? y1 - y0 : x1 - x0;
      const [dp, sp] = vert ? fy(y0 + (y1 - y0) / 2 <= H / 2 ? y0 : y1) : fx(x0 + (x1 - x0) / 2 <= W / 2 ? x0 : x1);
      Object.assign(f, { kind: 'notch', side: e, text: `חריץ ${SIDE[e]} · עומק ${n1(depth)} · רוחב ${n1(width)} · ${n1(dp)} ${sp}` });
    } else {
      const [dx, sx] = fx((x0 + x1) / 2 <= W / 2 ? x0 : x1), [dy, sy] = fy((y0 + y1) / 2 <= H / 2 ? y0 : y1);
      Object.assign(f, { kind: 'cut', text: `שקע ${n1(x1 - x0)} × ${n1(y1 - y0)} · ${n1(dx)} ${sx} · ${n1(dy)} ${sy}` });
    }
    out.push(f);
  });
  return out;
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
  //  dims: מידה כוללת (רוחב למטה, גובה משמאל) + עיגול ממוספר על כל פריט — הטבלה מתחת (lgOptyFeatures)
  let dims = '', vb = [-pad, -pad, W + 2 * pad, H + 2 * pad];
  if (o.dims) {
    const fs = +(Math.max(W, H) * 0.034).toFixed(1), g = fs * 1.2, t = fs * 0.35;
    const ln = (a, b, c, e) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${e}"/>`;
    const yb = H + g;                                   // קו הרוחב מתחת לזכוכית
    dims += `<g stroke="#555" stroke-width="${sw * 0.7}" fill="none">`
      + ln(0, H + t, 0, yb + t) + ln(W, H + t, W, yb + t) + ln(0, yb, W, yb)
      + ln(-t, 0, -g - t, 0) + ln(-t, H, -g - t, H) + ln(-g, 0, -g, H) + `</g>`
      + `<g fill="#222" font-family="Heebo,Arial,sans-serif" font-weight="700" font-size="${fs}" text-anchor="middle">`
      + `<text x="${W / 2}" y="${yb + fs * 1.05}">${W}</text>`
      + `<text transform="translate(${-g - fs * 0.35} ${H / 2}) rotate(-90)">${H}</text></g>`;
    //  העיגול ליד הפריט, לכיוון פנים הזכוכית (לא עליו); אם נוגע בעיגול קודם — זז עוד פנימה
    const r = fs * 0.55, placed = [];
    lgOptyFeatures(geo).forEach(f => {
      const left = f.box.x + f.box.w / 2 <= W / 2, step = (left ? 1 : -1) * r * 2.3;
      let tx = left ? f.box.x + f.box.w + r * 1.4 : f.box.x - r * 1.4;
      const ty = f.box.y + f.box.h / 2;
      if (f.kind === 'cornercut') tx = f.box.x + f.box.w / 2;
      for (let k = 0; k < 6 && placed.some(p => Math.hypot(p[0] - tx, p[1] - ty) < r * 2.1); k++) tx += step;
      tx = Math.min(W - r, Math.max(r, tx)); placed.push([tx, ty]);
      const cx = X(tx), cy = Y(ty);
      dims += `<g class="lg-opty-tag"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#a93226" stroke="#fff" stroke-width="${sw * 0.6}"/>`
        + `<text x="${cx}" y="${+(cy + fs * 0.3).toFixed(2)}" fill="#fff" font-family="Heebo,Arial,sans-serif" font-weight="900" font-size="${fs * 0.8}" text-anchor="middle">${f.n}</text></g>`;
    });
    vb = [-pad - g - fs, -pad, W + 2 * pad + g + fs, H + 2 * pad + g + fs * 1.2];
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(v => +v.toFixed(2)).join(' ')}"`
    + (o.cls ? ` class="${o.cls}"` : '') + ` role="img" aria-label="צורה ${W}×${H}">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${o.fill || '#eef5f8'}" stroke="currentColor" stroke-width="${sw}"/>`
    + (d ? `<path d="${d}" fill="none" stroke="${o.cut || '#c0392b'}" stroke-width="${sw * 1.4}" stroke-linecap="round" stroke-linejoin="round"/>` : '')
    + dims + `</svg>`;
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
      const fl = g ? lgOptyFeatures(g) : [];
      box.style.display = 'block';
      box.innerHTML = g ? `<div style="display:flex;justify-content:center;">${lgOptyShapeSvg(g, { px: 420, dims: true }).replace('<svg ', '<svg style="width:100%;max-height:58vh;color:#222;" ')}</div>`
        + `<div style="font-size:12px;color:#666;margin:6px 0 4px;">מידות מאופטי-ווי: <b dir="ltr">${e(g.w)} × ${e(g.h)}</b> · כל מרחק נמדד מהקצה הקרוב</div>`
        + (fl.length ? `<ol class="lg-opty-feats" style="margin:0;padding:0;list-style:none;display:grid;gap:4px;">`
          + fl.map(f => `<li style="display:flex;gap:8px;align-items:center;font-size:15px;color:#222;padding:6px 8px;background:#f6f6f6;border-radius:6px;">`
            + `<span style="flex:none;width:26px;height:26px;border-radius:50%;background:#a93226;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;">${f.n}</span>`
            + `<span>${e(f.text)}</span></li>`).join('') + `</ol>`
          : `<div style="font-size:14px;color:#666;">בלי חורים או חיתוכים — מלבן נקי</div>`)
        :'הציור של הצורה עוד לא נקלט — "קליטה מאופטי-ווי" עם קבצי הצורות מהדיסק-און-קי';
    }).catch(() => { const box = document.getElementById('lgOptyViewGeo'); if (box) box.textContent = 'הציור לא נטען — בדוק חיבור'; });
  }
}

//  📐 כפתור קטן "צורה N" ליד פריט, בכל מסך (בן, 16/11: "בכל שלב הצגה של השייפ") —
//  פותח את lgOptyShapeView. ההזמנה נשמרת ברשימה לפי id כדי שה-onclick יהיה מחרוזת פשוטה.
const _lgOptyOrders = {};
function lgOptyChip(order, idx) {
  if (!order) return '';
  const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
  const it = items[idx];
  if (!it || !it.optyShape) return '';
  const id = String(order.id || '').replace(/[^\w-]/g, ''); _lgOptyOrders[id] = order;
  const s = String(it.optyShape).replace(/[^0-9A-Za-z]/g, '');
  return `<button type="button" class="lg-opty-chip" aria-label="הצורה מאופטי-ווי ${s}" title="הצורה מאופטי-ווי"`
    + ` style="display:inline-flex;align-items:center;gap:3px;min-height:36px;padding:0 9px;margin:0 4px;border:1px solid rgba(169,50,38,.35);border-radius:6px;background:rgba(192,57,43,.08);color:#a93226;font:700 12px Heebo,sans-serif;cursor:pointer;white-space:nowrap;vertical-align:middle"`
    + ` onclick="event.stopPropagation();lgOptyShapeViewById('${id}',${Number(idx) | 0})">📐 ${s}</button>`;
}
function lgOptyShapeViewById(id, idx) { const o = _lgOptyOrders[id]; if (o) lgOptyShapeView(o, idx); }

if (typeof module !== 'undefined' && module.exports) module.exports = { lgOptyShapeParse, lgOptyFeatures, lgOptyShapeSvg, lgOptyShapeDraw, lgOptyChip };
