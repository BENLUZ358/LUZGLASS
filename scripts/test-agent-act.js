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
// זמן ההודעה (timestamp) = זמן העיבוד, אלא אם הבדיקה קבעה אחרת
const run = (db, k, env, now) => {
  const r = rec(db, k); if (r && r.timestamp == null) r.timestamp = now || NOW;
  return act.lgAgentAct(db, k, { env: env || ON, now: now || NOW, sendPending: sendStub });
};

const D = (rec_, conv_, orders_, now_) => act.lgAgentDecide({ rec: { timestamp: now_ || NOW, ...rec_ }, orders: orders_ || list('777'), conv: conv_ || null, now: now_ || NOW });

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
      y2, { actions: [{ type: 'reply', text: 'הזמנה L1003 כבר בייצור ואי אפשר לבטל או לשנות אותה' },
                      { type: 'staff', notify: true, text: 'כהן זכוכית ביקש לבטל את הזמנה L1003 (מטבח) — כבר בשלב ייצור' }], conv: null });

    const ch = D(R({ intent: 'change', ref: 'מטבח' }));
    check('change allowed → "מה בדיוק לשנות?" + conv change-details',
      ch, { actions: [{ type: 'reply', text: 'מה בדיוק לשנות בהזמנה L1003 (סקיצה: מטבח)?' }], conv: { await: 'change-details', orderId: 'o3', at: NOW } });
    const det = D(R({ text: 'הרוחב 90 ולא 80', intent: 'change', route: 'okev' }), ch.conv, null, NOW + MIN);
    check('change-details + answer → staff with details + handoff reply, conv cleared', det, { actions: [
      { type: 'staff', text: 'שינוי בהזמנה L1003 (מטבח) של כהן זכוכית: הרוחב 90 ולא 80' },
      { type: 'reply', text: HANDOFF }], conv: null });

    check('cancel not allowed (workday) → עוקב text, no conv',
      D(R({ intent: 'cancel', ref: 'כהן' })), { actions: [{ type: 'reply', text: 'הזמנה L1001 כבר בייצור ואי אפשר לבטל או לשנות אותה' },
        { type: 'staff', notify: true, text: 'כהן זכוכית ביקש לבטל את הזמנה L1001 (כהן) — כבר בשלב ייצור' }], conv: null });
    check('change not allowed (workday) → עוקב text',
      D(R({ intent: 'change', ref: 'L1001' })).actions, [{ type: 'reply', text: 'הזמנה L1001 כבר בייצור ואי אפשר לבטל או לשנות אותה' },
        { type: 'staff', notify: true, text: 'כהן זכוכית ביקש לשנות את הזמנה L1001 (כהן) — כבר בשלב ייצור' }]);
    check('F3 status on a production order → no staff notify', D(R({ intent: 'status', ref: 'L1001' })).actions.map(a => a.type), ['reply']);

    check('menu → AGENT_MENU_TEXT', D(R({ route: 'menu', intent: 'chitchat', text: 'היי' })).actions, [{ type: 'reply', text: AGENT_MENU_TEXT }]);

    check('shaul (linked) → staff "<לקוח>: <טקסט>" + handoff reply',
      D(R({ route: 'shaul', intent: 'unclear', text: 'יש לכם זכוכית חכמה?' })).actions,
      [{ type: 'staff', text: 'כהן זכוכית: יש לכם זכוכית חכמה?' }, { type: 'reply', text: HANDOFF }]);
    check('shaul (linked, no name) → phone prefix',
      D(R({ route: 'shaul', intent: 'angry', text: 'איפה ההזמנה???', customerName: '' })).actions[0],
      { type: 'staff', text: '0501234567: איפה ההזמנה???' });
    // R5: מספר לא מקושר — לא שולחים כלום, גם לא לשאול (נספר בסיכום היומי)
    const un = D(R({ route: 'shaul', linked: false, customerId: '', customerName: '', chatId: STRANGER, sender: '0549999999', text: undefined }), null, []);
    check('R5: shaul (unlinked) → no action at all', un.actions, []);

    // "כן" שנשלח לפני השאלה (או לפני שנמסרה) לא מאשר ביטול
    const early = D(R({ text: 'כן', intent: 'unclear', route: 'shaul', timestamp: NOW - 1000 }), c.conv, null, NOW + MIN);
    check('"כן" sent before the question → no cancel, normal routing, conv kept',
      [early.actions.map(a => a.type), early.conv], [['staff', 'reply'], c.conv]);
    const notYet = D(R({ text: 'כן', intent: 'unclear', route: 'shaul', timestamp: NOW + MIN }), { ...c.conv, askedAt: NOW + 2 * MIN }, null, NOW + 3 * MIN);
    check('"כן" before the question was delivered (askedAt) → no cancel', notYet.actions.map(a => a.type), ['staff', 'reply']);
    const after = D(R({ text: 'כן', intent: 'unclear', route: 'shaul', timestamp: NOW + 3 * MIN }), { ...c.conv, askedAt: NOW + 2 * MIN }, null, NOW + 3 * MIN);
    check('"כן" after delivery → cancel', after.actions.map(a => a.type), ['cancel']);
    const wEarly = D(R({ text: '3', intent: 'unclear', route: 'shaul', timestamp: NOW - 1 }), m.conv, null, NOW + MIN);
    check('"3" sent before the list → not an answer', wEarly.conv, m.conv);

    // הזמנה חדשה (kolet) לא נבלעת כתשובה לשאלה פתוחה — הקליטה יוצרת אותה כרגיל.
    // תיקון סופי 5: סקיצה אחרי "מה לשנות?" — בנוסף, שאול מקבל "נשלחה סקיצה חדשה" + העברה
    const kol = D(R({ route: 'kolet', intent: 'order', text: '', hasImage: true }), ch.conv, null, NOW + MIN);
    check('kolet image while awaiting change-details → Shaul text + forward (F5), conv cleared',
      [kol.actions.map(a => a.type), kol.conv], [['staff', 'staff'], null]);
    const kol2 = D(R({ route: 'kolet', intent: 'order', text: '2' }), m.conv, null, NOW + MIN);
    check('kolet while awaiting which → no action', kol2.actions, []);

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
    check('R5: unlinked → not acted, nothing queued (not even to Shaul)',
      [r.acted, rec(db, 'U1').actReason, Object.keys(outbox(db)).length], [false, 'no-action', 0]);
  }
  {
    // act נופל אחרי שנתפס actAt → נרשם actReason:'error', לא שקט
    const db = seed(); put(db, 'X1', R({ intent: 'status', ref: 'כהן' }));
    const real = db.ref.bind(db);
    db.ref = p => (p === 'orders' ? { once: async () => { throw new RangeError('db down'); } } : real(p));
    const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
    const r = await run(db, 'X1');
    console.warn = warn;
    check('act throws after claim → acted:false, actReason error, e.name logged',
      [r.acted, rec(db, 'X1').acted, rec(db, 'X1').actReason, rec(db, 'X1').actError, warned], [false, false, 'error', 'RangeError', ['agent-act: RangeError']]);
  }
  {
    // השאלה כבר בתור (queued:false) → conv לא נכתב
    const db = seed(); put(db, 'Q1', R({ intent: 'cancel', ref: 'מטבח', idMessage: 'Q1' }));
    db._data.waMeta.agentOutbox = { Q1_0: { state: 'sent', text: 'ישן' } };
    await run(db, 'Q1');
    check('question not actually queued → conv not written', conv(db, PRIV), undefined);
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
    check('cancel question → conv saved under the chat, with the question\'s queue key',
      conv(db, PRIV), { await: 'confirm-cancel', orderId: 'o3', at: NOW, askKey: 'C1_0' });

    // כאן מזויף — בודק את החיווט; הביטול האמיתי מקצה לקצה למטה
    const realCancel = act.lgAgentCancel;
    const calls = [];
    act.lgAgentCancel = async (d, orderId, ctx) => { calls.push([orderId, ctx.customerId, ctx.chatId]); return { ok: true, code: '' }; };
    // השאלה עוד לא נשלחה — "כן" לא מבטל
    put(db, 'C2a', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C2a' }));
    await run(db, 'C2a', ON, NOW + MIN);
    check('"כן" while the question is still unsent → no cancel, conv kept', [calls.length, conv(db, PRIV).orderId], [0, 'o3']);
    // נשלחה ב-NOW+2 דק'; "כן" עם זמן מוקדם יותר → לא מבטל
    Object.assign(outbox(db).C1_0, { state: 'sent', sentAt: NOW + 2 * MIN });
    put(db, 'C2b', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C2b', timestamp: NOW + MIN }));
    await run(db, 'C2b', ON, NOW + 3 * MIN);
    check('"כן" timestamped before delivery → no cancel', calls.length, 0);
    put(db, 'C2', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'C2' }));
    const r = await run(db, 'C2', ON, NOW + 5 * MIN);
    check('"כן" → cancel called once with customer + chat', calls, [['o3', '777', PRIV]]);
    check('"כן" → "ההזמנה בוטלה" queued, conv deleted', [outbox(db).C2_0.text, conv(db, PRIV), r.acted], ['ההזמנה בוטלה', undefined, true]);
    // Review Focus 4: אותה הודעה פעמיים → ביטול ושליחה פעם אחת
    await run(db, 'C2', ON, NOW + 6 * MIN);
    check('focus 4: act again on the same record → cancel not called again, one entry',
      [calls.length, Object.keys(outbox(db)).filter(k => k.startsWith('C2_')).length], [1, 1]);

    act.lgAgentCancel = async () => ({ ok: false, code: 'too-late' });
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    put(db, 'C3', R({ text: 'בטוח', intent: 'unclear', route: 'shaul', idMessage: 'C3' }));
    await run(db, 'C3', ON, NOW + MIN);
    check('cancel → too-late → "already in production" text', outbox(db).C3_0.text, 'הזמנה L1004 כבר בייצור ואי אפשר לבטל או לשנות אותה');
    check('F3 runtime too-late → also Shaul', [outbox(db).C3_0_s && outbox(db).C3_0_s.to, outbox(db).C3_0_s && outbox(db).C3_0_s.text],
      ['0501112222', 'כהן זכוכית ביקש לבטל את הזמנה L1004 (אמבטיה) — כבר בשלב ייצור']);

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
    check('no lgAgentCancel → no "בוטלה", goes to Shaul', [outbox(db).C5_0.text, !!outbox(db).C5_0_s], [HANDOFF, true]);
    act.lgAgentCancel = realCancel;

    // ── מקצה לקצה עם lgAgentCancel האמיתי (משימה 3) ──
    check('real lgAgentCancel is exported', typeof act.lgAgentCancel, 'function');
    {
      const db2 = seed(); put(db2, 'E1', R({ intent: 'cancel', ref: 'מטבח', idMessage: 'E1' }));
      await run(db2, 'E1');
      Object.assign(outbox(db2).E1_0, { state: 'sent', sentAt: NOW + MIN });
      put(db2, 'E2', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'E2' }));
      const e2 = await run(db2, 'E2', ON, NOW + 2 * MIN);
      check('e2e: "כן" → order o3 removed, cancel record, "ההזמנה בוטלה"',
        [e2.acted, db2._data.orders.o3, db2._data.waMeta.agentCancels.o3.order.orderNum, db2._data.waMeta.agentCancels.o3.chatId,
         outbox(db2).E2_0.text, rec(db2, 'E2').actCancels],
        [true, undefined, 'L1003', PRIV, 'ההזמנה בוטלה', [{ orderId: 'o3', ok: true, code: '' }]]);
      // ירדה לביצוע בין השאלה ל"כן" — הבדיקה בטרנזקציה, לא רק בהחלטה
      db2._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW + 2 * MIN } };
      const realRef = db2.ref.bind(db2);
      db2.ref = p => { const r = realRef(p); if (p === 'orders/o4') { const tx = r.transaction;
        r.transaction = fn => { db2._data.orders.o4.stage = 'workday'; return tx(fn); }; } return r; };
      put(db2, 'E3', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'E3' }));
      await run(db2, 'E3', ON, NOW + 3 * MIN);
      check('e2e focus 3: moved to workday at the last moment → not deleted, "already in production"',
        [db2._data.orders.o4.stage, (db2._data.waMeta.agentCancels || {}).o4, outbox(db2).E3_0.text, rec(db2, 'E3').actCancels[0].code],
        ['workday', undefined, 'הזמנה L1004 כבר בייצור ואי אפשר לבטל או לשנות אותה', 'too-late']);
    }

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
    const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
    const p = await sh.lgAgentShadowProcess(db, r.key, { now: NOW, fetchImpl: m.fetchImpl, env: ON });
    console.warn = warn;
    act.lgAgentAct = orig;
    check('act failure never fails the shadow record, only e.name logged', [p.ok, rec(db, r.key).state, warned], [true, 'done', ['agent-shadow: act TypeError']]);
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
    // R6: שאול כתב בקבוצה → שקט שעתיים בקבוצה, כמו הודעה ידנית מהטלפון
    check('R6: staff message in a group sets HUMAN lastAt', db._data.waMeta.agentHuman[key(GROUP)].lastAt, NOW);
    check('R6: staff private chat does not mark human', (db._data.waMeta.agentHuman || {})[key(SHAUL)], undefined);
    const c1 = await sh.lgAgentShadowRecord(db, payload('S3', 'מתי מוכן?', GROUP, '972521111111@c.us'), NOW + 10 * MIN, { env: ON });
    await sh.lgAgentShadowProcess(db, c1.key, { now: NOW + 10 * MIN, fetchImpl: model('status', '').fetchImpl, env: ON, provider: { configured: false } });
    check('R6: customer message in that group after Shaul → silent-human, nothing queued',
      [rec(db, c1.key).route, Object.keys(outbox(db)).length], ['silent-human', 0]);
  }

  /* ─── תיקונים סופיים 3/4/5/9 ─────────────────────────────────────────── */
  {
    // 3: בלי שאול מוגדר — "כבר בייצור" עדיין יוצא ללקוח (ההודעה לשאול היא לידיעה)
    let db = seed();
    put(db, 'N1', R({ idMessage: 'N1', route: 'okev', intent: 'cancel', ref: 'כהן' }));
    let r = await run(db, 'N1', { ...ON, AGENT_STAFF_PHONES: '' });
    check('F3 too-late without staff → customer still answered, no staff entry',
      [r.acted, outbox(db).N1_0 && outbox(db).N1_0.text, !!outbox(db).N1_1], [true, 'הזמנה L1001 כבר בייצור ואי אפשר לבטל או לשנות אותה', false]);
    db = seed();
    put(db, 'N2', R({ idMessage: 'N2', route: 'okev', intent: 'cancel', ref: 'כהן' }));
    await run(db, 'N2');
    check('F3 too-late with staff → Shaul gets the request', [outbox(db).N2_1.to, outbox(db).N2_1.text, outbox(db).N2_1.reason],
      ['0501112222', 'כהן זכוכית ביקש לבטל את הזמנה L1001 (כהן) — כבר בשלב ייצור', 'agent-staff']);

    // 4: ביטול אמיתי בשלב chash → ללקוח "בוטלה" + לשאול "בוטלה הזמנה … הייתה בשלב"
    db = seed();
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    put(db, 'N3', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'N3' }));
    await run(db, 'N3', ON, NOW + MIN);
    check('F4 cancel in chash → done text + Shaul notified with the stage',
      [!!db._data.orders.o4, outbox(db).N3_0.text, outbox(db).N3_0_s && outbox(db).N3_0_s.to, outbox(db).N3_0_s && outbox(db).N3_0_s.text],
      [false, 'ההזמנה בוטלה', '0501112222', 'בוטלה הזמנה L1004 (אמבטיה) של כהן זכוכית — הייתה בשלב שרטוט']);
    db = seed();
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o3', at: NOW } };
    put(db, 'N4', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'N4' }));
    await run(db, 'N4', ON, NOW + MIN);
    check('F4 cancel in pending → no Shaul message', [!!db._data.orders.o3, outbox(db).N4_0.text, !!outbox(db).N4_0_s], [false, 'ההזמנה בוטלה', false]);
    check('F4 lgAgentCancel reports the stage', await act.lgAgentCancel(seed(), 'o4', { customerId: '777', chatId: PRIV, now: NOW }), { ok: true, code: '', stage: 'chash' });

    // 5: אחרי "מה לשנות?" הלקוח שלח סקיצה (route kolet) → לשאול + העברת התמונה; הקליטה ממשיכה כרגיל
    const chc = { await: 'change-details', orderId: 'o3', at: NOW };
    const k5 = D(R({ route: 'kolet', intent: 'order', hasImage: true, text: '', idMessage: 'IMG5' }), chc, null, NOW + MIN);
    check('F5 decide: change-details + image → staff text + forward, conv cleared', k5, { actions: [
      { type: 'staff', text: 'שינוי בהזמנה L1003 (מטבח) של כהן זכוכית: נשלחה סקיצה חדשה' },
      { type: 'staff', text: '', files: [{ kind: 'forward', fromChat: PRIV, idMessage: 'IMG5' }] }], conv: null });
    check('F5 kolet text without image → still not swallowed', D(R({ route: 'kolet', intent: 'order', text: '80 על 120' }), chc, null, NOW + MIN).actions, []);
    check('F5 kolet image without open conv → nothing', D(R({ route: 'kolet', intent: 'order', hasImage: true })).actions, []);
    db = seed();
    db._data.waMeta.agentConv = { [key(PRIV)]: chc };
    put(db, 'N5', R({ route: 'kolet', intent: 'order', hasImage: true, text: '', idMessage: 'N5' }));
    await run(db, 'N5', ON, NOW + MIN);
    check('F5 act: Shaul gets text + forward, conv deleted', [outbox(db).N5_0.text, outbox(db).N5_1.files[0].kind, conv(db, PRIV)],
      ['שינוי בהזמנה L1003 (מטבח) של כהן זכוכית: נשלחה סקיצה חדשה', 'forward', undefined]);

    // 9: ההודעה לשאול לא נכנסה לתור → לא אומרים ללקוח "העברנו לשאול"
    db = seed();
    db._data.waMeta.agentOutbox = { N6_0: { state: 'sent', text: 'קודם' } };   // המפתח של הודעת שאול כבר קיים → queued:false
    put(db, 'N6', R({ idMessage: 'N6', route: 'shaul', intent: 'unclear', text: 'שאלה' }));
    await run(db, 'N6');
    check('F9 staff entry not queued → no handoff reply', [outbox(db).N6_0.text, !!outbox(db).N6_1], ['קודם', false]);
    db = seed();
    put(db, 'N7', R({ idMessage: 'N7', route: 'shaul', intent: 'unclear', text: 'שאלה' }));
    await run(db, 'N7');
    check('F9 staff queued → handoff reply', [outbox(db).N7_0.to, outbox(db).N7_1.text], ['0501112222', HANDOFF]);
    // ביטול שנכשל: הודעת שאול (_s) לא נכנסה → בלי "העברנו לשאול"
    const realC = act.lgAgentCancel;
    act.lgAgentCancel = async () => ({ ok: false, code: 'missing' });
    db = seed();
    db._data.waMeta.agentConv = { [key(PRIV)]: { await: 'confirm-cancel', orderId: 'o4', at: NOW } };
    db._data.waMeta.agentOutbox = { N8_0_s: { state: 'sent', text: 'קודם' } };
    put(db, 'N8', R({ text: 'כן', intent: 'unclear', route: 'shaul', idMessage: 'N8' }));
    await run(db, 'N8', ON, NOW + MIN);
    act.lgAgentCancel = realC;
    check('F9 failed cancel, staff not queued → no handoff', !!outbox(db).N8_0, false);
    // בקשת מחיר מסקיצה: הבקשה לשאול לא נכנסה → בלי "נחזור אליך עם מחיר"
    db = seed();
    db._data.waMeta.agentOutbox = { N9_1: { state: 'sent', text: 'קודם' } };
    put(db, 'N9', R({ idMessage: 'N9', route: 'quote', intent: 'quote', hasImage: true, text: '' }));
    await run(db, 'N9');
    check('F9 quote-ask not queued → no hold reply', !!outbox(db).N9_0, false);
  }

  /* ─── תיקון סופי 2: פיילוט = אותו קישור כמו השליחה (waGroups / waSenders) ─── */
  {
    // מקושר רק דרך רשימת Vercel (linkVia env) — לקוח 777 בפיילוט, ובכל זאת לא פועלים
    let db = seed();
    put(db, 'L1', R({ idMessage: 'L1', chatId: STRANGER, sender: '0549999999', linkVia: 'env', route: 'okev', intent: 'cancel', ref: 'מטבח' }));
    let r = await run(db, 'L1');
    check('F2 env-only link → not acted, not-linked, nothing queued, no conv',
      [r.acted, rec(db, 'L1').actReason, Object.keys(outbox(db)).length, conv(db, STRANGER)], [false, 'not-linked', 0, undefined]);
    check('F2 not-linked still records wouldAct', (rec(db, 'L1').wouldAct || []).length > 0, true);
    // בלי linkVia (רשומה ישנה) → נבדק עכשיו: waSenders → פועלים
    db = seed();
    put(db, 'L2', R({ idMessage: 'L2', route: 'menu' }));
    r = await run(db, 'L2');
    check('F2 legacy record, chat in waSenders → acted', [r.acted, rec(db, 'L2').actReason], [true, null]);
    // בלי linkVia, הצ'אט לא ב-waSenders → not-linked
    db = seed();
    put(db, 'L3', R({ idMessage: 'L3', chatId: STRANGER, sender: '0549999999', route: 'menu' }));
    r = await run(db, 'L3');
    check('F2 legacy record, chat not in waSenders → not-linked', [r.acted, rec(db, 'L3').actReason], [false, 'not-linked']);
    // ביטול לא קורה דרך קישור env
    db = seed();
    put(db, 'L4', R({ idMessage: 'L4', chatId: STRANGER, sender: '0549999999', linkVia: 'env', route: 'okev', text: 'כן', timestamp: NOW }));
    db._data.waMeta.agentConv = { [key(STRANGER)]: { await: 'confirm-cancel', orderId: 'o3', at: NOW - MIN } };
    await run(db, 'L4');
    check('F2 env-only "כן" → no cancel', [!!db._data.orders.o3, rec(db, 'L4').actReason], [true, 'not-linked']);
  }

  /* ─── תיקון סופי 1: דדליין ב-act — הצעת מחיר מדולגת, השליחה מקבלת את הדדליין ─── */
  {
    check('F1 quote worst constant', act.AGENT_QUOTE_WORST_MS, 20000);
    const calls = [];
    const spy = async (d, o) => { calls.push({ deadline: o.deadline, clock: typeof o.clock }); return { sent: 0 }; };
    const qModel = { n: 0, fetchImpl: async () => { qModel.n++; return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: null,
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ok: true, items: [{ sku: 'S1', w: 100, h: 100, qty: 1, holes: 0, cutouts: 0 }] }) }] }] }) }; } };
    const qSeed = () => { const db = seed(); db._data.skuCatalog = { S1: { name: 'זכוכית 4', glass: 'שקוף', mm: 4 } };
      db._data.prices = { global: { S1: 100 } }; return db; };
    const t = 9000000, clock = () => t;
    // נשארו 36ש׳ < 20 (מודל) + 17 (פריט) → בלי מודל → שאול
    let db = qSeed();
    put(db, 'Q1', R({ idMessage: 'Q1', route: 'quote', intent: 'quote', text: 'כמה עולה זכוכית 4 מ"מ 100 על 100?', timestamp: NOW }));
    await act.lgAgentAct(db, 'Q1', { env: ON, now: NOW, sendPending: spy, fetchImpl: qModel.fetchImpl, clock, deadline: t + 36000 });
    check('F1 quote skipped near deadline: no model, handoff to Shaul, marked',
      [qModel.n, rec(db, 'Q1').quoteSkipped, (rec(db, 'Q1').wouldAct || []).map(a => a.type)], [0, 'deadline', ['staff', 'reply']]);
    check('F1 act hands deadline + clock to send', calls[0], { deadline: t + 36000, clock: 'function' });
    db = qSeed(); calls.length = 0;
    put(db, 'Q2', R({ idMessage: 'Q2', route: 'quote', intent: 'quote', text: 'כמה עולה זכוכית 4 מ"מ 100 על 100?', timestamp: NOW }));
    await act.lgAgentAct(db, 'Q2', { env: ON, now: NOW, sendPending: spy, fetchImpl: qModel.fetchImpl, clock, deadline: t + 37000 });
    check('F1 quote with enough time: model called, priced reply', [qModel.n, rec(db, 'Q2').quoteSkipped, (rec(db, 'Q2').wouldAct || []).map(a => a.type)], [1, undefined, ['reply']]);
    // בלי דדליין → 50ש׳ מעכשיו
    db = seed(); calls.length = 0;
    put(db, 'Q3', R({ idMessage: 'Q3', route: 'menu', text: 'היי', timestamp: NOW }));
    await act.lgAgentAct(db, 'Q3', { env: ON, now: NOW, sendPending: spy, clock });
    check('F1 act without deadline → clock + 50s', calls[0] && calls[0].deadline, t + 50000);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
