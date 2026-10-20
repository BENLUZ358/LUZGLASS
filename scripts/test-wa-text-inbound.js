#!/usr/bin/env node
/**
 * הודעת טקסט בוואטסאפ → הזמנה בתור הסקיצות (בן, 20/10/2026 — אגן ברזל).
 * אותו מסלול כמו תמונה: רישום פעם אחת, תפיסה, עדכון אחד "הכל או כלום".
 * Spec: docs/superpowers/specs/2026-10-20-wa-text-mirror-orders-design.md
 * Run:  node scripts/test-wa-text-inbound.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const inb = require(path.join(__dirname, '..', 'api', '_wa-inbound.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MSG = `הזמנת מראות מרכזת מס' PHR#26037
תאריך: 18.10.2026
מראה ללא מסגרת לפי מידה
90/145 ס"מ — כמות: 2
זכוכית מאסטר ליין 8 מ"מ — מלוטש
110/41.5 ס"מ — כמות: 1`;
const NOW = 1792500000000;
const payload = (id, md, chatId) => ({ typeWebhook: 'incomingMessageReceived', idMessage: id, timestamp: NOW / 1000,
  senderData: { chatId: chatId || '972501234567@c.us', sender: chatId || '972501234567@c.us', chatName: 'אגן' }, messageData: md });
const textMd = t => ({ typeMessage: 'textMessage', textMessageData: { textMessage: t } });
const extMd = t => ({ typeMessage: 'extendedTextMessage', extendedTextMessageData: { text: t } });
const seed = () => fakeDb({
  meta: { orderCounter: 1110 },
  users: { '0501234567': { name: 'אגן', businessName: 'אגן ברזל בע"מ', customerId: '777' } },
  skuCatalog: { '5MIRM': { code: '5MIRM', name: "5 מ''מ מראה מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true } },
});

(async () => {
  /* parse */
  {
    const p = inb.lgWaInboundParse(payload('T1', textMd(MSG)));
    check('a text order is recorded, kind text', [p.action, p.entry && p.entry.kind], ['record', 'text']);
    check('…the text is kept on the record', p.entry.text.startsWith("הזמנת מראות מרכזת"), true);
    const e = inb.lgWaInboundParse(payload('T2', extMd(MSG)));
    check('the "extended" text shape (forwarded / long) is read too', e.entry && e.entry.kind, 'text');
    check('a normal chat message is ignored, like today', inb.lgWaInboundParse(payload('T3', textMd('מתי מוכן?'))).reason, 'not a sketch');
    check('a text order inside a group is ignored (private chat only)', inb.lgWaInboundParse(payload('T4', textMd(MSG), '120363000000@g.us')).reason, 'not a sketch');
    const img = inb.lgWaInboundParse(payload('T5', { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://x/y.jpg', mimeType: 'image/jpeg' } }));
    check('images are unchanged', img.entry.kind, 'image');
  }

  /* process */
  {
    const db = seed();
    const p = inb.lgWaInboundParse(payload('TX1', textMd(MSG)));
    const r1 = await inb.lgWaInboundRecord(db, p.entry, NOW);
    const res = await inb.lgWaInboundProcess(db, r1.key, { now: NOW + 100, by: 't', fetchImpl: () => { throw new Error('no download for text'); } });
    check('processing succeeds without downloading anything', res.ok, true);
    const id = res.orderIds[0];
    const o = db._data.orders[id];
    check('the order is in the sketch queue, for the sender\'s client', [o.stage, o.orderClient, o.source], ['', 'אגן ברזל בע"מ', 'whatsapp']);
    check('the sketch name is the customer\'s order number', o.sketchName, 'PHR#26037');
    check('the items are filled: 2 × 5MIRM + 1 × 8MM, sizes in mm', o.items.map(i => [i.sku, i.w, i.h]),
          [['5MIRM', 900, 1450], ['5MIRM', 900, 1450], ['8MM', 1100, 415]]);
    check('the catalog name is used when the SKU is in the catalog', o.items[0].name, "5 מ''מ מראה מלוטש");
    check('the order is marked as a text order', o.waText, true);
    check('the "sketch" is the picture of the message', String(db._data.sketches[id]).startsWith('data:image/svg+xml'), true);
    check('the inbound record is done', db._data.waInbound[r1.key].state, 'done');
    const again = await inb.lgWaInboundRecord(db, p.entry, NOW + 500);
    check('GREEN API resending the same message creates nothing', again.created, false);

    /* the same customer order number again, in a new message */
    const p2 = inb.lgWaInboundParse(payload('TX2', textMd(MSG)));
    const r2 = await inb.lgWaInboundRecord(db, p2.entry, NOW + 1000);
    const res2 = await inb.lgWaInboundProcess(db, r2.key, { now: NOW + 1100, by: 't' });
    const o2 = db._data.orders[res2.orderIds[0]];
    check('a second message with the same order number → a new order marked "duplicate?"', [res2.ok, o2.waDuplicateOf], [true, o.orderNum]);
    check('…and the first order is untouched', db._data.orders[id].waDuplicateOf, undefined);
  }

  /* the webhook starts processing a text order right away, like an image */
  const H = require('fs').readFileSync(path.join(__dirname, '..', 'api', 'wa-inbound.js'), 'utf8');
  check('the webhook processes text immediately, like images', /rec\.created && \(p\.entry\.kind === 'image' \|\| p\.entry\.kind === 'text'\)/.test(H), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll WhatsApp text-inbound checks passed.');
})();
