#!/usr/bin/env node
/**
 * משלוחים לשרטט — הפעולות מהאדמין דרך /api/wa-inbound-drain (בן, 10/11).
 * Run: node scripts/test-drafter-drain.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const adm = require(path.join(__dirname, '..', 'api', 'wa-inbound-drain.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1762770000000;
process.env.EMAIL_ONLY_TO = 'lozzagagot@gmail.com';
const db = fakeDb({ orders: {
  A1: { id: 'A1', orderNum: 'L1', orderClient: 'אגן', sketchName: 'מקלחון', stage: 'drafter', createdAt: NOW },
  A2: { id: 'A2', orderNum: 'L2', orderClient: 'נאור', sketchName: 'מראה', stage: 'chash', createdAt: NOW },
} });

(async () => {
  let r = await adm.handleAdmin({ action: 'drafter-status' }, { db, by: '052', now: NOW });
  check('status', [r.ok, r.basket.length, r.open.length], [true, 2, 0]);
  r = await adm.handleAdmin({ action: 'drafter-send', to: 'evil@x.com' }, { db, by: '052', now: NOW });
  check('send', [r.ok, r.n, r.orderIds.length, r.emailState], [true, 1, 2, 'pending']);
  const rec = db._data.waMeta.emailOutbox[db._data.waMeta.drafterBatches['1'].emailKey];
  check('send ignores body address', rec.sendTo, 'lozzagagot@gmail.com');
  check('send records who', db._data.waMeta.drafterBatches['1'].by, '052');
  r = await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW + 1 });
  check('send empty', [r.ok, r.code], [false, 'empty']);
  r = await adm.handleAdmin({ action: 'drafter-status' }, { db, by: '052', now: NOW + 2 });
  check('status after send', [r.basket.length, r.open.map(b => [b.n, b.count, b.emailState])], [0, [[1, 2, 'pending']]]);
  r = await adm.handleAdmin({ action: 'drafter-done' }, { db, by: '052', now: NOW + 3 });
  check('done', [r.ok, r.moved.length, r.skipped.length, db._data.orders.A1.stage], [true, 2, 0, 'opty']);

  // שליחה חוזרת
  db._data.orders.A3 = { id: 'A3', orderNum: 'L3', orderClient: 'אגן', stage: 'drafter', createdAt: NOW };
  r = await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW + 10 });
  const key = db._data.waMeta.drafterBatches[String(r.n)].emailKey;
  db._data.waMeta.emailOutbox[key].state = 'failed';
  r = await adm.handleAdmin({ action: 'drafter-resend', n: 2 }, { db, by: '052', now: NOW + 11 });
  check('resend', [r.ok, db._data.waMeta.emailOutbox[key].state], [true, 'pending']);
  r = await adm.handleAdmin({ action: 'drafter-resend', n: 'x' }, { db, by: '052', now: NOW + 12 });
  check('resend bad n', r.ok, false);

  // "לא לשלוח עכשיו" / "החזר"
  db._data.orders.A4 = { id: 'A4', orderNum: 'L4', orderClient: 'אגן', stage: 'chash', createdAt: NOW };
  r = await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: true }, { db, by: '052', now: NOW + 20 });
  check('hold action', [r.ok, db._data.orders.A4.drafterHold], [true, true]);
  r = await adm.handleAdmin({ action: 'drafter-status' }, { db, by: '052', now: NOW + 21 });
  check('status shows held', r.held.map(x => x.id), ['A4']);
  r = await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: false }, { db, by: '052', now: NOW + 22 });
  check('unhold action', [r.ok, db._data.orders.A4.drafterHold], [true, undefined]);
  r = await adm.handleAdmin({ action: 'drafter-hold', id: '../x', hold: true }, { db, by: '052', now: NOW + 23 });
  check('hold bad id', r.ok, false);

  //  סקירת שחרור 11/11: ההחזקה הצליחה, קריאת ההזמנה לשורה בחדר נכשלה → עדיין הצלחה
  {
    const ref0 = db.ref.bind(db);
    db._failRead = false;
    db.ref = p => { const r = ref0(p); if (p === 'orders/A4') { const once0 = r.once; r.once = async (...a) => { if (db._failRead) throw new Error('read'); return once0(...a); }; } return r; };
    // ההחזקה עצמה (lgDrafterHold) קוראת מאותו נתיב — נכשיל רק את הקריאה שאחריה
    const DBm = require(require('path').join(__dirname, '..', 'api', '_drafter-batch.js'));
    const hold0 = DBm.lgDrafterHold;
    DBm.lgDrafterHold = async (...a) => { const r2 = await hold0(...a); db._failRead = true; return r2; };
    let thrown = null;
    try { r = await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: true }, { db, by: '052', now: NOW + 24 }); }
    catch (e) { thrown = e.message; }
    DBm.lgDrafterHold = hold0; db.ref = ref0; db._failRead = false;
    check('hold: room-row read fails → action still ok', [thrown, r && r.ok, db._data.orders.A4.drafterHold], [null, true, true]);
    await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: false }, { db, by: '052', now: NOW + 25 });
  }

  // טיוטה כקובץ, קובץ של משלוח, "סיים" על משלוח אחד
  r = await adm.handleAdmin({ action: 'drafter-preview', idx: 0 }, { db, by: '052', now: NOW + 30 });
  check('preview', [r.ok, r.parts, r.name, typeof r.b64], [true, 1, 'טיוטה לשרטט.pdf', 'string']);
  r = await adm.handleAdmin({ action: 'drafter-file', n: 2, idx: 0 }, { db, by: '052', now: NOW + 31 });
  check('file of sent batch', [r.ok, r.name, typeof r.b64], [true, 'משלוח 2.pdf', 'string']);
  r = await adm.handleAdmin({ action: 'drafter-file', n: 'x', idx: 0 }, { db, by: '052', now: NOW + 32 });
  check('file bad n', r.ok, false);
  r = await adm.handleAdmin({ action: 'drafter-done', n: 2 }, { db, by: '052', now: NOW + 33 });
  check('done one batch', [r.ok, r.batches], [true, [2]]);
  check('no agent switches (test env) → nothing in the room', (db._data.waMeta.agentRoom || null), null);

  // חדר הסוכנים שלב ב׳: הקולט מדווח בחדר על שלח / סיים / שלח שוב — לפי המתג שלו
  {
    const ENV = { AGENT_SHADOW_ENABLED: 'true' };
    const db2 = fakeDb({ orders: {
      B1: { id: 'B1', orderNum: 'L11', orderClient: 'אגן', stage: 'drafter', createdAt: NOW },
      B2: { id: 'B2', orderNum: 'L12', orderClient: 'נאור', stage: 'chash', createdAt: NOW },
    }, waMeta: { agentConfig: { agents: { kolet: 'shadow' } } } });
    const texts = () => Object.values(db2._data.waMeta.agentRoom || {}).sort((a, b) => a.at - b.at).map(e => [e.agent, e.kind, e.text]);
    r = await adm.handleAdmin({ action: 'drafter-send' }, { db: db2, by: '052', now: NOW, env: ENV });
    check('room: send', texts(), [['kolet', 'info', 'משלוח 1 נשלח לשרטט — 2 הזמנות']]);
    r = await adm.handleAdmin({ action: 'drafter-resend', n: 1 }, { db: db2, by: '052', now: NOW + 1, env: ENV });
    check('room: resend', texts()[1], ['kolet', 'info', 'המייל למשלוח 1 נשלח שוב לשרטט']);
    r = await adm.handleAdmin({ action: 'drafter-done' }, { db: db2, by: '052', now: NOW + 2, env: ENV });
    check('room: done', texts()[2], ['kolet', 'info', 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה ✓']);
    db2._data.waMeta.agentConfig.agents.kolet = 'off';
    db2._data.orders.B3 = { id: 'B3', orderNum: 'L13', orderClient: 'אגן', stage: 'drafter', createdAt: NOW };
    await adm.handleAdmin({ action: 'drafter-send' }, { db: db2, by: '052', now: NOW + 3, env: ENV });
    check('room: kolet off → nothing', texts().length, 3);
  }

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nAll drafter-drain checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
