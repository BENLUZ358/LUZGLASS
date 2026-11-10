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
const seed = extra => fakeDb({ orders: {
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
    const db = seed({ sketches: { A1: img('image/jpeg', 800, 600), A2: img('image/png', 300, 900) } });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW }, deps);
    const pages = async f => (await PDFDocument.load(f.buf)).getPageCount();
    const r = await D.lgDrafterPdf(db, 1);
    check('pdf: one file, cover + 2 sketch pages', [r.files.length, await pages(r.files[0]), r.files[0].mime], [1, 3, 'application/pdf']);
    check('pdf: file name', r.files[0].name, 'משלוח 1.pdf');
    // הזמנה בלי סקיצה — עדיין עמוד, והמייל יוצא
    const db2 = seed({ sketches: { A1: img('image/jpeg', 400, 300), A2: 'data:image/png;base64,AAAA' } });
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

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll drafter-batch checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
