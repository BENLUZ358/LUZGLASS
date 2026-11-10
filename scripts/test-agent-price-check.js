#!/usr/bin/env node
/**
 * שיפור 5 (חדר הסוכנים): מחירון — כל הזמנה שנשלחה לחשבשבת נבדקת מול המחירון של הלקוח
 * (prices/clients/<מפתח חשבון>). פער → info בחדר למחירון (הזמנה, שורה, צפוי מול נשלח).
 * רק לקוח שיש לו מחירון; קריאה בלבד — לא משנה כלום. frozenPrices (מחיר שהוקפא להזמנה
 * כשבן שינה מחירון אחריה) — מכוון, לא פער.
 * Run:  node scripts/test-agent-price-check.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const PC = require(path.join(ROOT, 'api', '_agent-price-check.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 11, 9);
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = mode => ({ agents: { markazan: 'reply', okev: 'reply', archive: 'reply', price: mode, kolet: 'reply', manager: 'reply' } });
const preview = [
  { name: '8 שקוף', sku: 'G8', qty: '1.000', ppm2: 171, hsLine: 1 },
  { name: '8 מלוטש', sku: 'G8L', qty: '0.500', ppm2: 190, hsLine: 2 },     // במחירון 180
  { name: 'מראה', sku: 'M5', qty: '0.300', ppm2: 300, hsLine: 3 },         // לא במחירון שלו → לא נבדק
  { name: 'בלי מחיר', sku: 'G10', qty: '0.300', ppm2: 0, unpriced: true, hsLine: 4 },   // במחירון 250, נשלח 0
];
const LIST = { G8: 171, G8L: '180', G10: 250 };

(async () => {
  /* ── טהור ── */
  check('lines: mismatches only for SKUs in the customer list',
    PC.lgPriceCheckLines({ preview, clientList: LIST }),
    [{ hsLine: 2, sku: 'G8L', name: '8 מלוטש', expected: 180, sent: 190 }, { hsLine: 4, sku: 'G10', name: 'בלי מחיר', expected: 250, sent: 0 }]);
  check('lines: frozen price on the order is intentional → not a mismatch',
    PC.lgPriceCheckLines({ preview, clientList: LIST, frozen: { G8L: 190 } }).map(m => m.sku), ['G10']);
  check('lines: no list → nothing', PC.lgPriceCheckLines({ preview, clientList: null }), []);
  check('lines: rounding noise ignored', PC.lgPriceCheckLines({ preview: [{ sku: 'G8', ppm2: 171.0004, hsLine: 1 }], clientList: LIST }), []);

  /* ── ריצה ── */
  const order = { orderNum: 'L1001', sketchName: 'מטבח', orderClient: 'כהן זכוכית' };
  const seed = cfg => fakeDb({ waMeta: cfg ? { agentConfig: cfg } : {} });
  const room = d => Object.values((d._data.waMeta || {}).agentRoom || {});
  const run = (d, o) => PC.lgPriceCheckRun(d, { orderId: 'o1', order, accountKey: '777', preview, prices: { clients: { 777: LIST } }, env: ENV, now: NOW, ...(o || {}) });
  {
    const d = seed(CFG('shadow'));
    const before = JSON.stringify(d._data);
    const r = await run(d);
    check('run: one room info for מחירון with order, line, expected vs sent',
      [r.mismatches, room(d).map(v => [v.agent, v.kind, v.text, v.ref])],
      [2, [['price', 'info', 'הזמנה L1001 (מטבח) של כהן זכוכית נשלחה לחשבשבת במחיר שונה מהמחירון: שורה 2 8 מלוטש (G8L) — נשלח 190, במחירון 180; שורה 4 בלי מחיר (G10) — נשלח 0, במחירון 250',
              { orderId: 'o1' }]]]);
    const after = JSON.parse(JSON.stringify(d._data)); delete after.waMeta.agentRoom;
    check('run: read-only — nothing else written', JSON.stringify(after), before);
  }
  {
    const d = seed(null); await run(d);
    check('run no agentConfig: grey info (room only)', room(d).map(v => v.kind), ['info']);
  }
  {
    const d = seed(CFG('off')); await run(d);
    check('run price off: nothing', room(d).length, 0);
  }
  {
    const d = seed(CFG('reply'));
    const r = await run(d, { prices: { clients: { 999: LIST } } });
    check('run: customer without a price list → not checked', [r.checked, room(d).length], [false, 0]);
  }
  {
    const d = seed(CFG('reply'));
    const r = await run(d, { order: { ...order, isTest: true } });
    check('run: test order → not checked', [r.checked, room(d).length], [false, 0]);
  }
  {
    const d = seed(CFG('reply'));
    const r = await run(d, { preview: [preview[0]] });
    check('run: all match → checked, no room line', [r.checked, r.mismatches, room(d).length], [true, 0, 0]);
  }

  /* ── מחובר לשליחה לחשבשבת ── */
  const SRC = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-order.js'), 'utf8');
  const after = SRC.slice(SRC.indexOf("await db.ref('orders/' + orderId).update(numbering)"));
  check('hashavshevet-order: the check runs after a real send (after the numbering), never in dryRun',
    /lgPriceCheckRun\(db, \{/.test(after) && SRC.indexOf('lgPriceCheckRun') > SRC.indexOf('if (dryRun)'), true);
  check('hashavshevet-order: the check cannot break the send (try/catch)', /try \{[^}]*lgPriceCheckRun[\s\S]*?\} catch/.test(after), true);

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
