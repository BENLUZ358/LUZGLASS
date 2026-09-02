#!/usr/bin/env node
/**
 * Tests the field guard on client-created orders in database.rules.json.
 *
 * Found in the audit of 2026-09-02. The write rule let a client create an
 * order with ANY field, checking only that clientPhone was theirs and stage
 * was empty. Three links made that a priced attack:
 *
 *   1. the rule accepted any field
 *   2. lgLockAndAdvance skips pricing entirely when pricesLockedAt already
 *      exists (firebase-db.js) — and it is the only writer of lockedItems
 *   3. api/hashavshevet-invoice.js bills from lockedItems
 *
 * So a client could PUT an order carrying pricesLockedAt and a lockedItems
 * array of their own, and the invoice sent to Hashavshevet would carry the
 * price they chose. The same hole let them set isTest (the real Hashavshevet
 * call is skipped and a simulated invoice recorded) and monthlyBilling
 * (finishing a delivery stops asking about invoicing).
 *
 * Firebase web config is public by design, so the rules are the only boundary:
 * a client with a valid password can call the REST API directly and never
 * touch the portal.
 *
 * The second half of this file is the guard that matters most going forward:
 * a field the portal actually writes must never end up on the blocklist, or
 * every upload starts failing. paymentStatus is exactly that case — it looks
 * like it belongs on the list, and saveSubmission writes it from the client's
 * own browser.
 *
 * Run: node scripts/test-rules-order-fields.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8'));
const FB    = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const orderWrite = RULES.rules.orders.$orderId['.write'];
check('the order write rule is found', typeof orderWrite, 'string');

/* ── the fields a client must not be able to set ───────────────────────── */
/*
 * Every one of these is written by an admin path only, and each has a
 * concrete consequence if a client sets it at creation time.
 */
const MUST_BLOCK = {
  pricesLockedAt:      'skips pricing entirely, so client-supplied prices survive',
  lockedItems:         'is what the invoice bills from',
  totalFinal:          'is the figure the admin screens show',
  hashavshevetInvoice: 'marks an order as already invoiced',
  isTest:              'makes the invoice skip Hashavshevet and record a fake success',
  monthlyBilling:      'makes finishing a delivery stop asking about the invoice',
  readyStatus:         'moves an order towards being collectable',
  sketchSeenAt:        'is the review sub-stage, owned by the queue',
};
for (const [field, why] of Object.entries(MUST_BLOCK)) {
  check(`a client cannot set ${field} — it ${why}`,
        orderWrite.includes(`!newData.hasChild('${field}')`), true);
}

/* the guard has to sit on the CLIENT branch, not the admin one */
check('the guard applies to the client branch of the rule',
      /newData\.child\('stage'\)\.val\(\) === ''[\s\S]*hasChild/.test(orderWrite), true);
check('and an admin is still unrestricted',
      /role'\)\.val\(\) === 'admin' \|\|/.test(orderWrite), true);
check('a client still cannot edit an existing order',
      orderWrite.includes('!data.exists()'), true);
check('nor create one under someone else\'s phone',
      /newData\.child\('clientPhone'\)\.val\(\) === auth\.token\.email/.test(orderWrite), true);

/* ── the trap: never block a field the portal actually writes ──────────── */
/*
 * saveSubmission runs in the client's own browser, so every field it writes
 * is a field the client sends. Blocking one of those breaks every upload —
 * and it would break silently for anyone still on a cached page.
 */
{
  const fn = (FB.match(/async function saveSubmission[\s\S]*?\n}/) || [''])[0];
  check('saveSubmission is found', fn.length > 0, true);

  /* the literal keys in the record it writes */
  const written = new Set(
    [...fn.matchAll(/^\s{4}([a-zA-Z_]\w*):\s/gm)].map(m => m[1]));
  check('its record was parsed', written.size > 5, true);

  const collisions = Object.keys(MUST_BLOCK).filter(f => written.has(f));
  check('no blocked field is one the portal sends', collisions, []);

  /* the one that looks like it belongs on the list and does not */
  check('paymentStatus is written by the portal, and so is deliberately allowed',
        written.has('paymentStatus') && !orderWrite.includes("hasChild('paymentStatus')"), true);
}

/* ── the order counter cannot be thrown out of range ───────────────────── */
/*
 * meta/orderCounter is writable by any signed-in user because the portal
 * draws a number when a client uploads. The monotonic guard alone let a
 * client jump it to 999999999: order numbers become meaningless, and
 * toReference in hashavshevet-invoice.js rejects anything over 9 digits, so
 * invoicing breaks for everyone — with no way back, since it only goes up.
 */
{
  const v = RULES.rules.meta.orderCounter['.validate'];
  check('the counter still only moves forward', /newData\.val\(\) > data\.val\(\)/.test(v), true);
  check('and no longer by an unbounded jump', /data\.val\(\) \+ \d+/.test(v), true);
}

/* invoiceCounter had no guard at all while its two siblings did */
{
  const v = (RULES.rules.meta.invoiceCounter || {})['.validate'];
  check('the invoice counter cannot be walked backwards',
        typeof v === 'string' && /newData\.val\(\) > data\.val\(\)/.test(v), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-field rule checks passed.');
