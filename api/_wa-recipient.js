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
// ─── מספר פרטי מקושר (בן, 26/10) ─────────────────────────────────────
//
//  כמו קבוצה: מנהל קושר מספר לכרטיס מתוך הקליטות (waSenders, נכתב רק מ-
//  endpoint אדמיני), והקישור הוא ההרשאה שלו — בלי לערוך רשימה ב-Vercel.
//  המפתח הוא ספרות הטלפון בצורה המקומית: 97237436564@c.us, 03-7436564 → 037436564.
function lgWaSenderKey(raw) {
  const s = String(raw || '');
  let d = digits(s.includes('@') ? waChatToLocal(s) : s);
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

async function lgWaSenderLink(db, phone) {
  const key = lgWaSenderKey(phone);
  if (!key) return null;
  const link = (await db.ref('waSenders/' + key).once('value')).val();
  if (!link || !link.customerId) return null;
  return { customerId: String(link.customerId), customerName: String(link.customerName || ''), phone: key };
}

async function lgClientFromWaSender(db, chatId) {
  const phone = waChatToLocal(chatId);
  const none = { matched: false, via: 'none', phone, loginPhone: '', customerId: '', name: '' };
  if (!phone) return none;

  // קישור מפורש גובר: מנהל בחר אותו בעיניים, והוא חזק מהתאמת טלפון
  const link = await lgWaSenderLink(db, phone);
  if (link) {
    const users = (await db.ref('users').once('value')).val() || {};
    const login = Object.keys(users).find(k => users[k] && users[k].role === 'client' && String(users[k].customerId || '') === link.customerId) || '';
    const card = link.customerName ? null : (await db.ref('hashavshevetAccounts/' + link.customerId).once('value')).val();
    return { matched: true, via: 'link', phone, loginPhone: login, customerId: link.customerId,
             name: link.customerName || String((card && card.name) || '') };
  }

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
  // שני כרטיסים ומעלה — לא מנחשים, אבל אומרים למה (הפאנל מציג את זה)
  if (hits.length > 1) return { ...none, via: 'ambiguous', candidates: hits.length };
  if (hits.length !== 1) return none;
  const [key, acc] = hits[0];
  return { matched: true, via: 'hashavshevet', phone, loginPhone: '',
           customerId: String(acc.key || key), name: String(acc.name || '') };
}

// ─── קבוצות WhatsApp (בן, 06/10) ─────────────────────────────────────
//
//  לקוח ששולח מקבוצה עם כמה מספרים: הקבוצה מקושרת ללקוח אחד ב-waGroups
//  (רק דרך endpoint אדמיני), וכל תמונה בה נרשמת עליו — לא משנה מי כתב.
//  אותו ניקוי מפתח כמו lgWaInboundKey (לא מיובא משם — _wa-inbound תלוי בנו).
const _groupKey = id => String(id || '').replace(/[.#$[\]/]/g, '_');

async function lgClientFromWaGroup(db, groupId, memberPhone) {
  const link = (await db.ref('waGroups/' + _groupKey(groupId)).once('value')).val();
  if (!link || !link.customerId) {
    return { matched: false, via: 'group-unlinked', phone: memberPhone || '', loginPhone: '', customerId: '', name: '' };
  }
  const customerId = String(link.customerId);
  // משתמש הפורטל של הלקוח — כדי שהסקיצה תופיע אצלו (D2)
  const users = (await db.ref('users').once('value')).val() || {};
  const login = Object.keys(users).find(k => users[k] && String(users[k].customerId || '') === customerId) || '';
  const card  = (await db.ref('hashavshevetAccounts/' + customerId).once('value')).val() || {};
  return {
    matched: true, via: 'group',
    phone: login || norm(card.phone) || memberPhone || '',
    loginPhone: login, customerId,
    name: String(link.customerName || card.name || (users[login] && (users[login].businessName || users[login].name)) || ''),
  };
}

//  לאן יוצאת הודעה להזמנה. הזמנה שהגיעה מקבוצה מקושרת → **כל** ההודעות
//  לקבוצה עצמה: "הסקיצות טופלו" (בן, 06/10), וגם "מוכן לאיסוף" ו"ההובלה
//  יצאה" (בן, 18/10: "אני מעדיף שייצא בקבוצה שממנו נשלחה"). הזמנה פרטית
//  או מהפורטל → resolvePhone, בדיוק כמו קודם. קבוצה שנותקה מאז → אין נמען.
//  ⚠️ accountKey מגיע מהקישור, ולכן השער (רשימת הלקוחות המורשים) חל גם כאן.
//  ⚠️ הודעה אחת על הזמנה מקבוצה + הזמנה מהפורטל של אותו לקוח מובילה לשני
//  נמענים, ו-whatsapp-dispatch מסרב (409). כרגע עובדים רק מוואטסאפ; ההחלטה
//  (לפצל או הכול לקבוצה) נדחתה עד שהפורטל יחזור לשימוש.
//  linked:true = הנמען הוא צ'אט שמנהל קישר (קבוצה או מספר פרטי) — השער מקבל
//  אותו גם כשהכרטיס לא ברשימה ב-Vercel (בן, 26/10). כל השאר: linked:false.
//  מספר פרטי שנותק או קושר לכרטיס אחר מאז → חוזרים ל-resolvePhone, כמו קודם.
async function resolveRecipient(db, order, kind) {
  const g = order && order.waGroup;
  if (!g) {
    if (order && order.waChat) {
      const sl = await lgWaSenderLink(db, order.waChat);
      if (sl && sl.customerId === String(order.customerId || ''))
        return { phone: sl.phone, source: 'wa-sender', accountKey: sl.customerId, linked: true };
    }
    return { ...(await resolvePhone(db, order)), linked: false };
  }
  const link = (await db.ref('waGroups/' + _groupKey(g)).once('value')).val();
  if (!link || !link.customerId) return { phone: '', source: 'group-unlinked', accountKey: null, linked: false };
  return { phone: String(g), source: 'group', accountKey: String(link.customerId), linked: true };
}

module.exports = { resolvePhone, resolveRecipient, toWaNumber, norm, orderSketchName, waChatToLocal,
                   lgClientFromWaSender, lgClientFromWaGroup, lgWaSenderKey, lgWaSenderLink };
