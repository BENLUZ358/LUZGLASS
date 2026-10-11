// ═══════════════════════════════════════════════════════════════════
//  api/_wa-sketch-ack.js — מה מותר לכלול בהודעת "הסקיצות טופלו".
//
//  עוזר משותף, לא route. נקרא מ-whatsapp-dispatch כש-kind='sketches-handled'.
//  אפיון §16 (החלטות בן 2026-10-06).
//
//  ⚠️ המפתח של תור ההודעות נגזר מ-kind + מזהי ההזמנות, ולכן הוא מונע רק
//  הודעה **זהה**. אבל "טופלו 4" ואחר כך "טופלו 6" (אותם 4 ועוד 2) הם שני
//  מפתחות — והלקוח היה מקבל על ה-4 פעמיים. לכן כל הזמנה נבדקת לבד: אם
//  היא כבר בהודעה פעילה / שנשלחה מאותו סוג, היא לא נכללת שוב.
// ═══════════════════════════════════════════════════════════════════

const KIND = 'sketches-handled';

//  מחזיר סיבה לדילוג, או null אם ההזמנה נכללת.
function lgSketchAckSkip(order, id, activeIds) {
  const o = order || {};
  if (o.source !== 'whatsapp') return 'לא סקיצת WhatsApp';           // D3
  if (!o.sketchSeenAt)         return 'עוד לא סומנה כטופלה';
  if (o.isTest)                return 'הזמנה פיקטיבית';
  if (o.sketchAck && o.sketchAck.sentAt) return 'הלקוח כבר עודכן';
  if (activeIds && activeIds.has(String(id))) return 'כבר בהודעה שבדרך';
  return null;
}

//  הזמנות שכבר בהודעת sketches-handled שממתינה, בניסיון חוזר, או נשלחה.
//  expired / dead לא נחשבים — הלקוח לא קיבל אותם, ומותר לשלוח שוב.
async function lgSketchAckActiveIds(db) {
  const by = s => db.ref('waOutbox').orderByChild('state').equalTo(s).once('value');
  const snaps = await Promise.all(['pending', 'failed', 'sent'].map(by));
  const ids = new Set();
  snaps.forEach(sn => sn.forEach(ch => {
    const v = ch.val() || {};
    if (v.kind !== KIND) return;
    (Array.isArray(v.orderIds) ? v.orderIds : Object.values(v.orderIds || {})).forEach(x => ids.add(String(x)));
  }));
  return ids;
}

module.exports = { lgSketchAckSkip, lgSketchAckActiveIds, KIND };
