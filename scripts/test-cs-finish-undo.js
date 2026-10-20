#!/usr/bin/env node
/**
 * "סיים סקיצה" בטעות (בן, 20/10/2026): סקיצה 3499 עברה ל"הושלמו" בלחיצה אחת,
 * ולא הייתה שום דרך להחזיר אותה — טאב "הושלמו" לקריאה בלבד. הוחזרה ידנית ב-Firebase.
 *
 *  1. "סיים סקיצה" שואל לפני שהוא מסמן את כל החתיכות.
 *  2. בטאב "הושלמו" יש "החזר לבדיקה" — מוחק את הסימונים של הסקיצה הזו בלבד.
 *  3. שליחה לחיסום כותבת גם status ולא רק stage (הסטטוס השמור נשאר ישן).
 *
 * Run: node scripts/test-cs-finish-undo.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CS = fs.readFileSync(path.join(__dirname, '..', 'check-station.html'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); failed++; return ''; }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

function station(answer) {
  const calls = { saved: 0, tab: null, asked: null };
  const ctx = vm.createContext({
    console, JSON, Object, Array, String,
    cur: { id: 'o1', orderNum: 'L1076', sketchName: '3499', items: [{ chisum: true }, { chisum: true }] },
    cs: { o2: { 0: true } }, _finishingSketch: false,
    document: { getElementById: () => null },
    confirm: msg => { calls.asked = msg; return answer; },
    saveCS: async () => { calls.saved++; }, hideBanner: () => {}, showList: () => {}, toast: () => {},
    setTab: t => { calls.tab = t; }, selectOrder: id => { calls.opened = id; }, goBack: () => { calls.back = (calls.back || 0) + 1; },
  });
  vm.runInContext(['var _finishingSketch = false;', bodyOf(CS, 'chisumIdxs'), 'async ' + bodyOf(CS, 'finishSketch'), 'async ' + bodyOf(CS, 'csReopenSketch')].join('\n'), ctx);
  return { ctx, calls };
}

(async () => {
  {
    const { ctx, calls } = station(false);
    await ctx.finishSketch();
    check('"סיים סקיצה" asks first, naming the sketch', /3499/.test(calls.asked || ''), true);
    check('a "no" marks nothing and saves nothing', [calls.saved, JSON.stringify(ctx.cs.o1 || null)], [0, 'null']);
  }
  {
    const { ctx, calls } = station(true);
    await ctx.finishSketch();
    check('a "yes" marks every chisum piece and saves', [calls.saved, JSON.parse(JSON.stringify(ctx.cs.o1))], [1, { 0: true, 1: true }]);
  }
  {
    const { ctx, calls } = station(true);
    vm.runInContext('cs.o1 = {0:true,1:true}; curReadOnly = true;', ctx);
    await ctx.csReopenSketch();
    check('"החזר לבדיקה" removes only this sketch\'s marks', JSON.parse(JSON.stringify(ctx.cs)), { o2: { 0: true } });
    check('…saves, and reopens the same sketch under "לבדיקה", ready to edit', [calls.saved, calls.tab, calls.opened], [1, 'active', 'o1']);
  }
  {
    const { ctx, calls } = station(false);
    vm.runInContext('cs.o1 = {0:true,1:true}; curReadOnly = true;', ctx);
    await ctx.csReopenSketch();
    check('"ערוך" in הושלמו asks first; a "no" changes nothing', [calls.saved, JSON.stringify(ctx.cs.o1)], [0, '{"0":true,"1":true}']);
  }
  check('the "הושלמו" view offers "החזר לבדיקה"', /id="doneBadge"[\s\S]{0,600}onclick="csReopenSketch\(\)"[^>]*>[\s\S]{0,60}ערוך/.test(CS), true);
  check('"שמור" in the editor goes straight back to the list of orders (בן, 20/10)', /renderSketch\(\);\s*\n\s*goBack\(\);/.test(bodyOf(CS, 'edSave')), true);
  check('sending to tempering writes the status with the stage',
    /const patch = \{ stage: 'chisum', status: lgStageToStatus\('chisum'\)/.test(bodyOf(CS, 'sendAllToFactory')), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll finish/undo checks passed.');
})();
