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
  check('a monthly client skips straight to collected',
        /finalizeDelivery\(id, false\)\);[\s\S]{0,200}?return;/.test(fn), true);
  /* silence would look like nothing happened */
  check('and is told what happened',
        /שוטף 30/.test(fn), true);
  /* the ordinary path must survive untouched */
  check('everyone else still gets the choice',
        /_cldInv'\)\.onclick/.test(fn), true);
  check('and can still issue from there',
        /_deliveryInvoice\(orderIds\)/.test(fn), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll monthly-billing checks passed.');
