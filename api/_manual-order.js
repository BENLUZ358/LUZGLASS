'use strict';
//  הזמנה ידנית עם טלפון לעדכונים: הרשומה המהימנה נשמרת בצד השרת
//  waMeta/manualOrders/<orderId> = { phone, original:'send'|'paper', customerId, privateName, at, by }
//  (הדפדפן לא כותב אותה ישירות — רק פעולת האדמין manual-order-set).

const LG_MANUAL_KINDS = ['ready', 'invoice'];

//  טלפון נייד ישראלי → 05XXXXXXXX, או '' אם לא תקין
function lgManualPhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : '';
}

const _idOk = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[.#$[\]/]/.test(id);

async function lgManualOrderRec(db, orderId) {
  if (!_idOk(orderId)) return null;
  const r = (await db.ref('waMeta/manualOrders/' + orderId).once('value')).val();
  if (!r || typeof r !== 'object') return null;
  const phone = lgManualPhone(r.phone);
  if (!phone) return null;
  return { phone, original: r.original === 'paper' ? 'paper' : 'send',
           customerId: String(r.customerId || ''), privateName: String(r.privateName || '') };
}

//  מה עושים עם מקור החשבונית של הזמנה ידנית (orders: אובייקטים עם id).
//  null — אין הזמנה ידנית. 'paper' — מקור על נייר (גם כשאין רשומה / יש הזמנה אחת כזו).
//  'send' — כל ההזמנות הידניות נשלחות לנייד שבן רשם.
async function lgManualInvoiceMode(db, orders) {
  const man = (orders || []).filter(o => o && o.source === 'manual');
  if (!man.length) return null;
  for (const o of man) {
    const r = await lgManualOrderRec(db, o.id);
    if (!r || r.original === 'paper') return 'paper';
  }
  return 'send';
}

module.exports = { lgManualPhone, lgManualOrderRec, lgManualInvoiceMode, LG_MANUAL_KINDS };
