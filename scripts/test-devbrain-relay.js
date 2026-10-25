'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakeDb } = require('./_fake-db');
const { handleRelay, maybeCaptureOwner, canonical } = require('../api/_devbrain-relay');
const { handleInbound, handleCustomerInbound } = require('../api/wa-inbound');
const env = { DEV_BRAIN_RELAY_ENABLED: 'true', DEV_BRAIN_RELAY_OWNER: '+972501234567', DEV_BRAIN_RELAY_TOKEN: 'a'.repeat(64),
  DEV_BRAIN_RELAY_PROJECT: 'luz-glass-test', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"luz-glass-test"}', GREENAPI_ID_INSTANCE: '12345' };
const raw = () => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 12345 }, idMessage: 'msg1',
  senderData: { chatId: '972501234567@c.us', sender: '972501234567@c.us' }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'hello' } } });
const request = body => ({ method: 'POST', headers: { authorization: 'Bearer ' + env.DEV_BRAIN_RELAY_TOKEN, 'x-devbrain-project': env.DEV_BRAIN_RELAY_PROJECT }, body });
const claim = deps => handleRelay(request({ action: 'claim', workerId: 'worker-123' }), deps);
const ack = (entry, decision = 'customer') => request({ action: 'ack', key: entry.key, leaseToken: entry.leaseToken, decision });
async function fixture() { const deps = { db: fakeDb(), env: { ...env }, now: 1000 }; assert.equal((await maybeCaptureOwner(raw(), deps)).status, 200); return deps; }
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }
(async () => {
  await test('successful ACK receipt matches parent contract for every decision and retry', async () => {
    for (const decision of ['customer', 'development', 'review']) {
      const deps = await fixture(); deps.customer = async () => ({ status: 200, body: { recorded: true } });
      const entry = (await claim(deps)).body.entry;
      for (let retry = 0; retry < 2; retry++) {
        const r = await handleRelay(ack(entry, decision), deps);
        assert.equal(r.status, 200); assert.equal(r.body.ok, true);
        assert.equal(r.body.state, 'done'); assert.equal(r.body.decision, decision);
        assert.equal(r.body.projectId, env.DEV_BRAIN_RELAY_PROJECT);
        if (decision === 'customer') assert.equal(r.body.disposition, 'inbox');
      }
    }
  });
  await test('strict raw identity rejects nonstring or oversized IDs, blank text and bad instance lengths', async () => {
    for (const change of [b => b.idMessage = 123, b => b.idMessage = '', b => b.idMessage = 'x'.repeat(201),
      b => b.messageData.textMessageData.textMessage = ' \n\t', b => b.instanceData.idInstance = '1234',
      b => b.instanceData.idInstance = '1'.repeat(21), b => b.instanceData.idInstance = '12abc']) {
      const b = raw(); change(b);
      assert.equal((await maybeCaptureOwner(b, { env, db: fakeDb() })).status, 400);
    }
    const b = raw(); b.idMessage = 'x'.repeat(200);
    assert.equal((await maybeCaptureOwner(b, { env, db: fakeDb() })).status, 200);
    for (const instance of ['1234', '1'.repeat(21), '12abc']) assert.equal((await claim({ env: { ...env, GREENAPI_ID_INSTANCE: instance } })).status, 503);
  });
  await test('canonical depth max32 returns capture400 instead of throwing', async () => {
    const nested = depth => { let v = 'leaf'; while (depth--) v = { child: v }; return v; };
    assert.doesNotThrow(() => canonical(nested(32)));
    assert.throws(() => canonical(nested(33)));
    const b = raw(); b.extra = nested(33);
    assert.equal((await maybeCaptureOwner(b, { env, db: fakeDb() })).status, 400);
    b.extra = nested(31); assert.equal((await maybeCaptureOwner(b, { env, db: fakeDb() })).status, 200);
  });
  await test('only Israeli mobile owners normalize; arbitrary characters are rejected', async () => {
    for (const owner of ['0501234567', '972501234567', '+972 (50) 123-4567']) assert.equal((await maybeCaptureOwner(raw(), { env: { ...env, DEV_BRAIN_RELAY_OWNER: owner }, db: fakeDb() })).status, 200);
    for (const owner of ['021234567', '97221234567', '0501234567evil', '+97250/1234567']) assert.equal((await claim({ env: { ...env, DEV_BRAIN_RELAY_OWNER: owner } })).status, 503);
  });
  await test('route sends no-store even on disabled error without initializing Firebase', async () => {
    const saved = process.env.DEV_BRAIN_RELAY_ENABLED; process.env.DEV_BRAIN_RELAY_ENABLED = '';
    try {
      const headers = {}; let status;
      const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(s) { status = s; return this; }, json() {} };
      await require('../api/devbrain-relay')({ method: 'POST' }, res);
      assert.equal(status, 503); assert.equal(headers['cache-control'], 'no-store');
    } finally { if (saved === undefined) delete process.env.DEV_BRAIN_RELAY_ENABLED; else process.env.DEV_BRAIN_RELAY_ENABLED = saved; }
  });
  await test('disabled is unchanged; invalid config fails closed only for identifiable owner text', async () => {
    for (const patch of [{ DEV_BRAIN_RELAY_ENABLED: '' }, { DEV_BRAIN_RELAY_ENABLED: 'TRUE' }]) assert.equal(await maybeCaptureOwner(raw(), { env: { ...env, ...patch } }), null);
    for (const patch of [{ DEV_BRAIN_RELAY_TOKEN: '' }, { DEV_BRAIN_RELAY_PROJECT: 'lussglass' }, { FIREBASE_SERVICE_ACCOUNT: '{' }, { GREENAPI_ID_INSTANCE: '' }]) {
      assert.equal((await maybeCaptureOwner(raw(), { env: { ...env, ...patch } })).status, 503);
      assert.equal((await claim({ env: { ...env, ...patch } })).status, 503);
    }
  });
  await test('only incoming private owner current text; other events bypass without writes', async () => {
    for (const change of [b => b.typeWebhook = 'outgoingMessageReceived', b => b.senderData.chatId = '972509999999@c.us', b => b.senderData.chatId = '123@g.us', b => b.messageData.typeMessage = 'imageMessage', b => b.senderData.sender = '972509999999@c.us']) {
      const b = raw(); change(b); assert.equal(await maybeCaptureOwner(b, { env }), null);
    }
    for (const type of ['extendedTextMessage', 'quotedMessage']) {
      const b = raw(); b.messageData = { typeMessage: type, extendedTextMessageData: { text: 'current', quotedMessage: { text: 'not current' } } };
      const db = fakeDb(); assert.equal((await maybeCaptureOwner(b, { env, db })).status, 200);
      assert.deepEqual(Object.values(db._data.devBrainRelay)[0].raw, b);
    }
  });
  await test('limits, missing identifiers and instance mismatch never enter customer pipeline', async () => {
    for (const change of [b => delete b.idMessage, b => b.idMessage = {}, b => b.instanceData.idInstance = 456,
      b => b.messageData.textMessageData.textMessage = 'x'.repeat(20001), b => b.extra = 'א'.repeat(33000), b => delete b.messageData.textMessageData]) {
      const b = raw(); change(b); const db = fakeDb(); assert.equal((await maybeCaptureOwner(b, { env, db })).status, 400); assert.deepEqual(db._data, {});
    }
    const b = raw(); b.messageData.textMessageData.textMessage = 'x'.repeat(20000); assert.equal((await maybeCaptureOwner(b, { env, db: fakeDb() })).status, 200);
  });
  await test('durable create-once, canonical hash, exact key and collision rejection', async () => {
    const deps = await fixture(); const b = raw();
    assert.equal((await maybeCaptureOwner(b, deps)).status, 200);
    const keys = Object.keys(deps.db._data.devBrainRelay); assert.equal(keys.length, 1);
    assert.equal(keys[0], crypto.createHash('sha256').update(JSON.stringify(['luz-glass-test', '12345', 'msg1'])).digest('hex'));
    const reordered = Object.fromEntries(Object.entries(b).reverse()); assert.equal((await maybeCaptureOwner(reordered, deps)).status, 200);
    assert.equal(canonical({ z: [3, null, true], a: { y: 'א', b: 1 } }), '{"a":{"b":1,"y":"א"},"z":[3,null,true]}');
    b.messageData.textMessageData.textMessage = 'changed'; assert.equal((await maybeCaptureOwner(b, deps)).status, 409);
    assert.equal((await maybeCaptureOwner(raw(), { env, db: { ref() { throw Error('offline'); } } })).status, 500);
  });
  await test('route auth, scope, method and strict request fields', async () => {
    const deps = await fixture(); const r = request({ action: 'claim', workerId: 'worker-123' });
    r.headers.authorization = 'Bearer ' + 'b'.repeat(64); assert.equal((await handleRelay(r, deps)).status, 401);
    r.headers.authorization = request({}).headers.authorization; r.headers['x-devbrain-project'] = 'lussglass'; assert.equal((await handleRelay(r, deps)).status, 403);
    r.method = 'GET'; assert.equal((await handleRelay(r, deps)).status, 405);
    for (const b of [{ action: 'claim', workerId: 'x' }, { action: 'claim', workerId: 'worker-123', raw: raw() }, { action: 'ack', key: '../orders', leaseToken: 'a'.repeat(64), decision: 'customer' }]) assert.equal((await handleRelay(request(b), deps)).status, 400);
  });
  await test('null-first and concurrent claims yield one lease; expiry fences stale ACK', async () => {
    const deps = await fixture(); const claims = await Promise.all([claim(deps), claim(deps)]);
    const entries = claims.map(r => r.body.entry).filter(Boolean); assert.equal(entries.length, 1);
    const old = entries[0]; assert.equal(old.leaseUntil, 61000); assert.equal(old.decision, null);
    deps.now = 61000; const fresh = (await claim(deps)).body.entry; assert.ok(fresh); assert.notEqual(fresh.leaseToken, old.leaseToken);
    let replayed = 0; deps.customer = async () => { replayed++; return { status: 200, body: { recorded: true } }; };
    assert.equal((await handleRelay(ack(old), deps)).status, 409); assert.equal(replayed, 0);
    assert.equal((await handleRelay(ack(fresh, 'development'), deps)).status, 200); assert.equal(replayed, 0);
    assert.equal((await handleRelay(ack(fresh, 'development'), deps)).status, 200);
    assert.equal((await handleRelay(ack(fresh, 'review'), deps)).status, 409);
    assert.equal((await claim({ ...deps, now: Number.MAX_SAFE_INTEGER - 1 })).body.entry, null);
  });
  await test('frozen pending survives callback failure and expiry; lost ACK is idempotent', async () => {
    const deps = await fixture(); const first = (await claim(deps)).body.entry;
    deps.customer = async () => ({ status: 500 }); assert.equal((await handleRelay(ack(first), deps)).status, 500);
    const rec = deps.db._data.devBrainRelay[first.key]; assert.equal(rec.state, 'handoff_pending'); assert.equal(rec.decision, 'customer');
    assert.equal((await handleRelay(ack(first, 'development'), deps)).status, 409);
    deps.now = 61001; const next = (await claim(deps)).body.entry; assert.equal(next.decision, 'customer');
    let calls = 0; deps.customer = async stored => { calls++; assert.deepEqual(stored, raw()); return { status: 200, body: { recorded: false } }; };
    assert.equal((await handleRelay(ack(next, 'review'), deps)).status, 409);
    assert.equal((await handleRelay(ack(next), deps)).status, 200); assert.equal((await handleRelay(ack(next), { ...deps, now: 999999 })).status, 200); assert.equal(calls, 1);
    assert.equal((await handleRelay(ack(first), deps)).status, 409);
    assert.equal(deps.db._data.devBrainRelay[first.key].availableAt, Number.MAX_SAFE_INTEGER);
  });
  await test('active callback decision cannot be reversed or finish a newer lease', async () => {
    const deps = await fixture(); const first = (await claim(deps)).body.entry; let release;
    deps.customer = () => new Promise(resolve => { release = resolve; });
    const active = handleRelay(ack(first), deps); while (!release) await Promise.resolve();
    assert.equal((await handleRelay(ack(first, 'review'), deps)).status, 409);
    deps.now = 61001; const next = (await claim(deps)).body.entry; assert.equal(next.decision, 'customer');
    release({ status: 200, body: { recorded: true } }); assert.equal((await active).status, 409);
    assert.equal(deps.db._data.devBrainRelay[first.key].leaseToken, next.leaseToken);
  });
  await test('corrupt raw or project is never offered; bounded queue scan', async () => {
    const deps = await fixture(); const record = Object.values(deps.db._data.devBrainRelay)[0]; record.raw.idMessage = 'tampered'; assert.equal((await claim(deps)).body.entry, null);
    let bound; const db = { ref: () => ({ orderByChild(c) { assert.equal(c, 'availableAt'); return this; }, limitToFirst(n) { bound = n; return this; }, once: async () => ({ forEach() {} }) }) };
    await claim({ env, db }); assert.equal(bound, 50);
  });
  await test('webhook auth precedes capture; lexical customer replay retains allowlist', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env, { GREENAPI_WEBHOOK_TOKEN: 'test-hook', GREENAPI_INBOUND_ALLOWED: '' });
      const db = fakeDb(), deps = { db, waitUntil() {}, now: 1000 };
      const req = { method: 'POST', headers: { authorization: 'Bearer test-hook' }, body: raw() };
      assert.equal((await handleInbound({ ...req, headers: {} }, deps)).status, 401); assert.deepEqual(db._data, {});
      const wrong = raw(); wrong.instanceData.idInstance = 'other'; assert.equal((await handleInbound({ ...req, body: wrong }, deps)).status, 403);
      assert.equal((await handleInbound(req, deps)).body.relayed, true); assert.ok(!db._data.waInbound);
      const order = raw(); order.messageData.textMessageData.textMessage = 'הזמנה 1234\nמראה 80/100 כמות 2';
      const r = await handleCustomerInbound(order, deps); assert.equal(r.status, 200); assert.ok(!db._data.waInbound); assert.ok(!db._data.orders);
      const other = raw(); other.senderData = { chatId: '972509999999@c.us' };
      const enabled = await handleInbound({ ...req, body: other }, deps); process.env.DEV_BRAIN_RELAY_ENABLED = '';
      assert.deepEqual(await handleInbound({ ...req, body: other }, deps), enabled);
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });

  await test('customer ACK reuses original create-once inbox, preserves allowlist and orders only through processor', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env, { GREENAPI_WEBHOOK_TOKEN: 'test-hook', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0501234567' });
      const db = fakeDb({ meta: { orderCounter: 1110 }, users: { '0501234567': { name: 'test', customerId: '777' } } });
      const queued = [];
      const deps = { db, env, now: 1000, customer: stored => handleCustomerInbound(stored, {
        db, now: 1000, waitUntil(p) { queued.push(p); }, fetchImpl() { throw Error('network forbidden'); },
      }) };
      const b = raw(); b.messageData.textMessageData.textMessage = "הזמנת מראות מרכזת מס' PHR#26037\nמראה ללא מסגרת לפי מידה\n90/145 ס\"מ — כמות: 2";
      assert.equal((await maybeCaptureOwner(b, deps)).status, 200);
      const entry = (await claim(deps)).body.entry;
      assert.equal((await handleRelay(ack(entry), deps)).status, 200);
      await Promise.all(queued);
      assert.equal(Object.keys(db._data.waInbound).length, 1);
      assert.equal(Object.keys(db._data.orders).length, 1);
      assert.equal(db._data.devBrainRelay[entry.key].state, 'done');
      assert.equal((await handleRelay(ack(entry), deps)).status, 200);
      assert.equal(Object.keys(db._data.orders).length, 1);
      // Public webhook cannot request bypass through body/header flags.
      const b2 = JSON.parse(JSON.stringify(b)); b2.idMessage = 'msg2'; b2.bypassRelay = true;
      const r = await handleInbound({ method: 'POST', headers: { authorization: 'Bearer test-hook', 'x-devbrain-bypass': 'true' }, body: b2 }, { db, waitUntil() {} });
      assert.equal(r.body.relayed, true); assert.equal(Object.keys(db._data.waInbound).length, 1);
      // Whitespace in the actual serialized JSON counts towards the whole-body limit.
      const huge = ' '.repeat(65536) + JSON.stringify(b);
      assert.equal((await handleInbound({ method: 'POST', headers: { authorization: 'Bearer test-hook' }, body: huge }, { db, waitUntil() {} })).status, 400);
      process.env.GREENAPI_INBOUND_ALLOWED = '';
      assert.equal((await handleCustomerInbound(b2, { db, waitUntil() {} })).body.ignored, 'sender');
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
  await test('ignored sender and not-a-sketch yield durable manual receipt, including lost ACK', async () => {
    for (const reason of ['sender', 'not a sketch']) {
      const deps = await fixture(); const entry = (await claim(deps)).body.entry; let calls = 0;
      deps.customer = async () => { calls++; return { status: 200, body: { ok: true, ignored: reason } }; };
      for (let retry = 0; retry < 2; retry++) {
        const r = await handleRelay(ack(entry), deps);
        assert.deepEqual(r.body, { projectId: env.DEV_BRAIN_RELAY_PROJECT, ok: true, state: 'done', decision: 'customer', disposition: 'manual' });
      }
      assert.equal(calls, 1);
      const rec = deps.db._data.devBrainRelay[entry.key];
      assert.equal(rec.state, 'done'); assert.deepEqual(rec.handoff, { disposition: 'manual', reason });
      assert.equal(rec.availableAt, Number.MAX_SAFE_INTEGER);
      assert.ok(!deps.db._data.waInbound); assert.ok(!deps.db._data.orders);
      assert.equal((await claim({ ...deps, now: 999999 })).body.entry, null);
      assert.equal((await handleRelay(ack(entry, 'development'), deps)).status, 409);
    }
  });
  await test('original customer parser and allowlist yield manual receipts without inbox or orders', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env);
      for (const reason of ['sender', 'not a sketch']) {
        process.env.GREENAPI_INBOUND_ALLOWED = reason === 'sender' ? '' : 'luz-glass-test:0501234567';
        const db = fakeDb(); const deps = { db, env, now: 1000, customer: stored => handleCustomerInbound(stored, {
          db, now: 1000, waitUntil() { throw Error('manual must not schedule'); }, fetchImpl() { throw Error('network forbidden'); },
        }) };
        const b = raw();
        if (reason === 'sender') b.messageData.textMessageData.textMessage = "הזמנת מראות מרכזת מס' PHR#26037\nמראה ללא מסגרת לפי מידה\n90/145 ס\"מ — כמות: 2";
        assert.equal((await maybeCaptureOwner(b, deps)).status, 200);
        const entry = (await claim(deps)).body.entry;
        const response = await handleRelay(ack(entry), deps);
        assert.equal(response.status, 200); assert.equal(response.body.disposition, 'manual');
        assert.deepEqual(db._data.devBrainRelay[entry.key].handoff, { disposition: 'manual', reason });
        assert.ok(!db._data.waInbound); assert.ok(!db._data.orders);
        assert.deepEqual((await handleRelay(ack(entry), deps)).body, response.body);
      }
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
  await test('unexpected or failed customer responses retain frozen pending', async () => {
    for (const response of [{ status: 500 }, { status: 200, body: { ok: true } }, { status: 200, body: { ignored: 'sender' } }, { status: 200, body: { ok: true, ignored: 'https://private.invalid/secret' } }]) {
      const deps = await fixture(); const entry = (await claim(deps)).body.entry;
      deps.customer = async () => response;
      assert.equal((await handleRelay(ack(entry), deps)).status, 500);
      const rec = deps.db._data.devBrainRelay[entry.key]; assert.equal(rec.state, 'handoff_pending'); assert.equal(rec.decision, 'customer');
    }
  });
  console.log(`${passed} relay test groups passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
