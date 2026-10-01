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
async function lgWaEnqueue(db, { kind, to, clientName, orderNums, orderIds, queuedBy }) {
  const key = lgWaMsgKey(kind, orderIds);
  const now = Date.now();

  const r = await db.ref(OUTBOX + '/' + key).transaction(cur => {
    if (cur && cur.state === 'sent')    return;   // abort — כבר נשלחה
    if (cur && cur.state === 'pending') return;   // abort — כבר בתור
    return {
      kind:      String(kind),
      to:        String(to),
      clientName: String(clientName || ''),
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
    if (!cur)                   return;   // abort — נעלמה
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
  const entry = r.snapshot.val() || {};
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
  lgWaMsgKey, lgWaEnqueue, lgWaClaim, lgWaComplete, lgWaPending,
  OUTBOX, CLAIM_TTL_MS, MAX_ATTEMPTS, MAX_AGE_MS,
};
