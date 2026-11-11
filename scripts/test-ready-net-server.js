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

  //  a,b,c סומנו "מוכן" לפני 20 דק' ונרשמו למעקב; c כבר בתור
  const base = (extra) => fakeDb({
    orders: { a: ord('a'), b: ord('b'), c: ord('c', { orderClient: 'כתר' }), big: ord('big') },
    waOutbox: { k1: { kind: 'ready', state: 'pending', orderIds: ['c'], createdAt: NOW - 5 * MIN } },
    waMeta: { readyNet: { watch: { a: NOW - 20 * MIN, b: NOW - 20 * MIN, c: NOW - 20 * MIN, ...(extra || {}) } } },
  });
  const watchOf = db => ((db._data.waMeta || {}).readyNet || {}).watch || {};

  await test('run: dispatches the lost group once, drains, writes a room line, clears the watch', async () => {
    const db = base();
    const calls = [], drained = [];
    const r = await N.lgReadyNetRun(db, { now: NOW,
      dispatch: async (_db, ids) => { calls.push(ids); return { status: 200, body: { queued: true, outboxKey: 'ok1' } }; },
      drain: async (_db, keys) => { drained.push(...keys); } });
    assert.deepEqual(calls, [['a', 'b']]);          // c כבר בתור — לא שוב; big לא במעקב — לא נבדק בכלל
    assert.deepEqual(drained, ['ok1']);
    assert.equal(r.sent, 1);
    assert.deepEqual(Object.keys(watchOf(db)), []);
    const room = Object.values(db._data.waMeta.agentRoom || {});
    assert.equal(room.length, 1);
    assert.equal(room[0].agent, 'okev');
    assert.ok(/א\.מ\.מראות/.test(room[0].text) && /Sa, Sb/.test(room[0].text) && /שלחתי/.test(room[0].text));
  });

  await test('run: empty watch list → reads no order at all', async () => {
    const db = fakeDb({ orders: { a: ord('a') } });
    const ref = db.ref.bind(db); const paths = [];
    db.ref = p => { paths.push(p); return ref(p); };
    const r = await N.lgReadyNetRun(db, { now: NOW, dispatch: async () => { throw new Error('no'); } });
    assert.equal(r.sent, 0);
    assert.ok(!paths.some(p => /^orders/.test(p)), paths.join(','));
  });

  await test('run: marked under 3 minutes ago → waits, stays on the list', async () => {
    const db = fakeDb({ orders: { a: ord('a', { readyAt: NOW - MIN }) }, waMeta: { readyNet: { watch: { a: NOW - MIN } } } });
    let n = 0;
    await N.lgReadyNetRun(db, { now: NOW, dispatch: async () => { n++; return { status: 200, body: { queued: true, outboxKey: 'x' } }; }, drain: async () => {} });
    assert.equal(n, 0);
    assert.ok(watchOf(db).a);
    await N.lgReadyNetRun(db, { now: NOW + 3 * MIN, dispatch: async () => { n++; return { status: 200, body: { queued: true, outboxKey: 'x' } }; }, drain: async () => {} });
    assert.equal(n, 1);
  });

  await test('run: an order is tried once — next heartbeat sends nothing', async () => {
    const db = base();
    let n = 0;
    const dispatch = async () => { n++; return { status: 200, body: { queued: true, outboxKey: 'x' } }; };
    await N.lgReadyNetRun(db, { now: NOW, dispatch, drain: async () => {} });
    await N.lgReadyNetRun(db, { now: NOW + 2 * MIN, dispatch, drain: async () => {} });
    assert.equal(n, 1);
  });

  await test('run: refused (two recipients) → room line with the reason, no drain, not retried', async () => {
    const db = base();
    let drained = 0, n = 0;
    const dispatch = async () => { n++; return { status: 409, body: { error: 'ההזמנות בקבוצה הזו מובילות למספרי טלפון שונים — לא נשלחה הודעה' } }; };
    await N.lgReadyNetRun(db, { now: NOW, dispatch, drain: async () => { drained++; } });
    assert.equal(drained, 0);
    const room = Object.values(db._data.waMeta.agentRoom || {});
    assert.ok(/מספרי טלפון שונים/.test(room[0].text) && /לא נשלחה/.test(room[0].text));
    await N.lgReadyNetRun(db, { now: NOW + 2 * MIN, dispatch, drain: async () => {} });
    assert.equal(n, 1);
  });

  await test('run: outside working hours → nothing', async () => {
    const db = base();
    const r = await N.lgReadyNetRun(db, { now: Date.UTC(2026, 10, 14, 10, 0), dispatch: async () => { throw new Error('no'); } });
    assert.equal(r.skipped, 'hours');
  });

  await test('watch/unwatch: only valid order ids', async () => {
    const db = fakeDb({});
    assert.equal(await N.lgReadyNetWatch(db, ['x1', 'a/b', '', 'y.2', 'z3'], NOW), 2);
    assert.deepEqual(Object.keys(watchOf(db)).sort(), ['x1', 'z3']);
    await N.lgReadyNetUnwatch(db, ['x1']);
    assert.deepEqual(Object.keys(watchOf(db)), ['z3']);
  });

  await test('page: marking done tells the server to start watching; a queued ready message clears it', async () => {
    const fs = require('fs'), path = require('path');
    const fdb = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
    assert.ok(/nextStage === 'done' && typeof _lgAuthPost === 'function'[\s\S]{0,200}kind:'ready-watch'/.test(fdb));
    const d = fs.readFileSync(path.join(__dirname, '..', 'api', 'whatsapp-dispatch.js'), 'utf8');
    assert.ok(/body\.kind === 'ready-watch'[\s\S]{0,400}lgReadyNetWatch/.test(d));
    assert.ok(/kind === 'ready'\) \{\s*try \{ await require\('\.\/_ready-net'\)\.lgReadyNetUnwatch\(db, liveIds\)/.test(d));
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

  //  תיקון סקירה סופית I3: הדופק מעביר את מה שנשאר עד t0+55ש׳; 0 → לא שולחים (השורות ממתינות)
  await test('run: budgetMs passed to drain; budget 0 → no drain, rows stay pending', async () => {
    const disp = async () => ({ status: 200, body: { queued: true, outboxKey: 'ok1' } });
    let got = null;
    await N.lgReadyNetRun(base(), { now: NOW, budgetMs: 7000, dispatch: disp, drain: async (_d, keys, by, o) => { got = o; } });
    assert.deepEqual(got, { budgetMs: 7000 });
    let drained = 0;
    const r = await N.lgReadyNetRun(base(), { now: NOW, budgetMs: 0, dispatch: disp, drain: async () => { drained++; } });
    assert.equal(drained, 0);
    assert.equal(r.sent, 1);   // נכנסה לתור — תצא בשליחה הבאה
    let def = 'unset';
    await N.lgReadyNetRun(base(), { now: NOW, dispatch: disp, drain: async (_d, keys, by, o) => { def = o; } });
    assert.deepEqual(def, {});   // בלי budgetMs — התקציב הרגיל של drainNow
  });

  await test('heartbeat: ready-net gets budget = t0+55s − now (≤ 55s, shrinks with elapsed time)', async () => {
    const { handleUpload } = require('../api/_invoice-upload.js');
    const beat = async (slowMs) => {
      let budget = null;
      await handleUpload({ method: 'POST', headers: { authorization: 'Bearer T' }, body: { op: 'heartbeat', pc: 'OFFICE', pending: [] } }, {
        db: fakeDb({}), env: { INVOICE_UPLOAD_TOKEN: 'T' }, now: NOW,
        waDrain: async () => {}, clockCheck: async () => {},
        watchRun: async () => { if (slowMs) await new Promise(r => setTimeout(r, slowMs)); },
        readyNet: async (_d, o) => { budget = o.budgetMs; } });
      return budget;
    };
    const a = await beat(0);
    assert.ok(a > 54000 && a <= 55000, 'fast beat budget ' + a);
    const b = await beat(300);
    assert.ok(b <= 55000 - 300 + 5 && b > 50000, 'slow beat budget ' + b);
  });

  console.log(`\n${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}`);
  process.exit(fail ? 1 : 0);
})();
