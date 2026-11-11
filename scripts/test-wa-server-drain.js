#!/usr/bin/env node
/**
 * שליחת תור הוואטסאפ מהשרת בכל דופק (api/_wa-server-drain.js, חדר הסוכנים — "הסוכנים מדברים", 11/11).
 * מתג WA_SERVER_DRAIN, חסם 55ש׳, תקציב, failureKind, ובלי שליחה כפולה.
 * Run: node scripts/test-wa-server-drain.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const SD = require(path.join(__dirname, '..', 'api', '_wa-server-drain.js'));
const { drainKeys } = require(path.join(__dirname, '..', 'api', '_wa-drain-core.js'));
const { lgWaClaim } = require(path.join(__dirname, '..', 'api', '_wa-outbox.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.now();
const GRP = '120363@g.us';
const row = (n, extra) => ({ kind: 'ready', to: GRP, clientName: 'לקוח', orderNums: ['L' + n], orderIds: ['o' + n],
  state: 'pending', attempts: 0, createdAt: NOW - 1000 + n, claimedAt: null, ...extra });
const mk = (n, extra) => {
  const outbox = {}, orders = {};
  for (let i = 1; i <= n; i++) {
    outbox['ready_o' + i] = row(i, extra);
    orders['o' + i] = { orderNum: 'L' + i, waGroup: GRP, stage: 'done' };
  }
  return fakeDb({ waOutbox: outbox, orders, waGroups: { '120363@g_us': { customerId: 'C1' } } });
};
const provider = (send, over) => ({ name: 'fake', configured: true, globalSlot: false, maxPerRun: 60,
  nextGap: () => 0, gate: () => ({ allowed: true }), send, ...over });
const OK = async () => ({ ok: true, httpStatus: 200, messageId: 'm' });

(async () => {
  // 1. מתג כבוי: לא קוראים את התור
  {
    let reads = 0;
    const db = mk(1);
    const orig = db.ref;
    db.ref = p => { if (String(p).startsWith('waOutbox')) reads++; return orig(p); };
    const r = await SD.lgWaServerDrain(db, { env: {}, now: NOW, drain: async () => { reads++; return {}; } });
    check('off when WA_SERVER_DRAIN unset', [r.skipped, reads], ['off', 0]);
  }

  // 2. חסם 55ש׳
  {
    const db = mk(1); const env = { WA_SERVER_DRAIN: 'true' };
    let calls = 0; const drain = async () => { calls++; return { results: [], processed: 0, state: null }; };
    const a = await SD.lgWaServerDrain(db, { env, now: NOW, drain });
    const b = await SD.lgWaServerDrain(db, { env, now: NOW + 30000, drain });
    const c = await SD.lgWaServerDrain(db, { env, now: NOW + 56000, drain });
    check('throttled second call within 55s', [a.skipped || null, b.skipped, c.skipped || null, calls], [null, 'throttled', null, 2]);
  }

  // 3. ריק
  {
    const r = await SD.lgWaServerDrain(fakeDb({}), { env: { WA_SERVER_DRAIN: 'true' }, now: NOW, drain: async () => { throw new Error('no'); } });
    check('empty queue → skipped empty', r.skipped, 'empty');
  }

  // 4. שולח דרך drain עם by='server' ותקציב
  {
    const db = mk(3); let got;
    const r = await SD.lgWaServerDrain(db, { env: { WA_SERVER_DRAIN: 'true' }, now: NOW, budgetMs: 12345,
      drain: async (d, keys, by, opts) => { got = { keys, by, opts }; return { results: [], processed: keys.length, state: null }; } });
    check('sends pending rows via drain with by=server', [got.keys.length, got.by, got.opts.budgetMs, r.ok, r.processed], [3, 'server', 12345, true, 3]);
  }

  // 5. מנותק: לא נוגעים בכלום
  {
    const db = mk(2);
    const r = await SD.lgWaServerDrain(db, { env: { WA_SERVER_DRAIN: 'true' }, now: NOW,
      drain: async () => ({ results: [], processed: 0, state: 'notAuthorized' }) });
    check('disconnected → skipped disconnected, rows untouched', [r.skipped, db._data.waOutbox.ready_o1.state, db._data.waOutbox.ready_o1.attempts], ['disconnected', 'pending', 0]);
  }

  // 6. תקציב: ספק איטי → עוצר, השאר נשארים ממתינים
  {
    const db = mk(4);
    const send = async () => { await new Promise(r => setTimeout(r, 120)); return { ok: true, httpStatus: 200, messageId: 'm' }; };
    const keys = Object.keys(db._data.waOutbox);
    const r = await drainKeys(db, provider(send), keys, 'server', Date.now(), 150);
    const states = Object.values(db._data.waOutbox).map(x => x.state);
    check('budget respected: stops, rest stay pending', [r.processed, states.filter(s => s === 'sent').length, states.filter(s => s === 'pending').length], [2, 2, 2]);
  }

  // 7. failureKind נשמר בכישלון, null בהצלחה
  {
    const db = mk(2);
    let n = 0;
    const send = async () => (++n === 1 ? { ok: false, httpStatus: 429, reason: 'rate', failureKind: 'rate' } : { ok: true, httpStatus: 200, messageId: 'm' });
    await drainKeys(db, provider(send), Object.keys(db._data.waOutbox), 'server', Date.now());
    const o = db._data.waOutbox;
    check('failureKind stored on failed complete, null on success', [o.ready_o1.state, o.ready_o1.failureKind, o.ready_o2.state, o.ready_o2.failureKind], ['failed', 'rate', 'sent', null]);
  }

  // 8. בלי שליחה כפולה: שורה שדף תפס — השרת מדלג
  {
    const db = mk(2); let sent = 0;
    const send = async () => { sent++; return { ok: true, httpStatus: 200, messageId: 'm' }; };
    const c = await lgWaClaim(db, 'ready_o1', 'page');
    const r = await drainKeys(db, provider(send), Object.keys(db._data.waOutbox), 'server', Date.now());
    check('no double send: row claimed by page is skipped', [c.claimed, sent, r.results.find(x => x.key === 'ready_o1').status, db._data.waOutbox.ready_o1.claimedBy], [true, 1, 'skipped', 'page']);
  }

  // 9. ספק עם חלון גלובלי: המתנה לחלון + שליחה לא חורגות מהתקציב
  {
    //  חלון תפוס 5ש׳ קדימה, תקציב 18ש׳ → מותר להמתין עד 3ש׳ בלבד (18 - 15 לשליחה) → לא מתחילים
    const db = mk(2); let sent = 0;
    db._data.waMeta = { sendSlot: { nextAllowedAt: Date.now() + 5000 } };
    const send = async () => { sent++; return { ok: true, httpStatus: 200, messageId: 'm' }; };
    const t = Date.now();
    const r = await drainKeys(db, provider(send, { globalSlot: true, nextGap: () => 100 }), Object.keys(db._data.waOutbox), 'server', Date.now(), 18000);
    check('globalSlot: slot wait beyond what budget allows → deferred at once, nothing sent',
      [Date.now() - t < 1000, sent, r.results[0].status, db._data.waOutbox.ready_o1.state], [true, 0, 'deferred', 'pending']);
    //  חלון תפוס 1ש׳ קדימה → ממתינים ושולחים; סה״כ בתוך התקציב
    const db2 = mk(1); db2._data.waMeta = { sendSlot: { nextAllowedAt: Date.now() + 1000 } };
    const t2 = Date.now();
    const r2 = await drainKeys(db2, provider(send, { globalSlot: true, nextGap: () => 100 }), ['ready_o1'], 'server', Date.now(), 18000);
    const took = Date.now() - t2;
    check('globalSlot: 1s slot wait → sent, within budget', [r2.processed, took >= 900, took < 18000], [1, true, true]);
    //  תקציב שכבר לא משאיר מקום לשליחה בגרוע ביותר → לא מתחילים בכלל
    const db3 = mk(1); sent = 0;
    const r3 = await drainKeys(db3, provider(send, { globalSlot: true, nextGap: () => 100 }), ['ready_o1'], 'server', Date.now() - 4000, 18000);
    check('globalSlot: elapsed 4s of 18s (< worst send 15s left) → no pass started', [r3.processed, sent], [0, 0]);
  }

  // 10. drainNow סופר את התקציב מלפני בדיקת החיבור
  {
    const core = require(path.join(__dirname, '..', 'api', '_wa-drain-core.js'));
    const pmod = require(path.join(__dirname, '..', 'api', '_wa-provider.js'));
    const orig = pmod.lgWaProvider;
    pmod.lgWaProvider = () => provider(OK, { checksState: true, getState: async () => { await new Promise(r => setTimeout(r, 300)); return { state: 'authorized' }; } });
    delete require.cache[require.resolve(path.join(__dirname, '..', 'api', '_wa-drain-core.js'))];
    const core2 = require(path.join(__dirname, '..', 'api', '_wa-drain-core.js'));
    const db = mk(1);
    const r = await core2.drainNow(db, Object.keys(db._data.waOutbox), 'server', { budgetMs: 200 });
    pmod.lgWaProvider = orig;
    check('drainNow: budget counted from before getState (300ms state check > 200ms budget → nothing sent)', [r.processed, db._data.waOutbox.ready_o1.state], [0, 'pending']);
  }

  // 11. לא מוגדר ≠ מנותק
  {
    const r = await SD.lgWaServerDrain(mk(1), { env: { WA_SERVER_DRAIN: 'true' }, now: NOW,
      drain: async () => ({ results: [], processed: 0, state: 'not-configured' }) });
    check('not-configured reported separately', r.skipped, 'not-configured');
  }

  // 12. סדר הדופק: שליחה → בדיקות (דדליין ≤ t0+48ש׳) → רשת "מוכן"
  {
    const { handleUpload } = require(path.join(__dirname, '..', 'api', '_invoice-upload.js'));
    const order = []; let dl;
    const t0 = Date.now();
    const r = await handleUpload({ method: 'POST', headers: { authorization: 'Bearer T' }, body: { op: 'heartbeat', pc: 'OFFICE', pending: [] } }, {
      db: fakeDb({}), env: { INVOICE_UPLOAD_TOKEN: 'T' }, now: 1000,
      waDrain: async () => { order.push('drain'); await new Promise(r => setTimeout(r, 50)); },
      watchRun: async (d, o) => { order.push('watch'); dl = o.deadline; },
      readyNet: async () => { order.push('net'); } });
    check('heartbeat order: drain → watch → ready-net', [r.status, order], [200, ['drain', 'watch', 'net']]);
    check('heartbeat: watch deadline is absolute t0+48s (not shifted by the drain)', [dl >= t0 + 48000, dl <= Date.now() - 50 + 48000 + 5], [true, true]);
  }

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
