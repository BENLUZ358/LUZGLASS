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
// ‏free הוא זכוכית שאינה חלק מהרכבת המקלחון — צורה חופשית או מראה.
// היא אינה נושאת פרזול ואינה נושאת דבר, ולכן שום צומת שלה אינו מייצר
// פריט. עד עכשיו כל מה שאינו דלת נחשב קבוע, וצורה חופשית קיבלה זוויות
// קיר שאיש לא ביקש — בדיוק מה שנראה על המסך.
var _LG_FREE = { shape: 1, mirror: 1, panel: 1 };

// ‏carriesDoor === false אומר: הקבוע הזה נבחר **עם זוויות בלבד**. אין
// עליו הכנה לצירים, ולכן דלת לא יכולה להיתלות עליו. זו הצהרה מפורשת של
// מי שבחר את הצורה, ולכן היא נשמרת בערך עצמו.
//
// ‏undefined הוא לא "לא": קומבינציות, מצב פריט וסקיצות שנשמרו בעבר אינם
// מצהירים כלום, והם ממשיכים להתנהג כפי שהתנהגו תמיד. רק מי שאמר במפורש
// "בלי צירים" מקבל את הסירוב.
function _lgEdge(shape, side) {
  if (!shape) return 'wall';
  if (shape.kind && _LG_FREE[shape.kind]) return 'free';
  if (shape.kind !== 'door') return shape.carriesDoor === false ? 'fixed-solo' : 'fixed';
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
  // קבוע שנבחר "זוויות בלבד". זהה לקבוע בכל דבר — פרט לציר, שאין לו
  // עליו הכנה. הצומת מול ציר חסום ב-lgValidate ולכן אינו מייצר פרזול.
  'fixed-solo|wall':       { type: 'bracket-wall', qty: 2 },
  'fixed-solo|fixed':      { type: 'bracket-gg',   qty: 2 },
  'fixed-solo|fixed-solo': { type: 'bracket-gg',   qty: 2 },
  'fixed-solo|handle':     { type: null,           qty: 0 },
  'fixed-solo|hinge':      { type: null,           qty: 0 },   // חסום ב-lgValidate
  'free|fixed-solo':       { type: null,           qty: 0 },
  'hinge|hinge':   { type: null,           qty: 0 },   // חסום ב-lgValidate
  // זכוכית חופשית אינה מתחברת לכלום, לא לקיר ולא לשכנתה
  'free|wall':     { type: null,           qty: 0 },
  'free|free':     { type: null,           qty: 0 },
  'free|fixed':    { type: null,           qty: 0 },
  'free|hinge':    { type: null,           qty: 0 },
  'free|handle':   { type: null,           qty: 0 },
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
    } else if (neighbour.carriesDoor === false) {
      errors.push({ at: sh.id, msg: 'הקבוע נבחר עם זוויות בלבד — אין עליו הכנה לצירים' });
    } else if (_LG_FREE[neighbour.kind]) {
      errors.push({ at: sh.id, msg: 'דלת לא יכולה להיתלות על זכוכית חופשית — נדרש קבוע או קיר' });
    }
  }

  // קבוע נושא את עצמו רק אם הוא נשען על משהו — קיר או קבוע אחר. קבוע
  // שיושב בין שתי דלתות לא מחובר לכלום: הצירים של שתי הדלתות נתלים
  // עליו, ואין לו עצמו על מה להתברג.
  for (var k = 0; k < shapes.length; k++) {
    var fx = shapes[k];
    if (!fx || fx.kind === 'door') continue;
    // זכוכית חופשית עומדת בפני עצמה — אין לה פרזול ואין מי שנתלה עליה,
    // ולכן החוק שדורש מקבוע להישען אינו חל עליה.
    if (_LG_FREE[fx.kind]) continue;
    var left  = k === 0 ? (bound.right === 'wall' ? 'wall' : null) : shapes[k - 1];
    var right = k === shapes.length - 1 ? (bound.left === 'wall' ? 'wall' : null) : shapes[k + 1];
    var held = [left, right].some(function (n) {
      return n === 'wall' || (n && n.kind && n.kind !== 'door' && !_LG_FREE[n.kind]);
    });
    if (!held) {
      errors.push({ at: fx.id, msg: 'קבוע חייב להישען על קיר או על קבוע — הוא לא יכול לשבת בין שתי דלתות' });
    }

    // פינוי מדרגה הוא חלק מהבנייה, ולכן הוא תמיד בצד הקיר. פינוי בפאה
    // שדלת נתלית עליה משאיר לציר התחתון אוויר במקום זכוכית.
    if (fx.notchW > 0 && fx.notchH > 0) {
      var nSide = fx.notchSide === 'right' ? 'right' : (fx.notchSide === 'left' ? 'left' : null);
      if (!nSide) nSide = (left === 'wall') ? 'left' : (right === 'wall') ? 'right' : 'left';
      var nb = nSide === 'left' ? left : right;
      if (nb && nb !== 'wall' && nb.kind === 'door') {
        errors.push({ at: fx.id, msg: 'פינוי מדרגה לא יכול להיות בצד שהדלת נתלית עליו — המדרגה באה מצד הקיר' });
      }
      if (nb !== 'wall' && !fx.notchSide) {
        errors.push({ at: fx.id, msg: 'פינוי מדרגה בקבוע שאינו נוגע בקיר — יש לציין באיזה צד' });
      }
      // הפינוי חייב להיכנס בתוך הזכוכית, ומה שנשאר לצידו חייב להתיישב
      // עם הרוחב הכללי. רוחב נותר גדול מהזכוכית עצמה דוחף את הפינוי
      // אל מחוץ לפאנל, ובציור זה נראה כמו זכוכית שברחה מהמקום.
      var gw = fx.w || 0, gh = fx.h || 0;
      if (gw && fx.notchW >= gw) {
        errors.push({ at: fx.id, msg: 'פינוי המדרגה רחב מהזכוכית' });
      }
      if (gh && fx.notchH >= gh) {
        errors.push({ at: fx.id, msg: 'פינוי המדרגה גבוה מהזכוכית' });
      }
      if (gw && fx.notchRest > 0 && fx.notchRest + fx.notchW > gw + 20) {
        errors.push({ at: fx.id, msg: 'הרוחב שנשאר ליד הפינוי גדול מדי — יחד עם הפינוי הוא חורג מרוחב הזכוכית' });
      }
    }
  }
  return errors;
}

// ─── הליקוט ─────────────────────────────────────────────────────────────
//
// קורא את lgJunctions ולא מחשב צמתים בעצמו. ברגע שהליקוט והציור מחשבים
// כל אחד לחוד, שתי הגרסאות מתפצלות — והפער נשאר בלתי נראה עד שהמספר
// השגוי מגיע למחסן. אותה תבנית כמו LG_TRACK ב-workday.html: מנוע אחד,
// שני צרכנים.
//
// מחזיר **סוגים, לא מק"טים**. זו ההחלטה הארכיטקטונית החשובה במסמך
// התכנון: מק"ט בתוך המנוע היה קושר אותו לקטלוג ולמותג הפרזול של לקוח
// מסוים, וקבלן שעובד עם פרזול אחר היה מחייב שינוי במנוע. המיפוי
// (סוג, וריאנט) × (גימור, איכות) → מק"ט הוא שכבה נפרדת.
//
// המערכת גוזרת **סוג**; הקבלן בוחר **כמה**. "שלושה צירים" אינו כלל אלא
// החלטה, ולכן הכמות נקראת מהשייף ולא מהטבלה.
function lgBOM(shower) {
  if (!shower) return [];
  var shapes  = shower.shapes || [];
  var finish  = shower.finish  || '';
  var quality = shower.quality || '';

  var byId = {};
  for (var i = 0; i < shapes.length; i++) byId[shapes[i].id] = shapes[i];

  var lines = {};
  function add(type, variant, qty) {
    if (!type || !qty) return;
    var v = variant || 'regular';
    var key = type + '|' + v;
    if (!lines[key]) lines[key] = { type: type, variant: v, finish: finish, quality: quality, qty: 0 };
    lines[key].qty += qty;
  }

  var js = lgJunctions(shower);
  for (var k = 0; k < js.length; k++) {
    var j = js[k];
    if (!j.type) continue;
    // הבחירה יושבת על השייף שנוגע בצומת, ולא על הצומת עצמו — הצומת נגזר
    // ולכן אין לו איפה לשאת העדפה.
    var owner = byId[j.between[0]] || byId[j.between[1]] || {};
    var isBracket = j.type.indexOf('bracket') === 0;
    var qty = isBracket
      ? (Number(owner.wallBracketQty) || j.qty)
      : (Number(owner.hingeQty) || j.qty);
    add(j.type, isBracket ? owner.bracketVariant : owner.hingeVariant, qty);
  }

  // ידית לכל דלת. היא נגזרת מצד הציר — תמיד בצד ההפוך — ולעולם לא נבחרת,
  // ולכן אין לה צומת משלה.
  // מחזיק רצפה, לעומת זאת, הוא בחירה מפורשת של הקבלן.
  for (var m = 0; m < shapes.length; m++) {
    var sh = shapes[m];
    if (!sh) continue;
    if (sh.kind === 'door') add('handle', sh.handleVariant, 1);
    if (sh.floorBracket)    add('bracket-floor', null, 1);
  }

  var out = [];
  for (var key2 in lines) if (lines.hasOwnProperty(key2)) out.push(lines[key2]);
  return out;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { lgJunctions: lgJunctions, lgValidate: lgValidate, lgBOM: lgBOM };
