// ═══════════════════════════════════════════════════════════════════
//  api/_wa-provider.js — מי שולח את ה-WhatsApp, ובאיזה קצב.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  ─── למה זה קיים ───────────────────────────────────────────────────
//
//  הלוגיקה העסקית יודעת **עובדות**: למי, על מה, ובאיזה הקשר. היא לא
//  יודעת מה זו תבנית מאושרת, מה זה chatId, ואיפה יושב הטוקן. ברגע שהיא
//  יודעת את זה, החלפת ספק הופכת לשינוי בכל מקום שמזכיר WhatsApp.
//
//  לכן הספק מקבל { to, kind, clientName, orderNums } ומרנדר בעצמו:
//  Meta הופכת את זה לפרמטרים של תבנית, GREEN API למשפט.
//
//  ─── ולמה גם הקצב יושב כאן ─────────────────────────────────────────
//
//  ⚠️ זה לא פרט טכני אלא ההבדל המרכזי בין שני הספקים.
//
//  Meta Cloud API הוא הערוץ הרשמי. 250ms בין הודעות בסדר גמור שם, ואין
//  סיכון שהמספר ייחסם.
//
//  GREEN API מריצה **מספר WhatsApp אמיתי של העסק**. התקרה הטכנית שלהם
//  היא 50 בקשות לשנייה, אבל היא אינה האילוץ — היא רחוקה פי אלף מהרלוונטי.
//  האילוץ הוא WhatsApp עצמה: GREEN API מגדירים ש**פחות מ-500ms בין צ'אטים
//  שונים נחשב "דיוור אוטומטי"**, וממליצים על 10-15 שניות בדיוור. 40 הודעות
//  ב-10 שניות ל-40 נמענים שונים הן בדיוק החתימה שבגללה מספרים נחסמים.
//
//  ולכן הקצב הוא **מאפיין של הספק** ולא קבוע בקובץ: Meta מקבלת את ערכי
//  היום בדיוק, GREEN API מקבלת 10 שניות וניתן לכוון אותן ממשתנה סביבה
//  בלי פריסה מחדש.
//
//  jitter הוא לא קוסמטיקה: מרווח קבוע מושלם הוא בעצמו חתימת בוט.
//
//  ─── בחירת הספק ────────────────────────────────────────────────────
//
//  WA_PROVIDER. **ברירת המחדל היא meta**, והפרודקשן אינו מגדיר אותו —
//  ולכן התנהגות הייצור אינה משתנה עד שמישהו מחליט אחרת במפורש.
//
//  משתני סביבה — GREEN API, בפרויקט ה-Vercel של TEST בלבד:
//    GREENAPI_ID_INSTANCE    מזהה המופע
//    GREENAPI_TOKEN          ⚠️ סוד. לא ללוג, לא לתשובה, לא למאגר
//    GREENAPI_TEST_ENABLED   חייב להיות בדיוק "1"
//    GREENAPI_TEST_TO        ⚠️ בפורמט מקומי (05XXXXXXXX) — ר' gate() למטה
//    GREENAPI_GAP_MS         ברירת מחדל 10000
//    GREENAPI_MAX_PER_RUN    ברירת מחדל 10
// ═══════════════════════════════════════════════════════════════════

const { lgExternal, lgGreenApiGate, lgGreenApiEnvReady } = require('./_env');
const { toWaNumber } = require('./_wa-recipient');

//  ⚠️ המלכודת כאן אמיתית ועלתה בבדיקה: Number('') הוא 0, ו-0 הוא מספר
//  תקין. הגרסה הראשונה בדקה n >= 0, ולכן משתנה סביבה ריק או חסר החזיר
//  **קצב אפס** — כלומר שליחה בלי שום האטה, בדיוק המצב שבגללו מספר WhatsApp
//  נחסם. ריק נחשב חסר, ורק ערך חיובי ממש נחשב הגדרה.
const num = (v, dflt) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return dflt;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// ── הטקסט. במקום אחד, כדי שנוסח סופי יהיה שינוי של שורה ───────────────
//
//  ⚠️ הנוסח עדיין לא סופי — בן ביקש במפורש לא לקבוע אותו עכשיו.
//
//  ושימו לב לכלל של GREEN API: "אל תשלח את אותה הודעה לאנשים שונים."
//  מכיוון שהספק מקבל עובדות ולא טקסט מוכן, כל הודעה ממילא נושאת שם לקוח
//  ומספרי הזמנה אחרים. זה יצא לטובה ולא בכוונה.
const BUSINESS = 'לוז זגגות ומראות האחים בע"מ';

const portalLine = n => 'לפרטים נוספים ניתן להיכנס למשתמש שלך בלוז גלאס ולצפות ב' +
                         (n > 1 ? 'פרטי ההזמנות.' : 'פרטי ההזמנה.');

function renderText({ kind, clientName, orderNums, sketchNames }) {
  const who  = String(clientName || 'לקוח');
  const nums = (orderNums || []).filter(Boolean);

  //  מספר ההזמנה הוא המזהה שלנו, שם הסקיצה הוא זה שהלקוח מכיר.
  //  ⚠️ בלי שם — רק המספר, בלי מקף תלוי באוויר.
  const label = i => {
    const s = String((sketchNames || [])[i] || '').trim();
    return s ? nums[i] + ' — ' + s : nums[i];
  };
  //  ⚠️ שורת הסיום מתאימה את עצמה למספר ההזמנות. היא נוסחה ביחיד כשכל
  //  הודעה נשאה הזמנה אחת; מרגע שיש קיבוץ, "בפרטי ההזמנה" על שלוש הזמנות
  //  פשוט שגוי.
  const wrap = body => `שלום ${who},\n\n${body}\n\n${portalLine(nums.length)}\n\n${BUSINESS}`;
  const bullets = () => nums.map((_, i) => '• ' + label(i)).join('\n');

  if (kind === 'dispatched') {
    return nums.length > 1
      ? wrap('ההובלה יצאה אליך עם ההזמנות:\n' + bullets())
      : wrap('ההובלה יצאה אליך עם הזמנה ' + label(0) + '.');
  }
  //  ⚠️ רשימה ולא שרשור בפסיקים: שלוש הזמנות עם שמות סקיצה בשורה אחת
  //  הופכות למשפט שאי אפשר לקרוא בטלפון.
  return nums.length > 1
    ? wrap('ההזמנות הבאות מוכנות לאיסוף:\n' + bullets())
    : wrap('ההזמנה ' + label(0) + ' מוכנה לאיסוף.');
}

/* ═══ Meta Cloud API — מסלול הייצור. לא משתנה ═══════════════════════ */

function metaProvider() {
  const PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WA_ACCESS_TOKEN;
  const TEMPLATE = process.env.WA_TEMPLATE_NAME;
  const LANG     = process.env.WA_TEMPLATE_LANG || 'he';
  const GRAPH    = process.env.WA_GRAPH_VERSION || 'v21.0';

  return {
    name:       'meta',
    configured: !!(PHONE_ID && TOKEN && TEMPLATE),
    // ⚠️ לא דרך תור. זו התנהגות הייצור של היום, ושינוי שלה היה משנה את
    // הייצור — בדיוק מה שנאסר. התור נדרש בגלל הקצב של GREEN API, לא כאן.
    queued:     false,
    //  ⚠️ Meta היא הערוץ הרשמי ואין בה סיכון חסימה של המספר. הקצב נשאר
    //  sleep בתוך הבקשה, בדיוק כפי שהיה — בלי צומת חדש ובלי טרנזקציה.
    globalSlot: false,
    gapMs:      250,
    maxPerRun:  60,
    template:   TEMPLATE,
    nextGap() { return 250; },

    // אותה חסימה גלובלית שהייתה כאן תמיד — ר' _env.js.
    // ⚠️ ctx מתעלם: אצל Meta ההחלטה אינה תלויה בנמען, והיא לא השתנתה.
    gate(_ctx) { const e = lgExternal(); return { allowed: e.allowed, reason: e.reason }; },
    ready()    { const e = lgExternal(); return { allowed: e.allowed, reason: e.reason }; },

    // התבנית מקבלת שני משתנים: שם הלקוח ומספר ההזמנה. עבור kind='ready'
    // עם הזמנה אחת זו **אותה מחרוזת בדיוק** שנשלחה עד היום.
    params({ clientName, orderNums }) {
      return [String(clientName || 'לקוח'), (orderNums || []).filter(Boolean).join(', ')];
    },

    async send({ to, kind, clientName, orderNums }) {
      const params  = this.params({ clientName, orderNums });
      const payload = {
        messaging_product: 'whatsapp',
        to:   toWaNumber(to),
        type: 'template',
        template: {
          name: TEMPLATE || '(לא מוגדר)',
          language: { code: LANG },
          components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: t })) }],
        },
      };

      let httpStatus = 0, text = '', parsed = null;
      try {
        const r = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
          method:  'POST',
          headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        httpStatus = r.status;
        text = await r.text();
        try { parsed = JSON.parse(text); } catch (_) { /* לא JSON — נשמר גולמי */ }
      } catch (e) {
        text = String(e && e.message || e);
      }

      // ⚠️ 200 אינו "הלקוח קיבל" — הוא "Meta קיבלה ממני". מסירה אמיתית
      // מגיעה ב-webhook נפרד.
      const ok = httpStatus >= 200 && httpStatus < 300;
      return {
        ok, httpStatus, params,
        messageId: (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) || null,
        detail:    String(text).slice(0, 2000),
        reason:    ok ? null : (parsed && parsed.error && parsed.error.message) || String(text).slice(0, 300),
      };
    },
  };
}

/* ═══ GREEN API — TEST ═══════════════════════════════════════════════ */

function greenProvider() {
  const idInstance = String(process.env.GREENAPI_ID_INSTANCE || '').trim();
  const token      = String(process.env.GREENAPI_TOKEN || '').trim();
  const gapMs      = num(process.env.GREENAPI_GAP_MS,     10000);
  const maxPerRun  = num(process.env.GREENAPI_MAX_PER_RUN,    10);

  return {
    name:       'green',
    configured: !!(idInstance && token),
    // ⚠️ חייב תור. 40 הודעות × 10 שניות = מעל 6 דקות, ואי אפשר להחזיק
    // request HTTP פתוח כל כך. הפעולה העסקית נסגרת מיד, ההודעות יוצאות
    // בהדרגה מ-waOutbox.
    queued:     true,
    //  ⚠️ הקצב נאכף גלובלית דרך waMeta/sendSlot. sleep מקומי לא מספיק:
    //  WhatsApp סופרת את הקצב של המספר, לא של התהליך ששלח.
    globalSlot: true,
    gapMs,
    maxPerRun,
    template:   null,

    // מרווח קבוע מושלם הוא חתימת בוט. ±30%, ולעולם לא מתחת לרצפה שהם
    // עצמם מגדירים (500ms).
    nextGap() {
      const jittered = Math.round(gapMs * (0.7 + Math.random() * 0.6));
      return Math.max(500, jittered);
    },

    //  ⚠️ מקבל את מה ש-resolvePhone החזיר: accountKey וטלפון **בפורמט
    //  המקומי**, לפני ההמרה ל-972. GREENAPI_ONLY_TO מוגדר בפורמט מקומי,
    //  והעברת 972... לכאן הייתה מכשילה כל שליחה ב-TEST.
    //
    //  ⚠️ ההרשאה נשענת על accountKey ולא על הטלפון: טלפון אפשר להחליף
    //  בהזמנה, מפתח כרטיס לא.
    gate(ctx) {
      const g = lgGreenApiGate(ctx || {});
      return { allowed: g.allowed, reason: g.reason };
    },
    //  נעילות הסביבה בלבד, בלי נמען — כדי שתשובת ה-API תוכל לומר "הסביבה
    //  מוכנה" מבלי להמציא לקוח. אותן נעילות, לא עותק שלהן.
    ready() {
      const e = lgGreenApiEnvReady();
      return { allowed: e.allowed, reason: e.reason };
    },

    params(facts) { return [renderText(facts || {})]; },

    async send(facts) {
      const { to }  = facts || {};
      const text    = renderText(facts || {});
      const chatId = toWaNumber(to) + '@c.us';

      // ⚠️ נלמד בדרך הקשה, 2026-10-01: GREEN API מחזירה את ה-URL המלא
      // בתוך גוף השגיאה (שדה path), ובו הטוקן. ההנחה שהגוף נקי הייתה
      // שגויה והטוקן דלף. מכאן: כל מחרוזת שיוצאת מכאן עוברת redact.
      const redact = s => String(s == null ? '' : s).split(token).join('***');

      // ⚠️ הטוקן יושב בתוך ה-URL — זו הדרך ש-GREEN API עובדת. ולכן ה-URL
      // עצמו הוא סוד: לא ללוג, לא לתשובה, לא להודעת שגיאה.
      const url = 'https://api.green-api.com/waInstance' + idInstance + '/sendMessage/' + token;

      let httpStatus = 0, parsed = null, raw = '';
      try {
        const r = await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chatId, message: text }),
        });
        httpStatus = r.status;
        raw = await r.text();
        try { parsed = JSON.parse(raw); } catch (_) { /* לא JSON */ }
      } catch (e) {
        // ⚠️ e.message של fetch עלול להכיל את ה-URL, ועם זה את הטוקן.
        return { ok: false, httpStatus: 0, messageId: null, params: [text],
                 detail: 'network', reason: 'שגיאת רשת מול GREEN API (' + (e && e.name) + ')' };
      }

      const ok = httpStatus >= 200 && httpStatus < 300 && !!(parsed && parsed.idMessage);
      return {
        ok, httpStatus,
        params:    [text],
        messageId: (parsed && parsed.idMessage) || null,
        // ⚠️ לא הגוף הגולמי — הוא מכיל path ובו הטוקן. רק מה שמסביר כישלון.
        detail:    ok ? 'sent' : redact((parsed && (parsed.message || parsed.error)) || '').slice(0, 300),
        reason:    ok ? null  : redact((parsed && (parsed.message || parsed.error)) || 'HTTP ' + httpStatus).slice(0, 300),
      };
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════ */

//  ברירת המחדל היא meta — ולכן סביבה שאינה מגדירה WA_PROVIDER מתנהגת
//  בדיוק כמו היום. ערך לא מוכר נופל ל-meta ולא לשקט.
function lgWaProvider() {
  const want = String(process.env.WA_PROVIDER || '').trim().toLowerCase();
  return want === 'green' ? greenProvider() : metaProvider();
}

module.exports = { lgWaProvider, renderText };
