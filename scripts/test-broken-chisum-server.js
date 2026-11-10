#!/usr/bin/env node
/** שבר בחיסום — הנוסח, התור והשליחה ללקוח (בן 10/11). Run: node scripts/test-broken-chisum-server.js */
const path = require('path');
const API = p => path.join(__dirname, '..', 'api', p);
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };
const has = (n, text, sub, want = true) => check(n, String(text).includes(sub), want);

const B = require(API('_broken.js'));
const { renderText } = require(API('_wa-provider.js'));

const o1 = { id: 'a', orderNum: 'L1220-3', sketchName: 'דנה 1', items: [{ w: 500, h: 600 }, { w: 800, h: 1900 }],
             brokenChisum: { 1: { at: 1, track: 'chisum' } } };
const o2 = { id: 'b', orderNum: 'L1220-4', sketchName: 'דנה 2', items: [{ w: 300, h: 400 }] };
const o3 = { id: 'c', orderNum: 'L1221', items: [{ w: 1, h: 2 }], brokenChisum: { 0: { at: 1, returnedAt: 5 } } };

const lines = B.brokenInvoiceLines([o1, o2, o3]);
check('one line, only the order with an open break', lines.length, 1);
has('line names the order and sketch', lines[0], 'L1220-3 (דנה 1)');
has('line has the broken piece dims', lines[0], '800×1900');

const inv = renderText({ kind: 'invoice', clientName: 'פלג', orderNums: ['L1220-3', 'L1220-4'], docNumber: '67600', extraLines: lines });
has('invoice text still says the invoice', inv, 'מצורפת חשבונית מס 67600');
has('invoice text warns about the break', inv, 'שימו לב:');
has('invoice text says invoice covers whole order', inv, 'החשבונית יוצאת על כל ההזמנה, והפריט יגיע בהמשך.');
const plain = renderText({ kind: 'invoice', clientName: 'פלג', orderNums: ['L1'], docNumber: '1' });
has('no break → no warning', plain, 'שימו לב', false);
const both = renderText({ kind: 'invoice', clientName: 'x', orderNums: ['L1'], docNumber: '1', extraLines: lines, deliveryTomorrow: true });
has('break + delivery line both present', both, 'שימו לב:') ;

const ret = renderText({ kind: 'broken-returned', clientName: 'פלג', orderNums: ['L1220-3'], docNumber: '67600',
                         extraLines: B.brokenReturnedLines(o1, 1) });
has('returned text names the piece', ret, 'חזר מהחיסום ויגיע אליכם בהובלה הקרובה');
has('returned text cites the invoice', ret, 'החשבונית כבר יצאה על כל ההזמנה (חשבונית 67600).');
const retNoDoc = renderText({ kind: 'broken-returned', clientName: 'פלג', orderNums: ['L1'], extraLines: ['x'] });
has('no invoice yet → no number', retNoDoc, 'החשבונית כבר יצאה על כל ההזמנה.');
has('returned is not a "ready for pickup" message', ret, 'מוכנה לאיסוף', false);

/* ── התור: מפתח לכל פריט, לחיצה כפולה = אחת ──────────────────────── */
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
(async () => {
  const order = { ...o1, source: 'whatsapp', orderClient: 'פלג', customerId: '07', invoiceDone: { docNumber: '67600' } };
  const db = fakeDb({ orders: { a: order } });
  const recipient = { resolveRecipientWa: async () => ({ channel: 'whatsapp', phone: '0501234567', source: 'test', accountKey: '07' }) };
  let drained = 0;
  const deps = { recipient, drain: async (_db, keys) => { drained++; return { results: [{ key: keys[0], status: 'sent' }] }; } };
  const r1 = await B.lgBrokenReturnedNotify(db, 'a', 1, deps);
  check('first press sends', r1.state, 'sent');
  const r2 = await B.lgBrokenReturnedNotify(db, 'a', 1, deps);
  check('second press does not send again', [r2.state, drained], ['already', 1]);
  const q = db.data.waOutbox && db.data.waOutbox[r1.key];
  check('outbox carries the lines and the invoice number', [q && q.kind, q && q.docNumber, q && q.extraLines.length], ['broken-returned', '67600', 1]);
  const r3 = await B.lgBrokenReturnedNotify(db, 'a', 0, deps);
  check('item not registered as broken → refused', r3.state, 'blocked');

  const dbE = fakeDb({ orders: { a: { ...order, source: 'email', emailMessageId: 'm1' } }, waMeta: {} });
  const recE = { resolveRecipient: async () => ({ channel: 'email', email: 'miklahonim1@gmail.com', thread: 't1', accountKey: '07' }) };
  const rE = await B.lgBrokenReturnedNotify(dbE, 'a', 1, { recipient: recE });
  const qE = dbE.data.waMeta.emailOutbox && Object.values(dbE.data.waMeta.emailOutbox)[0];
  check('email: queued to the invoice address (Peleg → ILANATA)', [rE.state, qE && qE.sendTo], ['queued', 'ilanata@bdo.co.il']);

  console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
