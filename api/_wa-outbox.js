// ═══════════════════════════════════════════════════════════════════
//  api/_wa-outbox.js — תור ההודעות היוצאות.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  ─── למה תור ולא שליחה בתוך הבקשה ──────────────────────────────────
//
//  בפעולה אחת ("כל ההזמנות חזרו מהחיסום") 30-40 לקוחות שונים יכולים
//  להפוך למוכנים לאיסוף כמעט בו-זמנית. GREEN API מריצה מספר WhatsApp
//  אמיתי, והקצב הבטוח שם הוא 10 שניות בין נמענים — כלומר מעל 6 דקות.
//
//  אין request HTTP שצריך להישאר פתוח 6 דקות, וגם אין כזה שיכול: תקרת
//  הפונקציה היא 10-15 שניות בברירת מחדל ו-60 שניות לכל היותר ב-Hobby.
//
//  ולכן: **הפעולה העסקית נסגרת מיד**, ההודעות נכנסות לכאן, ו-drain מוציא
//  אותן בהדרגה. אם GREEN API איטית או נופלת — התור ממתין. שום הודעה לא
//  יושבת בזיכרון של בקשה שעומדת למות.
//
//  ─── המפתח ─────────────────────────────────────────────────────────
//
//  נגזר מ-kind + מזהי ההזמנות הממוינים. דטרמיניסטי, ולכן לחיצה כפולה
//  מייצרת **אותו מפתח** ולא רשומה שנייה.
//
//  ⚠️ מיון חיוני: ['b','a'] ו-['a','b'] הם אותה הודעה, ובלי מיון היו
//  מקבלים שני מפתחות ושתי הודעות לאותו לקוח.
//
//  ─── התפיסה ────────────────────────────────────────────────────────
//
//  טרנזקציה, ומאותו לקח כמו meta/chisumCounter: שני טאבים או drain שרץ
//  פעמיים יכלו לשלוח את אותה הודעה פעמיים.
//
//    sent              → נדחה לנצח. הלקוח קיבל.
//    claimedAt טרי     → נדחה. שליחה באוויר.
//    כשל               → claimedAt מתנקה, ולכן retry תופס מחדש.
//
//  ⚠️ וזו הנקודה שעונה על "retry ישלח רק את מה שנכשל": ההצלחות נעולות
//  לנצח והכישלונות פנויים. אין "לשלוח את ה-batch מחדש".
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const OUTBOX = 'waOutbox';

// כמה זמן תפיסה נחשבת טרייה. ארוך מהשליחה הארוכה שאפשר לדמיין, קצר
// מכדי לתקוע הודעה אם הפונקציה מתה באמצע.
const CLAIM_TTL_MS = 2 * 60 * 1000;

// אחרי שלושה כישלונות מפסיקים לנסות מעצמנו. הודעה שנכשלת שוב ושוב היא
// תקלה שצריך לראות, לא משהו שמתקן את עצמו בלופ.
const MAX_ATTEMPTS = 3;

// ⚠️ הודעה בת יממה לא יוצאת. "ההזמנה מוכנה לאיסוף" שמגיעה ליום אחרי
// שהלקוח כבר אסף היא יותר גרועה משום הודעה.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

//  מזהה ההודעה. kind נכנס לגיבוב כי אותן הזמנות בדיוק יכולות לייצר גם
//  "מוכן לאיסוף" וגם "ההובלה יצאה", והן שתי הודעות שונות.
function lgWaMsgKey(kind, orderIds) {
  const ids = [...new Set((orderIds || []).map(String))].sort();
  return crypto.createHash('sha1').update(String(kind) + '|' + ids.join(',')).digest('hex').slice(0, 20);
}

//  מכניס לתור. מחזיר { key, queued, reason }.
//  ⚠️ לא דורס רשומה שנשלחה ולא כזו שממתינה — אחרת לחיצה כפולה הייתה
//  מאפסת את ה-attempts ומחזירה לתור הודעה שכבר יצאה.
//  ⚠️ phoneSource ו-accountKey הם תיעוד, לא לוגיקה. הם אינם משפיעים על
//  מי מקבל את ההודעה — resolvePhone כבר הכריע — אלא עונים על השאלה
//  **דרך מה** נמצא המספר. בחקירת L9005 בדיוק המידע הזה היה חסר.
async function lgWaEnqueue(db, { kind, to, clientName, orderNums, orderIds, queuedBy,
                                 phoneSource, accountKey }) {
  const key = lgWaMsgKey(kind, orderIds);
  const now = Date.now();

  const r = await db.ref(OUTBOX + '/' + key).transaction(cur => {
    if (cur && cur.state === 'sent')    return;   // abort — כבר נשלחה
    if (cur && cur.state === 'pending') return;   // abort — כבר בתור
    return {
      kind:      String(kind),
      to:        String(to),
      clientName: String(clientName || ''),
      phoneSource: String(phoneSource || ''),
      accountKey:  accountKey == null ? '' : String(accountKey),
      orderNums: (orderNums || []).map(String),
      orderIds:  [...new Set((orderIds || []).map(String))].sort(),
      state:     'pending',
      attempts:  (cur && cur.attempts) || 0,
      createdAt: (cur && cur.createdAt) || now,
      updatedAt: now,
      queuedBy:  String(queuedBy || ''),
      claimedAt: null, claimedBy: null, sentAt: null,
      messageId: null, lastError: null, httpStatus: null,
    };
  });

  if (r.committed) return { key, queued: true, reason: '' };
  const cur = r.snapshot.val() || {};
  return { key, queued: false, reason: cur.state === 'sent' ? 'כבר נשלחה' : 'כבר בתור' };
}

//  תופס רשומה לשליחה. מחזיר { claimed, entry, reason }.
async function lgWaClaim(db, key, claimedBy) {
  const now = Date.now();

  const r = await db.ref(OUTBOX + '/' + key).transaction(cur => {
    //  ⚠️ null ולא undefined, וזה ההבדל בין עובד לשבור.
    //
    //  פיירבייס קוראת לפונקציה הזו **פעמיים**: תחילה עם הערך שבמטמון
    //  המקומי — שבפונקציה serverless הוא תמיד null — ורק אחר כך עם הערך
    //  מהשרת. undefined פירושו "בטל", ולכן `if (!cur) return;` ביטל את
    //  הטרנזקציה בקריאה הראשונה, והערך האמיתי מעולם לא נקרא.
    //
    //  התוצאה: committed=false תמיד, attempts נשאר 0, ו**שום הודעה לא
    //  יצאה אי פעם**. L9005 ישבה בתור pending בלי שאף תנאי אמיתי נכשל.
    //  (02/10/2026)
    //
    //  החזרת null שומרת על ההיעדר ומאפשרת לפיירבייס לקרוא שוב עם הערך
    //  מהשרת. אם הרשומה באמת אינה קיימת — הטרנזקציה תסגור על null,
    //  וזה נבדק אחרי ה-commit.
    if (cur === null)           return null;
    if (cur.state === 'sent')   return;   // abort — הלקוח קיבל
    if (cur.state === 'expired') return;  // abort — פג תוקף
    if (cur.claimedAt && (now - cur.claimedAt) < CLAIM_TTL_MS) return;  // abort — באוויר
    if ((cur.attempts || 0) >= MAX_ATTEMPTS) return;  // abort — נגמרו הניסיונות

    // ⚠️ פג תוקף נסגר כאן ולא נשלח. הודעה בת יממה מזיקה יותר מכלום.
    if ((now - (cur.createdAt || now)) > MAX_AGE_MS) {
      return { ...cur, state: 'expired', claimedAt: null, claimedBy: null,
               updatedAt: now, lastError: 'פג תוקף — לא נשלחה' };
    }

    return { ...cur, claimedAt: now, claimedBy: String(claimedBy || ''),
             attempts: (cur.attempts || 0) + 1, updatedAt: now };
  });

  if (!r.committed) {
    const cur = r.snapshot.val() || {};
    return { claimed: false, entry: cur, reason: cur.state || 'לא נתפסה' };
  }
  const entry = r.snapshot.val();
  // ⚠️ commit על null פירושו שהרשומה באמת אינה קיימת — ר' ההערה בטרנזקציה.
  // בלי הבדיקה הזו היינו "תופסים" רשומה ריקה ומנסים לשלוח אותה.
  if (!entry) return { claimed: false, entry: {}, reason: 'נעלמה' };
  // התפיסה "הצליחה" גם כשהיא רק סימנה פג-תוקף — אבל אין מה לשלוח
  if (entry.state === 'expired') return { claimed: false, entry, reason: 'expired' };
  return { claimed: true, entry, reason: '' };
}

//  סוגר רשומה אחרי שליחה.
//  ⚠️ בכישלון claimedAt מתנקה — זה מה שמאפשר ל-retry לתפוס שוב. בהצלחה
//  הוא נשאר יחד עם state='sent', והשילוב חוסם לנצח.
async function lgWaComplete(db, key, result) {
  const now = Date.now();
  const ok  = !!(result && result.ok);
  await db.ref(OUTBOX + '/' + key).update({
    state:     ok ? 'sent' : 'failed',
    sentAt:    ok ? now : null,
    claimedAt: ok ? now : null,
    messageId: (result && result.messageId) || null,
    httpStatus: (result && result.httpStatus) || null,
    lastError: ok ? null : String((result && result.reason) || 'שליחה נכשלה').slice(0, 300),
    updatedAt: now,
  });
}

// ─── חלון השליחה הגלובלי ────────────────────────────────────────────
//
//  ⚠️ המרווח בין נמענים הוא תכונה של **מופע ה-WhatsApp**, לא של התהליך.
//
//  הגרסה הראשונה הסתמכה על sleep בתוך ה-drain. זה עובד כל עוד יש drain
//  אחד — ושני טאבים פתוחים, או drain בדפדפן יחד עם אחד בשרת, נתנו קצב
//  אפקטיבי של gap/N. GREEN API מריצה מספר אמיתי של העסק, ו-WhatsApp סופרת
//  את הקצב של המספר ולא של התהליך ששלח.
//
//  לכן הזמן עבר לבסיס הנתונים: כל שליחה **מזמינה חלון** בטרנזקציה אטומית,
//  וזו נקודת הסנכרון היחידה. עשרה drain-ים מקבילים מקבלים עשרה חלונות
//  במרווח gap זה מזה.
//
//  מה זה מבטיח ומה לא:
//    ✓ ריווח בין **זמני ההתחלה** של שליחות, בכל התהליכים יחד
//    ✗ לא נעילה הדדית. עם 10 שניות בין חלונות ושליחה של ~שנייה, חפיפה
//      אינה אפשרית מעשית — וריווח הוא מה שמגבלת הקצב דורשת.
//
//  crash אחרי הזמנת חלון: החלון מתבזבז, והמחיר הוא gap אחד של שקט. התור
//  אינו נתקע, כי התפיסה של ההודעה עצמה פגה אחרי CLAIM_TTL_MS.
const SLOT = 'waMeta/sendSlot';

//  ⚠️ תקרת שפיות. maxWait ממילא מונע מ-nextAllowedAt להתרחק יותר מ-
//  gap+maxWait, ולכן ערך רחוק מכאן פירושו שעון שסטה או נתון פגום. בלי
//  התקרה, ערך כזה היה מקפיא את התור לשעות בלי שאיש יבין למה.
const SLOT_MAX_FUTURE_MS = 10 * 60 * 1000;

//  מזמין את החלון הפנוי הבא. מחזיר { ok, waitMs, slotAt }.
//  ok=false פירושו שהעתיד הקרוב תפוס — הקורא יפסיק את הסבב ויחזור.
async function lgWaReserveSlot(db, gapMs, maxWaitMs) {
  const r = await db.ref(SLOT).transaction(cur => {
    // ⚠️ null-first — אותו לקח כמו ב-lgWaClaim. כאן זה לא מסוכן כי אנחנו
    // לא מבטלים על ערך ריק, אבל הצורה חייבת להישאר נכונה: הפונקציה נקראת
    // פעמיים, ורק הקריאה השנייה רואה את הערך מהשרת.
    const now  = Date.now();
    const prev = (cur && Number(cur.nextAllowedAt)) || 0;
    const base = (prev > now + SLOT_MAX_FUTURE_MS) ? now : prev;
    const slot = Math.max(now, base);
    if (slot - now > maxWaitMs) return;          // abort — העתיד הקרוב תפוס
    return { nextAllowedAt: slot + gapMs, updatedAt: now };
  });

  if (!r.committed) return { ok: false, waitMs: 0, slotAt: 0 };
  const slotAt = (Number((r.snapshot.val() || {}).nextAllowedAt) || 0) - gapMs;
  return { ok: true, waitMs: Math.max(0, slotAt - Date.now()), slotAt };
}

//  מה ממתין לשליחה. מחזיר מפתחות בלבד, ובסדר הכניסה.
//  limit קטן בכוונה: ה-drain מוגבל ממילא, ואין טעם לקרוא תור שלם.
async function lgWaPending(db, limit) {
  const snap = await db.ref(OUTBOX).orderByChild('createdAt').limitToFirst(limit || 50).once('value');
  const out  = [];
  snap.forEach(ch => {
    const v = ch.val() || {};
    const retryable = v.state === 'pending' || (v.state === 'failed' && (v.attempts || 0) < MAX_ATTEMPTS);
    if (retryable) out.push(ch.key);
  });
  return out;
}

module.exports = {
  lgWaMsgKey, lgWaEnqueue, lgWaClaim, lgWaComplete, lgWaPending, lgWaReserveSlot,
  OUTBOX, SLOT, CLAIM_TTL_MS, MAX_ATTEMPTS, MAX_AGE_MS, SLOT_MAX_FUTURE_MS,
};
