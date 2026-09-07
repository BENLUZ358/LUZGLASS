#!/usr/bin/env node
/**
 * מצייר את הפלט של lg-layout.js כ-SVG, כדי שאפשר יהיה לראות בעין מה
 * שהבדיקות מוכיחות במספרים.
 *
 * הבדיקות אומרות "שני המלבנים האלה לא נחתכים". הן לא אומרות אם זה
 * נראה טוב. סמל שנפסל פעם אחת כבר לימד אותנו שסמל נשפט מול העין לפני
 * שהוא נשלח — אז לפני שהצייר האמיתי מחובר, מסתכלים.
 *
 * הרצה:  node scripts/preview-layout.js  →  scratch/layout-preview.html
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgLayout } = ctx;

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function svg(L, title) {
  const p = [];
  p.push(`<svg viewBox="0 0 ${L.canvas.w} ${L.canvas.h}" width="${L.canvas.w}" height="${L.canvas.h}">`);
  p.push(`<rect width="100%" height="100%" fill="#fff"/>`);

  /* הזכוכית */
  L.shapes.forEach(s => {
    const fill = s.kind === 'door' ? '#dbeafe' : '#e8f4f8';
    if (s.slope) {
      const tallL = s.slope.h1 >= s.slope.h2;
      const shortH = Math.min(s.slope.h1, s.slope.h2) * L.scale;
      const pts = tallL
        ? `${s.x},${s.y} ${s.x + s.w},${s.y + s.h - shortH} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}`
        : `${s.x},${s.y + s.h - shortH} ${s.x + s.w},${s.y} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}`;
      p.push(`<polygon points="${pts}" fill="${fill}" stroke="#0f766e" stroke-width="2"/>`);
    } else {
      p.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}" stroke="#0f766e" stroke-width="2"/>`);
    }
    p.push(`<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" font-size="11" fill="#64748b" text-anchor="middle">${esc(s.kind === 'door' ? 'דלת' : 'קבוע')}</text>`);
  });

  /* הפרזול */
  L.hardware.forEach(h => {
    if (h.kind === 'handle') {
      /* ידית מקלחון היא מוט על שתי רגליים, לא מקל שחור. הרגליים יוצאות
         לכיוון הזכוכית ונגמרות בדיסק — ככה רואים שזו ידית ולא כפתור. */
      const L2 = (h.len || 44) / 2, bx = h.x + (h.toward || 1) * 8;
      p.push(`<line x1="${h.x}" y1="${h.y - L2 * 0.55}" x2="${bx}" y2="${h.y - L2 * 0.55}" stroke="#94a3b8" stroke-width="2"/>`);
      p.push(`<line x1="${h.x}" y1="${h.y + L2 * 0.55}" x2="${bx}" y2="${h.y + L2 * 0.55}" stroke="#94a3b8" stroke-width="2"/>`);
      p.push(`<circle cx="${bx}" cy="${h.y - L2 * 0.55}" r="2.6" fill="#94a3b8"/>`);
      p.push(`<circle cx="${bx}" cy="${h.y + L2 * 0.55}" r="2.6" fill="#94a3b8"/>`);
      p.push(`<line x1="${h.x}" y1="${h.y - L2}" x2="${h.x}" y2="${h.y + L2}" stroke="#334155" stroke-width="4.5" stroke-linecap="round"/>`);
    } else {
      const c = h.kind === 'bracket' ? '#b45309' : '#1e293b';
      p.push(`<rect x="${h.x - 7}" y="${h.y - 5}" width="14" height="10" rx="2" fill="${c}"/>`);
    }
  });

  /* המידות */
  L.dims.forEach(d => {
    const t = d.t == null ? 0.5 : d.t;
    const mx = d.x1 + (d.x2 - d.x1) * t, my = d.y1 + (d.y2 - d.y1) * t;
    p.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
    /* קצוות */
    const ext = d.rot ? `<line x1="${d.x1 - 4}" y1="${d.y1}" x2="${d.x1 + 4}" y2="${d.y1}" stroke="#dc2626" stroke-width="1"/><line x1="${d.x2 - 4}" y1="${d.y2}" x2="${d.x2 + 4}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`
                     : `<line x1="${d.x1}" y1="${d.y1 - 4}" x2="${d.x1}" y2="${d.y1 + 4}" stroke="#dc2626" stroke-width="1"/><line x1="${d.x2}" y1="${d.y2 - 4}" x2="${d.x2}" y2="${d.y2 + 4}" stroke="#dc2626" stroke-width="1"/>`;
    p.push(ext);
    /* קווי הארכה — ישרים בלבד */
    (d.ext || []).forEach(e => {
      p.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="#f87171" stroke-width="0.6"/>`);
    });
    const rot = d.rot ? ` transform="rotate(-90 ${mx} ${my})"` : '';
    p.push(`<rect x="${mx - (d.rot ? 8 : String(d.text).length * 3.5 + 5)}" y="${my - (d.rot ? String(d.text).length * 3.5 + 5 : 8)}" width="${d.rot ? 16 : String(d.text).length * 7 + 10}" height="${d.rot ? String(d.text).length * 7 + 10 : 16}" fill="#fff" opacity="0.9"/>`);
    p.push(`<text x="${mx}" y="${my + 4}"${rot} font-size="11" fill="#dc2626" text-anchor="middle">${esc(d.text)}</text>`);
  });

  p.push('</svg>');
  return `<figure><figcaption>${esc(title)}</figcaption>${p.join('')}</figure>`;
}

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, extra) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, extra || {});
const door = (id, hingeSide, h) => ({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hingeSide || 'right' });

const CASES = [
  ['דלת בודדת', shower([door('a', 'right')])],
  ['קבוע + דלת', shower([fixed('a'), door('b', 'right')])],
  ['קבוע דלת קבוע', shower([fixed('a'), door('b', 'right'), fixed('c')])],
  ['שתי דלתות', shower([fixed('a'), door('b', 'right'), door('c', 'left'), fixed('d')])],
  ['חמישה פאנלים', shower([fixed('a'), door('b', 'right'), fixed('c'), door('d', 'left'), fixed('e')])],
  ['קבוע משופע', shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1750 }), door('b', 'right')])],
  ['דלת משופעת', shower([fixed('a'), Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1700 })])],
  ['צירים לא בברירת מחדל', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150, hingeBot: 340 })])],
];

const WIDTHS = [375, 768, 1440];
const body = WIDTHS.map(cw =>
  `<section><h2>${cw}px</h2>` +
  CASES.map(([n, s]) => svg(lgLayout(s, { canvasW: cw }), n)).join('') +
  `</section>`).join('');

const html = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8">
<title>תצוגה מקדימה — פריסת מידות</title>
<style>
 body{font:14px system-ui,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a}
 h1{font-size:20px;margin:0 0 4px} p.sub{color:#64748b;margin:0 0 24px}
 section{margin-bottom:32px} h2{font-size:15px;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
 figure{display:inline-block;margin:0 12px 20px 0;vertical-align:top;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px}
 figcaption{font-size:12px;color:#64748b;margin-bottom:6px}
 svg{display:block;max-width:100%}
</style>
<h1>פריסת מידות — תצוגה מקדימה</h1>
<p class="sub">הפלט של <code>lgLayout</code> בלבד. אין כאן צייר ואין קנבס — רק המספרים שהמודול מחזיר, מצוירים כמו שהם.</p>
${body}
</html>`;

const outDir = path.join(ROOT, 'scratch');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
const outFile = path.join(outDir, 'layout-preview.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log('נכתב: ' + outFile);
