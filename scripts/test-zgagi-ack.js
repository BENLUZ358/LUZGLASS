#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — "הסקיצות טופלו" על הזמנות מזגאגי (בן, 1/11: "אנחנו שולחים לו").
//  א. ההזמנה נחשבת: שרת (lgSketchAckSkip) ודפדפן (lgSketchAckEligible / Unseen).
//  ב. השליחה: כל ההזמנות מזגאגי → התמונות עם הנוסח הרגיל. מעורב / ספק בלי
//     קבצים / תמונה חסרה → טקסט, כמו היום.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fakeDb } = require('./_fake-db');

const sa = id => JSON.stringify({ project_id: id, client_email: 'x@y', private_key: 'k' });
process.env.FIREBASE_SERVICE_ACCOUNT = sa('luz-glass-test');
delete process.env.WA_PROVIDER;

const { lgSketchAckSkip } = require('../api/_wa-sketch-ack');
const { lgWaEnqueue } = require('../api/_wa-outbox');
const core = require('../api/_wa-drain-core');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const PNG = 'data:image/png;base64,' + Buffer.from('pngbytes').toString('base64');
const zg = (id, over) => Object.assign({ id, source: 'zgagi', zgagi: { biz: 'b', order: 'o', item: id }, customerId: '14201',
  orderClient: 'א.מ מראות', orderNum: 'L' + id, refNum: 'L' + id, sketchName: 'מקלחון ' + id, sketchSeenAt: 5, stage: '' }, over || {});

(async () => {
  // ── א ──
  check('א. שרת: זגאגי נחשב', lgSketchAckSkip(zg('1'), '1', new Set()), null);
  check('א. שרת: source זגאגי בלי zgagi — לא (זיוף מהפורטל)', lgSketchAckSkip(zg('1', { zgagi: null }), '1', new Set()), 'לא סקיצת WhatsApp');
  const DB = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
  const ctx = vm.createContext({});
  ['function lgEmailLinkKey\\([\\s\\S]*?\\n\\}', 'function lgSketchAckClientKey\\([\\s\\S]*?\\n\\}',
   'function lgSketchAckEligible\\([\\s\\S]*?\\n\\}', 'function lgSketchAckUnseen\\([\\s\\S]*?\\n\\}']
    .forEach(re => vm.runInContext(DB.match(new RegExp(re))[0], ctx));
  ctx.O = zg('1');
  check('א. דפדפן: זגאגי נחשב', vm.runInContext('lgSketchAckEligible(O, null)', ctx), true);
  ctx.L = [zg('1', { sketchSeenAt: null }), zg('2', { sketchSeenAt: null })];
  check('א. דפדפן: "יש עוד" סופר גם זגאגי', vm.runInContext('lgSketchAckUnseen(L, lgSketchAckClientKey(L[0]), "1").length', ctx), 1);

  // ── ב ──
  const world = orders => fakeDb({ orders, sketches: { 1: PNG, 2: PNG },
    hashavshevetAccounts: { 14201: { key: '14201', name: 'א.מ מראות', phone: '0501234567' } } });
  const provider = (sent, withFiles) => Object.assign({ name: 'fake', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
    gate: () => ({ allowed: true }),
    send: async f => { sent.push(['text', f]); return { ok: true, messageId: 't', httpStatus: 200 }; } },
    withFiles ? { sendFiles: async f => { sent.push(['files', f]); return { ok: true, messageId: 'f', httpStatus: 200 }; } } : {});
  const run = async (orders, ids, withFiles) => {
    const db = world(orders);
    const q = await lgWaEnqueue(db, { kind: 'sketches-handled', to: '972501234567', clientName: 'א.מ מראות',
      orderNums: ids.map(i => 'L' + i), sketchNames: ids.map(i => 'מקלחון ' + i), orderIds: ids });
    const sent = [];
    const r = await core.drainKeys(db, provider(sent, withFiles), [q.key], 'test', Date.now());
    return { r, sent, db, key: q.key };
  };

  let x = await run({ 1: zg('1'), 2: zg('2') }, ['1', '2'], true);
  check('ב. זגאגי → קבצים', x.sent.map(s => s[0]), ['files']);
  check('ב. סקיצה לכל הזמנה, לפי מספר', x.sent[0][1].files.map(f => [f.name, f.mime]),
    [['סקיצה L1 - מקלחון 1.png', 'image/png'], ['סקיצה L2 - מקלחון 2.png', 'image/png']]);
  check('ב. הנוסח הרגיל (kind)', [x.sent[0][1].kind, x.sent[0][1].caption], ['sketches-handled', undefined]);
  check('ב. סומן נשלח', x.r.results[0].status, 'sent');
  check('ב. sketchAck על ההזמנה', !!(x.db._data.orders[1].sketchAck && x.db._data.orders[1].sketchAck.sentAt), true);

  x = await run({ 1: zg('1'), 2: zg('2', { source: 'whatsapp', zgagi: null }) }, ['1', '2'], true);
  check('ב. מעורב → טקסט', x.sent.map(s => s[0]), ['text']);
  x = await run({ 1: zg('1') }, ['1'], false);
  check('ב. ספק בלי קבצים → טקסט', x.sent.map(s => s[0]), ['text']);
  x = await run({ 3: zg('3') }, ['3'], true);
  check('ב. תמונה חסרה → טקסט (לא נתקע)', x.sent.map(s => s[0]), ['text']);

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
