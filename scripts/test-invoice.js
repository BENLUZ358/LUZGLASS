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
check('a fictitious order never produces an accounting document',
      /o\.isTest[\s\S]{0,200}?status\(423\)/.test(SRC), true);
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
  check('selection is offered only at "מוכן לאיסוף"',
        /const pickable = o\.status === 'מוכן לאיסוף'/.test(admin), true);
  check('mixing clients in one selection is refused',
        /invSelClient !== client/.test(admin), true);
  check('a preview runs before anything is issued',
        /invPreview\(\)[\s\S]{0,400}?dryRun: true/.test(admin), true);
  /* the order matters: an order collected without an invoice is worse than one
     that stayed put, so the stage only moves after the document succeeds */
  check('the stage moves only after the invoice succeeds',
        /if\(res\.ok && data\.ok\)\{[\s\S]{0,220}?updateStage\(id, 'collected'\)/.test(admin), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll invoice checks passed.');
