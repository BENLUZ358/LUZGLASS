// ═══════════════════════════════════════════════════════════════════
//  api/_env.js — האם מותר לפנייה לצאת החוצה.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  ─── למה זה קיים ───────────────────────────────────────────────────
//
//  שתי מערכות חיצוניות יכולות לגרום נזק שאי אפשר להחזיר: חשבשבת פותחת
//  מסמך חשבונאי אמיתי, ו-WhatsApp שולח הודעה ללקוח אמיתי. מסמך מיותר
//  מבטלים; הודעה שיצאה כבר נקראה.
//
//  הייתה כבר חסימה אחת — הדגל isTest על ההזמנה — אבל היא פר-רשומה
//  ובבחירה מפורשת. סביבת TEST צריכה חסימה גלובלית: כל פנייה, מכל
//  endpoint, גם אם מישהו קורא ישירות ל-API בלי לעבור במסך.
//
//  ─── למה לא דגל סביבה פשוט ─────────────────────────────────────────
//
//  "חסום כש-LG_ENV=test" הוא fail-open: משתנה שנשכח, שנכתב בטעות
//  LG_ENV=Test, או פרויקט Vercel חדש שהועתק — וסביבת הבדיקות שולחת
//  באמת. "שלח רק כש-LG_ENV=production" הוא fail-safe, אבל הפרודקשן
//  היום אינו מגדיר שום משתנה כזה, וההוספה הייתה משביתה אותו עד
//  שמישהו נזכר.
//
//  לכן ההחלטה נגזרת ממה שכבר שונה בין הסביבות בהכרח: **מפתח השירות**.
//  כל endpoint כבר מאמת דרכו את הקורא (ר' _verifyAdmin), ולכן הוא
//  חייב להיות נוכח ותקין לפני שמגיעים לפנייה החיצונית בכלל.
//
//    פרודקשן  → project_id = 'lussglass'        → שולח. אפס קונפיגורציה.
//    TEST      → project_id = 'luz-glass-test'   → חסום. אפס קונפיגורציה.
//    כל דבר אחר → חסום כברירת מחדל.
//
//  LG_ENV נשאר כמתג נוסף, אבל הוא יכול רק **להחמיר**: LG_ENV=test חוסם
//  גם בפרודקשן (שימושי לחזרה יבשה), ואין ערך שמתיר משהו שאסור בלעדיו.
//  ⚠️ אל תהפוך את זה — ברגע ש-LG_ENV יוכל להתיר, החסימה חוזרת להיות
//  fail-open ואפשר לפתוח אותה בטעות משורת סביבה אחת.
// ═══════════════════════════════════════════════════════════════════

// הפרויקט היחיד שמותר לו לפנות החוצה. מחרוזת ולא משתנה סביבה בכוונה:
// ערך בקוד אי אפשר לשנות בלי commit, ו-commit רואים.
const LG_LIVE_PROJECT = 'lussglass';

function _projectId() {
  try {
    return String(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}').project_id || '');
  } catch (_) {
    return '';   // JSON פגום — לא מזוהה, ולכן חסום
  }
}

//  מחזיר { allowed, projectId, declared, reason }.
//  reason הוא טקסט בעברית שמוצג למי שעובד במסך, ולא קוד שגיאה.
function lgExternal() {
  const projectId = _projectId();
  const declared  = String(process.env.LG_ENV || '').trim().toLowerCase();

  if (declared === 'test') {
    return { allowed: false, projectId, declared,
             reason: 'סביבת בדיקות (LG_ENV=test) — פניות חיצוניות חסומות' };
  }
  if (projectId !== LG_LIVE_PROJECT) {
    return { allowed: false, projectId, declared,
             reason: 'סביבת בדיקות (' + (projectId || 'פרויקט לא מזוהה') + ') — פניות חיצוניות חסומות' };
  }
  return { allowed: true, projectId, declared, reason: '' };
}

//  לנקודות קריאה בלבד (מק"טים, כרטיסי לקוח, PDF): אין טעם להחזיר נתונים
//  מזויפים — מי שקורא אותם יבנה עליהם. עדיף לומר בבירור שזו סביבת בדיקות.
//  503 ולא 403: זו אינה בעיית הרשאה אלא שירות שאינו זמין כאן.
function lgBlockExternal(res, what) {
  const e = lgExternal();
  res.status(503).json({
    error: e.reason,
    blocked: true,
    environment: e.projectId || 'unknown',
    what: what || '',
    hint: 'הפעולה הזו פונה למערכת חיצונית ולכן היא זמינה רק בסביבת הייצור.',
  });
}

module.exports = { lgExternal, lgBlockExternal, LG_LIVE_PROJECT };
