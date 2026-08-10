#!/usr/bin/env node
/**
 * Tests the shared filter helpers, and asserts that every filter engine in the
 * system offers both a glass-type and a client filter.
 *
 * There are five engines and they had drifted badly apart:
 *   admin main list      hardcoded glass list with no thickness, no client
 *   admin sketch queue   neither
 *   workday build tab    hardcoded glass list, client as a free-text box
 *   workday active tab   glass options were full item names, no client
 *   check station        the only one with a client filter
 *
 * The glass label is thickness + type — "8 שקוף" — with neither the SKU nor
 * the process part of the item name. Matching is on that pair rather than a
 * substring, so "8 שקוף" stops also matching "18 שקוף".
 *
 * Run: node scripts/test-filters.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

const parts = [
  SRC.match(/function lgGlassLabelOf[\s\S]*?\n}/),
  SRC.match(/function lgGlassTypesInOrders[\s\S]*?\n}/),
  SRC.match(/function lgOrderHasGlass[\s\S]*?\n}/),
  SRC.match(/function lgClientsInOrders[\s\S]*?\n}/),
  SRC.match(/function lgFillFilterSelect[\s\S]*?\n}/),
];
if (parts.some(p => !p)) { console.error('FAIL  could not extract the filter helpers'); process.exit(1); }
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);
const { lgGlassLabelOf, lgGlassTypesInOrders, lgOrderHasGlass,
        lgClientsInOrders, lgFillFilterSelect } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const CAT = {
  '8SMH':  { code: '8SMH',  mm: 8,  glass: 'שקוף' },
  '6AM':   { code: '6AM',   mm: 6,  glass: 'אפור' },
  '5MIRAH':{ code: '5MIRAH',mm: 5,  glass: 'מראה אפורה' },
  '18SMH': { code: '18SMH', mm: 18, glass: 'שקוף' },
};

/* ── the label ─────────────────────────────────────────────────────────── */
check('from the item itself', lgGlassLabelOf({ mm: 8, glass: 'שקוף' }, CAT), '8 שקוף');
check('through the sku when the item lacks the fields',
      lgGlassLabelOf({ sku: '8SMH' }, CAT), '8 שקוף');
check('lowercase sku still resolves', lgGlassLabelOf({ sku: '8smh' }, CAT), '8 שקוף');
check('the process part of the name is not in the label',
      lgGlassLabelOf({ sku: '8SMH', name: "8 מ''מ שקוף מחוסם" }, CAT), '8 שקוף');
check('no sku and no fields → no label', lgGlassLabelOf({ name: 'משהו' }, CAT), null);
check('unknown sku → no label', lgGlassLabelOf({ sku: 'NOPE' }, CAT), null);
check('a tinted mirror keeps its own label',
      lgGlassLabelOf({ sku: '5MIRAH' }, CAT), '5 מראה אפורה');

/* ── the trap the old substring matching fell into ────────────────────── */
{
  const order = { items: [{ sku: '18SMH' }] };
  check('"8 שקוף" does not match an 18mm sheet',
        lgOrderHasGlass(order, '8 שקוף', CAT), false);
  check('"18 שקוף" matches it', lgOrderHasGlass(order, '18 שקוף', CAT), true);
}

/* ── options come from the data, with counts, thin to thick ───────────── */
{
  const orders = [
    { orderClient: 'א.מ.מראות', items: [{ sku: '8SMH' }, { sku: '8SMH' }, { sku: '6AM' }] },
    { orderClient: 'גרין גלאס', items: [{ sku: '5MIRAH' }] },
    { orderClient: 'א.מ.מראות', items: [{ sku: '6AM' }] },
  ];
  check('types present, counted and sorted by thickness',
        lgGlassTypesInOrders(orders, CAT),
        [{ label: '5 מראה אפורה', count: 1 },
         { label: '6 אפור', count: 2 },
         { label: '8 שקוף', count: 2 }]);

  check('an itemFilter narrows it to the relevant items',
        lgGlassTypesInOrders(orders, CAT, it => it.sku === '6AM'),
        [{ label: '6 אפור', count: 2 }]);

  check('clients are deduped and sorted',
        lgClientsInOrders(orders), ['א.מ.מראות', 'גרין גלאס']);

  /* an order keeps its place if any one item matches */
  check('a mixed order matches on one of its types',
        lgOrderHasGlass(orders[0], '6 אפור', CAT), true);
  check('and not on a type it does not hold',
        lgOrderHasGlass(orders[1], '8 שקוף', CAT), false);
  check('no filter selected matches everything',
        lgOrderHasGlass(orders[0], '', CAT), true);
}

/* ── the select builder keeps the current choice ──────────────────────── */
{
  const sel = { value: '6 אפור', innerHTML: '' };
  lgFillFilterSelect(sel, [{ label: '6 אפור', count: 2 }, { label: '8 שקוף', count: 1 }], 'כל הזכוכיות');
  check('a still-valid choice survives a rebuild', sel.value, '6 אפור');
  check('the count is shown', sel.innerHTML.includes('6 אפור (2)'), true);

  const gone = { value: '12 קליר', innerHTML: '' };
  lgFillFilterSelect(gone, [{ label: '8 שקוף' }], 'כל הזכוכיות');
  check('a choice that no longer exists falls back to all', gone.value, '');

  const esc = { value: '', innerHTML: '' };
  lgFillFilterSelect(esc, ['<script>'], 'כל הלקוחות');
  check('option text is escaped', esc.innerHTML.includes('&lt;script&gt;'), true);
}

/* ── every engine offers both filters ─────────────────────────────────── */
const ENGINES = [
  ['admin.html',         'main list',      'gf',       'cf'],
  ['admin.html',         'sketch queue',   'sqFGlass', 'sqFClient'],
  ['workday.html',       'build tab',      'fGlass',   'fClient'],
  ['workday.html',       'active tab',     'wGlass',   'wClient'],
  ['check-station.html', 'list',           'fGlass',   'fClient'],
];
for (const [page, engine, glassId, clientId] of ENGINES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const has = id => new RegExp(`<select[^>]*id="${id}"`).test(html);
  check(`${page} · ${engine} · glass filter`,  has(glassId),  true);
  check(`${page} · ${engine} · client filter`, has(clientId), true);
}

/* no engine may go back to a hardcoded glass list */
for (const page of ['admin.html', 'workday.html', 'check-station.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const hardcoded = (html.match(/<option[^>]*>\s*\d+\s*מ["'׳״]{1,2}מ/g) || []).length;
  check(`${page} has no hardcoded glass options`, hardcoded, 0);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll filter checks passed.');
