#!/usr/bin/env node
/**
 * Tests lgResolveClientPhone — which number the customer's WhatsApp goes to.
 *
 * It has to be the phone on the client's card in Hashavshevet. That is the
 * number the client also signs in with, because lgProvisionClientFromHashavshevet
 * creates the login from the account record.
 *
 * What the code actually did was send to order.phone — a copy taken when the
 * order was created. In the ordinary case the two are the same number, which is
 * why nothing looked wrong. They come apart when:
 *
 *   the client changes their number in Hashavshevet — old orders keep the old
 *   one, and the message goes to a number that is no longer theirs
 *
 *   an order is entered by hand with a phone typed into the order
 *
 *   a sketch is uploaded through the portal by someone whose phone is not the
 *   billed account's
 *
 * workday.html did not load hashavshevetAccounts at all, so the card was never
 * consulted on that screen.
 *
 * Run: node scripts/test-client-phone.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

const fn = SRC.match(/function lgResolveClientPhone[\s\S]*?\n}/);
if (!fn) { console.error('FAIL  could not extract lgResolveClientPhone'); process.exit(1); }
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fn[0], ctx);
const resolve = ctx.lgResolveClientPhone;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ACCOUNTS = {
  '14201': { key: '14201', name: 'א.מ.מראות', phone: '052-2578559' },
  '14330': { key: '14330', name: 'גרין גלאס',  phone: '0509999999' },
  '14999': { key: '14999', name: 'בלי טלפון',  phone: '' },
};
const BY_PHONE = { '0522578559': '14201', '0509999999': '14330' };

/* ── the card is the source ────────────────────────────────────────────── */
{
  const r = resolve({ customerId: '14201', phone: '0500000000' }, ACCOUNTS, BY_PHONE);
  check('the card wins over the phone copied onto the order', r.phone, '0522578559');
  check('and the screen is told where it came from', r.source, 'hashavshevet');
  check('with the account key', r.accountKey, '14201');
}

/* the usual case: order has no customerId, but the login phone finds the card */
check('resolved through the login phone when the order has no account key',
      resolve({ clientPhone: '0509999999' }, ACCOUNTS, BY_PHONE).phone, '0509999999');

/* the ordinary situation the user expected — both numbers agree */
{
  const r = resolve({ customerId: '14201', clientPhone: '0522578559', phone: '0522578559' },
                    ACCOUNTS, BY_PHONE);
  check('when order and card agree the answer is unchanged', r.phone, '0522578559');
  check('and it is still credited to the card', r.source, 'hashavshevet');
}

/* the case that used to send to the wrong person */
{
  const stale = { customerId: '14201', phone: '0541111111' };   // client changed number
  check('a stale number on the order is not used', resolve(stale, ACCOUNTS, BY_PHONE).phone, '0522578559');
  const oldWay = String(stale.phone).replace(/[-\s]/g, '');
  check('the old code really would have used the stale one', oldWay, '0541111111');
}

/* ── formatting ────────────────────────────────────────────────────────── */
check('dashes and spaces are stripped',
      resolve({ customerId: '14201' }, ACCOUNTS, BY_PHONE).phone, '0522578559');

/* ── falling back, and saying so ───────────────────────────────────────── */
{
  const r = resolve({ customerId: '14999', phone: '0533333333' }, ACCOUNTS, BY_PHONE);
  check('a card with no phone falls back to the order', r.phone, '0533333333');
  check('and says the number did not come from the card', r.source, 'order');
}
{
  const r = resolve({ customerId: 'NOPE', phone: '0533333333' }, ACCOUNTS, BY_PHONE);
  check('an unknown account key falls back too', r.phone, '0533333333');
  check('reported as coming from the order', r.source, 'order');
}
{
  const r = resolve({ orderClient: 'מישהו' }, ACCOUNTS, BY_PHONE);
  check('no number anywhere returns empty', r.phone, '');
  check('and is flagged so nothing is sent', r.source, 'none');
}
check('missing maps do not throw', resolve({ phone: '0521234567' }).phone, '0521234567');
check('a null order does not throw', resolve(null, ACCOUNTS, BY_PHONE).source, 'none');

/* ── the page must actually use it ─────────────────────────────────────── */
{
  const workday = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  check('workday loads the Hashavshevet cards',
        /listenHashavshevetAccounts\(/.test(workday), true);
  check('and resolves through the shared helper',
        /lgResolveClientPhone\(o, _wdAccounts, _customerIdByPhone\)/.test(workday), true);
  check('no send site builds the link from order.phone any more',
        /wa\.me\/972\$\{cleanPhone\(o\.phone\)\}/.test(workday), false);
  check('all three send sites go through one link builder',
        (workday.match(/_waLink\(o,'/g) || []).length, 3);
  check('the confirm dialog shows the number before sending',
        /const t = _waTarget\(o\);/.test(workday), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll client-phone checks passed.');
