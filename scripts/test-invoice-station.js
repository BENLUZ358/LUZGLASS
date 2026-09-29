#!/usr/bin/env node
/**
 * The invoice station's data layer — stage 2 of INVOICE_STATION_BUILD.md.
 *
 * Two independent fields on the order, never folded into `stage`:
 *   invoiceCheck — the items were compared with the sketch ("מאומתת")
 *   invoiceDone  — the invoice was produced by hand in Hashavshevet, with its number
 *
 * THE PROPERTY THAT MATTERS MOST: "verified" means the items the worker saw.
 * An order verified at 10:00 and edited at 11:00 must not be invoiced at 14:00
 * on the 10:00 check. itemsHash is what catches it, and the state it produces
 * ('changed') sends the order back for another look.
 *
 * Ben's rulings (2026-09-28), each guarded below:
 *   1. the document number is mandatory
 *   2. one invoice may cover several orders — same number, marked together
 *   3. only Ben (isMainAdmin) revokes a verification, with a reason, before invoicing
 *   4. orders cancelled in Hashavshevet are marked by hand (no report yet)
 *
 * Run: node scripts/test-invoice-station.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const FB    = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── run the real functions, not a copy of them ────────────────────────── */
const writes = [];
let session  = { name: 'בן לוז', phone: '0500000000', isMainAdmin: true };
const ctx = {
  console,
  lgVerifiedSession: () => session,
  // stage ↔ status is a separate table and not what this file tests
  lgStageToStatus: s => s,
  lgStatusToStage: s => s,
  _lgDb: { ref: p => ({ update: async u => { writes.push({ path: p, update: u }); } }) },
};
vm.createContext(ctx);
const pick = re => {
  const m = FB.match(re);
  if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); }
  return m[0];
};
vm.runInContext([
  pick(/function _lgClean[\s\S]*?\n}/),
  pick(/function lgNormalizeOrder[\s\S]*?\n}/),
  pick(/\/\/ ─── 9א\.[\s\S]*?\nasync function lgMarkInvoiced[\s\S]*?\n}/),
].join('\n').replace(/^const /gm, 'var '), ctx);

const ITEMS = [
  { sku: '8SMH', w: 885, h: 1985, glassFullName: 'שקוף 8 מחוסם' },
  { sku: '8SMH', w: 600, h: 2000, glassFullName: 'שקוף 8 מחוסם' },
];
const order = (extra) => ctx.lgNormalizeOrder(Object.assign(
  { id: 'o1', orderNum: 'L1067', stage: 'collected', items: ITEMS.map(i => ({ ...i })) }, extra));

/* ── the fields survive normalisation ──────────────────────────────────── */
{
  const o = order({ invoiceCheck: { verifiedAt: 5, verifiedBy: 'x', itemsHash: 'h' },
                    invoiceDone:  { markedAt: 6, markedBy: 'y', docNumber: '4821' } });
  check('invoiceCheck survives lgNormalizeOrder', o.invoiceCheck && o.invoiceCheck.itemsHash, 'h');
  check('invoiceDone survives lgNormalizeOrder',  o.invoiceDone && o.invoiceDone.docNumber, '4821');
  check('an order without them normalises to null, not undefined',
        [order({}).invoiceCheck, order({}).invoiceDone], [null, null]);
  check('invoiceDone without a number is no invoice at all',
        order({ invoiceDone: { markedAt: 6 } }).invoiceDone, null);
}

/* ── the hash ──────────────────────────────────────────────────────────── */
{
  const h = ctx.lgItemsHash(ITEMS);
  check('the hash is stable', ctx.lgItemsHash(ITEMS.map(i => ({ ...i }))), h);
  check('an array and a Firebase object of the same items agree',
        ctx.lgItemsHash({ a: ITEMS[0], b: ITEMS[1] }), h);
  check('a changed width changes it',  ctx.lgItemsHash([{ ...ITEMS[0], w: 886 }, ITEMS[1]]) !== h, true);
  check('a changed SKU changes it',    ctx.lgItemsHash([{ ...ITEMS[0], sku: '8HMH' }, ITEMS[1]]) !== h, true);
  check('a removed item changes it',   ctx.lgItemsHash([ITEMS[0]]) !== h, true);
  check('two items swapping places changes it', ctx.lgItemsHash([ITEMS[1], ITEMS[0]]) !== h, true);
  check('a price or note does not — the check is about the glass, not the money',
        ctx.lgItemsHash(ITEMS.map(i => ({ ...i, price: 999, note: 'x' }))), h);
  check('the hsLine number written back by Hashavshevet does not either',
        ctx.lgItemsHash(ITEMS.map((i, k) => ({ ...i, hsLine: k + 1 }))), h);
}

/* ── the four states ───────────────────────────────────────────────────── */
{
  const hash = ctx.lgItemsHash(ITEMS);
  const ver  = { verifiedAt: 10, verifiedBy: 'x', itemsHash: hash };
  check('not collected → not in the station', ctx.lgInvoiceState(order({ stage: 'ready' })), null);
  check('collected, never checked → pending', ctx.lgInvoiceState(order({})), 'pending');
  check('checked, items untouched → verified', ctx.lgInvoiceState(order({ invoiceCheck: ver })), 'verified');
  {
    const o = order({ invoiceCheck: ver });
    o.items[0].w = 890;
    check('checked, then an item changed → changed', ctx.lgInvoiceState(o), 'changed');
  }
  check('a revoked check is pending again',
        ctx.lgInvoiceState(order({ invoiceCheck: { ...ver, revokedAt: 20 } })), 'pending');
  check('a document number → invoiced',
        ctx.lgInvoiceState(order({ invoiceCheck: ver, invoiceDone: { markedAt: 30, docNumber: '4821' } })), 'invoiced');
  check('an order invoiced through the old API stays invoiced, not back to pending',
        ctx.lgInvoiceState(order({ hashavshevetInvoice: { sentAt: 1, httpOk: true } })), 'invoiced');
  check('a failed old API attempt is not an invoice',
        ctx.lgInvoiceState(order({ hashavshevetInvoice: { sentAt: 1, httpOk: false } })), 'pending');
  check('and every state it returns is a declared one',
        ['pending', 'verified', 'changed', 'invoiced'].every(s => ctx.LG_INVOICE_STATES.includes(s)), true);
}

/* ── the counters and the gate ─────────────────────────────────────────── */
{
  const hash = ctx.lgItemsHash(ITEMS);
  const V = order({ id: 'v', invoiceCheck: { verifiedAt: 1, itemsHash: hash } });
  const P = order({ id: 'p' });
  const C = order({ id: 'c', invoiceCheck: { verifiedAt: 1, itemsHash: 'stale' } });
  const n = ctx.lgInvoiceCounts([V, P, C]);
  check('counts each state', [n.pending, n.verified, n.changed], [1, 1, 1]);
  check('the gate is shut while anything is pending or changed', n.gateOpen, false);
  check('a changed order holds the gate like a pending one', ctx.lgInvoiceCounts([V, C]).gateOpen, false);
  check('all verified → the gate opens', ctx.lgInvoiceCounts([V]).gateOpen, true);
  check('nothing to invoice → the gate stays shut', ctx.lgInvoiceCounts([]).gateOpen, false);
}

/* ── ruling 1: the document number is mandatory ────────────────────────── */
{
  check('empty is refused',     ctx.lgDocNumberParse('   ').ok, false);
  check('letters are refused',  ctx.lgDocNumberParse('48a1').ok, false);
  check('digits are accepted, trimmed', ctx.lgDocNumberParse(' 4821 ').docNumber, '4821');
  check('leading zeros do not make a second number', ctx.lgDocNumberParse('04821').docNumber, '4821');
}

/* ── ruling 2: one invoice for several orders, but never twice ─────────── */
{
  const done = order({ id: 'old', orderNum: 'L1001', invoiceDone: { markedAt: 1, docNumber: '4821' } });
  check('the same number on an order outside the selection is a duplicate',
        ctx.lgDocNumberConflicts([done], '4821', ['o1']).map(o => o.id), ['old']);
  check('the same number across orders marked together is fine',
        ctx.lgDocNumberConflicts([done], '4821', ['old', 'o1']).length, 0);
}

(async () => {
  const hash = ctx.lgItemsHash(ITEMS);
  const V1 = order({ id: 'a', orderNum: 'L1067', invoiceCheck: { verifiedAt: 1, itemsHash: hash } });
  const V2 = order({ id: 'b', orderNum: 'L1068', invoiceCheck: { verifiedAt: 1, itemsHash: hash } });
  const P  = order({ id: 'p', orderNum: 'L1069' });

  /* verifying stores the hash of what the worker saw */
  writes.length = 0;
  await ctx.lgVerifyInvoice('o1', ITEMS, 'נבדק');
  const w = writes[0];
  check('verify writes to the order', w.path, 'orders/o1');
  check('with the hash of the items shown', w.update.invoiceCheck.itemsHash, hash);
  check('and who did it', w.update.invoiceCheck.verifiedBy, 'בן לוז');
  check('and never touches stage', 'stage' in w.update, false);

  /* marking invoiced: several orders, one number */
  writes.length = 0;
  const r = await ctx.lgMarkInvoiced([V1, V2], '4821', [V1, V2, P]);
  check('two orders marked with one number', r, { docNumber: '4821', count: 2 });
  const u = writes[0].update;
  check('both get the same document number', [u['a/invoiceDone'].docNumber, u['b/invoiceDone'].docNumber], ['4821', '4821']);
  check('in one multi-path write, so it is all or nothing', writes.length, 1);

  const rejects = async (name, fn, re) => {
    try { await fn(); check(name, 'no error', 'error'); }
    catch (e) { check(name, re.test(e.message), true); }
  };
  await rejects('marking without a number is refused',
    () => ctx.lgMarkInvoiced([V1], '', [V1]), /חובה/);
  await rejects('marking an unverified order is refused — nothing is marked',
    () => ctx.lgMarkInvoiced([V1, P], '4822', [V1, P]), /לא מאומתות/);
  {
    const done = order({ id: 'old', orderNum: 'L1001', invoiceDone: { markedAt: 1, docNumber: '4823' } });
    await rejects('a number already used on another order is refused',
      () => ctx.lgMarkInvoiced([V1], '4823', [V1, done]), /כבר רשום/);
  }

  /* ruling 3: only Ben revokes, with a reason, before invoicing */
  const C = order({ id: 'c', invoiceCheck: { verifiedAt: 1, itemsHash: hash } });
  const I = order({ id: 'i', invoiceCheck: { verifiedAt: 1, itemsHash: hash }, invoiceDone: { markedAt: 2, docNumber: '9' } });
  check('Ben may revoke a verified order', ctx.lgCanRevokeInvoiceCheck(session, C), true);
  check('not once it is invoiced', ctx.lgCanRevokeInvoiceCheck(session, I), false);
  check('nobody else may', ctx.lgCanRevokeInvoiceCheck({ name: 'עובד', isMainAdmin: false }, C), false);
  await rejects('revoking without a reason is refused', () => ctx.lgRevokeInvoiceCheck(C, '  '), /סיבה/);
  writes.length = 0;
  await ctx.lgRevokeInvoiceCheck(C, 'המידה בשורה 2 שגויה');
  const rv = writes[0].update;
  check('revoking keeps the record and adds who and why — it does not delete',
        ['invoiceCheck/revokedAt' in rv, rv['invoiceCheck/revokedBy'], rv['invoiceCheck/revokeReason'], 'invoiceCheck' in rv],
        [true, 'בן לוז', 'המידה בשורה 2 שגויה', false]);
  session = { name: 'עובד', phone: '0511111111', isMainAdmin: false };
  await rejects('a worker calling it directly is refused', () => ctx.lgRevokeInvoiceCheck(C, 'סיבה'), /רק בן/);

  /* the database backs the same rules up */
  const O = RULES.rules.orders.$orderId;
  check('the database only accepts a revocation from the main admin',
        /isMainAdmin'\)\.val\(\) === true/.test(O.invoiceCheck.revokedAt['.validate']), true);
  check('and only a digits-only document number',
        /\^\[0-9\]\{1,12\}\$/.test(O.invoiceDone.docNumber['.validate']), true);

  /* ── grouping by client: the same key the admin billing screen uses ── */
  {
    vm.runInContext([
      pick(/function lgHsReference[\s\S]*?\n}/),
      pick(/function lgClientKey[\s\S]*?\n}/),
      pick(/function lgInvoiceGroups[\s\S]*?\n}/),
    ].join('\n'), ctx);
    const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8').replace(/\r\n/g, '\n');
    const billKeySrc = (ADMIN.match(/function _billKey[\s\S]*?\n}/) || [''])[0];
    check('admin still has _billKey to compare against', billKeySrc.length > 0, true);
    vm.runInContext(billKeySrc, ctx);
    const samples = [{ clientPhone: '050-111 1111' }, { phone: '0502222222' }, { clientPhone: '', phone: '' }, {}];
    check('lgClientKey and admin _billKey agree on every sample',
          samples.map(o => ctx.lgClientKey(o)), samples.map(o => ctx._billKey(o)));

    const hash = ctx.lgItemsHash(ITEMS);
    const all = [
      order({ id: 'g1', orderNum: 'L1', orderClient: 'א.מ מראות', clientPhone: '050-1111111' }),
      order({ id: 'g2', orderNum: 'L2', orderClient: 'א.מ מראות', clientPhone: '0501111111', invoiceCheck: { verifiedAt: 1, itemsHash: 'stale' } }),
      order({ id: 'g3', orderNum: 'L3', orderClient: 'טל', clientPhone: '0502222222', invoiceCheck: { verifiedAt: 1, itemsHash: hash } }),
      order({ id: 'g4', orderNum: 'L4', orderClient: 'טל', clientPhone: '0502222222', invoiceDone: { markedAt: 1, docNumber: '7' } }),
      order({ id: 'g5', orderNum: 'L5', orderClient: 'בלי', clientPhone: '' }),
      order({ id: 'g6', orderNum: 'L6', orderClient: 'בלי', clientPhone: '' }),
      order({ id: 'g7', orderNum: 'L7', orderClient: 'טל', clientPhone: '0502222222', stage: 'ready' }),
    ];
    const gs = ctx.lgInvoiceGroups(all, '');
    check('one phone written two ways is one client', gs.filter(g => g.name === 'א.מ מראות').length, 1);
    check('an invoiced order has left the station', gs.find(g => g.phone === '0502222222').ords.map(o => o.id), ['g3']);
    check('an order not yet collected is not there either', gs.some(g => g.ords.some(o => o.id === 'g7')), false);
    check('orders with no phone never share a group — one invoice cannot cover two people',
          gs.filter(g => !g.phone).map(g => g.ords.length), [1, 1]);
    check('a client with a changed order comes first', gs[0].name, 'א.מ מראות');
    check('search by order number finds the client', ctx.lgInvoiceGroups(all, 'L3').map(g => g.name), ['טל']);
    check('search by phone ignores dashes', ctx.lgInvoiceGroups(all, '050-222').map(g => g.name), ['טל']);
  }

  /* ── האסמכתא בחשבשבת ───────────────────────────────────────────────────
     The bridge in the other direction. The secretary is looking at invoice
     10683 in Hashavshevet and needs the order behind it; without the number
     on screen she has to know by heart that 10683 is L1068-3.

     The number is OURS — toReference strips the non-digits off the order
     number and sends it — so it is read from the record of the send and
     never recomputed here. A computed number would appear on an order that
     was never sent, pointing at a document that does not exist. */
  {
    const sent = (hs) => ctx.lgNormalizeOrder({
      id: 'r1', orderNum: 'L1068-3', stage: 'collected', items: ITEMS, hashavshevet: hs,
    });
    check('the reference survives normalisation',
          sent({ reference: '10683', sentAt: 5, httpOk: true }).hsOrder.reference, '10683');
    check('and the bulky parts of the record do not',
          Object.keys(sent({ reference: '10683', httpOk: true, response: 'x'.repeat(4000),
                             requestSample: { a: 1 } }).hsOrder).sort(),
          ['httpOk', 'reference', 'sentAt', 'simulated']);
    check('an order never sent carries none at all', sent(null).hsOrder, null);
    check('…and shows nothing', ctx.lgHsReference(sent(null)), '');
    check('a send that was rejected shows nothing either',
          ctx.lgHsReference(sent({ reference: '10683', httpOk: false })), '');
    check('a fictitious order shows nothing — there is no document to find',
          ctx.lgHsReference(sent({ reference: '10683', httpOk: true, simulated: true })), '');
    check('a real one shows the number',
          ctx.lgHsReference(sent({ reference: '10683', httpOk: true })), '10683');

    const mk = (num, ref) => ctx.lgNormalizeOrder({
      // הטלפון בכוונה בלי ספרות חוזרות: החיפוש בודק גם אותו, ומספר כמו
      // 0509999999 היה נתפס על ידי כל מחרוזת של תשיעיות ומסתיר כישלון אמיתי
      id: num, orderNum: num, orderClient: 'המקום לאמבט', clientPhone: '0541230000',
      stage: 'collected', items: ITEMS,
      hashavshevet: ref ? { reference: ref, httpOk: true } : null,
    });
    const refAll = [mk('L1068-3', '10683'), mk('L1070', null)];
    check('typing the Hashavshevet reference finds the client',
          ctx.lgInvoiceGroups(refAll, '10683').map(g => g.name), ['המקום לאמבט']);
    check('a reference nobody has finds nothing',
          ctx.lgInvoiceGroups(refAll, '99999').length, 0);
    check('searching by our own order number still works',
          ctx.lgInvoiceGroups(refAll, 'L1070').map(g => g.name), ['המקום לאמבט']);
  }

  /* ── the page uses the shared functions and decides nothing itself ── */
  {
    const PAGE = fs.readFileSync(path.join(ROOT, 'invoices.html'), 'utf8');
    check('the page exists and links the shared design base', /lg-ui\.css/.test(PAGE), true);
    check('it defines no :root of its own', /:root\s*\{/.test(PAGE), false);
    check('it is admin-only', /lgRequireAuthAsync\('admin'\)/.test(PAGE), true);
    check('it reads state only through lgInvoiceState', /\.invoiceCheck\.itemsHash|itemsHash\s*===/.test(PAGE), false);
    check('the gate marks through lgMarkInvoiced, not a direct write', /lgMarkInvoiced\(/.test(PAGE) && !/_lgDb\.ref/.test(PAGE), true);
    check('it never calls the old API invoicing', /hashavshevet-invoice/.test(PAGE), false);
    check('the admin menu points at it',
          /href="invoices\.html"/.test(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')), true);
  }

  /* ── תיקון מידה · lgEditInvoiceItem ───────────────────────────────────
     The half of the correction workflow that lives on our side: in Hashavshevet
     the line gets "בטל יתרה לאספקה" and a new one by hand, and here the
     measurement itself changes. Two properties matter more than the write:
       1. a verified order goes straight back to 'changed' — the hash does it,
          and invoiceCheck is NOT deleted, so who verified and when survives
       2. a locked order's money follows the measurement, in lockedItems AND in
          totalFinal, or the admin card keeps showing the measurement we fixed  */
  {
    vm.runInContext([
      pick(/function lgCalcAreaM2[\s\S]*?\n}/),
      pick(/function lgCalcOrderM2[\s\S]*?\n}/),
      pick(/function lgGroupByQuantityId[\s\S]*?\n}/),
    ].join('\n'), ctx);

    const GLASS  = 'שקוף 8 מחוסם';
    const piece  = (extra) => Object.assign({ sku: '8SMH', w: 1000, h: 1000, glassFullName: GLASS }, extra);
    const locked = (items) => ctx.lgNormalizeOrder({
      id: 'e1', orderNum: 'L900', stage: 'collected', items,
      pricesLockedAt: 1, totalFinal: 200,
      lockedItems: [{ name: GLASS, sku: '8SMH', w: 1000, h: 1000, area: 1,
                      quantity: 1, quantityGroupId: null, pricePerM2: 200, lineTotal: 200 }],
    });
    const lastWrite = () => writes[writes.length - 1].update;

    /* a verified order stops being verified the moment a measurement moves */
    {
      const items = [piece()];
      const o = locked(items);
      o.invoiceCheck = { verifiedAt: 1, verifiedBy: 'בן', itemsHash: ctx.lgItemsHash(items) };
      check('verified before the edit', ctx.lgInvoiceState(o), 'verified');
      writes.length = 0;
      const r = await ctx.lgEditInvoiceItem(o, 0, { w: 1200, h: 1000 });
      const u = lastWrite();
      check('the edit reports what changed', [r.changed, r.from, r.to], [true, '1000×1000', '1200×1000']);
      check('the new measurement is written', [u.items[0].w, u.items[0].h], [1200, 1000]);
      check('the old one stays on the item — that is the line to cancel in חשבשבת',
            u.items[0].editedFrom, '1000×1000');
      check('and who changed it', u.items[0].editedBy, session.name);
      check('the locked line follows the measurement',
            [u.lockedItems[0].w, u.lockedItems[0].area], [1200, 1.2]);
      check('and so does the money — 1.2 מ״ר × 200', [u.lockedItems[0].lineTotal, u.totalFinal], [240, 240]);
      check('the price per m² is re-applied, never re-fetched', u.lockedItems[0].pricePerM2, 200);
      check('the total m² is recomputed too', u.totalM2, 1.2);
      check('stage is not touched', 'stage' in u, false);
      check('invoiceCheck is not deleted — the record of who verified survives', 'invoiceCheck' in u, false);
      check('…and yet the order is back for another look',
            ctx.lgInvoiceState(Object.assign({}, o, { items: u.items })), 'changed');
    }

    /* three identical pieces, one of them corrected: the group splits 2 + 1 */
    {
      const gid = 'q7';
      const of3 = (i) => piece({ quantityGroupId: gid, originalQuantity: 3, groupIndex: i });
      writes.length = 0;
      await ctx.lgEditInvoiceItem(locked([of3(1), of3(2), of3(3)]), 1, { w: 500, h: 1000 });
      const u = lastWrite();
      check('the corrected piece leaves the quantity group', u.items[1].quantityGroupId, undefined);
      check('and stops claiming to be 2 of 3 — nobody may read a false count later',
            [u.items[1].originalQuantity, u.items[1].groupIndex], [undefined, undefined]);
      check('the ones that stayed keep their count',
            [u.items[0].originalQuantity, u.items[2].groupIndex], [3, 3]);
      check('the two that did not change stay together',
            [u.items[0].quantityGroupId, u.items[2].quantityGroupId], [gid, gid]);
      check('so the locked lines are 2 + 1, not three identical ones',
            u.lockedItems.map(l => [l.quantity, l.w]), [[2, 1000], [1, 500]]);
      check('and the total is 2×200 + 0.5×200', u.totalFinal, 500);
    }

    /* the guards */
    {
      const invoiced = locked([piece()]);
      invoiced.invoiceDone = { markedAt: 2, markedBy: 'בן', docNumber: '4821' };
      check('an invoiced order may not be edited', ctx.lgCanEditInvoiceItems(invoiced), false);
      check('nor one that is not in the station at all',
            ctx.lgCanEditInvoiceItems(ctx.lgNormalizeOrder({ id: 'e2', stage: 'graphic', items: [piece()] })), false);
      await rejects('and the function refuses, not only the button',
        () => ctx.lgEditInvoiceItem(invoiced, 0, { w: 1200, h: 1000 }), /חשבונית/);

      const o = locked([piece()]);
      await rejects('zero is refused',            () => ctx.lgEditInvoiceItem(o, 0, { w: 0, h: 1000 }), /רוחב/);
      await rejects('an empty field is refused',  () => ctx.lgEditInvoiceItem(o, 0, { w: '', h: 1000 }), /רוחב/);
      await rejects('a non-number is refused',    () => ctx.lgEditInvoiceItem(o, 0, { w: 'abc', h: 1000 }), /רוחב/);
      await rejects('99000 מ״מ is a typo, not a measurement',
        () => ctx.lgEditInvoiceItem(o, 0, { w: 99000, h: 1000 }), /שגוי/);
      await rejects('an index that is not in the order is refused',
        () => ctx.lgEditInvoiceItem(o, 9, { w: 1200, h: 1000 }), /לא נמצא/);

      writes.length = 0;
      const same = await ctx.lgEditInvoiceItem(o, 0, { w: 1000, h: 1000 });
      check('re-typing the same measurement is not a change', same.changed, false);
      check('and writes nothing — a verified order is not disturbed', writes.length, 0);
    }
  }

  /* the page offers the edit, and decides nothing itself */
  {
    const PAGE = fs.readFileSync(path.join(ROOT, 'invoices.html'), 'utf8');
    check('every item row offers a correction', /data-edit="\$\{i\}"/.test(PAGE), true);
    check('it saves through lgEditInvoiceItem', /await lgEditInvoiceItem\(/.test(PAGE), true);
    check('the edit button carries an accessible name', /class="edit"[\s\S]{0,120}?aria-label="תקן/.test(PAGE), true);
    check('a live update cannot wipe a field being typed',
          /editIdx !== null && \$\('edW'\)/.test(PAGE), true);
    /* the reference is shown through the shared function, so the page cannot
       print a number for an order that was never sent */
    check('the reference is read through lgHsReference, not computed',
          /lgHsReference\(o\)/.test(PAGE) && !/orderNum[^\n]*replace\(\/\\D\//.test(PAGE), true);
    check('and the search box says it can be searched',
          /placeholder="[^"]*אסמכתא/.test(PAGE), true);
    check('the measurement inputs are 44px targets', /\.edit-mm\{[^}]*min-height:44px/.test(PAGE), true);
  }

  /* stage is never touched by the station */
  const station = pick(/\/\/ ─── 9א\.[\s\S]*?\nasync function lgMarkInvoiced[\s\S]*?\n}/);
  check('nothing in the station writes stage', /\bstage\s*:|updateStage\(/.test(station), false);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll invoice-station checks passed.');
})();
