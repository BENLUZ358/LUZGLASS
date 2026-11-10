#!/usr/bin/env node
/**
 * שיפור 1 (חדר הסוכנים): מרכזן — תמונה לדוגמה (מקרה נאור 8/11).
 * תמונה מלקוח מקושר ואחריה (עד 3 דק', אותו צ'אט) "כזאת" / "דוגמה" / "משהו כזה" →
 * ההזמנה נשארת בתור עם sampleSuspect (תג "אולי דוגמה — לא הזמנה?"), שאלה בחדר למרכזן
 * (לפי המתג), ובתור: "זו הזמנה" / "דוגמה — הוצא מהתור" (isSample — מוסתרת, לא נמחקת).
 * התג עובד בלי קשר למתגי הסוכנים.
 * Run:  node scripts/test-sample-suspect.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const SS = require(path.join(ROOT, 'api', '_sample-suspect.js'));
const { lgWaInboundRecord, lgWaInboundProcess } = require(path.join(ROOT, 'api', '_wa-inbound.js'));
const { lgOkevFind } = require(path.join(ROOT, 'api', '_agent-okev.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1761480000000, MIN = 60 * 1000;
const NAOR = '0521234567', NAOR_CHAT = '972521234567@c.us', OTHER_CHAT = '972529999999@c.us';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                               arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
const body = (id, md, chat, ts) => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: (ts || NOW) / 1000,
  idMessage: id, senderData: { chatId: chat || NAOR_CHAT, sender: chat || NAOR_CHAT, senderName: 'נאור' }, messageData: md });
const img = (id, chat, caption) => body(id, { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/p.jpg', caption: caption || '', mimeType: 'image/jpeg' } }, chat);
const txt = (id, t, chat) => body(id, { typeMessage: 'textMessage', textMessageData: { textMessage: t } }, chat);
const seed = cfg => fakeDb({
  meta: { orderCounter: 1200 },
  hashavshevetAccounts: { 9117: { key: '9117', name: 'נאור', phone: '521234567' } },
  waSenders: { [NAOR]: { phone: NAOR, customerId: '9117', customerName: 'נאור', linkedAt: NOW - 1, linkedBy: 'ben' } },
  waMeta: { ...(cfg ? { agentConfig: cfg } : {}) },
});
const CFG = mode => ({ agents: { markazan: mode, okev: 'reply', archive: 'reply', price: 'reply', kolet: 'reply', manager: 'reply' }, escalatePhone: '0547725552' });
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs',
              GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0505887576', OPENAI_API_KEY: undefined, AGENT_MODEL: undefined };
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const send = async (db, b, now, flag) => withEnv({ ...ENV, AGENT_SHADOW_ENABLED: flag || 'false' }, async () => {
  const later = [];
  const r = await hook.handleInbound({ method: 'POST', headers: { authorization: 'Bearer hs' }, body: b },
    { db, waitUntil: p => later.push(p), now: now || NOW, fetchImpl: okFetch });
  await Promise.all(later);
  return r;
});
const orders = db => Object.values(db._data.orders || {});
const room = db => Object.entries((db._data.waMeta || {}).agentRoom || {});

(async () => {
  /* ── הטקסט ── */
  for (const t of ['כזאת', 'כזה', 'משהו כזה', 'צריבה כזאת', 'דוגמה', 'לדוגמא', 'רק לדוגמה!', 'כזו בבקשה'])
    check('sample text: ' + t, SS.lgSampleTextIs(t), true);
  for (const t of ['', 'מתי מוכן?', 'אני צריך 3 מראות 80 על 60 כמו בתמונה שלחתי לך אתמול בערב, כזה עם פינוי באמצע ושני חורים', 'כזאתי מילה', 'תודה',
                   'עוד אחד כזה', 'אפשר כזה עד מחר?', 'לא כזה, אחר', 'כזה כזה כזה כזה כזה כזה כזה', '3 כאלה 80 על 60 כזה'])
    check('not sample: ' + t, SS.lgSampleTextIs(t), false);

  /* ── webhook: תמונה ואז "כזאת" ── */
  {
    const db = seed(CFG('shadow'));
    await send(db, img('I1'), NOW, 'true');
    check('image became an order in the queue', orders(db).map(o => [o.stage, !!o.sampleSuspect]), [['', false]]);
    const r = await send(db, txt('T1', 'צריבה כזאת'), NOW + MIN, 'true');
    check('text answers 200 as before', r.status, 200);
    const o = orders(db)[0];
    check('order marked sampleSuspect, kept in the queue', [o.sampleSuspect, o.stage, o.sampleText], [true, '', 'צריבה כזאת']);
    const asks = room(db).filter(([, v]) => v.kind === 'ask' && v.agent === 'markazan');
    check('room ask for מרכזן "הזמנה או דוגמה?"', asks.map(([, v]) => v.text.startsWith('הזמנה או דוגמה?')), [true]);
    check('room key stored on the order', o.sampleRoomKey, asks[0][0]);
    await send(db, txt('T2', 'כזה'), NOW + 2 * MIN, 'true');
    check('second sample text → no second ask', room(db).filter(([, v]) => v.kind === 'ask').length, 1);
  }
  {
    const db = seed(CFG('shadow'));
    await send(db, img('I2'), NOW, 'true');
    await send(db, txt('T3', 'כזאת'), NOW + 4 * MIN, 'true');
    check('more than 3 minutes later → not marked', orders(db)[0].sampleSuspect || false, false);
    await send(db, txt('T4', 'כזאת', OTHER_CHAT), NOW + MIN, 'true');
    check('other chat → not marked', orders(db)[0].sampleSuspect || false, false);
    await send(db, txt('T5', 'מתי מוכן?'), NOW + MIN, 'true');
    check('ordinary text → not marked', orders(db)[0].sampleSuspect || false, false);
  }
  {
    // שחרור "הכל כבוי" (11/11): בלי הגדרות במסך / מרכזן כבוי / מתג עליון כבוי — כלום. בלי תג, בלי סימון, בלי חדר
    for (const [name, cfg, flag] of [['no agentConfig', null, 'true'], ['markazan off', CFG('off'), 'true'], ['shadow flag off', CFG('reply'), 'false']]) {
      const db = seed(cfg);
      await send(db, img('I3'), NOW, flag);
      const before = JSON.stringify(db._data.orders);
      await send(db, txt('T6', 'דוגמה'), NOW + MIN, flag);
      check(name + ': order untouched, no record mark, no room',
        [JSON.stringify(db._data.orders) === before, Object.values(db._data.waInbound || {}).some(r => r.sampleSuspect), room(db).length], [true, false, 0]);
    }
    // תמונה עם כיתוב "כזאת" בלי הגדרות → ההזמנה נולדת בלי תג
    const db = seed(null);
    await send(db, img('I3c', NAOR_CHAT, 'כזאת'), NOW, 'true');
    check('no agentConfig: caption "כזאת" → no tag', orders(db).map(o => !!o.sampleSuspect), [false]);
  }
  {
    // קבוצה: רק מי ששלח את התמונה. חבר אחר בקבוצה שכותב "כזה" — לא מסמן
    const G = '120363000000000001@g.us';
    const db = fakeDb({ waMeta: { agentConfig: CFG('shadow') }, waInbound: {
      r1: { kind: 'image', state: 'done', chatId: G, groupId: G, sender: '0521111111', createdAt: NOW, orderIds: [] } } });
    const other = await withEnv({ AGENT_SHADOW_ENABLED: 'true' }, () =>
      SS.lgSampleSuspectMark(db, { chatId: G, groupId: G, sender: '0522222222', text: 'כזה', now: NOW + MIN }));
    check('group: other member → not marked', [other.pending.length, !!db._data.waInbound.r1.sampleSuspect], [0, false]);
    const same = await withEnv({ AGENT_SHADOW_ENABLED: 'true' }, () =>
      SS.lgSampleSuspectMark(db, { chatId: G, groupId: G, sender: '0521111111', text: 'כזה', now: NOW + MIN }));
    check('group: same sender → marked', [same.pending.length, !!db._data.waInbound.r1.sampleSuspect], [1, true]);
    const fb = SS.lgSampleFromBody({ typeWebhook: 'incomingMessageReceived', senderData: { chatId: G, sender: '972521111111@c.us' },
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'כזאת' } } });
    check('body → sender carried', fb && fb.sender, '0521111111');
  }
  {
    // הטקסט הגיע לפני שהתמונה הפכה להזמנה (העיבוד עוד רץ) → מסומן ברשומה, ההזמנה נולדת מסומנת
    const db = seed(CFG('reply'));
    const p = require(path.join(ROOT, 'api', '_wa-inbound.js')).lgWaInboundParse(img('I4'));
    const rec = await lgWaInboundRecord(db, p.entry, NOW);
    await send(db, txt('T7', 'משהו כזה'), NOW + MIN, 'true');
    check('pending image record marked', !!db._data.waInbound[rec.key].sampleSuspect, true);
    await withEnv({ ...ENV, AGENT_SHADOW_ENABLED: 'true' }, () => lgWaInboundProcess(db, rec.key, { by: 'drain', fetchImpl: okFetch, now: NOW + 2 * MIN }));
    check('order created later is born marked + room ask', [orders(db)[0].sampleSuspect, room(db).filter(([, v]) => v.kind === 'ask').length], [true, 1]);
  }
  {
    // לקוח לא מזוהה (מספר ברשימת Vercel בלי כרטיס) — לא "לקוח מקושר" → לא מסומן
    const db = seed(CFG('shadow'));
    const STR = '972505887576@c.us';
    await withEnv({ ...ENV }, async () => { await send(db, img('I5', STR), NOW, 'true'); await send(db, txt('T8', 'כזאת', STR), NOW + MIN, 'true'); });
    check('unassigned sender → not marked', orders(db).map(o => !!o.sampleSuspect), [false]);
  }

  /* ── בן מחליט בתור ── */
  {
    const db = seed(CFG('shadow'));
    await send(db, img('I6'), NOW, 'true');
    await send(db, txt('T9', 'כזאת'), NOW + MIN, 'true');
    const id = orders(db)[0].id;
    const rk = orders(db)[0].sampleRoomKey;
    check('decide: bad decision refused', (await SS.lgSampleDecide(db, { orderId: id, decision: 'x', by: 'ben' }, NOW)).code, 'bad-decision');
    const r = await SS.lgSampleDecide(db, { orderId: id, decision: 'order', by: 'ben' }, NOW + 2 * MIN);
    const o = db._data.orders[id];
    check('"זו הזמנה" → flag cleared, still in queue, room ask closed',
      [r.ok, o.sampleSuspect || null, o.isSample || null, o.stage, db._data.waMeta.agentRoom[rk].state], [true, null, null, '', 'answered']);
  }
  {
    const db = seed(CFG('shadow'));
    await send(db, img('I7'), NOW, 'true');
    await send(db, txt('T10', 'כזאת'), NOW + MIN, 'true');
    const id = orders(db)[0].id;
    const r = await SS.lgSampleDecide(db, { orderId: id, decision: 'sample', by: 'ben' }, NOW + 2 * MIN);
    const o = db._data.orders[id];
    check('"דוגמה — הוצא מהתור" → isSample, data kept (order + sketch)', [r.ok, o.isSample, o.sampleSuspect || null, !!db._data.sketches[id]], [true, true, null, true]);
    check('decide on an order that is not suspect → refused', (await SS.lgSampleDecide(db, { orderId: id, decision: 'order', by: 'ben' }, NOW)).code, 'not-suspect');
    check('okev: a sample is not an open order', lgOkevFind([{ ...o, id }], {}).match, 'none');
  }

  /* ── חיבורים ── */
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'wa-inbound-drain.js'), 'utf8');
  check('drain: sample-decide action → lgSampleDecide', /action === 'sample-decide'[\s\S]{0,400}lgSampleDecide/.test(DRAIN), true);
  const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const build = (ADMIN.match(/function buildSQItems\(\)\{[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('queue: isSample orders are left out', /o\.isSample/.test(build), true);
  check('queue: row carries sampleSuspect', /sampleSuspect:\s*!!o\.sampleSuspect/.test(build), true);
  const tag = (ADMIN.match(/function _sqSampleTag[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('queue: tag text + both buttons', [tag.includes('אולי דוגמה — לא הזמנה?'), tag.includes('זו הזמנה'), tag.includes('דוגמה — הוצא מהתור'), /stopPropagation/.test(tag)], [true, true, true, true]);
  check('queue: the row renders the tag', /_sqSampleTag\(item\)/.test(ADMIN), true);
  check('queue: buttons call sample-decide', /action:'sample-decide'/.test(ADMIN), true);
  check('stats: queue counters skip samples', /orders\.filter\(o=>!o\.stage && !o\.isSample\)/.test(ADMIN), true);
  const FDB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const norm = (FDB.match(/function lgNormalizeOrder[\s\S]*?\n}/) || [''])[0];
  check('normalizer carries sampleSuspect / isSample / sampleText', [/sampleSuspect:/.test(norm), /isSample:/.test(norm), /sampleText:/.test(norm)], [true, true, true]);

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
