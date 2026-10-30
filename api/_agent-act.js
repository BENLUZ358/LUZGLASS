// ═══════════════════════════════════════════════════════════════════
//  api/_agent-act.js — מרכזן+עוקב עונים בפועל (שלב 2).
//
//  עוזר משותף, לא route. נקרא מ-lgAgentShadowProcess אחרי שרשומת הצל
//  נסגרה כ-done:
//
//    רשומה + conv + הזמנות הלקוח → lgAgentDecide (טהור) → פעולות
//    → מותר? (מתגים + פיילוט / צוות) → lgAgentEnqueue → lgAgentSendPending
//
//  ⚠️ תמיד נכתב ברשומה wouldAct (מה הוחלט) ו-acted (האם בוצע). לא מותר →
//     רק wouldAct; לא תור, לא ביטול, לא conv (השאלה לא נשלחה — אסור
//     ש"כן" מאוחר יבטל משהו שלא נשאל עליו).
//  ⚠️ פעם אחת לרשומה: actAt נתפס בטרנזקציה. webhook + drain על אותה הודעה
//     → פעולה אחת; ומפתחות התור <recordKey>_<i> הם create-once בנוסף.
//  ⚠️ שינוי מידה/סקיצה מועבר לשאול עם הפרטים (R3) — לא עריכה אוטומטית.
//  ⚠️ הביטול עצמו (lgAgentCancel) נוסף במשימה 3, באותו קובץ. עד אז — אין
//     ביטול, ובקשה מאושרת עוברת לשאול (R1).
//  ⚠️ לא נרשם ללוג: טקסט ההודעה, טוקנים, מפתחות. רק e.name.
// ═══════════════════════════════════════════════════════════════════

const { lgWaInboundKey } = require('./_wa-inbound');
const { AGENT_OUTBOX, lgAgentStaff, lgAgentEnqueue, lgAgentSendPending } = require('./_agent-send');
const { AGENT_MENU_TEXT, AGENT_HANDOFF_TEXT, CANCEL_DONE_TEXT, CANCEL_KEPT_TEXT, NOT_FOUND,
        lgOkevCanChange, lgOkevFind, lgOkevReply, lgOkevTooLate, lgOkevChangeStaffText } = require('./_agent-okev');

const CONV = 'waMeta/agentConv';
const CONV_TTL_MS = 30 * 60 * 1000;
const PILOT = 'waMeta/agentPilot';
// שליחה מיידית אחרי ההכנסה לתור — קצר, כדי לא לחרוג מ-maxDuration של ה-drain
const SEND_BUDGET_MS = 15 * 1000;

// ── "כן" / "לא" לשאלת "בטוח?": בלי סימני פיסוק, רווחים מכווצים ──
const YES = ['כן', 'כן תבטל', 'בטוח', 'כן בטוח', 'תבטל', 'יאללה'];
const NO = ['לא', 'לא תבטל', 'עזוב', 'תשאיר'];
const _norm = s => String(s == null ? '' : s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const _isYes = s => YES.includes(_norm(s));
const _isNo = s => NO.includes(_norm(s));

const _reply = text => ({ type: 'reply', text });
const _staff = text => ({ type: 'staff', text });
const _who = r => String(r.customerName || r.sender || '');
// העברת ההודעה המקורית לשאול (תמונה)
const _forward = r => ({ type: 'staff', text: '', files: [{ kind: 'forward', fromChat: String(r.chatId || ''), idMessage: String(r.idMessage || '') }] });
const _body = r => String(r.text || '').trim() || (r.hasImage ? '(תמונה)' : '');

// ── שאול: כל מה שהסוכנים לא מטפלים בו ──
//  R5: לא מקושר → כלום, גם לא לשאול (הטלפון של המפעל כבר מראה אותם; סכנת
//  ספאם). נספרים בסיכום היומי (משימה 8).
function _handoff(r) {
  if (!r.linked) return [];
  return [_staff(_who(r) + ': ' + _body(r)), ...(r.hasImage ? [_forward(r)] : []), _reply(AGENT_HANDOFF_TEXT)];
}

// ── ממשיכים intent על הזמנה אחת שנבחרה ──
function _continue(intent, order, now) {
  const one = { match: 'one', orders: [order], via: 'conv' };
  if (intent === 'status') return { actions: [_reply(lgOkevReply('status', one))], conv: null };
  if (!lgOkevCanChange(order)) return { actions: [_reply(lgOkevTooLate(order))], conv: null };
  if (intent === 'cancel') return { actions: [_reply(lgOkevReply('cancel', one))], conv: { await: 'confirm-cancel', orderId: order.id, at: now } };
  if (intent === 'change') return { actions: [_reply(lgOkevReply('change', one))], conv: { await: 'change-details', orderId: order.id, at: now } };
  return { actions: [_reply(NOT_FOUND)], conv: null };
}

// ── הודעה כשיש conv פעיל. null = לא תשובה לשאלה → ניתוב רגיל, conv נשאר ──
function _onConv(r, orders, c, now) {
  const byId = id => orders.find(o => o.id === id) || null;
  if (c.await === 'which') {
    const ids = Array.isArray(c.orderIds) ? c.orderIds : [];
    const n = _norm(r.text);
    let order = null;
    if (/^\d{1,2}$/.test(n) && Number(n) >= 1 && Number(n) <= ids.length) {
      order = byId(ids[Number(n) - 1]);
      if (!order) return { actions: [_reply(NOT_FOUND)], conv: null };   // נמחקה בינתיים
    } else if (n) {
      const f = lgOkevFind(ids.map(byId).filter(Boolean), { ref: n });
      if (f.match === 'one') order = f.orders[0];
    }
    return order ? _continue(c.intent, order, now) : null;
  }
  if (c.await === 'confirm-cancel') {
    if (_isNo(r.text)) return { actions: [_reply(CANCEL_KEPT_TEXT)], conv: null };
    if (!_isYes(r.text)) return null;
    const order = byId(c.orderId);
    if (!order) return { actions: [_reply(NOT_FOUND)], conv: null };
    // ירדה לייצור בין השאלה ל"כן" — לא מבטלים (וגם lgAgentCancel בודק שוב בטרנזקציה)
    if (!lgOkevCanChange(order)) return { actions: [_reply(lgOkevTooLate(order))], conv: null };
    return { actions: [{ type: 'cancel', orderId: order.id, okText: CANCEL_DONE_TEXT, lateText: lgOkevTooLate(order),
      staffText: _who(r) + ': ביקש לבטל את הזמנה ' + (order.orderNum || order.refNum || '') + ' — הביטול לא בוצע, נא לבדוק' }], conv: null };
  }
  if (c.await === 'change-details') {
    if (!_body(r)) return null;
    const order = byId(c.orderId) || { orderNum: '' };
    return { actions: [_staff(lgOkevChangeStaffText(order, _who(r), _body(r))), ...(r.hasImage ? [_forward(r)] : []),
                       _reply(AGENT_HANDOFF_TEXT)], conv: null };
  }
  return null;
}

// ── ניתוב רגיל לפי route של המרכזן. keep = ה-conv הנוכחי (נשאר אם לא הוחלף) ──
function _route(r, orders, now, keep) {
  switch (r.route) {
    case 'okev': {
      const found = lgOkevFind(orders, { quotedId: r.quotedId || '', ref: r.ref || '' });
      const text = lgOkevReply(r.intent, found);
      let conv = keep;
      if (found.match === 'many') conv = { await: 'which', intent: r.intent, orderIds: found.orders.map(o => o.id), at: now };
      else if (found.match === 'one' && lgOkevCanChange(found.orders[0])) {
        if (r.intent === 'cancel') conv = { await: 'confirm-cancel', orderId: found.orders[0].id, at: now };
        if (r.intent === 'change') conv = { await: 'change-details', orderId: found.orders[0].id, at: now };
      }
      return { actions: [_reply(text)], conv };
    }
    case 'menu': return { actions: [_reply(AGENT_MENU_TEXT)], conv: keep };
    // ארכיון ומחירון — עד משימות 5,6 עוברים לשאול
    case 'shaul': case 'archive': case 'quote': return { actions: _handoff(r), conv: keep };
    default: return { actions: [], conv: keep };   // kolet (הקליטה הקיימת), none, ignore
  }
}

// ─── החלטה — טהור ───────────────────────────────────────────────────
//  { actions, conv }: conv = מה שצריך להיות שמור אחרי ההודעה (null = למחוק).
function lgAgentDecide(p) {
  const { rec, conv } = p || {};
  const r = rec || {};
  const orders = (p && p.orders) || [];
  const now = Number(p && p.now) || Date.now();
  let c = conv && conv.await ? conv : null;
  // אדם עונה עכשיו / הודעת צוות — שום פעולה, conv לא נוגעים
  if (r.route === 'silent-human' || r.route === 'staff') return { actions: [], conv: c };
  if (c && !(now - Number(c.at || 0) <= CONV_TTL_MS)) {
    // Review Focus 2: "כן" אחרי יותר מ-30 דקות — לא מבטלים; שואלים מחדש
    if (r.linked && c.await === 'confirm-cancel' && _isYes(r.text)) {
      const order = orders.find(o => o.id === c.orderId);
      if (order) return _continue('cancel', order, now);
    }
    c = null;   // פג — מתעלמים (ונמחק)
  }
  // ⚠️ הזמנה חדשה (kolet) לא נבלעת כתשובה לשאלה פתוחה.
  // ⚠️ רק הודעה שנשלחה אחרי השאלה: askedAt = מתי השאלה נשלחה בפועל (act ממלא
  //    מהתור; לא נשלחה עדיין → אינסוף), ובלי askedAt — זמן ההחלטה (at).
  const msgAt = Number(r.timestamp || r.createdAt || 0);
  const askedAt = c ? Number(c.askedAt != null ? c.askedAt : (c.at || 0)) : 0;
  if (c && r.linked && r.route !== 'kolet' && msgAt > askedAt) {
    const h = _onConv(r, orders, c, now);
    if (h) return h;
  }
  return _route(r, orders, now, c);
}

// ─── ביצוע ──────────────────────────────────────────────────────────
const _switchesOn = env => env.AGENT_SHADOW_ENABLED === 'true' && env.AGENT_REPLY_ENABLED === 'true';

async function _cancel(db, orderId, ctx) {
  // R1: מוגדר במשימה 3 (module.exports.lgAgentCancel). עד אז — לא מבטלים.
  const fn = module.exports.lgAgentCancel;
  if (typeof fn !== 'function') return { ok: false, code: 'unavailable' };
  try { return (await fn(db, orderId, ctx)) || { ok: false, code: 'error' }; }
  catch (e) { console.warn('agent-act: cancel', e && e.name); return { ok: false, code: 'error' }; }
}

//  { acted, actions }
async function lgAgentAct(db, key, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const now = o.now || Date.now();
  const { SHADOW } = require('./_agent-shadow');   // עצל — _agent-shadow טוען את הקובץ הזה
  const recRef = db.ref(SHADOW + '/' + key);
  const rec = (await recRef.once('value')).val();
  if (!rec || rec.state !== 'done') return { acted: false, actions: [] };
  // פעם אחת לרשומה (null-first: הקריאה הראשונה עם null מחזירה ערך)
  const cl = await db.ref(SHADOW + '/' + key + '/actAt').transaction(cur => (cur ? undefined : now));
  if (!cl.committed) return { acted: false, actions: rec.wouldAct || [] };
  // ⚠️ מכאן — כל כשל נרשם ברשומה (actReason:'error'), לא נבלע בשקט
  try { return await _act(db, key, rec, recRef, env, now, o); }
  catch (e) {
    console.warn('agent-act:', e && e.name);
    try { await recRef.update({ acted: false, actReason: 'error', actError: String((e && e.name) || 'Error') }); }
    catch (e2) { console.warn('agent-act: could not record failure', e2 && e2.name); }
    return { acted: false, actions: [] };
  }
}

async function _act(db, key, rec, recRef, env, now, o) {

  const chat = String(rec.groupId || rec.chatId || '');
  const convRef = db.ref(CONV + '/' + lgWaInboundKey(chat));
  const stored = chat ? (await convRef.once('value')).val() : null;
  // מתי השאלה נשלחה בפועל — מהתור (askKey). עדיין לא נשלחה → אי אפשר לענות עליה
  let conv = stored;
  if (stored && stored.askKey) {
    const q = (await db.ref(AGENT_OUTBOX + '/' + stored.askKey).once('value')).val();
    conv = { ...stored, askedAt: q && q.state === 'sent' && q.sentAt ? Number(q.sentAt) : Number.MAX_SAFE_INTEGER };
  }
  const cid = String(rec.customerId || '');
  let orders = [];
  if (cid && rec.linked) {
    // ⚠️ כמו בצל: קורא את כל orders ומסנן — לפני הרחבה צריך אינדקס על customerId
    const all = (await db.ref('orders').once('value')).val() || {};
    orders = Object.entries(all).filter(([, x]) => x && String(x.customerId || '') === cid).map(([id, x]) => ({ ...x, id }));
  }
  const d = lgAgentDecide({ rec, orders, conv, now });
  const staff = lgAgentStaff(env);

  let why = '';
  if (!d.actions.length) why = 'no-action';
  else if (!_switchesOn(env)) why = 'switches-off';
  else if (rec.linked && !(cid && (await db.ref(PILOT + '/' + cid).once('value')).val() === true)) why = 'not-pilot';
  else if (!rec.linked && d.actions.some(a => a.type !== 'staff')) why = 'not-pilot';
  // "העברנו לשאול" בלי שאול מוגדר — עדיף לא לענות מאשר לשקר
  else if (d.actions.some(a => a.type === 'staff' || a.type === 'cancel') && !staff.length) why = 'no-staff';

  if (why) {
    await recRef.update({ wouldAct: d.actions, acted: false, actReason: why });
    // conv שפג נמחק גם כשלא פועלים; שום שינוי אחר ב-conv
    if (stored && !(now - Number(stored.at || 0) <= CONV_TTL_MS)) await convRef.set(null);
    return { acted: false, actions: d.actions };
  }

  const queued = [], cancels = [];
  const enq = async (k, to, text, files, reason) => {
    const q = await lgAgentEnqueue(db, { key: k, to, customerId: cid, text, files, reason });
    if (q.queued) queued.push(q.key);
    return q.queued;
  };
  let askKey = '';   // השאלה (תשובה ראשונה) שנכנסה לתור בפועל
  for (let i = 0; i < d.actions.length; i++) {
    const a = d.actions[i], k = key + '_' + i;
    if (a.type === 'reply') { if (await enq(k, chat, a.text, [], 'agent-reply') && !askKey) askKey = k; }
    else if (a.type === 'staff') await enq(k, staff[0], a.text, a.files || [], 'agent-staff');
    else if (a.type === 'files') await enq(k, chat, a.text || '', a.files || [], 'agent-files');
    else if (a.type === 'cancel') {
      const res = await _cancel(db, a.orderId, { customerId: cid, chatId: chat, now });
      cancels.push({ orderId: String(a.orderId), ok: !!res.ok, code: String(res.code || '') });
      // "ההזמנה בוטלה" רק אחרי ביטול שהצליח
      if (res.ok) await enq(k, chat, a.okText, [], 'agent-cancel');
      else if (res.code === 'too-late') await enq(k, chat, a.lateText, [], 'agent-cancel');
      else {
        await enq(k + '_s', staff[0], a.staffText + ' (' + String(res.code || 'error') + ')', [], 'agent-staff');
        await enq(k, chat, AGENT_HANDOFF_TEXT, [], 'agent-reply');
      }
    }
  }
  // conv אחרי התור ולפני השליחה. conv חדש נשמר רק אם השאלה באמת נכנסה לתור
  //  (queued:true) — עם askKey, כדי לדעת מתי נשלחה
  if (!d.conv) { if (stored) await convRef.set(null); }
  else if (d.conv !== conv && askKey) await convRef.set({ ...d.conv, askKey: lgWaInboundKey(askKey) });
  await recRef.update({ wouldAct: d.actions, acted: true, actReason: null, actQueued: queued, actCancels: cancels });

  if (queued.length) {
    try { await (o.sendPending || lgAgentSendPending)(db, { env, provider: o.provider, budgetMs: SEND_BUDGET_MS }); }
    catch (e) { console.warn('agent-act: send', e && e.name); }
  }
  return { acted: true, actions: d.actions };
}

module.exports = { CONV, CONV_TTL_MS, lgAgentDecide, lgAgentAct };
