#!/usr/bin/env node
/**
 * DB-00007 — תיקון הזמנות: החלפת סוג זכוכית + רישום מה שחשבשבת צריכה לקבל ידנית.
 * Run: node scripts/test-hs-corrections.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const FB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const writes = [];
const ctx = {
  console,
  lgVerifiedSession: () => ({ name: 'בן לוז', phone: '0500000000' }),
  lgStageToStatus: s => s, lgStatusToStage: s => s,
  _lgDb: { ref: p => ({ update: async u => { writes.push({ path: p, update: u }); } }) },
};
vm.createContext(ctx);
const pick = re => { const m = FB.match(re); if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); } return m[0]; };
vm.runInContext([
  pick(/function _lgClean[\s\S]*?\n}/),
  pick(/function lgNormalizeOrder[\s\S]*?\n}/),
  pick(/\/\/ ─── 9א\.[\s\S]*?\nasync function lgMarkInvoiced[\s\S]*?\n}/),
  pick(/function lgCalcAreaM2[\s\S]*?\n}/),
  pick(/function lgCalcOrderM2[\s\S]*?\n}/),
  pick(/function lgGroupByQuantityId[\s\S]*?\n}/),
  pick(/function lgResolveSkuCode[\s\S]*?\n}/),
  pick(/function lgCanEditInvoiceItems[\s\S]*?\n}/),
  pick(/function lgParseMm[\s\S]*?\n}/),
  pick(/function lgRepriceLockedItems[\s\S]*?\n}/),
  pick(/async function lgEditInvoiceItem\([\s\S]*?\n}/),
  pick(/function lgHsWasSent[\s\S]*?\n}/),
  pick(/function lgAddHsCorrection[\s\S]*?\n}/),
  pick(/function lgHsCorrectionQueue[\s\S]*?\n}/),
  pick(/async function lgMarkHsCorrectionDone[\s\S]*?\n}/),
  pick(/function lgPlanSkuChange[\s\S]*?\n}/),
  pick(/async function lgEditInvoiceItemSku[\s\S]*?\n}/),
].join('\n').replace(/^const /gm, 'var '), ctx);

const CATALOG = {
  '8SMH': { code: '8SMH', name: 'שקוף 8 מחוסם', glass: 'שקוף', mm: 8, proc: 'chisum' },
  '10SMH': { code: '10SMH', name: 'שקוף 10 מחוסם', glass: 'שקוף', mm: 10, proc: 'chisum', triplex: true },
  'OLD': { code: 'OLD', name: 'ישן', glass: 'x', mm: 4, active: false, proc: 'litush' },
};
const piece = (extra) => Object.assign({ sku: '8SMH', w: 1000, h: 1000, glassFullName: 'שקוף 8 מחוסם', name: 'שקוף 8 מחוסם', hsLine: 3 }, extra);
const order = (extra) => ctx.lgNormalizeOrder(Object.assign({
  id: 'o1', orderNum: 'L900', orderClient: 'לקוח', stage: 'collected', items: [piece(), piece({ hsLine: 4, w: 500 })],
  pricesLockedAt: 1, totalFinal: 200,
  lockedItems: [{ name: 'x', sku: '8SMH', w: 1000, h: 1000, area: 1, quantity: 1, quantityGroupId: null, pricePerM2: 200, lineTotal: 200 }],
}, extra));
const SENT = { hashavshevet: { sentAt: 5, httpOk: true, reference: '9001' } };
const last = () => writes[writes.length - 1].update;

(async () => {
  /* the field survives normalisation */
  check('hsCorrections survives normalisation',
        order({ hsCorrections: { a: { type: 'dims' } } }).hsCorrections, { a: { type: 'dims' } });

  /* glass change: not yet sent — fields move, nothing is logged */
  {
    writes.length = 0;
    const r = await ctx.lgEditInvoiceItemSku(order(), 0, '10SMH', { catalog: CATALOG, globalP: { '10SMH': 300 } });
    const u = last(), it = u.items[0];
    check('reports the change', [r.changed, r.fromSku, r.toSku], [true, '8SMH', '10SMH']);
    check('sku, name, mm, triplex updated', [it.sku, it.glassFullName, it.mm, it.triplex], ['10SMH', 'שקוף 10 מחוסם', 10, true]);
    check('dimensions untouched', [it.w, it.h], [1000, 1000]);
    check('the previous type is remembered', [it.skuChangedFrom, it.editedBy], ['8SMH', 'בן לוז']);
    check('locked price recomputed at the new price per m2', [u.totalFinal, r.oldTotal, r.newTotal], [300 + 100, 200, 400]);
    check('an unsent order logs no correction', Object.keys(u).some(k => k.startsWith('hsCorrections/')), false);
  }

  /* glass change on a sent order — logged in the same write, with the line number */
  {
    writes.length = 0;
    await ctx.lgEditInvoiceItemSku(order(SENT), 0, '10SMH', { catalog: CATALOG, globalP: { '10SMH': 300 } });
    const keys = Object.keys(last()).filter(k => k.startsWith('hsCorrections/'));
    check('one correction written, atomically with the edit', [keys.length, writes.length], [1, 1]);
    const c = last()[keys[0]];
    check('it carries line, type, from, to, not done',
          [c.hsLine, c.type, c.from, c.to, c.done], [3, 'glass', 'שקוף 8 מחוסם (8SMH)', 'שקוף 10 מחוסם (10SMH)', false]);
  }

  /* refusals */
  {
    const rej = async (name, fn, re) => { try { await fn(); check(name, 'resolved', 'rejected'); } catch (e) { check(name, re.test(e.message), true); } };
    await rej('unknown sku', () => ctx.lgEditInvoiceItemSku(order(), 0, 'NOPE', { catalog: CATALOG }), /לא נמצא/);
    await rej('inactive sku', () => ctx.lgEditInvoiceItemSku(order(), 0, 'OLD', { catalog: CATALOG }), /לא נמצא/);
    await rej('locked order with no price for the new type', () => ctx.lgEditInvoiceItemSku(order(), 0, '10SMH', { catalog: CATALOG, globalP: {} }), /אין מחיר/);
    await rej('missing item', () => ctx.lgEditInvoiceItemSku(order(), 9, '10SMH', { catalog: CATALOG, globalP: { '10SMH': 1 } }), /לא נמצא/);
    const inv = order({ invoiceDone: { markedAt: 1, markedBy: 'x', docNumber: '123' } });
    await rej('invoiced order is blocked', () => ctx.lgEditInvoiceItemSku(inv, 0, '10SMH', { catalog: CATALOG, globalP: { '10SMH': 1 } }), /חשבונית/);
    writes.length = 0;
    const same = await ctx.lgEditInvoiceItemSku(order(), 0, '8SMH', { catalog: CATALOG });
    check('same type is a no-op, nothing written', [same.changed, writes.length], [false, 0]);
  }

  /* a piece changed out of a quantity group leaves the group */
  {
    const o = order({ items: [piece({ quantityGroupId: 'g', originalQuantity: 2, groupIndex: 0 }), piece({ quantityGroupId: 'g', originalQuantity: 2, groupIndex: 1 })] });
    writes.length = 0;
    await ctx.lgEditInvoiceItemSku(o, 0, '10SMH', { catalog: CATALOG, globalP: { '10SMH': 300 } });
    const u = last();
    check('leaves its group', [u.items[0].quantityGroupId, u.items[1].quantityGroupId], [undefined, 'g']);
  }

  /* dimension edit on a sent order is logged too; on an unsent one it is not */
  {
    writes.length = 0;
    await ctx.lgEditInvoiceItem(order(SENT), 1, { w: 600, h: 1000 });
    const k = Object.keys(last()).filter(x => x.startsWith('hsCorrections/'));
    const c = last()[k[0]];
    check('dims correction logged', [k.length, c.type, c.hsLine, c.from, c.to], [1, 'dims', 4, '500×1000', '600×1000']);
    writes.length = 0;
    await ctx.lgEditInvoiceItem(order(), 1, { w: 600, h: 1000 });
    check('unsent order: no correction', Object.keys(last()).some(x => x.startsWith('hsCorrections/')), false);
    check('simulated send counts as unsent',
          ctx.lgHsWasSent(order({ hashavshevet: { sentAt: 5, simulated: true } })), false);
  }

  /* the queue: one row per line, first "from" to last "to", history kept */
  {
    const o = order({ hsCorrections: {
      a: { itemIndex: 0, hsLine: 3, type: 'dims', from: '1000×1000', to: '1100×1000', at: 10, by: 'א', done: false },
      b: { itemIndex: 0, hsLine: 3, type: 'dims', from: '1100×1000', to: '1200×1000', at: 20, by: 'ב', done: false },
      c: { itemIndex: 0, hsLine: 3, type: 'glass', from: 'X', to: 'Y', at: 15, by: 'ב', done: false },
      d: { itemIndex: 1, hsLine: 4, type: 'dims', from: '1×1', to: '2×2', at: 5, by: 'ג', done: true, doneAt: 50 },
    } });
    const q = ctx.lgHsCorrectionQueue([o], 'pending');
    check('pending: the repeated line appears once', q.length, 1);
    check('net change: first from, last to', q[0].net.dims, { from: '1000×1000', to: '1200×1000' });
    check('both kinds on the line, history kept', [Object.keys(q[0].net), q[0].history.length, q[0].keys.length], [['dims', 'glass'], 3, 3]);
    check('done filter', ctx.lgHsCorrectionQueue([o], 'done').map(r => r.hsLine), [4]);
    check('all filter', ctx.lgHsCorrectionQueue([o], 'all').length, 2);
    writes.length = 0;
    await ctx.lgMarkHsCorrectionDone('o1', q[0].keys);
    check('mark done writes done/doneAt/doneBy for every key',
          Object.keys(last()).length, 9);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
