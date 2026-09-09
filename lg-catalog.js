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
                     notchSide: 1, slopeSideV: 1, slopeFlip: 1 };

// תפקידי קדחים שצורה רשאית לשאת בעצמה. **תפקידי צומת אינם כאן**: ציר
// וזווית קיר נגזרים ממה שהזכוכית נפגשת איתו, ולתת להם להיכתב ביד היה
// מחזיר בדיוק את הסתירה שהפילה את הגרסה הקודמת. זווית רצפה וקדח חופשי
// אינם נובעים משום מפגש, ולכן רק הם מוצהרים.
var LG_CAT_OWN_ROLES = { 'bracket-floor': 20, 'hole': 12 };

function lgCatalogSeeds() {
  return [
    { id: 'fixed',       name: 'קבוע',           origin: 'seed',
      add: { kind: 'fixed' } },
    { id: 'fixed-slope', name: 'קבוע משופע',     origin: 'seed',
      add: { kind: 'fixed', slope: true } },
    // המדרגה אינה הגדרה חדשה: אלה בדיוק המספרים שהמתג בגיליון
    // המאפיינים כותב מאז שהוא נבנה, ושניהם קוראים אותם מ-NOTCH_DEF.
    { id: 'fixed-notch', name: 'קבוע עם מדרגה',  origin: 'seed',
      add: { kind: 'fixed', notch: true, notchSide: 'left' } },
    // ‏hingesFor אומר באיזה צד תישען הדלת, לא איפה יֵשבו הצירים. את זה
    // המסך שואל את המנוע, ולכן הצד כאן אינו יכול לסתור אותו.
    { id: 'fixed-hinge', name: 'קבוע נושא דלת',  origin: 'seed',
      add: { kind: 'fixed', hingesFor: 'right' } },
    // צורה אחת לדלת. "הפוך" נותן את היד השנייה, ולכן אין כאן שתי שורות
    // לאותו דבר — היו שתי הגדרות שיכולות להיפרד.
    { id: 'door',        name: 'דלת',            origin: 'seed',
      add: { kind: 'door', hingeSide: 'right' } },
    { id: 'mirror',      name: 'מראה',           origin: 'seed',
      add: { kind: 'mirror' } },
    { id: 'shape',       name: 'צורה חופשית',    origin: 'seed',
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
  if (out.slope) {
    if (out.slopeFlip) delete out.slopeFlip;
    else out.slopeFlip = true;
  }
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
  Object.keys(a).forEach(function (k) {
    if (k !== 'kind' && k !== 'hingeSide' && !LG_CAT_FLAGS[k])
      e.push('דגל לא מוכר: ' + k);
  });
  return e;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_CAT_VERSION: LG_CAT_VERSION, LG_CAT_KINDS: LG_CAT_KINDS,
                     lgCatalogSeeds: lgCatalogSeeds,
                     lgFlipAdd: lgFlipAdd, lgFlipEntry: lgFlipEntry,
                     lgCatalogValidate: lgCatalogValidate };
}
