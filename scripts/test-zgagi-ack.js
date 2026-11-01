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

  // ── ב ── הזמנות אמיתיות מזגאגי נוצרות דרך הקליטה (הרשומה ב-waMeta/zgagiItems)
  const { lgZgagiReceive } = require('../api/_zgagi-inbound');
  const world = async (n, extra) => {
    const db = fakeDb({ hashavshevetAccounts: { 14201: { key: '14201', name: 'א.מ מראות', phone: '0501234567' } }, skuCatalog: {} });
    const ids = [];
    for (let i = 1; i <= n; i++) {
      const r = await lgZgagiReceive(db, { biz: 'b', order: 'o', orderNo: '1', customerNo: '14201', rev: 1, imagePng: PNG,
        item: { itemId: 'i' + i, type: 'measure', title: 'מקלחון ' + i, qty: 1, measure: { glassType: 'שקוף', thickness: 8, processing: 'chisum', w: 1, h: 1 } } }, 1000 + i);
      ids.push(r.items['i' + i].orderId);
    }
    if (extra) extra(db, ids);
    return { db, ids };
  };
  const provider = (sent, withFiles) => Object.assign({ name: 'fake', configured: true, globalSlot: false, maxPerRun: 5, nextGap: () => 0,
    gate: () => ({ allowed: true }),
    send: async f => { sent.push(['text', f]); return { ok: true, messageId: 't', httpStatus: 200 }; } },
    withFiles ? { sendFiles: async f => { sent.push(['files', f]); return { ok: true, messageId: 'f', httpStatus: 200 }; } } : {});
  const run = async ({ db, ids }, withFiles) => {
    const q = await lgWaEnqueue(db, { kind: 'sketches-handled', to: '972501234567', clientName: 'א.מ מראות',
      orderNums: ids.map(i => (db._data.orders[i] || {}).refNum || i), sketchNames: ids.map(i => (db._data.orders[i] || {}).sketchName || ''), orderIds: ids });
    const sent = [];
    const r = await core.drainKeys(db, provider(sent, withFiles), [q.key], 'test', Date.now());
    return { r, sent, db };
  };

  let w = await world(2);
  let x = await run(w, true);
  check('ב. זגאגי → קבצים', x.sent.map(s => s[0]), ['files']);
  check('ב. סקיצה לכל הזמנה, לפי מספר', x.sent[0][1].files.map(f => [f.name, f.mime]).sort(),
    [['סקיצה L1000 - מקלחון 1 · 1.png', 'image/png'], ['סקיצה L1001 - מקלחון 2 · 1.png', 'image/png']]);
  check('ב. הנוסח הרגיל (kind)', [x.sent[0][1].kind, x.sent[0][1].caption], ['sketches-handled', undefined]);
  check('ב. סומן נשלח', x.r.results[0].status, 'sent');
  check('ב. sketchAck על ההזמנה', !!(x.db._data.orders[w.ids[0]].sketchAck && x.db._data.orders[w.ids[0]].sketchAck.sentAt), true);

  w = await world(1, (db, ids) => { db._data.orders.p1 = zg('p1', { source: 'whatsapp', zgagi: null }); ids.push('p1'); });
  check('ב. מעורב → טקסט', (await run(w, true)).sent.map(s => s[0]), ['text']);
  check('ב. ספק בלי קבצים → טקסט', (await run(await world(1), false)).sent.map(s => s[0]), ['text']);
  w = await world(1, db => { delete db._data.sketches; });
  check('ב. תמונה חסרה → טקסט (לא נתקע)', (await run(w, true)).sent.map(s => s[0]), ['text']);

  // ── ג. זיוף מהפורטל (סקירה C1): source:'zgagi' + zgagi:{} בלי רשומה → בלי תמונות ──
  w = await world(0, (db, ids) => { db._data.orders = { f1: zg('f1') }; db._data.sketches = { f1: PNG }; ids.push('f1'); });
  check('ג. הזמנה מזויפת — לא נשלחות תמונות', (await run(w, true)).sent.map(s => s[0]), ['text']);
  const D = fs.readFileSync(path.join(__dirname, '..', 'api', 'whatsapp-dispatch.js'), 'utf8');
  check('ג. dispatch בודק בעלות לפני שהזמנת זגאגי נכנסת להודעה',
    /order\.source === 'zgagi' && !\(await lgZgagiOwned\(db, id\)\)/.test(D), true);

  // ── ד. יותר מ-10 סקיצות → טקסט (סקירה I5: 60 שניות, ושליחה חוזרת של חצי) ──
  w = await world(11);
  check('ד. 11 סקיצות → טקסט', (await run(w, true)).sent.map(s => s[0]), ['text']);
  w = await world(10);
  check('ד. 10 → קבצים', (await run(w, true)).sent.map(s => [s[0], s[1].files && s[1].files.length]), [['files', 10]]);

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
