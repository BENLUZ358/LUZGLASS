#!/usr/bin/env node
/**
 * צורות בחיסום (בן, 17/11): "מבולגן לי בעין" — ברשימת החיסום לא מופיעים 📐/אופטימיזציה/נתק ליד כל פריט.
 * לכל סקיצה כפתור "📐 צורות (N)" שפותח אותן לסקיצה הזאת בלבד, ולחיצה נוספת סוגרת.
 * Run: node scripts/test-chisum-shapes-hidden.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const WD = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const bodyOf = name => {
  const i = WD.search(new RegExp('function ' + name + '\\(')); if (i < 0) { console.error('missing ' + name); process.exit(1); }
  let d = 0, j = WD.indexOf('{', i); for (; j < WD.length; j++) { if (WD[j] === '{') d++; else if (WD[j] === '}' && !--d) break; }
  return WD.slice(i, j + 1);
};
let renders = 0;
const T = { open: { 'r1_נאור': true }, color: '#8e44ad', render: () => { renders++; } };
const ctx = vm.createContext({
  LG_TRACK: { triplex: {}, chisum: T }, _tr: () => T, _lblGroups: {},
  _markedIdxSet: () => new Set(), _pendingIdxsOf: o => o.items.map((_, i) => i),
  lgEsc: s => String(s == null ? '' : s), lgJsStr: s => String(s), lgDimsText: (w, h) => w + '×' + h,
  lgHasSketch: () => true, wdLabelBtn: () => '<i>🏷</i>', wdPendingStrip: () => '<div class="pend">עוד לא חוברו</div>',
  _wdPendOpen: () => [], lgOptyChip: (o, i) => o.items[i].optyShape ? '<b class="lg-opty-chip">📐 ' + o.items[i].optyShape + '</b>' : '',
  wdJobTag: (o, i) => o.items[i].optyJob ? '<span class="wd-opty-job">אופטימיזציה ' + o.items[i].optyJob + '</span>' : '',
});
vm.runInContext(['_chisumClientCardHtml', 'wdToggleShapes'].map(bodyOf).join('\n') + '\nvar wdShapesOpen = new Set();', ctx);
const orders = [
  { id: 'A', sketchName: 'מקלחון', items: [{ name: 'זכוכית 8', w: 500, h: 1900, optyShape: '274328', optyJob: 'M00290' }, { name: 'זכוכית 8', w: 600, h: 1900 }] },
  { id: 'B', sketchName: 'מראה', items: [{ name: 'מראה 5', w: 700, h: 900 }] },
];
let html = ctx._chisumClientCardHtml('נאור', orders, 'r1', 'chisum');
check('list: no shape, optimisation or unlinked strip beside items', [/lg-opty-chip|wd-opty-job|class="pend"/.test(html)], [false]);
check('sketch with a shape gets a "📐 צורות (1)" button; sketch without shapes gets none', [(html.match(/data-wdshapes="/g) || []).length, /צורות \(1\)/.test(html)], [1, true]);
ctx.wdToggleShapes('A', 'chisum');
html = ctx._chisumClientCardHtml('נאור', orders, 'r1', 'chisum');
check('press "צורות" → that sketch shows its shapes, optimisation and strip, re-rendered', [/📐 274328/.test(html), /אופטימיזציה M00290/.test(html), /class="pend"/.test(html), /הסתר צורות/.test(html), renders], [true, true, true, true, 1]);
ctx.wdToggleShapes('A', 'chisum');
html = ctx._chisumClientCardHtml('נאור', orders, 'r1', 'chisum');
check('press again → hidden again', /lg-opty-chip/.test(html), false);
if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
