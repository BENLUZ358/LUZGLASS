#!/usr/bin/env node
/**
 * דף ליקוט לכל תצורה — זכוכית ופרזול, אחד ליד השני.
 *
 * שני הליקוטים והשרטוט יוצאים מאותו מנוע, ולכן אפשר להעמיד אותם זה מול
 * זה ולראות שהם מסכימים. ליקוט שנבנה בנפרד מהציור מתפצל ממנו בשקט, והפער
 * מתגלה רק כשהמרכיב בשטח.
 *
 * הרצה:  node scripts/preview-picking.js  →  scratch/picking.html
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgLayout, lgGlass, lgGlassTotals, lgBOM, lgValidate } = ctx;

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const HW_HE = {
  'bracket-wall': 'זווית קיר-זכוכית', 'bracket-gg': 'זווית זכוכית-זכוכית',
  'hinge-gg': 'ציר זכוכית-זכוכית', 'hinge-wall': 'ציר קיר-זכוכית',
  'handle': 'ידית', 'bracket-floor': 'זווית רצפה',
};

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, e) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, e || {});
const door = (id, hs, h, e) => Object.assign({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hs || 'right' }, e || {});

const CASES = [
  ['קבוע + דלת', shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע דלת קבוע', shower([fixed('a'), door('b', 'right'), fixed('c')])],
  ['שתי דלתות', shower([fixed('a'), door('b', 'right'), door('c', 'left'), fixed('d')])],
  ['קבוע משופע + דלת', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1750 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע מדרגה נושא דלת', shower([fixed('a', 2000, { notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה + שיפוע + זווית רצפה', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1940, notchW: 200, notchH: 500, floorBracket: true }), door('b', 'right')], { right: 'wall', left: 'open' })],
];

/* ציור קטן, כדי שהליקוט לא יעמוד לבד */
function mini(L) {
  const p = [`<svg viewBox="0 0 ${L.canvas.w} ${L.canvas.h}" width="240">`,
             `<rect width="100%" height="100%" fill="#fff"/>`];
  L.shapes.forEach(s => p.push(`<polygon points="${s.poly.map(q => q[0] + ',' + q[1]).join(' ')}"
      fill="${s.kind === 'door' ? '#dbeafe' : '#e8f4f8'}" stroke="#0f766e" stroke-width="4"/>`));
  L.hardware.forEach(h => p.push(h.kind === 'hole'
    ? `<circle cx="${h.x}" cy="${h.y}" r="9" fill="#fff" stroke="#334155" stroke-width="4"/>`
    : `<rect x="${h.x - 14}" y="${h.y - 10}" width="28" height="20" rx="4"
             fill="${h.kind === 'bracket' ? '#b45309' : '#1e293b'}"/>`));
  p.push('</svg>');
  return p.join('');
}

const body = CASES.map(([name, sh]) => {
  const L = lgLayout(sh, { canvasW: 900 });
  const g = lgGlass(sh), t = lgGlassTotals(sh), bom = lgBOM(sh);
  const errs = lgValidate(sh);
  return `
<section>
  <h2>${esc(name)}</h2>
  ${errs.length ? `<p class="err">${errs.map(e => esc(e.msg)).join(' · ')}</p>` : ''}
  <div class="grid">
    <div class="pic">${mini(L)}</div>
    <div>
      <h3>זכוכית</h3>
      <table>
        <tr><th>#</th><th>סוג</th><th>חיתוך</th><th>צורה</th><th>מ״ר</th><th>נטו</th><th>פחת</th><th>קידוחים</th></tr>
        ${g.map(x => `<tr>
          <td>${x.idx + 1}</td><td>${x.kind === 'door' ? 'דלת' : 'קבוע'}</td>
          <td>${x.cutW} × ${x.cutH}</td><td>${esc(x.shape)}</td>
          <td><b>${x.m2}</b></td><td class="q">${x.netM2}</td>
          <td class="${x.wasteM2 ? 'w' : 'q'}">${x.wasteM2 || '—'}</td><td>${x.holes}</td></tr>`).join('')}
        <tr class="tot"><td colspan="4">סה״כ ${t.panes} זכוכיות</td>
          <td><b>${t.m2}</b></td><td class="q">${t.netM2}</td>
          <td class="w">${t.wasteM2 || '—'}</td><td>${t.holes}</td></tr>
      </table>

      <h3>פרזול</h3>
      <table>
        <tr><th>פריט</th><th>גימור</th><th>איכות</th><th>כמות</th></tr>
        ${bom.map(l => `<tr><td>${esc(HW_HE[l.type] || l.type)}${l.variant && l.variant !== 'regular' ? ' · ' + esc(l.variant) : ''}</td>
          <td class="q">${esc(l.finish)}</td><td class="q">${esc(l.quality)}</td>
          <td><b>${l.qty}</b></td></tr>`).join('')}
      </table>
    </div>
  </div>
</section>`;
}).join('');

const html = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8">
<title>ליקוט — זכוכית ופרזול</title>
<style>
 body{font:14px system-ui,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;line-height:1.5}
 .wrap{max-width:1000px;margin:0 auto}
 h1{font-size:22px;margin:0 0 4px} p.sub{color:#64748b;margin:0 0 22px}
 section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:18px}
 h2{font-size:16px;margin:0 0 12px;color:#0f766e}
 h3{font-size:13px;margin:14px 0 6px;color:#475569;text-transform:none}
 h3:first-of-type{margin-top:0}
 .grid{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
 .pic{flex:0 0 240px;background:#f8fafc;border-radius:8px;padding:6px}
 .grid>div:last-child{flex:1;min-width:340px}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th,td{padding:5px 8px;text-align:right;border-bottom:1px solid #f1f5f9}
 th{background:#f8fafc;font-size:11.5px;color:#64748b;font-weight:600}
 tr.tot td{border-top:2px solid #e2e8f0;border-bottom:none;background:#f0fdfa}
 td.q{color:#94a3b8} td.w{color:#b45309}
 .err{background:#fef2f2;color:#991b1b;border-radius:8px;padding:8px 12px;font-size:13px;margin:0 0 12px}
 svg{display:block;max-width:100%;height:auto}
</style>
<div class="wrap">
<h1>ליקוט — זכוכית ופרזול</h1>
<p class="sub">השרטוט, הזכוכית והפרזול יוצאים מאותו מנוע. <b>מ״ר</b> נמדד לפי הגובה והרוחב הגדולים ביותר — זה מה שנחתך מהלוח ומה שמחייבים; <b>נטו</b> הוא מה שבאמת יוצא, וההפרש הוא הפחת.</p>
${body}
</div></html>`;

const outDir = path.join(ROOT, 'scratch');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, 'picking.html'), html, 'utf8');
console.log('נכתב: ' + path.join(outDir, 'picking.html'));
