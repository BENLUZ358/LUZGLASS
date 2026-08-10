#!/usr/bin/env node
/**
 * Tests /api/whatsapp-send — sending the customer's "order is ready" message
 * from the server, with no browser window and nobody pressing send.
 *
 * wa.me is a deep link, not a send. It opens WhatsApp with the text prepared
 * and waits for a human. On a day with dozens of orders closing that does not
 * work, so the send moved to the WhatsApp Cloud API.
 *
 * A message to a customer cannot be taken back, which sets the bar for the
 * guards here: never for a fictitious order, never twice for the same order,
 * never to a number resolved from nothing, and every attempt recorded.
 *
 * Run: node scripts/test-whatsapp-send.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the number format Meta demands ────────────────────────────────────── */
{
  const fn = SRC.match(/function toWaNumber[\s\S]*?\n}/);
  if (!fn) { console.error('FAIL  could not extract toWaNumber'); process.exit(1); }
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fn[0], ctx);
  const wa = ctx.toWaNumber;

  check('an Israeli mobile with dashes', wa('052-4647285'), '972524647285');
  check('without dashes',                wa('0524647285'),  '972524647285');
  check('with spaces',                   wa('052 464 7285'), '972524647285');
  check('already international',         wa('972524647285'), '972524647285');
  check('with a plus',                   wa('+972524647285'), '972524647285');
  check('empty stays empty',             wa(''), '');
  check('null does not throw',           wa(null), '');
}

/* ── the guards ────────────────────────────────────────────────────────── */
check('a fictitious order never messages a real customer',
      /if \(order\.isTest\) \{[\s\S]{0,200}?continue;/.test(SRC), true);
check('an order already messaged is not messaged again',
      /prev && prev\.sentAt && !force/.test(SRC), true);
check('sending is opt-in, never the default',
      /const dryRun\s*=\s*body\.dryRun !== false/.test(SRC), true);
check('an order with no number is reported, not sent blank',
      /if \(!target\.phone\)[\s\S]{0,200}?continue;/.test(SRC), true);
check('every attempt is written to the order',
      /db\.ref\('orders\/' \+ orderId \+ '\/whatsapp'\)\.set\(record\)/.test(SRC), true);
check('the raw response is kept',
      /response:\s*String\(text\)\.slice/.test(SRC), true);
check('"Meta accepted it" is stored apart from "sent"',
      /httpOk:\s*ok/.test(SRC) && /sentAt:\s*ok \? Date\.now\(\) : null/.test(SRC), true);

/* the browser may not choose who gets messaged */
check('the browser sends order ids only',
      /const orderIds = Array\.isArray\(body\.orderIds\)/.test(SRC), true);
check('the phone is resolved server-side',
      /await resolvePhone\(db, order\)/.test(SRC), true);
check('through the same chain as the card lookup',
      /hashavshevetAccounts\/'/.test(SRC), true);

/* bulk safety */
check('a burst is paced rather than fired at once', /await sleep\(GAP_MS\)/.test(SRC), true);
check('and capped per run', /orderIds\.length > MAX_PER_RUN/.test(SRC), true);

/* ── it must be harmless before Meta is connected ──────────────────────── */
check('missing Meta config falls back to preview',
      /if \(dryRun \|\| !configured\)/.test(SRC), true);
check('configured means all three variables',
      /const configured = !!\(PHONE_ID && TOKEN && TEMPLATE\)/.test(SRC), true);

/* ── the caller ────────────────────────────────────────────────────────── */
{
  const workday = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  check('workday no longer opens a window per order',
        /setTimeout\(\(\) => \{\s*\{ const _u = _waLink/.test(workday), false);
  check('completed orders are collected', /_waPending\.push\(sid\)/.test(workday), true);
  check('and sent in one call', /_waSendBulk\(_waPending\)/.test(workday), true);
  check('failures are surfaced, not swallowed', /_waFailureBanner\(failed\)/.test(workday), true);

  /* the auth helpers moved to the shared file so the two pages cannot drift */
  const db = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('_lgAuthPost lives in the shared script', /async function _lgAuthPost\(/.test(db), true);
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('and admin no longer keeps its own copy',
        /async function _lgAuthPost\(/.test(admin), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll WhatsApp send checks passed.');
