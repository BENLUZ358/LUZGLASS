#!/usr/bin/env node
/**
 * Tests monthly billing — שוטף 30.
 *
 * Some clients collect orders through the month and are billed once at the end.
 * Today every collected order asks whether to invoice, which for such a client
 * is the same needless question twenty times.
 *
 * The flag is not a new mechanism. users.isDelivery already does exactly this:
 * a toggle in the user manager, _propagateDeliveryToOrders to reach orders that
 * already exist (keyed on phone, not name — names change), and a slot in
 * lgNormalizeOrder. monthlyBilling follows it line for line.
 *
 * The whitelist slot is the part worth guarding. A field not named in
 * lgNormalizeOrder is dropped on the way to every screen, and that has cost
 * four separate bugs here: chisumArrivedIdxs, itemType, pickedDate and
 * hashavshevetInvoice.
 *
 * Run: node scripts/test-monthly-billing.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = read('admin.html');
const DB    = read('firebase-db.js');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (src, name) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── the flag survives to every screen ─────────────────────────────────── */
{
  const norm = bodyOf(DB, 'lgNormalizeOrder');
  check('monthlyBilling is in the whitelist',
        /monthlyBilling: !!o\.monthlyBilling,/.test(norm), true);
}

/* ── the toggle, following isDelivery exactly ──────────────────────────── */
check('there is a toggle', /async function umToggleMonthly\(/.test(ADMIN), true);
check('it writes the flag on the user',
      /update\(\{ monthlyBilling: newVal, updatedAt: Date\.now\(\) \}\)/.test(ADMIN), true);
/* keyed on phone, because a client's name can change and their phone is the
   identifier every order carries */
check('and propagates by phone, not name',
      /_propagateMonthlyToOrders\(user\.phone, newVal\)/.test(ADMIN), true);
check('the button is on the row', /umToggleMonthly\('\$\{u\.id\}'/.test(ADMIN), true);
check('and the row says when it is on', /שוטף 30/.test(ADMIN), true);

/* ── propagation reaches orders that already exist ─────────────────────── */
{
  const prop = bodyOf(ADMIN, '_propagateMonthlyToOrders');
  check('propagation exists', prop.length > 0, true);
  check('it matches orders by phone',
        /o\.clientPhone === phone \|\| o\.phone === phone/.test(prop), true);
  check('and only writes where the value differs',
        /if\(!!o\.monthlyBilling !== !!isMonthly\)/.test(prop), true);
}

/* ── the question that stops being asked ───────────────────────────────── */
/*
 * For a שוטף 30 client the finish-delivery dialog does not ask about an
 * invoice — the order goes straight to collected and waits for the monthly
 * run. For everyone else the dialog is untouched, which is the whole point:
 * this is the only existing behaviour the feature changes.
 *
 * The flag is read from the order, not from the client record, because the
 * order carries the regime it was opened under.
 */
{
  const WD  = read('workday.html');
  const fn  = bodyOf(WD, 'showClientDeliveryPrompt');
  check('the dialog checks the flag', /firstO\.monthlyBilling/.test(fn), true);
  /* relaxed from a literal "finalizeDelivery(id, false));" — the toast-ordering
     fix below wraps the calls in Promise.all(...map...), which changes the
     closing punctuation but not the intent: finalizeDelivery(id, false) runs,
     then the branch returns without ever reaching the dialog. */
  check('a monthly client skips straight to collected',
        /finalizeDelivery\(id, false\)[\s\S]{0,200}?return;/.test(fn), true);
  /* silence would look like nothing happened */
  check('and is told what happened',
        /שוטף 30/.test(fn), true);
  /* the ordinary path must survive untouched */
  check('everyone else still gets the choice',
        /_cldInv'\)\.onclick/.test(fn), true);
  check('and can still issue from there',
        /_deliveryInvoice\(orderIds\)/.test(fn), true);

  /* finalizeDelivery is async and shows its own toast after its Firebase
     write resolves. showToast only sets textContent — there is no queue —
     so a monthly toast fired synchronously right after a bare forEach is
     always overwritten by finalizeDelivery's generic one. The regex checks
     above cannot catch this: they only prove the toast string exists in the
     source, not when it fires relative to the writes. */
  {
    const monthlyBranch = (fn.match(/if\(firstO && firstO\.monthlyBilling\)\{[\s\S]*?\n  \}/) || [''])[0];
    check('the monthly branch exists', monthlyBranch.length > 0, true);
    check('it waits for every finalizeDelivery before toasting',
          /Promise\.all\(orderIds\.map\(id => finalizeDelivery\(id, false\)\)\)/.test(monthlyBranch), true);
    check('the toast is in the continuation, not a bare statement after the forEach',
          /\.then\(\(\) => showToast\(/.test(monthlyBranch), true);
    check('and does not fire synchronously right after a bare forEach',
          !/forEach\(id => finalizeDelivery\(id, false\)\);\s*\n\s*showToast\(/.test(monthlyBranch), true);
  }
}

/* ── the issuing screen ────────────────────────────────────────────────── */
/*
 * A flow, not a browse. It starts empty and you search for one client — the
 * action is "invoice this client", not "survey everyone".
 *
 * "Not yet billed" is not a new field. The invoice API already refuses to
 * invoice an order twice by checking hashavshevetInvoice.sentAt, so the same
 * fact defines the list. No new state, nothing that can drift out of sync, and
 * double billing stays blocked on the server rather than in this screen.
 */
{
  const fn = bodyOf(ADMIN, '_billFilterOrders');
  check('the list is collected orders only', /o\.stage === 'collected'/.test(fn), true);
  check('and only those not yet billed',
        /!\(o\.invoice && o\.invoice\.sentAt\)/.test(fn), true);

  check('there is a screen', /id="billOv"/.test(ADMIN), true);
  check('it starts with no client chosen', /let _billClient = null;/.test(ADMIN), true);
  check('and is reached from the menu', /openBillBoard\(\)/.test(ADMIN), true);

  const list = bodyOf(ADMIN, '_renderBillClients');
  check('only clients with something to bill are listed',
        /if\(!list\.length\)\{/.test(list), true);
  check('the search filters by client name',
        /_billSearch/.test(list), true);
  /* a Hebrew client name must not be assembled into an inline onclick — the
     codebase already avoids this, see the data-ids buttons in workday.html */
  check('the client name travels in a data attribute',
        /data-client="' \+ lgEsc\(c\)/.test(list), true);

  const det = bodyOf(ADMIN, '_renderBillClient');
  check('every order starts selected', /invSel\.add\(String\(o\.id\)\)/.test(det), true);
  check('the sketch carries an id and no src',
        /data-sketch-for="' \+ lgEsc\(String\(o\.id\)\)/.test(det), true);
  /* "no src" is the point of the pattern — a collapsed row must cost no image
     bytes — so check its absence directly rather than only asserting the id */
  check('and the <img> tag itself has no src attribute',
        !/<img[^>]*\ssrc=/.test(det), true);
  check('and is filled only when a row is opened',
        /if\(d\.open\) _hydrateBillSketches\(d\)/.test(det), true);

  /* reuse, not a second copy of the money path */
  check('issuing goes through the existing preview',
        /onclick="invPreview\(\)"/.test(ADMIN), true);

  /* the running total has to be announced, not only drawn */
  check('the total is announced to a screen reader',
        /id="billTotal" aria-live="polite"/.test(ADMIN), true);
  /* colour alone must not carry meaning */
  check('a selected row says so in words, not only in colour',
        /נבחרו \$\{/.test(ADMIN), true);
}

/* ── review round 1 fixes ──────────────────────────────────────────────── */
{
  /* the invoice modal (_invOverlay, and its result path further down) opens
     over this screen once "הפק חשבונית" is pressed. If billOv's z-index ever
     climbs to or past the modal's, the modal renders invisible and unclickable
     underneath it — the button that issues the invoice becomes unreachable.
     Pinned to the relationship, not to either literal number, so a future
     change to either side cannot silently break the order again. */
  const billZ = (ADMIN.match(/#billOv\{[^}]*z-index:(\d+)/) || [])[1];
  const invFn = bodyOf(ADMIN, '_invOverlay');
  const invZ  = (invFn.match(/z-index:(\d+)/) || [])[1];
  check('the billing overlay z-index is found', billZ !== undefined, true);
  check('the invoice modal z-index is found', invZ !== undefined, true);
  check('the billing overlay sits below the invoice modal',
        Number(billZ) < Number(invZ), true);

  /* the touch target is the whole row, not the bare 20x20 box — same shape
     as the kanban card's pickBox: a <label> wrapping the input, so the
     browser's native label-click toggles the checkbox */
  const det = bodyOf(ADMIN, '_renderBillClient');
  check('the checkbox sits in a label, not a bare box',
        /<label class="bill-check">/.test(det), true);

  /* invSend() clears invSel and calls renderAll() on success; without this,
     the row list would still show the just-invoiced orders, checked, after
     they have already dropped out of _billFilterOrders */
  const ra = bodyOf(ADMIN, 'renderAll');
  check('renderAll refreshes the billing screen while it is open',
        /billOv'\)\?\.classList\.contains\('open'\)[\s\S]{0,40}renderBillBoard\(\)/.test(ra), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll monthly-billing checks passed.');
