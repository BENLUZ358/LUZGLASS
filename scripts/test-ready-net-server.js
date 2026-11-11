#!/usr/bin/env node
//  "מוכן לאיסוף" שלא יצא מהדף נשלח מהשרת (api/_ready-net.js, בן 11/11).
//  Run: node scripts/test-ready-net-server.js
const assert = require('assert');
const { fakeDb } = require('./_fake-db');
const N = require('../api/_ready-net');

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log('ok ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + '\n   ' + (e && e.message)); }
};
const MIN = 60e3, H = 60 * MIN;
//  יום שלישי 11/11/2026 12:30 שעון ישראל
const NOW = Date.UTC(2026, 10, 11, 10, 30);
const ord = (id, o) => ({ id, stage: 'done', orderClient: 'א.מ.מראות', orderNum: 'L' + id, sketchName: 'S' + id, readyAt: NOW - 20 * MIN, ...o });

(async () => {
  await test('pick: only done, 3min–24h, no message, not test, not already queued/tried', async () => {
    const orders = {
      a: ord('a'), b: ord('b'),
      fresh: ord('fresh', { readyAt: NOW - MIN }),
      old: ord('old', { readyAt: NOW - 25 * H }),
      sent: ord('sent', { whatsapp: { sentAt: NOW - 10 * MIN } }),
      mail: ord('mail', { emailNotices: { ready: { sentAt: 1 } } }),
      test: ord('test', { isTest: true }),
      notdone: ord('notdone', { stage: 'collected' }),
      noready: ord('noready', { readyAt: 0 }),
      queued: ord('queued'), tried: ord('tried'),
      other: ord('other', { orderClient: 'נאור', readyAt: NOW - 30 * MIN }),
    };
    const g = N.lgReadyNetPick(orders, NOW, new Set(['queued']), { tried: NOW - MIN });
    assert.deepEqual(g, [{ client: 'נאור', ids: ['other'] }, { client: 'א.מ.מראות', ids: ['a', 'b'] }]);
  });

  await test('hours: Sun–Fri 06–20 Israel time only', async () => {
    assert.equal(N.lgReadyNetHours(NOW), true);
    assert.equal(N.lgReadyNetHours(Date.UTC(2026, 10, 11, 2, 0)), false);    // 04:00
    assert.equal(N.lgReadyNetHours(Date.UTC(2026, 10, 14, 10, 0)), false);   // שבת
    assert.equal(N.lgReadyNetHours(Date.UTC(2026, 10, 13, 8, 0)), true);     // שישי 10:00
  });

  const base = () => fakeDb({
    orders: { a: ord('a'), b: ord('b'), c: ord('c', { orderClient: 'כתר' }) },
    waOutbox: { k1: { kind: 'ready', state: 'pending', orderIds: ['c'], createdAt: NOW - 5 * MIN } },
  });

  await test('run: dispatches the lost group once, drains, writes a room line, marks tried', async () => {
    const db = base();
    const calls = [], drained = [];
    const r = await N.lgReadyNetRun(db, { now: NOW,
      dispatch: async (_db, ids) => { calls.push(ids); return { status: 200, body: { queued: true, outboxKey: 'ok1' } }; },
      drain: async (_db, keys) => { drained.push(...keys); } });
    assert.deepEqual(calls, [['a', 'b']]);          // c כבר בתור — לא שוב
    assert.deepEqual(drained, ['ok1']);
    assert.equal(r.sent, 1);
    assert.ok(db._data.waMeta.readyNet.tried.a && db._data.waMeta.readyNet.tried.b);
    const room = Object.values(db._data.waMeta.agentRoom || {});
    assert.equal(room.length, 1);
    assert.equal(room[0].agent, 'okev');
    assert.ok(/א\.מ\.מראות/.test(room[0].text) && /Sa, Sb/.test(room[0].text) && /שלחתי/.test(room[0].text));
  });

  await test('run: throttled for 5 minutes, and a tried order is never sent twice', async () => {
    const db = base();
    let n = 0;
    const dispatch = async () => { n++; return { status: 200, body: { queued: true, outboxKey: 'x' } }; };
    await N.lgReadyNetRun(db, { now: NOW, dispatch, drain: async () => {} });
    assert.equal((await N.lgReadyNetRun(db, { now: NOW + MIN, dispatch, drain: async () => {} })).skipped, 'throttled');
    await N.lgReadyNetRun(db, { now: NOW + 6 * MIN, dispatch, drain: async () => {} });
    assert.equal(n, 1);
  });

  await test('run: refused (two recipients) → room line with the reason, no drain, not retried', async () => {
    const db = base();
    let drained = 0;
    await N.lgReadyNetRun(db, { now: NOW,
      dispatch: async () => ({ status: 409, body: { error: 'ההזמנות בקבוצה הזו מובילות למספרי טלפון שונים — לא נשלחה הודעה' } }),
      drain: async () => { drained++; } });
    assert.equal(drained, 0);
    const room = Object.values(db._data.waMeta.agentRoom || {});
    assert.ok(/מספרי טלפון שונים/.test(room[0].text) && /לא נשלחה/.test(room[0].text));
    assert.ok(db._data.waMeta.readyNet.tried.a);
  });

  await test('run: outside working hours → nothing', async () => {
    const db = base();
    const r = await N.lgReadyNetRun(db, { now: Date.UTC(2026, 10, 14, 10, 0), dispatch: async () => { throw new Error('no'); } });
    assert.equal(r.skipped, 'hours');
  });

  await test('dispatch: deps.auth only from server code — a request without it still needs an admin', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'whatsapp-dispatch.js'), 'utf8');
    assert.ok(/deps && deps\.auth && deps\.auth\.ok === true\) \? deps\.auth : await verifyAdmin\(req\)/.test(src));
  });

  await test('heartbeat runs the net (and a failure there does not break the heartbeat)', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', '_invoice-upload.js'), 'utf8');
    assert.ok(/require\('\.\/_ready-net'\)\.lgReadyNetRun/.test(src));
    assert.ok(/catch \(e\) \{ console\.error\('invoice-pdf-upload: ready-net failed'/.test(src));
  });

  console.log(`\n${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}`);
  process.exit(fail ? 1 : 0);
})();
