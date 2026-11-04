#!/usr/bin/env node
/**
 * בן, 2/11: כל מה שמגיע מהמייל מכתובת מקושרת — "טופל" לבד.
 *
 *   A. מייל מכתובת מקושרת → ההזמנות מסומנות "סקיצה טופלה" (sketchSeenAt),
 *      והודעת "הסקיצות טופלו" נכנסת לתור המייל — כאילו בן לחץ על הכפתור.
 *      התשובה לסקריפט אומרת autoHandled, כדי שיוציא את המייל מהדואר הנכנס.
 *   B. כתובת שמזוהה רק לפי המייל בכרטיס (לא קושרה מהקליטות) → כמו היום:
 *      לא מסומן, לא נשלח כלום.
 *   C. אותו מייל פעמיים (הסקריפט נפל אחרי שהשרת סיים) → אין הודעה שנייה.
 *   D. תור המייל נכשל → הקליטה עצמה לא נכשלת; ההזמנות נשארות טופלו, ושורת
 *      "ממתינים לעדכון" בתור תציע לשלוח.
 *
 * Run: node scripts/test-email-auto-handled.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

process.env.EMAIL_ONLY_TO = 'dana@client.co.il';

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const em = require(path.join(ROOT, 'api', '_email-inbound.js'));

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 7)]);
const NOW = 1760950005000;

const seed = linked => fakeDb({
  meta: { orderCounter: 1041 },
  hashavshevetAccounts: { '07': { key: '07', name: 'פלג מקלחונים', phone: '050-1234567', email: 'dana@client.co.il' } },
  waMeta: linked ? { emailSenders: { 'dana@client,co,il': { email: 'dana@client.co.il', customerId: '07', customerName: 'פלג מקלחונים' } } } : {},
});

async function receive(db, messageId, n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    await em.lgEmailPutChunk(db, { messageId, idx: i, chunk: 0, chunks: 1, data: PNG.toString('base64') });
    parts.push({ idx: i, name: 's' + i + '.png', mime: 'image/png', size: PNG.length, chunks: 1 });
  }
  return em.lgEmailCommit(db, { messageId, threadId: 'T-' + messageId, from: '"Dana" <dana@client.co.il>',
                                subject: 'הזמנה', date: NOW - 5000, parts }, { by: 'gmail-script', now: NOW });
}
const outbox = db => Object.values((db._data.waMeta || {}).emailOutbox || {});

(async () => {
  {
    const db = seed(true);
    const r = await receive(db, 'M1', 2);
    check('A1 intake still done', r.state, 'done');
    check('A2 the answer says auto-handled', r.autoHandled, true);
    const o = db._data.orders;
    check('A3 every order is marked handled', r.orderIds.map(id => o[id].sketchSeenAt), [NOW, NOW]);
    check('A4 marked by the automatic rule', r.orderIds.map(id => o[id].sketchSeenBy), ['email-auto', 'email-auto']);
    const q = outbox(db);
    check('A5 one "handled" reply queued', q.map(x => [x.kind, x.state, x.email]), [['sketches-handled', 'pending', 'dana@client.co.il']]);
    check('A6 it covers both orders', (q[0] || {}).orderIds, r.orderIds);
    check('A7 it answers the customer\'s own message', (q[0] || {}).messageId, 'M1');

    // C — the script retries a message the server already finished
    const again = await receive(db, 'M1', 2);
    check('C1 a repeat is still done', again.state, 'done');
    check('C2 no second reply', outbox(db).length, 1);
    check('C3 the repeat answer still says auto-handled (so the script archives it)', again.autoHandled, true);
  }
  {
    const db = seed(false);
    const r = await receive(db, 'M2', 1);
    check('B1 card-email match is still taken in', r.state, 'done');
    check('B2 not auto-handled', !!r.autoHandled, false);
    check('B3 order not marked', db._data.orders[r.orderIds[0]].sketchSeenAt, undefined);
    check('B4 nothing queued', outbox(db).length, 0);
  }
  {
    const db = seed(true);
    process.env.EMAIL_ONLY_TO = 'someone-else@x.com';   // the send gate refuses
    const r = await receive(db, 'M3', 1);
    process.env.EMAIL_ONLY_TO = 'dana@client.co.il';
    check('D1 intake still done', r.state, 'done');
    check('D2 order still marked handled', db._data.orders[r.orderIds[0]].sketchSeenAt, NOW);
    check('D3 nothing queued', outbox(db).length, 0);
    check('D4 not reported as auto-handled (mail stays in the inbox)', !!r.autoHandled, false);
  }

  {
    //  E — needs Ben: an attachment that could not be read → not auto-handled
    const db = seed(true);
    await em.lgEmailPutChunk(db, { messageId: 'M4', idx: 0, chunk: 0, chunks: 1, data: PNG.toString('base64') });
    await em.lgEmailPutChunk(db, { messageId: 'M4', idx: 1, chunk: 0, chunks: 1, data: Buffer.from('not an image at all').toString('base64') });
    const r = await em.lgEmailCommit(db, { messageId: 'M4', threadId: 'T-M4', from: 'dana@client.co.il', subject: '', date: NOW,
      parts: [{ idx: 0, name: 'a.png', mime: 'image/png', size: PNG.length, chunks: 1 }, { idx: 1, name: 'b.heic', mime: 'image/heic', size: 19, chunks: 1 }] },
      { by: 'gmail-script', now: NOW });
    check('E1 intake done', r.state, 'done');
    check('E2 a skipped file → left for Ben', !!r.autoHandled, false);
    check('E3 order not marked', db._data.orders[r.orderIds[0]].sketchSeenAt, undefined);
  }

  {
    //  F — אביבי (בן, 4/11): הזמנת רכש מכרטיס 450 → נוסח "ההזמנה התקבלה ואושרה",
    //  ותשובה שיוצאת רק אחרי דקה (הריצה הבאה של הסקריפט), ואז לארכיון.
    const { PAGE } = require('./_po-fixture.js');
    const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
    const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(40, 3)]);
    const avivi = (pages, card) => {
      const db = fakeDb({
        meta: { orderCounter: 1041 },
        hashavshevetAccounts: { [card]: { key: card, name: 'יצחק אביבי ייצור', email: 'po@avivi.co.il' } },
        skuCatalog: { '8CM': { name: '8 מ"מ קליר מלוטש', glass: 'קליר', mm: 8, proc: 'litush' } },
        waMeta: { emailSenders: { 'po@avivi,co,il': { email: 'po@avivi.co.il', customerId: card, customerName: 'יצחק אביבי ייצור' } } },
      });
      return { db, run: async id => {
        await em.lgEmailPutChunk(db, { messageId: id, idx: 0, chunk: 0, chunks: 1, data: Buffer.from('%PDF-1.7 stub').toString('base64') });
        return em.lgEmailCommit(db, { messageId: id, threadId: 'T-' + id, from: 'po@avivi.co.il', subject: 'הזמנת רכש', date: NOW,
          parts: [{ idx: 0, name: 'PO.pdf', mime: 'application/pdf', size: 13, chunks: 1 }] },
          { by: 'gmail-script', now: NOW, pdfToJpegs: async () => pages.map(t => ({ bytes: JPEG, w: 1, h: 1, text: t })) });
      } };
    };
    process.env.EMAIL_ONLY_TO = 'po@avivi.co.il';

    const a = avivi([PAGE], '450');
    const r = await a.run('P1');
    check('F1 Avivi PO → done; not archived at intake (only after the reply)', [r.state, !!r.autoHandled], ['done', false]);
    check('F1b the repeat answer does not archive either', !!(await a.run('P1')).autoHandled, false);
    check('F2 the order is marked handled', a.db._data.orders[r.orderIds[0]].sketchSeenAt, NOW);
    const q = outbox(a.db)[0] || {};
    check('F3 queued with the PO wording and a one-minute wait', [q.variant, q.notBefore], ['po', NOW + 60000]);
    check('F4 not sent in the same run (before the minute)', (await ob.lgEmailClaim(a.db, 5, NOW + 5000)).length, 0);
    const later = await ob.lgEmailClaim(a.db, 5, NOW + 61000);
    check('F5 sent in the next run', later.length, 1);
    check('F6 the text Ben approved', (later[0] || {}).text,
      'שלום יצחק אביבי ייצור,\n\nההזמנה שלכם התקבלה ואושרה, אנחנו מטפלים בה.\n• PO26H016504\n\nלוז זגגות ומראות האחים בע"מ');
    check('F7 the mail goes to the archive after the reply', (later[0] || {}).doneMails, ['P1']);

    //  שני עמודים של אותה הזמנה → מספר ההזמנה פעם אחת
    const b = avivi([PAGE, PAGE], '450');
    await b.run('P2');
    const t2 = ((await ob.lgEmailClaim(b.db, 5, NOW + 61000))[0] || {}).text || '';
    check('F8 two pages of one PO → the number once', (t2.match(/PO26H016504/g) || []).length, 1);

    //  אותה הזמנת רכש מכרטיס אחר → "הסקיצות טופלו" הרגיל, מיד
    const c = avivi([PAGE], '07');
    await c.run('P3');
    const qc = outbox(c.db)[0] || {};
    check('F9 another card → usual wording, no wait', [qc.variant, qc.notBefore], [null, null]);
    check('F10 …and it goes out in the same run', (await ob.lgEmailClaim(c.db, 5, NOW)).map(x => /סקיצה אחת אושרה/.test(x.text)), [true]);
    process.env.EMAIL_ONLY_TO = 'dana@client.co.il';
  }

  if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
