#!/usr/bin/env node
/**
 * "איך שולחים הזמנה בטקסט" (בן, 13/11): הקולט מסביר — רק ללקוח שמסומן ב"הזמנות
 * מטקסט חופשי" (waMeta/textCustomers) וכותב בצ'אט פרטי. אחרת — שאלה לבן.
 * Run:  node scripts/test-agent-howto.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const C = require(path.join(ROOT, 'api', '_agent-config.js'));
const K = require(path.join(ROOT, 'api', '_agent-okev.js'));
const { AGENT_INTENTS } = require(path.join(ROOT, 'api', '_agent-classify.js'));
let failed = 0;
//  עטיפת הנוסח (שילוב): המודל המדומה בוחר את הפתיחה המותרת הראשונה — בלי רשת
global.fetch = async (url, init) => {
  const sc = JSON.parse(init.body).text.format.schema.properties;
  const pick = { opener: sc.opener.enum.find(i => i >= 0), closer: -1 };
  return { ok: true, json: async () => ({ status: 'completed', usage: null,
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(pick) }] }] }) };
};
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const PRIV = '972501234567@c.us';
const GRP = '120363000000000001@g.us';
const SH = { AGENT_SHADOW_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm', OPENAI_API_KEY: 'k' };
const CFG = kolet => ({ agents: { markazan: 'shadow', okev: 'shadow', archive: 'shadow', price: 'shadow', kolet, manager: 'shadow' } });
const seed = (cfg, textOn) => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'טום גלאס' } },
  waGroups: { [GRP]: { customerId: '777', customerName: 'טום גלאס' } },
  hashavshevetAccounts: { 777: { name: 'טום גלאס' } },
  orders: {},
  waMeta: { agentPilot: { 777: true }, ...(cfg ? { agentConfig: cfg } : {}),
            ...(textOn ? { textCustomers: { 777: { customerName: 'טום גלאס' } } } : {}) },
});
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'אפשר לשלוח לך מידות בטקסט?', quotedId: '',
  hasImage: false, linked: true, linkVia: 'sender', state: 'done', intent: 'howto', ref: '', route: 'kolet-howto',
  customerId: '777', customerName: 'טום גלאס', timestamp: NOW, ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const runAct = (db, k) => act.lgAgentAct(db, k, { env: SH, now: NOW, sendPending: async () => ({ sent: 0 }) });
const D = (r, textOn) => act.lgAgentDecide({ rec: R(r), orders: [], conv: null, now: NOW, textOn });

(async () => {
  /* ── סיווג וניתוב ── */
  check('classifier knows "howto"', AGENT_INTENTS.includes('howto'), true);
  check('howto → kolet-howto (private and group)', [K.lgOkevRoute({ intent: 'howto', linked: true }), K.lgOkevRoute({ intent: 'howto', linked: true, isGroup: true })],
    ['kolet-howto', 'kolet-howto']);
  check('not linked → still to Shaul as before', K.lgOkevRoute({ intent: 'howto', linked: false }), 'shaul');
  check('kolet-howto belongs to the kolet agent', C.lgAgentOfRoute('kolet-howto'), 'kolet');

  /* ── ההחלטה (טהור) ── */
  const yes = D({}, true);
  check('marked + private → the how-to reply', [yes.actions.length, yes.actions[0].type, yes.actions[0].text], [1, 'reply', K.KOLET_HOWTO_TEXT]);
  check('the reply has the example line', K.KOLET_HOWTO_TEXT.includes('מראה 5 80 על 60 X2'), true);
  check('not marked → a question to Ben, no reply', D({}, false).actions.map(a => a.type), ['ask']);
  check('marked but from a group → a question to Ben (text orders work only in private chats)',
    D({ groupId: GRP, chatId: GRP, linkVia: 'group' }, true).actions.map(a => a.type), ['ask']);
  check('not linked → nothing', D({ linked: false }, true).actions, []);

  /* ── act: הקריאה של waMeta/textCustomers + המתג של הקולט ── */
  {
    const db = seed(CFG('reply'), true);
    put(db, 'H1', R({ idMessage: 'H1' }));
    const r = await runAct(db, 'H1');
    const q = outbox(db).H1_0 || {};
    check('kolet "reply" + marked customer → reply queued to him, by kolet', [r.acted, q.agent, q.to, String(q.text || '').endsWith(K.KOLET_HOWTO_TEXT)],
      [true, 'kolet', PRIV, true]);
  }
  {
    const db = seed(CFG('reply'), false);
    put(db, 'H2', R({ idMessage: 'H2' }));
    await runAct(db, 'H2');
    const types = (rec(db, 'H2').wouldAct || []).map(a => a.type);
    check('kolet "reply" + customer NOT marked → no how-to reply, a question instead', [types, Object.values(outbox(db)).some(x => String(x.text || '').includes('מראה 5 80 על 60'))],
      [['ask'], false]);
  }
  {
    const db = seed(CFG('shadow'), true);
    put(db, 'H3', R({ idMessage: 'H3' }));
    const r = await runAct(db, 'H3');
    check('kolet "shadow" → nothing sent, but the screen shows what it would say',
      [r.acted, Object.keys(outbox(db)).length, (rec(db, 'H3').wouldAct || [])[0] && rec(db, 'H3').wouldAct[0].text], [false, 0, K.KOLET_HOWTO_TEXT]);
  }
  {
    const db = seed(null, true);
    put(db, 'H4', R({ idMessage: 'H4' }));
    const r = await runAct(db, 'H4');
    check('no agent settings at all (today in prod) → nothing sent', [r.acted, Object.keys(outbox(db)).length], [false, 0]);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
