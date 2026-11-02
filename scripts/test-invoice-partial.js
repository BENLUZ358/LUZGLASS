#!/usr/bin/env node
/**
 * חשבונית חלקית — נאור חזקיה (9117) והמקום לאמבט (14201). בן, 2/11.
 *
 * הם מקבלים סחורה כל יום. מה שחזר מחיסום יוצא אליהם באותו יום, גם כשההזמנה
 * עוד לא שלמה, והחשבונית צריכה לכלול בדיוק מה שיצא. בחשבשבת מושכים חלק
 * מההזמנה; מה שלא נמשך נשאר פתוח.
 *
 *   A. הזמנה של 5 חתיכות, 4 חזרו מחיסום ונסגרו ("סיום בדיקה" חלקי) → בתחנה,
 *      עם 4 החתיכות בלבד. לקוח אחר באותו מצב → לא בתחנה (כמו היום).
 *   B. "הופקה חשבונית" → 4 החתיכות נרשמות על המסמך, ההזמנה לא מסומנת כולה.
 *      אחרי זה היא יוצאת מהתחנה עד שהחתיכה החמישית חוזרת.
 *   C. החמישית חזרה, ההזמנה נאספה → בתחנה רק עם החתיכה החמישית. חשבונית שנייה
 *      → ההזמנה סגורה (invoiceDone), 5 החתיכות רשומות על שני מסמכים.
 *   D. אותו מספר מסמך פעמיים על אותה הזמנה → נחסם.
 *   E. ההזמנה עברה הלאה וה"סגורות" נמחקו (כמו בייצור) — החתיכות שחויבו נשמרות.
 *
 * Run: node scripts/test-invoice-partial.js
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
  lgVerifiedSession: () => ({ name: 'בן לוז', phone: '0500000000', isMainAdmin: true }),
  lgStageToStatus: s => s,
  lgStatusToStage: s => s,
  _lgAuthPost: async () => ({ ok: true }),
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
  pick(/function lgArrivedIdxs[\s\S]*?\n}/),
  pick(/function lgNormalizeOrder[\s\S]*?\n}/),
  pick(/\/\/ ─── 9א\.[\s\S]*?\nasync function lgMarkInvoiced[\s\S]*?\n}/),
].join('\n').replace(/^const /gm, 'var '), ctx);

const piece = w => ({ sku: '8SMH', w, h: 2000, glassFullName: 'שקוף 8 מחוסם' });
const ITEMS = [piece(500), piece(600), piece(700), piece(800), piece(900)];
const HASH  = ctx.lgItemsHash(ITEMS);
const VER   = { verifiedAt: 10, verifiedBy: 'x', itemsHash: HASH };
const order = extra => ctx.lgNormalizeOrder(Object.assign({
  id: 'o1', orderNum: 'L1200', customerId: '9117', clientPhone: '0535214912', stage: 'chisum',
  items: ITEMS.map(i => ({ ...i })), invoiceCheck: VER,
  chisumClosedIdxs: { 0: true, 1: true, 2: true, 3: true },
}, extra));
//  מחיל את מה ש-lgMarkInvoiced כתב על ההזמנה הגולמית, כמו Firebase
const apply = (raw, w) => {
  const r = JSON.parse(JSON.stringify(raw));
  Object.entries(w.update).forEach(([k, v]) => {
    const parts = k.split('/'); if (parts[0] !== r.id) return;
    let cur = r;
    for (let i = 1; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] || {};
    cur[parts[parts.length - 1]] = v;
  });
  return r;
};
const rawOf = extra => Object.assign({
  id: 'o1', orderNum: 'L1200', customerId: '9117', clientPhone: '0535214912', stage: 'chisum',
  items: ITEMS.map(i => ({ ...i })), invoiceCheck: VER,
  chisumClosedIdxs: { 0: true, 1: true, 2: true, 3: true },
}, extra);

(async () => {
  /* A */
  check('A1 partial customer, 4 of 5 back → in the station', ctx.lgInvoiceState(order({})), 'verified');
  check('A2 only the 4 pieces that went out', ctx.lgInvoiceablePieces(order({})), [0, 1, 2, 3]);
  check('A3 HaMakom LaAmbat too', ctx.lgInvoiceState(order({ customerId: '14201' })), 'verified');
  check('A4 any other customer → not in the station until collected', ctx.lgInvoiceState(order({ customerId: '07' })), null);
  check('A5 nothing back yet → not in the station', ctx.lgInvoiceState(order({ chisumClosedIdxs: null })), null);
  check('A6 triplex pieces that came back count too',
        ctx.lgInvoiceablePieces(order({ chisumClosedIdxs: { 0: true }, triplexClosedIdxs: { 4: true } })), [0, 4]);
  check('A7 still in the workday (not tempering) → not in the station', ctx.lgInvoiceState(order({ stage: 'workday' })), null);
  check('A8 needs the usual check first', ctx.lgInvoiceState(order({ invoiceCheck: null })), 'pending');

  /* B */
  writes.length = 0;
  let raw = rawOf({});
  await ctx.lgMarkInvoiced([order({})], '67400', []);
  const w1 = writes.find(w => w.path === 'orders');
  check('B1 the 4 pieces are recorded on document 67400',
        Object.keys(w1.update).filter(k => k.includes('/invoiceDone/pieces/')).sort(),
        ['o1/invoiceDone/pieces/0', 'o1/invoiceDone/pieces/1', 'o1/invoiceDone/pieces/2', 'o1/invoiceDone/pieces/3']);
  check('B2 the order is not closed', Object.keys(w1.update).some(k => k.endsWith('/invoiceDone/docNumber')), false);
  raw = apply(raw, w1);
  check('B3 then it leaves the station (nothing left to invoice now)', ctx.lgInvoiceState(ctx.lgNormalizeOrder(raw)), null);

  /* E — the fifth piece came back: the order moves on and the closed maps are wiped (workday.html) */
  raw.stage = 'collected'; raw.chisumClosedIdxs = null; raw.triplexClosedIdxs = null;
  const o2 = ctx.lgNormalizeOrder(raw);
  check('E1 the invoiced pieces survive', Object.keys(o2.invoicePieces).sort(), ['0', '1', '2', '3']);

  /* C */
  check('C1 collected → in the station with only the fifth piece', [ctx.lgInvoiceState(o2), ctx.lgInvoiceablePieces(o2)], ['verified', [4]]);
  check('C2 the station says which document the rest went on', ctx.lgPartialInvoiceDocs(o2), ['67400']);

  /* D */
  let err = '';
  try { await ctx.lgMarkInvoiced([o2], '67400', [o2]); } catch (e) { err = e.message; }
  check('D1 the same document number again on this order is refused', /67400/.test(err), true);

  writes.length = 0;
  await ctx.lgMarkInvoiced([o2], '67410', [o2]);
  const w2 = writes.find(w => w.path === 'orders');
  check('C3 the fifth piece goes on 67410', w2.update['o1/invoiceDone/pieces/4'], '67410');
  check('C4 and the order is closed on 67410', w2.update['o1/invoiceDone/docNumber'], '67410');
  raw = apply(raw, w2);
  check('C5 invoiced', ctx.lgInvoiceState(ctx.lgNormalizeOrder(raw)), 'invoiced');

  /* other orders: nothing changes */
  writes.length = 0;
  const other = ctx.lgNormalizeOrder(rawOf({ id: 'o9', customerId: '07', stage: 'collected', chisumClosedIdxs: null }));
  await ctx.lgMarkInvoiced([other], '67420', []);
  const w3 = writes.find(w => w.path === 'orders');
  check('F1 a regular customer: invoiceDone as before, no piece list',
        Object.keys(w3.update).sort(), ['o9/invoiceDone', 'o9/updatedAt']);
  check('F2 a partial customer whose order came back whole: closed in one go',
        ctx.lgInvoiceablePieces(ctx.lgNormalizeOrder(rawOf({ stage: 'collected', chisumClosedIdxs: null }))), [0, 1, 2, 3, 4]);

  /* a customer cannot pre-mark pieces: a top-level field is ignored (the rules forbid invoiceDone on create) */
  check('G0 invoicePieces written by anyone at the top level is ignored',
        ctx.lgInvoiceablePieces(ctx.lgNormalizeOrder(rawOf({ stage: 'collected', invoicePieces: { 0: 'x', 1: 'x', 2: 'x', 3: 'x', 4: 'x' } }))).length, 5);
  /* the number on another order still conflicts */
  const prior = ctx.lgNormalizeOrder(rawOf({ id: 'o5', invoiceDone: { pieces: { 0: '67430' } } }));
  check('G1 a number used for pieces of another order conflicts',
        ctx.lgDocNumberConflicts([prior], '67430', ['o1']).map(o => o.id), ['o5']);

  /* H — the queues: a second invoice for the same order is a new message, not "already sent" */
  {
    const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
    const { lgWaEnqueue } = require(path.join(ROOT, 'api', '_wa-outbox.js'));
    const { lgEmailEnqueue } = require(path.join(ROOT, 'api', '_email-outbox.js'));
    const db = fakeDb({});
    const wa = dn => lgWaEnqueue(db, { kind: 'invoice', to: '972535214912', orderIds: ['o1'], orderNums: ['L1200'], invoiceKey: 'k' + dn, docNumber: dn });
    const a = await wa('67400');
    db._data.waOutbox[a.key].state = 'sent';
    const b = await wa('67410');
    check('H1 WhatsApp: the second invoice is queued', b.queued, true);
    check('H2 WhatsApp: as its own message', b.key !== a.key, true);
    check('H3 WhatsApp: the same invoice twice is still one message', (await wa('67410')).queued, false);
    const em = dn => lgEmailEnqueue(db, { kind: 'invoice', thread: 'T1', messageId: 'M1', email: 'x@y.co', orderIds: ['o1'], orderNums: ['L1200'], invoiceKey: 'k' + dn, docNumber: dn, now: 1 });
    const c = await em('67400');
    db._data.waMeta.emailOutbox[c.key].state = 'sent';
    check('H4 email: the second invoice is queued', (await em('67410')).queued, true);
    //  ready / sketches-handled keep their keys — no docNumber, no change
    const r1 = await lgWaEnqueue(db, { kind: 'ready', to: '972535214912', orderIds: ['o1'] });
    db._data.waOutbox[r1.key].state = 'sent';
    check('H5 "ready" still goes out once per order', (await lgWaEnqueue(db, { kind: 'ready', to: '972535214912', orderIds: ['o1'] })).queued, false);
  }

  /* I — review fixes: exactly the lines shown, and no edits that would shift billed pieces */
  {
    writes.length = 0;
    await ctx.lgMarkInvoiced([order({})], '67500', [], { o1: [0, 1] });
    const u = writes.find(w => w.path === 'orders').update;
    check('I1 only the lines the dialog showed are recorded (piece 3 closed meanwhile is not)',
          Object.keys(u).filter(k => k.includes('/pieces/')).sort(), ['o1/invoiceDone/pieces/0', 'o1/invoiceDone/pieces/1']);
    let e1 = '';
    try { await ctx.lgMarkInvoiced([order({ invoiceDone: { pieces: { 1: '67400' } } })], '67501', [], { o1: [0, 1] }); } catch (e) { e1 = e.message; }
    check('I2 a piece already billed is refused', /כבר/.test(e1), true);
    writes.length = 0;
    await ctx.lgMarkInvoiced([order({ stage: 'done', chisumClosedIdxs: null })], '67502', [], { o1: [0, 1, 2, 3] });
    check('I3 the order moved on before the click — the document is still recorded',
          Object.keys(writes.find(w => w.path === 'orders').update).filter(k => k.includes('/pieces/')).length, 4);
    let e4 = '';
    try { await ctx.lgMarkInvoiced([order({ stage: 'done', chisumClosedIdxs: null, invoiceCheck: null })], '67503', [], { o1: [0] }); } catch (e) { e4 = e.message; }
    check('I4 but never without the check', /מאומתות/.test(e4), true);
    const billed = order({ stage: 'collected', chisumClosedIdxs: null, invoiceDone: { pieces: { 0: '67400' } } });
    check('I5 a billed piece cannot be edited in the station', ctx.lgCanEditInvoiceItems(billed, 0), false);
    check('I6 an unbilled piece still can', ctx.lgCanEditInvoiceItems(billed, 4), true);
    let e7 = '';
    try { await ctx.lgSaveOrderItemsEdit(billed, ITEMS.slice(1)); } catch (e) { e7 = e.message; }
    check('I7 adding/removing items is blocked once some pieces are billed', /חלק/.test(e7), true);
  }

  if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
