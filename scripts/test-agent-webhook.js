#!/usr/bin/env node
/**
 * חיבור רשומת הצל ל-webhook (AGENT_SHADOW_ENABLED) — הקליטה לא משתנה.
 *   • בלי דגל: אפס כתיבות ל-agentShadow/agentHuman
 *   • עם דגל: התשובה זהה, נוספת רשומת צל, והעיבוד עובר ל-waitUntil
 *   • הודעה ידנית (outgoingMessageReceived): agentHuman נכתב, אותו body
 *   • lgAgentShadowRecord זורק → עדיין אותה תשובה, לא 500
 *   • רישום הצל כולו בתוך waitUntil — התשובה לא מחכה לו (אפס קריאות DB נוספות)
 * Run: node scripts/test-agent-webhook.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const shadow = require(path.join(ROOT, 'api', '_agent-shadow.js'));

const NOW = 1761480000000;
const AGAN = '037436564', AGAN_CHAT = '97237436564@c.us';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                               arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
const hookBody = (id, md, over = {}) => ({
  typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: 1761480000,
  idMessage: id, senderData: { chatId: AGAN_CHAT, sender: AGAN_CHAT, senderName: 'x' }, messageData: md, ...over,
});
const textMsg = id => hookBody(id, { typeMessage: 'textMessage', textMessageData: { textMessage: 'מתי מוכן?' } });
const imgMsg = id => hookBody(id, { typeMessage: 'imageMessage',
  fileMessageData: { downloadUrl: 'https://do-media.green-api.com/p.jpg', caption: 'סקיצה', mimeType: 'image/jpeg' } });
const humanMsg = id => hookBody(id, { typeMessage: 'textMessage', textMessageData: { textMessage: 'שלום' } },
  { typeWebhook: 'outgoingMessageReceived' });

const seed = () => fakeDb({
  meta: { orderCounter: 1100 },
  hashavshevetAccounts: { '3150': { key: '3150', name: 'אגן ברזל', phone: '7436564' } },
  waSenders: { [AGAN]: { phone: AGAN, customerId: '3150', customerName: 'אגן ברזל', linkedAt: NOW - 1, linkedBy: 'ben' } },
});

const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs',
              GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0505887576',
              OPENAI_API_KEY: undefined, AGENT_MODEL: undefined };
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const req = body => ({ method: 'POST', headers: { authorization: 'Bearer hs' }, body });
const send = async (db, body, flag) => {
  const later = [];
  const r = await withEnv({ ...ENV, AGENT_SHADOW_ENABLED: flag }, async () => {
    const x = await hook.handleInbound(req(body), { db, waitUntil: p => later.push(p), now: NOW, fetchImpl: okFetch });
    await Promise.all(later);
    return x;
  });
  return { r, queued: later.length };
};
const val = async (db, p) => (await db.ref(p).once('value')).val();

(async () => {
  // 1. בלי דגל — אפס כתיבות
  {
    const db = seed();
    const { r, queued } = await send(db, textMsg('T1'), undefined);
    check('1 no flag: body', r, { status: 200, body: { ok: true, ignored: 'not a sketch' } });
    check('1 no flag: no shadow', await val(db, 'waMeta/agentShadow'), null);
    check('1 no flag: waitUntil not used', queued, 0);
    await send(db, humanMsg('H1'), undefined);
    check('1 no flag: no human', await val(db, 'waMeta/agentHuman'), null);
    const f = await send(seed(), textMsg('T1'), 'false');
    check("1 flag 'false' = off", f.queued, 0);
  }
  // 2. טקסט עם דגל — אותו body, רשומה, process
  {
    const base = await send(seed(), textMsg('T2'), undefined);
    const db = seed();
    const { r, queued } = await send(db, textMsg('T2'), 'true');
    check('2 flag: body identical', r, base.r);
    check('2 flag: body value', r, { status: 200, body: { ok: true, ignored: 'not a sketch' } });
    const rows = await val(db, 'waMeta/agentShadow');
    const keys = Object.keys(rows || {});
    check('2 flag: one shadow record', keys.length, 1);
    check('2 flag: process handed to waitUntil', queued, 1);
    check('2 flag: record processed', ['done', 'failed'].includes(rows[keys[0]].state), true);
  }
  // 3. תמונה — הזמנה בתור + רשומת צל
  {
    const plain = seed();
    const base = await send(plain, imgMsg('I3'), undefined);
    const db = seed();
    const { r, queued } = await send(db, imgMsg('I3'), 'true');
    check('3 image: body identical', r, base.r);
    check('3 image: intake queue same as without flag',
      JSON.stringify(await val(db, 'waInbound')), JSON.stringify(await val(plain, 'waInbound')));
    check('3 image: intake queue not empty', !!(await val(db, 'waInbound')), true);
    const rows = await val(db, 'waMeta/agentShadow');
    const rec = Object.values(rows || {})[0] || {};
    check('3 image: shadow intakeKind', rec.intakeKind, 'image');
    check('3 image: process + intake both queued', queued >= 2, true);
  }
  // 4. הודעה ידנית
  {
    const base = await send(seed(), humanMsg('H4'), undefined);
    const db = seed();
    const { r } = await send(db, humanMsg('H4'), 'true');
    check('4 human: body identical', r, base.r);
    check('4 human: 200', r.status, 200);
    const h = await val(db, 'waMeta/agentHuman');
    check('4 human: agentHuman written', !!h && Object.values(h)[0].lastAt === NOW, true);
    check('4 human: no shadow record', await val(db, 'waMeta/agentShadow'), null);
  }
  // 5. הרשומה זורקת — אותה תשובה
  {
    const base = await send(seed(), textMsg('T5'), undefined);
    const orig = shadow.lgAgentShadowRecord;
    shadow.lgAgentShadowRecord = async () => { throw new Error('db down'); };
    try {
      const db = seed();
      const { r, queued } = await send(db, textMsg('T5'), 'true');
      check('5 throw: body identical', r, base.r);
      check('5 throw: one waitUntil (rejection swallowed inside)', queued, 1);
      check('5 throw: no shadow record', await val(db, 'waMeta/agentShadow'), null);
    } finally { shadow.lgAgentShadowRecord = orig; }
  }
  // 5b. אפס המתנה לסוכן בדרך התשובה — הרשומה תלויה, התשובה כבר חזרה
  {
    const base = await send(seed(), textMsg('T5b'), undefined);
    const orig = shadow.lgAgentShadowRecord;
    let release, recCalled = false;
    shadow.lgAgentShadowRecord = (...a) => { recCalled = true; return new Promise(res => { release = () => res(orig(...a)); }); };
    try {
      const db = seed(), later = [];
      const x = await withEnv({ ...ENV, AGENT_SHADOW_ENABLED: 'true' }, async () => {
        const out = await Promise.race([
          hook.handleInbound(req(textMsg('T5b')), { db, waitUntil: p => later.push(p), now: NOW, fetchImpl: okFetch }),
          new Promise(res => setTimeout(() => res('HUNG'), 200)),
        ]);
        const before = await val(db, 'waMeta/agentShadow');
        if (release) release();
        await Promise.all(later);
        return { out, before, after: await val(db, 'waMeta/agentShadow') };
      });
      check('5b response not waiting on record', x.out, base.r);
      check('5b record still ran in waitUntil', [recCalled, x.before, Object.keys(x.after || {}).length], [true, null, 1]);
    } finally { shadow.lgAgentShadowRecord = orig; }
  }
  // 6. process דוחה — לא משפיע
  {
    const orig = shadow.lgAgentShadowProcess;
    shadow.lgAgentShadowProcess = async () => { throw new Error('boom'); };
    try {
      const base = await send(seed(), textMsg('T6'), undefined);
      const { r } = await send(seed(), textMsg('T6'), 'true');
      check('6 process rejects: body identical', r, base.r);
    } finally { shadow.lgAgentShadowProcess = orig; }
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
