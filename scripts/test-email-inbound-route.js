#!/usr/bin/env node
/**
 * קליטת סקיצות מהמייל — ה-route הציבורי ש-סקריפט Gmail קורא לו, וצד האדמין.
 * אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.2
 * תוכנית: docs/superpowers/plans/2026-10-20-email-intake-1-images.md (Task 4)
 *
 * מה נבדק כאן, ולמה כל חלק קיים:
 *
 *   A. הסוד — אותה בדיקה כמו ה-webhook של WhatsApp (_hook-token.js), כולל
 *      סימני כיוון בלתי נראים שהאייפון מכניס (15/10). סוד לא נכון → 401.
 *   B. `to` חייב להיות כתובת התיבה של הסביבה — אחרת 403.
 *   C. שולח שאינו ברשימה → 200 ignored, ושום דבר לא נרשם (גם לא החתיכות).
 *   D. part + commit → done, עם מספר הזמנה. קלט פגום → 400 לפני שנוגעים
 *      בבסיס. כשל כתיבה → 500, כדי שהסקריפט ינסה שוב.
 *   E. wa-inbound-drain עם channel:'email' — drain / retry / close על התור
 *      של המייל; בלי channel — WhatsApp בדיוק כמו היום.
 *   F. Vercel Hobby — לא יותר מ-12 פונקציות.
 *
 * Run: node scripts/test-email-inbound-route.js
 */
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const route = require(path.join(ROOT, 'api', 'email-inbound.js'));
const drain = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));

// ─── קובץ סינתטי — רק שהבייטים הראשונים יזוהו כ-JPEG ──────────────
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, marker, len >> 8, len & 0xFF]), payload]);
};
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8]),
  seg(0xE0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')), seg(0xDB, Buffer.alloc(65, 1)),
  seg(0xDA, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0xFF, 0xD9])]);
const B64 = JPEG.toString('base64');

const ENV = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }),
  EMAIL_INBOUND_TOKEN: 'mail-secret',
  EMAIL_INBOUND_ADDRESS: 'Orderluz@gmail.com',
  EMAIL_INBOUND_ALLOWED: 'luz-glass-test:dana@client.co.il',
};
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const call = (req, deps, env) => withEnv({ ...ENV, ...(env || {}) }, () => route.handleEmailInbound(req, deps));
const req = (body, auth = 'Bearer mail-secret', method = 'POST') => ({ method, headers: { authorization: auth }, body });

const NOW = 1760950005000;
const seed = () => fakeDb({
  meta: { orderCounter: 1041 },
  hashavshevetAccounts: { '14201': { key: '14201', name: 'כרטיס אגן', phone: '050-1234567', email: 'dana@client.co.il' } },
  users: { '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201' } },
});
const part = (messageId, x) => ({ op: 'part', messageId, idx: 0, chunk: 0, chunks: 1, data: B64, ...(x || {}) });
const commit = (messageId, x) => ({
  op: 'commit', messageId, threadId: 'T-' + messageId, from: '"Dana" <Dana@Client.co.il>',
  to: 'orderluz@gmail.com', subject: 'סקיצה', date: 1760950000000,
  parts: [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', size: JPEG.length, chunks: 1 }], ...(x || {}),
});

(async () => {
// ═══ A. הסוד ═════════════════════════════════════════════════════════
  {
    const db = seed();
    check('A1 a wrong token is refused', (await call(req(part('M1'), 'Bearer nope'), { db })).status, 401);
    check('A1 a missing token is refused', (await call(req(part('M1'), ''), { db })).status, 401);
    check('A1 and nothing is written', [db._data.emailParts, db._data.emailInbound], [undefined, undefined]);
    check('A2 with no token configured nothing gets in',
          (await call(req(part('M1'), 'Bearer '), { db }, { EMAIL_INBOUND_TOKEN: '' })).status, 401);
    check('A3 an invisible direction mark (U+200F) in the header still matches, as on WhatsApp',
          (await call(req(part('M1'), 'Bearer ‏mail-secret‎'), { db })).status, 200);
    check('A3 and one in the stored secret too',
          (await call(req(part('M1')), { db }, { EMAIL_INBOUND_TOKEN: '‏mail-secret' })).status, 200);
    check('A4 GET is not accepted', (await call(req(part('M1'), 'Bearer mail-secret', 'GET'), { db })).status, 405);
    check('A5 the WhatsApp secret does not open the mail route',
          (await call(req(part('M1'), 'Bearer hook-secret'), { db }, { GREENAPI_WEBHOOK_TOKEN: 'hook-secret' })).status, 401);
  }

// ═══ B. `to` ═════════════════════════════════════════════════════════
  {
    const db = seed();
    const r = await call(req(commit('M2', { to: 'someone@else.com' })), { db });
    check('B1 a mail not addressed to the intake box is refused', r.status, 403);
    check('B1 and nothing is recorded', db._data.emailInbound, undefined);
    check('B2 with no intake address configured nothing gets in',
          (await call(req(commit('M2')), { db }, { EMAIL_INBOUND_ADDRESS: '' })).status, 403);
    check('B3 the address may sit in a comma list, any case, with a display name',
          (await call(req(commit('M2', { to: 'a@b.com, "Luz, Orders" <ORDERLUZ@gmail.com>' })), { db })).status, 200);
  }

// ═══ C. שולח שאינו ברשימה ═══════════════════════════════════════════
  {
    const db = seed();
    await call(req(part('M3')), { db });
    const r = await call(req(commit('M3', { from: 'stranger@spam.com' })), { db });
    check('C1 a sender not on the list gets 200 ignored/sender', [r.status, r.body],
          [200, { ok: true, state: 'ignored', reason: 'sender' }]);
    check('C1 and no record is written', db._data.emailInbound, undefined);
    check('C1 nor are its uploaded parts kept', (db._data.emailParts || {}).M3, undefined);
    check('C2 an empty allowlist lets nobody in',
          (await call(req(commit('M3b')), { db }, { EMAIL_INBOUND_ALLOWED: '' })).body.state, 'ignored');
  }

// ═══ D. part + commit ═══════════════════════════════════════════════
  {
    const db = seed();
    const p = await call(req(part('<M4.x@mail>')), { db, now: NOW });
    check('D1 a chunk upload answers 200 ok', [p.status, p.body], [200, { ok: true }]);
    const r = await call(req(commit('<M4.x@mail>')), { db, now: NOW });
    check('D1 commit answers 200 done with the order number', [r.status, r.body],
          [200, { ok: true, state: 'done', refNum: 'L1042' }]);
    check('D1 the sketch is in the queue', !!(db._data.orders || {})['em_<M4_x@mail>_1'], true);
    const again = await call(req(commit('<M4.x@mail>')), { db, now: NOW + 5 });
    check('D2 the same mail again answers the same, and creates nothing new',
          [again.body, Object.keys(db._data.orders).length], [{ ok: true, state: 'done', refNum: 'L1042' }, 1]);
    const body = JSON.stringify(commit('M4s'));
    check('D3 a JSON string body is accepted', (await call(req(body), { db, now: NOW })).status, 200);
  }
  {
    const db = seed();
    const bad = async (b, name) => {
      const r = await call(req(b), { db });
      check('D4 ' + name + ' → 400', r.status, 400);
    };
    await bad(part(''), 'a part with no messageId');
    await bad(part('x'.repeat(201)), 'a messageId over 200 characters');
    await bad(part(12345), 'a messageId that is not a string');
    await bad(commit(''), 'a commit with no messageId');
    await bad(commit('M5', { parts: [{ idx: 20, name: 'a.jpg', mime: 'image/jpeg', size: 1, chunks: 1 }] }), 'a part index of 20');
    await bad(commit('M5', { parts: [{ idx: 0.5, name: 'a.jpg', mime: 'image/jpeg', size: 1, chunks: 1 }] }), 'a fractional part index');
    await bad(commit('M5', { parts: [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', size: 1, chunks: 11 }] }), 'a file in 11 chunks');
    await bad(commit('M5', { parts: [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', size: 1, chunks: 0 }] }), 'a file in 0 chunks');
    await bad(commit('M5', { parts: 'a.jpg' }), 'parts that are not a list');
    await bad(part('M5', { idx: 20 }), 'a chunk for file 20');
    await bad(part('M5', { data: 'not base64!' }), 'a chunk that is not base64');
    await bad({ op: 'nope', messageId: 'M5' }, 'an unknown op');
    await bad(null, 'no body at all');
    check('D4 and none of them wrote anything', [db._data.emailInbound, db._data.emailParts], [undefined, undefined]);
    const r = await call(req(part('M5', { idx: 20 })), { db });
    check('D4 a refused chunk says why', r.body.code, 'bad-idx');
  }
  {
    const broken = { ref: () => ({
      transaction: async () => { throw new Error('rtdb down'); },
      set: async () => { throw new Error('rtdb down'); },
      once: async () => ({ val: () => null }),
    }) };
    check('D5 a chunk that cannot be stored answers 500, so the script tries again',
          (await call(req(part('M6')), { db: broken })).status, 500);
    check('D5 a commit that cannot be recorded answers 500',
          (await call(req(commit('M6')), { db: broken })).status, 500);
  }
  {
    // מצבים שאינם סופיים עוברים כמו שהם — הסקריפט מנסה שוב
    const db = seed();
    const r = await call(req(commit('M7')), { db, now: NOW });   // אין חתיכות
    check('D6 a commit before the parts arrived passes "failed" through, not done',
          [r.status, r.body.ok, r.body.state], [200, true, 'failed']);
  }

// ═══ E. צד האדמין ═══════════════════════════════════════════════════
  {
    const db = seed();
    await call(req(commit('M8')), { db, now: NOW });               // נכשל — אין חתיכות
    await call(req(part('M8')), { db, now: NOW });
    const st = () => db._data.emailInbound.M8.state;
    check('E1 the mail starts out failed', st(), 'failed');
    const d = await drain.handleAdmin({ action: 'drain', channel: 'email' }, { db, by: '0500000000', now: NOW + 1 });
    check('E1 an email drain processes the email queue', [d.ok, d.processed, st()], [true, 1, 'done']);
    check('E1 and makes the order', !!db._data.orders.em_M8_1, true);

    await call(req(commit('M9')), { db, now: NOW });
    const rt = await drain.handleAdmin({ action: 'retry', channel: 'email', key: 'M9' }, { db, by: '0500000000', now: NOW + 1 });
    check('E2 retry on an email key goes through the email functions', [rt.ok, db._data.emailInbound.M9.retryCount], [false, 1]);

    const cl = await drain.handleAdmin({ action: 'close', channel: 'email', key: 'M9', note: 'טופל' }, { db, by: '0500000000', now: NOW + 2 });
    check('E3 close on an email key closes the email record', [cl.ok, db._data.emailInbound.M9.state], [true, 'closed']);

    const lg = await drain.handleAdmin({ action: 'link-group', channel: 'email', key: 'g1' }, { db, by: '0500000000' });
    check('E4 linking a group stays WhatsApp-only', lg.code, 'bad-action');
    const ch = await drain.handleAdmin({ action: 'drain', channel: 'sms' }, { db, by: '0500000000' });
    check('E5 an unknown channel is refused', ch.code, 'bad-channel');
    const bk = await drain.handleAdmin({ action: 'retry', channel: 'email', key: 'a/b' }, { db, by: '0500000000' });
    check('E6 an email key with characters Firebase rejects is refused', bk.code, 'bad-key');
  }
  {
    // בלי channel — WhatsApp, כמו היום: רשומת מייל ממתינה לא נוגעת
    const db = seed();
    await call(req(commit('M10')), { db, now: NOW });
    await call(req(part('M10')), { db, now: NOW });
    const d = await drain.handleAdmin({ action: 'drain' }, { db, by: '0500000000', now: NOW + 1 });
    check('E7 a drain with no channel is WhatsApp and leaves the mail alone',
          [d.processed, db._data.emailInbound.M10.state], [0, 'failed']);
  }

// ═══ F. Vercel ══════════════════════════════════════════════════════
  {
    const routes = fs.readdirSync(path.join(ROOT, 'api')).filter(f => !f.startsWith('_'));
    check('F1 no more than 12 functions (Vercel Hobby) — ' + routes.length, routes.length <= 12, true);
    const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    check('F2 the route has 60 seconds — commit processes inline',
          ((VJ.functions || {})['api/email-inbound.js'] || {}).maxDuration, 60);
    const SRC = fs.readFileSync(path.join(ROOT, 'api', 'email-inbound.js'), 'utf8');
    check('F3 the token is checked by the shared helper', /lgHookTokenOk/.test(SRC), true);
    check('F3 and neither the token nor the body is ever logged',
          /console\.[a-z]+\([^)]*(EMAIL_INBOUND_TOKEN|authorization|req\.body|\.data\b)/i.test(SRC), false);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll email route checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
