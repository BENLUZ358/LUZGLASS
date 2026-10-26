#!/usr/bin/env node
/**
 * הודעות ללקוח במייל — תור יוצא שהסקריפט בג'ימייל מושך (בן, 26/10).
 * אפיון: docs/superpowers/specs/2026-10-26-email-link-senders-design.md
 *
 *   • הזמנה מהמייל של שולח מקושר לאותו כרטיס → ערוץ מייל, לשרשרת שלה
 *   • כל השאר (לא מקושר, רק ברשימת Vercel, קושר לכרטיס אחר) → וואטסאפ כמו היום
 *   • נעילת סביבה: הייצור שולח; הבדיקה רק לכתובת ב-EMAIL_ONLY_TO
 *   • שרשרת אחת = הודעה אחת; ערבוב מייל + וואטסאפ → 409
 *   • נעילה (lease) — שתי ריצות לא מקבלות אותה הודעה; אישור ישן נדחה
 *
 * Run: node scripts/test-email-outbox.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const sa = id => JSON.stringify({ project_id: id, client_email: 'x@y', private_key: 'k' });
const BASE_ENV = {
  FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'),
  EMAIL_INBOUND_TOKEN: 'mail-secret',
  EMAIL_INBOUND_ALLOWED: 'luz-glass-test:ben@own.com',
  EMAIL_ONLY_TO: undefined, LG_ENV: undefined,
  WA_PROVIDER: undefined, GREENAPI_TOKEN: undefined, GREENAPI_ID_INSTANCE: undefined,
};
const withEnv = async (vars, fn) => {
  const keep = {};
  for (const k of Object.keys(vars)) {
    keep[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
Object.entries(BASE_ENV).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });

// אדמין מדומה — dispatch בודק הרשאה דרך verifyAdmin
const vaPath = require.resolve(path.join(ROOT, 'api', '_verifyAdmin.js'));
require.cache[vaPath] = { id: vaPath, filename: vaPath, loaded: true,
  exports: { verifyAdmin: async () => ({ ok: true, phone: '0500000000' }) } };

const load = f => { try { return require(path.join(ROOT, 'api', f)); } catch (e) { console.error('FAIL  load ' + f + ': ' + e.message); failed++; return {}; } };
const rcp      = load('_wa-recipient.js');
const env      = load('_env.js');
const ob       = load('_email-outbox.js');
const dispatch = load('whatsapp-dispatch.js');
const route    = load('email-inbound.js');
const { renderText } = load('_wa-provider.js');

const NOW = 1761480000000;
const LEASE = 5 * 60 * 1000;
const CLIENT = 'client@shop.co.il';
const eOrder = (num, msg, thread, extra) => ({
  source: 'email', emailMessageId: msg, emailThreadId: thread, emailFrom: 'Client Shop <' + CLIENT + '>',
  customerId: '3150', orderNum: num, orderClient: 'אגן ברזל', sketchName: 'מקלחון ' + num, ...(extra || {}),
});
const seed = extra => fakeDb({
  hashavshevetAccounts: {
    '14201': { key: '14201', name: 'כרטיס דנה', phone: '050-1234567' },
    '3150':  { key: '3150', name: 'אגן ברזל', phone: '037436564' },
  },
  orders: {
    E1: eOrder('L1', 'm1', 'T1'),
    E2: eOrder('L2', 'm2', 'T1'),
    E3: eOrder('L3', 'm3', 'T2'),
    W1: { source: 'whatsapp', customerId: '3150', orderNum: 'L4', orderClient: 'אגן ברזל', phone: '037436564' },
    X1: { ...eOrder('L5', 'm5', 'T9'), emailFrom: 'other@x.com', customerId: '14201', orderClient: 'כרטיס דנה' },
    B1: { ...eOrder('L6', 'm6', 'T8'), emailFrom: 'ben@own.com' },
  },
  ...(extra || {}),
});
const links = (over) => ({ waMeta: { emailSenders: {
  'client@shop,co,il': { email: CLIENT, customerId: '3150', customerName: 'אגן ברזל' },
  'other@x,com':       { email: 'other@x.com', customerId: '14201', customerName: 'כרטיס דנה' },
  ...(over || {}) } } });

const fakeRes = () => ({ statusCode: 0, body: null,
  status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const disp = async (db, body, envOver) => withEnv({ ...BASE_ENV, ...(envOver || {}) }, async () => {
  const res = fakeRes();
  await dispatch({ method: 'POST', headers: {}, body }, res, { db });
  return res;
});
const TEST_TO = { EMAIL_ONLY_TO: CLIENT };
const LIVE = { FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), EMAIL_INBOUND_ALLOWED: 'lussglass:ben@own.com' };
const outbox = db => (db._data.waMeta && db._data.waMeta.emailOutbox) || {};

(async () => {
  // ═══ A. לאן יוצאת ההודעה ════════════════════════════════════════
  {
    const db = seed(links());
    check('A1 linked email order -> email channel, its own thread',
          await rcp.resolveRecipient(db, db._data.orders.E1, 'ready'),
          { channel: 'email', phone: '', email: CLIENT, thread: 'T1', source: 'email-sender', accountKey: '3150', linked: true });

    const un = seed();
    check('A2 unlinked email order -> whatsapp channel as before',
          await rcp.resolveRecipient(un, un._data.orders.E1, 'ready'),
          { ...(await rcp.resolvePhone(un, un._data.orders.E1)), linked: false, channel: 'whatsapp' });
    check('A2 env-only (Vercel list, never linked) -> whatsapp channel as before',
          await rcp.resolveRecipient(db, db._data.orders.B1, 'ready'),
          { ...(await rcp.resolvePhone(db, db._data.orders.B1)), linked: false, channel: 'whatsapp' });

    const re = seed(links({ 'client@shop,co,il': { email: CLIENT, customerId: '14201', customerName: 'x' } }));
    const r3 = await rcp.resolveRecipient(re, re._data.orders.E1, 'ready');
    check('A3 relinked to another card -> whatsapp channel, not linked', [r3.channel, r3.linked, r3.email], ['whatsapp', false, undefined]);

    const forged = { ...db._data.orders.E1, emailMessageId: '' };
    check('A4 an order without an email message id is never email', (await rcp.resolveRecipient(db, forged, 'ready')).channel, 'whatsapp');
    const noThread = { ...db._data.orders.E1, emailThreadId: '' };
    check('A4 nor without a thread', (await rcp.resolveRecipient(db, noThread, 'ready')).channel, 'whatsapp');
    const portal = { customerId: '14201', phone: '0505887576' };
    check('A5 a portal order resolves as before, plus channel',
          await rcp.resolveRecipient(db, portal, 'ready'),
          { ...(await rcp.resolvePhone(db, portal)), linked: false, channel: 'whatsapp' });
  }

  // ═══ B. נעילת הסביבה ═══════════════════════════════════════════
  await withEnv({ ...BASE_ENV, ...LIVE }, async () =>
    check('B1 lussglass: allowed', env.lgEmailSendGate && env.lgEmailSendGate(CLIENT).allowed, true));
  await withEnv({ ...BASE_ENV, ...LIVE, LG_ENV: 'test' }, async () =>
    check('B1 lussglass declared LG_ENV=test: refused', env.lgEmailSendGate && env.lgEmailSendGate(CLIENT).allowed, false));
  await withEnv(BASE_ENV, async () =>
    check('B2 TEST without EMAIL_ONLY_TO: refused', env.lgEmailSendGate && env.lgEmailSendGate(CLIENT).allowed, false));
  await withEnv({ ...BASE_ENV, EMAIL_ONLY_TO: 'Ben <ben@own.com>, ' + CLIENT }, async () => {
    check('B3 TEST with EMAIL_ONLY_TO: that address allowed',
          env.lgEmailSendGate && [env.lgEmailSendGate(CLIENT).allowed, env.lgEmailSendGate('BEN@own.com').allowed], [true, true]);
    check('B3 and nobody else', env.lgEmailSendGate && env.lgEmailSendGate('real@customer.com').allowed, false);
  });
  await withEnv({ ...BASE_ENV, ...LIVE }, async () =>
    check('B4 junk address refused', env.lgEmailSendGate && env.lgEmailSendGate('junk').allowed, false));
  await withEnv({ ...BASE_ENV, ...LIVE, EMAIL_ONLY_TO: 'ben@own.com' }, async () =>
    check('B5 EMAIL_ONLY_TO narrows production too', env.lgEmailSendGate && env.lgEmailSendGate(CLIENT).allowed, false));

  // ═══ C. dispatch ═══════════════════════════════════════════════
  {
    const db = seed(links());
    const r = await disp(db, { kind: 'ready', orderIds: ['E3', 'E1', 'E2'], dryRun: false }, TEST_TO);
    const b = r.body || {};
    check('C1 two threads of one sender -> 200, email channel, queued', [r.statusCode, b.channel, b.queued], [200, 'email', true]);
    check('C1 one message per thread',
          (b.messages || []).map(m => [m.thread, m.orderNums, m.queued]), [['T1', ['L1', 'L2'], true], ['T2', ['L3'], true]]);
    const items = Object.values(outbox(db));
    check('C1 2 queue items', items.length, 2);
    const t1 = items.find(i => i.thread === 'T1') || {};
    check('C1 the T1 item', [t1.kind, t1.email, t1.state, t1.orderIds, t1.orderNums, t1.clientName],
          ['ready', CLIENT, 'pending', ['E1', 'E2'], ['L1', 'L2'], 'אגן ברזל']);
    check('C1 key = sha1(kind|thread|sorted ids)', Object.keys(outbox(db)).includes(ob.lgEmailMsgKey && ob.lgEmailMsgKey('ready', 'T1', ['E2', 'E1'])), true);
    check('C1 nothing went to the WhatsApp queue', db._data.waOutbox, undefined);

    const again = await disp(db, { kind: 'ready', orderIds: ['E1', 'E2', 'E3'], dryRun: false }, TEST_TO);
    check('C3 double click -> same keys, queued:false', [again.statusCode, again.body.queued, (again.body.messages || []).map(m => m.queued)],
          [200, false, [false, false]]);
    check('C3 still 2 items', Object.keys(outbox(db)).length, 2);
  }
  {
    const db = seed(links());
    const r = await disp(db, { kind: 'ready', orderIds: ['E1', 'W1'], dryRun: false }, TEST_TO);
    check('C2 mixed email + whatsapp -> 409', [r.statusCode, r.body.error], [409, 'בקבוצה יש הזמנות מהמייל ומוואטסאפ — לא נשלחה הודעה']);
    check('C2 nothing queued anywhere', [db._data.waOutbox, outbox(db)], [undefined, {}]);
    const r2 = await disp(db, { kind: 'ready', orderIds: ['E1', 'X1'], dryRun: false }, { EMAIL_ONLY_TO: CLIENT + ',other@x.com' });
    check('C2 email orders of two cards -> 409', [r2.statusCode, Object.keys(outbox(db)).length], [409, 0]);
  }
  {
    const db = seed(links());
    const r = await disp(db, { kind: 'ready', orderIds: ['E1', 'E3'], dryRun: true }, TEST_TO);
    check('C4 dryRun -> preview, same shape, nothing queued',
          [r.statusCode, r.body.preview, r.body.channel, r.body.queued, (r.body.messages || []).length, Object.keys(outbox(db)).length],
          [200, true, 'email', false, 2, 0]);
  }
  {
    const db = seed(links());
    const r = await disp(db, { kind: 'ready', orderIds: ['E1'], dryRun: false });
    check('C5 TEST without EMAIL_ONLY_TO: nothing queued, blocked with a reason',
          [r.statusCode, r.body.channel, r.body.queued, r.body.blocked, !!r.body.reason, Object.keys(outbox(db)).length],
          [200, 'email', false, true, true, 0]);
  }
  {
    const db = seed();   // לא מקושר → וואטסאפ, כמו היום
    const r = await disp(db, { kind: 'ready', orderIds: ['E1'], dryRun: true }, TEST_TO);
    check('C6 unlinked email order -> the WhatsApp preview exactly as before (no channel field)',
          [r.statusCode, r.body.channel, r.body.preview, r.body.to], [200, undefined, true, '037436564']);
  }

  {
    const db = seed(links());
    db._data.orders.E1.emailNotices = { ready: { sentAt: NOW, key: 'k' } };
    const r = await disp(db, { kind: 'ready', orderIds: ['E1', 'E2'], dryRun: false }, TEST_TO);
    check('C7 an order that already got "ready" by email is skipped, the rest go',
          [r.body.queued, (r.body.messages || []).map(m => m.orderNums), (r.body.skipped || []).map(s => s.orderId)],
          [true, [['L2']], ['E1']]);
  }

  // ═══ D. claim / done ═══════════════════════════════════════════
  const queued = async () => {
    const db = seed(links());
    await withEnv({ ...BASE_ENV, ...TEST_TO }, async () => {
      if (!ob.lgEmailEnqueue) return;
      await ob.lgEmailEnqueue(db, { kind: 'ready', thread: 'T1', messageId: 'm2', email: CLIENT, clientName: 'אגן ברזל',
        orderNums: ['L1', 'L2'], sketchNames: ['מקלחון L1', 'מקלחון L2'], orderIds: ['E1', 'E2'], queuedBy: '050', accountKey: '3150', now: NOW });
    });
    return db;
  };
  const claim = (db, now, limit) => withEnv({ ...BASE_ENV, ...TEST_TO }, () => ob.lgEmailClaim ? ob.lgEmailClaim(db, limit || 5, now) : []);
  {
    const db = await queued();
    const c1 = await claim(db, NOW);
    check('D1 claim leases the item', c1.map(i => [i.thread, typeof i.leaseToken, !!i.leaseToken]), [['T1', 'string', true]]);
    check('D1 with the WhatsApp wording',
          (c1[0] || {}).text, renderText({ kind: 'ready', clientName: 'אגן ברזל', orderNums: ['L1', 'L2'], sketchNames: ['מקלחון L1', 'מקלחון L2'] }));
    check('D1 the item carries key, thread, the customer message id, the linked address, text, leaseToken',
          Object.keys(c1[0] || {}).sort(), ['email', 'key', 'leaseToken', 'messageId', 'text', 'thread']);
    check('D1 message id and address are the queued ones', [(c1[0] || {}).messageId, (c1[0] || {}).email], ['m2', CLIENT]);
    check('D2 second claim within the lease returns nothing', (await claim(db, NOW + LEASE - 1)).length, 0);

    const d = await ob.lgEmailComplete(db, c1[0].key, c1[0].leaseToken, true, NOW + 1000);
    check('D3 done -> ok', d, { ok: true });
    const it = outbox(db)[c1[0].key];
    check('D3 marked sent', [it.state, it.sentAt], ['sent', NOW + 1000]);
    check('D3 stamps each order', [db._data.orders.E1.emailNotices, db._data.orders.E2.emailNotices],
          [{ ready: { sentAt: NOW + 1000, key: c1[0].key } }, { ready: { sentAt: NOW + 1000, key: c1[0].key } }]);
    check('D3 and no other order', db._data.orders.E3.emailNotices, undefined);
    check('D3 a sent item is never claimed again', (await claim(db, NOW + 10 * LEASE)).length, 0);
    check('D3 a repeated done with the same lease is still ok', await ob.lgEmailComplete(db, c1[0].key, c1[0].leaseToken, true, NOW + 2000), { ok: true });
  }
  {
    const db = await queued();
    const c1 = await claim(db, NOW);
    check('D4 stale lease done refused', await ob.lgEmailComplete(db, c1[0].key, 'not-the-token', true, NOW + 1000), { ok: false, code: 'stale' });
    check('D4 and nothing changed', [outbox(db)[c1[0].key].state, db._data.orders.E1.emailNotices], ['pending', undefined]);
    check('D4 unknown key refused', await ob.lgEmailComplete(db, 'nope', c1[0].leaseToken, true, NOW), { ok: false, code: 'stale' });
  }
  {
    const db = await queued();
    const c1 = await claim(db, NOW);
    const c2 = await claim(db, NOW + LEASE + 1);
    check('D5 expired lease is reclaimable, with a new token', [c2.length, c2[0] && c2[0].key === c1[0].key, c2[0] && c2[0].leaseToken !== c1[0].leaseToken], [1, true, true]);
    check('D5 the old lease is now stale', await ob.lgEmailComplete(db, c1[0].key, c1[0].leaseToken, true, NOW + LEASE + 2), { ok: false, code: 'stale' });
    check('D5 the new one completes', await ob.lgEmailComplete(db, c2[0].key, c2[0].leaseToken, true, NOW + LEASE + 3), { ok: true });
  }
  {
    const db = await queued();
    let t = NOW;
    for (let i = 0; i < 3; i++) {
      const c = await claim(db, t);
      check('D6 failure #' + (i + 1) + ' reported', c.length ? await ob.lgEmailComplete(db, c[0].key, c[0].leaseToken, false, t + 1) : 'not claimed', { ok: true });
      t += 10;
    }
    const it = Object.values(outbox(db))[0] || {};
    check('D6 three failures -> failed, never claimed again', [it.state, it.attempts, (await claim(db, t)).length], ['failed', 3, 0]);
    check('D6 no order stamped', db._data.orders.E1.emailNotices, undefined);
  }
  {
    const db = await queued();
    db._data.waMeta.emailSenders['client@shop,co,il'] = { email: CLIENT, customerId: '14201' };   // קושר לכרטיס אחר מאז
    check('D7 sender relinked since enqueue -> not served', (await claim(db, NOW)).length, 0);
    check('D7 and cancelled', (Object.values(outbox(db))[0] || {}).state, 'cancelled');
  }
  {
    const db = await queued();
    const c = await withEnv(BASE_ENV, () => ob.lgEmailClaim ? ob.lgEmailClaim(db, 5, NOW) : []);
    check('D8 TEST lock removed since enqueue -> not served', c.length, 0);
  }
  {
    const db = seed(links());
    await withEnv({ ...BASE_ENV, ...TEST_TO }, async () => {
      for (let i = 0; i < 7; i++) {
        await ob.lgEmailEnqueue(db, { kind: 'ready', thread: 'T' + i, messageId: 'm' + i, email: CLIENT, clientName: 'x',
          orderNums: ['L' + i], sketchNames: [''], orderIds: ['E1'], queuedBy: '050', accountKey: '3150', now: NOW + i });
      }
    });
    check('D9 at most 5 per claim', (await claim(db, NOW + 100, 50)).length, 5);
    check('D9 the rest on the next run', (await claim(db, NOW + 200, 50)).length, 2);
  }

  // ═══ D'. תיקוני סקירה 1 ═════════════════════════════════════════
  {
    const db = await queued();
    const key = Object.keys(outbox(db))[0];
    let t = NOW;
    for (let i = 0; i < 3; i++) { const c = await claim(db, t); await ob.lgEmailComplete(db, c[0].key, c[0].leaseToken, false, t + 1); t += 10; }
    check('R1 failed first', outbox(db)[key].state, 'failed');
    const q = await withEnv({ ...BASE_ENV, ...TEST_TO }, () => ob.lgEmailEnqueue(db, { kind: 'ready', thread: 'T1', messageId: 'm2', email: CLIENT, clientName: 'אגן ברזל',
      orderNums: ['L1', 'L2'], sketchNames: [], orderIds: ['E1', 'E2'], queuedBy: '050', accountKey: '3150', now: t + 100 }));
    const it = outbox(db)[key];
    check('R1 failed -> enqueue again -> a fresh pending record',
          [q.queued, it.state, it.attempts, it.createdAt, it.leaseToken, it.leaseUntil], [true, 'pending', 0, t + 100, null, null]);
    check('R1 and it is claimable again', (await claim(db, t + 200)).length, 1);

    const db2 = await queued();
    const c = await claim(db2, NOW);
    await ob.lgEmailComplete(db2, c[0].key, c[0].leaseToken, true, NOW + 1);
    const q2 = await withEnv({ ...BASE_ENV, ...TEST_TO }, () => ob.lgEmailEnqueue(db2, { kind: 'ready', thread: 'T1', email: CLIENT, clientName: 'x',
      orderNums: ['L1', 'L2'], sketchNames: [], orderIds: ['E1', 'E2'], queuedBy: '050', accountKey: '3150', now: NOW + 5 }));
    check('R1 sent -> still refused', [q2.queued, q2.reason, outbox(db2)[c[0].key].state], [false, 'כבר נשלחה', 'sent']);

    const db3 = await queued();
    db3._data.waMeta.emailSenders['client@shop,co,il'] = { email: CLIENT, customerId: '14201' };
    await claim(db3, NOW);
    db3._data.waMeta.emailSenders['client@shop,co,il'] = { email: CLIENT, customerId: '3150' };
    const q3 = await withEnv({ ...BASE_ENV, ...TEST_TO }, () => ob.lgEmailEnqueue(db3, { kind: 'ready', thread: 'T1', email: CLIENT, clientName: 'x',
      orderNums: ['L1', 'L2'], sketchNames: [], orderIds: ['E1', 'E2'], queuedBy: '050', accountKey: '3150', now: NOW + 5 }));
    check('R1 cancelled -> enqueue again -> pending', [q3.queued, Object.values(outbox(db3))[0].state], [true, 'pending']);
  }
  {
    const db = await queued();
    const c = await claim(db, NOW);
    check('R4 done on a well-formed unknown key -> stale', await ob.lgEmailComplete(db, 'ab'.repeat(10), c[0].leaseToken, true, NOW), { ok: false, code: 'stale' });
    check('R4 and no record was created', outbox(db)['ab'.repeat(10)], undefined);
  }
  {
    const db = await queued();
    const key = Object.keys(outbox(db))[0];
    const c = await withEnv(BASE_ENV, () => ob.lgEmailClaim(db, 5, NOW + 25 * 3600 * 1000));   // הנעילה חוסמת
    check('R5 a gate-blocked item older than 24h expires instead of staying pending', [c.length, outbox(db)[key].state], [0, 'expired']);
  }
  {
    const db = await queued();
    const key = Object.keys(outbox(db))[0];
    const c = await claim(db, NOW);
    const realRef = db.ref;
    db.ref = p => { const r = realRef(p); if (!p) r.update = async () => { throw new Error('boom'); }; return r; };
    const keepErr = console.error; let logged = 0; console.error = () => { logged++; };
    let d; try { d = await ob.lgEmailComplete(db, key, c[0].leaseToken, true, NOW + 1); } finally { console.error = keepErr; db.ref = realRef; }
    check('R6 a failed order stamp is logged, not thrown; the item is still sent', [d, logged > 0, outbox(db)[key].state], [{ ok: true }, true, 'sent']);
  }

  // ═══ F. "הסקיצות טופלו" במייל ═══════════════════════════════════
  const seen = db => { ['E1', 'E2', 'E3', 'B1', 'W1'].forEach(id => { db._data.orders[id].sketchSeenAt = NOW - 1; }); return db; };
  {
    const db = seen(seed(links()));
    const r = await disp(db, { kind: 'sketches-handled', orderIds: ['E1', 'E2', 'E3'], dryRun: false }, TEST_TO);
    check('F1 linked email sender: sketches-handled -> one email per thread',
          [r.statusCode, r.body.channel, r.body.queued, (r.body.messages || []).map(m => [m.thread, m.orderNums, m.queued])],
          [200, 'email', true, [['T1', ['L1', 'L2'], true], ['T2', ['L3'], true]]]);
    check('F1 queued as sketches-handled', Object.values(outbox(db)).map(i => i.kind), ['sketches-handled', 'sketches-handled']);
    check('F1 nothing to WhatsApp', db._data.waOutbox, undefined);
    const again = await disp(db, { kind: 'sketches-handled', orderIds: ['E1', 'E2', 'E3'], dryRun: false }, TEST_TO);
    check('F2 second click -> not re-queued (already on its way)',
          [again.statusCode, again.body.queued, (again.body.skipped || []).map(s => s.reason), Object.keys(outbox(db)).length],
          [200, false, ['כבר בהודעה שבדרך', 'כבר בהודעה שבדרך', 'כבר בהודעה שבדרך'], 2]);
    const sub = await disp(db, { kind: 'sketches-handled', orderIds: ['E1'], dryRun: false }, TEST_TO);
    check('F2 nor a subset of it', [sub.body.queued, Object.keys(outbox(db)).length], [false, 2]);
  }
  {
    const db = seen(seed(links()));
    db._data.orders.E1.emailNotices = { 'sketches-handled': { sentAt: NOW, key: 'k' } };
    const r = await disp(db, { kind: 'sketches-handled', orderIds: ['E1'], dryRun: false }, TEST_TO);
    check('F3 an order already updated by email is skipped', [r.body.queued, (r.body.skipped || []).map(s => s.reason)], [false, ['הלקוח כבר עודכן']]);
  }
  {
    const db = seen(seed());   // לא מקושר
    const r = await disp(db, { kind: 'sketches-handled', orderIds: ['E1', 'B1'], dryRun: false }, TEST_TO);
    check('F4 unlinked / env-only email order -> old behaviour: skipped, nothing queued anywhere',
          [r.statusCode, r.body.queued, (r.body.skipped || []).map(s => s.reason), db._data.waOutbox, outbox(db)],
          [200, false, ['לא סקיצת WhatsApp', 'לא סקיצת WhatsApp'], undefined, {}]);
  }
  {
    const sa = require(path.join(ROOT, 'api', '_wa-sketch-ack.js'));
    const e = { source: 'email', emailThreadId: 'T', emailMessageId: 'M', sketchSeenAt: 1 };
    check('F5 an email order with thread + message id passes the skip filter', sa.lgSketchAckSkip(e, 'x', new Set()), null);
    check('F5 without the server-written ids it does not', [!!sa.lgSketchAckSkip({ ...e, emailThreadId: '' }, 'x'), !!sa.lgSketchAckSkip({ ...e, emailMessageId: '' }, 'x')], [true, true]);
    const db = fakeDb({ waMeta: { emailOutbox: {
      a: { kind: 'sketches-handled', state: 'pending', orderIds: ['p'], createdAt: 1 },
      b: { kind: 'sketches-handled', state: 'sent', orderIds: ['s'], createdAt: 2 },
      c: { kind: 'sketches-handled', state: 'failed', orderIds: ['f'], createdAt: 3 },
      d: { kind: 'sketches-handled', state: 'cancelled', orderIds: ['c'], createdAt: 4 },
      e: { kind: 'ready', state: 'pending', orderIds: ['r'], createdAt: 5 } } } });
    check('F6 email queue: pending/sent sketches-handled are active; failed/cancelled/other kinds free',
          [...await sa.lgSketchAckActiveIds(db)].sort(), ['p', 's']);
  }
  {
    // הדפדפן — firebase-db.js
    const fs = require('fs'); const vm = require('vm');
    const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');
    const grab = n => (SRC.match(new RegExp('function ' + n + '\\b[\\s\\S]*?\\n}')) || [''])[0];
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(['lgEmailLinkKey', 'lgSketchAckEligible', 'lgSketchAckClientKey', 'lgSketchAckPending'].map(grab).join('\n'), ctx);
    const erc = require(path.join(ROOT, 'api', '_email-recipient.js'));
    const samples = ['"Dana" <Dana@Client.co.il>', '"boss@client.com <boss@client.com>" <evil@x.com>', 'a/b@y.com', 'junk', 'x@y.com', ''];
    check('G1 the browser key is the server key', samples.map(s => ctx.lgEmailLinkKey(s)), samples.map(erc.lgEmailKey));
    const LINKS = links().waMeta.emailSenders;
    const O = [
      { id: 'e1', ...eOrder('L1', 'm1', 'T1'), sketchSeenAt: 5 },
      { id: 'e2', ...eOrder('L2', 'm2', 'T2'), sketchSeenAt: 5, emailNotices: { 'sketches-handled': { sentAt: 1 } } },
      { id: 'b1', ...eOrder('L6', 'm6', 'T8'), emailFrom: 'ben@own.com', sketchSeenAt: 5 },
      { id: 'w1', source: 'whatsapp', customerId: '3150', orderClient: 'אגן ברזל', sketchSeenAt: 5 },
    ];
    const P = l => JSON.parse(JSON.stringify(ctx.lgSketchAckPending(O, l)));
    check('G2 linked email order is pending, in its own group apart from WhatsApp',
          P(LINKS).map(g => [g.key, g.ids]), [['e:3150', ['e1']], ['c:3150', ['w1']]]);
    check('G3 without the links — WhatsApp only, exactly as before', P(undefined).map(g => [g.key, g.ids]), [['c:3150', ['w1']]]);
  }

  // ═══ Z. תיקוני הסקירה הסופית ════════════════════════════════════
  {
    //  #1 — התור נושא את מזהה המייל של הלקוח ואת הכתובת המקושרת; הסקריפט עונה
    //  על המייל הזה (msg.reply) ולא על השרשור, ובודק שהוא מהכתובת המקושרת
    const db = seed(links());
    await disp(db, { kind: 'ready', orderIds: ['E1', 'E2', 'E3'], dryRun: false }, TEST_TO);
    const its = Object.values(outbox(db));
    const t1 = its.find(i => i.thread === 'T1') || {}, t2 = its.find(i => i.thread === 'T2') || {};
    check('Z1 queue item carries the customer message id and the linked address',
          [t1.messageId, t1.email, t2.messageId, t2.email], ['m2', CLIENT, 'm3', CLIENT]);
    const c = await claim(db, NOW + 1);
    check('Z1 and so does every claimed item', c.map(i => [i.thread, i.messageId, i.email]).sort(), [['T1', 'm2', CLIENT], ['T2', 'm3', CLIENT]]);
  }
  {
    const db = await queued();
    const key = Object.keys(outbox(db))[0];
    delete db._data.waMeta.emailOutbox[key].messageId;
    check('Z2 a record without a message id is never handed out', (await claim(db, NOW)).length, 0);
    check('Z2 it is cancelled', outbox(db)[key].state, 'cancelled');
  }
  for (const kind of ['ready', 'dispatched']) {
    //  #4 — [X] ואז [X,Y] הם מפתחות שונים; X לא מקבל הודעה שנייה כל עוד הראשונה בתור / נשלחה
    const db = seed(links());
    const a = await disp(db, { kind, orderIds: ['E1'], dryRun: false }, TEST_TO);
    const b = await disp(db, { kind, orderIds: ['E1', 'E2'], dryRun: false }, TEST_TO);
    const its = Object.values(outbox(db)).filter(i => i.kind === kind);
    check('Z3 ' + kind + ': [X] then [X,Y] -> X once, Y alone',
          [a.body.queued, b.body.queued, its.map(i => i.orderIds).sort()], [true, true, [['E1'], ['E2']]]);
    check('Z3 ' + kind + ': X reported as skipped', (b.body.skipped || []).map(s => [s.orderId, s.reason]), [['E1', 'כבר בהודעה שבדרך במייל']]);
    const cc = await disp(db, { kind, orderIds: ['E1', 'E2'], dryRun: false }, TEST_TO);
    check('Z3 ' + kind + ': and a third click queues nothing', [cc.statusCode, cc.body.queued, Object.values(outbox(db)).length], [200, false, 2]);
  }
  {
    //  פריט שנכשל סופית לא חוסם — הלקוח לא קיבל
    const db = seed(links());
    await disp(db, { kind: 'dispatched', orderIds: ['E1'], dryRun: false }, TEST_TO);
    const k1 = Object.keys(outbox(db))[0];
    db._data.waMeta.emailOutbox[k1].state = 'failed';
    const r = await disp(db, { kind: 'dispatched', orderIds: ['E1', 'E2'], dryRun: false }, TEST_TO);
    check('Z4 a failed earlier message does not block', [r.body.queued, (r.body.skipped || []).length, Object.keys(outbox(db)).length], [true, 0, 2]);
    //  אחר: "יצא להובלה" שנשלח לפני יותר מיממה לא חוסם הובלה חדשה (הובלה היא אירוע)
    const db2 = seed(links());
    await disp(db2, { kind: 'dispatched', orderIds: ['E1'], dryRun: false }, TEST_TO);
    const k2 = Object.keys(outbox(db2))[0];
    Object.assign(db2._data.waMeta.emailOutbox[k2], { state: 'sent', sentAt: Date.now() - 25 * 3600 * 1000 });
    const r2 = await disp(db2, { kind: 'dispatched', orderIds: ['E1', 'E2'], dryRun: false }, TEST_TO);
    check('Z4 a "dispatched" sent over a day ago does not block a new delivery', [r2.body.queued, (r2.body.skipped || []).length], [true, 0]);
    //  וסוג אחר לא חוסם
    const db3 = seed(links());
    await disp(db3, { kind: 'ready', orderIds: ['E1'], dryRun: false }, TEST_TO);
    const r3 = await disp(db3, { kind: 'dispatched', orderIds: ['E1'], dryRun: false }, TEST_TO);
    check('Z4 another kind does not block', r3.body.queued, true);
  }
  {
    //  #5 — אדמין: "שלח עכשיו" לקבוצת מייל אומר שההודעה בתור, לא "נשלח"
    const fs = require('fs');
    const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const fn = (A.match(/async function _sqAckSend\([\s\S]*?\r?\n\}/) || [''])[0];
    check('Z5 email group -> "בתור לשליחה במייל"', /d\.channel\s*===\s*'email'/.test(fn) && fn.includes('בתור לשליחה במייל'), true);
    check('Z5 WhatsApp wording kept', fn.includes("'📨 נשלח עדכון ללקוח: '"), true);
  }

  // ═══ E. הנתיב /api/email-inbound ════════════════════════════════
  {
    const db = await queued();
    const post = (body, auth) => withEnv({ ...BASE_ENV, ...TEST_TO }, () =>
      route.handleEmailInbound({ method: 'POST', headers: auth ? { authorization: 'Bearer mail-secret' } : {}, body }, { db, now: NOW }));
    const no = await post({ op: 'outbox-claim' }, false);
    check('E1 outbox ops need the token', [no.status, (await post({ op: 'outbox-done', key: 'k', leaseToken: 't', ok: true }, false)).status], [401, 401]);
    check('E1 and claimed nothing without it', outbox(db)[Object.keys(outbox(db))[0]].leaseToken || null, null);
    const c = await post({ op: 'outbox-claim' }, true);
    check('E2 claim -> {ok, items}', [c.status, c.body.ok, (c.body.items || []).length], [200, true, 1]);
    const it = (c.body.items || [])[0] || {};
    const stale = await post({ op: 'outbox-done', key: it.key, leaseToken: 'x', ok: true }, true);
    check('E3 stale done -> 200 {ok:false, code:stale}', [stale.status, stale.body], [200, { ok: false, code: 'stale' }]);
    const done = await post({ op: 'outbox-done', key: it.key, leaseToken: it.leaseToken, ok: true }, true);
    check('E4 done -> {ok:true}', [done.status, done.body], [200, { ok: true }]);
    const bad = await post({ op: 'outbox-done', key: 'a/b', leaseToken: it.leaseToken, ok: true }, true);
    check('E5 a key with a path character is refused', bad.status, 400);
    const part = await post({ op: 'part', messageId: '' }, true);
    check('E6 other ops still need a message id', part.status, 400);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
