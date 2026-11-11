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
//  ⚠️ הביטול עצמו — lgAgentCancel (משימה 3), למטה: ההזמנה יורדת מ-orders
//     ונשמרת ב-waMeta/agentCancels; מה שכבר נשלח לחשבשבת מוצג ב"תיקון הזמנות".
//  ⚠️ מחירון (משימה 6, _agent-quote.js): הודעת צוות (route 'staff') פועלת רק
//     כשהיא "השב" לבקשת מחיר ממתינה — ואז הנמען הוא הלקוח של הבקשה.
//  ⚠️ קולט — סקיצה שנמחקה (משימה 7): route 'kolet-deleted' + deletedId.
//     הזמנה של אותו לקוח עם waMessageId === deletedId: בתור (''/pending) →
//     ביטול שקט (בלי הודעה); בטיפול → "לבטל אותה?" + confirm-cancel (ה"כן"
//     עובר במסלול הרגיל); בייצור → הודעה. אין הזמנה → כלום. גם הביטול השקט
//     הוא פעולה — מתגים + פיילוט כמו כל השאר (בצל רק wouldAct).
//     אין הזמנה, אבל ההודעה היא של צרופה (בן, 10/11) → אותם כללים לפי השלב של
//     ההזמנה הראשית, על הצרופה בלבד: att-remove / "להוריד אותו?" + confirm-att-remove.
//  ⚠️ לא נרשם ללוג: טקסט ההודעה, טוקנים, מפתחות. רק e.name.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgWaInboundKey } = require('./_wa-inbound');
const { AGENT_OUTBOX, AGENT_DELETE_LIVE, AGENT_DELETED_REASON, AGENT_ASK_REASON, PER_ITEM_WORST_MS, lgAgentStaff, lgAgentEnqueue, lgAgentSendPending, lgAgentChatOwnedBy } = require('./_agent-send');
const { AGENT_MENU_TEXT, AGENT_HANDOFF_TEXT, CANCEL_DONE_TEXT, CANCEL_KEPT_TEXT, NOT_FOUND,
        lgOkevCanChange, lgOkevFind, lgOkevReply, lgOkevTooLate, lgOkevChangeStaffText,
        lgOkevTooLateStaffText, lgOkevCancelledStaffText } = require('./_agent-okev');

const { lgArchiveFind, lgArchiveActions, ARCHIVE_OK_TEXT } = require('./_agent-archive');
const { lgOkevEta, lgOkevEtaText } = require('./_agent-stats');
const { QUOTE_HOLD_TEXT, lgQuoteText, lgQuoteStaffText, lgQuoteForText, lgQuoteNext, lgQuoteSync,
        lgQuoteFindWaiting, lgQuoteClaim, lgQuoteDone, lgQuoteRelease, AGENT_QUOTES } = require('./_agent-quote');
const { PRICE_HOLD_TEXT, lgPriceStaffText, lgPriceClaimFor } = require('./_agent-price');
const { lgAgentConfig, lgAgentCustomerOn, lgAgentModeOf, lgAgentOfRoute } = require('./_agent-config');
const { lgRoomPost, lgRoomAskBenText, ASK_HOLD_TEXT, ROOM, ROOM_OPEN } = require('./_agent-room');
const { lgLessonFind, lgLessonUsed, lgLessonAutoOk } = require('./_agent-lessons');
const { WORD_TIMEOUT_MS, lgAgentWord, lgWordWouldTry } = require('./_agent-wording');

const CONV = 'waMeta/agentConv';
const CONV_TTL_MS = 30 * 60 * 1000;
const PILOT = 'waMeta/agentPilot';
const AGENT_CANCELS = 'waMeta/agentCancels';
// תיקון סופי 1 — דדליין: השליחה המיידית אחרי ההכנסה לתור מקבלת את הדדליין
// של נקודת הכניסה (webhook / drain / cron). בלי דדליין (קורא ישן) — 50ש׳ מעכשיו.
const AGENT_CHAIN_MS = 50 * 1000;
// חילוץ הצעת מחיר (מודל, עד 20ש׳) רק אם נשאר אחריו זמן לפריט שליחה; אחרת שאול
const AGENT_QUOTE_WORST_MS = 20 * 1000;

// ── קולט: סקיצה שנמחקה (משימה 7) ──
const DELETED_ASK_TEXT = 'הסקיצה שמחקת כבר בטיפול אצלנו. לבטל אותה?';
const DELETED_PROD_TEXT = 'הסקיצה שמחקת כבר בייצור, ואי אפשר לבטל אותה.';
// עוד לא התחילו לטפל — יורדת מהתור בשקט
const SILENT_STAGES = ['', 'pending'];

// ── צרופה שנמחקה (בן, 10/11): הודעה של תמונה שאוחדה כצרופה להזמנה ──
//  אותם כללי שלבים, על הצרופה בלבד — בהזמנה עצמה לא נוגעים.
const ATT_DELETED_ASK = label => "הקובץ '" + label + "' שמחקת כבר בטיפול. להוריד אותו?";
const ATT_DELETED_PROD = label => "הקובץ '" + label + "' שמחקת כבר בייצור, ואי אפשר להוריד אותו.";
const ATT_REMOVED_TEXT = label => "הקובץ '" + label + "' הוסר מההזמנה";
const ATT_KEPT_TEXT = 'בסדר, הקובץ נשאר בהזמנה';
const AGENT_ATT_REMOVALS = 'waMeta/agentAttRemovals';
const { LG_ATT_KINDS, lgAttFindByMsg } = require('./_order-attachments');
const _attLabel = (o, k) => LG_ATT_KINDS[(((o && o.attachments) || {})[k] || {}).kind] || 'הקובץ';
const _attMsg = (o, k) => { const a = ((o && o.attachments) || {})[k]; return String((a && a.from && a.from.order && a.from.order.waMessageId) || ''); };

// ── "כן" / "לא" לשאלת "בטוח?": בלי סימני פיסוק, רווחים מכווצים ──
const YES = ['כן', 'כן תבטל', 'בטוח', 'כן בטוח', 'תבטל', 'יאללה'];
const NO = ['לא', 'לא תבטל', 'עזוב', 'תשאיר'];
const _norm = s => String(s == null ? '' : s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const _isYes = s => YES.includes(_norm(s));
const _isNo = s => NO.includes(_norm(s));

const _reply = text => ({ type: 'reply', text });
const _staff = text => ({ type: 'staff', text });
// הודעה לשאול **לידיעה** (notify): לא תנאי לתשובה ללקוח — בלי שאול מוגדר היא פשוט
// לא נכנסת לתור, והלקוח עדיין מקבל את התשובה ("כבר בייצור", "בוטלה").
const _notify = text => ({ type: 'staff', notify: true, text });
// ביטול שבוצע בשלבים האלה — שאול מעודכן (תיקון סופי 4): כבר עבדו עליה
const NOTIFY_CANCEL_STAGES = ['chash', 'drafter', 'opty'];
const _who = r => String(r.customerName || r.sender || '');
// העברת ההודעה המקורית לשאול (תמונה)
const _forward = r => ({ type: 'staff', text: '', files: [{ kind: 'forward', fromChat: String(r.chatId || ''), idMessage: String(r.idMessage || '') }] });
const _body = r => String(r.text || '').trim() || (r.hasImage ? '(תמונה)' : '');

// ── "לא יודע → בן" (חדר הסוכנים, בן 10/11): שאלת לקוח שאף סוכן לא יודע ──
//  במקום שאול: ללקוח "קיבלנו, בודקים", בחדר הודעה צהובה, ולבן וואטסאפ קצר
//  (הביצוע ב-_act). הודעות לרצפה (שינוי / ביטול מאוחר) נשארות אצל שאול.
//  R5: לא מקושר → כלום (הטלפון של המפעל כבר מראה אותם; סכנת ספאם).
function _ask(r, extra) {
  if (!r.linked) return [];
  return [{ type: 'ask', who: _who(r), question: _body(r), ...(extra || {}), ...(r.hasImage ? { files: [_forward(r).files[0]] } : {}) }];
}

// ── מאוחר מדי לביטול/שינוי: התשובה ללקוח + שאול לידיעה (תיקון סופי 3) ──
const _tooLate = (r, order, intent) => [_reply(lgOkevTooLate(order)), _notify(lgOkevTooLateStaffText(order, _who(r), intent))];

// ── ממשיכים intent על הזמנה אחת שנבחרה ──
//  שיפור 2 (חדר הסוכנים): "בדרך כלל זה לוקח עוד בערך N ימים" — רק כשיש סטטיסטיקה (x.stageDays,
//  נטענת רק כשיש הגדרות במסך) ו-10 דגימות לפחות (_agent-stats.js). אחרת — הנוסח הקודם בדיוק.
function _statusText(order, x, now) {
  const t = lgOkevReply('status', { match: 'one', orders: [order], via: 'eta' });
  const n = x && x.stageDays ? lgOkevEta(order, x.stageDays, now) : 0;
  return n ? t + '. ' + lgOkevEtaText(n) : t;
}
function _continue(intent, order, now, r, x) {
  const one = { match: 'one', orders: [order], via: 'conv' };
  if (intent === 'status') return { actions: [_reply(_statusText(order, x, now))], conv: null };
  // ארכיון: נבחרה הזמנה → סקיצה שלה (ההזמנה כבר מהרשימה של הלקוח; השליחה בודקת שוב)
  if (intent === 'document') return { actions: [{ type: 'files', text: ARCHIVE_OK_TEXT, files: [{ kind: 'sketch', orderId: order.id }] }], conv: null };
  if (!lgOkevCanChange(order)) return { actions: _tooLate(r, order, intent), conv: null };
  if (intent === 'cancel') return { actions: [_reply(lgOkevReply('cancel', one))], conv: { await: 'confirm-cancel', orderId: order.id, at: now } };
  if (intent === 'change') return { actions: [_reply(lgOkevReply('change', one))], conv: { await: 'change-details', orderId: order.id, at: now } };
  return { actions: [_reply(NOT_FOUND)], conv: null };
}

// ── הודעה כשיש conv פעיל. null = לא תשובה לשאלה → ניתוב רגיל, conv נשאר ──
function _onConv(r, orders, c, now, x) {
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
    return order ? _continue(c.intent, order, now, r, x) : null;
  }
  if (c.await === 'confirm-cancel') {
    if (_isNo(r.text)) return { actions: [_reply(CANCEL_KEPT_TEXT)], conv: null };
    if (!_isYes(r.text)) return null;
    const order = byId(c.orderId);
    if (!order) return { actions: [_reply(NOT_FOUND)], conv: null };
    // ירדה לייצור בין השאלה ל"כן" — לא מבטלים (וגם lgAgentCancel בודק שוב בטרנזקציה)
    if (!lgOkevCanChange(order)) return { actions: _tooLate(r, order, 'cancel'), conv: null };
    // who + order — להודעות לשאול אחרי הביצוע (תיקונים סופיים 3, 4)
    return { actions: [{ type: 'cancel', orderId: order.id, okText: CANCEL_DONE_TEXT, lateText: lgOkevTooLate(order),
      who: _who(r), order: { orderNum: order.orderNum || '', refNum: order.refNum || '', sketchName: order.sketchName || '' },
      staffText: _who(r) + ': ביקש לבטל את הזמנה ' + (order.orderNum || order.refNum || '') + ' — הביטול לא בוצע, נא לבדוק' }], conv: null };
  }
  if (c.await === 'confirm-att-remove') {
    if (_isNo(r.text)) return { actions: [_reply(ATT_KEPT_TEXT)], conv: null };
    if (!_isYes(r.text)) return null;
    const order = byId(c.orderId);
    const k = Number(c.k);
    if (!order || !_attMsg(order, k)) return { actions: [_reply(NOT_FOUND)], conv: null };
    if (!lgOkevCanChange(order)) return { actions: [_reply(ATT_DELETED_PROD(_attLabel(order, k)))], conv: null };
    return { actions: [_attRemoveAction(r, order, k, false)], conv: null };
  }
  if (c.await === 'change-details') {
    if (!_body(r)) return null;
    const order = byId(c.orderId) || { orderNum: '' };
    return { actions: [_staff(lgOkevChangeStaffText(order, _who(r), _body(r))), ...(r.hasImage ? [_forward(r)] : []),
                       _reply(AGENT_HANDOFF_TEXT)], conv: null };
  }
  return null;
}

// ── קולט: הלקוח מחק את הודעת הסקיצה ──
//  רק הזמנות של אותו לקוח (orders כבר מסוננות ב-_act; כאן שוב, ליתר ביטחון).
//  כמה הזמנות מאותה הודעה: כולן בתור → ביטול שקט לכל אחת; אחת → לפי השלב;
//  אחרת (מעורב) → שאול.
function _deleted(r, orders, now) {
  const id = String(r.deletedId || '');
  const cid = String(r.customerId || '');
  const none = { actions: [], conv: null };
  if (!id || !cid || !r.linked) return none;
  const hit = orders.filter(o => o && String(o.waMessageId || '') === id && String(o.customerId || '') === cid);
  if (!hit.length) return _deletedAtt(r, orders, now);
  const num = o => String(o.orderNum || o.refNum || '');
  const silent = o => SILENT_STAGES.includes(String(o.stage || ''));
  if (hit.every(silent)) {
    return { actions: hit.map(o => ({ type: 'cancel', orderId: o.id, silent: true, okText: '', lateText: DELETED_PROD_TEXT,
      who: _who(r), order: { orderNum: o.orderNum || '', refNum: o.refNum || '', sketchName: o.sketchName || '' },
      staffText: _who(r) + ': מחק בוואטסאפ את הסקיצה של הזמנה ' + num(o) + ' — הביטול לא בוצע, נא לבדוק' })), conv: null };
  }
  if (hit.length === 1) {
    const o = hit[0];
    if (lgOkevCanChange(o)) return { actions: [_reply(DELETED_ASK_TEXT)], conv: { await: 'confirm-cancel', orderId: o.id, at: now } };
    return { actions: [_reply(DELETED_PROD_TEXT)], conv: null };
  }
  return { actions: [_staff(_who(r) + ': מחק בוואטסאפ סקיצה של כמה הזמנות (' + hit.map(num).join(', ') + ') — נא לבדוק'),
                     _reply(AGENT_HANDOFF_TEXT)], conv: null };
}

//  פעולת הסרה של צרופה (להחלטה ולביצוע). msgId — ההודעה שנמחקה; הביצוע בודק
//  שבמקום k עדיין יושבת אותה צרופה (k יכול להתמלא מחדש אחרי "הפרד" + איחוד).
function _attRemoveAction(r, o, k, silent) {
  const label = _attLabel(o, k), num = String(o.orderNum || o.refNum || '');
  return { type: 'att-remove', orderId: o.id, k, msgId: _attMsg(o, k), label, silent: !!silent,
    okText: silent ? '' : ATT_REMOVED_TEXT(label), lateText: ATT_DELETED_PROD(label), who: _who(r),
    staffText: _who(r) + ": מחק בוואטסאפ את '" + label + "' של הזמנה " + num + ' — הקובץ לא הוסר, נא לבדוק' };
}

// ── קולט: הלקוח מחק הודעה של צרופה (בן, 10/11) ──
//  רק כשאין הזמנה עם ההודעה הזו (נבדק ב-_deleted). השלב — של ההזמנה הראשית.
function _deletedAtt(r, orders, now) {
  const none = { actions: [], conv: null };
  const cid = String(r.customerId || '');
  const mine = orders.filter(o => o && String(o.customerId || '') === cid);
  const f = lgAttFindByMsg(mine, String(r.deletedId || ''));
  const o = f && mine.find(x => x.id === f.orderId);
  if (!o) return none;
  if (SILENT_STAGES.includes(String(o.stage || ''))) return { actions: [_attRemoveAction(r, o, f.k, true)], conv: null };
  const label = _attLabel(o, f.k);
  if (lgOkevCanChange(o)) return { actions: [_reply(ATT_DELETED_ASK(label))], conv: { await: 'confirm-att-remove', orderId: o.id, k: f.k, at: now } };
  return { actions: [_reply(ATT_DELETED_PROD(label))], conv: null };
}

// ── "סקיצה שנמחקה — פעיל" בלי שאר הסוכנים (בן, 3/11) ──
//  ההחלטה הרגילה, בלי שום דבר ללקוח: כולן בתור → אותם ביטולים שקטים (staffOnly —
//  כשל מגיע לשאול, לא ללקוח). כל השאר (בטיפול / בייצור / מעורב) → הודעה אחת לשאול.
function lgAgentDeleteOnly(d, r, orders) {
  const cancels = d.actions.filter(a => a.type === 'cancel' || a.type === 'att-remove');
  if (cancels.length && cancels.length === d.actions.length) return { actions: cancels.map(a => ({ ...a, staffOnly: true })), conv: null };
  const id = String(r.deletedId || ''), cid = String(r.customerId || '');
  //  צרופה (בן, 10/11) — כשאין הזמנה עם ההודעה הזו
  if (!orders.some(o => o && String(o.waMessageId || '') === id && String(o.customerId || '') === cid)) {
    const mine = orders.filter(o => o && String(o.customerId || '') === cid);
    const f = lgAttFindByMsg(mine, id);
    const o = f && mine.find(x => x.id === f.orderId);
    if (o) return { actions: [{ type: 'staff', reason: AGENT_DELETED_REASON,
      text: _who(r) + ": מחק בוואטסאפ את '" + _attLabel(o, f.k) + "' של הזמנה " + String(o.orderNum || o.refNum || '')
        + ' — ההזמנה כבר בטיפול והקובץ לא הוסר. נא לבדוק מולו' }], conv: null };
  }
  const nums = orders.filter(o => o && String(o.waMessageId || '') === id && String(o.customerId || '') === cid)
    .map(o => String(o.orderNum || o.refNum || '')).join(', ');
  return { actions: [{ type: 'staff', reason: AGENT_DELETED_REASON,
    text: _who(r) + ': מחק בוואטסאפ את הסקיצה של הזמנה ' + nums + ' — היא כבר בטיפול ולא בוטלה. נא לבדוק מולו' }], conv: null };
}

// ── ניתוב רגיל לפי route של המרכזן. keep = ה-conv הנוכחי (נשאר אם לא הוחלף) ──
//  x: { quoteToBen, … } — שיפורים לכל סוכן (חדר הסוכנים), רק כשיש הגדרות במסך
function _route(r, orders, now, keep, archive, quote, price, x) {
  const xo = x || {};
  //  תלונה כשהטיפול ב"לא מרוצה" כבוי (בלי הגדרות במסך): כמו שהיה לפני שהסיווג הכיר אותה — שאלה
  if (r.intent === 'complaint') return { actions: _ask(r), conv: keep };
  switch (r.route) {
    case 'okev': {
      const found = lgOkevFind(orders, { quotedId: r.quotedId || '', ref: r.ref || '' });
      // ביטול/שינוי של הזמנה שכבר בייצור — התשובה + שאול לידיעה (תיקון סופי 3)
      if (found.match === 'one' && (r.intent === 'cancel' || r.intent === 'change') && !lgOkevCanChange(found.orders[0]))
        return { actions: _tooLate(r, found.orders[0], r.intent), conv: keep };
      const text = r.intent === 'status' && found.match === 'one' ? _statusText(found.orders[0], xo, now) : lgOkevReply(r.intent, found);
      let conv = keep;
      if (found.match === 'many') conv = { await: 'which', intent: r.intent, orderIds: found.orders.map(o => o.id), at: now };
      else if (found.match === 'one' && lgOkevCanChange(found.orders[0])) {
        if (r.intent === 'cancel') conv = { await: 'confirm-cancel', orderId: found.orders[0].id, at: now };
        if (r.intent === 'change') conv = { await: 'change-details', orderId: found.orders[0].id, at: now };
      }
      return { actions: [_reply(text)], conv };
    }
    case 'menu': return { actions: [_reply(AGENT_MENU_TEXT)], conv: keep };
    // ארכיון: תוצאת החיפוש (lgArchiveFind, בשכבה הלא-טהורה) מגיעה ב-p.archive.
    // לא סופקה (אין חיפוש) → שאול, כמו קודם. 'many' מחליף conv בשאלת "על איזו".
    case 'archive': {
      if (!archive) return { actions: _ask(r), conv: keep };
      const a = lgArchiveActions(r, archive, now);
      return { actions: a.actions, conv: a.conv || keep };
    }
    // מחירון (משימה 6): סקיצה → "קיבלנו" + בקשת מחיר לשאול (המספר וההודעה
    //  נבנים ב-_act — רק כשמותר לשלוח). טקסט → p.quote מהשכבה הלא-טהורה:
    //  הובן ויש מחיר לכל פריט → ההצעה; אחרת → שאול.
    //  שיפור 6 (חדר הסוכנים, 11/11): עם הגדרות במסך (quoteToBen) — סקיצה → לבן כמו כל שאלה:
    //  צהוב בחדר + וואטסאפ לבן עם התמונה, ללקוח "נחזור אליך עם מחיר"; בן עונה בחדר
    //  (agent-room-answer) והתשובה יוצאת ללקוח. בלי הגדרות — לשאול כמו קודם.
    case 'quote': {
      if (r.hasImage && xo.quoteToBen) return { actions: _ask(r, { hold: QUOTE_HOLD_TEXT, note: _who(r) + ': בקשת מחיר על סקיצה' }), conv: keep };
      if (r.hasImage) return { actions: [_reply(QUOTE_HOLD_TEXT), { type: 'quote-ask', who: _who(r), files: [_forward(r).files[0]] }], conv: keep };
      const pr = quote && quote.ok ? quote.priced : null;
      if (pr && pr.lines.length && !pr.missing.length) return { actions: [_reply(lgQuoteText(pr))], conv: keep };
      return { actions: _ask(r), conv: keep };
    }
    // טענת מחיר / זיכוי (בן, 5/11): תמיד לשאול, עם הבדיקה מול המחירון של הלקוח
    //  (p.price מהשכבה הלא-טהורה; אין — 'לא זוהה'). ללקוח: "קיבלנו, בודקים".
    case 'price': {
      if (!r.linked) return { actions: [], conv: keep };
      const check = price && price.check ? price.check : { verdict: 'unknown', price: 0, lines: [] };
      return { actions: [_staff(lgPriceStaffText(check, _who(r), _body(r))), ...(r.hasImage ? [_forward(r)] : []),
                         _reply(PRICE_HOLD_TEXT)], conv: keep };
    }
    case 'shaul': return { actions: _ask(r), conv: keep };
    // קולט — סקיצה שנמחקה. conv חדש (שאלת "לבטל?") מחליף; אחרת נשאר
    case 'kolet-deleted': { const x = _deleted(r, orders, now); return { actions: x.actions, conv: x.conv || keep }; }
    default: return { actions: [], conv: keep };   // kolet (הקליטה הקיימת), none, ignore
  }
}

// ─── לקוח לא מרוצה (בן, 11/11) ──────────────────────────────────────
//  upset (בנוסף לכל intent) או complaint: ההחלטה הרגילה נזרקת ובמקומה שאלה צהובה לבן +
//  ללקוח התנצלות אחת (עם עובדות הסטטוס לפניה, אם יש הזמנה אחת מזוהה) — בלי "קיבלנו, בודקים".
//  לא נוגעים בהזמנה חדשה (kolet), באדם שעונה, ובהודעות צוות.
const UPSET_TEXT = 'מצטערים על העיכוב. בן יחזור אליך בהקדם.';
const UPSET_NOTE = 'לקוח לא מרוצה';
const UPSET_ROUTES = ['okev', 'complaint', 'menu', 'archive', 'quote', 'price', 'shaul'];
//  תודה / ברכה עם סימני קריאה אינן כעס — מתעלמים מ-upset בהן
function _isUpset(r, on) { return on === true && !!r && r.linked === true && r.intent !== 'thanks' && r.intent !== 'chitchat' && (r.upset === true || r.intent === 'complaint') && UPSET_ROUTES.includes(r.route); }
function _upset(r, orders, now, keep, xo, today) {
  let facts = '';
  if (r.route === 'okev' && (r.intent === 'status' || r.intent === 'complaint')) {
    const found = lgOkevFind(orders, { quotedId: r.quotedId || '', ref: r.ref || '' });
    if (found.match === 'one') facts = _statusText(found.orders[0], xo, now);
  }
  //  כבר היה לא מרוצה היום ובן לא ענה — רק לבן, בלי תשובה אוטומטית נוספת
  const hold = today ? '' : (facts ? facts + '\n\n' : '') + UPSET_TEXT;
  const ask = _ask(r, { note: UPSET_NOTE, benReason: 'agent-upset', upset: true, hold, noHold: !hold });
  //  בן לוקח את השיחה: שאלה פתוחה (למשל "בטוח לבטל?") נמחקת, כדי ש"כן" מאוחר לא יבטל לבד
  return { actions: ask, conv: null };
}

// ─── החלטה — טהור ───────────────────────────────────────────────────
//  { actions, conv }: conv = מה שצריך להיות שמור אחרי ההודעה (null = למחוק).
function lgAgentDecide(p) {
  const { rec, conv } = p || {};
  const r = rec || {};
  const orders = (p && p.orders) || [];
  const now = Number(p && p.now) || Date.now();
  const xo = { quoteToBen: !!(p && p.quoteToBen), stageDays: (p && p.stageDays) || null };
  let c = conv && conv.await ? conv : null;
  // אדם עונה עכשיו — שום פעולה, conv לא נוגעים
  if (r.route === 'silent-human') return { actions: [], conv: c };
  // הודעת צוות: רק "השב" של שאול לבקשת מחיר ממתינה (p.staffQuote, נמצאה ב-_act)
  //  → התשובה שלו ללקוח. כל הודעה אחרת מהצוות — כלום (Review Focus 1).
  if (r.route === 'staff') {
    const sq = p && p.staffQuote;
    const t = String(r.text || '').trim();
    if (!sq || sq.state !== 'waiting' || !t) return { actions: [], conv: c };
    return { actions: [{ type: 'quote-relay', n: sq.n, chat: sq.chat, customerId: sq.customerId, text: 'הצעת מחיר:\n' + t }], conv: c };
  }
  if (c && !(now - Number(c.at || 0) <= CONV_TTL_MS)) {
    // Review Focus 2: "כן" אחרי יותר מ-30 דקות — לא מבטלים; שואלים מחדש
    if (r.linked && c.await === 'confirm-cancel' && _isYes(r.text)) {
      const order = orders.find(o => o.id === c.orderId);
      if (order) return _continue('cancel', order, now, r);
    }
    //  צרופה — שואלים מחדש, כמו בביטול
    if (r.linked && c.await === 'confirm-att-remove' && _isYes(r.text)) {
      const order = orders.find(o => o.id === c.orderId);
      const k = Number(c.k);
      if (order && _attMsg(order, k)) {
        const label = _attLabel(order, k);
        if (!lgOkevCanChange(order)) return { actions: [_reply(ATT_DELETED_PROD(label))], conv: null };
        return { actions: [_reply(ATT_DELETED_ASK(label))], conv: { await: 'confirm-att-remove', orderId: order.id, k, at: now } };
      }
    }
    c = null;   // פג — מתעלמים (ונמחק)
  }
  // ⚠️ הזמנה חדשה (kolet) לא נבלעת כתשובה לשאלה פתוחה.
  // ⚠️ רק הודעה שנשלחה אחרי השאלה: askedAt = מתי השאלה נשלחה בפועל (act ממלא
  //    מהתור; לא נשלחה עדיין → אינסוף), ובלי askedAt — זמן ההחלטה (at).
  const msgAt = Number(r.timestamp || r.createdAt || 0);
  const askedAt = c ? Number(c.askedAt != null ? c.askedAt : (c.at || 0)) : 0;
  // תיקון סופי 5: אחרי "מה לשנות?" הלקוח שלח סקיצה — היא נקלטת כהזמנה כרגיל (kolet),
  //  ובנוסף שאול מקבל "נשלחה סקיצה חדשה" + העברת התמונה. בלי תשובה ללקוח (הקליטה מאשרת).
  if (c && r.linked && r.route === 'kolet' && c.await === 'change-details' && r.hasImage && msgAt > askedAt) {
    const order = orders.find(o => o.id === c.orderId) || { orderNum: '' };
    return { actions: [_staff(lgOkevChangeStaffText(order, _who(r), 'נשלחה סקיצה חדשה')), _forward(r)], conv: null };
  }
  if (c && r.linked && r.route !== 'kolet' && msgAt > askedAt) {
    const h = _onConv(r, orders, c, now, xo);
    if (h) return _isUpset(r, p.upsetOn) ? _upset(r, orders, now, c, xo, !!(p && p.upsetToday)) : h;
  }
  if (_isUpset(r, p && p.upsetOn)) return _upset(r, orders, now, c, xo, !!(p && p.upsetToday));
  return _route(r, orders, now, c, p && p.archive, p && p.quote, p && p.price, xo);
}

// ─── ביצוע ──────────────────────────────────────────────────────────
//  "עונה" — לפי המתג של הסוכן האחראי על המסלול (waMeta/agentConfig, בן 10/11),
//  דרך lgAgentModeOf בלבד. בלי הגדרות במסך — כמו קודם (AGENT_REPLY_ENABLED).

// ─── ביטול הזמנה (משימה 3) ─────────────────────────────────────────
//  נשלחה לחשבשבת בפועל (לא סימולציה). ⚠️ בבסיס הנתונים השדה הוא
//  hashavshevet; hsOrder הוא השם אחרי lgNormalizeOrder בדפדפן — שניהם נבדקים.
const _hsSent = o => { const h = o && (o.hashavshevet || o.hsOrder); return !!(h && h.sentAt && !h.simulated); };

//  { ok, code } — code: '' | 'missing' | 'forbidden' | 'too-late' | 'error'
//
//  סדר הפעולות (תיקוני סקירה t3, 31/10):
//   1. הצ'אט עדיין מקושר לאותו לקוח (waGroups / waSenders) — קישור שהוסר
//      אחרי השאלה לא מבטל. אחרת 'forbidden'.
//   2. קריאה מקדימה: קיימת / של הלקוח / בשלב מותר — בלי לכתוב כלום.
//   3. **הרשומה קודם**: waMeta/agentCancels/<id> עם confirmed:false, העותק
//      מהקריאה ו-token של הניסיון הזה — בטרנזקציה שלא דורסת רשומה מאושרת
//      (כבר בוטל → 'missing'). נכשלה → 'error', ולא מוחקים. אין מסלול שמוחק
//      בלי רשומה.
//   4. הבדיקה והמחיקה — **אותה טרנזקציה** על orders/<id> (R8): הזמנה שירדה
//      לביצוע או עברה ללקוח אחר רגע לפני — לא תימחק (Review Focus 3).
//      ⚠️ הרשומה יורדת **רק** בסירוב אמיתי (forbidden/too-late — ההזמנה
//      בוודאות קיימת), ורק אם היא עדיין שלי (token) ולא מאושרת. "אין הזמנה"
//      (ניסיון מקביל כבר מחק) או טרנזקציה שזרקה → לא נוגעים ברשומה: אחרת
//      ניסיון ב' היה מוחק את הרשומה של א' אחרי שא' מחק את ההזמנה (R2-1).
//   5. אחרי המחיקה: confirmed:true + העותק מהטרנזקציה + hsSent.
//  ⚠️ פונקציה שנהרגת בין 4 ל-5 משאירה רשומה confirmed:false שמחזיקה את
//     ההזמנה; "תיקון הזמנות" מציג רשומה כזו אחרי 10 דקות כ"לבדוק". אם
//     מחיקת הרשומה אחרי סירוב נכשלת — אותו דבר (רשומה לבדיקה, ההזמנה קיימת).
//  ⚠️ רשומה קודמת באותו מפתח: **מאושרת** (confirmed:true) — לא נדרסת; הטרנזקציה
//     מבטלת וחוזר 'missing' (גם אם ההזמנה שוחזרה ביד אחר כך — אז מבטלים ידנית).
//     לא מאושרת (ניסיון מקביל / שנפל באמצע) — נדרסת: היא מחזיקה את אותה הזמנה.
//  sketches/<id> נשאר — לא נוגעים.
async function lgAgentCancel(db, orderId, ctx) {
  const c = ctx || {};
  const id = String(orderId == null ? '' : orderId);
  const cid = String(c.customerId || '');
  const chatId = String(c.chatId || '');
  // מזהה עם '/' וכו' היה מוחק נתיב אחר
  if (!id || id.length > 200 || lgWaInboundKey(id) !== id) return { ok: false, code: 'missing' };
  if (!cid || !chatId || !(await lgAgentChatOwnedBy(db, chatId, cid))) return { ok: false, code: 'forbidden' };

  const ref = db.ref('orders/' + id);
  const pre = (await ref.once('value')).val();
  if (!pre) return { ok: false, code: 'missing' };
  if (String(pre.customerId || '') !== cid) return { ok: false, code: 'forbidden' };
  //  ctx.onlyStages — ביטול שקט (סקיצה שנמחקה): רק בשלבים האלה, גם אם lgOkevCanChange מרשה יותר
  const _stageOk = o => lgOkevCanChange(o) && (!Array.isArray(c.onlyStages) || c.onlyStages.includes(String(o.stage || '')));
  if (!_stageOk(pre)) return { ok: false, code: 'too-late', stage: String(pre.stage || '') };

  const now = c.now || Date.now();
  const recRef = db.ref(AGENT_CANCELS + '/' + id);
  const token = crypto.randomBytes(8).toString('hex');
  const draft = { order: pre, at: now, chatId, done: false, confirmed: false, token };
  let pw;
  try {
    // null-first: null → הטיוטה; רשומה מאושרת → ביטול (כבר בוטל). רשומה לא
    // מאושרת (ניסיון מקביל / שנפל) נדרסת — היא מחזיקה את אותה הזמנה.
    pw = await recRef.transaction(cur => (cur && cur.confirmed === true ? undefined : draft));
  } catch (e) { console.warn('agent-cancel: record', e && e.name); return { ok: false, code: 'error' }; }
  if (!pw.committed) return { ok: false, code: 'missing' };

  let taken = null, why = '', lateStage = '';
  let tx;
  try {
    tx = await ref.transaction(cur => {
      taken = null; why = '';
      // ⚠️ null-first: הקריאה הראשונה היא מהמטמון (null). מחזירים null (מחיקה
      //    של כלום) כדי שפיירבייס יביא את הערך האמיתי; אם באמת אין — 'missing'.
      if (cur === null) return null;
      if (String(cur.customerId || '') !== cid) { why = 'forbidden'; return; }
      if (!_stageOk(cur)) { why = 'too-late'; lateStage = String(cur.stage || ''); return; }
      taken = cur;
      return null;   // מחיקה — באותה טרנזקציה עם הבדיקה
    });
  } catch (e) {
    // R2-2: לא ידוע אם נמחק — הרשומה נשארת (תוצג "לבדוק" אחרי 10 דקות)
    console.warn('agent-cancel: tx', e && e.name);
    return { ok: false, code: 'error' };
  }

  if (tx.committed && !taken) return { ok: false, code: 'missing' };   // ניסיון מקביל מחק — לא נוגעים
  if (!tx.committed) {
    if (why === 'forbidden' || why === 'too-late') {
      // סירוב אמיתי — ההזמנה קיימת. מורידים רק את הטיוטה **שלי**
      try { await recRef.transaction(cur => (cur === null ? null : (cur.token === token && cur.confirmed !== true ? null : undefined))); }
      catch (e) { console.warn('agent-cancel: unrecord', e && e.name); }
    }
    return why === 'too-late' ? { ok: false, code: why, stage: lateStage } : { ok: false, code: why || 'error' };
  }
  try { await recRef.update({ order: taken, hsSent: _hsSent(taken), confirmed: true }); }
  catch (e) {
    // נמחק, אבל לא אושר — הרשומה (confirmed:false) מחזיקה את ההזמנה ותוצג לבדיקה
    console.warn('agent-cancel: confirm', e && e.name);
    return { ok: false, code: 'error' };
  }
  return { ok: true, code: '', stage: String(taken.stage || '') };
}

// ─── הסרת צרופה (בן, 10/11) ─────────────────────────────────────────
//  { ok, code, stage } — code: '' | 'missing' | 'forbidden' | 'too-late' | 'error'
//  ההזמנה עצמה נשארת; יורדים רק orders/<id>/attachments/<k> ו-sketches/<id>__att<k>.
//  ctx: { customerId, chatId, now, waMessageId (חובה — ההודעה שנמחקה), onlyStages? }
//  לפני ההסרה — עותק (הרשומה + התמונה) ב-waMeta/agentAttRemovals, כדי שאפשר יהיה להחזיר ביד.
async function lgAgentAttRemove(db, orderId, k, ctx) {
  const c = ctx || {};
  const id = String(orderId == null ? '' : orderId);
  const kk = Number(k);
  const cid = String(c.customerId || ''), chatId = String(c.chatId || ''), msg = String(c.waMessageId || '');
  if (!id || id.length > 200 || lgWaInboundKey(id) !== id || !Number.isInteger(kk) || kk < 1 || !msg) return { ok: false, code: 'missing' };
  if (!cid || !chatId || !(await lgAgentChatOwnedBy(db, chatId, cid))) return { ok: false, code: 'forbidden' };
  const _stageOk = o => lgOkevCanChange(o) && (!Array.isArray(c.onlyStages) || c.onlyStages.includes(String(o.stage || '')));
  const ref = db.ref('orders/' + id);
  const pre = (await ref.once('value')).val();
  if (!pre) return { ok: false, code: 'missing' };
  if (String(pre.customerId || '') !== cid) return { ok: false, code: 'forbidden' };
  if (_attMsg(pre, kk) !== msg) return { ok: false, code: 'missing' };
  if (!_stageOk(pre)) return { ok: false, code: 'too-late', stage: String(pre.stage || '') };

  const now = c.now || Date.now();
  const sk = 'sketches/' + id + '__att' + kk;
  try {
    const img = (await db.ref(sk).once('value')).val();
    await db.ref(AGENT_ATT_REMOVALS + '/' + id + '__att' + kk + '_' + now)
      .set({ orderId: id, k: kk, att: pre.attachments[kk], sketch: img || null, at: now, chatId, customerId: cid });
  } catch (e) { console.warn('agent-att-remove: record', e && e.name); return { ok: false, code: 'error' }; }

  let why = '', taken = null, lateStage = '';
  let tx;
  try {
    tx = await ref.transaction(cur => {
      why = ''; taken = null;
      if (cur === null) return null;   // null-first — פיירבייס יביא את הערך האמיתי
      if (String(cur.customerId || '') !== cid) { why = 'forbidden'; return; }
      if (_attMsg(cur, kk) !== msg) { why = 'missing'; return; }
      if (!_stageOk(cur)) { why = 'too-late'; lateStage = String(cur.stage || ''); return; }
      const atts = { ...cur.attachments };
      delete atts[kk];
      taken = cur;
      return { ...cur, attachments: Object.keys(atts).length ? atts : null, updatedAt: now };
    });
  } catch (e) { console.warn('agent-att-remove: tx', e && e.name); return { ok: false, code: 'error' }; }
  if (!tx.committed || !taken || !tx.snapshot.val()) {
    return why === 'too-late' ? { ok: false, code: why, stage: lateStage } : { ok: false, code: why || 'missing' };
  }
  try { await db.ref(sk).set(null); }
  catch (e) { console.warn('agent-att-remove: image', e && e.name); }   // הרשומה ירדה; תמונה יתומה לא מוצגת בשום מקום
  return { ok: true, code: '', stage: String(taken.stage || '') };
}

async function _attRemove(db, orderId, k, ctx) {
  // דרך module.exports — כדי שבדיקות יוכלו להחליף אותה
  const fn = module.exports.lgAgentAttRemove;
  if (typeof fn !== 'function') return { ok: false, code: 'unavailable' };
  try { return (await fn(db, orderId, k, ctx)) || { ok: false, code: 'error' }; }
  catch (e) { console.warn('agent-act: att-remove', e && e.name); return { ok: false, code: 'error' }; }
}

async function _cancel(db, orderId, ctx) {
  // דרך module.exports — כדי שבדיקות יוכלו להחליף אותה
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
  // דדליין אחד לכל השרשרת (תיקון סופי 1)
  const clock = typeof o.clock === 'function' ? o.clock : Date.now;
  const oo = { ...o, clock, deadline: o.deadline != null ? Number(o.deadline) : clock() + AGENT_CHAIN_MS };
  // ⚠️ מכאן — כל כשל נרשם ברשומה (actReason:'error'), לא נבלע בשקט
  try { return await _act(db, key, rec, recRef, env, now, oo); }
  catch (e) {
    console.warn('agent-act:', e && e.name);
    try { await recRef.update({ acted: false, actReason: 'error', actError: String((e && e.name) || 'Error') }); }
    catch (e2) { console.warn('agent-act: could not record failure', e2 && e2.name); }
    return { acted: false, actions: [] };
  }
}

const _ilDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
//  שאלה פתוחה בחדר, סיבה agent-upset, אותו customerId, מהיום. האינדקס הפתוח קטן; רשומות ישנות בלי customerId לא נספרות.
async function _upsetToday(db, cid, now) {
  try {
    const open = (await db.ref(ROOM_OPEN).once('value')).val() || {};
    const day = _ilDay(now);
    return Object.values(open).some(e => e && e.reason === 'agent-upset' && String(e.customerId || '') === cid && _ilDay(Number(e.at) || 0) === day);
  } catch (e) { console.warn('agent-act: upset-today', e && e.name); return false; }
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
  // ארכיון: החיפוש ב-DB כאן (decide נשאר טהור). כשל בחיפוש → 'none' (שאול + "אני בודק")
  //  תיקון סופי 7: מתגים דולקים → מחפשים רק אחרי שער הפיילוט + הקישור (אחרת ממילא
  //  לא פועלים). מתגים כבויים (צל) → מחפשים, כדי ש-wouldAct יראה מה היה נשלח.
  const agent = lgAgentOfRoute(rec.route);
  const cfg = await lgAgentConfig(db);
  const _pilotOn = id => lgAgentCustomerOn(db, id, cfg);
  const agentMode = lgAgentModeOf(cfg, agent, env);
  let archive;
  const _archiveGate = async () => agentMode !== 'reply'
    || (await _pilotOn(cid) && (rec.linkVia != null ? ['group', 'sender'].includes(String(rec.linkVia))
                                                   : ['group', 'sender'].includes(await require('./_agent-shadow').lgAgentLinkVia(db, rec))));
  if (rec.route === 'archive' && rec.linked && cid && await _archiveGate()) {
    //  שיפור 4: "כל החשבוניות של <חודש>" — רק כשיש הגדרות במסך
    try { archive = await lgArchiveFind(db, { customerId: cid, ref: rec.ref, text: rec.text, orders, byMonth: !!cfg, now }); }
    catch (e) { console.warn('agent-act: archive', e && e.name); archive = { kind: 'none' }; }
  }
  // מחירון: טקסט → מודל + מחירון (כשל → שאול). "השב" של שאול → הבקשה הממתינה
  let quote, staffQuote, quoteSkipped = false;
  if (rec.route === 'quote' && rec.linked && cid && !rec.hasImage) {
    if (o.deadline - o.clock() < AGENT_QUOTE_WORST_MS + PER_ITEM_WORST_MS) { quoteSkipped = true; quote = { ok: false, priced: null }; }
    else {
      try { quote = await lgQuoteForText(db, { customerId: cid, text: rec.text, env, fetcher: o.fetchImpl }); }
      catch (e) { console.warn('agent-act: quote', e && e.name); quote = { ok: false, priced: null }; }
    }
  }
  // טענת מחיר: מודל + מחירון (כשל / אין זמן → 'לא זוהה', עדיין לשאול)
  let price, priceSkipped = false;
  if (rec.route === 'price' && rec.linked && cid) {
    if (o.deadline - o.clock() < AGENT_QUOTE_WORST_MS + PER_ITEM_WORST_MS) priceSkipped = true;
    else {
      try { price = await lgPriceClaimFor(db, { customerId: cid, text: rec.text, env, fetcher: o.fetchImpl }); }
      catch (e) { console.warn('agent-act: price', e && e.name); price = null; }
    }
  }
  if (rec.route === 'staff' && rec.quotedId) {
    try { staffQuote = await lgQuoteFindWaiting(db, rec.quotedId); }
    catch (e) { console.warn('agent-act: quote-find', e && e.name); staffQuote = null; }
  }
  //  שיפורים לכל סוכן — רק כשיש הגדרות במסך (בלי waMeta/agentConfig שום דבר מול לקוח לא משתנה)
  //  שיפור 2: זמן רגיל לשלב — נשמר בריצה האיטית של הדופק (_agent-watch → _agent-stats)
  let stageDays = null;
  if (cfg && rec.route === 'okev') {
    try { stageDays = (await db.ref(require('./_agent-stats').AGENT_STATS).once('value')).val() || null; }
    catch (e) { console.warn('agent-act: stage stats', e && e.name); stageDays = null; }
  }
  //  לקוח לא מרוצה: האם כבר יש שאלה פתוחה כזו מהיום (שעון ישראל) לאותו לקוח
  let upsetToday = false;
  if (cfg && rec.linked && cid && (rec.upset === true || rec.intent === 'complaint')) upsetToday = await _upsetToday(db, cid, now);
  let d = lgAgentDecide({ rec, orders, conv, now, archive, quote, staffQuote, price, quoteToBen: !!cfg, stageDays, upsetToday, upsetOn: !!cfg });
  // t6-4: עלות החילוץ נשמרת ברשומה (רק כשהמודל נקרא למחירון)
  const qUsage = quoteSkipped ? { quoteSkipped: 'deadline' } : quote ? { quoteUsage: quote.usage || null }
    : priceSkipped ? { priceSkipped: 'deadline' } : price ? { priceUsage: price.usage || null } : {};
  const staff = lgAgentStaff(env);
  const _pilot = _pilotOn;

  // תיקון סופי 2: "בפיילוט" = אותו קישור שהשליחה בודקת (waGroups / waSenders).
  //  רשומה בלי linkVia (נרשמה לפני התיקון) — נבדק עכשיו. תשובת שאול (staff) —
  //  הנמען הוא הלקוח של הבקשה, והשליחה בודקת את הקישור שלו.
  const { lgAgentLinkVia, AGENT_SENDABLE_VIA } = require('./_agent-shadow');
  const linkVia = rec.linked && rec.route !== 'staff'
    ? (rec.linkVia != null ? String(rec.linkVia) : await lgAgentLinkVia(db, rec)) : '';
  let why = '';
  if (!d.actions.length) why = 'no-action';
  else if (rec.linked && rec.route !== 'staff' && !AGENT_SENDABLE_VIA.includes(linkVia)) why = 'not-linked';
  //  כבוי במסך (המתג העליון דולק) → agent-off; שקט / המתג העליון כבוי → switches-off כמו קודם
  else if (agentMode === 'off' && env.AGENT_SHADOW_ENABLED === 'true') why = 'agent-off';
  else if (agentMode !== 'reply') why = 'switches-off';
  // תשובת שאול — הנמען הוא הלקוח של הבקשה (לא השולח), ולכן הפיילוט שלו
  else if (rec.route === 'staff') { if (!(await _pilot(staffQuote && staffQuote.customerId))) why = 'not-pilot'; }
  else if (rec.linked && !(await _pilotOn(cid))) why = 'not-pilot';
  else if (!rec.linked && d.actions.some(a => a.type !== 'staff')) why = 'not-pilot';
  // "העברנו לשאול" בלי שאול מוגדר — עדיף לא לענות מאשר לשקר
  //  (הודעה לידיעה — notify — לא נחשבת: בלעדיה התשובה ללקוח עדיין נכונה)
  else if (d.actions.some(a => (a.type === 'staff' && !a.notify) || a.type === 'cancel' || a.type === 'att-remove' || a.type === 'quote-ask') && !staff.length) why = 'no-staff';

  //  "סקיצה שנמחקה — פעיל" (בן, 3/11): תשובות כבויות / לא בפיילוט, אבל המתג הנפרד
  //  דולק → רק המחיקה פועלת, ללקוח לא יוצא כלום. צ'אט מקושר בלבד (נבדק למעלה).
  let mode = null;
  //  ⚠️ גם כשהקולט "כבוי" במסך (agent-off) — המתג הנפרד מחליט על המחיקה (תיקון סקירה 10/11)
  if ((why === 'switches-off' || why === 'not-pilot' || why === 'agent-off') && rec.route === 'kolet-deleted' && rec.linked
      && (await db.ref(AGENT_DELETE_LIVE).once('value')).val() === true) {
    if (!staff.length) why = 'no-staff';
    else { d = lgAgentDeleteOnly(d, rec, orders); mode = 'delete-only'; why = ''; }
  }

  if (why) {
    await recRef.update({ wouldAct: d.actions, acted: false, actReason: why, ...qUsage });
    // conv שפג נמחק גם כשלא פועלים; שום שינוי אחר ב-conv
    if (stored && !(now - Number(stored.at || 0) <= CONV_TTL_MS)) await convRef.set(null);
    return { acted: false, actions: d.actions };
  }

  const queued = [], cancels = [], quotes = [], attRemovals = [];
  const enq = async (k, to, text, files, reason, forCid) => {
    const q = await lgAgentEnqueue(db, { key: k, to, customerId: forCid != null ? forCid : cid, text, files, reason, agent });
    if (q.queued) queued.push(q.key);
    return q.queued;
  };
  let askKey = '';   // השאלה (תשובה ראשונה) שנכנסה לתור בפועל
  let lessonInfo = null;   // למידה: מה ההשוואה מצאה (נרשם ברשומה)
  //  תיקון סופי 9: בהחלטה שתלויה בשאול (העברה אליו / בקשת מחיר) התשובות ללקוח
  //  ("העברנו לשאול", "נחזור אליך עם מחיר", "אני בודק") נכנסות לתור רק אחרי —
  //  ורק אם — לפחות הודעה אחת לשאול באמת נכנסה. אחרת היינו מבטיחים משהו שלא יקרה.
  const needsStaff = d.actions.some(a => (a.type === 'staff' && !a.notify) || a.type === 'quote-ask');
  let staffQueued = false;
  const deferred = [];
  //  תשובות בשילוב (spec ג; תיקון סקירה 12/11): העובדות יוצאות **כמו שהן**. המודל לא כותב
  //  טקסט — רק בוחר פתיחה / סיום מרשימות סגורות (_agent-wording: LG_WRAP_OPENERS / CLOSERS).
  //  רק עם הגדרות במסך והסוכן "עונה" — בשקט לעולם לא קוראים למודל. אין זמן לעטיפה + שליחה
  //  → העובדות לבד (wordSkipped נרשם רק כשבאמת היינו מנסים).
  //  ⚠️ לא נעטפים: הודעות לשאול / לבן, "קיבלנו, אנחנו בודקים", שיעור שנלמד, תשובת בן
  //     מהחדר, תוצאות ביטול, כיתוב קבצים, ושליחה חוזרת של שומר (אלה לא עוברים כאן).
  //  ברכה (chitchat → תפריט): kind 'free' — פתיחה מהרשימה + התפריט כמו שהוא; אין פתיחה → התפריט לבד.
  //  התנצלות "לא מרוצה": העובדות + "מצטערים…" כמו שהן, עם פתיחה בלבד מהפריטים שמתאימים לתלונה (upset).
  const wordOn = !!cfg && agentMode === 'reply' && mode !== 'delete-only';
  const replyWords = [];   //  כל תשובה שנעטפה: { original, sent } — מוצג ב"מה X עשה"
  let wordSkipped = '';
  const _word = async (text, opt) => {
    const menu = text === AGENT_MENU_TEXT && rec.intent === 'chitchat';
    if (!wordOn || !text || (text === AGENT_MENU_TEXT && !menu)) return text;
    const args = { kind: menu ? 'free' : 'facts', customerText: rec.text, customerName: rec.customerName, facts: text,
                   model: env.AGENT_MODEL, key: env.OPENAI_API_KEY, fetcher: o.fetchImpl, timeoutMs: WORD_TIMEOUT_MS,
                   upset: !!(opt && opt.upset) };
    if (!lgWordWouldTry(args)) return text;
    if (o.deadline - o.clock() < WORD_TIMEOUT_MS + PER_ITEM_WORST_MS) { wordSkipped = 'deadline'; return text; }
    let w = null;
    try { w = await lgAgentWord(args); }
    catch (e) { console.warn('agent-act: wording', e && e.name); w = null; }
    if (!(w && w.reworded && w.text)) return text;
    replyWords.push({ original: text, sent: w.text, usage: w.usage || null });
    return w.text;
  };
  for (let i = 0; i < d.actions.length; i++) {
    const a = d.actions[i], k = key + '_' + i;
    if (a.type === 'reply' && needsStaff) deferred.push([k, a]);
    else if (a.type === 'reply') { if (await enq(k, chat, await _word(a.text), [], 'agent-reply') && !askKey) askKey = k; }
    else if (a.type === 'staff') {
      if (a.notify && !staff[0]) continue;   // לידיעה, ואין שאול — מדלגים
      if (await enq(k, staff[0], a.text, a.files || [], a.reason || 'agent-staff') && !a.notify) staffQueued = true;
    }
    else if (a.type === 'files') {
      // R2-1: רשומה לכל קובץ (<key>_<i>_f<j>) — חשבונית + סקיצות בהודעה אחת לא נכנסת
      //  לעולם בדדליין של 50ש׳. הטקסט ("מצורף") — כיתוב של הקובץ הראשון בלבד.
      const fl = a.files || [];
      for (let j = 0; j < fl.length; j++) await enq(k + '_f' + j, chat, j === 0 ? (a.text || '') : '', [fl[j]], 'agent-files');
      if (!fl.length && a.text) await enq(k, chat, a.text, [], 'agent-files');
    }
    else if (a.type === 'ask') {
      //  "לא יודע → בן": צהוב בחדר + וואטסאפ קצר לבן; ללקוח "קיבלנו" רק אם לפחות
      //  אחד מהם באמת נכתב (אחרת היינו מבטיחים בדיקה שאף אחד לא יודע עליה)
      const line = String(a.question || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
      //  למידה (שלב ג׳, _agent-lessons): שאלה דומה לכלל שבן אישר? רק טקסט (לא תמונה).
      //  ⚠️ כאן כבר עברו כל השערים (הסוכן "עונה", לקוח מופעל ומקושר) — אחרת המודל לא נקרא.
      let lm = null;
      //  hold משלו (שיפורים 4, 6 — כמות חשבוניות / בקשת מחיר) — בלי למידה: ההודעה ללקוח קבועה
      if (!(a.files && a.files.length) && !a.hold && !a.upset && a.question && a.question !== '(תמונה)') {
        try {
          lm = await lgLessonFind(db, { agent, question: a.question, env, fetcher: o.fetchImpl, matcher: o.lessonMatch,
                                        deadline: o.deadline, clock: o.clock, reserveMs: 2 * PER_ITEM_WORST_MS });
        } catch (e) { console.warn('agent-act: lessons', e && e.name); lm = null; }
        if (lm && lm.skipped) lessonInfo = { lessonMatch: { skipped: lm.skipped } };
        else if (lm && lm.id) lessonInfo = { lessonMatch: { id: lm.id, confidence: lm.confidence, auto: lgLessonAutoOk(lm.lesson, cid, lm.confidence) } };
        if (lm && lm.usage) lessonInfo = { ...(lessonInfo || {}), lessonUsage: lm.usage };
      }
      const from = lm && lm.id ? String(lm.lesson.customerName || lm.lesson.customerId || '') : '';
      //  כלל אוטומטי (3 אישורים ברצף): התשובה ישר ללקוח, בלי "קיבלנו" ובלי בן; בחדר שורה עם "תקן".
      //  ⚠️ (תיקון סקירה 11/11) רק לאותו לקוח (או כלל "כללי" בלי ספרה/מחיר/תאריך), ביטחון ≥0.9.
      //  השורה בחדר נכתבת קודם — בלעדיה אין "תקן", ולכן לא עונים לבד. נכשל להיכנס לתור →
      //  השורה יורדת וממשיכים לצהוב הרגיל.
      if (lm && lm.id && lgLessonAutoOk(lm.lesson, cid, lm.confidence)) {
        const ik = await lgRoomPost(db, { agent, kind: 'info', text: 'עניתי לפי מה שאישרת: ' + String(lm.lesson.topic || lm.topic || ''),
          lessonId: lm.id, lessonAuto: true, topic: lm.lesson.topic, proposal: lm.lesson.answer, lessonFrom: from, customerId: cid, customerName: a.who, chat,
          question: a.question, outboxKey: lgWaInboundKey(k), ref: { customerId: cid, shadowKey: key } }, now);
        if (ik) {
          if (await enq(k, chat, String(lm.lesson.answer || ''), [], 'agent-lesson')) {
            if (!askKey) askKey = k;
            await lgLessonUsed(db, lm.id, now);
            continue;
          }
          try { await db.ref(ROOM + '/' + ik).set(null); } catch (e) { console.warn('agent-act: lesson room undo', e && e.name); }
        }
        if (lessonInfo && lessonInfo.lessonMatch) lessonInfo.lessonMatch.auto = false;
      }
      const prop = lm && lm.id ? { lessonId: lm.id, proposal: lm.lesson.answer, lessonFrom: from } : {};
      const rk = await lgRoomPost(db, { agent, kind: 'ask', state: 'open', text: a.note || (String(a.who || '') + ': ' + line.slice(0, 200)),
        customerId: cid, customerName: a.who, chat, question: a.question, suggest: a.suggest, note: a.note,
        reason: a.benReason || undefined,
        topic: lm && lm.topic ? lm.topic : undefined, ...prop,
        ref: { customerId: cid, shadowKey: key } }, now);
      //  ⚠️ (תיקון סקירה 10/11) הכל תלוי בצהוב: בלעדיו אין על מה לענות בחדר — לא
      //  מציקים לבן ולא מבטיחים ללקוח. ההתראה נושאת את הלקוח (cid): השליחה מתירה
      //  העברת תמונה למספר של בן רק מהצ'אט של הלקוח הזה.
      //  ההתראה לבן — דרך lgBenNotify (_agent-ben.js, בן 11/11): אחת למפתח, לא בלילה (נכנסת להודעת
      //  הבוקר), עד 20 ביום. השליחה עצמה — כאן למטה עם שאר התור (flush:false).
      if (rk) {
        const bn = await require('./_agent-ben').lgBenNotify(db, { key: k + '_b', outboxKey: k + '_b',
          text: lgRoomAskBenText(a.who, a.upset ? UPSET_NOTE + ': ' + a.question : a.question, env), reason: a.benReason || AGENT_ASK_REASON, urgent: false, env, now, cfg, agent,
          customerId: cid, files: a.files || [], open: ROOM_OPEN + '/' + rk, flush: false });
        if (bn.queued) queued.push(bn.key);
        //  ההתנצלות של "לא מרוצה" (עובדות + "מצטערים…") — נעטפת בפתיחה בלבד; "קיבלנו" הקבוע — לא
        if (!a.noHold) await enq(k, chat, a.upset && a.hold ? await _word(a.hold, { upset: true }) : (a.hold || ASK_HOLD_TEXT), [], 'agent-reply');
      }
    }
    else if (a.type === 'quote-ask') {
      // t6-3: הבקשה נשמרת רק אחרי שהודעה לשאול נכנסה לתור (ועוד לפני השליחה,
      //  שקורית אחרי הלולאה). staffMessageId יתמלא מהתור אחרי שהטקסט נשלח
      const n = await lgQuoteNext(db);
      if (await enq(k, staff[0], lgQuoteStaffText(n, a.who), a.files || [], 'agent-quote')) {
        staffQueued = true;
        await db.ref(AGENT_QUOTES + '/' + n).set({ customerId: cid, chat, staffMessageId: null, outboxKey: lgWaInboundKey(k),
                                                   recordKey: key, at: now, state: 'waiting' });
        quotes.push(n);
      }
    } else if (a.type === 'quote-relay') {
      // פעם אחת: רק התופס (waiting → relaying) מכניס לתור; answered רק אחרי
      //  שנכנס (t6-2). כשל בתור → חוזר ל-waiting. השליחה בודקת שוב קישור + פיילוט
      if (await lgQuoteClaim(db, a.n, rec.quotedId, key, k, now)) {
        try { await enq(k, a.chat, a.text, [], 'agent-quote', a.customerId); }
        catch (e) {
          try { await lgQuoteRelease(db, a.n, key); } catch (e2) { console.warn('agent-act: quote-release', e2 && e2.name); }
          throw e;
        }
        await lgQuoteDone(db, a.n, key, now);
      }
    }
    else if (a.type === 'att-remove') {
      //  צרופה שנמחקה (בן, 10/11) — כמו הביטול, על הצרופה בלבד
      const res = await _attRemove(db, a.orderId, a.k, { customerId: cid, chatId: chat, now, waMessageId: a.msgId,
                                                         onlyStages: a.silent ? SILENT_STAGES : undefined });
      attRemovals.push({ orderId: String(a.orderId), k: Number(a.k), ok: !!res.ok, code: String(res.code || '') });
      const sReason = a.staffOnly ? AGENT_DELETED_REASON : 'agent-staff';
      if (res.ok) { if (a.okText && !a.staffOnly) await enq(k, chat, a.okText, [], 'agent-cancel'); }
      else if (res.code === 'missing') { if (!a.silent && !a.staffOnly) await enq(k, chat, NOT_FOUND, [], 'agent-reply'); }
      else if (a.staffOnly) {
        await enq(k + '_s', staff[0], a.staffText + (res.code === 'too-late' ? ' (כבר בייצור)' : ' (' + String(res.code || 'error') + ')'), [], sReason);
      } else if (res.code === 'too-late') await enq(k, chat, a.lateText, [], 'agent-cancel');
      else if (await enq(k + '_s', staff[0], a.staffText + ' (' + String(res.code || 'error') + ')', [], 'agent-staff'))
        await enq(k, chat, AGENT_HANDOFF_TEXT, [], 'agent-reply');
    }
    else if (a.type === 'cancel') {
      const res = await _cancel(db, a.orderId, { customerId: cid, chatId: chat, now, onlyStages: a.silent ? SILENT_STAGES : undefined });
      cancels.push({ orderId: String(a.orderId), ok: !!res.ok, code: String(res.code || '') });
      const ord = { ...(a.order || {}) };
      // "ההזמנה בוטלה" רק אחרי ביטול שהצליח. ביטול שקט (סקיצה שנמחקה) — בלי okText
      //  staffOnly ("סקיצה שנמחקה — פעיל" בלבד): ללקוח לא יוצא כלום; כשל → שאול
      const sReason = a.staffOnly ? AGENT_DELETED_REASON : 'agent-staff';
      if (res.ok) {
        if (a.okText && !a.staffOnly) await enq(k, chat, a.okText, [], 'agent-cancel');
        // תיקון סופי 4: כבר עבדו עליה (שרטוט / OptyWay) → שאול לידיעה
        if (NOTIFY_CANCEL_STAGES.includes(String(res.stage || '')) && staff[0])
          await enq(k + '_s', staff[0], lgOkevCancelledStaffText(ord, String(a.who || ''), res.stage), [], sReason);
      } else if (a.silent && res.code === 'missing') { /* כבר לא קיימת — אין מה להגיד */ }
      else if (a.staffOnly) {
        await enq(k + '_s', staff[0], a.staffText + (res.code === 'too-late' ? ' (כבר בייצור)' : ' (' + String(res.code || 'error') + ')'), [], sReason);
      } else if (res.code === 'too-late') {
        await enq(k, chat, a.lateText, [], 'agent-cancel');
        // תיקון סופי 3: שאול לידיעה. השלב מהביטול; בלעדיו — "ייצור" (מאוחר מדי = אחרי OptyWay)
        if (!a.silent && staff[0])
          await enq(k + '_s', staff[0], lgOkevTooLateStaffText({ ...ord, stage: res.stage || 'workday' }, String(a.who || ''), 'cancel'), [], 'agent-staff');
      }
      else {
        // תיקון סופי 9: "העברנו לשאול" רק אם ההודעה לשאול באמת נכנסה לתור
        if (await enq(k + '_s', staff[0], a.staffText + ' (' + String(res.code || 'error') + ')', [], 'agent-staff'))
          await enq(k, chat, AGENT_HANDOFF_TEXT, [], 'agent-reply');
      }
    }
  }
  for (const [k, a] of deferred) if (staffQueued && await enq(k, chat, await _word(a.text), [], 'agent-reply') && !askKey) askKey = k;
  // conv אחרי התור ולפני השליחה. conv חדש נשמר רק אם השאלה באמת נכנסה לתור
  //  (queued:true) — עם askKey, כדי לדעת מתי נשלחה
  if (!d.conv) { if (stored) await convRef.set(null); }
  else if (d.conv !== conv && askKey) await convRef.set({ ...d.conv, askKey: lgWaInboundKey(askKey) });
  await recRef.update({ wouldAct: d.actions, acted: true, actReason: null, actMode: mode, actQueued: queued, actCancels: cancels,
                       ...(attRemovals.length ? { actAttRemovals: attRemovals } : {}), ...qUsage, ...(lessonInfo || {}),
                       ...(replyWords.length ? { replyWords } : {}), ...(wordSkipped ? { wordSkipped } : {}) });

  if (queued.length) {
    try { await (o.sendPending || lgAgentSendPending)(db, { env, provider: o.provider, deadline: o.deadline, clock: o.clock }); }
    catch (e) { console.warn('agent-act: send', e && e.name); }
  }
  // בקשת מחיר שנשלחה עכשיו — staffMessageId מיד (אחרת יתמלא כשתגיע תשובה)
  for (const n of quotes) {
    try { await lgQuoteSync(db, n); } catch (e) { console.warn('agent-act: quote-sync', e && e.name); }
  }
  return { acted: true, actions: d.actions };
}

module.exports = { CONV, CONV_TTL_MS, AGENT_CANCELS, AGENT_QUOTE_WORST_MS, DELETED_ASK_TEXT, DELETED_PROD_TEXT,
                   ATT_DELETED_ASK, ATT_DELETED_PROD, ATT_REMOVED_TEXT, ATT_KEPT_TEXT, AGENT_ATT_REMOVALS,
                   lgAgentDecide, lgAgentAct, lgAgentCancel, lgAgentAttRemove };
