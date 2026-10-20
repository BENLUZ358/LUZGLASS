#!/usr/bin/env node
/**
 * זיהוי לקוח לפי כתובת השולח של מייל — api/_email-recipient.js.
 * אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md
 *
 * Run: node scripts/test-email-recipient.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const em = require(path.join(ROOT, 'api', '_email-recipient.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const db = () => fakeDb({
  hashavshevetAccounts: {
    K1: { key: 'K1', name: 'אלפא בע"מ', phone: '050-111 1111', email: 'a@b.com; other@x.co.il' },
    K2: { key: 'K2', name: 'בטא', phone: '052-222-2222', email: 'dup@x.com' },
    K3: { key: 'K3', name: 'גמא', phone: '053-333-3333', email: 'DUP@x.com' },
    K4: { key: 'K4', name: 'דלתא', phone: '054-444 4444', email: 'solo@d.com' },
  },
  users: { '0501111111': { customerId: 'K1', businessName: 'אלפא' } },
});

(async () => {
  check('A1 display-name + brackets, lowercased', em.lgEmailAddr('"Dana" <Dana@X.com>'), 'dana@x.com');
  check('A2 bare address, trimmed', em.lgEmailAddr('  Bob@Y.IO '), 'bob@y.io');
  check('A3 garbage → empty', em.lgEmailAddr('not an address'), '');
  check('A4 empty / null → empty', [em.lgEmailAddr(''), em.lgEmailAddr(null)], ['', '']);

  const spoof = '"boss@client.com <boss@client.com>" <attacker@evil.com>';
  check('A5 <...> inside the display name does not win over the real address',
        em.lgEmailAddr(spoof), 'attacker@evil.com');
  const rs = await em.lgClientFromEmail(fakeDb({ hashavshevetAccounts: { B: { key: 'B', name: 'בוס', email: 'boss@client.com' } } }), spoof);
  check('A6 spoofed display name never matches the other customer card',
        { m: rs.matched, via: rs.via, id: rs.customerId }, { m: false, via: 'none', id: '' });

  const r1 = await em.lgClientFromEmail(db(), 'Someone <OTHER@x.co.il>');
  check('B1 second address on a multi-address card matches',
        { m: r1.matched, via: r1.via, id: r1.customerId, login: r1.loginPhone, name: r1.name, email: r1.email },
        { m: true, via: 'email', id: 'K1', login: '0501111111', name: 'אלפא', email: 'other@x.co.il' });
  check('B2 phone is the login when there is one', r1.phone, '0501111111');

  const r2 = await em.lgClientFromEmail(db(), 'dup@x.com');
  check('C1 same address on two cards → ambiguous, never guessed',
        { m: r2.matched, via: r2.via, c: r2.candidates, id: r2.customerId }, { m: false, via: 'ambiguous', c: 2, id: '' });

  const r3 = await em.lgClientFromEmail(db(), 'nobody@z.com');
  check('D1 unknown sender', { m: r3.matched, via: r3.via, email: r3.email, id: r3.customerId },
        { m: false, via: 'none', email: 'nobody@z.com', id: '' });

  const r4 = await em.lgClientFromEmail(db(), 'Solo <solo@d.com>');
  check('E1 card without a users login → loginPhone empty, card phone + name',
        { m: r4.matched, id: r4.customerId, login: r4.loginPhone, phone: r4.phone, name: r4.name },
        { m: true, id: 'K4', login: '', phone: '0544444444', name: 'דלתא' });

  const r5 = await em.lgClientFromEmail(db(), 'garbage');
  check('F1 unparseable From → none, no crash', { m: r5.matched, via: r5.via, email: r5.email }, { m: false, via: 'none', email: '' });

  const r6 = await em.lgClientFromEmail(fakeDb({}), 'a@b.com');
  check('F2 empty database → none', r6.via, 'none');

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll email recipient checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
