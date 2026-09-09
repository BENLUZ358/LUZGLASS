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
var LG_CAT_FLAGS = { slope: 1, notch: 1 };

function lgCatalogSeeds() {
  return [
    { id: 'fixed',       name: 'קבוע',           origin: 'seed',
      add: { kind: 'fixed' } },
    { id: 'fixed-slope', name: 'קבוע משופע',      origin: 'seed',
      add: { kind: 'fixed', slope: true } },
    // המדרגה אינה הגדרה חדשה: אלה בדיוק המספרים שהמתג בגיליון
    // המאפיינים כותב מאז שהוא נבנה, ושניהם קוראים אותם מ-NOTCH_DEF.
    { id: 'fixed-notch', name: 'קבוע עם מדרגה',   origin: 'seed',
      add: { kind: 'fixed', notch: true } },
    { id: 'door-right',  name: 'דלת · ציר ימין',  origin: 'seed',
      add: { kind: 'door', hingeSide: 'right' } },
    { id: 'door-left',   name: 'דלת · ציר שמאל',  origin: 'seed',
      add: { kind: 'door', hingeSide: 'left' } },
    { id: 'mirror',      name: 'מראה',            origin: 'seed',
      add: { kind: 'mirror' } },
    { id: 'shape',       name: 'צורה חופשית',     origin: 'seed',
      add: { kind: 'shape' } },
  ];
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
  Object.keys(a).forEach(function (k) {
    if (k !== 'kind' && k !== 'hingeSide' && !LG_CAT_FLAGS[k])
      e.push('דגל לא מוכר: ' + k);
  });
  return e;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_CAT_VERSION: LG_CAT_VERSION, LG_CAT_KINDS: LG_CAT_KINDS,
                     lgCatalogSeeds: lgCatalogSeeds,
                     lgCatalogValidate: lgCatalogValidate };
}
