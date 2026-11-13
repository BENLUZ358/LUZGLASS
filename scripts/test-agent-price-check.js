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
const withFlag = async (v, fn) => { const k = process.env.AGENT_SHADOW_ENABLED; process.env.AGENT_SHADOW_ENABLED = v;
  try { return await fn(); } finally { if (k === undefined) delete process.env.AGENT_SHADOW_ENABLED; else process.env.AGENT_SHADOW_ENABLED = k; } };

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
  //  כמו השליחה: prices/clients/<מפתח> → שם דרך prices/clientKeys → לפי orderClient של ההזמנה
  const PRICES = { clients: { 777: LIST }, clientKeys: { 777: 'כהן זכוכית' } };
  const run = (d, o) => PC.lgPriceCheckRun(d, { orderId: 'o1', order, accountKey: '777', preview, prices: PRICES, env: ENV, now: NOW, ...(o || {}) });
  {
    const d = seed(CFG('shadow'));
    const before = JSON.stringify(d._data);
    const r = await run(d);
    check('run: one room info for מחירון with order, line, expected vs sent',
      [r.mismatches, room(d).map(v => [v.agent, v.kind, v.text, v.ref])],
      [2, [['price', 'info', 'הזמנה L1001 (מטבח) של כהן זכוכית נשלחה לחשבשבת במחיר שונה מהמחירון: שורה 2 8 מלוטש (G8L) — נשלח 190, במחירון 180; שורה 4 בלי מחיר (G10) — נשלח 0, במחירון 250',
              { orderId: 'o1' }]]]);
    const after = JSON.parse(JSON.stringify(d._data)); delete after.waMeta.agentRoom; delete after.waMeta.agentPriceChecked;
    check('run: read-only — nothing else written', JSON.stringify(after), before);
  }
  {
    const d = seed(null); const r = await run(d);
    check('run no agentConfig: nothing at all (release all-off)', [r.checked, JSON.stringify(d._data)], [false, JSON.stringify({ waMeta: {} })]);
  }
  {
    const d = seed(CFG('shadow'));
    await withFlag('false', () => run(d, { env: { AGENT_SHADOW_ENABLED: 'false' } }));
    check('run top switch off: nothing', room(d).length, 0);
  }
  {
    // השם על ההזמנה לא ממופה למחירון (השליחה לקחה מחירון כללי) → לא נבדק, לא "כל השורות שגויות"
    const d = seed(CFG('shadow'));
    const r = await run(d, { order: { ...order, orderClient: 'כהן' } });
    check('run: order name does not map to the list → not checked', [r.checked, room(d).length], [false, 0]);
  }
  {
    // שליחה חוזרת (force) — שורה אחת לכל הזמנה
    const d = seed(CFG('shadow'));
    await run(d); await run(d, { now: NOW + 60000 });
    check('run: second send of the same order → still one room row', room(d).length, 1);
  }
  {
    // הרבה שורות שגויות → עד 5 בשורה, ועוד N
    const d = seed(CFG('shadow'));
    const many = Array.from({ length: 8 }, (_, i) => ({ name: 'ש' + i, sku: 'S' + i, ppm2: 1, hsLine: i + 1 }));
    const list = {}; many.forEach(m => { list[m.sku] = 2; });
    await run(d, { preview: many, prices: { clients: { 777: list }, clientKeys: { 777: 'כהן זכוכית' } } });
    const t = room(d)[0].text;
    check('run: up to 5 lines listed + "ועוד 3 שורות"', [(t.match(/שורה \d/g) || []).length, t.includes('ועוד 3 שורות')], [5, true]);
  }
  {
    // הזמנה ידנית על כרטיס מזדמן (בן, 13/11): המחירון לפי priceClient (שם הכרטיס), לא שם הלקוח הפרטי
    const d = seed(CFG('shadow'));
    const r = await run(d, { order: { ...order, source: 'manual', orderClient: 'יוסי כהן', priceClient: 'כהן זכוכית' } });
    check('run: manual order → price list by priceClient', [r.checked, r.mismatches], [true, 2]);
  }
  {
    const d = seed(CFG('off')); await run(d);
    check('run price off: nothing', room(d).length, 0);
  }
  {
    const d = seed(CFG('reply'));
    const r = await run(d, { prices: { clients: { 999: LIST }, clientKeys: { 999: 'אחר' } } });
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
  check('hashavshevet-order: passes the same prices object the send priced with', /lgPriceCheckRun\(db, \{[^}]*prices[^}]*\}/.test(after), true);
  check('hashavshevet-order: the check cannot break the send (try/catch)', /try \{[^}]*lgPriceCheckRun[\s\S]*?\} catch/.test(after), true);

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
