// ═══════════════════════════════════════════════════════════════════
//  api/_wa-recipient.js — לאיזה מספר ההודעה יוצאת.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  ─── למה בקובץ נפרד ────────────────────────────────────────────────
//
//  ⚠️ היה בתוך whatsapp-send.js, ועם whatsapp-dispatch.js שנוסף לידו זה
//  היה הופך לעותק שני. הטעות החוזרת של הפרויקט הזה היא **מקורות אמת
//  מקבילים**: DATABASE_URL בארבעה קבצים, שני מסלולי חשבונית, itemsSel מול
//  draftItems. כל אחד מהם נראה תמים ביום שנוצר.
//
//  ─── ההיגיון ───────────────────────────────────────────────────────
//
//  מקור האמת הוא הטלפון בכרטיס הלקוח בחשבשבת. שם הוא מתוחזק, ומשם הוא
//  מסונכרן ל-hashavshevetAccounts.
//
//  order.phone הוא מה שהועתק להזמנה ביום שהיא נפתחה. הוא אינו מתעדכן
//  כשהלקוח מחליף מספר, ובהגשה מהפורטל הוא יכול להיות של מי שהעלה את
//  הסקיצה ולא של החשבון שמחויב. הודעה שיצאה אי אפשר להחזיר, ולכן היא
//  צריכה לצאת למספר שבכרטיס.
//
//  ⚠️ בפרודקשן **החוליה האמצעית** היא שעובדת בפועל: להזמנה בדרך כלל אין
//  customerId, והכרטיס נמצא דרך טלפון ההתחברות. ר' scripts/test-client-phone.js.
//
//  אותה שרשרת בדיוק כמו lgResolveClientPhone בדפדפן (firebase-db.js).
//  מחזיר גם את המקור, כדי שהמסך יוכל להראות לפי מה נבחר המספר במקום
//  להסתיר את ההחלטה.
// ═══════════════════════════════════════════════════════════════════

const norm = p => String(p || '').replace(/[-\s]/g, '');

// ── מספר בפורמט שה-API דורש: בין-לאומי, בלי + ובלי 0 מוביל ──
//    052-2578559 → 972522578559
//  ⚠️ ב-GREEN API שליחה עם המספר המקומי נדחית ב-
//  "Validation failed. Details: 'chatId'".
function toWaNumber(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!p) return '';
  if (p.startsWith('972')) return p;
  return '972' + p.replace(/^0/, '');
}

//  מחזיר { phone, source, accountKey }. phone בפורמט **מקומי** — ההמרה
//  לבין-לאומי קורית רק ברגע השליחה.
async function resolvePhone(db, order) {
  let key = order.customerId || null;
  if (!key) {
    const login = norm(order.clientPhone || order.phone);
    if (login) {
      const snap = await db.ref('users/' + login).once('value');
      const u = snap.val();
      key = (u && u.customerId) || null;
    }
  }
  if (key) {
    const snap = await db.ref('hashavshevetAccounts/' + String(key).trim()).once('value');
    const acc  = snap.val();
    if (acc && acc.phone) return { phone: norm(acc.phone), source: 'hashavshevet', accountKey: String(key) };
  }
  const own = norm(order.phone);
  return { phone: own, source: own ? 'order' : 'none', accountKey: null };
}

//  ─── שם הסקיצה ──────────────────────────────────────────────────────
//
//  ⚠️ זה המזהה ש**הלקוח** מכיר. מספר ההזמנה הוא שלנו; השם הזה הוא מה
//  שהוא הקליד בתור הסקיצות, ומה שהפורטל מציג לו (portal.html:542).
//
//  שרשרת ה-fallback אינה המצאה — היא זו שכבר קיימת ב-lgNormalizeOrder
//  (firebase-db.js:728) ומופיעה בתור הסקיצות, בכרטיס ההזמנה ובתחנת
//  הבדיקה. מוגדרת כאן פעם אחת כדי שלא ייווצר עותק נוסף בצד השרת.
//
//  ריק הוא תשובה לגיטימית: יש הזמנות בלי שם, וההודעה נשלחת בלעדיו.
function orderSketchName(order) {
  const o = order || {};
  return String(o.sketchName || o.type || o.desc || '').trim();
}

module.exports = { resolvePhone, toWaNumber, norm, orderSketchName };
