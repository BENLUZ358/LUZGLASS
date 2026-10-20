#!/usr/bin/env node
/**
 * The check station's sketch screen (Ben, 19/10/2026, iPhone):
 *   "the buttons don't look good, and the X is confusing — it leaves the whole
 *    check station. Fix the look by the design skill, without touching logic."
 *
 * What was wrong:
 *   - ✕ sat next to "← רשימה" on the sketch screen, so "close this sketch" and
 *     "leave the station" looked the same. Inside a sketch there is ONE way out: back to the list.
 *   - the client name was shown twice (top bar, truncated, and the header), while the
 *     glass was blank (o.glassFullName is empty on queue-typed orders).
 *   - the back button was a gold block, the strongest thing on screen, competing
 *     with "סיים סקיצה" — the action the screen exists for.
 *
 * Run: node scripts/test-cs-sketch-view.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CS = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
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
const tag = id => (CS.match(new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>[\\s\\S]*?</(button|a|div)>')) || [''])[0];

/* ── the exit: only on the list, and it says what it does ── */
{
  const exit = tag('csExitBtn');
  check('the exit is not a bare ✕', /✕/.test(exit), false);
  check('the exit has an icon and a word', /data-icon="logout"[\s\S]*יציאה/.test(exit), true);
  check('the exit still goes to admin.html', /href="admin\.html"/.test(exit), true);
  check('opening a sketch hides the exit', /_csShow\('csExitBtn',\s*'none'\)/.test(bodyOf(CS, 'showSketch')), true);
  check('back on the list the exit shows again', /csExitBtn'\)\.style\.display\s*=\s*''/.test(bodyOf(CS, 'showList')), true);
}

/* ── back: an RTL arrow icon, quiet, not a gold block ── */
{
  const back = tag('btnBack');
  check('back uses the arrow icon, not a typed arrow', /data-icon="arrow-right"/.test(back) && !/←/.test(back), true);
  check('back still calls goBack()', /onclick="goBack\(\)"/.test(back), true);
  check('back has a screen-reader label', /aria-label="חזרה לרשימה"/.test(back), true);
  check('back is no longer a gold block on iPad/phone', /#btnBack\s*\{[^}]*background:\s*var\(--gold\)/.test(CS), false);
}

/* ── header: order number chip, sketch name, glass from the items — client once ── */
{
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number });
  vm.runInContext([
    bodyOf(DB, 'lgEsc'), bodyOf(DB, 'lgGlassLabelOf'), bodyOf(DB, 'lgGlassTypesInOrders'),
    'var csSkuCatalogMap = {};',
    bodyOf(CS, 'csItemsOf'), bodyOf(CS, 'csGlassOf'), bodyOf(CS, 'csGlassSummary'), bodyOf(CS, 'csGlassChipsHtml'), bodyOf(CS, 'csSketchMetaHtml'),
  ].join('\n'), ctx);
  const it = (glass, mm) => ({ glass, mm, w: 600, h: 1500, chisum: true });
  const html = ctx.csSketchMetaHtml({ orderClient: 'א.מ.מראות', orderNum: 'L1075', sketchName: '3498', items: [it('שקוף', 8), it('שקוף', 8)] });
  check('the order number is a chip', /class="oc-num"[^>]*>L1075</.test(html), true);
  check('the sketch name is shown', /class="oc-name"[^>]*>3498</.test(html), true);
  check('glass comes from the items', /8 שקוף[\s\S]{0,40}×2/.test(html), true);
  check('the client is not repeated in the header', /א\.מ\.מראות/.test(html), false);
  const noName = ctx.csSketchMetaHtml({ orderNum: 'L1', sketchName: '', items: [] });
  check('no sketch name says so', /ללא שם לסקיצה/.test(noName), true);
  check('typed text is escaped', /<i>/.test(ctx.csSketchMetaHtml({ orderNum: '<i>', sketchName: '<i>', items: [] })), false);
  check('selectOrder fills the header from that function', /shMeta'\)\.innerHTML\s*=\s*csSketchMetaHtml\(cur\)/.test(bodyOf(CS, 'selectOrder')), true);
}

/* ── bottom bar: one primary, one secondary, 44px, logic untouched ── */
{
  const btm = (CS.match(/<div class="btmbar" id="btmbar">[\s\S]*?\n  <\/div>/) || [''])[0];
  /* בן, 20/10: "סיים סקיצה" נלחץ בטעות בלחץ העבודה — הוא כבר לא הכפתור הבולט.
     ערוך הוא הפעולה הראשית; סיים סקיצה שקט, בקצה השני, ושואל לפני. */
  check('ערוך is the main button', /class="tb-btn tb-primary"[^>]*onclick="openEditor\(\)"/.test(btm), true);
  check('סיים סקיצה is a quiet outline button, not the green block', /class="tb-btn tb-finish"[^>]*id="finishBtn"/.test(btm) && !/id="finishBtn"[^>]*tb-green|tb-green[^>]*id="finishBtn"/.test(btm), true);
  check('…and does not stretch across the bar', /#finishBtn\s*\{[^}]*flex:\s*1/.test(CS), false);
  check('סיים סקיצה still finishes', /id="finishBtn"[^>]*onclick="finishSketch\(\)"/.test(btm), true);
  check('zoom buttons still zoom', /doZoom\(0\.25\)[\s\S]*doZoom\(-0\.25\)[\s\S]*resetZoom\(\)/.test(btm), true);
  check('the reset button is an icon, not a typed ↺', /↺/.test(btm), false);
  check('every top/bottom bar button is 44px tall', /\.tb-btn\s*\{[^}]*min-height:\s*44px/.test(CS), true);
  check('פריטים still opens the sheet', /id="btnSheet"[^>]*onclick="toggleSheet\(\)"/.test(CS), true);
  check('pressed feedback on the bar buttons', /\.tb-btn:active\s*\{/.test(CS), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll check-station sketch-view checks passed.');
