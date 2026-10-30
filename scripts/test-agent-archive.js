#!/usr/bin/env node
/**
 * ארכיון (שלב 2, משימה 5) — lgArchiveFind + ניתוב archive ב-lgAgentAct.
 * Review Focus 5: חשבונית של לקוח אחר לא נשלחת ולא נחשפת.
 * Run:  node scripts/test-agent-archive.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const ar = require(path.join(ROOT, 'api', '_agent-archive.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';
const SHAUL = '0501112222';   // lgAgentStaff מחזיר מספר מקומי; הספק ממיר
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const SK = 'data:image/png;base64,AAAA';
const seed = () => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 999: { name: 'אחר' } },
  orders: {
    o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday' },
    o2: { customerId: '999', orderNum: 'L1002', sketchName: 'זר', stage: 'pending' },
    o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'collected' },
    o4: { customerId: '777', orderNum: 'L1004', sketchName: 'כהן', stage: 'pending' },
    o5: { customerId: '777', orderNum: 'L1005', sketchName: 'בלי', stage: 'pending' },
  },
  sketches: { o1: SK, o2: SK, o3: SK, o4: SK },
  invoicePdf: {
    k1: { state: 'ready', docNumber: 34472, accountKey: '777', orderIds: ['o1', 'o3', 'o2', 'o5'] },
    k2: { state: 'ready', docNumber: 55555, accountKey: '999', orderIds: ['o2'] },
    k3: { state: 'printed', docNumber: 66666, accountKey: '777', orderIds: [] },
    k4: { state: 'ready', docNumber: '77777', accountKey: '777', orderIds: [] },
  },
  waMeta: { agentPilot: { 777: true } },
});
const F = (db, ref, text) => ar.lgArchiveFind(db, { customerId: '777', ref, text });

(async () => {
  const db = seed();
  check('wants: invoice', ar.lgArchiveWants('חשבונית ריכוז 34472'), { want: 'invoice', withSketches: false });
  check('wants: invoice + sketches', ar.lgArchiveWants('חשבונית 34472 עם הסקיצות'), { want: 'invoice', withSketches: true });
  check('wants: sketch', ar.lgArchiveWants('סקיצה להזמנה 4334'), { want: 'sketch', withSketches: false });

  check('invoice own ready', await F(db, '34472', 'חשבונית 34472'), { kind: 'invoice', invoiceKey: 'k1', docNumber: 34472, orderIds: [] });
  check('invoice docNumber stored as string', (await F(db, '77777', 'חשבונית 77777')).invoiceKey, 'k4');
  // ריכוז + עם הסקיצות: רק הזמנות שלו עם סקיצה (o2 זרה, o5 בלי סקיצה — נופלות)
  check('invoice + sketches filtered to own orders with a sketch',
    (await F(db, '34472', 'חשבונית ריכוז 34472 עם הסקיצות')).orderIds, ['o1', 'o3']);
  // Review Focus 5
  const other = await F(db, '55555', 'חשבונית 55555');
  check('FOCUS5: other customer invoice -> none', other, { kind: 'none' });
  check('FOCUS5: same result as a non-existent invoice', other, await F(db, '99999', 'חשבונית 99999'));
  check('not ready -> none', await F(db, '66666', 'חשבונית 66666'), { kind: 'none' });
  check('invoice without a number -> none', await F(db, '', 'תשלח לי חשבונית'), { kind: 'none' });

  check('sketch by order number', await F(db, '1001', 'סקיצה להזמנה 1001'), { kind: 'sketch', orderId: 'o1', orderIds: ['o1'] });
  check('sketch of collected order', (await F(db, 'L1003', 'סקיצה L1003')).orderId, 'o3');
  check('FOCUS5: other customer order sketch -> none', await F(db, 'L1002', 'סקיצה L1002'), { kind: 'none' });
  check('sketch many by name', (await F(db, 'כהן', 'סקיצה כהן')).orders.map(o => o.id), ['o1', 'o4']);
  check('sketch order without sketch -> none', await F(db, 'L1005', 'סקיצה L1005'), { kind: 'none' });
  check('sketch no ref -> none', await F(db, '', 'סקיצה'), { kind: 'none' });
  check('no keyword, digits ref -> invoice first', (await F(db, '34472', '34472')).kind, 'invoice');

  /* ── lgArchiveActions (טהור) ── */
  const r = { customerName: 'כהן זכוכית', text: 'חשבונית 99999', ref: '99999' };
  check('actions: not found', ar.lgArchiveActions(r, { kind: 'none' }, NOW).actions,
    [{ type: 'staff', text: 'ביקשו חשבונית 99999 — לא נמצא אצל כהן זכוכית' }, { type: 'reply', text: 'אני בודק ואחזור אליך' }]);
  check('actions: sketch not found wording', ar.lgArchiveActions({ ...r, text: 'סקיצה כהן', ref: 'כהן' }, { kind: 'none' }, NOW).actions[0].text,
    'ביקשו סקיצה כהן — לא נמצא אצל כהן זכוכית');
  check('actions: invoice + sketches',
    ar.lgArchiveActions(r, { kind: 'invoice', invoiceKey: 'k1', orderIds: ['o1'] }, NOW).actions,
    [{ type: 'files', text: 'מצורף', files: [{ kind: 'invoice-copy', invoiceKey: 'k1' }, { kind: 'sketch', orderId: 'o1' }] }]);

  /* ── lgAgentDecide: תוצאת החיפוש מוזנת, ההחלטה נשארת טהורה ── */
  const base = { timestamp: NOW, linked: true, route: 'archive', intent: 'document', customerName: 'כהן זכוכית', chatId: PRIV };
  const dm = act.lgAgentDecide({ rec: { ...base, text: 'סקיצה כהן', ref: 'כהן' }, orders: [], conv: null, now: NOW,
    archive: { kind: 'many', orders: [{ id: 'o1', orderNum: 'L1001', sketchName: 'כהן' }, { id: 'o4', orderNum: 'L1004', sketchName: 'כהן' }] } });
  check('decide many -> which list', [dm.actions[0].text, dm.conv], ['על איזו הזמנה מדובר?\n1. L1001 — כהן\n2. L1004 — כהן',
    { await: 'which', intent: 'document', orderIds: ['o1', 'o4'], at: NOW }]);
  const orders = [{ id: 'o1', customerId: '777', orderNum: 'L1001', sketchName: 'כהן' }, { id: 'o4', customerId: '777', orderNum: 'L1004', sketchName: 'כהן' }];
  const dw = act.lgAgentDecide({ rec: { ...base, timestamp: NOW + 1000, text: '2', route: 'shaul', intent: 'unclear' }, orders, conv: dm.conv, now: NOW + 1000 });
  check('which "2" -> sketch of 2nd', dw, { actions: [{ type: 'files', text: 'מצורף', files: [{ kind: 'sketch', orderId: 'o4' }] }], conv: null });
  const dn = act.lgAgentDecide({ rec: { ...base, text: 'חשבונית 5' }, orders: [], conv: null, now: NOW });
  check('decide without archive result -> shaul handoff', dn.actions.map(a => a.type), ['staff', 'reply']);

  /* ── lgAgentAct מקצה לקצה ── */
  const put = (d, k, rr) => { d._data.waMeta.agentShadow = d._data.waMeta.agentShadow || {}; d._data.waMeta.agentShadow[k] = { idMessage: 'M', chatId: PRIV, groupId: '', sender: '0501234567',
    hasImage: false, quotedId: '', state: 'done', timestamp: NOW, linked: true, route: 'archive', intent: 'document', customerId: '777', customerName: 'כהן זכוכית', ...rr }; };
  const outbox = d => Object.values((d._data.waMeta || {}).agentOutbox || {});
  const stub = async () => ({ sent: 0 });
  {
    const d = seed(); put(d, 'a1', { text: 'חשבונית 34472 עם הסקיצות', ref: '34472' });
    const res = await act.lgAgentAct(d, 'a1', { env: ON, now: NOW, sendPending: stub });
    check('act: found -> one entry to customer with files + מצורף', [res.acted, outbox(d).map(e => [e.to, e.text, e.files])],
      [true, [[PRIV, 'מצורף', [{ kind: 'invoice-copy', invoiceKey: 'k1' }, { kind: 'sketch', orderId: 'o1' }, { kind: 'sketch', orderId: 'o3' }]]]]);
  }
  {
    const d = seed(); put(d, 'a2', { text: 'חשבונית 55555', ref: '55555' });
    await act.lgAgentAct(d, 'a2', { env: ON, now: NOW, sendPending: stub });
    const o = outbox(d);
    check('act: other customer invoice -> staff + hold only', o.map(e => [e.to, e.text, e.files || []]).sort(),
      [[SHAUL, 'ביקשו חשבונית 55555 — לא נמצא אצל כהן זכוכית', []], [PRIV, 'אני בודק ואחזור אליך', []]].sort());
    check('act: no invoice-copy file queued', JSON.stringify(o).includes('invoice-copy'), false);
  }
  {
    const d = seed(); put(d, 'a3', { text: 'סקיצה כהן', ref: 'כהן' });
    await act.lgAgentAct(d, 'a3', { env: ON, now: NOW, sendPending: stub });
    const cv = d._data.waMeta.agentConv && Object.values(d._data.waMeta.agentConv)[0];
    check('act: many -> list to customer + conv which(document)', [outbox(d).length, cv && cv.await, cv && cv.intent, cv && cv.orderIds], [1, 'which', 'document', ['o1', 'o4']]);
  }
  {
    const d = seed(); put(d, 'a4', { text: 'חשבונית 34472', ref: '34472' });
    const res = await act.lgAgentAct(d, 'a4', { env: { ...ON, AGENT_REPLY_ENABLED: 'false' }, now: NOW, sendPending: stub });
    check('act: switches off -> wouldAct only, nothing queued', [res.acted, outbox(d).length], [false, 0]);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
