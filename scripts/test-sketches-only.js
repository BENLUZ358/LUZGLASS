#!/usr/bin/env node
/** סקיצות בלי חשבונית (בן 27/11). Run: node scripts/test-sketches-only.js */
const path = require('path');
const API = p => path.join(__dirname, '..', 'api', p);
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };
const has = (n, text, sub, want = true) => check(n, String(text).includes(sub), want);

const SO = require(API('_sketches-only.js'));
const { renderText } = require(API('_wa-provider.js'));
const { lgWaStampField } = require(API('_wa-outbox.js'));
const R = require(API('_wa-recipient.js'));

//  PNG 1×1 אמיתי
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fakeDb(data) {
  const get = p => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => { const ks = p.split('/'); let o = data; ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; }); o[ks[ks.length - 1]] = v; };
  return { data, ref: p => ({
    once: async () => ({ val: () => get(p) ?? null }),
    set: async v => set(p, v), update: async v => Object.entries(v).forEach(([k, x]) => set(p + '/' + k, x)),
    transaction: async fn => { const cur = get(p) ?? null; const nv = fn(cur);
      if (nv === undefined) return { committed: false, snapshot: { val: () => cur } };
      set(p, nv); return { committed: true, snapshot: { val: () => nv } }; },
  }) };
}

/* ── הנוסח ── */
const t = renderText({ kind: 'sketches-only', clientName: 'המקום לאמבט', orderNums: ['L1', 'L2', 'L3'], sketchNames: ['נוי', 'אביאל', ''] });
has('greets the client', t, 'שלום המקום לאמבט,');
has('numbered list of names, order number when no name', t, '1. נוי\n2. אביאל\n3. L3');
has('plural header', t, 'הסקיצות של ההזמנות שסופקו לך:');
has('not a "ready" message', t, 'לאיסוף', false);
has('says the invoice has not gone out yet', t, 'החשבונית עוד לא יצאה, והיא תישלח בקרוב.');
has('no break → no warning', t, 'שימו לב', false);
has('single header', renderText({ kind: 'sketches-only', clientName: 'x', orderNums: ['L1'], sketchNames: ['נוי'] }), 'הסקיצה של ההזמנה שסופקה לך:');
const td = renderText({ kind: 'sketches-only', clientName: 'פלג', orderNums: ['L1', 'L2'], sketchNames: ['א', 'ב'], deliveryTomorrow: true });
has('delivery client → next delivery wording', td, 'ההזמנות שאמורות להגיע אליך בהובלה הבאה:');
has('delivery client → not "supplied"', td, 'שסופקו', false);
has('delivery single', renderText({ kind: 'sketches-only', clientName: 'פלג', orderNums: ['L1'], deliveryTomorrow: true }), 'ההזמנה שאמורה להגיע אליך בהובלה הבאה:');
const tb = renderText({ kind: 'sketches-only', clientName: 'x', orderNums: ['L1'], sketchNames: ['נוי'], extraLines: ['בהזמנה L1 (נוי) הפריט 800×1900 מ"מ נשבר בחיסום ונמצא בייצור מחדש.'] });
has('break is named', tb, 'שימו לב:\nבהזמנה L1 (נוי) הפריט');
check('break line comes before the invoice line', tb.indexOf('שימו לב') < tb.indexOf('החשבונית עוד לא יצאה'), true);
check('stamp field is not "whatsapp" (that is the ready stamp)', lgWaStampField('sketches-only'), 'sketchesOnlyWa');

(async () => {
  /* ── הנמען: לאן שהולכות החשבוניות ── */
  const rdb = fakeDb({ waGroups: {}, waMeta: { invoiceToPrivate: { '14201': { phone: '0501112222' } } } });
  const { _groupKey } = R;
  const order = { source: 'whatsapp', customerId: '14201', waGroup: '120363000000000000@g.us' };
  //  קבוצה מקושרת לכרטיס
  rdb.data.waGroups[String(order.waGroup).replace(/[.#$\[\]\/]/g, '_')] = { customerId: '14201' };
  const w = await R.resolveRecipientWa(rdb, order, 'sketches-only');
  check('goes to the invoice-private number, like invoices', [w.phone, w.source], ['0501112222', 'invoice-private']);
  const wr = await R.resolveRecipientWa(rdb, order, 'ready');
  check('"ready" still goes to the group', wr.source, 'group');

  /* ── הקבצים ── */
  const db = fakeDb({
    orders: {
      b: { orderNum: 'L1356', sketchName: 'רותי', customerId: '14201', orderClient: 'המקום לאמבט', source: 'whatsapp' },
      a: { orderNum: 'L1353', sketchName: 'נוי', customerId: '14201', orderClient: 'המקום לאמבט', source: 'portal' },
      c: { orderNum: 'L1357', customerId: '14201', orderClient: 'המקום לאמבט', source: 'whatsapp' },
      x: { orderNum: 'L9', customerId: '1358', orderClient: 'הר', source: 'whatsapp' },
      t: { orderNum: 'L8', customerId: '14201', isTest: true },
    },
    sketches: { a: PNG, b: PNG },
  });
  const f = await SO.lgSketchesOnlyFiles(db, ['a', 'b', 'c'], 'המקום לאמבט');
  check('one PDF file', [f.ok, f.files.length, f.files[0].mime], [true, 1, 'application/pdf']);
  check('file name', f.files[0].name, 'סקיצות המקום לאמבט.pdf');
  const { PDFDocument } = require('pdf-lib');
  check('a page per sketch that exists', (await PDFDocument.load(f.files[0].buf)).getPageCount(), 2);
  check('missing sketch named by order number', f.missing, ['L1357']);
  check('no sketches at all → not ok', (await SO.lgSketchesOnlyFiles(db, ['c'])).ok, false);

  /* ── השליחה ── */
  const recipient = { resolveRecipientWa: async (_db, o, kind) => { recipient.seen = [o.orderNum, kind];
    return { channel: 'whatsapp', phone: '0501112222', source: 'invoice-private', accountKey: '14201' }; } };
  let drained = [];
  const deps = { recipient, now: 1000 * 60000, drain: async (_db, keys) => { drained.push(keys[0]); return { results: [{ key: keys[0], status: 'sent' }] }; } };
  const r1 = await SO.lgSketchesOnlyNotify(db, ['b', 'a', 'c'], deps);
  check('sent', r1.state, 'sent');
  check('recipient picked from the WhatsApp order, kind sketches-only', recipient.seen, ['L1356', 'sketches-only']);
  const q = db.data.waOutbox[r1.key];
  check('queued kind', q.kind, 'sketches-only');
  check('names in id order (same as PDF pages)', q.sketchNames, ['נוי', 'רותי', '']);
  check('not a delivery client', q.deliveryTomorrow, false);
  check('no break → no extra lines', q.extraLines, []);
  //  שבר בחיסום + לקוח הובלות (פלג, כרטיס 07)
  const dbd = fakeDb({ orders: {
    p1: { orderNum: 'L2001', sketchName: 'דנה', customerId: '07', orderClient: 'פלג', source: 'whatsapp',
          items: [{ w: 500, h: 600 }, { w: 800, h: 1900 }], brokenChisum: { 1: { at: 1 } } },
    p2: { orderNum: 'L2002', sketchName: 'משה', customerId: '07', orderClient: 'פלג', source: 'whatsapp', items: [{ w: 1, h: 2 }] } } });
  const rd = await SO.lgSketchesOnlyNotify(dbd, ['p1', 'p2'], deps);
  const qd = dbd.data.waOutbox[rd.key];
  check('delivery client flagged', qd.deliveryTomorrow, true);
  check('break line queued', qd.extraLines.length === 1 && qd.extraLines[0].includes('L2001 (דנה)') && qd.extraLines[0].includes('800×1900'), true);
  check('double press in the same minute = one message', (await SO.lgSketchesOnlyNotify(db, ['a', 'b', 'c'], deps)).state, 'already');
  check('a minute later = explicit resend', (await SO.lgSketchesOnlyNotify(db, ['a', 'b', 'c'], { ...deps, now: deps.now + 60000 })).state, 'sent');
  check('mixed cards blocked', (await SO.lgSketchesOnlyNotify(db, ['a', 'x'], deps)).state, 'blocked');
  check('test order blocked', (await SO.lgSketchesOnlyNotify(db, ['a', 't'], deps)).state, 'blocked');
  check('missing order blocked', (await SO.lgSketchesOnlyNotify(db, ['a', 'zz'], deps)).state, 'blocked');
  check('empty blocked', (await SO.lgSketchesOnlyNotify(db, [], deps)).state, 'blocked');
  const noPhone = { ...deps, recipient: { resolveRecipientWa: async () => ({ phone: '', source: 'invoice-private-missing' }) } };
  const np = await SO.lgSketchesOnlyNotify(db, ['a'], { ...noPhone, now: deps.now + 5 * 60000 });
  check('no private number → clear reason', [np.state, np.reason], ['blocked', 'סומן "חשבוניות לפרטי" אבל אין מספר פרטי בכרטיס הלקוח']);
  check('nothing touched on the orders (invoice state unchanged)', Object.keys(db.data.orders.a).sort(), ['customerId', 'orderClient', 'orderNum', 'sketchName', 'source']);

  /* ── התור עד הספק: הקובץ נבנה בשליחה, והנוסח הוא של סקיצות ── */
  const D = require(API('_wa-drain-core.js'));
  const sentFacts = [];
  const provider = { configured: true, maxPerRun: 10, nextGap: () => 0,
    gate: () => ({ allowed: true, reason: '' }),
    send: async () => { throw new Error('plain send must not be used'); },
    sendFiles: async facts => { sentFacts.push(facts); return { ok: true, messageId: 'm1' }; } };
  //  נתונים אמיתיים לנמען (ה-drain לוקח את resolveRecipientWa בטעינה): הזמנת הוואטסאפ בקבוצה מקושרת
  const orders2 = JSON.parse(JSON.stringify(db.data.orders));
  orders2.b.waGroup = order.waGroup;
  const db2 = fakeDb({ orders: orders2, sketches: db.data.sketches, waGroups: rdb.data.waGroups, waMeta: rdb.data.waMeta });
  const { lgWaEnqueue } = require(API('_wa-outbox.js'));
  const e = await lgWaEnqueue(db2, { kind: 'sketches-only', to: '0501112222', clientName: 'המקום לאמבט', orderIds: ['a', 'b'],
    orderNums: ['L1353', 'L1356'], sketchNames: ['נוי', 'רותי'], extraLines: ['נוי', 'רותי'], keySuffix: 'm1' });
  const sentTo = [];
  const send0 = provider.sendFiles; provider.sendFiles = async f => { sentTo.push(f.to); return send0(f); };
  const out = await D.drainKeys(db2, provider, [e.key], 'test', Date.now());
  check('drain sent it', (out.results[0] || {}).status, 'sent');
  check('drain sends to the invoice-private number (resolved from the WhatsApp order)', sentTo, ['0501112222']);
  check('provider got the PDF', sentFacts[0] && sentFacts[0].files.map(f => f.mime), ['application/pdf']);
  check('provider kind', sentFacts[0] && sentFacts[0].kind, 'sketches-only');
  check('stamp written to sketchesOnlyWa, not "whatsapp"', [!!db2.data.orders.a.sketchesOnlyWa, db2.data.orders.a.whatsapp === undefined], [true, true]);

  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
