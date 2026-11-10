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
//  waMeta/agentRoomOpen/<מפתח> = { at, agent, customer } — אינדקס קטן של השאלות הפתוחות
//    (תיקון סקירה 10/11): נכתב כשנפתחת שאלה, יורד כשבן עונה, חוזר אם התשובה לא יצאה.
//    המונה בתפריט והרשימה בחדר קוראים אותו — לא את 500 האירועים האחרונים.
//  ⚠️ waMeta נכתב רק בשרת (החוקים חוסמים את הדפדפן) — אין שינוי חוקים.
//  ⚠️ lgRoomPost לעולם לא זורק: היומן הוא תיעוד, לא העבודה עצמה.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const ROOM = 'waMeta/agentRoom';
const ROOM_OPEN = 'waMeta/agentRoomOpen';
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

//  האינדקס של השאלות הפתוחות. rec = רשומת ה-ask; null → יורד. לא זורק (נוחות, לא העבודה)
async function _openIdx(db, key, rec) {
  try {
    await db.ref(ROOM_OPEN + '/' + key).set(rec ? { at: Number(rec.at) || 0, agent: String(rec.agent || ''),
                                                    customer: String(rec.customerName || '').slice(0, 120) } : null);
  } catch (e) { console.warn('agent-room: open index', e && e.name); }
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
      note: _s(x.note, 300), replyTo: _s(x.replyTo, 60), by: _s(x.by, 60), outboxKey: _s(x.outboxKey, 200) };
    Object.keys(extra).forEach(k => { if (extra[k] != null) rec[k] = extra[k]; });
    await db.ref(ROOM + '/' + key).set(rec);
    if (rec.kind === 'ask' && rec.state === 'open') await _openIdx(db, key, rec);
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
//  { ok, code, message?, outboxKey?, sent?, sendState?, sendReason?, reopened? }
//  סדר: תפיסה בטרנזקציה (open → answered) → תור ללקוח (create-once, room_<key>[_n])
//  → אירוע answer בחדר → ניסיון שליחה מיד → **מה קרה באמת** (תיקון סקירה 10/11):
//    sent:true רק אם הרשומה בתור יצאה. נחסמה / נכשלה סופית → השאלה חוזרת ל-open
//    (reopened) כדי שבן יוכל לענות שוב. עדיין בתור → sent:false, השאלה נשארת נענית.
//  "שלח שוב": שאלה שנענתה והתשובה שלה נחסמה / נכשלה סופית מאוחר יותר — נתפסת שוב.
//  נכשל בתור → חוזר ל-open.
//  ⚠️ השליחה עצמה — אותה שכבה, אותן הגנות: הסוכן "עונה", הלקוח בפיילוט ומקושר.
const SEND_FINAL = o => !!o && (o.state === 'blocked' || o.state === 'expired'
  || (o.state === 'failed' && (Number(o.attempts) || 0) >= require('./_wa-outbox').MAX_ATTEMPTS));

//  ask שנענתה → פתוחה שוב, רק אם היא עדיין על אותה רשומה בתור
async function _reopen(db, key, okey) {
  let back = null;
  try {
    await db.ref(ROOM + '/' + key).transaction(cur => {
      back = null;
      if (cur === null) return null;   // null-first
      if (cur.state !== 'answered' || cur.outboxKey !== okey) return;
      back = { ...cur, state: 'open', answeredAt: null, answeredBy: null, outboxKey: null };
      return back;
    });
  } catch (e) { console.warn('agent-room: reopen', e && e.name); back = null; }
  if (back) await _openIdx(db, key, back);
  return !!back;
}

async function lgRoomAnswer(db, b, deps) {
  const x = b || {}, d = deps || {};
  const key = x.key;
  if (!_keyOk(key)) return { ok: false, code: 'bad-key', message: 'מזהה הודעה לא תקין' };
  const text = typeof x.text === 'string' ? x.text.trim() : '';
  if (!text || text.length > ANSWER_MAX) return { ok: false, code: 'bad-text', message: 'התשובה ריקה או ארוכה מדי' };
  const now = Number(d.now) || Date.now();
  const by = String(d.by || '').slice(0, 60);
  const ref = db.ref(ROOM + '/' + key);
  const S = require('./_agent-send');
  //  "שלח שוב" — איזו רשומה בתור נגמרה בלי לצאת (נקרא לפני הטרנזקציה, ונבדק בה שלא השתנה)
  let retryOf = '';
  try {
    const pre = (await ref.once('value')).val();
    if (pre && pre.state === 'answered' && pre.outboxKey
        && SEND_FINAL((await db.ref(S.AGENT_OUTBOX + '/' + String(pre.outboxKey)).once('value')).val())) retryOf = String(pre.outboxKey);
  } catch (e) { console.warn('agent-room: answer pre-read', e && e.name); }
  let why = '', entry = null, okey = '';
  const tx = await ref.transaction(cur => {
    why = ''; entry = null;
    if (cur === null) return null;   // null-first — פיירבייס יביא את הערך האמיתי
    if (cur.kind !== 'ask' || !STATES.includes(cur.state)) { why = 'not-ask'; return; }
    if (cur.state !== 'open' && !(retryOf && cur.outboxKey === retryOf)) { why = 'answered'; return; }
    if (!cur.chat || !cur.customerId) { why = 'no-customer'; return; }
    const tries = (Number(cur.tries) || (cur.outboxKey || retryOf ? 1 : 0)) + 1;
    okey = 'room_' + key + (tries > 1 ? '_' + tries : '');
    entry = cur;
    return { ...cur, state: 'answered', answer: text, answeredAt: now, answeredBy: by, outboxKey: okey, tries };
  });
  if (!tx.committed || !entry) {
    if (why === 'answered') return { ok: false, code: why, message: 'כבר נענתה' };
    if (why === 'not-ask') return { ok: false, code: why, message: 'זו לא שאלה' };
    if (why === 'no-customer') return { ok: false, code: why, message: 'אין לקוח לשאלה הזו' };
    return { ok: false, code: 'missing', message: 'ההודעה לא נמצאה' };
  }
  await _openIdx(db, key, null);
  let q;
  try {
    q = await S.lgAgentEnqueue(db, { key: okey, to: entry.chat, customerId: entry.customerId, text, reason: 'agent-room-answer', agent: entry.agent || '' });
  } catch (e) { console.warn('agent-room: answer enqueue', e && e.name); q = null; }
  if (!q || !q.queued) {
    await _reopen(db, key, okey);
    return { ok: false, code: 'error', message: 'השליחה נכשלה — נסה שוב' };
  }
  await lgRoomPost(db, { agent: entry.agent, kind: 'answer', text, replyTo: key, by, customerId: entry.customerId,
                         customerName: entry.customerName, outboxKey: okey }, now);
  try {
    await (d.sendPending || S.lgAgentSendPending)(db, { env: d.env || process.env, provider: d.provider,
      deadline: d.deadline != null ? d.deadline : Date.now() + 40 * 1000 });
  } catch (e) { console.warn('agent-room: answer send', e && e.name); }
  //  מה קרה באמת לרשומה בתור
  let ob = null;
  try { ob = (await db.ref(S.AGENT_OUTBOX + '/' + okey).once('value')).val(); }
  catch (e) { console.warn('agent-room: answer read', e && e.name); }
  const sendState = String((ob && ob.state) || 'unknown');
  const sent = sendState === 'sent';
  const final = SEND_FINAL(ob);
  const sendReason = sent ? '' : final || sendState === 'failed' ? String((ob && ob.lastError) || 'השליחה נכשלה')
    : 'עדיין בתור — יישלח כשאפשר';
  const reopened = final ? await _reopen(db, key, okey) : false;
  return { ok: true, code: '', outboxKey: okey, sent, sendState, sendReason, reopened };
}

// ─── שאלה פנימית שנסגרת לבד (שלב ב׳, 10/11) ─────────────────────────
//  שאלה של בדיקות הדופק (_agent-watch) — אין לקוח לענות לו. כשהבעיה תוקנה:
//  open → answered (answeredBy 'auto') ויורדת מהאינדקס. לא זורק.
async function lgRoomClose(db, key, now) {
  if (!_keyOk(key)) return false;
  let closed = false;
  try {
    await db.ref(ROOM + '/' + key).transaction(cur => {
      closed = false;
      if (cur === null) return null;   // null-first
      if (cur.kind !== 'ask' || cur.state !== 'open') return;
      closed = true;
      return { ...cur, state: 'answered', answer: 'תוקן', answeredAt: Number(now) || Date.now(), answeredBy: 'auto' };
    });
  } catch (e) { console.warn('agent-room: close', e && e.name); closed = false; }
  if (closed) await _openIdx(db, key, null);
  return closed;
}

module.exports = { lgRoomPost, lgRoomAnswer, lgRoomClose, lgRoomLink, lgRoomAskBenText, ASK_HOLD_TEXT, ROOM, ROOM_OPEN };
