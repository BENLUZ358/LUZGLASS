// ═══════════════════════════════════════════════════════════════════
//  api/_email-dispatch.js — הודעה אחת ללקוח במייל, על קבוצת הזמנות.
//
//  עוזר משותף, לא route. עבר לכאן מ-whatsapp-dispatch.js (2/11) כדי
//  שגם הקליטה (טופל אוטומטי, _email-auto-handled.js) תשלח בדיוק באותה דרך.
// ═══════════════════════════════════════════════════════════════════

const { lgEmailSendGate } = require('./_env');
const { lgEmailEnqueue, lgEmailActiveIds } = require('./_email-outbox');
const { orderSketchName } = require('./_wa-recipient');

//  כל ההזמנות מהמייל. כרטיס אחד בלבד (אחרת 409 — אותו היגיון כמו "מספרים
//  שונים"), ואז הודעה אחת לכל שרשרת. נעילת הסביבה נבדקת לכל כתובת.
//  ⚠️ לא נוגע ב-waOutbox ולא בספק הוואטסאפ: התור הוא waMeta/emailOutbox,
//  והסקריפט בג'ימייל שולח משם (api/_email-outbox.js).
async function lgEmailDispatch(db, { kind, dryRun, force, live, targets, queuedBy }) {
  const cards = [...new Set(targets.map(t => String(t.accountKey || '')))];
  if (cards.length !== 1 || !cards[0]) {
    return { status: 409, body: {
      error: 'ההזמנות בקבוצה שייכות לכרטיסי לקוח שונים — לא נשלחה הודעה',
      detail: targets.map(t => ({ orderId: t.id, accountKey: t.accountKey })),
    } };
  }
  const byId = new Map(live.map(x => [x.id, x.order]));
  //  ⚠️ הזמנה שכבר בהודעת מייל מאותו סוג שבדרך / שנשלחה זה עתה לא נכללת שוב —
  //  [X] ואז [X,Y] הם מפתחות שונים. ב"הסקיצות טופלו" זה כבר נעשה למעלה
  //  (lgSketchAckActiveIds). ר' lgEmailActiveIds.
  const active  = (kind !== 'sketches-handled' && !force) ? await lgEmailActiveIds(db, kind) : new Set();
  const skipped = [];
  const threads = new Map();
  for (const t of targets) {
    if (!threads.has(t.thread)) threads.set(t.thread, []);
    threads.get(t.thread).push(t);
  }
  const messages = [];
  for (const [thread, all] of threads) {
    const ts = all.filter(t => !active.has(String(t.id)));
    all.filter(t => active.has(String(t.id))).forEach(t => skipped.push({ orderId: t.id, reason: 'כבר בהודעה שבדרך במייל' }));
    if (!ts.length) {
      messages.push({ thread, orderNums: [], queued: false, reason: 'כבר בהודעה שבדרך במייל' });
      continue;
    }
    const orders      = ts.map(t => byId.get(t.id));
    const orderNums   = ts.map((t, i) => String(orders[i].orderNum || orders[i].refNum || t.id));
    const sketchNames = orders.map(orderSketchName);
    const clientName  = String(orders[0].orderClient || 'לקוח');
    const emails      = [...new Set(ts.map(t => t.email))];
    //  המייל שעליו עונים: האחרון שהלקוח שלח בשרשרת (מבין ההזמנות בהודעה).
    //  הסקריפט בודק שוב שהוא מהכתובת המקושרת לפני שהוא עונה.
    const newest = orders.reduce((a, o) => (Number(o.emailReceivedAt) || 0) >= (Number(a.emailReceivedAt) || 0) ? o : a, orders[0]);
    const messageId = String(newest.emailMessageId || '');
    const msg = { thread, orderNums, queued: false, reason: null };
    const gate = emails.length === 1 ? lgEmailSendGate(emails[0])
               : { allowed: false, reason: 'בשרשרת אחת יש כמה כתובות — לא נשלח' };
    if (!gate.allowed) { msg.reason = gate.reason; msg.blocked = true; }
    else if (dryRun)   { msg.reason = 'dryRun'; }
    else {
      const q = await lgEmailEnqueue(db, { kind, thread, messageId, email: emails[0], clientName, orderNums, sketchNames,
                                           orderIds: ts.map(t => t.id), queuedBy, accountKey: cards[0] });
      msg.queued = q.queued; msg.reason = q.queued ? null : q.reason; msg.outboxKey = q.key;
    }
    messages.push(msg);
  }
  const queued  = messages.some(m => m.queued);
  const blocked = !queued && messages.every(m => m.blocked);
  const first   = messages.find(m => m.reason);
  //  preview/configured/reason — כמו בוואטסאפ, כי workday.html ו-admin.html
  //  קוראים אותם: preview + configured → טוסט עם הסיבה; queued → הצלחה.
  return { status: 200, body: {
    ok: true, queued, channel: 'email', kind,
    preview: dryRun || blocked || undefined, blocked: blocked || undefined, configured: true,
    clientName: String((byId.get(targets[0].id) || {}).orderClient || 'לקוח'),
    orderNums: messages.flatMap(m => m.orderNums), accountKey: cards[0],
    reason: queued ? null : (first ? first.reason : null),
    messages,
  }, skipped };
}

module.exports = { lgEmailDispatch };
