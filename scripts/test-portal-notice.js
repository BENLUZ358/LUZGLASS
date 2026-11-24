#!/usr/bin/env node
/**
 * הודעה כללית ללקוח פורטל (בן, 24/11): סרטון מסך הבית + החלפת סיסמה. kind 'notice' בתור waOutbox, בלי הזמנה.
 * Run: node scripts/test-portal-notice.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const core = require('../api/_wa-drain-core.js');
const { renderText } = require('../api/_wa-provider.js');
const { lgWaEnqueue } = require('../api/_wa-outbox.js');
let failed = 0;
const check = (n, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + n)
  : (failed++, console.error(`FAIL  ${n}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

check('text keeps blank lines between paragraphs', renderText({ kind: 'notice', extraLines: ['שלום א', '', 'שורה', '', 'LuzGlass'] }), 'שלום א\n\nשורה\n\nLuzGlass');

const sent = [];
const provider = { name: 'fake', configured: true, maxPerRun: 10, globalSlot: false, nextGap: () => 0,
  gate: ({ accountKey, linked }) => (accountKey && linked ? { allowed: true } : { allowed: false, reason: 'no' }),
  async send(f) { sent.push(f); return { ok: true, messageId: 'm' + sent.length }; } };

(async () => {
  const db = fakeDb({ users: {
    '0501111111': { role: 'client', customerId: '7', name: 'לקוח' },
    '0547725552': { role: 'admin', name: 'מנהל' },
    '037436564':  { role: 'client', customerId: '3150', name: 'קווי' },
  } });
  const q = async (to, k) => (await lgWaEnqueue(db, { kind: 'notice', to, clientName: 'x', orderIds: [], keySuffix: k, extraLines: ['שלום', '', 'קישור'] })).key;
  const keys = [await q('0501111111', 'a'), await q('0547725552', 'b'), await q('037436564', 'c'), await q('0509999999', 'd')];
  const r = await core.drainKeys(db, provider, keys, 'test', Date.now());
  check('only the client mobile gets it', sent.map(s => s.to), ['0501111111']);
  check('admin, landline and unknown number are blocked', r.results.map(x => x.status), ['sent', 'blocked', 'blocked', 'blocked']);
  check('entry marked sent', db._data.waOutbox[keys[0]].state, 'sent');
  check('no order touched', db._data.orders, undefined);
  const again = await lgWaEnqueue(db, { kind: 'notice', to: '0501111111', orderIds: [], keySuffix: 'a', extraLines: ['x'] });
  check('same notice twice is not queued again', again.queued, false);
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error('crashed', e); process.exit(1); });
