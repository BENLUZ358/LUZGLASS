// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-catalog.js  v2.0
//  ספריית הצורות: שם ומזהה. הצורה עצמה כבר קיימת במנוע.
// ════════════════════════════════════════════════════════════════════════
//
// הקובץ הזה **לא מגדיר צורות**. הוא נותן שם ומזהה למה שהמסך כבר יודע
// לבנות: אותו kind, אותו צד ציר, אותו דגל שיפוע ש-shapeAdd מקבל מאז
// ומעולם. הזכוכית, הפרזול והמידות באים מ-lg-shapes.js ומ-lg-layout.js
// כמו לכל צורה שנוספת מהמסך.
//
// הגרסה הראשונה ניסתה לתאר כל צורה מחדש — כמה זוויות, באיזה צד, באיזה
// מרחק. זה היה מקור אמת שני לאותה עובדה, ושני מקורות אמת תמיד נפרדים:
// יצאו דלתות שהידית והציר שלהן באותו צד, וקבועים עם ארבע זוויות בלי
// סיבה. הצורה מוגדרת במקום אחד — במנוע — והקטלוג רק מצביע עליה.
//
// ─── מה יש בערך אחד ────────────────────────────────────────────────────
//
//   id      מזהה יציב. הזמנה שמורה מצביעה עליו.
//   name    מה שהלקוח קורא בגלריה.
//   origin  'seed' משוגר · 'factory' ספריית המפעל · 'personal' של הלקוח
//   add     בדיוק הארגומנטים של shapeAdd: kind, hingeSide, slope.
//
// ולכן צורה חדשה בספרייה אינה קוד חדש — היא שורה. זה מה שיאפשר למסך
// האדמין להגדיל את הספרייה בלי לגעת בקובץ הזה.

var LG_CAT_VERSION = 2;

var LG_CAT_KINDS = { fixed: 1, door: 1, mirror: 1, shape: 1 };

// דגלים שאינם סוג זכוכית אלא **קיצור למצב התחלתי** שכבר קיים במסך:
// ‏slope הוא hasSlope, ו-notch הוא מה שהמתג בגיליון המאפיינים כותב.
// שניהם מתורגמים במקום אחד ב-shapeAdd, ולא כאן.
var LG_CAT_FLAGS = { slope: 1, notch: 1, hingesFor: 1, holes: 1,
                     notchSide: 1, slopeSideV: 1, slopeFlip: 1,
                     carriesDoor: 1,
                     // המידות שמגדירות את הצורה — ראה למטה
                     notchW: 1, notchH: 1, notchHIn: 1, notchRest: 1,
                     notchBracket: 1, slopeH1: 1, slopeH2: 1, slopeSideH: 1,
                     slopeW: 1, slopeW1: 1, slopeW2: 1 };

// ─── מה נשמר במספרים ────────────────────────────────
//
// הקטלוג נשא כוונה, אבל **המדרגה והשיפוע הם הצורה עצמה**, לא
// מידות של הזמנה. מי ששמר "קבוע עם מדרגה 30×60" וקיבל בחזרה
// 20×50 קיבל צורה אחרת מזו ששמר.
//
// ‏**רוחב וגובה אינם כאן.** הם המידות של העבודה ומשתנות בכל
// הזמנה, וצורה שתכפוף אותם הייתה מחיקה מה שהוקלד בסקיצה.
var LG_CAT_NUMS = ['notchW', 'notchH', 'notchHIn', 'notchRest',
                   'slopeH1', 'slopeH2', 'slopeW1', 'slopeW2'];

// תפקידי קדחים שצורה רשאית לשאת בעצמה. **תפקידי צומת אינם כאן**: ציר
// וזווית קיר נגזרים ממה שהזכוכית נפגשת איתו, ולתת להם להיכתב ביד היה
// מחזיר בדיוק את הסתירה שהפילה את הגרסה הקודמת. זווית רצפה וקדח חופשי
// אינם נובעים משום מפגש, ולכן רק הם מוצהרים.
var LG_CAT_OWN_ROLES = { 'bracket-floor': 20, 'hole': 12 };

// ─── מזהה לכל צורה ─────────────────────────────────
//
// שם הוא מה שהלקוח קורא, ושני לקוחות יכולים לקרוא לשתי צורות
// שונות באותו שם. הקוד הוא **מה שמזהה את הצורה עצמה** — בהזמנה,
// בשיחה עם המפעל, ובספרייה עצמה.
//
// הוא נגזר מהמזהה הקיים ולא ממונה מתקדם: מונה בענן היה צריך
// נעילה, ושתי שמירות באותה שנייה היו מקבלות אותו מספר.
var LG_CODE_PFX = { fixed: 'FX', door: 'DR', mirror: 'MR', shape: 'SH' };

function lgShapeCode(entry) {
  if (!entry) return '';
  if (entry.code) return entry.code;
  var kind = (entry.add && entry.add.kind) || 'shape';
  var pfx  = LG_CODE_PFX[kind] || 'SH';
  // החלק היציב של המזהה: sh_<זמן בבסיס 36>_<שם>. הזמן הוא
  // מה שמבדיל בין שתי צורות, ולכן הקוד נגזר ממנו ולא מהשם.
  var m = String(entry.id || '').match(/^sh_([a-z0-9]+)/i);
  var tail = m ? m[1] : String(entry.id || '').replace(/[^a-z0-9]/gi, '');
  tail = tail.toUpperCase().slice(-5);
  return tail ? pfx + '-' + tail : pfx;
}

function lgCatalogSeeds() {
  return [
    // "זוויות בלבד" היא הצהרה, לא היעדר מידע: מי שבוחר את הכרטיס הזה
    // אומר שאין על הקבוע הכנה לצירים, ולכן דלת לא תוכל להיתלות עליו.
    { code: 'FX-01', id: 'fixed',       name: 'קבוע · זוויות בלבד', origin: 'seed',
      add: { kind: 'fixed', carriesDoor: false } },
    { code: 'FX-02', id: 'fixed-slope', name: 'קבוע משופע',     origin: 'seed',
      add: { kind: 'fixed', slope: true } },
    // המדרגה אינה הגדרה חדשה: אלה בדיוק המספרים שהמתג בגיליון
    // המאפיינים כותב מאז שהוא נבנה, ושניהם קוראים אותם מ-NOTCH_DEF.
    { code: 'FX-03', id: 'fixed-notch', name: 'קבוע עם מדרגה',  origin: 'seed',
      add: { kind: 'fixed', notch: true, notchSide: 'left' } },
    // ‏hingesFor אומר באיזה צד תישען הדלת, לא איפה יֵשבו הצירים. את זה
    // המסך שואל את המנוע, ולכן הצד כאן אינו יכול לסתור אותו.
    { code: 'FX-04', id: 'fixed-hinge', name: 'קבוע נושא דלת',  origin: 'seed',
      add: { kind: 'fixed', hingesFor: 'right', carriesDoor: true } },
    // צורה אחת לדלת. "הפוך" נותן את היד השנייה, ולכן אין כאן שתי שורות
    // לאותו דבר — היו שתי הגדרות שיכולות להיפרד.
    { code: 'DR-01', id: 'door',        name: 'דלת',            origin: 'seed',
      add: { kind: 'door', hingeSide: 'right' } },
    { code: 'MR-01', id: 'mirror',      name: 'מראה',           origin: 'seed',
      add: { kind: 'mirror' } },
    { code: 'SH-01', id: 'shape',       name: 'צורה חופשית',    origin: 'seed',
      add: { kind: 'shape' } },
  ];
}

// ─── היפוך ─────────────────────────────────────────────────────────────
//
// ‏"הפוך" אינו צורה חדשה ואינו חוקיות חדשה. הוא **טרנספורמציה על ההגדרה
// הקיימת**: כל מה שמשויך לצד מתחלף, וכל השאר נשאר בדיוק כפי שהוא.
//
// לכן אין כאן שום ידע על פרזול. הצורה ההפוכה עוברת לאותו מנוע, נשפטת
// באותם כללים, ומקבלת את הזוויות והצירים שלה מאותו מקום. וריאציות
// נפרדות לימין ולשמאל בגלריה היו שתי הגדרות לאותו דבר.
//
// שים לב לשתי מוסכמות הצדדים, שהן קיימות ולא נוצרות כאן:
//   ‏hingeSide  מוסכמת המנוע — 'right' פונה לשייף הקודם במערך
//   ‏hingesFor, notchSide, holes[].x.from  צדדים על הקנבס
// שתיהן דו-ערכיות, ולכן ההיפוך זהה לשתיהן: מחליפים ימין בשמאל.

function _lgOther(side) { return side === 'left' ? 'right' : side === 'right' ? 'left' : side; }

function lgFlipAdd(add) {
  if (!add) return add;
  var out = {};
  for (var k in add) if (Object.prototype.hasOwnProperty.call(add, k)) out[k] = add[k];
  if (out.hingeSide)  out.hingeSide  = _lgOther(out.hingeSide);
  if (out.hingesFor)  out.hingesFor  = _lgOther(out.hingesFor);
  if (out.notchSide)  out.notchSide  = _lgOther(out.notchSide);
  if (out.slopeSideV) out.slopeSideV = _lgOther(out.slopeSideV);
  // שיפוע גובה אין לו "צד": הגבוה והנמוך נקבעים לפי **סדר** שני
  // המספרים — הראשון שמאל, השני ימין. שיקוף אופקי מחליף ביניהם, ולכן
  // דגל, לא ערך: המספרים עצמם באים מברירת המחדל של המסך, לא מכאן.
  // הדגל נמחק כשהוא כבוי, כדי שהיפוך כפול יחזיר בדיוק את המקור.
  // כשהמספרים עצמם שמורים, ההיפוך מחליף אותם ישירות — ואז
  // הדגל מיותר והיה מהפך פעמיים. הדגל נשאר לצורות המשוגרות,
  // שבהן המספרים באים מברירת המחדל של המסך.
  if (out.slopeH1 != null && out.slopeH2 != null) {
    var sw = out.slopeH1; out.slopeH1 = out.slopeH2; out.slopeH2 = sw;
    delete out.slopeFlip;
  } else if (out.slope) {
    if (out.slopeFlip) delete out.slopeFlip;
    else out.slopeFlip = true;
  }
  // שיפוע ברוחב הוא עליון מול תחתון, ושיקוף אופקי אינו נוגע בו
  if (Array.isArray(out.holes)) out.holes = out.holes.map(function (h) {
    return { role: h.role, dia: h.dia,
             x: { from: _lgOther(h.x.from), mm: h.x.mm },
             y: { from: h.y.from, mm: h.y.mm } };   // הגובה אינו מתהפך
  });
  return out;
}

// ההיפוך פועל על הערך כולו, כדי שהגלריה תוכל להחזיק ערך אחד ולהראות
// אותו בשתי האוריינטציות בלי לשכפל שורה.
function lgFlipEntry(entry) {
  if (!entry) return entry;
  return { id: entry.id, name: entry.name, origin: entry.origin,
           flipped: !entry.flipped, add: lgFlipAdd(entry.add) };
}

// ─── מה הקטלוג עוצר ────────────────────────────────────────────────────
//
// ערך פגום גרוע מערך חסר: הוא נראה תקין בגלריה ונשבר בהזמנה. הבדיקה
// תרוץ גם על מה שהאדמין יבנה במסך, לפני השמירה.
function lgCatalogValidate(entry) {
  var e = [];
  if (!entry || typeof entry !== 'object') return ['ערך ריק'];
  if (!entry.id)   e.push('לצורה אין מזהה');
  if (!entry.name) e.push('לצורה אין שם');

  var a = entry.add;
  if (!a || typeof a !== 'object') { e.push('לצורה אין מה להוסיף'); return e; }
  if (!LG_CAT_KINDS[a.kind]) e.push('סוג זכוכית לא מוכר: ' + a.kind);
  if (a.kind === 'door' && a.hingeSide !== 'left' && a.hingeSide !== 'right')
    e.push('לדלת חייב להיות צד ציר');
  // צד ציר על זכוכית שאינה דלת אין לו משמעות, והוא היה מטעה במסך
  if (a.kind !== 'door' && a.hingeSide) e.push('צד ציר שייך לדלת בלבד');
  // דגל שאינו מוכר היה נבלע בשקט והצורה הייתה נפתחת בלי מה שהובטח
  if (a.carriesDoor != null && typeof a.carriesDoor !== 'boolean')
    e.push('carriesDoor הוא כן או לא');
  if (a.carriesDoor === false && a.hingesFor)
    e.push('קבוע שאינו נושא דלת לא יכול לשאת צירים');
  ['hingesFor', 'notchSide', 'slopeSideV'].forEach(function (k) {
    if (a[k] && a[k] !== 'left' && a[k] !== 'right') e.push(k + ' חייב להיות ימין או שמאל');
  });
  if (a.holes && !Array.isArray(a.holes)) e.push('הקדחים אינם רשימה');
  (Array.isArray(a.holes) ? a.holes : []).forEach(function (h, i) {
    var at = 'קדח ' + (i + 1) + ': ';
    if (!h || !LG_CAT_OWN_ROLES[h.role]) { e.push(at + 'תפקיד שאינו נשמר על הצורה'); return; }
    if (!(h.dia > 0)) e.push(at + 'קוטר חייב להיות גדול מאפס');
    if (!h.x || !(h.x.mm >= 0)) e.push(at + 'מרחק מהפאה חסר');
    if (!h.y || !(h.y.mm >= 0)) e.push(at + 'מרחק מהקצה חסר');
  });
  // מידה שנשמרה חייבת להיות מספר חיובי. אפס או טקסט היו נראים
  // תקינים בגלריה ומחזירים צורה אחרת בהזמנה.
  LG_CAT_NUMS.forEach(function (k) {
    if (a[k] != null && !(typeof a[k] === 'number' && a[k] > 0))
      e.push(k + ' חייב להיות מספר גדול מאפס');
  });
  if (a.slopeSideH && a.slopeSideH !== 'top' && a.slopeSideH !== 'bottom')
    e.push('slopeSideH חייב להיות תקרה או רצפה');
  // שיפוע צריך **שני** מספרים שונים זה מזה, אחרת המנוע לא מצייר
  // אותו בכלל — והכרטיס מבטיח צורה שלא תגיע.
  if ((a.slopeH1 != null) !== (a.slopeH2 != null))
    e.push('לשיפוע בגובה דרושים שני גבהים');
  if (a.slopeH1 != null && a.slopeH1 === a.slopeH2)
    e.push('שני גבהי השיפוע זהים — אין שיפוע');
  if ((a.slopeW1 != null) !== (a.slopeW2 != null))
    e.push('לשיפוע ברוחב דרושים שני רוחבים');
  if (a.slopeW1 != null && a.slopeW1 === a.slopeW2)
    e.push('שני רוחבי השיפוע זהים — אין שיפוע');
  // מדרגה היא רוחב וגובה יחד; אחד מהם לבדו אינו פינוי
  if ((a.notchW != null) !== (a.notchH != null))
    e.push('למדרגה דרושים רוחב וגובה');

  Object.keys(a).forEach(function (k) {
    if (k !== 'kind' && k !== 'hingeSide' && !LG_CAT_FLAGS[k])
      e.push('דגל לא מוכר: ' + k);
  });
  return e;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_CAT_VERSION: LG_CAT_VERSION, LG_CAT_KINDS: LG_CAT_KINDS,
                     LG_CAT_NUMS: LG_CAT_NUMS, LG_CAT_FLAGS: LG_CAT_FLAGS,
                     LG_CAT_OWN_ROLES: LG_CAT_OWN_ROLES, lgShapeCode: lgShapeCode,
                     lgCatalogSeeds: lgCatalogSeeds,
                     lgFlipAdd: lgFlipAdd, lgFlipEntry: lgFlipEntry,
                     lgCatalogValidate: lgCatalogValidate };
}
