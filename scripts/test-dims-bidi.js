#!/usr/bin/env node
/**
 * מידות "רוחב×גובה" מוצגות הפוך (בן, 06/10).
 *
 * הנתון נכון — w=220, h=550 — אבל בשורה עם עברית הדפדפן הופך את סדר
 * המספרים (אלגוריתם הכיווניות של Unicode: ה-× בין שני מספרים בהקשר RTL
 * מקבל כיוון ימין-לשמאל), ו-"220×550" מוצג "550×220". כלומר בכל המסכים
 * העובדים ראו גובה×רוחב. נמדד בדפדפן: גם לבד בתא טבלה.
 *
 * המוסכמה במפעל: רוחב × גובה. התיקון: lgDimsText עוטף את הזוג ב-LRI…PDI
 * (U+2066 / U+2069) — בידוד משמאל לימין שעובד ב-HTML, בתא טבלה, ב-SVG
 * ובטקסט רגיל. נמדד: "220×550" נשאר "220×550" בכל הארבעה.
 *
 * Run: node scripts/test-dims-bidi.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const fn = (SRC.match(/function lgDimsText[\s\S]*?\n}/) || [''])[0];
check('lgDimsText exists in the shared file', fn.length > 0, true);
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn, ctx);
check('width first, isolated left-to-right', ctx.lgDimsText(220, 550), LRI + '220×550' + PDI);
check('a missing side shows the placeholder asked for', ctx.lgDimsText(220, 0, '?'), LRI + '220×?' + PDI);
check('both missing and no placeholder → empty sides', ctx.lgDimsText(null, undefined), LRI + '×' + PDI);
check('rounding is the caller\'s business — numbers pass through', ctx.lgDimsText(220.5, 550), LRI + '220.5×550' + PDI);

/* ── אף מסך לא כותב רוחב×גובה בעצמו ─────────────────────────────────
   הצורה הישנה: ${…w…}×${…h…}. כל מופע כזה הוא מקום שבו העובד רואה
   גובה×רוחב. ×${qty} (כמות) אינו מידה ולכן לא נתפס. */
const PAGES = ['admin.html', 'workday.html', 'check-station.html', 'portal.html', 'drafter.html', 'invoices.html'];
const RAW = /\$\{[^}]*\bw\b[^}]*\}×\$\{[^}]*\bh\b[^}]*\}/g;
for (const p of PAGES) {
  const t = fs.readFileSync(path.join(ROOT, p), 'utf8');
  /* גם שרשור: (it.w||'') + '×' + (it.h||'')  /  ${i.w ? '×' : ''}  —
     נמצא בדפדפן אחרי שהצורה הראשונה תוקנה, וחלון ההזמנה עדיין הופך */
  const CONCAT = /\bw\b[^\n;`]{0,30}'×'[^\n;`]{0,30}\bh\b/g;
  const left = (t.match(RAW) || []).concat(t.match(CONCAT) || []);
  check(`${p}: every width×height goes through lgDimsText`, left, []);
  check(`${p}: loads the shared file that has it`, /firebase-db\.js/.test(t), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension-direction checks passed.');
