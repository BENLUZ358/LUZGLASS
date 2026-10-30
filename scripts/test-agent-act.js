#!/usr/bin/env node
/**
 * מרכזן+עוקב עונים בפועל (שלב 2, משימה 2) — החלטה טהורה (lgAgentDecide),
 * מצב שיחה (waMeta/agentConv), פיילוט ומתגים, העברה לשאול, אישור ביטול.
 * Run:  node scripts/test-agent-act.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const sh = require(path.join(ROOT, 'api', '_agent-shadow.js'));
const { AGENT_MENU_TEXT } = require(path.join(ROOT, 'api', '_agent-okev.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const MIN = 60 * 1000;
const PRIV = '972501234567@c.us';        // מקושר ב-waSenders → לקוח 777 (בפיילוט)
const PRIV2 = '972507777777@c.us';       // מקושר → לקוח 999 (לא בפיילוט)
const STRANGER = '972549999999@c.us';
const SHAUL = '972501112222@c.us';
const GROUP = '120363000000@g.us';       // קבוצה מקושרת → לקוח 888 (בפיילוט)
const key = id => String(id).replace(/[.#$[\]/]/g, '_');
const HANDOFF = 'העברנו לשאול, הוא יחזור אליך';
const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222,0531234567',
             AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' };

const ORDERS = {
  o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday', waMessageId: 'WA1' },
  o2: { customerId: '999', orderNum: 'L1002', sketchName: 'כהן', stage: 'pending' },
  o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending' },
  o4: { customerId: '777', orderNum: 'L1004', sketchName: 'אמבטיה', stage: 'chash' },
};
const seed = extra => fakeDb({
  waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' }, '0507777777': { customerId: '999' } },
  waGroups: { [key(GROUP)]: { customerId: '888', customerName: 'קבוצת לוי' } },
  hashavshevetAccounts: { 777: { name: 'כהן זכוכית' }, 888: { name: 'לוי' }, 999: { name: 'אחר' } },
  orders: JSON.parse(JSON.stringify(ORDERS)),
  waMeta: { agentPilot: { 777: true, 888: true }, ...(extra || {}) },
});
const list = cid => Object.entries(ORDERS).filter(([, o]) => o.customerId === cid).map(([id, o]) => ({ ...o, id }));

// רשומה מוכנה (state done) — כמו מה ש-lgAgentShadowProcess כותב
const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: '', quotedId: '', hasImage: false,
  linked: true, state: 'done', intent: '', ref: '', route: 'okev', customerId: '777', customerName: 'כהן זכוכית', ...o });
const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
const rec = (db, k) => db._data.waMeta.agentShadow[k];
const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
const conv = (db, chat) => ((db._data.waMeta || {}).agentConv || {})[key(chat)];
const noSend = { calls: 0 };
const sendStub = async () => { noSend.calls++; return { sent: 0 }; };
const run = (db, k, env, now) => act.lgAgentAct(db, k, { env: env || ON, now: now || NOW, sendPending: sendStub });

const D = (rec_, conv_, orders_, now_) => act.lgAgentDecide({ rec: rec_, orders: orders_ || list('777'), conv: conv_ || null, now: now_ || NOW });

(async () => {
  check('constants', [act.CONV, act.CONV_TTL_MS], ['waMeta/agentConv', 30 * 60 * 1000]);

  /* ── lgAgentDecide: טבלה ─────────────────────────────────────────── */
  {
    const d = D(R({ intent: 'status', ref: 'כהן' }));
    check('status, one match → reply עוקב, no conv', d, { actions: [{ type: 'reply', text: 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור' }], conv: null });

    const m = D(R({ intent: 'status', ref: '' }));
    check('many → list reply', m.actions, [{ type: 'reply', text: 'על איזו הזמנה מדובר?\n1. L1001 — כהן\n2. L1003 — מטבח\n3. L1004 — אמבטיה' }]);
    check('many → conv which', m.conv, { await: 'which', intent: 'status', orderIds: ['o1', 'o3', 'o4'], at: NOW });

    const w1 = D(R({ text: '3', intent: 'unclear', route: 'shaul' }), m.conv, null, NOW + MIN);
    check('which + "3" → status of the 3rd, conv cleared', w1, { actions: [{ type: 'reply', text: 'הזמנה L1004 (סקיצה: אמבטיה): ההזמנה בהכנה' }], conv: null });
    const w2 = D(R({ text: 'מטבח', intent: 'unclear', route: 'shaul' }), m.conv, null, NOW + MIN);
    check('which + name → that order', w2.actions[0].text, 'הזמנה L1003 (סקיצה: מטבח): קיבלנו, ההזמנה בבדיקה');
    const w3 = D(R({ text: '7', intent: 'unclear', route: 'shaul' }), m.conv, null, NOW + MIN);
    check('which + out-of-range number → normal routing (shaul), conv kept',
      [w3.actions.map(a => a.type), w3.conv], [['staff', 'reply'], m.conv]);

    const mc = D(R({ intent: 'cancel', ref: '' }));
    const wc = D(R({ text: '2', intent: 'unclear', route: 'shaul' }), mc.conv, null, NOW + MIN);
    check('which (cancel) + "2" → confirm question + conv confirm-cancel',
      wc, { actions: [{ type: 'reply', text: 'בטוח לבטל את הזמנה L1003 (סקיצה: מטבח)?' }], conv: { await: 'confirm-cancel', orderId: 'o3', at: NOW + MIN } });

    const c = D(R({ intent: 'cancel', ref: 'מטבח' }));
    check('cancel allowed → "בטוח?" + conv confirm-cancel',
      c, { actions: [{ type: 'reply', text: 'בטוח לבטל את הזמנה L1003 (סקיצה: מטבח)?' }], conv: { await: 'confirm-cancel', orderId: 'o3', at: NOW } });

    for (const yes of ['כן', 'כן תבטל', 'בטוח', 'כן בטוח', 'תבטל', 'יאללה', ' כן!! ', 'כן, תבטל.']) {
      const y = D(R({ text: yes, intent: 'unclear', route: 'shaul' }), c.conv, null, NOW + 10 * MIN);
      check('confirm + "' + yes + '" → cancel action, conv cleared',
        [y.actions.map(a => [a.type, a.orderId]), y.conv], [[['cancel', 'o3']], null]);
    }
    const y = D(R({ text: 'כן', intent: 'unclear', route: 'shaul' }), c.conv, null, NOW + 10 * MIN);
    check('cancel action carries the texts', [y.actions[0].okText, y.actions[0].lateText],
      ['ההזמנה בוטלה', 'הזמנה L1003 כבר בייצור ואי אפשר לבטל או לשנות אותה']);
    for (const no of ['לא', 'לא תבטל', 'עזוב', 'תשאיר']) {
      const n = D(R({ text: no, intent: 'unclear', route: 'shaul' }), c.conv, null, NOW + MIN);
      check('confirm + "' + no + '" → "בסדר, ההזמנה ממשיכה", conv cleared', n, { actions: [{ type: 'reply', text: 'בסדר, ההזמנה ממשיכה' }], conv: null });
    }
    const other = D(R({ text: 'מה עם כהן?', intent: 'status', ref: 'כהן' }), c.conv, null, NOW + MIN);
    check('confirm + something else → normal routing, conv kept',
      [other.actions, other.conv], [[{ type: 'reply', text: 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור' }], c.conv]);

    // Review Focus 2: "כן" אחרי יותר מ-30 דקות → לא מבטל; שואל מחדש
    const late = D(R({ text: 'כן', intent: 'unclear', route: 'shaul' }), c.conv, null, NOW + 31 * MIN);
    check('focus 2: "כן" after 31 min → no cancel, asks again with a fresh conv',
      late, { actions: [{ type: 'reply', text: 'בטוח לבטל את הזמנה L1003 (סקיצה: מטבח)?' }], conv: { await: 'confirm-cancel', orderId: 'o3', at: NOW + 31 * MIN } });
    const lateNo = D(R({ text: 'מה עם כהן?', intent: 'status', ref: 'כהן' }), c.conv, null, NOW + 31 * MIN);
    check('expired conv + other message → normal routing, conv deleted', [lateNo.actions.length, lateNo.conv], [1, null]);
    // הזמנה שירדה לייצור בין השאלה ל"כן"
    const moved = list('777').map(o => o.id === 'o3' ? { ...o, stage: 'workday' } : o);
    const y2 = D(R({ text: 'כן', intent: 'unclear', route: 'shaul' }), c.conv, moved, NOW + MIN);
    check('confirm "כן" but order now in workday → too-late text, no cancel',
      y2, { actions: [{ type: 'reply', text: 'הזמנה L1003 כבר בייצור ואי אפשר לבטל או לשנות אותה' }], conv: null });

    const ch = D(R({ intent: 'change', ref: 'מטבח' }));
    check('change allowed → "מה בדיוק לשנות?" + conv change-details',
      ch, { actions: [{ type: 'reply', text: 'מה בדיוק לשנות בהזמנה L1003 (סקיצה: מטבח)?' }], conv: { await: 'change-details', orderId: 'o3', at: NOW } });
    const det = D(R({ text: 'הרוחב 90 ולא 80', intent: 'change', route: 'okev' }), ch.conv, null, NOW + MIN);
    check('change-details + answer → staff with details + handoff reply, conv cleared', det, { actions: [
      { type: 'staff', text: 'שינוי בהזמנה L1003 (מטבח) של כהן זכוכית: הרוחב 90 ולא 80' },
      { type: 'reply', text: HANDOFF }], conv: null });

    check('cancel not allowed (workday) → עוקב text, no conv',
      D(R({ intent: 'cancel', ref: 'כהן' })), { actions: [{ type: 'reply', text: 'הזמנה L1001 כבר בייצור ואי אפשר לבטל או לשנות אותה' }], conv: null });
    check('change not allowed (workday) → עוקב text',
      D(R({ intent: 'change', ref: 'L1001' })).actions, [{ type: 'reply', text: 'הזמנה L1001 כבר בייצור ואי אפשר לבטל או לשנות אותה' }]);

    check('menu → AGENT_MENU_TEXT', D(R({ route: 'menu', intent: 'chitchat', text: 'היי' })).actions, [{ type: 'reply', text: AGENT_MENU_TEXT }]);

    check('shaul (linked) → staff "<לקוח>: <טקסט>" + handoff reply',
      D(R({ route: 'shaul', intent: 'unclear', text: 'יש לכם זכוכית חכמה?' })).actions,
      [{ type: 'staff', text: 'כהן זכוכית: יש לכם זכוכית חכמה?' }, { type: 'reply', text: HANDOFF }]);
    check('shaul (linked, no name) → phone prefix',
      D(R({ route: 'shaul', intent: 'angry', text: 'איפה ההזמנה???', customerName: '' })).actions[0],
      { type: 'staff', text: '0501234567: איפה ההזמנה???' });
    const un = D(R({ route: 'shaul', linked: false, customerId: '', customerName: '', chatId: STRANGER, sender: '0549999999', text: undefined }), null, []);
    check('shaul (unlinked) → staff only (text + forward of the message), no reply', un.actions, [
      { type: 'staff', text: '0549999999: הודעה ממספר שלא מקושר ללקוח' },
      { type: 'staff', text: '', files: [{ kind: 'forward', fromChat: STRANGER, idMessage: 'M1' }] }]);

    for (const r of ['silent-human', 'ignore', 'none', 'staff', 'kolet'])
      check(r + ' → no action', D(R({ route: r, intent: 'status', ref: 'כהן', text: 'כן' })).actions, []);
    for (const r of ['silent-human', 'staff'])
      check(r + ' + conv confirm + "כן" → still no action', D(R({ route: r, text: 'כן' }), c.conv, null, NOW + MIN).actions, []);
    check('"כן" classified as thanks (route none) still answers the confirm question',
      D(R({ route: 'none', intent: 'thanks', text: 'כן' }), c.conv, null, NOW + MIN).actions.map(a => a.type), ['cancel']);
    check('silent-human keeps conv untouched', D(R({ route: 'silent-human', text: 'כן' }), c.conv, null, NOW + MIN).conv, c.conv);
  }

  /* ── lgAgentAct: פיילוט ומתגים ───────────────────────────────────── */
  {
    const db = seed(); put(db, 'K1', R({ intent: 'status', ref: 'כהן' }));
    const r = await run(db, 'K1');
    check('pilot customer → acted:true', r.acted, true);
    check('queued once, key <rec>_0, to the private chat',
      [Object.keys(outbox(db)), outbox(db).K1_0.to, outbox(db).K1_0.customerId, outbox(db).K1_0.text, outbox(db).K1_0.state],
      [['K1_0'], PRIV, '777', 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור', 'pending']);
    check('record: wouldAct + acted', [rec(db, 'K1').wouldAct, rec(db, 'K1').acted], [r.actions, true]);
    check('sendPending triggered after enqueue', noSend.calls, 1);
    const again = await run(db, 'K1');
    check('act twice → nothing new queued, send not re-triggered', [Object.keys(outbox(db)).length, again.acted, noSend.calls], [1, false, 1]);
  }
  {
    const db = seed(); put(db, 'K2', R({ customerId: '999', chatId: PRIV2, sender: '0507777777', customerName: '', intent: 'status', ref: 'כהן' }));
    const r = await run(db, 'K2');
    check('not in pilot → acted:false, wouldAct full, no queue',
      [r.acted, rec(db, 'K2').acted, rec(db, 'K2').wouldAct, Object.keys(outbox(db)).length],
      [false, false, [{ type: 'reply', text: 'הזמנה L1002 (סקיצה: כהן): קיבלנו, ההזמנה בבדיקה' }], 0]);
  }
  for (const env of [{ ...ON, AGENT_REPLY_ENABLED: 'false' }, { ...ON, AGENT_SHADOW_ENABLED: '' }]) {
    const db = seed(); put(db, 'K3', R({ intent: 'status', ref: 'כהן' }));
    const r = await run(db, 'K3', env);
    check('switch off → acted:false, wouldAct full, no queue',
      [r.acted, rec(db, 'K3').acted, rec(db, 'K3').wouldAct.length, Object.keys(outbox(db)).length], [false, false, 1, 0]);
  }
  {
    // לא בפיילוט — שאלת "בטוח?" לא נשלחה, ולכן גם conv לא נשמר
    const db = seed(); put(db, 'K4', R({ customerId: '999', chatId: PRIV2, sender: '0507777777', intent: 'cancel', ref: 'כהן' }));
    await run(db, 'K4');
    check('not acted → conv not written', conv(db, PRIV2), undefined);
  }

  /* ── קבוצה, שאול ── */
  {
    const db = seed(); put(db, 'G1', R({ chatId: GROUP, groupId: GROUP, sender: '0521111111', customerId: '888', customerName: 'קבוצת לוי',
      route: 'shaul', intent: 'unclear', text: 'שאלה' }));
    await run(db, 'G1');
    check('group shaul → staff to Shaul (first staff phone) + reply to the group',
      [outbox(db).G1_0.to, outbox(db).G1_0.text, outbox(db).G1_0.customerId, outbox(db).G1_1.to, outbox(db).G1_1.text],
      ['0501112222', 'קבוצת לוי: שאלה', '888', GROUP, HANDOFF]);
  }
  {
    const db = seed(); put(db, 'U1', R({ route: 'shaul', linked: false, customerId: '', customerName: '', chatId: STRANGER, sender: '0549999999' }));
    delete rec(db, 'U1').text;
    const r = await run(db, 'U1');
    check('unlinked → acted (staff only), two staff entries, nothing to the stranger',
      [r.acted, Object.values(outbox(db)).map(x => x.to), outbox(db).U1_1.files],
      [true, ['0501112222', '0501112222'], [{ kind: 'forward', fromChat: STRANGER, idMessage: 'M1' }]]);
  }
  {
    const db = seed(); put(db, 'S0', R({ route: 'shaul', intent: 'unclear', text: 'x' }));
    const r = await run(db, 'S0', { ...ON, AGENT_STAFF_PHONES: '' });
    check('no AGENT_STAFF_PHONES → handoff not acted (would lie "העברנו לשאול")', [r.acted, Object.keys(outbox(db)).length], [false, 0]);
  }

  /* ── conv בבסיס הנתונים ── */
  {
    const db = seed(); put(db, 'C1', R({ intent: 'cancel', ref: 'מטבח', idMessage: 'C1' }));
    await run(db, 'C1');
    check('cancel question → conv saved under the chat', conv(db, PRIV), { await: 'confirm-cancel', orderId: 'o3', at: NOW });

    // R1: lgAgentCancel עוד לא קיים (משימה 3) — כאן מזויף
    const calls = [];
    act.lgAgentCancel = async (d, orderId, ctx) => { calls.push([orderId, ctx.customerId, ctx.chatId]); return { ok: true, code: '' }; };
    put(db, 'C2', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C2' }));
    const r = await run(db, 'C2', ON, NOW + 5 * MIN);
    check('"כן" → cancel called once with customer + chat', calls, [['o3', '777', PRIV]]);
    check('"כן" → "ההזמנה בוטלה" queued, conv deleted', [outbox(db).C2_0.text, conv(db, PRIV), r.acted], ['ההזמנה בוטלה', undefined, true]);
    // Review Focus 4: אותה הודעה פעמיים → ביטול ושליחה פעם אחת
    await run(db, 'C2', ON, NOW + 6 * MIN);
    check('focus 4: act again on the same record → cancel not called again, one entry',
      [calls.length, Object.keys(outbox(db)).filter(k => k.startsWith('C2')).length], [1, 1]);

    act.lgAgentCancel = async () => ({ ok: false, code: 'too-late' });
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    put(db, 'C3', R({ text: 'בטוח', intent: 'unclear', route: 'shaul', idMessage: 'C3' }));
    await run(db, 'C3', ON, NOW + MIN);
    check('cancel → too-late → "already in production" text', outbox(db).C3_0.text, 'הזמנה L1004 כבר בייצור ואי אפשר לבטל או לשנות אותה');

    act.lgAgentCancel = async () => ({ ok: false, code: 'missing' });
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    put(db, 'C4', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C4' }));
    await run(db, 'C4', ON, NOW + MIN);
    check('cancel fails otherwise → Shaul + handoff, never "בוטלה"',
      [outbox(db).C4_0_s.to, outbox(db).C4_0.text], ['0501112222', HANDOFF]);

    delete act.lgAgentCancel;
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    put(db, 'C5', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C5' }));
    await run(db, 'C5', ON, NOW + MIN);
    check('no lgAgentCancel yet → no "בוטלה", goes to Shaul', [outbox(db).C5_0.text, !!outbox(db).C5_0_s], [HANDOFF, true]);

    // conv שפג — נמחק גם כשלא פועלים
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'which', intent: 'status', orderIds: ['o3'], at: NOW } };
    put(db, 'C6', R({ route: 'thanks', intent: 'thanks', text: 'תודה', idMessage: 'C6' }));
    await run(db, 'C6', { ...ON, AGENT_REPLY_ENABLED: 'false' }, NOW + 40 * MIN);
    check('expired conv is deleted', conv(db, PRIV), undefined);
  }

  /* ── שילוב עם lgAgentShadowProcess ──────────────────────────────── */
  const model = (intent, ref) => {
    const m = { calls: 0 };
    m.fetchImpl = async () => { m.calls++; return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: {},
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ intent, ref: ref || '' }) }] }] }) }; };
    return m;
  };
  const payload = (id, t, chatId, sender) => ({ typeWebhook: 'incomingMessageReceived', idMessage: id, timestamp: NOW / 1000,
    senderData: { chatId: chatId || PRIV, sender: sender || chatId || PRIV }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: t } } });
  {
    const db = seed(); const m = model('status', 'כהן');
    const sent = [];
    const provider = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 10, checksState: false, nextGap: () => 0,
      gate: c => (c.linked ? { allowed: true } : { allowed: false }),
      async sendText(f) { sent.push(f); return { ok: true, httpStatus: 200, messageId: 'T1' }; } };
    const r = await sh.lgAgentShadowRecord(db, payload('A1', 'מה עם כהן?'), NOW, { env: ON });
    const p = await sh.lgAgentShadowProcess(db, r.key, { now: NOW, fetchImpl: m.fetchImpl, env: ON, provider });
    check('shadow → act → sent to the pilot customer', [p.ok, rec(db, r.key).acted, sent.map(s => [s.to, s.text])],
      [true, true, [['0501234567', 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור']]]);
    check('outbox entry sent', outbox(db)[r.key + '_0'].state, 'sent');
    // Review Focus 4: webhook + drain על אותה הודעה
    await sh.lgAgentShadowRecord(db, payload('A1', 'מה עם כהן?'), NOW + 1, { env: ON });
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW + 2, fetchImpl: m.fetchImpl, env: ON, provider });
    check('focus 4: second webhook/drain → still one send', [sent.length, Object.keys(outbox(db)).length], [1, 1]);
  }
  {
    // act נכשל → רשומת הצל נשארת done ו-ok
    const db = seed(); const m = model('status', 'כהן');
    const r = await sh.lgAgentShadowRecord(db, payload('E1', 'מה עם כהן?'), NOW, { env: ON });
    const orig = act.lgAgentAct;
    act.lgAgentAct = async () => { throw new TypeError('boom'); };
    const p = await sh.lgAgentShadowProcess(db, r.key, { now: NOW, fetchImpl: m.fetchImpl, env: ON });
    act.lgAgentAct = orig;
    check('act failure never fails the shadow record', [p.ok, rec(db, r.key).state], [true, 'done']);
  }
  {
    // R2: הודעה ממספר צוות → route staff, בלי סיווג ובלי פעולה
    const db = seed(); const m = model('status', 'כהן');
    const r = await sh.lgAgentShadowRecord(db, payload('S1', '300 ₪', SHAUL), NOW, { env: ON });
    check('staff sender recorded with text + staff:true', [rec(db, r.key).staff, rec(db, r.key).text], [true, '300 ₪']);
    await sh.lgAgentShadowProcess(db, r.key, { now: NOW, fetchImpl: m.fetchImpl, env: ON, provider: { configured: false } });
    check('staff → route staff, model not called, nothing queued',
      [rec(db, r.key).route, m.calls, rec(db, r.key).wouldAct, Object.keys(outbox(db)).length], ['staff', 0, [], 0]);
    const g = await sh.lgAgentShadowRecord(db, payload('S2', 'אני מטפל', GROUP, SHAUL), NOW, { env: ON });
    await sh.lgAgentShadowProcess(db, g.key, { now: NOW, fetchImpl: m.fetchImpl, env: ON });
    check('staff writing in a customer group → staff, not classified', [rec(db, g.key).route, m.calls], ['staff', 0]);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
