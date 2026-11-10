'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-room.js — "חדר הסוכנים" (בן, 10/11).
//
//  עוזר משותף, לא route. "קישור תוך כדי": כל פעולה שנבנית מעכשיו כותבת
//  אירוע ל-waMeta/agentRoom בשם הסוכן האחראי.
//  ר' docs/superpowers/specs/2026-11-10-agents-room-design.md ("החדר", "מה הסוכן עושה כשהוא לא יודע").
//
//  waMeta/agentRoom/<מפתח> = { at, agent, kind, text, ref, … }
//    kind: info (דיווח) | ask (שאלה לבן — צהוב) | answer (תשובת בן) | summary (המנהל)
//    ask מהסוכנים: state 'open'→'answered', customerId, customerName, chat, question,
//      suggest?, note? — ו-answeredAt/By, outboxKey אחרי שבן ענה.
//    ⚠️ ask בלי state (הצעת צרופה בתור, _attach-suggest) — לא שאלה לבן; נענית בתור.
//  ⚠️ waMeta נכתב רק בשרת (החוקים חוסמים את הדפדפן) — אין שינוי חוקים.
//  ⚠️ lgRoomPost לעולם לא זורק: היומן הוא תיעוד, לא העבודה עצמה.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const ROOM = 'waMeta/agentRoom';
const KINDS = ['info', 'ask', 'answer', 'summary'];
const STATES = ['open', 'answered'];
const REF_KEYS = ['customerId', 'orderId', 'invoiceKey', 'shadowKey'];
const ANSWER_MAX = 1000;

//  מפתח שממוין לפי זמן (כמו push של פיירבייס): זמן ב-base36 ברוחב קבוע + אקראי
const _key = at => String(Math.max(0, Math.floor(at))).padStart(13, '0').replace(/\d+/, d => Number(d).toString(36).padStart(9, '0'))
  + crypto.randomBytes(5).toString('hex');
const _s = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && !/[.#$[\]/]/.test(k);

function _ref(ref) {
  if (ref == null || ref === '') return null;
  if (typeof ref !== 'object') return String(ref).slice(0, 200);
  const out = {};
  REF_KEYS.forEach(k => { if (ref[k] != null && ref[k] !== '') out[k] = String(ref[k]).slice(0, 200); });
  return Object.keys(out).length ? out : null;
}

async function lgRoomPost(db, e, now) {
  try {
    const x = e || {};
    const at = Number(now) || Date.now();
    const key = _key(at);
    const rec = {
      at,
      agent: String(x.agent || '').slice(0, 40),
      kind: KINDS.includes(x.kind) ? x.kind : 'info',
      text: String(x.text || '').slice(0, 500),
      ref: _ref(x.ref),
    };
    //  שדות נוספים — רק כשיש (שורת info נשארת כמו קודם)
    const extra = { to: _s(x.to, 40), state: STATES.includes(x.state) ? x.state : null, customerId: _s(x.customerId, 200),
      customerName: _s(x.customerName, 120), chat: _s(x.chat, 120), question: _s(x.question, 1000), suggest: _s(x.suggest, 1000),
      note: _s(x.note, 300), replyTo: _s(x.replyTo, 60), by: _s(x.by, 60) };
    Object.keys(extra).forEach(k => { if (extra[k] != null) rec[k] = extra[k]; });
    await db.ref(ROOM + '/' + key).set(rec);
    return key;
  } catch (e2) {
    console.warn('agent-room: post failed', e2 && e2.name);
    return null;
  }
}

// ─── שאלה לבן ("לא יודע → בן") ──────────────────────────────────────
const ASK_HOLD_TEXT = 'קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.';
const _oneLine = (s, n) => { const l = String(s || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || ''; return l.length > n ? l.slice(0, n - 1) + '…' : l; };
//  הקישור לחדר: AGENT_ROOM_URL, או כתובת הפרויקט ש-Vercel חושפת לבד
function lgRoomLink(env) {
  const e = env || {};
  if (e.AGENT_ROOM_URL) return String(e.AGENT_ROOM_URL);
  const host = String(e.VERCEL_PROJECT_PRODUCTION_URL || e.VERCEL_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host ? 'https://' + host + '/agents.html' : '';
}
//  "יש שאלה שמחכה לך בחדר הסוכנים: <לקוח> — <שורה אחת>" + קישור
function lgRoomAskBenText(who, question, env) {
  const link = lgRoomLink(env);
  return 'יש שאלה שמחכה לך בחדר הסוכנים: ' + String(who || 'לקוח') + ' — ' + _oneLine(question, 80)
    + '\n' + (link || 'מסך "סוכנים" באדמין');
}

// ─── בן עונה בחדר (agent-room-answer) ───────────────────────────────
//  b: { key, text }. deps: { env, now, by, provider, sendPending, deadline }
//  { ok, code, message?, outboxKey? }
//  סדר: תפיסה בטרנזקציה (open → answered) → תור ללקוח (create-once, room_<key>)
//  → אירוע answer בחדר → ניסיון שליחה מיד. נכשל בתור → חוזר ל-open.
//  ⚠️ השליחה עצמה — אותה שכבה, אותן הגנות: הסוכן "עונה", הלקוח בפיילוט ומקושר.
async function lgRoomAnswer(db, b, deps) {
  const x = b || {}, d = deps || {};
  const key = x.key;
  if (!_keyOk(key)) return { ok: false, code: 'bad-key', message: 'מזהה הודעה לא תקין' };
  const text = typeof x.text === 'string' ? x.text.trim() : '';
  if (!text || text.length > ANSWER_MAX) return { ok: false, code: 'bad-text', message: 'התשובה ריקה או ארוכה מדי' };
  const now = Number(d.now) || Date.now();
  const by = String(d.by || '').slice(0, 60);
  const ref = db.ref(ROOM + '/' + key);
  const okey = 'room_' + key;
  let why = '', entry = null;
  const tx = await ref.transaction(cur => {
    why = ''; entry = null;
    if (cur === null) return null;   // null-first — פיירבייס יביא את הערך האמיתי
    if (cur.kind !== 'ask' || !STATES.includes(cur.state)) { why = 'not-ask'; return; }
    if (cur.state !== 'open') { why = 'answered'; return; }
    if (!cur.chat || !cur.customerId) { why = 'no-customer'; return; }
    entry = cur;
    return { ...cur, state: 'answered', answer: text, answeredAt: now, answeredBy: by, outboxKey: okey };
  });
  if (!tx.committed || !entry) {
    if (why === 'answered') return { ok: false, code: why, message: 'כבר נענתה' };
    if (why === 'not-ask') return { ok: false, code: why, message: 'זו לא שאלה' };
    if (why === 'no-customer') return { ok: false, code: why, message: 'אין לקוח לשאלה הזו' };
    return { ok: false, code: 'missing', message: 'ההודעה לא נמצאה' };
  }
  const S = require('./_agent-send');
  try {
    await S.lgAgentEnqueue(db, { key: okey, to: entry.chat, customerId: entry.customerId, text, reason: 'agent-room-answer', agent: entry.agent || '' });
  } catch (e) {
    console.warn('agent-room: answer enqueue', e && e.name);
    try { await ref.update({ state: 'open', answer: null, answeredAt: null, answeredBy: null, outboxKey: null }); }
    catch (e2) { console.warn('agent-room: answer revert', e2 && e2.name); }
    return { ok: false, code: 'error', message: 'השליחה נכשלה — נסה שוב' };
  }
  await lgRoomPost(db, { agent: entry.agent, kind: 'answer', text, replyTo: key, by, customerId: entry.customerId, customerName: entry.customerName }, now);
  try {
    await (d.sendPending || S.lgAgentSendPending)(db, { env: d.env || process.env, provider: d.provider,
      deadline: d.deadline != null ? d.deadline : Date.now() + 40 * 1000 });
  } catch (e) { console.warn('agent-room: answer send', e && e.name); }
  return { ok: true, code: '', outboxKey: okey };
}

module.exports = { lgRoomPost, lgRoomAnswer, lgRoomLink, lgRoomAskBenText, ASK_HOLD_TEXT, ROOM };
