#!/usr/bin/env node
/**
 * קליטות WhatsApp — שלב 3: פאנל קליטות, "נסה שוב", "טופל ידנית", ועיבוד
 * כשהאדמין פתוח.
 *
 * הדרישות של בן (2026-10-06), וכל אחת נבדקת כאן:
 *
 *   • "נסה שוב" משתמש באותה קליטה — לא inbound חדש ולא הזמנה כפולה.
 *     אם כבר נוצרה הזמנה, retry לא יוצר עוד אחת.
 *   • "טופל ידנית" הוא סימון עם audit. הרשומה לא נמחקת.
 *   • כמה כרטיסי לקוח עם אותו מספר — לא מנחשים, והפאנל אומר למה.
 *   • PDF / קובץ לא נתמך מופיע בבירור.
 *   • העיבוד מהאדמין הוא רשת ביטחון לאותו תור — אותה תפיסה, לא מנגנון שני.
 *   • idempotency: רענון, retry כפול, שתי לשוניות, רקע + אדמין במקביל.
 *
 * Run: node scripts/test-wa-inbound-panel.js
 */
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const inb   = require(path.join(ROOT, 'api', '_wa-inbound.js'));
const drain = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

// ─── עזרים ──────────────────────────────────────────────────────────
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const okFetch = (calls) => async (url) => {
  calls && calls.push(url);
  return { ok: true, status: 200, headers: { get: () => String(JPEG.length) },
           arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) };
};
const badFetch = (status) => async () => ({ ok: false, status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });

const NOW = 1759650005000;
const entry = (id, over = {}) => ({
  idMessage: id, chatId: '972501234567@c.us', sender: '0501234567', typeMessage: 'imageMessage',
  kind: 'image', caption: 'מקלחון', fileName: 'a.jpg', mimeType: 'image/jpeg',
  downloadUrl: 'https://do-media.green-api.com/x/' + id + '.jpg', timestamp: NOW - 5000, ...over,
});
const seed = (extra) => fakeDb({
  meta: { orderCounter: 1041 },
  users: { '0501234567': { name: 'דנה', businessName: 'המקום לאמבט', customerId: '14201' } },
  ...(extra || {}),
});
const orders = db => Object.keys(db._data.orders || {});
const rec = (db, k) => (db._data.waInbound || {})[k];
const act = (db, body, over = {}) => drain.handleAdmin(body, { db, by: '0520000000', now: NOW + 10, fetchImpl: okFetch(), ...over });

(async () => {

// ═══ G. "נסה שוב" ════════════════════════════════════════════════════
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('R1'), NOW);
    for (let i = 0; i < 3; i++) await inb.lgWaInboundProcess(db, 'R1', { fetchImpl: badFetch(500), now: NOW + i, by: 'bg' });
    await inb.lgWaInboundProcess(db, 'R1', { fetchImpl: badFetch(500), now: NOW + 4, by: 'bg' });
    check('G1 three failures stop on their own (dead)', rec(db, 'R1').state, 'dead');

    const r = await act(db, { action: 'retry', key: 'R1' });
    check('G1 retry works on the same record and creates the order', [r.ok, orders(db)], [true, ['wa_R1_1']]);
    check('G1 no second inbound record was created', Object.keys(db._data.waInbound), ['R1']);
    const a = Object.values(rec(db, 'R1').audit || {});
    check('G1 the retry is audited with who and from which state',
          a.map(x => [x.action, x.by, x.from]), [['retry', '0520000000', 'dead']]);

    const again = await act(db, { action: 'retry', key: 'R1' });
    check('G2 retry after an order exists is refused', [again.ok, again.code], [false, 'done']);
    check('G2 and says which order already exists', /L1042/.test(again.message), true);
    check('G2 still one order and one order number', [orders(db).length, db._data.meta.orderCounter], [1, 1042]);
  }

  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('R2'), NOW);
    await inb.lgWaInboundProcess(db, 'R2', { fetchImpl: badFetch(502), now: NOW + 1, by: 'bg' });
    const [x, y] = await Promise.all([act(db, { action: 'retry', key: 'R2' }), act(db, { action: 'retry', key: 'R2' })]);
    check('G3 retry clicked twice creates exactly one order', orders(db), ['wa_R2_1']);
    check('G3 and only one of the two clicks did the work', [x.ok, y.ok].filter(Boolean).length, 1);
    check('G3 one order number spent', db._data.meta.orderCounter, 1042);
  }

  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('PDF', { kind: 'pdf', typeMessage: 'documentMessage', mimeType: 'application/pdf' }), NOW);
    const r = await act(db, { action: 'retry', key: 'PDF' });
    check('G4 retrying an unsupported PDF is refused, with the reason', [r.ok, r.code, /PDF/.test(r.message)], [false, 'rejected', true]);
    check('G4 and changes nothing', [rec(db, 'PDF').state, rec(db, 'PDF').audit], ['rejected', undefined]);

    await inb.lgWaInboundRecord(db, entry('OLD'), NOW - 25 * 3600 * 1000);
    await inb.lgWaInboundProcess(db, 'OLD', { fetchImpl: badFetch(500), now: NOW - 25 * 3600 * 1000 + 1, by: 'bg' });
    const o = await act(db, { action: 'retry', key: 'OLD' });
    check('G4 a message older than 24h cannot be retried — the file is gone', [o.ok, o.code], [false, 'expired']);

    const missing = await act(db, { action: 'retry', key: 'NOPE' });
    check('G4 retrying a record that does not exist is refused', [missing.ok, missing.code], [false, 'missing']);
  }

// ═══ H. רקע + אדמין, שתי לשוניות, תפיסה שפגה ═════════════════════════
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('P1'), NOW);
    await Promise.all([
      inb.lgWaInboundProcess(db, 'P1', { fetchImpl: okFetch(), now: NOW + 1, by: 'webhook' }),
      act(db, { action: 'drain' }),
      act(db, { action: 'drain' }),
    ]);
    check('H1 background + two admin tabs at once → one order', orders(db), ['wa_P1_1']);
    check('H1 one order number', db._data.meta.orderCounter, 1042);
  }

  {
    // A תופס ונתקע. אחרי שהתפיסה פגה B מסיים. A מתעורר ומנסה לכתוב.
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('S1'), NOW);
    let releaseA;
    const gate = new Promise(r => { releaseA = r; });
    const slowFetch = async (url) => { await gate; return okFetch()(url); };
    const pA = inb.lgWaInboundProcess(db, 'S1', { fetchImpl: slowFetch, now: NOW + 1, by: 'A' });
    await new Promise(r => setImmediate(r));
    const later = NOW + 1 + inb.CLAIM_TTL_MS + 1;
    const rB = await inb.lgWaInboundProcess(db, 'S1', { fetchImpl: okFetch(), now: later, by: 'B' });
    check('H2 after a claim expires another processor may finish the job', rB.ok, true);
    db._data.orders.wa_S1_1.sketchSeenAt = 123;          // מישהו כבר עבר על הסקיצה
    releaseA();
    const rA = await pA;
    check('H2 the stale processor is told it lost the claim', [rA.ok, rA.reason], [false, 'lost-claim']);
    check('H2 and it overwrites nothing — the review mark survives', db._data.orders.wa_S1_1.sketchSeenAt, 123);
    check('H2 the record stays done', rec(db, 'S1').state, 'done');
    check('H2 still one order', orders(db), ['wa_S1_1']);
  }

  {
    // אותו דבר, אבל המעבד הישן נכשל — אסור לו להפוך done ל-failed
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('S2'), NOW);
    let releaseA;
    const gate = new Promise(r => { releaseA = r; });
    const pA = inb.lgWaInboundProcess(db, 'S2', { fetchImpl: async () => { await gate; return badFetch(500)(); }, now: NOW + 1, by: 'A' });
    await new Promise(r => setImmediate(r));
    await inb.lgWaInboundProcess(db, 'S2', { fetchImpl: okFetch(), now: NOW + 1 + inb.CLAIM_TTL_MS + 1, by: 'B' });
    releaseA(); await pA;
    check('H3 a stale failure cannot turn a finished record back into failed', rec(db, 'S2').state, 'done');
  }

  {
    // רענון הדף = drain נוסף. שום דבר לא זז.
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('F1'), NOW);
    await act(db, { action: 'drain' });
    const before = JSON.stringify(db._data);
    const r = await act(db, { action: 'drain' });
    check('H4 a drain after everything is done processes nothing', [r.ok, r.processed], [true, 0]);
    check('H4 and writes nothing', JSON.stringify(db._data) === before, true);
  }

// ═══ I. התור של ה-drain ═════════════════════════════════════════════
  {
    const T = NOW;
    const db = fakeDb({ waInbound: {
      a: { state: 'received',   createdAt: T + 3, attempts: 0 },
      b: { state: 'failed',     createdAt: T + 1, attempts: 1 },
      c: { state: 'failed',     createdAt: T + 2, attempts: 3 },
      d: { state: 'processing', createdAt: T + 0, attempts: 1, claimedAt: T + 100 },
      e: { state: 'processing', createdAt: T + 4, attempts: 1, claimedAt: T - inb.CLAIM_TTL_MS - 5 },
      f: { state: 'done',       createdAt: T + 5 },
      g: { state: 'closed',     createdAt: T + 6 },
      h: { state: 'rejected',   createdAt: T + 7 },
      i: { state: 'dead',       createdAt: T + 8 },
    } });
    check('I1 pending = received, retryable failed and abandoned claims, oldest first',
          await inb.lgWaInboundPending(db, 10, T + 200), ['b', 'a', 'e']);
    check('I1 failed with no attempts left is picked up so it can be marked dead',
          (await inb.lgWaInboundPending(db, 10, T + 200, { includeExhausted: true })).includes('c'), true);
  }

// ═══ J. "טופל ידנית" ═════════════════════════════════════════════════
  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('X1'), NOW);
    await inb.lgWaInboundProcess(db, 'X1', { fetchImpl: badFetch(500), now: NOW + 1, by: 'bg' });
    const r = await act(db, { action: 'close', key: 'X1', note: 'ביקשתי מהלקוח לשלוח שוב' });
    const x = rec(db, 'X1');
    check('J1 marking handled closes the record', [r.ok, x.state], [true, 'closed']);
    check('J1 the record is kept, with what it was', [x.idMessage, x.closedFrom, x.closedNote, x.closedBy],
          ['X1', 'failed', 'ביקשתי מהלקוח לשלוח שוב', '0520000000']);
    check('J1 audited', Object.values(x.audit).map(a => [a.action, a.from, a.to, a.note]),
          [['close', 'failed', 'closed', 'ביקשתי מהלקוח לשלוח שוב']]);

    const twice = await act(db, { action: 'close', key: 'X1', note: 'שוב' });
    check('J2 marking twice is refused and adds no audit line', [twice.ok, Object.keys(rec(db, 'X1').audit).length], [false, 1]);
    const rt = await act(db, { action: 'retry', key: 'X1' });
    check('J2 a closed record cannot be retried', [rt.ok, rt.code], [false, 'closed']);
    const dr = await act(db, { action: 'drain' });
    check('J2 nor picked up by the drain', [dr.processed, orders(db)], [0, []]);
  }

  {
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('X2'), NOW);
    await inb.lgWaInboundClaim(db, 'X2', 'bg', NOW + 5);
    const r = await act(db, { action: 'close', key: 'X2', note: '' });
    check('J3 a record being processed right now cannot be closed', [r.ok, r.code], [false, 'processing']);
  }

  {
    // הזמנה כבר קיימת אבל הלקוח לא זוהה — "טופל" מסמן, לא משנה מצב ולא נוגע בהזמנה
    const db = seed();
    await inb.lgWaInboundRecord(db, entry('X3', { chatId: '972549999999@c.us', sender: '0549999999' }), NOW);
    await inb.lgWaInboundProcess(db, 'X3', { fetchImpl: okFetch(), now: NOW + 1, by: 'bg' });
    const before = JSON.stringify(db._data.orders);
    const r = await act(db, { action: 'close', key: 'X3', note: 'שויך ביד' });
    const x = rec(db, 'X3');
    check('J4 a finished-but-unassigned intake is marked handled, and stays done',
          [r.ok, x.state, x.handled && x.handled.by, x.handled && x.handled.note], [true, 'done', '0520000000', 'שויך ביד']);
    check('J4 the order itself is untouched', JSON.stringify(db._data.orders) === before, true);
  }

  check('J5 a note is capped', (await (async () => {
    const db = seed(); await inb.lgWaInboundRecord(db, entry('X4', { kind: 'pdf' }), NOW);
    await act(db, { action: 'close', key: 'X4', note: 'א'.repeat(900) });
    return rec(db, 'X4').closedNote.length;
  })()), 300);

// ═══ K. כמה כרטיסים לאותו מספר ════════════════════════════════════════
  {
    const db = fakeDb({ meta: { orderCounter: 1 }, hashavshevetAccounts: {
      '14400': { key: '14400', name: 'שותף א', phone: '053-333-4444' },
      '14401': { key: '14401', name: 'שותף ב', phone: '0533334444' },
    } });
    await inb.lgWaInboundRecord(db, entry('AMB', { chatId: '972533334444@c.us', sender: '0533334444' }), NOW);
    await inb.lgWaInboundProcess(db, 'AMB', { fetchImpl: okFetch(), now: NOW + 1, by: 'bg' });
    check('K1 the ambiguity is recorded, not guessed', rec(db, 'AMB').clientMatch,
          { via: 'ambiguous', customerId: '', name: '', candidates: 2 });
    check('K1 and the order waits for a person', [db._data.orders.wa_AMB_1.waUnassigned, db._data.orders.wa_AMB_1.customerId], [true, '']);
  }

// ═══ L. הפאנל — מה בן רואה ═══════════════════════════════════════════
  const ctx = { console, Date, Intl };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8'), ctx);
  const row = (k, r) => ctx.lgWaInRow(k, r, NOW + 60000);

  {
    const r = row('A', { state: 'failed', attempts: 2, createdAt: NOW, timestamp: NOW - 1000, sender: '0501234567',
                         kind: 'image', typeMessage: 'imageMessage', lastError: 'הורדת הקובץ נכשלה — HTTP 502',
                         downloadUrl: 'https://do-media.green-api.com/x.jpg' });
    check('L1 a failed row shows sender, type, status, reason and attempts',
          [r.sender, r.kindLabel, r.statusLabel, r.reason, r.attemptsText],
          ['050-1234567', 'תמונה', 'נכשל — ינוסה שוב', 'הורדת הקובץ נכשלה — HTTP 502', '2 / 3']);
    check('L1 it needs attention, can be retried and closed', [r.needsAttention, r.canRetry, r.canClose], [true, true, true]);
    check('L1 the original file can be opened while GREEN API still holds it', r.view, { type: 'link', url: 'https://do-media.green-api.com/x.jpg' });
    check('L1 the date is shown in Israel time', /\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(r.atText) && /\d{2}:\d{2}/.test(r.atText), true);
  }
  {
    const r = row('B', { state: 'rejected', kind: 'pdf', typeMessage: 'documentMessage', sender: '0501234567', createdAt: NOW,
                         reason: 'PDF עדיין לא נתמך — לטפל ידנית ב-WhatsApp', fileName: 'מקלחון.pdf' });
    check('L2 a PDF is shown plainly as a PDF that was not taken in',
          [r.kindLabel, r.statusLabel, r.reason, r.needsAttention, r.canRetry], ['PDF', 'לא נקלט', 'PDF עדיין לא נתמך — לטפל ידנית ב-WhatsApp', true, false]);
    check('L2 with the file name, and a way to open the chat', [r.fileName, r.view], ['מקלחון.pdf', { type: 'chat', url: 'https://wa.me/972501234567' }]);
  }
  {
    const r = row('C', { state: 'done', kind: 'image', sender: '0533334444', createdAt: NOW, refNum: 'L1050', orderIds: ['wa_C_1'],
                         clientMatch: { via: 'ambiguous', customerId: '', name: '', candidates: 2 } });
    check('L3 an ambiguous sender shows the order and the reason it was not assigned',
          [r.orderNum, r.client, r.needsAttention, r.reason],
          ['L1050', 'לא שויך', true, 'המספר מופיע ב-2 כרטיסי לקוח — לא שויך אוטומטית. צריך לשייך ביד.']);
    check('L3 the sketch itself can be viewed', r.view, { type: 'sketch', orderId: 'wa_C_1' });
    check('L3 an order that exists cannot be retried', r.canRetry, false);
  }
  {
    const r = row('D', { state: 'done', kind: 'image', sender: '0501234567', createdAt: NOW, refNum: 'L1051', orderIds: ['wa_D_1'],
                         clientMatch: { via: 'users', customerId: '14201', name: 'המקום לאמבט' } });
    check('L4 a clean intake shows the client and needs nothing', [r.client, r.statusLabel, r.needsAttention], ['המקום לאמבט', 'נקלט', false]);
  }
  {
    const r = row('E', { state: 'closed', closedFrom: 'dead', closedBy: '0520000000', closedAt: NOW, closedNote: 'ביקשתי שוב', createdAt: NOW, kind: 'image', sender: '0501234567' });
    check('L5 a closed row says who closed it and why', [r.statusLabel, /ביקשתי שוב/.test(r.reason), /052-0000000/.test(r.reason), r.needsAttention, r.canClose],
          ['טופל ידנית', true, true, false, false]);
  }
  {
    const r = row('F', { state: 'failed', attempts: 1, createdAt: NOW, kind: 'image', sender: '0501234567', lastError: 'fetch failed' });
    check('L6 a raw network error is translated for a person', r.reason, 'תקלת רשת בהורדה מ-GREEN API');
  }
  {
    const r = row('G', { state: 'done', kind: 'image', sender: '0501234567', createdAt: NOW, refNum: 'L1', orderIds: ['wa_G_1'], oversize: true, sizeBytes: 1200000,
                         clientMatch: { via: 'users', customerId: '1', name: 'x' } });
    check('L7 an oversized image is flagged for a look', [r.needsAttention, /גדולה/.test(r.reason)], [true, true]);
  }
  {
    const evil = row('H', { state: 'failed', attempts: 1, createdAt: NOW, kind: 'image', sender: '0501234567', downloadUrl: 'javascript:alert(1)' });
    check('L8 only an https link is ever offered', evil.view.type, 'chat');
    const t = ctx.lgWaInRowHtml(row('I', { state: 'failed', attempts: 1, createdAt: NOW, kind: 'image', sender: '0501234567',
                                          caption: '<img src=x onerror=alert(1)>', lastError: '<b>x</b>' }));
    check('L8 captions and errors are escaped in the HTML', /<img src=x|<b>x/.test(t), false);
  }
  {
    const rows = [
      row('a', { state: 'failed', attempts: 1, createdAt: NOW }),
      row('b', { state: 'received', createdAt: NOW }),
      row('c', { state: 'processing', createdAt: NOW, claimedAt: NOW }),
      row('d', { state: 'done', createdAt: NOW, clientMatch: { via: 'users' } }),
      row('e', { state: 'closed', createdAt: NOW }),
      row('f', { state: 'rejected', createdAt: NOW }),
    ];
    check('L9 the badge counts what needs a person, and what is still in progress',
          JSON.parse(JSON.stringify(ctx.lgWaInCounts(rows))), { attention: 2, inProgress: 2 });
  }

// ═══ M. גבולות ═══════════════════════════════════════════════════════
  {
    const P = fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8');
    check('M1 the panel never writes waInbound directly — only through the admin endpoint',
          /ref\(\s*['"`]waInbound[^)]*\)\s*\.(set|update|remove|push|transaction)/.test(P), false);
    check('M1 and loads the sketch only through the sketch layer', /\.sketch\b|files\.f0/.test(P), false);
    const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    check('M2 admin.html loads the panel', /<script src="wa-inbound-panel\.js"><\/script>/.test(A), true);
    check('M2 and the queue has the intake button', /id="waInBtn"/.test(A), true);
    const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    check('M3 the admin endpoint has room to process a few images', ((VJ.functions || {})['api/wa-inbound-drain.js'] || {}).maxDuration >= 30, true);
    const fns = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    check('M3 still within the Hobby limit of 12 functions', fns.length <= 12, true);
    const D = fs.readFileSync(path.join(ROOT, 'api', 'wa-inbound-drain.js'), 'utf8');
    check('M4 the admin endpoint checks the admin before anything else', /verifyAdmin\(req\)/.test(D), true);
    check('M4 and processes through the same claim as the webhook', /lgWaInboundProcess/.test(D) && !/lgWaInboundClaim\(/.test(D), true);
  }
  {
    const r = await drain.handleAdmin({ action: 'nuke', key: 'x' }, { db: seed(), by: 'a', now: NOW });
    check('M5 an unknown action is refused', [r.ok, r.code], [false, 'bad-action']);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll WhatsApp intake-panel checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
