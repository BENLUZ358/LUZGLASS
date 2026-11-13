#!/usr/bin/env node
/**
 * Tests for editing price lists inside the system (Ben, 10/11).
 *
 * The promise to Ben: a price change applies to NEW orders only. An order that
 * is already in the system keeps the price it had, on the screen and in what
 * is sent to Hashavshevet. lgPlanPriceChange keeps that promise by writing the
 * old price into orders/<id>/frozenPrices in the same write as the change.
 *
 * Runs the real functions from firebase-db.js, admin.html and
 * api/hashavshevet-order.js, not copies.
 *
 * Run: node scripts/test-pricelists-edit.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const DB = read('firebase-db.js'), API = read('api/hashavshevet-order.js'), ADMIN = read('admin.html');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = { console, lgFindPriceItem: () => null, _priceClientName: k => k };
vm.createContext(ctx);
const load = (src, re) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); }
  vm.runInContext(m[0].replace(/^const /, 'var '), ctx);
};
load(DB, /function lgPriceClientName[\s\S]*?\n}/);
load(DB, /function _buildClientP[\s\S]*?\n}/);
load(DB, /function lgCalcAreaM2[\s\S]*?\n}/);
load(DB, /const LG_MIN_AREA = \{[\s\S]*?\n\};/);
load(DB, /function lgBillAreaM2[\s\S]*?\n}/);
load(DB, /function lgOrderPpm2[\s\S]*?\n}/);
load(DB, /function lgCalcOrderTotal[\s\S]*?\n}/);
load(DB, /function lgPlanPriceChange[\s\S]*?\n  return \{ upd, log, frozenOrders \};\n}/);
load(ADMIN, /function lgBulkPriceChange[\s\S]*?\n  return \{ change, n, sample \};\n}/);
for (const re of [/function areaM2[\s\S]*?\n}/, /const LG_MIN_AREA = \{[\s\S]*?\n\};/, /function billAreaM2[\s\S]*?\n}/, /function clientPricesByName[\s\S]*?\n}/,
                  /const LG_LINE_TEXT_MAX = \d+;/, /const LG_HS_SEND_ITEMNAME = (?:true|false);/, /function lineText[\s\S]*?\n}/,
                  /function buildLines[\s\S]*?\n  return \{ lines, preview, skipped, hsLines, unpriced \};\n}/]) load(API, re);

const PRICES = {
  global:     { '8SMH': 190, '5MR': 120 },
  clients:    { '14201': { '8SMH': 171 } },
  clientKeys: { '14201': 'המקום לאמבט' },
};
const item = { sku: '8SMH', w: 1000, h: 1000 };
const ORDERS = [
  { id: 'open-plain',  orderClient: 'לקוח רגיל',   items: [item] },
  { id: 'open-client', orderClient: 'המקום לאמבט', items: [item] },
  { id: 'locked',      orderClient: 'לקוח רגיל',   items: [item], pricesLockedAt: 1 },
];

/* 1. global price change: freezes only the open order that pays global */
{
  const p = ctx.lgPlanPriceChange({ global: { '8SMH': 200 } }, PRICES, ORDERS);
  check('global price written', p.upd['prices/global/8SMH'], 200);
  check('open order on global keeps 190', p.upd['orders/open-plain/frozenPrices/8SMH'], 190);
  check('client with own price not frozen', p.upd['orders/open-client/frozenPrices/8SMH'], undefined);
  check('locked order not touched', p.upd['orders/locked/frozenPrices/8SMH'], undefined);
  check('one order frozen', p.frozenOrders, 1);
  check('log line', p.log, [{ scope: 'global', sku: '8SMH', from: 190, to: 200 }]);
}

/* 2. the frozen price wins on screen and in Hashavshevet */
{
  const o = Object.assign({}, ORDERS[0], { frozenPrices: { '8SMH': 190 } });
  const gpNew = { '8SMH': 200 };
  check('screen total uses frozen price', ctx.lgCalcOrderTotal(o, gpNew, {}), 190);
  const { lines } = ctx.buildLines(o, '99', '1', '31', '1', gpNew, {});
  check('Hashavshevet line uses frozen price', lines[0].price, '190.000');
  const fresh = ORDERS[0];
  check('new order uses new price', ctx.lgCalcOrderTotal(fresh, gpNew, {}), 200);
  check('Hashavshevet new order uses new price', ctx.buildLines(fresh, '99', '1', '31', '1', gpNew, {}).lines[0].price, '200.000');
}

/* 3. client price change: freezes only that client's open order */
{
  const p = ctx.lgPlanPriceChange({ clients: { '14201': { '8SMH': 160 } } }, PRICES, ORDERS);
  check('client price written', p.upd['prices/clients/14201/8SMH'], 160);
  check('client open order keeps 171', p.upd['orders/open-client/frozenPrices/8SMH'], 171);
  check('other client untouched', p.upd['orders/open-plain/frozenPrices/8SMH'], undefined);
}

/* 4. removing a client price sends him back to global → his open order frozen */
{
  const p = ctx.lgPlanPriceChange({ clients: { '14201': { '8SMH': null } } }, PRICES, ORDERS);
  check('client price deleted', p.upd['prices/clients/14201/8SMH'], null);
  check('open order keeps 171', p.upd['orders/open-client/frozenPrices/8SMH'], 171);
}

/* 5. deleting a whole list: one path, no overlapping child paths */
{
  const p = ctx.lgPlanPriceChange({ removeClients: ['14201'] }, PRICES, ORDERS);
  check('list removed', p.upd['prices/clients/14201'], null);
  check('key removed', p.upd['prices/clientKeys/14201'], null);
  check('no overlapping child path', Object.keys(p.upd).some(k => k.startsWith('prices/clients/14201/')), false);
  check('open order keeps 171', p.upd['orders/open-client/frozenPrices/8SMH'], 171);
}

/* 6. new list copied from global: same prices → nothing frozen */
{
  const p = ctx.lgPlanPriceChange({ clientKeys: { '700': 'לקוח רגיל' }, clients: { '700': { '8SMH': 190, '5MR': 120 } } }, PRICES, ORDERS);
  check('name written', p.upd['prices/clientKeys/700'], 'לקוח רגיל');
  check('nothing frozen (same price)', p.frozenOrders, 0);
}

/* 7. an order already frozen is not re-frozen at a newer price */
{
  const orders = [Object.assign({}, ORDERS[0], { frozenPrices: { '8SMH': 150 } })];
  const p = ctx.lgPlanPriceChange({ global: { '8SMH': 220 } }, PRICES, orders);
  check('frozen stays as it was', p.upd['orders/open-plain/frozenPrices/8SMH'], undefined);
}

/* 8. unchanged price → no write at all */
{
  const p = ctx.lgPlanPriceChange({ global: { '8SMH': 190 } }, PRICES, ORDERS);
  check('no-op', [p.log.length, Object.keys(p.upd).length], [0, 0]);
}

/* 9. bulk percent */
{
  const b = ctx.lgBulkPriceChange(PRICES, 5, 'global');
  check('global +5% rounded', b.change.global, { '8SMH': 200, '5MR': 126 });
  check('clients untouched', b.change.clients, {});
  const all = ctx.lgBulkPriceChange(PRICES, 5, 'all');
  check('all includes clients', all.change.clients, { '14201': { '8SMH': 180 } });
  const one = ctx.lgBulkPriceChange(PRICES, -10, 'c:14201');
  check('one client -10%', [one.change.global, one.change.clients], [{}, { '14201': { '8SMH': 154 } }]);
  check('count', all.n, 3);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
