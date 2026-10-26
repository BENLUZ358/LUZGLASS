#!/usr/bin/env node
/**
 * מספרים פרטיים בוואטסאפ — קישור מתוך הקליטות, בלי Vercel (בן, 26/10).
 * אפיון: docs/superpowers/specs/2026-10-26-wa-link-senders-design.md
 *
 *   • מספר לא מוכר: לא נקלט, אבל נרשם (מספר, מונה, זמן — בלי תוכן) כדי שאפשר לקשר
 *   • מספר מקושר: נקלט על הכרטיס שקושר, וההודעות חוזרות אליו
 *   • הרשימות ב-Vercel ממשיכות לעבוד כמו קודם — קישור הוא דרך נוספת, לא תחליף
 *   • נעילות הסביבה (ONLY_TO, חתימת פרויקט) גוברות על קישור
 *
 * Run: node scripts/test-wa-senders.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const inb  = require(path.join(ROOT, 'api', '_wa-inbound.js'));
const rcp  = require(path.join(ROOT, 'api', '_wa-recipient.js'));
const env  = require(path.join(ROOT, 'api', '_env.js'));
const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const adm  = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));

const NOW = 1761480000000;
const AGAN = '037436564', AGAN_CHAT = '97237436564@c.us';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                               arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
const privHook = (chatId, id, over = {}) => ({
  typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: 1761480000,
  idMessage: id, senderData: { chatId, sender: chatId, senderName: 'x' },
  messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/p.jpg', caption: 'סקיצה', mimeType: 'image/jpeg' } },
  ...over,
});
const seed = extra => fakeDb({
  meta: { orderCounter: 1100 },
  hashavshevetAccounts: {
    '3150':  { key: '3150', name: 'אגן ברזל', phone: '7436564' },
    '14201': { key: '14201', name: 'המקום לאמבט', phone: '050-588-7576' },
  },
  ...(extra || {}),
});
const aganLink = () => ({ waSenders: { [AGAN]: { phone: AGAN, customerId: '3150', customerName: 'אגן ברזל', linkedAt: NOW - 1, linkedBy: 'ben' } } });

const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs',
              GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0505887576' };
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const req = body => ({ method: 'POST', headers: { authorization: 'Bearer hs' }, body });
const send = async (db, body, now = NOW) => {
  const later = [];
  const r = await withEnv(ENV, () => hook.handleInbound(req(body), { db, waitUntil: p => later.push(p), now, fetchImpl: okFetch }));
  await Promise.all(later);
  return r;
};

(async () => {

// ═══ 1. מפתח המספר ═══════════════════════════════════════════════════
check('1a landline from GREEN chat id', rcp.lgWaSenderKey(AGAN_CHAT), AGAN);
check('1a landline as typed', rcp.lgWaSenderKey('03-7436564'), AGAN);
check('1a mobile in international form', rcp.lgWaSenderKey('972501234567'), '0501234567');
check('1a empty stays empty', rcp.lgWaSenderKey(''), '');

// ═══ 2. מספר לא מוכר ═════════════════════════════════════════════════
{
  const db = seed();
  const r = await send(db, privHook(AGAN_CHAT, 'P1'));
  check('2a unknown sender: 200, ignored as sender', [r.status, r.body.ignored], [200, 'sender']);
  check('2a nothing recorded in the intake', db._data.waInbound, undefined);
  const s = ((db._data.waMeta || {}).sendersSeen || {})[AGAN];
  check('2a but the number is noted', s && [s.phone, s.count, s.lastAt], [AGAN, 1, NOW]);
  check('2a and only the number — no content', s && Object.keys(s).sort(), ['count', 'lastAt', 'phone']);
  await send(db, privHook(AGAN_CHAT, 'P2'), NOW + 5);
  check('2b a second message counts up', db._data.waMeta.sendersSeen[AGAN].count, 2);
}

// ═══ 3. מספר מקושר ═══════════════════════════════════════════════════
{
  const db = seed(aganLink());
  const r = await send(db, privHook(AGAN_CHAT, 'P3'));
  check('3a linked sender is recorded', [r.status, r.body.recorded], [200, true]);
  const o = (db._data.orders || {}).wa_P3_1 || {};
  check('3a on the linked card, assigned', [o.customerId, o.orderClient, o.waUnassigned], ['3150', 'אגן ברזל', undefined]);
  check('3a and remembers the chat for the reply', o.waChat, AGAN);
  check('3a the intake log says it was a link', db._data.waInbound.P3.clientMatch.via, 'link');
  check('3a no sendersSeen noise for a linked number', ((db._data.waMeta || {}).sendersSeen || {})[AGAN], undefined);
}
{
  const db = seed();
  const r = await send(db, privHook('972505887576@c.us', 'P4'));
  const o = (db._data.orders || {}).wa_P4_1 || {};
  check('3b env-listed sender works as before', [r.body.recorded, o.customerId, 'waChat' in o], [true, '14201', false]);
}
{
  const db = seed({ ...aganLink(), users: { [AGAN]: { name: 'מישהו אחר', customerId: '999', role: 'client' } } });
  const who = await rcp.lgClientFromWaSender(db, AGAN_CHAT);
  check('3c an explicit link beats a portal user on the same phone', [who.customerId, who.via], ['3150', 'link']);
}
{
  const db = seed({ waMeta: { sendersSeen: { [AGAN]: { phone: AGAN, count: 3, lastAt: NOW - 9, ignored: { at: NOW - 5, by: 'ben' } } } } });
  const r = await send(db, privHook(AGAN_CHAT, 'P5'));
  const s = db._data.waMeta.sendersSeen[AGAN];
  check('3d an ignored number stays out', [r.body.ignored, db._data.waInbound], ['sender', undefined]);
  check('3d but still counts, and stays ignored', [s.count, !!s.ignored], [4, true]);
}

// ═══ 4. ההודעות חוזרות למספר המקושר, והקישור פותח את השער ═════════
{
  const db = seed(aganLink());
  const o = { customerId: '3150', waChat: AGAN, clientPhone: AGAN, phone: AGAN };
  check('4a reply to the linked sender', await rcp.resolveRecipient(db, o, 'dispatched'),
        { phone: AGAN, source: 'wa-sender', accountKey: '3150', linked: true });
  const un = await rcp.resolveRecipient(seed(), o, 'dispatched');
  check('4b unlinked since: falls back to the card phone, not linked',
        un, { ...(await rcp.resolvePhone(seed(), o)), linked: false });
  const other = await rcp.resolveRecipient(seed({ waSenders: { [AGAN]: { customerId: '14201', customerName: 'x' } } }), o, 'ready');
  check('4c linked to a different card since: not linked', other.linked, false);
  const portal = { customerId: '14201', phone: '0505887576' };
  check('4d a portal order resolves as before', await rcp.resolveRecipient(db, portal, 'ready'),
        { ...(await rcp.resolvePhone(db, portal)), linked: false });
}
{
  const G = '120363041234567890@g.us';
  const db = seed({ waGroups: { [inb.lgWaInboundKey(G)]: { chatId: G, customerId: '14201', customerName: 'x' } } });
  check('4e a linked group is linked', (await rcp.resolveRecipient(db, { waGroup: G, customerId: '14201' }, 'ready')).linked, true);
}
{
  const base = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), WA_PROVIDER: 'green',
                 GREENAPI_ID_INSTANCE: '1', GREENAPI_TOKEN: 't', GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:14201', GREENAPI_ONLY_TO: undefined };
  const gate = (vars, ctx) => withEnv({ ...base, ...vars }, () => env.lgGreenApiGate(ctx));
  check('4f gate: a linked chat of a card not on the list may receive',
        (await gate({}, { accountKey: '3150', phone: AGAN, linked: true })).allowed, true);
  check('4f gate: the same without a link is refused, with the old reason',
        (await gate({}, { accountKey: '3150', phone: AGAN })).reason, 'הלקוח 3150 אינו ברשימת המורשים לשליחה');
  check('4g gate: ONLY_TO still wins over a link',
        (await gate({ GREENAPI_ONLY_TO: '0500000000' }, { accountKey: '3150', phone: AGAN, linked: true })).allowed, false);
  check('4h gate: a list signed for another project blocks a link',
        (await gate({ GREENAPI_ALLOWED_ACCOUNTS: 'lussglass:14201' }, { accountKey: '3150', phone: AGAN, linked: true })).allowed, false);
  check('4i gate: no card key at all is still refused even if linked',
        (await gate({}, { accountKey: '', phone: AGAN, linked: true })).allowed, false);
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
