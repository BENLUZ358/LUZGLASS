#!/usr/bin/env node
/**
 * שיפור 6 (חדר הסוכנים, "שיפורים לכל סוכן"): הצעת מחיר על סקיצה → לבן, לא לשאול.
 * עם הגדרות במסך (waMeta/agentConfig): צהוב בחדר (agent price) + וואטסאפ לבן עם התמונה,
 * ללקוח "קיבלנו, נחזור אליך עם מחיר"; בן עונה בחדר → התשובה יוצאת ללקוח.
 * בלי הגדרות — בדיוק כמו קודם (בקשת מחיר לשאול, waMeta/agentQuotes).
 * Run:  node scripts/test-agent-quote-ben.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const ROOMJS = require(path.join(ROOT, 'api', '_agent-room.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const QHOLD = 'קיבלנו, נחזור אליך עם מחיר';
const BEN = '0547725552';
const CFG = mode => ({ agents: { markazan: 'reply', okev: 'reply', archive: 'reply', price: mode, kolet: 'reply', manager: 'reply' }, escalatePhone: BEN });

const seed = cfg => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
  orders: {},
  waMeta: { agentPilot: { 777: true }, ...(cfg ? { agentConfig: cfg } : {}) },
});
const put = (d, k, rr) => { d._data.waMeta.agentShadow = d._data.waMeta.agentShadow || {}; d._data.waMeta.agentShadow[k] = { idMessage: 'IMG1', chatId: PRIV, groupId: '', sender: '0501234567',
  hasImage: true, quotedId: '', state: 'done', timestamp: NOW, linked: true, linkVia: 'sender', route: 'quote', intent: 'quote', customerId: '777', customerName: 'כהן זכוכית', text: 'כמה עולה?', ...rr }; };
const outbox = d => (d._data.waMeta || {}).agentOutbox || {};
const room = d => Object.entries((d._data.waMeta || {}).agentRoom || {});
const stub = async () => ({ sent: 0 });

(async () => {
  /* ── decide (טהור) ── */
  const base = { timestamp: NOW, linked: true, route: 'quote', intent: 'quote', customerName: 'כהן זכוכית', chatId: PRIV, idMessage: 'M1', text: 'כמה?', hasImage: true };
  const toBen = act.lgAgentDecide({ rec: base, orders: [], conv: null, now: NOW, quoteToBen: true });
  check('decide quoteToBen: sketch → ask (Ben) with the quote hold text + the image',
    toBen.actions, [{ type: 'ask', who: 'כהן זכוכית', question: 'כמה?', hold: QHOLD, note: 'כהן זכוכית: בקשת מחיר על סקיצה',
                      files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'M1' }] }]);
  const legacy = act.lgAgentDecide({ rec: base, orders: [], conv: null, now: NOW });
  check('decide without quoteToBen: unchanged (quote-ask to Shaul)', legacy.actions.map(a => a.type), ['reply', 'quote-ask']);

  /* ── act: הגדרות במסך, המחירון "עונה" ── */
  {
    const d = seed(CFG('reply')); put(d, 's1', {});
    const res = await act.lgAgentAct(d, 's1', { env: ON, now: NOW, sendPending: stub });
    const o = Object.values(outbox(d));
    check('reply: acted', res.acted, true);
    check('reply: customer got the quote hold text', o.filter(e => e.to === PRIV).map(e => e.text), [QHOLD]);
    check('reply: Ben got the ping with the forwarded sketch (agent-ask)',
      o.filter(e => e.to === BEN).map(e => [e.reason, e.files.map(f => f.kind), e.text.split('\n')[0]]),
      [['agent-ask', ['forward'], 'יש שאלה שמחכה לך בחדר הסוכנים: כהן זכוכית — כמה עולה?']]);
    check('reply: nothing to Shaul, no waiting quote request', [o.filter(e => e.to === '0501112222').length, d._data.waMeta.agentQuotes || null], [0, null]);
    const asks = room(d).filter(([, v]) => v.kind === 'ask');
    check('reply: one open yellow ask for מחירון', asks.map(([, v]) => [v.agent, v.state, v.customerId, v.chat]), [['price', 'open', '777', PRIV]]);
    // בן עונה בחדר → ללקוח
    const r = await ROOMJS.lgRoomAnswer(d, { key: asks[0][0], text: 'מראה 450 ₪ + מע"מ' }, { now: NOW + 1000, by: 'ben', sendPending: stub });
    check('Ben answers in the room → queued to the customer', [r.ok, outbox(d)[r.outboxKey].to, outbox(d)[r.outboxKey].text, outbox(d)[r.outboxKey].customerId],
      [true, PRIV, 'מראה 450 ₪ + מע"מ', '777']);
  }
  /* ── act: המחירון "שקט" → רק wouldAct ── */
  {
    const d = seed(CFG('shadow')); put(d, 's2', {});
    const res = await act.lgAgentAct(d, 's2', { env: ON, now: NOW, sendPending: stub });
    check('shadow: not acted, nothing queued, wouldAct = ask', [res.acted, Object.keys(outbox(d)).length, d._data.waMeta.agentShadow.s2.wouldAct.map(a => a.type)],
      [false, 0, ['ask']]);
  }
  /* ── act: בלי הגדרות במסך → בדיוק כמו קודם (שאול) ── */
  {
    const d = seed(null); put(d, 's3', {});
    await act.lgAgentAct(d, 's3', { env: ON, now: NOW, sendPending: stub });
    const o = Object.values(outbox(d));
    check('no agentConfig: unchanged — Shaul request + "נחזור אליך עם מחיר", nothing to Ben, no room ask',
      [o.filter(e => e.to === '0501112222').length > 0, o.filter(e => e.to === PRIV).map(e => e.text), o.filter(e => e.to === BEN).length,
       d._data.waMeta.agentQuotes[1].state, room(d).filter(([, v]) => v.kind === 'ask').length],
      [true, [QHOLD], 0, 'waiting', 0]);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
