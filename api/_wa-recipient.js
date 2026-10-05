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

// ─── הכיוון ההפוך: מי שלח את ההודעה ─────────────────────────────────
//
//  אפיון WhatsApp-inbound §2.6. resolvePhone עונה "לאיזה מספר שולחים
//  להזמנה הזו"; כאן השאלה היא "של איזה לקוח המספר ששלח לנו".
//
//  ⚠️ לא מנחשים. התאמה רק אם היא חד-משמעית: טלפון התחברות מדויק, או
//  כרטיס חשבשבת **יחיד** עם אותן ספרות. מספר משותף לשני כרטיסים (שותפים,
//  משרד ומחסן) נשאר "לא מזוהה" ומשויך ביד — סקיצה שנחתה אצל הלקוח הלא
//  נכון מופיעה בפורטל שלו, וזה גרוע יותר מסקיצה בלי שיוך.

const digits = p => String(p || '').replace(/\D/g, '');

//  972501234567@c.us → 0501234567. קבוצה / lid / כל דבר אחר → ''.
function waChatToLocal(chatId) {
  const m = /^(\d+)@c\.us$/.exec(String(chatId || ''));
  if (!m) return '';
  return m[1].startsWith('972') ? '0' + m[1].slice(3) : m[1];
}

//  מחזיר { matched, via, phone, loginPhone, customerId, name }.
//  phone = מספר השולח, בפורמט מקומי. loginPhone = מפתח users כשנמצא שם.
async function lgClientFromWaSender(db, chatId) {
  const phone = waChatToLocal(chatId);
  const none = { matched: false, via: 'none', phone, loginPhone: '', customerId: '', name: '' };
  if (!phone) return none;

  const u = (await db.ref('users/' + phone).once('value')).val();
  if (u) {
    return { matched: true, via: 'users', phone, loginPhone: phone,
             customerId: String(u.customerId || ''),
             // אותו כלל כמו lgClientDisplayName בדפדפן
             name: String((u.businessName || '').trim() || u.name || '') };
  }

  const all = (await db.ref('hashavshevetAccounts').once('value')).val() || {};
  const want = digits(phone);
  const hits = Object.entries(all).filter(([, a]) => a && digits(a.phone) === want);
  if (hits.length !== 1) return none;
  const [key, acc] = hits[0];
  return { matched: true, via: 'hashavshevet', phone, loginPhone: '',
           customerId: String(acc.key || key), name: String(acc.name || '') };
}

module.exports = { resolvePhone, toWaNumber, norm, orderSketchName, waChatToLocal, lgClientFromWaSender };
