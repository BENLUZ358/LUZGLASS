#!/usr/bin/env node
/**
 * משלוחים לשרטט (בן, 10/11) — סל, משלוח, "השרטט סיים", קובץ PDF.
 * אפיון: docs/superpowers/specs/2026-11-10-drafter-pdf-batches-design.md
 *
 * Run: node scripts/test-drafter-batch.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

let D = {};
try { D = require(path.join(ROOT, 'api', '_drafter-batch.js')); }
catch (e) { console.error('FAIL  load _drafter-batch: ' + e.message); failed++; }

const NOW = 1762770000000;
const o = (id, stage, extra) => ({ id, orderNum: 'L' + id.replace(/\D/g, ''), orderClient: 'לקוח ' + id,
  sketchName: 'סקיצה ' + id, stage, createdAt: NOW - 1000, ...(extra || {}) });
const seed = (extra, top) => fakeDb({ ...(top || {}), orders: {
  A1: o('A1', 'drafter'), A2: o('A2', 'chash'), A3: o('A3', 'opty'), A4: o('A4', 'workday'),
  A5: o('A5', ''), A6: o('A6', 'drafter', { drafterBatch: 7 }),
  ...(extra || {}) } });
const sent = [];
const deps = { enqueue: async (db, n) => { sent.push(n); return { key: 'k' + n, queued: true }; } };

(async () => {
  // ── הסל ──
  {
    const db = seed();
    const b = await D.lgDrafterBasket(db);
    check('basket = drafter + chash, not yet sent', b.map(x => x.id).sort(), ['A1', 'A2']);
  }
  // ── משלוח ──
  {
    const db = seed();
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    check('send → batch 1', [r.ok, r.n, (r.orderIds || []).sort()], [true, 1, ['A1', 'A2']]);
    check('orders marked', [db._data.orders.A1.drafterBatch, db._data.orders.A2.drafterBatch], [1, 1]);
    check('batch record', [db._data.waMeta.drafterBatches['1'].count, db._data.waMeta.drafterBatches['1'].doneAt || null], [2, null]);
    check('email queued for batch 1', sent.slice(-1), [1]);
    const again = await D.lgDrafterSend(db, { by: 'ben', now: NOW + 1 }, deps);
    check('empty basket → empty', [again.ok, again.code], [false, 'empty']);
    check('no empty batch left behind', Object.keys(db._data.waMeta.drafterBatches).filter(k => k !== '_next'), ['1']);
    // הזמנה שנכנסה אחרי השליחה — בסל, לא במשלוח 1
    db._data.orders.A9 = o('A9', 'drafter');
    check('later order waits in basket', (await D.lgDrafterBasket(db)).map(x => x.id), ['A9']);
    const r2 = await D.lgDrafterSend(db, { by: 'ben', now: NOW + 2 }, deps);
    check('second send → batch 2 with only the new one', [r2.n, r2.orderIds], [2, ['A9']]);
  }
  // ── שתי לחיצות במקביל ──
  {
    const db = seed();
    const [x, y] = await Promise.all([D.lgDrafterSend(db, { by: 'a', now: NOW }, deps), D.lgDrafterSend(db, { by: 'b', now: NOW }, deps)]);
    const ids = [...(x.orderIds || []), ...(y.orderIds || [])].sort();
    check('concurrent sends: each order in exactly one batch', ids, ['A1', 'A2']);
    check('concurrent sends: orders hold the batch that lists them',
      ['A1', 'A2'].every(id => [x, y].some(r => r.ok && r.orderIds.includes(id) && db._data.orders[id].drafterBatch === r.n)), true);
  }
  // ── השרטט סיים ──
  {
    const db = seed();
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    db._data.orders.A9 = o('A9', 'chash');
    await D.lgDrafterSend(db, { by: 'ben', now: NOW + 5 }, deps);
    db._data.orders.A1.stage = 'workday';           // הועברה ידנית
    delete db._data.orders.A2;                      // נמחקה
    const d = await D.lgDrafterDone(db, { by: 'ben', now: NOW + 10 });
    check('done: moves the rest of all open batches', d.moved.map(m => m.id), ['A9']);
    check('done: A9 → opty like finishSketch', [db._data.orders.A9.stage, db._data.orders.A9.status, db._data.orders.A9.optyAt],
      ['opty', 'מחכה ל-OptyWay', NOW + 10]);
    check('done: skipped reasons', d.skipped.map(s => s.id + ':' + s.reason).sort(), ['A1:כבר לא אצל שרטט', 'A2:נמחקה']);
    check('done: hand-moved order untouched', db._data.orders.A1.stage, 'workday');
    check('done: deleted order not recreated', db._data.orders.A2, undefined);
    check('done: batches closed', [db._data.waMeta.drafterBatches['1'].doneAt, db._data.waMeta.drafterBatches['2'].doneAt], [NOW + 10, NOW + 10]);
    check('done: batches listed', d.batches, [1, 2]);
    const d2 = await D.lgDrafterDone(db, { by: 'ben', now: NOW + 20 });
    check('done twice → nothing moves', [d2.moved, d2.batches], [[], []]);
  }
  // ── מצב ──
  {
    const db = seed();
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    db._data.orders.A9 = o('A9', 'drafter');
    const s = await D.lgDrafterStatus(db);
    check('status: basket + open batch', [s.basket.map(x => x.id), s.open.map(b => [b.n, b.count])], [['A9'], [[1, 2]]]);
  }

  // ── הקובץ ──
  {
    const { createCanvas } = require('@napi-rs/canvas');
    const { PDFDocument } = require('pdf-lib');
    const img = (mime, w, h) => { const c = createCanvas(w, h); const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; g.fillRect(5, 5, w / 2, h / 2);
      return 'data:' + mime + ';base64,' + c.toBuffer(mime).toString('base64'); };
    const db = seed(null, { sketches: { A1: img('image/jpeg', 800, 600), A2: img('image/png', 300, 900) } });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    const pages = async f => (await PDFDocument.load(f.buf)).getPageCount();
    const r = await D.lgDrafterPdf(db, 1);
    check('pdf: one file, cover + 2 sketch pages', [r.files.length, await pages(r.files[0]), r.files[0].mime], [1, 3, 'application/pdf']);
    check('pdf: file name', r.files[0].name, 'משלוח 1.pdf');
    // הזמנה בלי סקיצה — עדיין עמוד, והמייל יוצא
    const db2 = seed(null, { sketches: { A1: img('image/jpeg', 400, 300), A2: 'data:image/png;base64,AAAA' } });
    await D.lgDrafterSend(db2, { by: 'ben', now: NOW }, deps);
    const r2 = await D.lgDrafterPdf(db2, 1);
    check('pdf: broken sketch still gets a page', await pages(r2.files[0]), 3);
    // קובץ גדול → כמה חלקים
    const r3 = await D.lgDrafterPdf(db, 1, { maxBytes: 1 });
    check('pdf: split when too big', [r3.files.length, r3.files.map(f => f.name)],
      [2, ['משלוח 1 (1 מתוך 2).pdf', 'משלוח 1 (2 מתוך 2).pdf']]);
    check('pdf: cover only in part 1', [await pages(r3.files[0]), await pages(r3.files[1])], [2, 1]);
    check('pdf: unknown batch → error', (await D.lgDrafterPdf(db, 99)).code, 'no-batch');
  }

  // ── המייל דרך תור המיילים הקיים ──
  {
    process.env.EMAIL_ONLY_TO = 'lozzagagot@gmail.com';
    const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
    const { renderText } = require(path.join(ROOT, 'api', '_wa-provider.js'));
    const db = seed(null, { sketches: {} });
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW });          // בלי הזרקה — המייל האמיתי
    check('send queues a real outbox record', [r.ok, r.email && r.email.queued], [true, true]);
    const rec = db._data.waMeta.emailOutbox[r.email.key];
    check('outbox record', [rec.kind, rec.drafterBatch, rec.sendTo, rec.fileCount, rec.state],
      ['drafter-batch', 1, 'lozzagagot@gmail.com', 1, 'pending']);
    check('batch remembers its email', db._data.waMeta.drafterBatches['1'].emailKey, r.email.key);
    const items = await ob.lgEmailClaim(db, 5, NOW + 1000);
    const it = items.find(x => x.key === r.email.key);
    check('claim keeps it (no customer messageId / link needed)', !!it, true);
    check('claim item passes the Gmail script filter + new-mail branch',
      it && [!!it.thread, !!it.messageId, it.email, it.sendTo, it.subject, it.files],
      [true, true, 'lozzagagot@gmail.com', 'lozzagagot@gmail.com', 'הזמנות לשרטוט — משלוח 1 (2)', 1]);
    check('mail body', it && it.text.split('\n')[0], 'משלוח 1 · ' + new Date(NOW).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · 2 הזמנות');
    check('mail body lists orders', it && it.text.split('\n').length, 3);
    const f = await ob.lgEmailOutboxFile(db, it.key, it.leaseToken, 0, NOW + 2000);
    check('outbox-file returns the PDF', [f.ok, f.mime, f.name], [true, 'application/pdf', 'משלוח 1.pdf']);
    check('renderText drafter-batch = the lines', renderText({ kind: 'drafter-batch', extraLines: ['א', 'ב'] }), 'א\nב');
    // רגרסיה: רשומת לקוח בלי messageId עדיין מבוטלת
    await db.ref('waMeta/emailOutbox/aaaaaaaaaaaaaaaaaaaa').set({ kind: 'sketches-handled', thread: 'T', messageId: '', email: 'lozzagagot@gmail.com',
      accountKey: '1', orderIds: [], state: 'pending', createdAt: NOW, attempts: 0 });
    await ob.lgEmailClaim(db, 5, NOW + 3000);
    check('customer record without messageId still cancelled', db._data.waMeta.emailOutbox.aaaaaaaaaaaaaaaaaaaa.state, 'cancelled');
    // כתובת אחרת בבקשה — לא משנה כלום
    const r9 = await ob.lgEmailEnqueue(db, { kind: 'drafter-batch', thread: 'drafter', messageId: 'drafter-9', email: 'evil@x.com',
      sendTo: 'evil@x.com', keySuffix: 9, drafterBatch: 9, extraLines: ['x'], orderIds: [] });
    check('drafter-batch always goes to the fixed address', [db._data.waMeta.emailOutbox[r9.key].email, db._data.waMeta.emailOutbox[r9.key].sendTo],
      ['lozzagagot@gmail.com', 'lozzagagot@gmail.com']);
    delete process.env.EMAIL_ONLY_TO;
  }

  // ── תיקונים אחרי סקירה ──
  {
    check('part size fits a Vercel response (base64 under 4.5MB)', D.MAX_PDF_BYTES <= 3 * 1024 * 1024, true);
    process.env.EMAIL_ONLY_TO = 'lozzagagot@gmail.com';
    const ob = require(path.join(ROOT, 'api', '_email-outbox.js'));
    const { createCanvas } = require('@napi-rs/canvas');
    const img = () => { const c = createCanvas(300, 200); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); };
    // הקובץ נבנה פעם אחת ונשמר — שינוי בסקיצה אחרי השליחה לא משנה את מה שיוצא
    const db = seed(null, { sketches: { A1: img(), A2: img() } });
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    const stored = db._data.waMeta.drafterPdf && db._data.waMeta.drafterPdf['1'];
    check('pdf parts stored at send', stored && Object.keys(stored.parts || {}).length, 1);
    db._data.sketches.A2 = 'garbage';
    const it = (await ob.lgEmailClaim(db, 5, NOW + 1000)).find(x => x.key === r.email.key);
    const f = await ob.lgEmailOutboxFile(db, it.key, it.leaseToken, 0, NOW + 2000);
    check('outbox-file serves the stored part', [f.ok, Buffer.from(f.b64, 'base64').length], [true, Buffer.from(stored.parts['0'], 'base64').length]);
    // שליחה חוזרת אחרי מייל שנכשל
    db._data.waMeta.emailOutbox[r.email.key].state = 'failed';
    const st = await D.lgDrafterStatus(db);
    check('status shows failed email', st.open[0].emailState, 'failed');
    const rs = await D.lgDrafterResend(db, 1, { now: NOW + 3000 });
    check('resend re-queues the same batch', [rs.ok, db._data.waMeta.emailOutbox[rs.key].state, rs.key], [true, 'pending', r.email.key]);
    check('resend unknown batch', (await D.lgDrafterResend(db, 42, { now: NOW })).ok, false);
    // "השרטט סיים" לא מעביר משלוח שהמייל שלו נכשל
    db._data.waMeta.emailOutbox[r.email.key].state = 'failed';
    const d = await D.lgDrafterDone(db, { by: 'ben', now: NOW + 4000 });
    check('done skips a batch whose email failed', [d.moved.length, d.batches, d.held], [0, [], [1]]);
    check('done leaves that batch open', db._data.waMeta.drafterBatches['1'].doneAt, null);
    delete process.env.EMAIL_ONLY_TO;
  }
  // הזמנה שחזרה לשרטט אחרי שהמשלוח שלה נסגר — חוזרת לסל
  {
    const db = seed();
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + 1 });
    db._data.orders.A1.stage = 'drafter';
    check('order sent back to drafter is in the basket again', (await D.lgDrafterBasket(db)).map(x => x.id), ['A1']);
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW + 2 }, deps);
    check('and goes in the next batch', [r.ok, r.orderIds, db._data.orders.A1.drafterBatch], [true, ['A1'], 2]);
  }
  // שתי לחיצות "השרטט סיים" במקביל — הדוח והרשומה לא נדרסים
  {
    const db = seed();
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    const [x, y] = await Promise.all([D.lgDrafterDone(db, { by: 'a', now: NOW + 1 }), D.lgDrafterDone(db, { by: 'b', now: NOW + 1 })]);
    check('concurrent done: moved once in total', x.moved.length + y.moved.length, 2);
    check('concurrent done: batch record keeps the real list', (db._data.waMeta.drafterBatches['1'].moved || []).length, 2);
  }
  // שתי לחיצות "שלח" במקביל — משלוח אחד
  {
    const db = seed();
    const rs = await Promise.all([D.lgDrafterSend(db, { by: 'a', now: NOW }, deps), D.lgDrafterSend(db, { by: 'b', now: NOW }, deps)]);
    check('concurrent send: one batch only', rs.filter(r => r.ok).length, 1);
    check('concurrent send: the other says busy/empty', rs.filter(r => !r.ok).map(r => r.code).every(c => c === 'busy' || c === 'empty'), true);
    check('lock released', db._data.waMeta.drafterBatches._sending || null, null);
  }

  // ── "לא לשלוח עכשיו" (בן, 10/11: שליטה מה נכנס לטיוטה) ──
  {
    const db = seed();
    check('hold', (await D.lgDrafterHold(db, 'A1', true)).ok, true);
    check('held order out of the basket', (await D.lgDrafterBasket(db)).map(x => x.id), ['A2']);
    const st = await D.lgDrafterStatus(db);
    check('status lists held', st.held.map(x => x.id), ['A1']);
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    check('send skips held', r.orderIds, ['A2']);
    check('return to draft', (await D.lgDrafterHold(db, 'A1', false)).ok, true);
    check('back in the basket', (await D.lgDrafterBasket(db)).map(x => x.id), ['A1']);
    check('hold field cleared', db._data.orders.A1.drafterHold, undefined);
    check('hold: not at drafter → refused', (await D.lgDrafterHold(db, 'A3', true)).ok, false);
    check('hold: missing order → refused, not created', [(await D.lgDrafterHold(db, 'ZZ', true)).ok, db._data.orders.ZZ], [false, undefined]);
    check('hold: already sent → refused', (await D.lgDrafterHold(db, 'A2', true)).ok, false);
  }

  // ── "השרטט סיים" על משלוח אחד (בן: בתחנת שרטט, לפי קובץ) ──
  {
    const db = seed();
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    db._data.orders.A9 = o('A9', 'drafter');
    await D.lgDrafterSend(db, { by: 'ben', now: NOW + 5 }, deps);
    const d = await D.lgDrafterDone(db, { by: 'ben', now: NOW + 10, n: 2 });
    check('done one batch: only its orders move', [d.batches, d.moved.map(m => m.id), db._data.orders.A1.stage], [[2], ['A9'], 'drafter']);
    check('done one batch: other stays open', [db._data.waMeta.drafterBatches['1'].doneAt, !!db._data.waMeta.drafterBatches['2'].doneAt], [null, true]);
    check('done unknown batch → nothing', (await D.lgDrafterDone(db, { by: 'ben', now: NOW + 11, n: 99 })).batches, []);
    const st = await D.lgDrafterStatus(db);
    check('status: open batch lists its orders with sketch names', st.open[0].orders.map(x => [x.id, x.sketchName]), [['A1', 'סקיצה A1'], ['A2', 'סקיצה A2']]);
  }
  // ── הטיוטה כקובץ, לפני שליחה ──
  {
    const { createCanvas } = require('@napi-rs/canvas');
    const img = () => 'data:image/png;base64,' + createCanvas(200, 100).toBuffer('image/png').toString('base64');
    const db = seed(null, { sketches: { A1: img(), A2: img() } });
    const p = await D.lgDrafterPreview(db, { now: NOW });
    const { PDFDocument } = require('pdf-lib');
    check('preview: one file with cover + 2', [p.ok, p.files.length, (await PDFDocument.load(p.files[0].buf)).getPageCount(), p.files[0].name], [true, 1, 3, 'טיוטה לשרטט.pdf']);
    check('preview changes nothing', [db._data.orders.A1.drafterBatch, (db._data.waMeta || {}).drafterBatches], [undefined, undefined]);
    await D.lgDrafterHold(db, 'A1', true);
    check('preview skips held', (await PDFDocument.load((await D.lgDrafterPreview(db, { now: NOW })).files[0].buf)).getPageCount(), 2);
    const empty = seed(null, {}); Object.values(empty._data.orders).forEach(x => { x.stage = 'opty'; });
    check('preview empty', (await D.lgDrafterPreview(empty, { now: NOW })).code, 'empty');
    // הקובץ של משלוח שנשלח
    const r = await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    check('stored file of a sent batch (send stored it only via real enqueue — none here)', (await D.lgDrafterStoredFile(db, r.n, 0)).ok, false);
  }

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll drafter-batch checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
