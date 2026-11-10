#!/usr/bin/env node
/** תחנת חשבוניות: קיבוץ לפי כרטיס חשבשבת (בן 10/11 — פלג 07 בלי טלפון). Run: node scripts/test-invoice-group-card.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'invoices.html'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(`
  function lgInvoiceState(o){ return o.st; }
  function lgInvoiceCounts(os){ return { changed:0, open: os.length, pending: os.length, verified:0 }; }
  function lgIsMonthlyOrder(){ return false; }
  function lgHsReference(){ return ''; }
  ${SRC.match(/function lgClientKey[\s\S]*?\n}/)[0]}
  ${SRC.match(/function lgInvoiceGroups[\s\S]*?\n}/)[0]}
  this.G = lgInvoiceGroups;`, ctx);
const o = (id, extra) => ({ id, orderNum: 'L' + id, st: 'pending', orderClient: 'פלג', ...extra });
const gs = ctx.G([
  o(1, { customerId: '07' }), o(2, { customerId: '07' }), o(3, { customerId: '07', phone: '0546316788' }),
  o(4, { orderClient: 'טל', phone: '0501' }), o(5, { orderClient: 'טל', phone: '050-1' }),
  o(6, { orderClient: 'בלי כלום' }), o(7, { orderClient: 'בלי כלום' }),
  o(8, { customerId: '07', st: 'invoiced' }),
], '');
const peleg = gs.find(g => g.key === 'card:07');
check('all open Peleg orders under one card', peleg && peleg.ords.map(x => x.id), [1, 2, 3]);
check('card group shows the card', peleg && peleg.card, '07');
check('card group keeps a phone if one order has it', peleg && peleg.phone, '0546316788');
check('phone customers still grouped by phone', gs.filter(g => g.name === 'טל').map(g => g.ords.length), [2]);
check('no card and no phone → each order alone', gs.filter(g => g.name === 'בלי כלום').length, 2);
check('search by name finds the card group', ctx.G([o(1, { customerId: '07' }), o(2, { customerId: '07' })], 'פלג').length, 1);
check('the list shows the card number', /כרטיס ' \+ esc\(g\.card\)/.test(HTML), true);
check('the sketch name gets its own bold line', /class="ord-sketch"/.test(HTML) && /\.ord-sketch\{/.test(HTML), true);
console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
