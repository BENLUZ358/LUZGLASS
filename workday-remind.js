// ═══════════════════════════════════════════════════════════════════
//  workday-remind.js — "שכחת ללחוץ סיים יום עבודה" (בן, 14/11).
//
//  workday/inWorkSince — מתי נכנסה ליום העבודה ההזמנה הראשונה שעוד לא סוימה
//  (workday.html רושם ב-saveWorkDay; מתאפס כש-inWork מתרוקן ב"סיים יום עבודה").
//
//  lgWorkdayForgot → null | 'old' | 'late':
//    'old'  — יש הזמנות בעבודה מיום קודם (שכחו אתמול). גם בבוקר, גם בשישי.
//    'late' — א׳–ה׳ מ-17:00, יש הזמנות בעבודה מהיום.
//  משתמשים: הבאנר בדף הראשי (admin.html) והחלון לפני "הורד לעבודה" (workday.html — רק 'old').
//  הוואטסאפ לבן ולשאול — בשרת: api/_workday-remind.js (אותה שעה, אותם ימים).
//  טהור; נבדק ב-scripts/test-workday-remind.js.
// ═══════════════════════════════════════════════════════════════════

var LG_WD_REMIND_HOUR = 17;

function _lgWdIl(ms) {
  var p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return { iso: p.year + '-' + p.month + '-' + p.day, weekday: p.weekday, hour: Number(p.hour) };
}

//  כמה הזמנות ב-inWork (מערך או אובייקט של Firebase)
function lgWorkdayCountOf(inWork) {
  if (!inWork || typeof inWork !== 'object') return 0;
  return Object.keys(inWork).filter(function (k) { var v = inWork[k]; return v != null && v !== ''; }).length;
}

//  { count, since, now } → null | 'old' | 'late'
function lgWorkdayForgot(o) {
  var count = Number(o && o.count) || 0;
  if (!count) return null;
  var now = Number(o.now) || Date.now(), t = _lgWdIl(now), since = Number(o.since) || 0;
  if (since && _lgWdIl(since).iso < t.iso) return 'old';
  if (['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].indexOf(t.weekday) > -1 && t.hour >= LG_WD_REMIND_HOUR) return 'late';
  return null;
}

//  התאריך של since לתצוגה: 'dd/mm'
function lgWorkdaySinceText(since) {
  var iso = _lgWdIl(Number(since) || 0).iso.split('-');
  return iso[2] + '/' + iso[1];
}

//  הטקסט של הבאנר / החלון
function lgWorkdayForgotText(kind, count, since) {
  var n = count === 1 ? 'הזמנה אחת' : count + ' הזמנות';
  if (kind === 'old') return 'יש ' + n + ' ביום העבודה מ-' + lgWorkdaySinceText(since) + ' שעוד לא נלחץ עליהן "סיים יום עבודה". הלקוחות לא קיבלו הודעת "מוכן".';
  if (kind === 'late') return 'עוד לא נלחץ "סיים יום עבודה" היום. יש ' + n + ' בעבודה.';
  return '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_WD_REMIND_HOUR: LG_WD_REMIND_HOUR, lgWorkdayCountOf: lgWorkdayCountOf, lgWorkdayForgot: lgWorkdayForgot,
    lgWorkdaySinceText: lgWorkdaySinceText, lgWorkdayForgotText: lgWorkdayForgotText };
}
