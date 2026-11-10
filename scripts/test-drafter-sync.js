#!/usr/bin/env node
/**
 * קולט — בדיקת סנכרון אחרי "השרטט סיים" (בן, 11/11).
 *  שלושה מקורות: המשלוח (orderIds), הקובץ שנשמר (waMeta/drafterPdf/<n>/items — מה שבאמת נכנס ל-PDF),
 *  ומה שעכשיו בשלב opty (בנה יום עבודה). שורה אחת לכל משלוח: הכל תואם → info ✓; פער → ask.
 *  + בריצה האיטית: הזמנה שהגיעה ל-opty ב-24 השעות האחרונות בלי משלוח לשרטט → info פעם אחת.
 * Run:  node scripts/test-drafter-sync.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const D = require(path.join(ROOT, 'api', '_drafter-batch.js'));
const W = require(path.join(ROOT, 'api', '_agent-watch.js'));
const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
process.env.EMAIL_ONLY_TO = 'lozzagagot@gmail.com';

const twoOrders = () => ({
  A1: { id: 'A1', orderNum: 'L1', orderClient: 'אגן', sketchName: 'מקלחון', stage: 'drafter', createdAt: NOW },
  A2: { id: 'A2', orderNum: 'L2', orderClient: 'נאור', sketchName: 'מראה', stage: 'chash', createdAt: NOW },
});
const room = d => Object.values((d._data.waMeta || {}).agentRoom || {}).sort((a, b) => a.at - b.at).map(e => [e.agent, e.kind, e.text]);

(async () => {
  /* ── הקובץ שומר את רשימת ההזמנות שנכנסו אליו ── */
  {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    const items = Object.values(db._data.waMeta.drafterPdf['1'].items || {});
    check('enqueue stores the rendered order list', items.map(x => [x.id, x.orderNum, x.client]), [['A1', 'L1', 'אגן'], ['A2', 'L2', 'נאור']]);
  }

  /* ── הכל תואם ── */
  {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    const c = await D.lgDrafterSyncCheck(db, 1);
    check('all match → info ✓', [c.kind, c.text], ['info', 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה ✓']);
  }

  /* ── הזמנה נמחקה / הוזזה ידנית ── */
  {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    delete db._data.orders.A1;
    db._data.orders.A2.stage = 'pending';
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    const c = await D.lgDrafterSyncCheck(db, 1);
    check('deleted + moved by hand → ask with details', [c.kind, c.text],
      ['ask', 'השרטט סיים משלוח 1: 0 מתוך 2 בבנה יום עבודה — לבדוק: L1 · אגן · נמחקה; L2 · נאור · הוזזה ידנית (לא אצל שרטט)']);
  }

  /* ── כבר בעבודה (סקירת שחרור 11/11): הזמנה שעברה את opty — תקין, לא "הוזזה ידנית" ── */
  for (const st of ['workday', 'chisum', 'graphic', 'delivery', 'done', 'collected']) {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    db._data.orders.A2.stage = st;
    const c = await D.lgDrafterSyncCheck(db, 1);
    check('beyond opty (' + st + ') → fine, "כבר בעבודה"', [c.kind, c.ok, c.text],
      ['info', true, 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה (1 כבר בעבודה) ✓']);
  }

  /* ── הקובץ והמשלוח לא תואמים ── */
  {
    const db = fakeDb({ orders: { ...twoOrders(), A3: { id: 'A3', orderNum: 'L3', orderClient: 'כהן', stage: 'opty' } } });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    db._data.waMeta.drafterPdf['1'].items = [{ id: 'A1', orderNum: 'L1', client: 'אגן' }, { id: 'A3', orderNum: 'L3', client: 'כהן' }];
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    const c = await D.lgDrafterSyncCheck(db, 1);
    check('pdf ≠ batch → ask (both directions)', [c.kind, c.text],
      ['ask', 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה — לבדוק: L2 · נאור · במשלוח אבל לא בקובץ; L3 · כהן · בקובץ אבל לא במשלוח']);
  }

  /* ── הקובץ חסר ── */
  {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    delete db._data.waMeta.drafterPdf;
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    const c = await D.lgDrafterSyncCheck(db, 1);
    check('pdf missing → ask', [c.kind, c.text], ['ask', 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה — לבדוק: הקובץ של המשלוח לא נשמר']);
  }

  /* ── קובץ ישן (לפני השינוי) בלי רשימה — לא משווים, לא מתריעים ── */
  {
    const db = fakeDb({ orders: twoOrders() });
    await D.lgDrafterSend(db, { by: 'ben', now: NOW });
    delete db._data.waMeta.drafterPdf['1'].items;
    await D.lgDrafterDone(db, { by: 'ben', now: NOW + MIN });
    check('legacy pdf without list → info', (await D.lgDrafterSyncCheck(db, 1)).kind, 'info');
  }

  /* ── דרך הפעולה מהאדמין: שורה אחת לכל משלוח, לפי המתג ── */
  {
    const db = fakeDb({ orders: twoOrders(), waMeta: { agentConfig: { agents: { kolet: 'shadow' } } } });
    await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW, env: ENV });
    db._data.orders.B1 = { id: 'B1', orderNum: 'L5', orderClient: 'כהן', stage: 'drafter', createdAt: NOW };
    await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW + 1, env: ENV });
    delete db._data.orders.B1;
    await adm.handleAdmin({ action: 'drafter-done' }, { db, by: '052', now: NOW + 2, env: ENV });
    const r = room(db).slice(2);
    check('done all → one line per batch', r, [
      ['kolet', 'info', 'השרטט סיים משלוח 1: 2 מתוך 2 בבנה יום עבודה ✓'],
      ['kolet', 'ask', 'השרטט סיים משלוח 2: 0 מתוך 1 בבנה יום עבודה — לבדוק: L5 · כהן · נמחקה']]);
    const ask = Object.values(db._data.waMeta.agentRoom).find(e => e.kind === 'ask');
    check('mismatch ask is internal (no customer)', [ask.state, ask.internal], ['open', true]);
  }
  {
    //  בלי הגדרות במסך — אפור בלבד
    const db = fakeDb({ orders: twoOrders() });
    await adm.handleAdmin({ action: 'drafter-send' }, { db, by: '052', now: NOW, env: ENV });
    delete db._data.orders.A1;
    await adm.handleAdmin({ action: 'drafter-done', n: 1 }, { db, by: '052', now: NOW + 2, env: ENV });
    check('no agentConfig → grey info even on mismatch', room(db).slice(1).map(x => x[1]), ['info']);
  }

  /* ── הריצה האיטית: הגיעה לבנה יום עבודה בלי משלוח לשרטט ── */
  {
    const orders = {
      o1: { orderNum: 'L7', orderClient: 'כהן', stage: 'opty', optyAt: NOW - 2 * H },
      o2: { orderNum: 'L8', stage: 'opty', optyAt: NOW - 2 * H, drafterBatch: 3 },
      o3: { orderNum: 'L9', stage: 'workday', optyAt: NOW - 30 * H },
      o4: { orderNum: 'L10', stage: 'opty', optyAt: NOW - H, isTest: true },
    };
    const p = W.lgOptyWithoutBatch(orders, NOW);
    check('pure: only last 24h, no drafterBatch, not test', p.map(x => [x.key, x.agent, x.level, x.text]),
      [['opty_o1', 'kolet', 'info', 'הזמנה L7 · כהן הגיעה לבנה יום עבודה בלי משלוח לשרטט']]);

    const CFG = { agents: { markazan: 'shadow', okev: 'off', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'off' } };
    const db = fakeDb({ orders, waMeta: { agentConfig: CFG } });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    const k = () => Object.values(db._data.waMeta.agentRoom || {}).filter(e => e.agent === 'kolet').map(e => e.text);
    check('watch (kolet on, okev off): one info', k(), ['הזמנה L7 · כהן הגיעה לבנה יום עבודה בלי משלוח לשרטט']);
    check('watch: okev off → stats not computed', !!db._data.waMeta.agentStats, false);
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 61 * MIN });
    check('watch: not repeated (dedupe)', k().length, 1);
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 23 * H });
    check('watch: left the 24h window → dropped quietly', [k().length, Object.keys(db._data.waMeta.agentWatch.problems || {}).filter(x => x.startsWith('opty_'))], [1, []]);
  }
  {
    //  סריקה ראשונה (סקירת שחרור 11/11): עד 5 שורות חדשות, השאר — שורת סיכום אחת "ועוד N הזמנות"
    const orders = {};
    for (let i = 1; i <= 9; i++) orders['p' + i] = { orderNum: 'L' + (100 + i), stage: 'opty', optyAt: NOW - i * MIN };
    const CFG = { agents: { markazan: 'shadow', okev: 'off', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'off' } };
    const db = fakeDb({ orders, waMeta: { agentConfig: CFG } });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    const k = () => Object.values(db._data.waMeta.agentRoom || {}).filter(e => e.agent === 'kolet').map(e => e.text);
    check('first scan flood: 5 rows + one summary', [k().length, k().filter(t => t.includes('ועוד 4 הזמנות')).length], [6, 1]);
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 61 * MIN });
    check('first scan flood: next scan adds nothing', k().length, 6);
  }
  {
    const db = fakeDb({ orders: { o1: { orderNum: 'L7', stage: 'opty', optyAt: NOW - 2 * H } } });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('watch no agentConfig: no check (no orders scan)', ((db._data.waMeta || {}).agentRoom || null), null);
  }
  delete process.env.EMAIL_ONLY_TO;
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
