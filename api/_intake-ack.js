'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_intake-ack.js — מרכזן: "<N> סקיצות נקלטו." ללקוח (בן, 10/11).
//
//  עוזר משותף, לא route. אפיון: docs/superpowers/specs/2026-11-10-markazan-intake-ack-design.md §1
//
//  ─── וואטסאפ: הודעה אחת לסבב ───────────────────────────────────────
//  כל תמונה שנקלטה (lgWaInboundProcess) נרשמת ב-waMeta/intakeAcks/<צ'אט>:
//    { customerId, chat, orderIds:[…], orderNums:[…], count, firstAt, lastAt, dueAt }
//  כל תמונה נוספת מאותו צ'אט מאריכה: dueAt = lastAt + 2 דקות.
//  אין cron תכוף — השעון הוא סקריפט ה-Gmail, שקורא ל-/api/email-inbound
//  (op:'outbox-claim') כל דקה. שם lgIntakeAckFlush מוציא את מה שהגיע זמנו:
//  טרנזקציה שמוחקת את הרשומה (ולכן נשלח פעם אחת), הכנסה ל-waOutbox, ו-drain
//  מיידי כמו בשאר המסלולים בשרת (drainNow).
//
//  ─── מייל: מייל אחד = סבב אחד ──────────────────────────────────────
//  lgIntakeAckEmail נקרא מיד אחרי עיבוד המייל (_email-inbound.js), עם דקת
//  המתנה (notBefore) כמו התשובה לאביבי.
//
//  ─── מי לא מקבל ───────────────────────────────────────────────────
//  צ'אט / כתובת לא מקושרים; הזמנה פיקטיבית; הזמנת טקסט; הזמנת רכש של אביבי
//  (יש לה אישור משלה); מייל ש"טופלו" כבר יצא עליו לבד (_email-auto-handled.js).
//  מתג: INTAKE_ACK_ENABLED==='true' (כבוי כברירת מחדל) — כבוי → כלום לא נרשם ולא נשלח.
// ═══════════════════════════════════════════════════════════════════

const KIND = 'sketches-received';
const ACKS = 'waMeta/intakeAcks';
const INTAKE_ACK_WAIT_MS = 2 * 60 * 1000;           // אחרי התמונה האחרונה מאותו צ'אט
const INTAKE_ACK_STALE_MS = 30 * 60 * 1000;         // השעון לא רץ חצי שעה — "נקלטו" באיחור הוא רעש
const INTAKE_ACK_EMAIL_DELAY_MS = 60 * 1000;
const AGENT = 'מרכזן';

const lgIntakeAckOn = () => process.env.INTAKE_ACK_ENABLED === 'true';
const _list = v => Array.isArray(v) ? v : Object.values(v || {});
const _countText = n => n === 1 ? 'סקיצה אחת נקלטה' : n + ' סקיצות נקלטו';

//  הצ'אט שממנו הגיעה התמונה: קבוצה מקושרת או מספר פרטי מקושר. '' = לא מקושר.
function lgIntakeAckChatKey(order) {
  const o = order || {};
  if (o.waGroup) return 'g' + String(o.waGroup).replace(/[^0-9A-Za-z-]/g, '_');
  if (o.waChat) {
    const { lgWaSenderKey } = require('./_wa-recipient');
    const k = lgWaSenderKey(o.waChat);
    return k ? 'p' + k : '';
  }
  return '';
}

//  תמונה שנקלטה בוואטסאפ → נרשמת לסבב של הצ'אט. → { noted, reason }
async function lgIntakeAckNote(db, order, now) {
  const no = reason => ({ noted: false, reason });
  if (!lgIntakeAckOn()) return no('off');
  const o = order || {};
  if (!o.id || o.source !== 'whatsapp') return no('not-whatsapp');
  if (o.isTest) return no('test');
  if (o.waText) return no('text');
  const cid = String(o.customerId || '');
  const key = lgIntakeAckChatKey(o);
  if (!cid || !key) return no('unlinked');
  const { resolveRecipientWa } = require('./_wa-recipient');
  const who = await resolveRecipientWa(db, o, KIND);
  if (!who.linked || !who.phone || String(who.accountKey || '') !== cid) return no('unlinked');

  const at = Number(now) || Date.now();
  const id = String(o.id), num = String(o.orderNum || o.refNum || o.id);
  await db.ref(ACKS + '/' + key).transaction(cur => {
    const c = cur || {};
    const ids = _list(c.orderIds).map(String), nums = _list(c.orderNums).map(String);
    if (!ids.includes(id)) { ids.push(id); nums.push(num); }
    const lastAt = Math.max(Number(c.lastAt) || 0, at);
    return { customerId: cid, chat: String(who.phone), orderIds: ids, orderNums: nums, count: ids.length,
             firstAt: Number(c.firstAt) || at, lastAt, dueAt: lastAt + INTAKE_ACK_WAIT_MS };
  });
  return { noted: true, reason: '' };
}

//  הסבבים שהגיע זמנם → waOutbox, ו-drain. → { queued:[keys], dropped, skipped:[{chat, reason}] }
async function lgIntakeAckFlush(db, now, deps) {
  const d = deps || {};
  const out = { queued: [], dropped: 0, skipped: [] };
  if (!lgIntakeAckOn()) return out;
  const at = Number(now) || Date.now();
  const all = (await db.ref(ACKS).once('value')).val() || {};
  const due = Object.keys(all).filter(k => all[k] && Number(all[k].dueAt) <= at);
  if (!due.length) return out;

  const { lgWaProvider } = require('./_wa-provider');
  const { lgWaEnqueue } = require('./_wa-outbox');
  const { resolveRecipientWa } = require('./_wa-recipient');
  const { lgRoomPost } = require('./_agent-room');
  const provider = d.provider || lgWaProvider();

  for (const key of due) {
    //  ⚠️ פיירבייס קוראת קודם עם null (מטמון) — מחזירים null, והשרת מריץ שוב עם הערך.
    //  רק מי שמחק את הרשומה שולח: שני flush במקביל → הודעה אחת.
    let taken = null;
    const r = await db.ref(ACKS + '/' + key).transaction(cur => {
      taken = null;
      if (cur === null) return null;
      if (!(Number(cur.dueAt) <= at)) return;          // abort — תמונה חדשה האריכה בינתיים
      taken = cur;
      return null;
    });
    if (!r.committed || !taken) continue;
    const skip = reason => out.skipped.push({ chat: key, reason });
    if (at - (Number(taken.lastAt) || 0) > INTAKE_ACK_STALE_MS) { out.dropped++; continue; }

    const ids = _list(taken.orderIds).map(String);
    const nums = _list(taken.orderNums).map(String);
    //  N = כל התמונות של הסבב, גם כאלה שאוחדו מאז כצרופה; החותמת רק על הזמנות שעוד קיימות
    const live = [];
    for (const id of ids) {
      const o = (await db.ref('orders/' + id).once('value')).val();
      if (o && !o.isTest) live.push({ id, o });
    }
    if (!live.length) { skip('no-orders'); continue; }
    const first = live[0].o;
    const who = await resolveRecipientWa(db, first, KIND);
    if (!who.linked || !who.phone || String(who.accountKey || '') !== String(taken.customerId || '')) { skip('unlinked'); continue; }
    //  ⚠️ Meta שולחת רק את תבנית "מוכן לאיסוף" — הנוסח הזה יוצא רק ב-GREEN API (כמו "טופלו")
    if (provider.name !== 'green' || !provider.configured) { skip('provider'); continue; }
    const gate = provider.gate({ phone: who.phone, accountKey: who.accountKey, linked: true });
    if (!gate.allowed) { skip(gate.reason || 'gate'); continue; }

    const n = Math.max(nums.length, live.length);
    const orderNums = nums.length >= live.length ? nums : live.map(x => String(x.o.orderNum || x.id));
    const clientName = String(first.orderClient || 'לקוח');
    const q = await lgWaEnqueue(db, { kind: KIND, to: who.phone, clientName, orderNums, sketchNames: [],
                                      orderIds: live.map(x => x.id), queuedBy: 'markazan',
                                      phoneSource: who.source, accountKey: who.accountKey });
    if (!q.queued) { skip(q.reason); continue; }
    out.queued.push(q.key);
    await lgRoomPost(db, { agent: AGENT, kind: 'info', text: 'נשלח ל' + clientName + ': ' + _countText(n), ref: live[0].id }, at);
  }

  if (out.queued.length) {
    try {
      const drain = d.drain || require('./_wa-drain-core').drainNow;
      await drain(db, out.queued, 'markazan');
    } catch (e) { console.error('intake-ack: drain failed', e && e.name); }   // נשאר בתור ל-drain הבא
  }
  return out;
}

//  מייל שנקלט → תשובה אחת בשרשור. → { queued, reason }
//  opts.ackedByAuto — "טופלו" / אישור אביבי כבר נכנס לתור לבד על המייל הזה.
async function lgIntakeAckEmail(db, orderIds, now, opts) {
  const no = reason => ({ queued: false, reason });
  if (!lgIntakeAckOn()) return no('off');
  if (opts && opts.ackedByAuto) return no('auto-handled');
  const { resolveRecipient } = require('./_wa-recipient');
  const live = [], targets = [];
  for (const id of orderIds || []) {
    const o = (await db.ref('orders/' + id).once('value')).val();
    if (!o) continue;
    if (o.poSupplier) return no('po');                  // לאביבי יש אישור משלה
    if (o.isTest || o.source !== 'email') continue;
    const who = await resolveRecipient(db, o, KIND);
    if (who.channel !== 'email') continue;
    live.push({ id: String(id), order: o });
    targets.push({ id: String(id), ...who });
  }
  if (!live.length) return no('unlinked');
  const at = Number(now) || Date.now();
  const { lgEmailDispatch } = require('./_email-dispatch');
  const r = await lgEmailDispatch(db, { kind: KIND, dryRun: false, force: false, live, targets, queuedBy: 'markazan',
                                        delayMs: INTAKE_ACK_EMAIL_DELAY_MS, now: at });
  const b = r.body || {};
  const queued = r.status === 200 && !!b.queued;
  if (queued) {
    const { lgRoomPost } = require('./_agent-room');
    const name = String(live[0].order.orderClient || 'לקוח');
    await lgRoomPost(db, { agent: AGENT, kind: 'info', text: 'נשלח ל' + name + ': ' + _countText(live.length), ref: live[0].id }, at);
  }
  return { queued, reason: queued ? '' : (b.error || b.reason || '') };
}

module.exports = { lgIntakeAckOn, lgIntakeAckChatKey, lgIntakeAckNote, lgIntakeAckFlush, lgIntakeAckEmail,
                   INTAKE_ACK_KIND: KIND, INTAKE_ACK_WAIT_MS, INTAKE_ACK_STALE_MS, INTAKE_ACK_EMAIL_DELAY_MS };
