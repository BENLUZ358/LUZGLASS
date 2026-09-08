#!/usr/bin/env node
/**
 * ביקורת שייף-שייף מול כל כלל שסוכם.
 *
 * הבדיקות ב-test-layout.js שואלות "האם משהו נשבר". הביקורת הזאת שואלת
 * שאלה אחרת: **לכל סוג שייף, האם כל מה שהבטחנו באמת שם.** מידה שנעלמה
 * לגמרי לא שוברת אף בדיקת חפיפה — היא פשוט חסרה, והשרטט מגלה את זה
 * מול הזכוכית.
 *
 * הרצה:  node scripts/audit-layout.js  →  scratch/layout-audit.html
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number, Set });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgLayout, lgValidate, lgBOM } = ctx;

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, e) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, e || {});
const door = (id, hs, h, e) => Object.assign({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hs || 'right' }, e || {});

/* ── the rules, each one a question with a yes/no answer ────────────────── */
const MAX_AWAY = 56;
/* A dimension may cover several panes — two doors of the same height share
   one number by design. So "does this pane have a height" asks whether any
   dimension covers it, not whether one is filed under its own index. */
const dimsOf = (L, i) => L.dims.filter(d =>
  d.idx === i || (Array.isArray(d.idxs) && d.idxs.indexOf(i) >= 0));
const kinds = (L, i) => dimsOf(L, i).map(d => d.kind);
const val = (L, i, k) => dimsOf(L, i).filter(d => d.kind === k).map(d => Number(d.text)).sort((a, b) => a - b);
const hwOf = (L, i) => L.hardware.filter(h => h.idx === i);

const RULES = [
  { id: 'width', t: 'רוחב מצוין',
    ask: (L, s) => val(L, s.idx, 'width').length >= 1,
    say: (L, s) => val(L, s.idx, 'width').join(' · ') },

  { id: 'height', t: 'גובה מצוין',
    ask: (L, s) => val(L, s.idx, 'height').length >= 1,
    say: (L, s) => val(L, s.idx, 'height').join(' · ') },

  { id: 'slope-h', t: 'שיפוע אופקי — שני גבהים', when: s => s.slope && s.slope.hSide,
    ask: (L, s) => val(L, s.idx, 'height').length >= 2,
    say: (L, s) => val(L, s.idx, 'height').join(' · ') },

  { id: 'slope-v', t: 'שיפוע אנכי — שני רוחבים', when: s => s.slope && s.slope.vSide,
    ask: (L, s) => val(L, s.idx, 'width').length >= 2,
    say: (L, s) => val(L, s.idx, 'width').join(' · ') },

  { id: 'notch-dims', t: 'פינוי — רוחב, גובה, ומה שנשאר', when: s => s.notch,
    ask: (L, s) => val(L, s.idx, 'notch-w').length >= 1 &&
                   val(L, s.idx, 'notch-h').length >= 1 &&
                   val(L, s.idx, 'width').length >= 2,
    say: (L, s) => `רוחב ${val(L, s.idx, 'notch-w')} · גובה ${val(L, s.idx, 'notch-h').join('/')} · רוחבים ${val(L, s.idx, 'width').join('/')}` },

  { id: 'notch-side', t: 'פינוי בצד הקיר', when: s => s.notch,
    ask: (L, s, sh) => {
      const j = sh.junctions;
      const want = (j[s.idx] && j[s.idx].type === 'bracket-wall') ? 'left'
                 : (j[s.idx + 1] && j[s.idx + 1].type === 'bracket-wall') ? 'right' : null;
      return want == null || s.notch.side === want;
    },
    say: (L, s) => s.notch.side === 'left' ? 'שמאל' : 'ימין' },

  { id: 'notch-shelf', t: 'מדף נוטה — שתי מידות גובה',
    when: s => s.notch && Math.abs(s.notch.shoulder[1] - s.notch.inner[1]) > 1,
    ask: (L, s) => val(L, s.idx, 'notch-h').length >= 2,
    say: (L, s) => val(L, s.idx, 'notch-h').join(' · ') },

  { id: 'hw-measured', t: 'לכל ציר וזווית יש גובה',
    ask: (L, s) => {
      const hw = hwOf(L, s.idx).filter(h => h.kind === 'bracket' || h.kind === 'hinge');
      if (!hw.length) return true;
      const ds = dimsOf(L, s.idx).filter(d => /^(hinge|bracket)-(top|bot)$/.test(d.kind));
      return hw.every(h => ds.some(d => Math.abs(d.y1 - h.y) < 1 || Math.abs(d.y2 - h.y) < 1));
    },
    say: (L, s) => {
      const hw = hwOf(L, s.idx).filter(h => h.kind === 'bracket' || h.kind === 'hinge');
      const ds = dimsOf(L, s.idx).filter(d => /^(hinge|bracket)-/.test(d.kind));
      return hw.length ? `${hw.length} פריטים · ${ds.map(d => d.text).join('/')}` : '—';
    } },

  { id: 'hw-on-pane', t: 'כל מידת פרזול על הזכוכית שלה',
    ask: (L, s) => dimsOf(L, s.idx).filter(d => /^(hinge|bracket|handle-dist)/.test(d.kind))
                     .every(d => d.x1 >= s.x - 1 && d.x1 <= s.x + s.w + 1),
    say: () => '' },

  { id: 'near', t: 'אף מידה לא רחוקה ממה שהיא מודדת',
    ask: (L, s) => dimsOf(L, s.idx).filter(d => d.near != null)
                     .every(d => Math.abs(d.x1 - d.near) <= MAX_AWAY),
    say: (L, s) => {
      const far = dimsOf(L, s.idx).filter(d => d.near != null)
        .map(d => Math.abs(d.x1 - d.near));
      return far.length ? `מקסימום ${Math.round(Math.max.apply(null, far))}px` : '—';
    } },

  /* the inset is 25mm unless the customer moved it, and a hinge has none */
  { id: 'edge', t: 'פרזול יושב על הזכוכית עצמה',
    ask: (L, s, sh) => {
      const mm = (sh.src[s.idx] || {}).bracketInset;
      return hwOf(L, s.idx).filter(h => h.edgeX != null).every(h => {
        const want = h.kind === 'bracket' ? (mm != null ? mm : 25) * L.scale : 0;
        return Math.abs(Math.abs(h.x - h.edgeX) - want) < 1;
      });
    },
    say: (L, s, sh) => {
      const mm = (sh.src[s.idx] || {}).bracketInset;
      return `${mm != null ? mm : 25} מ״מ מהפאה`;
    } },

  { id: 'inset-quiet', t: 'מרחק הזווית מצוין רק אם שונה',
    ask: (L, s, sh) => {
      const moved = (sh.src[s.idx] || {}).bracketInset != null;
      return (dimsOf(L, s.idx).some(d => d.kind === 'bracket-inset')) === moved;
    },
    say: (L, s, sh) => (sh.src[s.idx] || {}).bracketInset != null ? 'שונה — מצוין' : 'ברירת מחדל — שקט' },

  { id: 'hole', t: 'דלת — חור עם שתי מידות', when: s => s.kind === 'door',
    ask: (L, s) => hwOf(L, s.idx).some(h => h.kind === 'hole') &&
                   dimsOf(L, s.idx).some(d => d.kind === 'handle-edge') &&
                   dimsOf(L, s.idx).some(d => d.kind === 'handle-dist'),
    say: (L, s) => {
      const e = val(L, s.idx, 'handle-edge'), d = val(L, s.idx, 'handle-dist');
      return `${e} מהפאה · ${d} מהרצפה`;
    } },

  { id: 'poly', t: 'הצורה נמסרת כפוליגון',
    ask: (L, s) => Array.isArray(s.poly) && s.poly.length >= 4,
    say: (L, s) => `${s.poly.length} נקודות` },

  /* The strongest question of all, and the only one that catches a number
     that is simply wrong: does the drawing agree with itself? A dimension
     saying 500 over an edge that measures 490 passes every overlap check
     ever written, and reaches the cutter as a ten-millimetre error. */
  { id: 'truth', t: 'כל מידה תואמת לצורה שהיא מודדת',
    ask: (L, s, sh) => truthOf(L, s, sh).every(t => t.ok),
    say: (L, s, sh) => {
      const bad = truthOf(L, s, sh).filter(t => !t.ok);
      return bad.length ? bad.map(t => `${t.what}: כתוב ${t.said}, בפועל ${t.real}`).join(' · ')
                        : `${truthOf(L, s, sh).length} מידות מאומתות`;
    } },
];

/* measure the shape itself and compare with what is written on it */
function truthOf(L, s, sh) {
  const P = s.poly, sc = L.scale, out = [];
  const mm = px => Math.round(px / sc);
  const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const has = (k, v) => val(L, s.idx, k).some(x => Math.abs(x - v) <= 2);
  const add = (what, said, real) => out.push({ what, said, real, ok: Math.abs(said - real) <= 2 });

  /* the top edge, always P0→P1 */
  const topW = mm(P[1][0] - P[0][0]);
  const ws = val(L, s.idx, 'width');
  if (ws.length) add('רוחב עליון', ws.reduce((a, b) => Math.abs(a - topW) < Math.abs(b - topW) ? a : b), topW);

  /* each vertical face against the heights written */
  const nt = s.notch;
  const leftFace = seg(P[0], P[P.length - 1]);
  const rightFace = seg(P[1], P[2]);
  const hs = val(L, s.idx, 'height');
  if (hs.length) {
    /* the face the notch cuts is shortened, and the drawing states the whole
       height plus the notch height instead — the short face is derived. */
    const skip = nt ? (nt.side === 'left' ? 0 : 1) : -1;
    [mm(leftFace), mm(rightFace)].forEach((real, i) => {
      if (i === skip) return;
      const near = hs.reduce((a, b) => Math.abs(a - real) < Math.abs(b - real) ? a : b);
      add(i ? 'פאה ימנית' : 'פאה שמאלית', near, real);
    });
  }

  /* the notch, measured off its own three points */
  if (nt) {
    add('רוחב הפינוי', val(L, s.idx, 'notch-w')[0], mm(Math.abs(nt.inner[0] - nt.shoulder[0])));
    const hOut = mm(Math.abs(nt.shoulder[1] - (s.y + s.h)));
    const nh = val(L, s.idx, 'notch-h');
    add('גובה הפינוי', nh.reduce((a, b) => Math.abs(a - hOut) < Math.abs(b - hOut) ? a : b), hOut);
  }
  return out;
}

/* ── the cases, one per shape kind we support ──────────────────────────── */
const CASES = [
  ['קבוע פשוט על קיר', shower([fixed('a')])],
  ['קבוע + דלת', shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע 1900 + דלת 1885', shower([fixed('a', 1900), door('b', 'right', 1885)])],
  ['קבוע דלת קבוע', shower([fixed('a'), door('b', 'right'), fixed('c')])],
  ['שתי דלתות', shower([fixed('a'), door('b', 'right'), door('c', 'left'), fixed('d')])],
  ['קבוע משופע ברצפה', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1950 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע משופע למעלה', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1750, slopeSide: 'top' }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע משופע בצד הקיר', shower([fixed('a', 2000, { slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['דלת משופעת בצד הידית', shower([fixed('a'), door('b', 'right', 1985, { slopeW1: 800, slopeW2: 750 })])],
  ['שיפוע בגובה וברוחב', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1950, slopeW1: 500, slopeW2: 455 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['קבוע מדרגה', shower([fixed('a', 2000, { notchW: 200, notchH: 500 })])],
  ['קבוע מדרגה נושא דלת', shower([fixed('a', 2000, { notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה עם מדף נוטה', shower([fixed('a', 2000, { notchW: 200, notchH: 500, notchHIn: 470, notchRest: 290 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['מדרגה + שיפוע', shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1940, notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ['זווית שהוזזה ל-4 ס״מ', shower([fixed('a', 2000, { bracketInset: 40 }), door('b', 'right')], { right: 'wall', left: 'open' })],
];

/* ── run ───────────────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const rows = [];

CASES.forEach(([name, sh]) => {
  const junctions = ctx.lgJunctions(sh);
  const errs = lgValidate(sh);
  const meta = { junctions, src: sh.shapes };

  [375, 900].forEach(cw => {
    const L = lgLayout(sh, { canvasW: cw });
    L.shapes.forEach(s => {
      RULES.forEach(r => {
        if (r.when && !r.when(s)) return;
        let ok, note = '';
        try { ok = !!r.ask(L, s, meta); note = r.say ? r.say(L, s, meta) : ''; }
        catch (e) { ok = false; note = 'שגיאה: ' + e.message; }
        ok ? pass++ : fail++;
        if (cw === 900 || !ok) rows.push({ name, cw, idx: s.idx,
          kind: s.kind === 'door' ? 'דלת' : 'קבוע', rule: r.t, ok, note });
      });
    });
  });

  if (errs.length) rows.push({ name, cw: '—', idx: '—', kind: 'חוקיות',
    rule: 'lgValidate', ok: false, note: errs.map(e => e.msg).join(' · ') });
});

/* ── report ────────────────────────────────────────────────────────────── */
const byCase = {};
rows.forEach(r => (byCase[r.name] = byCase[r.name] || []).push(r));

const html = `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8">
<title>ביקורת שייף-שייף</title>
<style>
 body{font:14px system-ui,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;line-height:1.5}
 .wrap{max-width:1000px;margin:0 auto}
 h1{font-size:22px;margin:0 0 4px} p.sub{color:#64748b;margin:0 0 20px}
 .tally{display:flex;gap:10px;margin:0 0 24px}
 .tally div{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 18px}
 .tally b{font-size:22px;display:block}
 .ok b{color:#0f766e} .bad b{color:#dc2626}
 h2{font-size:16px;margin:26px 0 8px;color:#0f766e;border-bottom:2px solid #99f6e4;padding-bottom:5px}
 table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;font-size:13px}
 th,td{padding:6px 10px;text-align:right;border-bottom:1px solid #f1f5f9}
 th{background:#f1f5f9;font-size:12px}
 tr:last-child td{border-bottom:none}
 tr.bad{background:#fef2f2}
 .y{color:#0f766e;font-weight:600} .n{color:#dc2626;font-weight:600}
 td.note{color:#64748b;font-size:12px}
</style>
<div class="wrap">
<h1>ביקורת שייף-שייף</h1>
<p class="sub">כל סוג שייף נבדק מול כל כלל שסוכם, בשני רוחבי מסך. שורות תקינות מוצגות מ-900px; כל כשל מוצג תמיד.</p>
<div class="tally">
  <div class="ok"><b>${pass}</b>עברו</div>
  <div class="${fail ? 'bad' : 'ok'}"><b>${fail}</b>נכשלו</div>
  <div><b>${CASES.length}</b>תצורות</div>
</div>
${Object.keys(byCase).map(name => `
<h2>${esc(name)}</h2>
<table>
<tr><th>שייף</th><th>כלל</th><th>תוצאה</th><th>מה נמצא</th></tr>
${byCase[name].map(r => `<tr class="${r.ok ? '' : 'bad'}">
  <td>${esc(r.kind)} ${r.idx}${r.cw === 375 ? ' <small>@375</small>' : ''}</td>
  <td>${esc(r.rule)}</td>
  <td class="${r.ok ? 'y' : 'n'}">${r.ok ? '✓' : '✗'}</td>
  <td class="note">${esc(r.note)}</td></tr>`).join('')}
</table>`).join('')}
</div></html>`;

const outDir = path.join(ROOT, 'scratch');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, 'layout-audit.html'), html, 'utf8');
console.log(`עברו ${pass} · נכשלו ${fail}`);
if (fail) process.exit(1);
