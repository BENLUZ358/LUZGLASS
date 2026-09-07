// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-shapes.js  v1.0
//  מנוע חוקי הפרזול. טהור: בלי DOM, בלי קנבס, בלי Firebase.
// ════════════════════════════════════════════════════════════════════════
//
//  החוקים היו תמיד כאן — הם היו כלואים בתוך הצייר. drawSinglePanel גם
//  החליט שקבוע על קיר לוקח ארבע זוויות וגם צייר אותן, ולכן אי אפשר היה
//  לגזור ליקוט בלי לכתוב את אותם חוקים פעם שנייה. שתי גרסאות מתפצלות,
//  והפער נגלה רק כשהמספר השגוי מגיע למחסן.
//
//  העיקרון: **הפרזול שייך לצומת, לא לשייף.** הציר שבין הקבוע לדלת הוא
//  חתיכה אחת ששייכת לשניהם — לא ציר לקבוע ועוד ציר לדלת. ספירה לכל שייף
//  בנפרד נותנת 6 במקום 4 בכל מקלחון.
//
//     קיר │ קבוע │ דלת │ קיר
//         ↑      ↑     ↑
//        צומת   צומת  צומת
//
//  כל שייף מצהיר מה הקצה שלו צריך; הצומת גוזר את הפרזול בפועל, פעם אחת.

// ─── קצה של שייף כפי שהוא נראה לצומת שלידו ──────────────────────────────
//
// לדלת שני קצוות שונים: קצה-ציר וקצה-ידית. השייף מצהיר באיזה צד הוא
// נתלה, והידית **נגזרת** מזה — תמיד בצד ההפוך. אין שדה שאפשר לשים בו
// ידית בצד הציר, ולכן אי אפשר לטעות.
function _lgEdge(shape, side) {
  if (!shape) return 'wall';
  if (shape.kind !== 'door') return 'fixed';
  return shape.hingeSide === side ? 'hinge' : 'handle';
}

// טבלת הצמתים. המפתח ממוין, כך ששני הכיוונים נותנים את אותה תשובה.
var _LG_JUNCTION = {
  'fixed|wall':    { type: 'bracket-wall', qty: 2 },
  'fixed|fixed':   { type: 'bracket-gg',   qty: 2 },
  'fixed|hinge':   { type: 'hinge-gg',     qty: 2 },
  'hinge|wall':    { type: 'hinge-wall',   qty: 2 },
  'handle|wall':   { type: null,           qty: 0 },   // ידית מול קיר — כלום
  'handle|handle': { type: null,           qty: 0 },   // שתי דלתות נפגשות
  'fixed|handle':  { type: null,           qty: 0 },
  'hinge|hinge':   { type: null,           qty: 0 },   // חסום ב-lgValidate
};

function _lgPairKey(a, b) { return [a, b].sort().join('|'); }

// ─── הצמתים ─────────────────────────────────────────────────────────────
//
// כל הרווחים לאורך המקלחון, מקצה לקצה: קיר, שייף, שייף, ..., קיר.
// n שייפים נותנים n+1 צמתים.
function lgJunctions(shower) {
  if (!shower) return [];
  var shapes = shower.shapes || [];
  var bound  = shower.boundary || { right: 'wall', left: 'wall' };
  var out = [];
  for (var i = 0; i <= shapes.length; i++) {
    var left  = i === 0 ? null : shapes[i - 1];
    var right = i === shapes.length ? null : shapes[i];
    var leftEdge  = left  ? _lgEdge(left, 'left')
                          : (bound.right === 'wall' ? 'wall' : 'open');
    var rightEdge = right ? _lgEdge(right, 'right')
                          : (bound.left === 'wall' ? 'wall' : 'open');
    var rule = _LG_JUNCTION[_lgPairKey(leftEdge, rightEdge)] || { type: null, qty: 0 };
    out.push({
      between: [left ? left.id : 'wall', right ? right.id : 'wall'],
      type: rule.type,
      qty:  rule.qty,
    });
  }
  return out;
}

// ─── מה המנוע עוצר ──────────────────────────────────────────────────────
//
// ההודעה נושאת את מזהה השייף, כדי שהמסך יוכל להצביע עליו.
// "דלת לא יושבת על דלת" חל **רק על צד הציר**: שתי דלתות שנפגשות ידית מול
// ידית הן קומבינציה לגיטימית וקיימת — כל דלת נתלית על הקבוע שלה.
function lgValidate(shower) {
  if (!shower) return [];
  var shapes = shower.shapes || [];
  var bound  = shower.boundary || { right: 'wall', left: 'wall' };
  var errors = [];
  for (var i = 0; i < shapes.length; i++) {
    var sh = shapes[i];
    if (!sh || sh.kind !== 'door') continue;
    var side = sh.hingeSide === 'left' ? 'left' : 'right';
    // מי יושב בצד שממנו הדלת נתלית
    var neighbour;
    if (side === 'right') {
      neighbour = i === 0 ? (bound.right === 'wall' ? 'wall' : null) : shapes[i - 1];
    } else {
      neighbour = i === shapes.length - 1 ? (bound.left === 'wall' ? 'wall' : null) : shapes[i + 1];
    }
    if (!neighbour) {
      errors.push({ at: sh.id, msg: 'לדלת אין על מה להיתלות — נדרש קבוע או קיר' });
      continue;
    }
    if (neighbour === 'wall') continue;
    if (neighbour.kind === 'door') {
      errors.push({ at: sh.id, msg: 'דלת לא יכולה להיתלות על דלת' });
    }
  }
  return errors;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { lgJunctions: lgJunctions, lgValidate: lgValidate };
