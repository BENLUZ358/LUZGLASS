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

//  כתובת ה-Realtime Database של הסביבה שבה הפונקציה רצה.
//
//  ⚠️ הייתה קשיחה בארבעה קבצים, ועל הפרודקשן זה עבד במקרה: זו הייתה
//  הכתובת הנכונה. ב-TEST זה נשבר בשקט ובצורה מטעה — הפונקציה מתאמתת
//  עם מפתח השירות של TEST אבל פונה לבסיס של הייצור, שאין לו בו הרשאה,
//  והבקשה פשוט נתקעת עד timeout בלי שום הודעה.
//
//  (הצד השני של אותו מטבע, וכדאי לזכור: זו גם הייתה חומה — סביבת TEST
//  לא הצליחה לקרוא מהייצור, כי ההרשאה נבדקת בצד של Firebase.)
//
//  נגזר משם הפרויקט, כי שתי הסביבות בנויות באותה תבנית ובאותו אזור:
//    lussglass       → https://lussglass-default-rtdb.europe-west1...
//    luz-glass-test  → https://luz-glass-test-default-rtdb.europe-west1...
//  התוצאה עבור הייצור **זהה תו-בתו** למחרוזת שהייתה קשיחה, ולכן אין שם
//  שום שינוי התנהגות.
//
//  FIREBASE_DATABASE_URL גובר, למקרה של מופע שאינו ברירת המחדל או אזור אחר.
function lgDatabaseUrl() {
  const explicit = String(process.env.FIREBASE_DATABASE_URL || '').trim();
  if (explicit) return explicit;
  const pid = _projectId();
  if (!pid) throw new Error('missing FIREBASE_SERVICE_ACCOUNT — cannot resolve database URL');
  return 'https://' + pid + '-default-rtdb.europe-west1.firebasedatabase.app';
}

// ─── GREEN API · שער אחד, לשתי הסביבות ────────────────────────────
//
//  ⚠️ **אותו קוד רץ ב-TEST ובייצור.** אין כאן שום הסתעפות על "איזו
//  סביבה זו" לצורך לוגיקה עסקית — ההבדל חי כולו בערכי הסביבה.
//
//  הגרסה הקודמת (lgGreenApiTest) חסמה את הייצור מבנית, לפי project_id.
//  ההגנה ההיא לא יכלה לשרוד את הדרישה "הייצור חייב לשלוח", ולכן היא
//  הוחלפה בשש נעילות שכולן fail-safe:
//
//    1. WA_PROVIDER=green — הפעלה מפורשת
//    2. אישורי החיבור קיימים שניהם
//    3. יש accountKey. ⚠️ אין כרטיס לקוח → אין הודעה, לעולם. הזמנה
//       שנפלה ל-order.phone אינה יכולה לעבור מכאן.
//    4. הרשימה שייכת לפרויקט הזה — ר' למטה
//    5. ה-accountKey נמצא ברשימה
//    6. נעילת נמען, אם הוגדרה (GREENAPI_ONLY_TO)
//
//  ─── למה הרשימה חתומה על שם הפרויקט ────────────────────────────────
//
//  ⚠️ זה ה-invariant היחיד שמודע לסביבה, והוא **אינו לוגיקה עסקית אלא
//  בדיקת שפיות**: טעות אנוש שתעתיק את משתני הייצור לפרויקט ה-TEST לא
//  תאפשר ל-TEST לשלוח ללקוחות אמיתיים.
//
//      GREENAPI_ALLOWED_ACCOUNTS = lussglass:14201
//                                  luz-glass-test:TEST-WA
//
//  הקידומת נבדקת מול project_id שנגזר ממפתח השירות — אותו מקור שעליו
//  בנוי lgExternal, והיחיד שכבר מבדיל בין הסביבות ואי אפשר להעתיק אותו
//  בלי שהעתקה כזו תהיה הבעיה הקטנה.
//
//  ושכבה שנייה קיימת בחינם: resolvePhone קורא את hashavshevetAccounts
//  של בסיס הנתונים הנוכחי. ב-TEST קיים TEST-WA בלבד, ולכן שום הזמנה שם
//  לא יכולה להיפתר ל-14201 — הכרטיס פשוט לא נמצא שם.
//
//  ⚠️ ולא מחזיר את הטוקן. ב-GREEN API הטוקן יושב בתוך ה-URL
//  (/waInstance{id}/sendMessage/{token}), ולכן כל אובייקט שמכיל אותו עלול
//  להגיע ללוג או לתשובה. הקורא קורא אותו מהסביבה בעצמו, ברגע השליחה בלבד.
const _digits = p => String(p || '').replace(/\D/g, '');

//  "<project_id>:<key1>,<key2>" → { project, keys }
//  כל צורה אחרת מחזירה רשימה ריקה, וריק פירושו חסום.
function _lgParseAllowlist(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i < 1) return { project: '', keys: [] };
  return {
    project: s.slice(0, i).trim(),
    keys: s.slice(i + 1).split(',').map(k => k.trim()).filter(Boolean),
  };
}

//  נעילות 1, 2, 4 — כל מה שאינו תלוי בנמען מסוים.
//  קיימת בנפרד כדי שמסך יוכל לשאול "האם הסביבה בכלל מוכנה" בלי להמציא
//  לקוח, ו-lgGreenApiGate מרכיב אותה — אין כאן שני עותקים של אותו כלל.
function lgGreenApiEnvReady() {
  if (String(process.env.WA_PROVIDER || '').trim().toLowerCase() !== 'green') {
    return { allowed: false, reason: 'GREEN API אינו הספק הפעיל בסביבה הזו (WA_PROVIDER)' };
  }
  if (!process.env.GREENAPI_ID_INSTANCE || !process.env.GREENAPI_TOKEN) {
    return { allowed: false, reason: 'חסרים אישורי GREEN API בסביבה' };
  }
  const list = _lgParseAllowlist(process.env.GREENAPI_ALLOWED_ACCOUNTS);
  if (!list.keys.length) {
    return { allowed: false, reason: 'לא הוגדרה רשימת לקוחות מורשים (GREENAPI_ALLOWED_ACCOUNTS)' };
  }
  const pid = _projectId();
  if (!pid || list.project !== pid) {
    return { allowed: false,
             reason: 'רשימת הלקוחות המורשים מונפקת לפרויקט ' +
                     (list.project || 'ללא שם') + ' ולא לפרויקט הנוכחי — חסום' };
  }
  return { allowed: true, reason: '', keys: list.keys };
}

//  השער המלא. מקבל את מה ש-resolvePhone החזיר.
function lgGreenApiGate(ctx) {
  const env = lgGreenApiEnvReady();
  if (!env.allowed) return { allowed: false, reason: env.reason };

  const key = String((ctx && ctx.accountKey) == null ? '' : ctx.accountKey).trim();
  // ⚠️ נעילה 3. זו שהופכת "לא מצאנו כרטיס" מחולשה להגנה.
  if (!key) {
    return { allowed: false, reason: 'אין כרטיס לקוח להזמנה — לא נשלחת הודעה' };
  }
  if (env.keys.indexOf(key) < 0) {
    return { allowed: false, reason: 'הלקוח ' + key + ' אינו ברשימת המורשים לשליחה' };
  }

  // נעילה 6 — פעילה רק כשהוגדרה. ב-TEST היא מצמצמת למספר אחד; בייצור
  // היא אינה מוגדרת, כי שם צריך לשלוח לכל לקוח מאושר.
  const only = _digits(process.env.GREENAPI_ONLY_TO);
  if (only && _digits(ctx && ctx.phone) !== only) {
    return { allowed: false, reason: 'הנמען אינו המספר המורשה בסביבה הזו' };
  }

  // accountKey בלבד. בלי idInstance ובלי token — ר' ההערה למעלה.
  return { allowed: true, reason: '', accountKey: key };
}

module.exports = { lgExternal, lgBlockExternal, lgDatabaseUrl,
                   lgGreenApiGate, lgGreenApiEnvReady, LG_LIVE_PROJECT };
