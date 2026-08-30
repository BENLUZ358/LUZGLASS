#!/usr/bin/env node
/**
 * Tests /api/hashavshevet-invoice — issuing an invoice in Hashavshevet for one
 * or several orders of the same client, from the "מוכן לאיסוף" board.
 *
 * Same envelope and signature as hashavshevet-order: plugin imovein, flat lines
 * repeating accountKey and Reference. Two things differ, and both are
 * deliberate.
 *
 * The document code is 1 (חשבונית) rather than 31 (הזמ' סוכן), from the type
 * table in the imovein docs: 1 חשבונית · 2 ח-ן קבלה · 3 ח-ן סוכן.
 *
 * The price IS sent. Orders omit it so Hashavshevet price from the item card,
 * but an invoice must not: lgLockAndAdvance writes lockedItems when the order
 * finishes, precisely so the price list cannot move under the customer. An
 * invoice repriced at issue time would contradict that lock and bill a figure
 * nobody agreed to. The docs permit both — omitting price is only for when you
 * want Hashavshevet to price it.
 *
 * Run: node scripts/test-invoice.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-invoice.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the document type ─────────────────────────────────────────────────── */
check('invoice is document 1, not an order type',
      /DEFAULT_DOCUMENT_ID = process\.env\.HASHAVSHEVET_INVOICE_DOCUMENT_ID \|\| '1'/.test(SRC), true);
check('the type table matches the imovein docs',
      /'1': 'חשבונית'[\s\S]{0,60}'2': 'ח-ן קבלה'[\s\S]{0,60}'3': "ח-ן סוכן"/.test(SRC), true);

/* ── the price is the locked one ───────────────────────────────────────── */
check('lines carry a price', /price:\s*ppm2\.toFixed\(3\)/.test(SRC), true);
check('and it comes from the lock, not a live calculation',
      /const ppm2 = Number\(li\.pricePerM2 \|\| 0\)/.test(SRC), true);
check('quantity is area times the group count',
      /const qty\s+= Number\(li\.area \|\| 0\) \* Number\(li\.quantity \|\| 1\)/.test(SRC), true);
check('lineTotal is not also sent — Hashavshevet multiply',
      /lineTotal:\s*li\.lineTotal[\s\S]{0,80}Agent/.test(SRC), false);

/* ── the guards ────────────────────────────────────────────────────────── */
check('an unlocked order is refused',
      /יש הזמנות בלי מחיר נעול/.test(SRC), true);
check('a line whose locked price is zero is skipped, not billed at zero',
      /המחיר הנעול הוא 0/.test(SRC), true);
/* A fictitious order runs the whole path and issues nothing. This began as a
   flat refusal, on the reasoning that an invoice is graver than an order — and
   the result was that the path could not be exercised at all: proving invoicing
   worked meant issuing a real document and cancelling it by hand in
   Hashavshevet. It now behaves exactly as hashavshevet-order does. */
check('a fictitious order is decided from the order, not the request',
      /const testNums = orders\.filter\(o => o\.isTest\)/.test(SRC), true);
check('and the outbound call is the only thing skipped',
      /if \(isTest\) \{[\s\S]{0,300}?\} else \{[\s\S]{0,240}?await fetch\(ENDPOINT/.test(SRC), true);
check('a mixed selection is refused — an invoice cannot be half real',
      /מערבבת הזמנות פיקטיביות ואמיתיות/.test(SRC), true);
check('the attempt is recorded as simulated',
      /simulated:\s+isTest \|\| null/.test(SRC), true);
check('and the caller is told',
      /ok: true, dryRun: false, simulated: isTest/.test(SRC), true);
check('issuing is opt-in, never the default',
      /const dryRun\s+= body\.dryRun !== false/.test(SRC), true);
check('the agent must be positive and non-zero, as for orders',
      /!\(Number\(agent\) > 0\)/.test(SRC), true);

/* ── one invoice belongs to one account ────────────────────────────────── */
/*
 * This guard used to compare orderClient — free text — while the billing
 * screen groups by phone and the account key is looked up by phone. The two
 * disagreed, so a phone group holding one nameless order, or a client whose
 * name was corrected mid-month, was refused an invoice it was entitled to.
 *
 * Run the predicate rather than matching its source: what matters is which
 * selections it accepts, not how it is written.
 */
{
  const fn = (SRC.match(/function billingPhone[\s\S]*?\n}/) || [''])[0];
  check('the account predicate is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const call = os => ctx.billingPhone(os);

  /* the case that blocked a legitimate invoice */
  check('orders whose client name differs are still one account',
        call([{ clientPhone: '0501234567', orderClient: 'אבי זכוכית' },
              { clientPhone: '0501234567', orderClient: 'אבי זכוכית בע"מ' }]).ok, true);
  check('and so is one with no client name at all',
        call([{ clientPhone: '0501234567', orderClient: 'אבי זכוכית' },
              { clientPhone: '0501234567' }]).ok, true);
  check('formatting of the number does not split the group',
        call([{ clientPhone: '050-123 4567' },
              { clientPhone: '0501234567' }]).ok, true);

  /* what it must still refuse */
  check('two different phones are two accounts',
        call([{ clientPhone: '0501234567' }, { clientPhone: '0507654321' }]).ok, false);
  check('and the same name over two phones does not merge them',
        call([{ clientPhone: '0501234567', orderClient: 'אבי זכוכית' },
              { clientPhone: '0507654321', orderClient: 'אבי זכוכית' }]).ok, false);
  check('an order with no phone has no account to bill',
        call([{ orderClient: 'אבי זכוכית' }]).ok, false);
  check('the two refusals are told apart',
        [call([{ clientPhone: '05011' }, { clientPhone: '05022' }]).reason,
         call([{ orderClient: 'x' }]).reason], ['mixed', 'missing']);
  check('and an accepted group reports the number to look the account up by',
        call([{ clientPhone: '050-123 4567' }]).phone, '0501234567');
}

/* ── the same order is not invoiced twice ──────────────────────────────── */
/*
 * "Already invoiced" has to mean a document Hashavshevet accepted. The attempt
 * is written to the order unconditionally — a rejected send records sentAt just
 * like an accepted one — so testing sentAt alone locked an order out forever
 * over an invoice that was never issued.
 *
 * httpOk === false is the only thing that releases it. A record without the
 * field (written before it existed) counts as issued: blocking an invoice is
 * recoverable, billing a client twice is not.
 */
{
  const fn = (SRC.match(/function alreadyInvoiced[\s\S]*?\n}/) || [''])[0];
  check('the duplicate predicate is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const call = os => ctx.alreadyInvoiced(os);

  check('an order never invoiced is free',
        call([{ orderNum: '1061' }]), []);
  check('an accepted invoice blocks a second one',
        call([{ orderNum: '1061', hashavshevetInvoice: { sentAt: 1, httpOk: true } }]), ['1061']);
  /* the case that blocked a legitimate invoice */
  check('an invoice Hashavshevet rejected does not block a retry',
        call([{ orderNum: '1061', hashavshevetInvoice: { sentAt: 1, httpOk: false } }]), []);
  check('a record from before httpOk existed is treated as issued',
        call([{ orderNum: '1061', hashavshevetInvoice: { sentAt: 1 } }]), ['1061']);
  check('a simulated invoice still blocks — the run is the real path',
        call([{ orderNum: '1061', hashavshevetInvoice: { sentAt: 1, httpOk: true, simulated: true } }]),
        ['1061']);
  check('only the offending orders are named',
        call([{ orderNum: '1061', hashavshevetInvoice: { sentAt: 1, httpOk: true } },
              { orderNum: '1062', hashavshevetInvoice: { sentAt: 1, httpOk: false } },
              { orderNum: '1063' }]), ['1061']);
  check('an order with no number falls back to its id',
        call([{ id: 'ord_9', hashavshevetInvoice: { sentAt: 1, httpOk: true } }]), ['ord_9']);
}

/* ── the record ────────────────────────────────────────────────────────── */
check('every attempt is written to each order in the batch',
      /db\.ref\('orders\/' \+ id \+ '\/hashavshevetInvoice'\)\.set\(attempt\)/.test(SRC), true);
check('and records which orders shared the document',
      /withOrders:\s*orders\.map/.test(SRC), true);
check('"accepted" is stored apart from "document exists"',
      /httpOk:\s*wgRes\.ok/.test(SRC), true);
check('the raw response is kept', /response:\s*text\.slice/.test(SRC), true);

/* ── the browser cannot choose the money ───────────────────────────────── */
check('the browser sends order ids only',
      /const orderIds = Array\.isArray\(body\.orderIds\)/.test(SRC), true);
check('the account key is resolved server-side',
      /db\.ref\('users\/' \+ phone\)/.test(SRC), true);

/* ── the screen ────────────────────────────────────────────────────────── */
{
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('orders can be selected on the board', /function invToggle\(/.test(admin), true);
  /* Both views, because the admin opens on the table and that is where the
     work happens — the checkbox first shipped on the kanban card only, so on
     the screen actually in use there was nothing to click. */
  for (const [view, fn] of [['kanban', 'card'], ['table', 'renderTable']]) {
    const body = (admin.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
    check(`the ${view} view offers selection`, /invToggle\(/.test(body), true);
    /* Two conditions, not one. The status alone put a checkbox on every ready
       order in every view, including "הכל" — visual noise on rows nobody was
       about to invoice. It appears only while that filter is the one selected. */
    check(`the ${view} view shows it only under the ready filter`,
          /sf === 'מוכן לאיסוף' && o\.status === 'מוכן לאיסוף'/.test(body), true);
  }
  /* and leaving the filter must not strand a selection off-screen */
  check('changing filter clears a selection you can no longer see',
        /if\(s !== 'מוכן לאיסוף' && invSel\.size\)\{ invSel\.clear\(\)/.test(admin), true);
  check('mixing clients in one selection is refused',
        /invSelClient !== client/.test(admin), true);
  check('a preview runs before anything is issued',
        /invPreview\(\)[\s\S]{0,400}?dryRun: true/.test(admin), true);
  /* the order matters: an order collected without an invoice is worse than one
     that stayed put, so the stage only moves after the document succeeds */
  check('the stage moves only after the invoice succeeds',
        /if\(res\.ok && data\.ok\)\{[\s\S]{0,220}?updateStage\(id, 'collected'\)/.test(admin), true);
}

/* the screen has to say it, or a simulated run reads as a real one */
{
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('the preview warns when the selection is fictitious',
        /const testNote = data\.isTest[\s\S]{0,500}?לא תופק בחשבשבת/.test(admin), true);
  check('the result screen says nothing was issued',
        /data\.simulated \? '🧪 הורץ כפיקטיבי'/.test(admin), true);
  check('an order already in progress can still be marked fictitious',
        /function markOrderTest\(/.test(admin), true);
  check('but not once it has been invoiced',
        /const invoiced = !!\(o\.hashavshevetInvoice && o\.hashavshevetInvoice\.sentAt\)/.test(admin), true);
}

/* Finishing a delivery issues the invoice from there.

   The dialog's "הפק חשבונית" button called finalizeDelivery, which marked the
   order collected and then showed a toast saying to open the dashboard. By then
   the dashboard could not help: the invoice checkbox appears only under the
   "מוכן לאיסוף" filter, and the order had just left it. The one click meant to
   lead to an invoice put the order out of reach.

   The order of operations is the point, and it is the same rule already
   enforced on the admin screen: issue first, move to collected only on success.
   An order collected without an invoice is worse than one that stayed put — and
   worse still, unreachable. */
{
  const wd = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  check('the delivery dialog issues rather than redirecting',
        /_cldInv'\)\.onclick    = \(\) => \{ ov\.remove\(\); _deliveryInvoice\(orderIds\); \}/.test(wd), true);
  check('and no longer tells the operator to go elsewhere',
        /_cldInv[\s\S]{0,200}?פתח דשבורד/.test(wd), false);
  /* one client, one document — the API sends a single invoice with withOrders,
     so a loop would produce one document per order */
  check('the whole batch goes on one invoice',
        /const ids = \(orderIds \|\| \[\]\)\.map\(String\);/.test(wd), true);
  check('a preview runs before anything is issued',
        /_lgAuthPost\('\/api\/hashavshevet-invoice', \{ orderIds: ids, dryRun: true \}\)/.test(wd), true);
  check('and issuing is a separate, explicit call',
        /_lgAuthPost\('\/api\/hashavshevet-invoice', \{ orderIds: ids, dryRun: false \}\)/.test(wd), true);

  const confirm = (wd.match(/function _deliveryInvoiceConfirm[\s\S]*?\n}/) || [''])[0];
  check('the stage moves only after the invoice succeeds',
        /if\(ok\) for\(const id of ids\) await updateStage\(id, 'collected'\);/.test(confirm), true);
  check('a skipped item is shown before issuing, not after',
        /פריטים לא ייכללו/.test(confirm), true);
  check('a fictitious order says so in the preview',
        /data\.isTest[\s\S]{0,400}?לא תופק חשבונית בחשבשבת/.test(confirm), true);
  check('cancelling leaves the order in delivery',
        /ביטול — ההזמנה נשארת בהובלה/.test(confirm), true);

  const result = (wd.match(/function _deliveryInvoiceResult[\s\S]*?\n}/) || [''])[0];
  check('a failure says the orders stayed put, so it can be retried',
        /ההזמנות נשארו בהובלה/.test(result), true);
}

/* ── a consolidated invoice gets its own number ────────────────────────── */
/*
 * The reference was the first order's number. For one order that is right and
 * convenient — you see an invoice and know which order it belongs to. For
 * twenty it is arbitrary, and it collides: order 1061 already carries
 * reference 1061 on its own order document in Hashavshevet, and its invoice
 * took 1061 as well.
 *
 * A consolidated invoice takes a running number of its own, from the same
 * transaction pattern as meta/orderCounter. A single-order invoice is left
 * exactly as it was.
 */
check('a consolidated invoice uses its own counter',
      /const ref = orders\.length > 1[\s\S]{0,200}?nextInvoiceRef\(db\)/.test(SRC), true);
check('a single-order invoice keeps the order number',
      /: toReference\(first\.orderNum\);/.test(SRC), true);
/*
 * Run the counter rather than matching its source. The check here used to pin
 * the literal `Math.max(current || 0, 5000) + 1` — which fails a correct
 * refactor and passes a broken counter that keeps the string. What matters is
 * the behaviour: a transaction (not read-then-write), on its own node, that
 * never returns a number it has returned before.
 */
{
  const fn = (SRC.match(/async function nextInvoiceRef[\s\S]*?\n}/) || [''])[0];
  check('the counter function is found', fn.length > 0, true);
  check('the counter is a transaction, not a read-then-write',
        /\.transaction\(/.test(fn), true);

  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);

  /* a database stub that behaves the way RTDB transactions do: hand the
     current value to the updater, store what comes back, report it */
  const paths = [];
  const fakeDb = (start) => {
    let stored = start;
    return { ref(p){ paths.push(p); return { async transaction(fn){ stored = fn(stored); return { snapshot: { val: () => stored } }; } }; } };
  };
  const next = async (start) => (await ctx.nextInvoiceRef(fakeDb(start))).reference;

  (async () => {
    check('and it is a separate node from the order counter',
          (await next(null), paths[paths.length - 1]), 'meta/invoiceCounter');
    /* the first consolidated invoice ever issued starts above order numbers,
       so an invoice reference can never be mistaken for an order reference */
    check('an empty counter starts at 5001', await next(null), '5001');
    check('and the next one follows it',     await next(5001), '5002');
    /* it never goes backwards: a node somehow holding a low or absurd value
       must not hand out a reference that has already been used */
    check('a counter below the floor is lifted back to it', await next(42),   '5001');
    check('and a negative one too',                          await next(-9),  '5001');
    check('a counter above the floor keeps climbing',        await next(9000), '9001');
    check('and the result is a string, as Reference must be',
          typeof (await ctx.nextInvoiceRef(fakeDb(7000))).reference, 'string');

    /* two invoices issued back to back against the same node get two numbers */
    const db = fakeDb(null);
    const a  = (await ctx.nextInvoiceRef(db)).reference;
    const b  = (await ctx.nextInvoiceRef(db)).reference;
    check('two invoices in a row never share a number', a === b, false);
    check('and the second is higher', Number(b) > Number(a), true);

    if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
    console.log('\nAll invoice checks passed.');
  })();
}
/* the report lives inside the async block above — nextInvoiceRef is async, and
   a synchronous report here would print "passed" before it had run */
