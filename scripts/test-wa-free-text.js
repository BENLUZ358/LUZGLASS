#!/usr/bin/env node
/**
 * הזמנה מהודעת טקסט חופשית בוואטסאפ, לפי לקוח (בן, 26/10).
 * אפיון: docs/superpowers/specs/2026-10-26-wa-free-text-orders-design.md
 *
 *   • "מראה" לבד = מראה 5 מלוטש; אין כמות = 1; שני מספרים = רוחב×גובה בס"מ
 *   • העובי ("מראה 5", "5 מ"מ") אינו מידה; "50*89" זוג מידות, "X2" כמות
 *   • צ'אט רגיל עם מספרים אינו הזמנה; מק"ט לא חד-משמעי נשאר ריק
 *   • רק לקוח שבן הגדיר; תבנית אגן ברזל לא משתנה
 *
 * Run: node scripts/test-wa-free-text.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ft = require(path.join(ROOT, 'api', '_wa-free-text.js'));

const CAT = {
  '5MIRM':  { name: "5 מ''מ מראה מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRH':  { name: "5 מ''מ מראה חתוך", glass: 'מראה', mm: 5, active: true },
  '5MIRBM': { name: "5 מ''מ מראה ברונזה מלוטש", glass: 'מראה ברונזה', mm: 5, proc: 'litush', active: true },
  '5MIRAM': { name: "5 מ''מ מראה אפורה מלוטש", glass: 'מראה אפורה', mm: 5, proc: 'litush', active: true },
  '5MIRR':  { name: "מראה 5 מ''מ עגול מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRS':  { name: "מראה 5 מ''מ צורתית מלוטש", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '5MIRG':  { name: "מראה 5 מ''מ מלוטש גרפיקה", glass: 'מראה', mm: 5, proc: 'litush', active: true },
  '8SM':    { name: "8 מ''מ שקוף מלוטש", glass: 'שקוף', mm: 8, proc: 'litush', active: true },
  '8SH':    { name: "8 מ''מ שקוף חתוך", glass: 'שקוף', mm: 8, active: true },
  '8SMH':   { name: "8 מ''מ שקוף מחוסם", glass: 'שקוף', mm: 8, proc: 'chisum', active: true },
};
// כל השורות של כל הקבוצות, עם המק"ט של הקבוצה — מה שבן יראה בתור
const rows = text => {
  const p = ft.lgWaFreeTextResolve(ft.lgWaFreeTextParse(text), CAT);
  return p.groups.flatMap(g => g.lines.map(l => [l.w, l.h, l.qty, g.sku]));
};

(async () => {

// ═══ 1. הדוגמאות של בן ═══════════════════════════════════════════════
check('ben 1', rows('מה קורה אחי תכין לי בבקשה מראה 5 מ״מ 89 על 123'), [[890, 1230, 1, '5MIRM']]);
check('ben 2', rows('אני צריך מראה 50*89'), [[500, 890, 1, '5MIRM']]);
check('ben 3', rows('מראה 5 76 54 X2'), [[760, 540, 2, '5MIRM']]);
check('ben 4', rows('תכין לי בבקשה מראה 5 מלוטש 70 120'), [[700, 1200, 1, '5MIRM']]);

// ═══ 2. צורות כתיבה ═══════════════════════════════════════════════════
check('variants 70x120', rows('מראה 70x120'), [[700, 1200, 1, '5MIRM']]);
check('variants 70 x 120', rows('מראה 70 x 120'), [[700, 1200, 1, '5MIRM']]);
check('variants x 3 at the end', rows('מראה 5 70 120 x 3'), [[700, 1200, 3, '5MIRM']]);
check("variants 2 יח'", rows("מראה 70 120 2 יח'"), [[700, 1200, 2, '5MIRM']]);
check('variants decimal cm', rows('מראה 70.5 120'), [[705, 1200, 1, '5MIRM']]);

// ═══ 3. צבע ועיבוד ════════════════════════════════════════════════════
check('bronze mirror', rows('מראה ברונזה 60 80'), [[600, 800, 1, '5MIRBM']]);
check('black mirror = grey', rows('מראה שחורה 60 80'), [[600, 800, 1, '5MIRAM']]);
check('cut mirror', rows('מראה חתוך 60 80'), [[600, 800, 1, '5MIRH']]);

// ═══ 4. זכוכית ════════════════════════════════════════════════════════
check('glass with processing', rows('זכוכית 8 שקוף מלוטש 100 על 200'), [[1000, 2000, 1, '8SM']]);
check('glass without processing: sku left empty', rows('זכוכית 8 שקוף 100 על 200'), [[1000, 2000, 1, null]]);

// ═══ 5. כמה פריטים ════════════════════════════════════════════════════
check('product line then size lines', rows('מראה 5\n60 80\n70 90 x2'), [[600, 800, 1, '5MIRM'], [700, 900, 2, '5MIRM']]);

// ═══ 6. לא הזמנה ══════════════════════════════════════════════════════
check('chat with numbers is not an order', ['נדבר מחר ב-10 על 2 דברים', 'מתי מוכן? 3 ימים?', 'מראה יפה תודה', ''].map(ft.lgWaFreeTextIsOrder),
      [false, false, false, false]);
check('an order is an order', ft.lgWaFreeTextIsOrder('מראה 70 120'), true);

// ═══ 7. שורות שלא פוענחו ══════════════════════════════════════════════
{
  const p = ft.lgWaFreeTextParse('מראה 5 60 80\nעוד 30 40 50');
  check('unparsed line is kept aside', [p.groups.flatMap(g => g.lines).length, p.unparsed], [1, ['עוד 30 40 50']]);
}
{
  const p = ft.lgWaFreeTextParse('מראה 500 80');
  check('over 4 m is not an item', [ft.lgWaFreeTextIsOrder('מראה 500 80'), p.unparsed], [false, ['מראה 500 80']]);
}

// ═══ 8. בחירת מק"ט ═══════════════════════════════════════════════════
check('sku: inactive is never chosen',
      ft.lgWaFreeTextSku({ kind: 'mirror', color: '', mm: 5, proc: 'מלוטש' }, { ...CAT, '5MIRM': { ...CAT['5MIRM'], active: false } }), null);
check('sku: two equal matches → none', ft.lgWaFreeTextSku({ kind: 'mirror', color: '', mm: 5, proc: 'מלוטש' },
      { ...CAT, X: { name: "5 מ''מ מראה מלוטש", active: true } }), null);

// ═══ 8b. סקירה סופית — קלטים שיצרו מידות או כמויות שגויות ═══════════
check('R1 spaced X between sizes after a thickness is a pair, not a quantity',
      [rows('מראה 5 70 X 120'), rows('מראה 5 50 x 89'), rows('מראה 5 70 × 120')],
      [[[700, 1200, 1, '5MIRM']], [[500, 890, 1, '5MIRM']], [[700, 1200, 1, '5MIRM']]]);
check('R1 X2 at the end is still a quantity', rows('מראה 5 76 54 X2'), [[760, 540, 2, '5MIRM']]);
check('R2 questions, prices, stock and cancellations are not orders',
      ['כמה עולה מראה 80 על 120?', 'יש לכם מראה 80 על 120 במלאי', 'המראה 80 על 120 שהזמנתי מוכנה', 'מראה 80 על 120 בוטל',
       'שלום, אני יכול לבוא ב 10 30 לקחת את המראה?', 'בקשר לזכוכית שהזמנתי, 10 בבוקר 2 משטחים', 'מה המחיר של מראה 80 120'].map(ft.lgWaFreeTextIsOrder),
      [false, false, false, false, false, false, false]);
check('R3 metres, decimals and tiny sizes are not read as cm',
      ['מראה 2 על 3 מטר', 'מראה 1.20 על 0.80', 'מראה 0 0', 'מראה 70 5'].map(ft.lgWaFreeTextIsOrder), [false, false, false, false]);
check('R4 a door frame (משקוף) is not glass', ft.lgWaFreeTextIsOrder('משקוף 80 200'), false);
check('R4 but "זכוכית שקופה" and "לזכוכית" still are', [ft.lgWaFreeTextIsOrder('זכוכית שקופה 80 200'), ft.lgWaFreeTextIsOrder('לזכוכית 8 שקוף 80 200')], [true, true]);
check('R5 a wedding is not "cut"', rows('מראה לחתונה 70 120'), [[700, 1200, 1, '5MIRM']]);
check('R5 "חתוכה" still is', rows('מראה חתוכה 70 120'), [[700, 1200, 1, '5MIRH']]);
check('R7 an absurd quantity is not an item', ft.lgWaFreeTextIsOrder('מראה 70 120 x500'), false);

// ═══ 9. הקליטה — רק לקוח שבן הגדיר ═══════════════════════════════════
const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const NOW = 1761490000000;
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs',
              GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0501234567' };
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const textHook = (id, text, chatId) => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: NOW / 1000,
  idMessage: id, senderData: { chatId: chatId || '972501234567@c.us', sender: chatId || '972501234567@c.us', chatName: 'x' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: text } } });
const send = async (db, body) => {
  const later = [];
  const r = await withEnv(ENV, () => hook.handleInbound({ method: 'POST', headers: { authorization: 'Bearer hs' }, body },
    { db, waitUntil: p => later.push(p), now: NOW }));
  await Promise.all(later);
  return r;
};
const seed = extra => fakeDb({ meta: { orderCounter: 1200 },
  users: { '0501234567': { name: 'מראות כהן', businessName: 'מראות כהן', customerId: '888', role: 'client' } },
  hashavshevetAccounts: { '888': { key: '888', name: 'מראות כהן', phone: '0501234567' } },
  skuCatalog: CAT, ...(extra || {}) });
const ON = { waTextCustomers: { '888': { customerName: 'מראות כהן', addedAt: NOW - 1, addedBy: 'ben' } } };
const order = (db, id) => ((db._data.orders || {})['wa_' + id + '_1']) || {};
{
  const db = seed(ON);
  const r = await send(db, textHook('F1', 'תכין לי מראה 5 70 120 x2'));
  const o = order(db, 'F1');
  check('9a enabled customer: free text opens an order', [r.status, r.body.recorded], [200, true]);
  check('9a with the rows filled', [(o.items || []).length, o.items && o.items[0].sku, o.items && o.items[0].w, o.items && o.items[0].h],
        [2, '5MIRM', 700, 1200]);
  check('9a named and marked as a text order', [o.sketchName, o.waText, o.customerId], ['הודעת טקסט', true, '888']);
}
{
  const db = seed();
  const r = await send(db, textHook('F2', 'תכין לי מראה 5 70 120 x2'));
  check('9b customer not enabled: nothing recorded', [r.body.ignored, db._data.waInbound], ['text not enabled', undefined]);
}
{
  // R6: מספר זר שכותב "כמה עולה מראה" לא מעלה את מונה הקליטות
  const db = seed();
  const r = await send(db, textHook('F8', 'מראה 70 120', '972549998877@c.us'));
  check('R6 unknown sender with free text: ignored, not added to "new numbers"',
        [r.body.ignored, ((db._data.waMeta || {}).sendersSeen || {})['0549998877']], ['sender', undefined]);
}
{
  const db = seed(ON);
  await send(db, textHook('F3', 'מראה 5 60 80\nעוד 30 40 50'));
  check('9c an unparsed line goes to the notes', order(db, 'F3').notes, 'לא פוענח: עוד 30 40 50');
}
{
  const db = seed(ON);
  await send(db, textHook('F4', 'זכוכית 8 שקוף 100 על 200'));
  const it = (order(db, 'F4').items || [])[0] || {};
  check('9d unclear sku: the order opens, the row waits for a sku', [it.skuMissing, it.w], [true, 1000]);
}
{
  const db = seed(ON);
  const r = await send(db, textHook('F5', 'מתי מוכן? 3 ימים?'));
  check('9e plain chat from an enabled customer: nothing', [r.body.ignored, db._data.waInbound], ['not a sketch', undefined]);
}
{
  const MSG = 'הזמנת מראות מרכזת מס\' PHR#26037\nמראה ללא מסגרת לפי מידה\n90/145 ס"מ — כמות: 2';
  const db = seed();
  const r = await send(db, textHook('F6', MSG));
  check('9f Agan format needs no flag and is unchanged', [r.body.recorded, order(db, 'F6').sketchName], [true, 'PHR#26037']);
}
{
  const G = '120363041234567890@g.us';
  const p = require(path.join(ROOT, 'api', '_wa-inbound.js')).lgWaInboundParse({ ...textHook('F7', 'מראה 70 120'),
    senderData: { chatId: G, sender: '972501234567@c.us', chatName: 'g' } });
  check('9g text in a group is still not read', [p.action, p.reason], ['ignore', 'not a sketch']);
}

// ═══ 10. הגדרת לקוח — רק דרך ה-endpoint האדמיני ══════════════════════
{
  const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
  const db = seed();
  const act = b => adm.handleAdmin({ channel: 'whatsapp', ...b }, { db, by: '0520000000', now: NOW + 9 });
  const r = await act({ action: 'text-customer-add', customerId: '888' });
  check('10a add writes the flag with the card name', [r.ok, db._data.waTextCustomers['888']],
        [true, { customerName: 'מראות כהן', addedAt: NOW + 9, addedBy: '0520000000' }]);
  check('10b add refuses an unknown card', (await act({ action: 'text-customer-add', customerId: '777' })).code, 'unknown-customer');
  check('10b and a malformed key', (await act({ action: 'text-customer-add', customerId: '../x' })).code, 'unknown-customer');
  const d = await act({ action: 'text-customer-remove', customerId: '888' });
  check('10c remove deletes it', [d.ok, (db._data.waTextCustomers || {})['888']], [true, undefined]);
  check('10d removing again: not enabled', (await act({ action: 'text-customer-remove', customerId: '888' })).code, 'not-enabled');
  const rules = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  check('10e rules: admin read only, browser cannot write',
        [rules.waTextCustomers && rules.waTextCustomers['.read'], rules.waTextCustomers && rules.waTextCustomers['.write']], [rules.waGroups['.read'], false]);
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
