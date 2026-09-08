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

  /* הזכוכית. הצייר לא יודע מה זה שיפוע ולא צריך לדעת — הוא מקבל
     נקודות ומצייר אותן. */
  L.shapes.forEach(s => {
    const fill = s.kind === 'door' ? '#dbeafe' : '#e8f4f8';
    /* המדרגה עצמה, מתחת לזכוכית — כדי שרואים על מה הפינוי יושב */
    if (s.notch) {
      const n = s.notch, out = n.side === 'right' ? s.x + s.w : s.x;
      p.push(`<path d="M ${out} ${n.shoulder[1]} L ${out} ${s.y + s.h} L ${n.foot[0]} ${s.y + s.h}"
              fill="none" stroke="#cbd5e1" stroke-width="5" stroke-linejoin="round"/>`);
    }
    p.push(`<polygon points="${s.poly.map(q => q[0] + ',' + q[1]).join(' ')}" fill="${fill}" stroke="#0f766e" stroke-width="2"/>`);
    p.push(`<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" font-size="11" fill="#64748b" text-anchor="middle">${esc(s.kind === 'door' ? 'דלת' : 'קבוע')}</text>`);
  });

  /* הפרזול */
  L.hardware.forEach(h => {
    if (h.kind === 'hole') {
      /* חור. זה מה שהחותך צריך לקדוח, וזה כל מה שהשרטוט צריך להראות. */
      p.push(`<circle cx="${h.x}" cy="${h.y}" r="4" fill="#fff" stroke="#334155" stroke-width="1.5"/>`);
    } else {
      const c = h.kind === 'bracket' ? '#b45309' : '#1e293b';
      p.push(`<rect x="${h.x - 7}" y="${h.y - 5}" width="14" height="10" rx="2" fill="${c}"/>`);
    }
  });

  /* המידות.
     המספר יושב **בתוך פער בקו**, לא בקופסה לבנה מעליו. הקופסאות היו
     מפוזרות על הזכוכית ונקראו כמו פתקים שהודבקו על הציור; פער בקו הוא
     מה ששרטוט טכני עושה, והעין קוראת אותו כחלק מהמידה. */
  L.dims.forEach(d => {
    const t = d.t == null ? 0.5 : d.t;
    const mx = d.x1 + (d.x2 - d.x1) * t, my = d.y1 + (d.y2 - d.y1) * t;
    const len = Math.max(String(d.text).length * 7 + 8, 22);

    /* קווי הארכה — ישרים בלבד, ומתחת לכל השאר */
    (d.ext || []).forEach(e => {
      p.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="#fca5a5" stroke-width="0.6"/>`);
    });

    /* הקו, שבור סביב המספר — ורק אם המספר באמת יושב עליו */
    const inside = t > 0.02 && t < 0.98;
    if (d.rot) {
      if (inside) {
        p.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${d.x1}" y2="${my - len / 2}" stroke="#dc2626" stroke-width="1"/>`);
        p.push(`<line x1="${d.x1}" y1="${my + len / 2}" x2="${d.x2}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
      } else {
        p.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
      }
      p.push(`<line x1="${d.x1 - 4}" y1="${d.y1}" x2="${d.x1 + 4}" y2="${d.y1}" stroke="#dc2626" stroke-width="1"/>`);
      p.push(`<line x1="${d.x2 - 4}" y1="${d.y2}" x2="${d.x2 + 4}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
    } else {
      if (inside) {
        p.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${mx - len / 2}" y2="${d.y1}" stroke="#dc2626" stroke-width="1"/>`);
        p.push(`<line x1="${mx + len / 2}" y1="${d.y2}" x2="${d.x2}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
      } else {
        p.push(`<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="#dc2626" stroke-width="1"/>`);
      }
      p.push(`<line x1="${d.x1}" y1="${d.y1 - 4}" x2="${d.x1}" y2="${d.y1 + 4}" stroke="#dc2626" stroke-width="1"/>`);
      p.push(`<line x1="${d.x2}" y1="${d.y2 - 4}" x2="${d.x2}" y2="${d.y2 + 4}" stroke="#dc2626" stroke-width="1"/>`);
    }

    const rot = d.rot ? ` transform="rotate(-90 ${mx} ${my})"` : '';
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
  /* חמישה פאנלים — הקבועים צמודים, כי קבוע בין שתי דלתות אינו נשען
     על כלום. ‏lgValidate פוסל אותו. */
  ['חמישה פאנלים', shower([fixed('a'), fixed('b'), door('c', 'right'), door('d', 'left'), fixed('e')])],
  ['שיפוע ברצפה (ברירת מחדל)', shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1950 }), door('b', 'right')])],
  ['שיפוע למעלה', shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1750, slopeSide: 'top' }), door('b', 'right')])],
  ['שיפוע בצד הקיר', shower([Object.assign(fixed('a'), { slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['דלת משופעת בצד הידית', shower([fixed('a'), Object.assign(door('b', 'right'), { slopeW1: 800, slopeW2: 750 })])],
  ['שיפוע בפאנל אמצעי', shower([fixed('a'), Object.assign(door('b', 'right'), { slopeH1: 1985, slopeH2: 1800 }), fixed('c')])],
  ['שיפוע בגובה וגם ברוחב', shower([Object.assign(fixed('a'), { slopeH1: 2000, slopeH2: 1950, slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['צירים לא בברירת מחדל', shower([fixed('a'), Object.assign(door('b', 'right'), { hingeTop: 150, hingeBot: 340 })])],
  ['קבוע מדרגה', shower([fixed('a', 2000, { notchW: 200, notchH: 500 })], { right: 'wall', left: 'wall' })],
  ['קבוע מדרגה נושא דלת', shower([fixed('a', 2000, { notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה עם מדף משופע', shower([fixed('a', 2000, { notchW: 200, notchH: 500, notchHIn: 470, notchRest: 290 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה + שיפוע למעלה', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1940, notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה — זווית על הכתף', shower([fixed('a', 2000, { notchW: 200, notchH: 500, notchBracket: 'shoulder' }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה — זווית בשתי הנקודות', shower([fixed('a', 2000, { notchW: 200, notchH: 500, notchBracket: 'both' }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['זווית ששונתה ידנית ל-4 ס"מ (רק אז מוצגת מידה)', shower([fixed('a', 2000, { bracketInset: 40 }), door('b', 'right')], { right: 'wall', left: 'open' })],
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
