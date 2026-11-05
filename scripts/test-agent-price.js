#!/usr/bin/env node
/**
 * טענת מחיר / בקשת זיכוי (בן, 5/11).
 * המקום לאמבט: תמונה + "אני קונה את המראה ב 114 שח תזכו אותי בבקשה" — נקלטה
 * כסקיצה (L1207) והסוכן "לא הבין". עכשיו: לא נקלטת, והסוכן בודק מול המחירון
 * ומעביר לשאול (צודק → "צריך זיכוי"; לא צודק → מה במחירון).
 * Run:  node scripts/test-agent-price.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const pr = require(path.join(ROOT, 'api', '_agent-price.js'));
const cap = require(path.join(ROOT, 'api', '_wa-caption.js'));
const cls = require(path.join(ROOT, 'api', '_agent-classify.js'));
const okev = require(path.join(ROOT, 'api', '_agent-okev.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const inb = require(path.join(ROOT, 'api', '_wa-inbound.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const REAL = 'אני קונה את המראה ב 114 שח תזכו אותי בבקשה';
const CAT = {
  '4MIRM': { name: "4 מ''מ מראה מלוטש", glass: 'מראה', mm: 4, proc: 'litush', active: true },
  '5MIRAM': { name: "5 מ''מ מראה אפורה מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '6MIRM': { name: "6 מ''מ מראה מלוטש", glass: 'מראה', mm: 6, proc: 'litush', active: true },
  '8CL': { name: "8 מ''מ שקוף מחוסם", glass: 'שקוף', mm: 8, proc: 'chisum', active: true },
};
const CLIENT = { '4MIRM': 110, '5MIRAM': 220, '6MIRM': 130, '8CL': 171 };
const GLOBAL = { '4MIRM': 110, '6MIRM': 130, '8CL': 200 };

const model = out => {
  const m = { calls: 0 };
  m.fetcher = async () => { m.calls++; return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 1 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) }; };
  return m;
};

(async () => {
  /* ── כיתוב שאינו הזמנה ── */
  check('A1 the real caption is not an order', cap.lgWaCaptionNotOrder(REAL), true);
  check('A2 "תזכו אותי" alone is not an order', cap.lgWaCaptionNotOrder('תזכו אותי על המראה'), true);
  check('A3 an amount with ₪ is not an order', cap.lgWaCaptionNotOrder('120₪ למטר'), true);
  check('A4 a sketch name is an order', cap.lgWaCaptionNotOrder('אריה'), false);
  check('A5 a caption with a measurement stays an order, even with a price', cap.lgWaCaptionNotOrder('מראה 100x50 ב 114 שח'), false);
  check('A6 "100 על 50" counts as a measurement', cap.lgWaCaptionNotOrder('מחיר 100 על 50'), false);
  check('A7 empty caption is an order', cap.lgWaCaptionNotOrder(''), false);
  check('A9 a price question with a sketch stays an order (agents in shadow would drop it)', cap.lgWaCaptionNotOrder('מה המחיר?'), false);
  check('A8 "דירה 12" is a name, not money', cap.lgWaCaptionNotOrder('דירה 12'), false);

  /* ── המרכזן: הכיתוב לא נבלע כשם סקיצה ── */
  check('B1 a short money caption is not taken as a sketch name', cls.lgAgentImageName('ב 114 שח תזכו', true), '');
  check('B2 a short name still is', cls.lgAgentImageName('אסף', true), 'אסף');
  check('B3 price is a known intent', cls.AGENT_INTENTS.includes('price'), true);
  check('B4 price routes to the price agent', okev.lgOkevRoute({ intent: 'price', isGroup: true, linked: true }), 'price');
  {
    const m = model({ intent: 'price', ref: '' });
    const r = await cls.lgAgentClassify({ text: REAL, hasImage: true, model: 'm', key: 'k', fetcher: m.fetcher });
    check('B5 the real message goes to the model (not the name shortcut) and comes back as price', [m.calls, r.intent], [1, 'price']);
  }

  /* ── הבדיקה מול המחירון (טהור) ── */
  const C = claim => pr.lgPriceClaimCheck({ claim, catalog: CAT, clientPrices: CLIENT, globalPrices: GLOBAL });
  {
    const a = C({ price: 114, sku: '', glass: 'מראה' });
    check('C1 "the mirror at 114" — no mirror of his is 114 → mismatch, listing his mirrors cheapest first',
          [a.verdict, a.lines.map(l => l.sku + ':' + l.ppm2)], ['mismatch', ['4MIRM:110', '6MIRM:130', '5MIRAM:220']]);
    const b = C({ price: 110, sku: '', glass: 'מראה' });
    check('C2 "the mirror at 110" — his 4mm is 110 → match', [b.verdict, b.lines.map(l => l.sku)], ['match', ['4MIRM']]);
    const c = C({ price: 171, sku: '8CL', glass: 'שקוף' });
    check('C3 a known SKU at his client price → match', [c.verdict, c.lines[0].ppm2], ['match', 171]);
    const d = C({ price: 150, sku: '8CL', glass: '' });
    check('C4 a known SKU at another price → mismatch with his price', [d.verdict, d.lines[0].ppm2], ['mismatch', 171]);
    const e = pr.lgPriceClaimCheck({ claim: { price: 200, sku: '8CL' }, catalog: CAT, clientPrices: {}, globalPrices: GLOBAL });
    check('C5 no client price → the global price list', [e.verdict, e.lines[0].ppm2], ['match', 200]);
    check('C6 no product and no glass → unknown', C({ price: 114, sku: '', glass: '' }).verdict, 'unknown');
    check('C7 no price → unknown', C({ price: 0, sku: '8CL' }).verdict, 'unknown');
    check('C8 a glass nobody prices → unknown', C({ price: 114, sku: '', glass: 'זכוכית צבעונית' }).verdict, 'unknown');
  }

  /* ── ההודעה לשאול ── */
  {
    const mm = pr.lgPriceStaffText(C({ price: 114, glass: 'מראה' }), 'המקום לאמבט', REAL);
    check('D1 mismatch: says what he claims and what his list says', [
      mm.includes('המקום לאמבט'), mm.includes('הלקוח אומר: 114 ₪'), mm.includes('לא תואם'), mm.includes("4 מ''מ מראה מלוטש — 110 ₪ למ\"ר"), mm.includes(REAL)],
      [true, true, true, true, true]);
    const ok = pr.lgPriceStaffText(C({ price: 110, glass: 'מראה' }), 'המקום לאמבט', REAL);
    check('D2 match: says the customer is right and a credit is needed', ok.includes('הלקוח צודק — צריך זיכוי'), true);
    const un = pr.lgPriceStaffText({ verdict: 'unknown', price: 0, lines: [] }, 'X', 'טקסט');
    check('D3 unknown: asks Shaul to check, with the message', [un.includes('נא לבדוק'), un.includes('טקסט')], [true, true]);
  }

  /* ── חילוץ (מודל מזויף) ── */
  {
    const x = await pr.lgPriceClaimExtract({ text: REAL, catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, price: 114, sku: '', glass: 'מראה' }).fetcher });
    check('E1 extract reads price and glass', [x.ok, x.price, x.sku, x.glass], [true, 114, '', 'מראה']);
    const y = await pr.lgPriceClaimExtract({ text: REAL, catalog: CAT, model: 'm', key: 'k', fetcher: model({ ok: true, price: 114, sku: 'MADEUP', glass: '' }).fetcher });
    check('E2 a SKU the model invented is dropped', y.sku, '');
    const z = await pr.lgPriceClaimExtract({ text: REAL, catalog: CAT, model: 'm', key: 'k', fetcher: async () => { throw new TypeError('net'); } });
    check('E3 a network failure never throws', z.ok, false);
  }

  /* ── ההחלטה ── */
  const R = x => ({ linked: true, customerId: '14201', customerName: 'המקום לאמבט', chatId: 'g@g.us', idMessage: 'M1',
                    route: 'price', intent: 'price', text: REAL, hasImage: true, timestamp: 1, ...x });
  {
    const d = act.lgAgentDecide({ rec: R(), orders: [], conv: null, now: 2, price: { ok: true, check: C({ price: 114, glass: 'מראה' }) } });
    check('F1 to Shaul with the check, the photo forwarded, and "we are checking" to the customer',
          d.actions.map(a => a.type + (a.files ? ':forward' : '')), ['staff', 'staff:forward', 'reply']);
    check('F1 the customer hears "we are checking"', d.actions[2].text, pr.PRICE_HOLD_TEXT);
    check('F1 Shaul gets the comparison', d.actions[0].text.includes('לא תואם'), true);
    const n = act.lgAgentDecide({ rec: R({ hasImage: false }), orders: [], conv: null, now: 2 });
    check('F2 no check (model failed / no time) → still to Shaul, as "not recognised"',
          [n.actions.map(a => a.type), n.actions[0].text.includes('לא זיהיתי')], [['staff', 'reply'], true]);
    const u = act.lgAgentDecide({ rec: R({ linked: false }), orders: [], conv: null, now: 2 });
    check('F3 an unlinked chat → nothing (like every other agent)', u.actions, []);
  }

  /* ── הקליטה: תמונה עם כיתוב כזה לא נהיית הזמנה ── */
  {
    const NOW = 1759650005000;
    const db = fakeDb({ meta: { orderCounter: 1206 } });
    const entry = { idMessage: 'CAP1', kind: 'image', chatId: '120363085613806254@g.us', groupId: '120363085613806254@g.us',
                    sender: '0502400482', caption: REAL, downloadUrl: 'https://x/a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', timestamp: NOW - 1000 };
    await inb.lgWaInboundRecord(db, entry, NOW);
    let fetched = 0;
    const res = await inb.lgWaInboundProcess(db, 'CAP1', { fetchImpl: async () => { fetched++; throw new Error('should not download'); }, now: NOW + 1, by: 't' });
    const rec = db._data.waInbound.CAP1;
    check('G1 no order, no download, no order number used',
          [res.ok, res.reason, Object.keys(db._data.orders || {}).length, fetched, db._data.meta.orderCounter], [true, 'not-order', 0, 0, 1206]);
    check('G2 the message is closed with a reason the panel shows', [rec.state, rec.closedBy, rec.closedNote, rec.claimToken], ['closed', 'auto', cap.WA_NOT_ORDER_NOTE, undefined]);
    const again = await inb.lgWaInboundProcess(db, 'CAP1', { fetchImpl: async () => { throw new Error('x'); }, now: NOW + 2, by: 't' });
    check('G3 processing it again does nothing', [again.ok, Object.keys(db._data.orders || {}).length], [false, 0]);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
