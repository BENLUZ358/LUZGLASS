#!/usr/bin/env node
/**
 * The sketch name, editable from the dashboard at any stage (Ben, 19/10/2026).
 *
 * "יש הזמנות שבתור סקיצות שכחתי לקבוע להם שמות לסקיצה והעברתי הלאה לשרטט —
 * אני רוצה שמהדשבורד אוכל להיכנס להזמנה בכל שלב ולשנות את שם הסקיצה, כך
 * שהיא תרוץ לאורך כל המערכת ואוכל לחפש ולמצוא אותה."
 *
 * Until now the name could only be set in the sketch queue (sqSaveName), and
 * an order leaves the queue once it moves on. The name is ONE field on the
 * order — sketchName — and every screen, the WhatsApp texts, Hashavshevet's
 * itemname and the dashboard search already read it; so the window writes that
 * same field, and nothing else.
 *
 * The behaviour is run, not grepped: openMod and modSaveSketchName are pulled
 * out of admin.html and executed against a fake DOM and a fake updateOrder.
 *
 * Run: node scripts/test-dashboard-sketch-name.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const grab = n => {
  const i = ADMIN.indexOf('function ' + n + '(');
  if (i < 0) { console.error('FAIL  missing function ' + n); process.exit(1); }
  let d = 0, j = ADMIN.indexOf('{', i);
  for (; j < ADMIN.length; j++) { if (ADMIN[j] === '{') d++; else if (ADMIN[j] === '}' && !--d) break; }
  return ADMIN.slice(i, j + 1);
};

/* ── the window shows a field with the current name ── */
const body = grab('openMod');
check('the order window has a sketch-name field', /id="mSketchName"/.test(body), true);
check('filled with the current name', /value="\$\{lgEsc\(o\.sketchName \|\| ''\)\}"/.test(body), true);
check('it saves on change, through one function', /onchange="modSaveSketchName\(/.test(body), true);

/* ── saving writes sketchName, and only that ── */
function bench(order) {
  const writes = [], toasts = [];
  const els = { mtitle: { textContent: '' } };
  const ctx = vm.createContext({
    orders: [order], eid: order.id, console,
    document: { getElementById: id => els[id] || null },
    updateOrder: (id, patch) => { writes.push([id, patch]); return Promise.resolve(); },
    showToast: m => toasts.push(m), renderAll: () => {}, alert: m => toasts.push('ALERT ' + m),
  });
  vm.runInContext(grab('modSaveSketchName'), ctx);
  return { ctx, writes, toasts, els };
}
{
  const o = { id: 'o1', orderClient: 'א.מ.מראות', sketchName: '' };
  const b = bench(o);
  vm.runInContext('modSaveSketchName("o1", "  מקלחת הורים  ")', b.ctx);
  check('it writes the trimmed name to the order', b.writes, [['o1', { sketchName: 'מקלחת הורים' }]]);
  check('the order in memory has it at once, so search finds it before Firebase answers', o.sketchName, 'מקלחת הורים');
  check('and the window title follows', b.els.mtitle.textContent, 'א.מ.מראות — מקלחת הורים');
}
{
  const o = { id: 'o2', orderClient: 'X', sketchName: 'מראה' };
  const b = bench(o);
  vm.runInContext('modSaveSketchName("o2", "מראה ")', b.ctx);
  check('leaving the field unchanged writes nothing', b.writes, []);
}
{
  const o = { id: 'o3', orderClient: 'X', sketchName: 'ישן' };
  const b = bench(o);
  vm.runInContext('modSaveSketchName("o3", "")', b.ctx);
  check('clearing the name is a real change, saved as empty', b.writes, [['o3', { sketchName: '' }]]);
}

/* ── the dashboard search already reads the field ── */
check('the dashboard search includes sketchName',
      /\(o\.sketchName\|\|''\)/.test(ADMIN.slice(ADMIN.indexOf('if(q){const h=('))), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dashboard sketch-name checks passed.');
