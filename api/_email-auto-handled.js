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

//  הזמנת רכש מהמחשב של הלקוח (בן, 4/11): נוסח משלה, ודקה עד שהתשובה יוצאת.
//  כרטיס בחשבשבת → הספק ש-_po-pdf.js מזהה. רק כשכל ההזמנות במייל הן הזמנת
//  רכש של אותו ספק עם מספר הזמנה; אחרת "הסקיצות טופלו" הרגיל, מיד.
const LG_PO_CONFIRM_CARDS = { '450': 'avivi' };   // אביבי
const PO_CONFIRM_DELAY_MS = 60 * 1000;

const lgPoConfirm = orders => orders.length > 0 && orders.every(o => o &&
  LG_PO_CONFIRM_CARDS[String(o.customerId || '')] === o.poSupplier && !!String(o.sketchName || '').trim());

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

  const po = lgPoConfirm(live.map(x => x.order));
  const r = await lgEmailDispatch(db, { kind: KIND, dryRun: false, force: false, live, targets, queuedBy: 'email-auto', now,
                                        ...(po ? { variant: 'po', delayMs: PO_CONFIRM_DELAY_MS } : {}) });
  const b = r.body || {};
  //  later: התשובה מחכה דקה — הסקריפט מוציא לארכיון רק אחרי שהיא יצאה (doneMails), לא בקליטה
  return { marked: true, queued: r.status === 200 && !!b.queued, later: po, reason: b.error || b.reason || null };
}

module.exports = { lgEmailAutoHandle, lgPoConfirm, LG_PO_CONFIRM_CARDS, PO_CONFIRM_DELAY_MS };
