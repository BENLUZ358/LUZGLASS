#!/usr/bin/env node
/**
 * The check station's order row (Ben, 19/10/2026, on the iPad):
 *   "the orders show no details — I want client name, glass type, and the order
 *    number / the customer's sketch name in the row. I see the order number only
 *    when I search. Make it nicer, by the design skill."
 *
 * Why it looked empty: the glass came from the ORDER (o.glassFullName), but orders
 * typed in the sketch queue carry the glass on their ITEMS only — so the glass tag
 * was always blank. The order number was there, 12px grey, after "🖼 יש סקיצה".
 *
 * Run: node scripts/test-cs-order-row.js
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
  if (i < 0) { console.error('FAIL  missing ' + name); process.exit(1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number });
vm.runInContext([
  bodyOf(DB, 'lgEsc'), bodyOf(DB, 'lgGlassLabelOf'), bodyOf(DB, 'lgGlassTypesInOrders'),
  'var csSkuCatalogMap = { "8HMH": { glass: "חלבי", mm: 8 } }; var cs = {}; var notes = {};',
  'function lgHasSketch(o){ return !!o.hasSketch; }',
  bodyOf(CS, 'csItemsOf'), bodyOf(CS, 'csGlassOf'), bodyOf(CS, 'chisumIdxs'),
  bodyOf(CS, 'csGlassSummary'), bodyOf(CS, 'csOrderRowHtml'),
].join('\n'), ctx);

const it = (glass, mm, extra) => Object.assign({ glass, mm, w: 600, h: 1500, chisum: true }, extra || {});
const order = (o) => Object.assign({ id: 'o1', orderClient: 'א.מ.מראות', orderNum: 'L1080', sketchName: '', hasSketch: true }, o);
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

{
  const o = order({ items: [it('שקוף', 8), it('שקוף', 8), it('שקוף', 8), it(null, null, { sku: '8HMH' })] });
  const html = ctx.csOrderRowHtml(o);
  check('the row names the client', /class="oc-client"[^>]*>א\.מ\.מראות</.test(html), true);
  check('the order number is its own, visible field', /class="oc-num"[^>]*>L1080</.test(html), true);
  check('a sketch with no name says so instead of a dash', /ללא שם לסקיצה/.test(text(html)), true);
  check('glass comes from the ITEMS, grouped with a count',
        JSON.parse(JSON.stringify(ctx.csGlassSummary(o))), [{ label: '8 שקוף', count: 3 }, { label: '8 חלבי', count: 1 }]);
  check('and is shown as chips, the most common first', /8 שקוף[\s\S]{0,60}×3[\s\S]*8 חלבי/.test(html), true);
  check('progress counts the chisum items', /0\/4/.test(text(html)), true);
}
{
  const o = order({ sketchName: 'שירה — התבור 6', items: [it('שקוף', 8)] });
  const html = ctx.csOrderRowHtml(o);
  check('the customer\'s sketch name is shown', /class="oc-name"[^>]*>שירה — התבור 6</.test(html), true);
  check('a single piece has no "×1" noise', /×1/.test(html), false);
}
{
  const o = order({ items: [it('שקוף', 8, { chisum: false })] });
  check('items that are not tempered are not counted as tempering glass', ctx.csGlassSummary(o).length, 0);
}
{
  const html = ctx.csOrderRowHtml(order({ orderClient: '<b>x</b>', sketchName: '<i>', items: [] }));
  check('everything typed by people is escaped', /<b>|<i>/.test(html), false);
}

/* design skill: no emoji as icons; touch targets 44px; iPad shows two columns */
{
  const row = bodyOf(CS, 'csOrderRowHtml');
  check('no emoji used as icons in the row', /📝|🖼|🔥|📎|📌/.test(row), false);
  check('the note button has a label for screen readers', /aria-label="הוסף הערה"/.test(row), true);
  check('the note button is a 44px target', /\.oc-note-btn\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/.test(CS), true);
  check('iPad and wider: the list is two columns', /@media\s*\(min-width:\s*900px\)\s*\{[^}]*#listView\.oc-grid[^}]*grid-template-columns:\s*repeat\(2/.test(CS), true);
  /* בן, 19/10, אייפון: הכרטיסים נמחצו לשורה אחת. ברשימה של טלפון (עמודת flex עם גלילה)
     הדפדפן מכווץ ילדים כדי שייכנסו — כרטיס חייב לא להתכווץ. */
  check('a card never shrinks in the phone list', /\.order-card\s*\{[^}]*flex-shrink:\s*0/.test(CS), true);
  check('renderList builds rows from the one function', /list\.map\(o\s*=>\s*csOrderRowHtml\(o\)\)/.test(bodyOf(CS, 'renderList')), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll check-station row checks passed.');
