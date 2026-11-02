// ═══════════════════════════════════════════════════════════════════
//  api/_email-auto-handled.js — מייל מכתובת מקושרת: "טופל" לבד (בן, 2/11).
//
//  עוזר משותף, לא route. נקרא מהקליטה (_email-inbound.js) מיד אחרי שההזמנות
//  נוצרו. עושה בדיוק מה שהכפתור "✓ סקיצה טופלה" בתור עושה:
//    1. sketchSeenAt על כל ההזמנות (ההזמנה עוברת ל"נראה" בתור).
//    2. "הסקיצות טופלו" ללקוח — אותה שליחה, אותן הגנות (lgEmailDispatch).
//
//  ⚠️ רק לכתובת שבן קישר מהקליטות (via:'link'). כתובת שמזוהה רק לפי המייל
//  בכרטיס — כמו קודם, נשארת לבן.
//  ⚠️ כישלון כאן לא מפיל את הקליטה: ההזמנות כבר בתור, ושורת "ממתינים לעדכון"
//  בתור מציעה לשלוח את מה שלא יצא.
// ═══════════════════════════════════════════════════════════════════

const KIND = 'sketches-handled';

//  { marked, queued, reason? }
async function lgEmailAutoHandle(db, orderIds, now) {
  const { lgSketchAckSkip, lgSketchAckActiveIds } = require('./_wa-sketch-ack');
  const { resolveRecipient } = require('./_wa-recipient');
  const { lgEmailDispatch } = require('./_email-dispatch');

  const upd = {};
  orderIds.forEach(id => { upd['orders/' + id + '/sketchSeenAt'] = now; upd['orders/' + id + '/sketchSeenBy'] = 'email-auto'; });
  await db.ref().update(upd);

  const active = await lgSketchAckActiveIds(db);
  const live = [], targets = [];
  for (const id of orderIds) {
    const order = (await db.ref('orders/' + id).once('value')).val();
    if (!order || lgSketchAckSkip(order, id, active)) continue;
    const who = await resolveRecipient(db, order, KIND);
    if (who.channel !== 'email') continue;
    live.push({ id, order });
    targets.push({ id, ...who });
  }
  if (!live.length) return { marked: true, queued: false, reason: 'אין הזמנות לשליחה' };

  const r = await lgEmailDispatch(db, { kind: KIND, dryRun: false, force: false, live, targets, queuedBy: 'email-auto' });
  const b = r.body || {};
  return { marked: true, queued: r.status === 200 && !!b.queued, reason: b.error || b.reason || null };
}

module.exports = { lgEmailAutoHandle };
