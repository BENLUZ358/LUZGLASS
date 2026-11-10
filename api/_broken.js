//  שבר בחיסום (בן, 10/11) — הנוסח והשליחה ללקוח.
//  פריט שלא חזר מהחיסום אצל לקוח הובלות נרשם ב-orders/<id>/brokenChisum/<idx>
//  (workday.html, lgBrokenPlan). ההזמנה יוצאת לחשבונית על כולה; עם החשבונית
//  נאמר ללקוח מה נשבר, וכשהפריט חוזר — הודעה נפרדת, לאותו מקום שאליו יוצאות
//  החשבוניות, בלי חשבונית נוספת. ר' docs/superpowers/specs/2026-11-10-broken-chisum-invoice-design.md
'use strict';

//  אותן מידות כמו בכל המסכים: רוחב×גובה, מבודדות משמאל לימין (lgDimsText)
const _dims = it => '⁦' + ((it && it.w) || '?') + '×' + ((it && it.h) || '?') + '⁩';

function _entries(o) {
  const b = (o && o.brokenChisum) || {};
  return Object.keys(b).filter(k => b[k]).map(k => ({ idx: Number(k), v: b[k] }))
    .filter(e => Number.isInteger(e.idx) && e.idx >= 0).sort((a, c) => a.idx - c.idx);
}
const _label = o => String((o && o.orderNum) || (o && o.id) || '') +
                    (o && o.sketchName ? ' (' + String(o.sketchName).trim() + ')' : '');

//  שורה לכל פריט שעוד לא חזר, על פני כל ההזמנות שבחשבונית
function brokenInvoiceLines(orders) {
  const out = [];
  (orders || []).forEach(o => _entries(o).filter(e => !e.v.returnedAt).forEach(e => {
    const it = (o.items || [])[e.idx] || {};
    out.push('בהזמנה ' + _label(o) + ' הפריט ' + _dims(it) + ' מ"מ נשבר בחיסום ונמצא בייצור מחדש.');
  }));
  return out;
}

function brokenReturnedLines(order, idx) {
  const it = ((order && order.items) || [])[idx] || {};
  return ['הפריט ' + _dims(it) + ' מ"מ מהזמנה ' + _label(order) + ' חזר מהחיסום ויגיע אליכם בהובלה הקרובה.'];
}

//  "חזר" מהלוח בחיסום → הודעה ללקוח. אותה הכרעת ערוץ כמו lgInvoiceDeliver.
//  המפתח בתור כולל את מספר הפריט: לחיצה כפולה = הודעה אחת, פריט אחר = הודעה משלו.
async function lgBrokenReturnedNotify(db, orderId, idx, deps) {
  const d = deps || {};
  const order = (await db.ref('orders/' + orderId).once('value')).val();
  if (!order) return { state: 'blocked', reason: 'ההזמנה לא נמצאה' };
  const e = _entries(order).find(x => x.idx === Number(idx));
  if (!e) return { state: 'blocked', reason: 'הפריט לא רשום כשבור' };
  if (order.isTest) return { state: 'skipped', reason: 'הזמנה פיקטיבית' };
  if (order.source !== 'whatsapp' && order.source !== 'email') return { state: 'portal' };

  const docNumber = (order.invoiceDone && order.invoiceDone.docNumber) || null;
  const R = d.recipient || require('./_wa-recipient');
  const who = order.source === 'whatsapp' ? await R.resolveRecipientWa(db, order, 'broken-returned')
                                          : await R.resolveRecipient(db, order, 'broken-returned');
  const common = { kind: 'broken-returned', keySuffix: String(e.idx), clientName: order.orderClient || '',
                   orderNums: [String(order.orderNum || order.id)], sketchNames: [String(order.sketchName || '')],
                   orderIds: [String(orderId)], queuedBy: 'broken-returned', accountKey: who.accountKey,
                   docNumber, extraLines: brokenReturnedLines(order, e.idx) };

  if (who.channel === 'email') {
    const { lgEmailEnqueue } = require('./_email-outbox');
    const { lgInvoiceEmailFor } = require('./_invoice-deliver');
    const sendTo = await lgInvoiceEmailFor(db, who.accountKey);
    const q = await lgEmailEnqueue(db, { ...common, thread: who.thread, messageId: order.emailMessageId,
                                         email: who.email, sendTo, now: d.now });
    return { state: q.queued ? 'queued' : 'already', channel: 'email', reason: q.reason, key: q.key };
  }
  if (!who.phone) return { state: 'blocked', channel: 'whatsapp', reason: 'אין נמען בוואטסאפ' };
  const { lgWaEnqueue } = require('./_wa-outbox');
  const q = await lgWaEnqueue(db, { ...common, to: who.phone, phoneSource: who.source });
  if (!q.queued) return { state: 'already', channel: 'whatsapp', reason: q.reason, key: q.key };
  const drain = d.drain || require('./_wa-drain-core').drainNow;
  const r = await drain(db, [q.key], 'broken-returned');
  const res = (r && r.results || []).find(x => x.key === q.key);
  return { state: res && res.status === 'sent' ? 'sent' : 'queued', channel: 'whatsapp', key: q.key };
}

module.exports = { brokenInvoiceLines, brokenReturnedLines, lgBrokenReturnedNotify };
