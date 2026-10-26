#!/usr/bin/env node
/**
 * כתובות מייל פרטיות — קישור מתוך הקליטות, בלי Vercel (בן, 26/10).
 * אפיון: docs/superpowers/specs/2026-10-26-email-link-senders-design.md
 *
 *   • כתובת לא מוכרת: לא נקלטת (החתיכות נמחקות), אבל נרשמת — כתובת, מונה, זמן
 *   • כתובת מקושרת: נקלטת על הכרטיס שקושר, גוברת על התאמת מייל בכרטיס
 *   • הרשימה ב-Vercel ממשיכה לעבוד כמו קודם
 *
 * Run: node scripts/test-email-senders.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const rcp   = require(path.join(ROOT, 'api', '_email-recipient.js'));
const route = require(path.join(ROOT, 'api', 'email-inbound.js'));

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
  EMAIL_INBOUND_ALLOWED: 'luz-glass-test:ben@own.com',
};
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const call = (body, deps, env) => withEnv({ ...ENV, ...(env || {}) }, () =>
  route.handleEmailInbound({ method: 'POST', headers: { authorization: 'Bearer mail-secret' }, body }, deps));
const part = messageId => ({ op: 'part', messageId, idx: 0, chunk: 0, chunks: 1, data: B64 });
const commit = (messageId, from) => ({
  op: 'commit', messageId, threadId: 'T-' + messageId, from,
  to: 'orderluz@gmail.com', subject: 'סקיצה', date: 1760950000000,
  parts: [{ idx: 0, name: 'a.jpg', mime: 'image/jpeg', size: JPEG.length, chunks: 1 }],
});
const NOW = 1760950005000;
const send = async (db, id, from, env) => {
  await call(part(id), { db }, env);
  return call(commit(id, from), { db, now: NOW }, env);
};

const seed = extra => fakeDb({
  meta: { orderCounter: 1041 },
  hashavshevetAccounts: {
    '14201': { key: '14201', name: 'כרטיס דנה', phone: '050-1234567', email: 'dana@client.co.il' },
    '3150':  { key: '3150', name: 'אגן ברזל', phone: '037436564' },
  },
  users: {
    '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201', role: 'client' },
    '0507654321': { name: 'אגן', businessName: 'אגן ברזל', customerId: '3150', role: 'client' },
  },
  ...(extra || {}),
});
const link = (addr, customerId, customerName) => ({ waMeta: { emailSenders: {
  [addr.replace(/\./g, ',')]: { email: addr, customerId, customerName, linkedAt: NOW - 1, linkedBy: 'ben' } } } });

(async () => {
  // ═══ A. מפתח ═════════════════════════════════════════════════════
  check('A1 key = lower-case address, dots as commas', rcp.lgEmailKey('"Dana" <Dana@Client.co.il>'), 'dana@client,co,il');
  check('A2 a display-name trick keys the last <...> address',
        rcp.lgEmailKey('"boss@client.com <boss@client.com>" <evil@x.com>'), 'evil@x,com');
  check('A3 not an address -> empty key', rcp.lgEmailKey('not an address'), '');

  // ═══ B. lgEmailSenderLink ════════════════════════════════════════
  {
    const db = seed(link('dana@client.co.il', '3150', 'אגן ברזל'));
    check('B1 linked', await rcp.lgEmailSenderLink(db, 'Dana <DANA@client.co.il>'),
          { customerId: '3150', customerName: 'אגן ברזל', email: 'dana@client.co.il' });
    check('B2 not linked -> null', await rcp.lgEmailSenderLink(db, 'x@y.com'), null);
    check('B3 junk -> null', await rcp.lgEmailSenderLink(db, 'junk'), null);
  }

  // ═══ C. כתובת לא מוכרת ═══════════════════════════════════════════
  {
    const db = seed();
    const r = await send(db, 'M1', 'x@y.com');
    check('C1 answer is not-allowed', [r.status, r.body], [200, { ok: true, state: 'not-allowed' }]);
    const seen = (((db._data.waMeta || {}).emailSendersSeen) || {})['x@y,com'];
    check('C2 noted with count 1', seen && seen.count, 1);
    check('C2 only email, count, lastAt stored', Object.keys(seen || {}).sort(), ['count', 'email', 'lastAt']);
    check('C2 email stored readable', seen && seen.email, 'x@y.com');
    check('C3 parts gone', (db._data.emailParts || {}).M1, undefined);
    check('C3 nothing recorded', db._data.emailInbound, undefined);
    await send(db, 'M2', 'X@Y.com');
    check('C4 second mail -> count 2', db._data.waMeta.emailSendersSeen['x@y,com'].count, 2);
  }

  // ═══ D. מתעלמים — לא נכנסים, אבל נספרים ═════════════════════════
  {
    const db = seed({ waMeta: { emailSendersSeen: { 'x@y,com': { email: 'x@y.com', count: 4, lastAt: 1, ignored: true } } } });
    const r = await send(db, 'M3', 'x@y.com');
    check('D1 stays out', [r.body.state, db._data.emailInbound], ['not-allowed', undefined]);
    const seen = db._data.waMeta.emailSendersSeen['x@y,com'];
    check('D2 counted, ignored flag kept', [seen.count, seen.ignored], [5, true]);
  }

  // ═══ E. מקושר ════════════════════════════════════════════════════
  {
    const db = seed(link('new@client.co.il', '14201', 'המקום לאמבט'));
    const r = await send(db, 'M4', '"N" <new@client.co.il>');
    check('E1 recorded', [r.status, r.body.state], [200, 'done']);
    const o = Object.values(db._data.orders)[0];
    check('E2 on the linked card', [o.customerId, o.emailUnassigned], ['14201', undefined]);
    check('E3 no seen note for a linked sender', (db._data.waMeta.emailSendersSeen || {})['new@client,co,il'], undefined);
  }

  // ═══ F. רשימת הסביבה ללא קישור ══════════════════════════════════
  {
    const db = seed();
    const r = await send(db, 'M5', 'Ben@Own.com');
    check('F1 env-listed recorded as today', r.body.state, 'done');
    check('F2 and no sendersSeen entry', (db._data.waMeta || {}).emailSendersSeen, undefined);
  }

  // ═══ G. קישור גובר על התאמת מייל בכרטיס ═════════════════════════
  {
    const db = seed(link('dana@client.co.il', '3150', 'אגן ברזל'));
    const r = await send(db, 'M6', 'dana@client.co.il');
    check('G1 recorded', r.body.state, 'done');
    const o = Object.values(db._data.orders)[0];
    check('G2 link wins over the card email', [o.customerId, o.orderClient, o.clientPhone], ['3150', 'אגן ברזל', '0507654321']);
    check('G3 via link', Object.values(db._data.emailInbound)[0].clientMatch.via, 'link');
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll email sender checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
