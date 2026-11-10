#!/usr/bin/env node
/**
 * משלוחים לשרטט — הפעולות מהאדמין דרך /api/wa-inbound-drain (בן, 10/11).
 * Run: node scripts/test-drafter-drain.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const adm = require(path.join(__dirname, '..', 'api', 'wa-inbound-drain.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1762770000000;
process.env.EMAIL_ONLY_TO = 'lozzagagot@gmail.com';
const db = fakeDb({ orders: {
  A1: { id: 'A1', orderNum: 'L1', orderClient: 'אגן', sketchName: 'מקלחון', stage: 'drafter', createdAt: NOW },
  A2: { id: 'A2', orderNum: 'L2', orderClient: 'נאור', sketchName: 'מראה', stage: 'chash', createdAt: NOW },
} });

(async () => {
  let r = await adm.handleAdmin({ action: 'drafter-status' }, { db, by: '052', now: NOW });
  check('status', [r.ok, r.basket.length, r.open.length], [true, 2, 0]);
  r = await adm.handleAdmin({ action: 'drafter-send', to: 'evil@x.com' }, { db, by: '052', now: NOW });
  check('send', [r.ok, r.n, r.orderIds.length, r.emailState], [true, 1, 2, 'pending']);
  const rec = db._data.waMeta.emailOutbox[db._data.waMeta.drafterBatches['1'].emailKey];
  check('send ignores body address', rec.sendTo, 'lozzagagot@gmail.com');
  check('send records who', db._data.waMeta.drafterBatches['1'].by, '052');
  r = await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW + 1 });
  check('send empty', [r.ok, r.code], [false, 'empty']);
  r = await adm.handleAdmin({ action: 'drafter-status' }, { db, by: '052', now: NOW + 2 });
  check('status after send', [r.basket.length, r.open.map(b => [b.n, b.count, b.emailState])], [0, [[1, 2, 'pending']]]);
  r = await adm.handleAdmin({ action: 'drafter-done' }, { db, by: '052', now: NOW + 3 });
  check('done', [r.ok, r.moved.length, r.skipped.length, db._data.orders.A1.stage], [true, 2, 0, 'opty']);

  // שליחה חוזרת
  db._data.orders.A3 = { id: 'A3', orderNum: 'L3', orderClient: 'אגן', stage: 'drafter', createdAt: NOW };
  r = await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW + 10 });
  const key = db._data.waMeta.drafterBatches[String(r.n)].emailKey;
  db._data.waMeta.emailOutbox[key].state = 'failed';
  r = await adm.handleAdmin({ action: 'drafter-resend', n: 2 }, { db, by: '052', now: NOW + 11 });
  check('resend', [r.ok, db._data.waMeta.emailOutbox[key].state], [true, 'pending']);
  r = await adm.handleAdmin({ action: 'drafter-resend', n: 'x' }, { db, by: '052', now: NOW + 12 });
  check('resend bad n', r.ok, false);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll drafter-drain checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
