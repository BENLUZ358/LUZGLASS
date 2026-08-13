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
check('one invoice belongs to one account',
      /clients\.length > 1[\s\S]{0,200}?status\(422\)/.test(SRC), true);
check('the same order is not invoiced twice without force',
      /hashavshevetInvoice && o\.hashavshevetInvoice\.sentAt[\s\S]{0,120}?!force/.test(SRC), true);
check('issuing is opt-in, never the default',
      /const dryRun\s+= body\.dryRun !== false/.test(SRC), true);
check('the agent must be positive and non-zero, as for orders',
      /!\(Number\(agent\) > 0\)/.test(SRC), true);

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
    check(`and only at "מוכן לאיסוף"`, /o\.status === 'מוכן לאיסוף'/.test(body), true);
  }
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

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll invoice checks passed.');
