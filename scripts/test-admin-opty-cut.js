#!/usr/bin/env node
/**
 * לוח הזמנות → פרטי ההזמנה: "אופטימיזציה M00xxx" ו"✂ נחתך dd/mm" ליד "צורה N" (בן, 17/11).
 * רק שם — לא בחיסום. Run: node scripts/test-admin-opty-cut.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); process.exit(1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};
check('admin loads opty-layout.js', /<script src="opty-layout\.js\?v=/.test(html), true);
const L = require(path.join(ROOT, 'opty-layout.js'));
const ctx = Object.assign({ lgEsc: s => String(s == null ? '' : s), lgDimsText: (w, h) => w + '×' + h, setTimeout: () => 0, _modFillGeos: () => {} }, L);
vm.createContext(ctx);
vm.runInContext(bodyOf(html, '_modItemsHtml'), ctx);
const today = '2026-11-18';
ctx.lgOptyTodayIso = () => today;
const row = it => vm.runInContext('_modItemsHtml(ITEMS)', Object.assign(ctx, { ITEMS: [it] }));
const base = { name: 'שקוף 8', w: 302, h: 2002, optyShape: '274380', optyJob: 'M00290' };
const cut = row(Object.assign({ optyCut: { at: '2026-11-17', job: 'M00290' } }, base));
check('linked + cut yesterday: job and "✂ נחתך 17/11"', [cut.includes('אופטימיזציה M00290'), cut.includes('✂ נחתך 17/11')], [true, true]);
const wait = row(Object.assign({ optyCut: { at: '2026-11-18', job: 'M00290' } }, base));
check('cut day is today: "לחיתוך היום"', [wait.includes('לחיתוך היום'), wait.includes('נחתך')], [true, false]);
const und = row(Object.assign({ optyCut: { at: '2026-11-17', job: 'M00290', undone: true } }, base));
check('undone: no cut status', [und.includes('נחתך'), und.includes('לחיתוך'), und.includes('אופטימיזציה M00290')], [false, false, true]);
const none = row({ name: 'שקוף 8', w: 1, h: 1 });
check('not linked: nothing new', [none.includes('אופטימיזציה'), none.includes('נחתך')], [false, false]);
const wd = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
check('nothing new in workday/chisum', /optyCut|lgOptyCutState/.test(wd), false);
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
