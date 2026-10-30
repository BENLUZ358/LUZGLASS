#!/usr/bin/env node
/**
 * ביטול מהסוכן (שלב 2, משימה 3) — lgAgentCancel, פעולת האדמין
 * agent-cancel-done, ומקטע "ביטולים מהסוכן" ב-hs-corrections.html.
 * Run:  node scripts/test-agent-cancel.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';          // מקושר ב-waSenders → 777
const GROUP = '120363000000@g.us';          // קבוצה מקושרת → 777
const GROUP2 = '120363000001@g.us';         // קבוצה של לקוח אחר (999)
const key = id => String(id).replace(/[.#$[\]/]/g, '_');
// השוואה בלי תלות בסדר המפתחות
const sorted = o => (o && typeof o === 'object' && !Array.isArray(o))
  ? Object.keys(o).sort().reduce((a, k) => (a[k] = sorted(o[k]), a), {}) : o;
const ORDERS = {
  o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday', orderClient: 'כהן זכוכית' },
  o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending', orderClient: 'כהן זכוכית',
        hashavshevet: { reference: '9001', httpOk: true, sentAt: NOW - 1000 } },
  o4: { customerId: '777', orderNum: 'L1004', sketchName: 'אמבטיה', stage: 'chash',
        hashavshevet: { reference: '9002', httpOk: true, sentAt: NOW - 1000, simulated: true } },
  o5: { customerId: '777', orderNum: 'L1005', sketchName: 'סלון', stage: 'opty' },
  o6: { customerId: '777', orderNum: 'L1006', stage: '' },
  o2: { customerId: '999', orderNum: 'L1002', sketchName: 'כהן', stage: 'pending' },
};
const seed = () => fakeDb({
  orders: JSON.parse(JSON.stringify(ORDERS)),
  sketches: { o3: { img: 'x' } },
  waSenders: { '0501234567': { customerId: '777' } },
  waGroups: { [key(GROUP)]: { customerId: '777' }, [key(GROUP2)]: { customerId: '999' } },
  waMeta: {},
});
const ctx = { customerId: '777', chatId: PRIV, now: NOW };
const cancels = db => (db._data.waMeta || {}).agentCancels || {};

//  t3-5: firebase-admin לא מותקן ב-worktree — מחליפים רק אותו, ו-_verifyAdmin
//  האמיתי רץ (כותרת חסרה / טוקן רע → 401, משתמש לא אדמין → 403).
process.env.FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT ||
  JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x@y', private_key: 'k' });
let ADMIN_DB = null;
const TOKENS = { tUser: '0531111111@luzglass.local', tAdmin: '0520000000@luzglass.local' };
const realLoad = Module._load;
Module._load = function (req) {
  if (req === 'firebase-admin/app') return { getApps: () => [{}], initializeApp: () => ({}), cert: () => ({}) };
  if (req === 'firebase-admin/database') return { getDatabase: () => ADMIN_DB };
  if (req === 'firebase-admin/auth') return { getAuth: () => ({ verifyIdToken: async t => {
    if (!TOKENS[t]) throw Object.assign(new Error('bad'), { name: 'AuthErr' });
    return { email: TOKENS[t] };
  } }) };
  return realLoad.apply(this, arguments);
};

(async () => {
  check('lgAgentCancel is exported', typeof act.lgAgentCancel, 'function');
  if (typeof act.lgAgentCancel !== 'function') { console.error(`\n${failed} failed`); process.exit(1); }

  /* ── ביטול תקין ── */
  {
    const db = seed();
    const r = await act.lgAgentCancel(db, 'o3', ctx);
    check('ok cancel → {ok:true}', r, { ok: true, code: '' });
    check('order removed from orders', db._data.orders.o3, undefined);
    check('sketch stays', db._data.sketches.o3, { img: 'x' });
    check('cancel record carries an attempt token', typeof cancels(db).o3.token === 'string' && cancels(db).o3.token.length > 0, true);
    check('cancel record written (confirmed)', sorted({ ...cancels(db).o3, token: undefined }),
      sorted({ order: ORDERS.o3, at: NOW, chatId: PRIV, hsSent: true, done: false, confirmed: true }));
    check('other orders untouched', Object.keys(db._data.orders).sort(), ['o1', 'o2', 'o4', 'o5', 'o6']);
    // כבר בוטל
    check('already cancelled → missing', await act.lgAgentCancel(db, 'o3', ctx), { ok: false, code: 'missing' });
    check('missing does not touch the record', cancels(db).o3.order.orderNum, 'L1003');
  }
  /* ── לקוח אחר / שלב מאוחר / מזהה רע ── */
  {
    const db = seed();
    check('other customer → forbidden', await act.lgAgentCancel(db, 'o2', ctx), { ok: false, code: 'forbidden' });
    check('forbidden: order stays, no record', [!!db._data.orders.o2, cancels(db).o2], [true, undefined]);
    check('stage workday → too-late', await act.lgAgentCancel(db, 'o1', ctx), { ok: false, code: 'too-late' });
    check('too-late: order stays, no record', [db._data.orders.o1.stage, cancels(db).o1], ['workday', undefined]);
    check('no customerId → forbidden', await act.lgAgentCancel(db, 'o5', { ...ctx, customerId: '' }), { ok: false, code: 'forbidden' });
    check('bad id (path) → missing, nothing deleted', [await act.lgAgentCancel(db, 'o5/stage', ctx), db._data.orders.o5.stage],
      [{ ok: false, code: 'missing' }, 'opty']);
    check('unknown id → missing', await act.lgAgentCancel(db, 'nope', ctx), { ok: false, code: 'missing' });
  }
  /* ── hsSent נגזר נכון ── */
  {
    const db = seed();
    await act.lgAgentCancel(db, 'o4', ctx);   // simulated
    await act.lgAgentCancel(db, 'o5', ctx);   // לא נשלח
    await act.lgAgentCancel(db, 'o6', ctx);   // שלב ''
    check('hsSent: simulated → false, unsent → false', [cancels(db).o4.hsSent, cancels(db).o5.hsSent, cancels(db).o6.hsSent], [false, false, false]);
    check('stages chash/opty/"" are cancellable', [db._data.orders.o4, db._data.orders.o5, db._data.orders.o6], [undefined, undefined, undefined]);
    const db2 = fakeDb({ orders: { a: { customerId: '777', stage: 'drafter', hashavshevet: { sentAt: 0 } } },
                         waSenders: { '0501234567': { customerId: '777' } } });
    await act.lgAgentCancel(db2, 'a', ctx);
    check('hsSent: sentAt 0 → false; drafter cancellable', [db2._data.waMeta.agentCancels.a.hsSent, db2._data.orders.a], [false, undefined]);
  }
  /* ── Review Focus 3: ירדה לביצוע בין הקריאה לטרנזקציה ── */
  {
    const db = seed();
    const realRef = db.ref.bind(db);
    db.ref = p => {
      const r = realRef(p);
      if (p !== 'orders/o3') return r;
      const tx = r.transaction;
      // שאול מוריד לביצוע רגע לפני שהטרנזקציה רצה בשרת
      r.transaction = fn => { db._data.orders.o3.stage = 'workday'; return tx(fn); };
      return r;
    };
    check('focus 3: stage moved to workday just before the transaction → too-late', await act.lgAgentCancel(db, 'o3', ctx), { ok: false, code: 'too-late' });
    check('focus 3: order not deleted, no record', [db._data.orders.o3.stage, cancels(db).o3], ['workday', undefined]);
  }
  /* ── t3-1/2: הרשומה נכתבת **לפני** המחיקה ── */
  {
    // הפונקציה "נהרגת" מיד אחרי המחיקה — אישור הרשומה לא קורה
    const db = seed();
    const realRef = db.ref.bind(db);
    let seenAtDelete = null;
    db.ref = p => {
      const r = realRef(p);
      if (p === 'orders/o3') { const tx = r.transaction;
        r.transaction = async fn => { seenAtDelete = JSON.parse(JSON.stringify(cancels(db).o3 || null)); return tx(fn); }; }
      if (p === 'waMeta/agentCancels/o3') r.update = async () => { throw Object.assign(new Error('killed'), { name: 'Killed' }); };
      return r;
    };
    const warn = console.warn; console.warn = () => {};
    let r; try { r = await act.lgAgentCancel(db, 'o3', ctx); } finally { console.warn = warn; }
    check('t3-1: record exists before the delete transaction runs', [!!seenAtDelete, seenAtDelete && seenAtDelete.confirmed], [true, false]);
    check('t3-1: killed after delete → order gone, record still holds the order, unconfirmed',
      [db._data.orders.o3, cancels(db).o3.order, cancels(db).o3.confirmed, cancels(db).o3.done, r.ok], [undefined, ORDERS.o3, false, false, false]);
  }
  {
    // כתיבת הרשומה מראש נכשלת → לא מוחקים כלום
    const db = seed();
    const realRef = db.ref.bind(db);
    let txCalled = false;
    db.ref = p => {
      const r = realRef(p);
      if (p === 'waMeta/agentCancels/o3') r.transaction = async () => { throw Object.assign(new Error('x'), { name: 'NetErr' }); };
      if (p === 'orders/o3') { const tx = r.transaction; r.transaction = fn => { txCalled = true; return tx(fn); }; }
      return r;
    };
    const warn = console.warn; console.warn = () => {};
    let r; try { r = await act.lgAgentCancel(db, 'o3', ctx); } finally { console.warn = warn; }
    check('t3-2: record write fails → error, no delete attempted', [r, txCalled, db._data.orders.o3], [{ ok: false, code: 'error' }, false, ORDERS.o3]);
  }
  /* ── t3-3: הצ'אט עדיין מקושר ללקוח בזמן הביטול ── */
  {
    const db = seed();
    check('t3-3: unlinked chat → forbidden', await act.lgAgentCancel(db, 'o3', { ...ctx, chatId: '972549999999@c.us' }), { ok: false, code: 'forbidden' });
    check('t3-3: no chat → forbidden', await act.lgAgentCancel(db, 'o3', { ...ctx, chatId: '' }), { ok: false, code: 'forbidden' });
    check('t3-3: group of another customer → forbidden', await act.lgAgentCancel(db, 'o3', { ...ctx, chatId: GROUP2 }), { ok: false, code: 'forbidden' });
    check('t3-3: refused → order stays, no record', [!!db._data.orders.o3, cancels(db).o3], [true, undefined]);
    delete db._data.waSenders['0501234567'];
    check('t3-3: sender unlinked after the question → forbidden', await act.lgAgentCancel(db, 'o3', ctx), { ok: false, code: 'forbidden' });
    check('t3-3: linked group → ok', await act.lgAgentCancel(db, 'o3', { ...ctx, chatId: GROUP }), { ok: true, code: '' });
  }

  /* ── R2-1: שני ביטולים במקביל (וביטול מול הורדה לביצוע) — כל שזירה ── */
  //  כל פעולה על בסיס הנתונים של כל "שחקן" עוברת שער; הלוח (sched) קובע מי
  //  מתקדם בכל צעד. כך נבדקות כל השזירות של צעדי A ו-B, לא רק "B כולו באמצע".
  const interleave = async (db, actors, sched) => {
    const realRef = db.ref.bind(db);
    const arrived = actors.map(() => null), fin = actors.map(() => false), out = [];
    let wake = null;
    const poke = () => { const w = wake; wake = null; if (w) w(); };
    const gate = i => new Promise(res => { arrived[i] = res; poke(); });
    const view = i => ({ ref: p => {
      const r = realRef(p);
      ['once', 'set', 'update', 'transaction'].forEach(m => {
        const orig = r[m];
        r[m] = async (...a) => { await gate(i); return orig(...a); };
      });
      return r;
    } });
    actors.forEach((fn, i) => { fn(view(i)).then(v => { out[i] = v; fin[i] = true; poke(); },
                                                 e => { out[i] = { err: e && e.name }; fin[i] = true; poke(); }); });
    let step = 0;
    for (;;) {
      while (!actors.every((_, i) => fin[i] || arrived[i])) await new Promise(r => { wake = r; });
      const ready = actors.map((_, i) => i).filter(i => arrived[i]);
      if (!ready.length) break;
      const want = step < sched.length ? sched[step] : step % actors.length;
      const pick = ready.includes(want) ? want : ready[0];
      step++;
      const r = arrived[pick]; arrived[pick] = null; r();
    }
    return out;
  };
  const scheds = (n, k) => { const all = [[]];
    for (let l = 1; l <= n; l++) { const nx = []; all.filter(x => x.length === l - 1).forEach(x => { for (let j = 0; j < k; j++) nx.push(x.concat(j)); }); all.push(...nx); }
    return all.filter(x => x.length === n); };
  {
    const warn = console.warn; console.warn = () => {};
    let bad = [], okCounts = new Set();
    try {
      for (const sc of scheds(10, 2)) {
        const db = seed();
        const res = await interleave(db, [d => act.lgAgentCancel(d, 'o3', ctx), d => act.lgAgentCancel(d, 'o3', ctx)], sc);
        const rc = cancels(db).o3;
        const good = db._data.orders.o3 === undefined && rc && rc.confirmed === true && rc.order && rc.order.orderNum === 'L1003'
          && res.filter(r => r && r.ok).length === 1;
        okCounts.add(res.filter(r => r && r.ok).length);
        if (!good) bad.push(sc.join('') + ' → ' + JSON.stringify([res, db._data.orders.o3 ? 'order' : 'gone', rc || null]));
      }
    } finally { console.warn = warn; }
    check('R2-1: two concurrent cancels, every interleaving (1024): order gone, confirmed record holds it, exactly one ok',
      bad.slice(0, 2), []);
  }
  {
    // ביטול מול שאול שמוריד לביצוע (update על ההזמנה) — אף פעם לא "נמחקה בלי רשומה"
    const warn = console.warn; console.warn = () => {};
    let bad = [];
    try {
      for (const sc of scheds(9, 2)) {
        const db = seed();
        const res = await interleave(db, [d => act.lgAgentCancel(d, 'o3', ctx),
                                          d => d.ref('orders/o3').update({ stage: 'workday' })], sc);
        const o = db._data.orders.o3, rc = cancels(db).o3;
        const intact = o && o.orderNum === 'L1003';
        // ok → רשומה מאושרת עם ההזמנה; לא ok → ההזמנה שלמה ואין רשומה
        const good = res[0].ok ? (rc && rc.confirmed === true && rc.order.orderNum === 'L1003')
                               : (intact && !rc && res[0].code === 'too-late');
        if (!good) bad.push(sc.join('') + ' → ' + JSON.stringify([res[0], o || null, rc || null]));
      }
    } finally { console.warn = warn; }
    check('R2-1: cancel vs move-to-workday, every interleaving: never deleted without a record, refusal leaves none', bad.slice(0, 2), []);
  }
  {
    // ביטול חוזר אחרי שהושלם, כשההזמנה שוחזרה ביד — לא דורס רשומה מאושרת
    const db = seed();
    await act.lgAgentCancel(db, 'o3', ctx);
    const first = JSON.stringify(cancels(db).o3);
    db._data.orders.o3 = JSON.parse(JSON.stringify(ORDERS.o3));
    check('R2-1: confirmed record exists → missing, record untouched, order stays',
      [await act.lgAgentCancel(db, 'o3', ctx), JSON.stringify(cancels(db).o3) === first, !!db._data.orders.o3],
      [{ ok: false, code: 'missing' }, true, true]);
  }
  {
    // הסרה בסירוב — רק של הרשומה שלי: רשומה של ניסיון אחר לא נמחקת
    const db = seed();
    const realRef = db.ref.bind(db);
    db.ref = p => { const r = realRef(p);
      if (p === 'orders/o3') { const tx = r.transaction; r.transaction = fn => {
        // ניסיון אחר כתב רשומה משלו בינתיים, וההזמנה ירדה לביצוע
        db._data.waMeta.agentCancels.o3 = { ...db._data.waMeta.agentCancels.o3, token: 'other' };
        db._data.orders.o3.stage = 'workday'; return tx(fn); }; }
      return r; };
    const r = await act.lgAgentCancel(db, 'o3', ctx);
    check('R2-1: refusal does not remove another attempt\'s record', [r.code, cancels(db).o3 && cancels(db).o3.token], ['too-late', 'other']);
  }
  /* ── R2-2: הטרנזקציה זורקת → הרשומה נשארת ── */
  {
    const db = seed();
    const realRef = db.ref.bind(db);
    db.ref = p => { const r = realRef(p);
      if (p === 'orders/o3') r.transaction = async () => { throw Object.assign(new Error('net'), { name: 'NetErr' }); };
      return r; };
    const warn = console.warn; console.warn = () => {};
    let r; try { r = await act.lgAgentCancel(db, 'o3', ctx); } finally { console.warn = warn; }
    check('R2-2: transaction throws → error, record kept (unconfirmed, with the order)',
      [r, cancels(db).o3 && cancels(db).o3.confirmed, cancels(db).o3 && cancels(db).o3.order.orderNum], [{ ok: false, code: 'error' }, false, 'L1003']);
  }

  /* ── פעולת אדמין agent-cancel-done ── */
  {
    const db = seed();
    await act.lgAgentCancel(db, 'o3', ctx);
    const done = b => adm.handleAdmin({ action: 'agent-cancel-done', ...b }, { db, by: '0520000000', now: NOW + 9 });
    check('done: ok', await done({ key: 'o3' }), { ok: true, code: '' });
    check('done: fields written, rest kept', [cancels(db).o3.done, cancels(db).o3.doneAt, cancels(db).o3.doneBy, cancels(db).o3.order.orderNum],
      [true, NOW + 9, '0520000000', 'L1003']);
    check('t3-4: done again → ok, doneAt/doneBy kept',
      [await adm.handleAdmin({ action: 'agent-cancel-done', key: 'o3' }, { db, by: '0539999999', now: NOW + 99 }), cancels(db).o3.doneAt, cancels(db).o3.doneBy],
      [{ ok: true, code: '' }, NOW + 9, '0520000000']);
    check('done: missing', (await done({ key: 'zz' })).code, 'missing');
    check('done: missing creates nothing', cancels(db).zz, undefined);
    check('done: bad key', (await done({ key: 'a/b' })).code, 'bad-key');
    check('done: no key', (await done({})).code, 'bad-key');
    // ── t3-5: דרך ה-handler, עם _verifyAdmin האמיתי ──
    const db3 = seed();
    db3._data.users = { '0531111111': { role: 'worker' }, '0520000000': { role: 'admin' } };
    await act.lgAgentCancel(db3, 'o3', ctx);
    ADMIN_DB = db3;
    const call = async headers => {
      const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
      await adm({ method: 'POST', headers, body: { action: 'agent-cancel-done', key: 'o3' } }, res);
      return res;
    };
    check('t3-5: no Authorization → 401', (await call({})).code, 401);
    check('t3-5: bad token → 401', (await call({ authorization: 'Bearer nope' })).code, 401);
    check('t3-5: logged-in non-admin → 403', (await call({ authorization: 'Bearer tUser' })).code, 403);
    check('t3-5: refused calls did not mark done', cancels(db3).o3.done, false);
    const okRes = await call({ authorization: 'Bearer tAdmin' });
    check('t3-5: admin → 200, done by the admin phone', [okRes.code, okRes.body, cancels(db3).o3.done, cancels(db3).o3.doneBy],
      [200, { ok: true, code: '' }, true, '0520000000']);
  }

  /* ── hs-corrections.html: מקטע "ביטולים מהסוכן" ── */
  {
    const HTML = fs.readFileSync(path.join(ROOT, 'hs-corrections.html'), 'utf8').replace(/\r\n/g, '\n');
    const m = HTML.match(/\/\/ ── ביטולים מהסוכן[\s\S]*?\/\/ ── סוף ביטולים מהסוכן/);
    check('page has the agent-cancels block', !!m, true);
    check('page posts agent-cancel-done to the drain with auth',
      /_lgAuthPost\('\/api\/wa-inbound-drain',\s*\{\s*action:\s*'agent-cancel-done'/.test(HTML), true);
    check('page reads waMeta/agentCancels', /ref\('waMeta\/agentCancels'\)/.test(HTML), true);
    if (m) {
      const c = { lgEsc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
                  fmtDate: ts => 'D' + ts };
      vm.createContext(c);
      vm.runInContext(m[0].replace(/^const /gm, 'var '), c);
      const T = 100 * 60 * 1000, M = 60 * 1000;
      const map = {
        a: { order: { orderNum: 'L1', orderClient: 'כהן <b>', sketchName: 'מטבח' }, at: 20, hsSent: true, done: false, confirmed: true },
        b: { order: { orderNum: 'L2', orderClient: 'לוי', sketchName: 'סלון' }, at: 10, hsSent: true, done: false, confirmed: true },
        c: { order: { orderNum: 'L3' }, at: 5, hsSent: false, done: false, confirmed: true },
        d: { order: { orderNum: 'L4' }, at: 5, hsSent: true, done: true, confirmed: true },
        e: null,
        f: { order: { orderNum: 'L6' }, at: T - M, hsSent: true, done: false },                       // לא אושר (בלי confirmed), טרי — לא מוצג
        g: { order: { orderNum: 'L7' }, at: T - 5 * M, done: false, confirmed: false },              // לא אושר, טרי — עוד באמצע
        h: { order: { orderNum: 'L8', sketchName: 'ח' }, at: T - 11 * M, done: false, confirmed: false },  // לא אושר, ישן → לבדוק
        i: { order: { orderNum: 'L9' }, at: T - 11 * M, done: true, confirmed: false },
      };
      const rows = c.agentCancelRows(map, T);
      check('rows: confirmed hsSent !done + stale unconfirmed, oldest first', rows.map(r => r.key), ['b', 'a', 'h']);
      check('row fields', rows[1], { key: 'a', orderNum: 'L1', client: 'כהן <b>', sketch: 'מטבח', at: 20, check: false });
      check('stale unconfirmed row is flagged', rows[2] && rows[2].check, true);
      const html = c.agentCancelsHtml(rows);
      check('html: title + both orders + button with key', [/ביטולים מהסוכן/.test(html), /L1/.test(html), /L2/.test(html),
        /data-cancel-done="a"/.test(html), /בוצע בחשבשבת/.test(html), /D20/.test(html), /מטבח/.test(html)], [true, true, true, true, true, true, true]);
      check('html: escaped', [/כהן &lt;b&gt;/.test(html), /כהן <b>/.test(html)], [true, false]);
      check('html: nothing to show → empty', c.agentCancelsHtml([]), '');
      const fl = c.agentCancelsHtml(rows[2] ? [rows[2]] : []);
      check('html: flagged row says to check', [/לבדוק — ייתכן שההזמנה נמחקה/.test(fl), /data-cancel-done="h"/.test(fl)], [true, true]);
    }
  }

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
