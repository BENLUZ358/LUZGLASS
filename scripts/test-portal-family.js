#!/usr/bin/env node
/**
 * כניסה אחת לכמה כרטיסים (בן, 24/11): המקום לאמבט רואה גם את הר מקלחונים ואת כתר מקלחונים,
 * עם סינון בפנים. users/<טלפון>/portalCards = { '<כרטיס>': '<שם>' }.
 * Run: node scripts/test-portal-family.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const rcp = require('../api/_wa-recipient.js');
const em = require('../api/_email-recipient.js');
const pc = require('../portal-cards.js');
let failed = 0;
const check = (n, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + n)
  : (failed++, console.error(`FAIL  ${n}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

const users = {
  '0505887576': { role: 'client', customerId: '14201', name: 'המקום לאמבט', portalCards: { 1333: 'כתר מקלחונים', 1358: 'הר מקלחונים' } },
  '0545350009': { role: 'client', customerId: '1333', name: 'כתר מקלחונים' },
  '0507158600': { role: 'client', customerId: '856', name: 'A.V' },
};
check('own card → own login', rcp.lgLoginForCard(users, '14201'), '0505887576');
check('a card in someone\'s portalCards → that login, even if the card has its own user', rcp.lgLoginForCard(users, '1333'), '0505887576');
check('card with no user, only in portalCards → that login', rcp.lgLoginForCard(users, '1358'), '0505887576');
check('ordinary card unchanged', rcp.lgLoginForCard(users, '856'), '0507158600');
check('unknown card → empty', rcp.lgLoginForCard(users, '999'), '');
check('admin never a login for a card', rcp.lgLoginForCard({ '05': { role: 'admin', customerId: '7' } }, '7', { clientOnly: true }), '');

(async () => {
  const db = fakeDb({ users, waGroups: { G_us: { customerId: '1333', customerName: 'כתר מקלחונים' } }, hashavshevetAccounts: { 1333: { key: '1333', name: 'כתר מקלחונים', phone: '0545350009' } } });
  const g = await rcp.lgClientFromWaGroup(db, 'G.us', '0501111111');
  check('group of Keter → order goes to the HaMakom login', [g.loginPhone, g.phone, g.customerId], ['0505887576', '0505887576', '1333']);
  const db2 = fakeDb({ users, waSenders: { '0501112222': { customerId: '1358', customerName: 'הר מקלחונים' } } });
  const s = await rcp.lgClientFromWaSender(db2, '972501112222@c.us');
  check('private number linked to Har → HaMakom login', [s.loginPhone, s.customerId], ['0505887576', '1358']);
  const db3 = fakeDb({ users, waMeta: { emailSenders: { [em.lgEmailKey('x@y.co')]: { customerId: '1333', customerName: 'כתר מקלחונים' } } } });
  const e = await em.lgClientFromEmail(db3, 'x@y.co');
  check('email linked to Keter → HaMakom login', [e.loginPhone, e.customerId], ['0505887576', '1333']);

  // ── הפורטל ──
  const orders = [{ customerId: '14201', orderClient: 'המקום לאמבט' }, { customerId: '14201', orderClient: 'המקום לאמבט' },
    { customerId: '1358', orderClient: 'הר מקלחונים' }, { customerId: '1333', orderClient: 'כתר מקלחונים' }];
  check('cards: one chip per card, most orders first, with counts', pc.lgPortalCards(orders, users['0505887576'].portalCards).map(c => [c.id, c.name, c.n]),
    [['14201', 'המקום לאמבט', 2], ['1358', 'הר מקלחונים', 1], ['1333', 'כתר מקלחונים', 1]]);
  check('a card with no orders yet still has a chip (from portalCards)', pc.lgPortalCards(orders.slice(0, 3), users['0505887576'].portalCards).map(c => c.id), ['14201', '1358', '1333']);
  check('one card only → no chips', pc.lgPortalCards(orders.slice(0, 2), null), []);
  check('pick a card', pc.lgPortalPick(orders, '1358').length, 1);
  check('"all" → everything', pc.lgPortalPick(orders, '').length, 4);
  check('picked card that is gone → everything', pc.lgPortalPick(orders, '777').length, 4);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error('crashed', e); process.exit(1); });
