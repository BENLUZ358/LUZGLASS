#!/usr/bin/env node
/**
 * Tests the price that reaches Hashavshevet on an order line.
 *
 * Order 1058 — the first real send ever made — arrived in Hashavshevet like
 * this:
 *
 *   8SMH   quantity 0.024   price 0.000   total 0.00
 *
 * while the same item key typed by hand into their own screen priced itself at
 * 171. Three separate faults on one path produced that, and only the first is
 * visible from the outside:
 *
 *   1. `price` was never sent. The line was built without it, on the assumption
 *      that Hashavshevet would price from the item card. They do not — that is
 *      the data-entry screen's behaviour, not the API's. A line with no price
 *      is stored at zero.
 *
 *   2. The handler passed `prices.client`. The node is `prices.clients`. The
 *      argument was undefined, so every client price fell through to global.
 *
 *   3. Client lists are stored under the Hashavshevet account key
 *      (prices/clients/14201) while the lookup is by client name. Without
 *      prices/clientKeys to translate, the lookup misses even when the node is
 *      spelled right.
 *
 * Faults 2 and 3 were harmless while no price was sent at all. Fixing only
 * fault 1 would have shipped 190 — the global price — to a customer whose list
 * says 171, on every line. That is why this file runs the real function against
 * the real shape rather than checking that a field exists.
 *
 * Run: node scripts/test-order-pricing.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-order.js'), 'utf8');
const DB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── run the real functions, not a copy of them ────────────────────────── */
const ctx = { module: {}, exports: {} };
vm.createContext(ctx);
for (const re of [/function areaM2[\s\S]*?\n}/, /function clientPricesByName[\s\S]*?\n}/,
                  /function buildLines[\s\S]*?\n  return \{ lines, preview, skipped \};\n}/]) {
  const m = SRC.match(re);
  if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); }
  vm.runInContext(m[0], ctx);
}
/* the browser's own area helper, to prove the two agree */
vm.runInContext((DB.match(/function lgCalcAreaM2[\s\S]*?\n}/) || [''])[0], ctx);

/* ── the exact live shape, as read from the database ───────────────────── */
const PRICES = {
  global:     { '8SMH': 190 },
  clients:    { '509': { '8SMH': 190 }, '14201': { '8SMH': 171 } },
  clientKeys: { '509': 'א.מ.מראות', '14201': 'המקום לאמבט' },
};
const ORDER_1058 = {
  orderNum: 'L1058', orderClient: 'המקום לאמבט',
  items: [{ sku: '8SMH', w: 110, h: 220, glassFullName: '8 מ"מ שקוף מחוסם' }],
};

const build = (order, prices) => ctx.buildLines(
  order, '14201', '1058', '31', '1', prices.global, ctx.clientPricesByName(prices));

/* ── the reported symptom ──────────────────────────────────────────────── */
{
  const { lines } = build(ORDER_1058, PRICES);
  check('a line is produced', lines.length, 1);
  check('and it carries a price at all', lines[0].price !== undefined, true);
  check('the price is not zero', lines[0].price !== '0.000', true);
  /* the customer's own list, not the global one — 171, not 190 */
  check('the price is the client list price', lines[0].price, '171.000');
  check('the quantity is the area in m²', lines[0].Quantity, '0.024');
  /* 0.024 × 171 = 4.104, which is what Hashavshevet will compute */
  check('so the document totals what the screen totals',
        Math.round(Number(lines[0].Quantity) * Number(lines[0].price) * 1000) / 1000, 4.104);
}

/* ── fault 2, in isolation ─────────────────────────────────────────────── */
/* the misspelling made the argument undefined, and undefined is silent */
{
  const { lines } = ctx.buildLines(ORDER_1058, '14201', '1058', '31', '1',
                                   PRICES.global, PRICES.client /* undefined */);
  check('without the client map the global price is what goes out', lines[0].price, '190.000');
}

/* ── fault 3, in isolation ─────────────────────────────────────────────── */
{
  const byName = ctx.clientPricesByName(PRICES);
  check('the account key is translated to the client name',
        Object.keys(byName).sort(), ['א.מ.מראות', 'המקום לאמבט']);
  check('and the list travels with it', byName['המקום לאמבט'], { '8SMH': 171 });
  /* an unknown key must not vanish — it keys by itself rather than disappearing */
  check('a list with no name keeps its key',
        Object.keys(ctx.clientPricesByName({ clients: { '999': { A: 1 } }, clientKeys: {} })), ['999']);
  check('and no price node at all is survivable', ctx.clientPricesByName({}), {});
  check('as is no clientKeys node',
        ctx.clientPricesByName({ clients: { '14201': { '8SMH': 171 } } }), { '14201': { '8SMH': 171 } });
}

/* ── a client with no list of their own ────────────────────────────────── */
{
  const other = { ...ORDER_1058, orderClient: 'לקוח ללא מחירון' };
  const { lines } = build(other, PRICES);
  check('falls back to the global price', lines[0].price, '190.000');
}

/* ── no price anywhere ─────────────────────────────────────────────────── */
/* A zero line reads in the document like an item given away, and nobody
   audits it. A missing item shows up in the modal and cannot be ignored. */
{
  const { lines, skipped } = build(ORDER_1058, { global: {}, clients: {}, clientKeys: {} });
  check('nothing is sent at zero', lines.length, 0);
  check('the item is skipped instead', skipped.length, 1);
  check('and the reason says why', /אין מחיר למק"ט/.test(skipped[0].reason), true);
}

/* ── the two area formulas must not drift apart ────────────────────────── */
/* the screen total and the document are computed by different code in different
   runtimes; if these diverge the two numbers quietly disagree */
for (const [w, h] of [[110, 220], [1900, 2100], [1, 1], [0, 500], [1885, 500]]) {
  check(`area agrees between server and browser for ${w}×${h}`,
        ctx.areaM2(w, h), ctx.lgCalcAreaM2(w, h));
}

/* ── the handler passes the right things ───────────────────────────────── */
check('the handler spells the node in the plural',
      /prices\.global, clientPricesByName\(prices\)/.test(SRC), true);
/* code only — the comment above the call names the old spelling on purpose */
const CODE = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('and prices.client is gone from the code', /prices\.client\b(?!s)/.test(CODE), false);
/* the same translation the browser does, kept deliberately in step */
check('firebase-db still builds it the same way',
      /clientP\[name\] = prices\|\|\{\};/.test(DB), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-pricing checks passed.');
