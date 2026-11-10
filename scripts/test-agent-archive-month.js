#!/usr/bin/env node
/**
 * שיפור 4 (חדר הסוכנים): ארכיון — "כל החשבוניות של אוקטובר" / 10/2026.
 * רק חשבוניות 'ready' של אותו לקוח (accountKey), לפי תאריך החשבונית (date). עד 10 —
 * נשלחות דרך שכבת השליחה; יותר → הודעה אחת עם הכמות + צהוב לבן; אין → "לא יודע → בן".
 * בלי הגדרות במסך — כמו קודם (חיפוש לפי מספר בלבד).
 * Run:  node scripts/test-agent-archive-month.js
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

const NOW = Date.UTC(2026, 10, 11, 10);          // 11/11/2026
const DAY = 24 * 3600 * 1000;
const OCT = Date.UTC(2026, 9, 15);
const PRIV = '972501234567@c.us';
const BEN = '0547725552';
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222' };
const CFG = mode => ({ agents: { markazan: 'reply', okev: 'reply', archive: mode, price: 'reply', kolet: 'reply', manager: 'reply' }, escalatePhone: BEN });

const inv = (doc, date, acct, state, created) => ({ state: state || 'ready', docNumber: doc, date, accountKey: acct || '777', createdAt: created || Date.parse(date + 'T08:00:00Z'), orderIds: [] });
const seed = (cfg, extra) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  orders: {},
  invoicePdf: {
    a1: inv(1001, '2026-10-02'), a2: inv(1002, '2026-10-20'),
    a3: inv(1003, '2026-10-31', '777', 'ready', Date.UTC(2026, 10, 1, 7)),   // הודפסה בנובמבר, החשבונית מאוקטובר
    b1: inv(2001, '2026-10-05', '999'),                                          // לקוח אחר
    c1: inv(1004, '2026-10-08', '777', 'printed'),                               // לא מוכנה
    d1: inv(1005, '2026-09-29'), e1: inv(1006, '2026-11-02'),
    ...(extra || {}),
  },
  waMeta: { agentPilot: { 777: true }, ...(cfg ? { agentConfig: cfg } : {}) },
});
const put = (d, k, rr) => { d._data.waMeta.agentShadow = d._data.waMeta.agentShadow || {}; d._data.waMeta.agentShadow[k] = { idMessage: k, chatId: PRIV, groupId: '', sender: '0501234567',
  hasImage: false, quotedId: '', state: 'done', timestamp: NOW, linked: true, linkVia: 'sender', route: 'archive', intent: 'document', customerId: '777', customerName: 'כהן זכוכית', ref: '', ...rr }; };
const outbox = d => Object.values((d._data.waMeta || {}).agentOutbox || {});
const stub = async () => ({ sent: 0 });

(async () => {
  /* ── זיהוי החודש (טהור) ── */
  check('month: Hebrew name, no year → last October', ar.lgArchiveMonth('תשלח לי את כל החשבוניות של אוקטובר', NOW), '2026-10');
  check('month: prefixed (מאוקטובר)', ar.lgArchiveMonth('חשבוניות מאוקטובר', NOW), '2026-10');
  check('month: future month without year → last year', ar.lgArchiveMonth('חשבוניות של דצמבר', NOW), '2025-12');
  check('month: with year', ar.lgArchiveMonth('חשבוניות ספטמבר 2025', NOW), '2025-09');
  check('month: MM/YYYY', ar.lgArchiveMonth('חשבוניות 10/2026', NOW), '2026-10');
  check('month: M/YY', ar.lgArchiveMonth('חשבוניות 9/26', NOW), '2026-09');
  check('month: a date is not a month', ar.lgArchiveMonth('חשבונית מ-15/10/2026', NOW), '');
  check('month: none', ar.lgArchiveMonth('חשבונית 34472', NOW), '');

  /* ── חיפוש ── */
  const F = (d, text, ref) => ar.lgArchiveFind(d, { customerId: '777', ref: ref || '', text, byMonth: true, now: NOW });
  {
    const d = seed(CFG('reply'));
    check('find: October → only own ready invoices dated October (by invoice date)',
      await F(d, 'כל החשבוניות של אוקטובר'), { kind: 'invoices', month: '2026-10', invoiceKeys: ['a1', 'a2', 'a3'], count: 3 });
    check('find: a doc number wins over the month', (await F(d, 'חשבונית 1002 מאוקטובר', '1002')).kind, 'invoice');
    check('find: empty month → none (with the month)', await F(d, 'חשבוניות של מרץ'), { kind: 'none', month: '2026-03' });
    check('find: without byMonth → old behavior (none: no number)',
      await ar.lgArchiveFind(d, { customerId: '777', ref: '', text: 'כל החשבוניות של אוקטובר' }), { kind: 'none' });
    const many = {};
    for (let i = 0; i < 9; i++) many['m' + i] = inv(3000 + i, '2026-10-1' + i);
    const d2 = seed(CFG('reply'), many);
    check('find: more than 10 → too many with the count', await F(d2, 'חשבוניות אוקטובר'), { kind: 'invoices-many', month: '2026-10', count: 12 });
  }

  /* ── act ── */
  {
    const d = seed(CFG('reply')); put(d, 'r1', { text: 'תשלח לי את כל החשבוניות של אוקטובר', ref: 'אוקטובר' });
    const res = await act.lgAgentAct(d, 'r1', { env: ON, now: NOW, sendPending: stub });
    const o = outbox(d);
    check('act: 3 invoice copies to the customer, text on the first',
      [res.acted, o.map(e => [e.to, e.reason, e.files.map(f => f.invoiceKey), e.text])],
      [true, [[PRIV, 'agent-files', ['a1'], 'מצורפות 3 חשבוניות מאוקטובר 2026'], [PRIV, 'agent-files', ['a2'], ''], [PRIV, 'agent-files', ['a3'], '']]]);
  }
  {
    const many = {};
    for (let i = 0; i < 9; i++) many['m' + i] = inv(3000 + i, '2026-10-1' + i);
    const d = seed(CFG('reply'), many); put(d, 'r2', { text: 'כל החשבוניות של אוקטובר' });
    await act.lgAgentAct(d, 'r2', { env: ON, now: NOW, sendPending: stub });
    const o = outbox(d);
    check('act >10: one message with the count to the customer, Ben pinged, no files',
      [o.filter(e => e.to === PRIV).map(e => e.text), o.filter(e => e.to === BEN).length, o.some(e => e.files.length)],
      [['יש 12 חשבוניות מאוקטובר 2026 — יותר מדי לשלוח כאן. אנחנו בודקים ונחזור אליך בהקדם.'], 1, false]);
    const ask = Object.values(d._data.waMeta.agentRoom).find(v => v.kind === 'ask');
    check('act >10: yellow ask for ארכיון with the count', [ask.agent, ask.note], ['archive', 'ביקשו את כל החשבוניות מאוקטובר 2026 — 12 חשבוניות, יותר מ-10']);
  }
  {
    const d = seed(CFG('reply')); put(d, 'r3', { text: 'חשבוניות של מרץ' });
    await act.lgAgentAct(d, 'r3', { env: ON, now: NOW, sendPending: stub });
    const ask = Object.values(d._data.waMeta.agentRoom).find(v => v.kind === 'ask');
    check('act none: normal "don\'t know → Ben"', [ask.note, outbox(d).filter(e => e.to === PRIV).map(e => e.text)],
      ['ביקשו חשבוניות ממרץ 2026 — לא נמצא', ['קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.']]);
  }
  {
    const d = seed(CFG('shadow')); put(d, 'r4', { text: 'כל החשבוניות של אוקטובר' });
    const res = await act.lgAgentAct(d, 'r4', { env: ON, now: NOW, sendPending: stub });
    check('act shadow: nothing sent, wouldAct shows the files', [res.acted, outbox(d).length, d._data.waMeta.agentShadow.r4.wouldAct[0].files.length], [false, 0, 3]);
  }
  {
    const d = seed(null); put(d, 'r5', { text: 'כל החשבוניות של אוקטובר' });
    await act.lgAgentAct(d, 'r5', { env: ON, now: NOW, sendPending: stub });
    check('no agentConfig: unchanged — no invoice files go out', outbox(d).filter(e => e.files.length).length, 0);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
