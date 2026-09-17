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
// ‏**אקורדיון.** ציר הרמוניקה הוא סוג ציר, לא פרזול אחר: אותו סמל,
// אותו מיקום 20/20, אותה ספירה לצומת. מה ששונה הוא **אל מה מותר לו
// להתחבר**, ולכן הוא תווית פאה משלו ולא דגל צדדי.
//
// ‏**דלת יכולה לשאת צירים בשתי הפאות.** עד היום הנחנו שלכל דלת
// צירים בצד אחד וידית בשני, וזה נכון לכל מקלחון רגיל — אבל באקורדיון
// הדלת האמצעית תלויה מצד אחד ומתקפלת מהשני. לכן ההרמוניקה
// מוצהרת בשדה נפרד — 'left', 'right' או 'both' — ואינה דורסת את hingeSide.
//
// שתי המוסכמות זהות: 'right' פונה לשייף הקודם במערך, 'left' לבא אחריו.
function _lgHarmonicaOn(shape, side) {
  var h = shape && shape.harmonicaSide;
  return h === 'both' || h === side;
}

// מי עומד בפאה side של השייף idx. אותה נוסחה בדיוק ששוכנת כבר בתוך
// לולאת האקורדיון — כאן שם, כדי שאפשר לשאול אותה גם על הפאה השנייה.
function _lgSideNeighbor(shapes, bound, idx, side) {
  return side === 'right'
    ? (idx === 0 ? (bound.right === 'wall' ? 'wall' : null) : shapes[idx - 1])
    : (idx === shapes.length - 1 ? (bound.left === 'wall' ? 'wall' : null) : shapes[idx + 1]);
}

function _lgEdge(shape, side) {
  if (!shape) return 'wall';
  if (shape.kind && _LG_FREE[shape.kind]) return 'free';
  if (shape.kind !== 'door') return shape.carriesDoor === false ? 'fixed-solo' : 'fixed';
  if (_lgHarmonicaOn(shape, side)) return 'hinge-h';
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
  // ⚠️ ‏_lgPairKey **ממיין** את שני הצדדים לפני החיפוש, ולכן המפתח חייב
  // להיכתב בסדר הממוין. שניים כאן נכתבו הפוך ומעולם לא נמצאו: קבוע
  // "זוויות בלבד" ליד קבוע רגיל יצא בלי שום זווית ביניהם, בזמן ששניים
  // כאלה זה לצד זה כן קיבלו — אותו מקרה, שתי התנהגויות.
  'fixed-solo|wall':       { type: 'bracket-wall', qty: 2 },
  'fixed|fixed-solo':      { type: 'bracket-gg',   qty: 2 },
  'fixed-solo|fixed-solo': { type: 'bracket-gg',   qty: 2 },
  'fixed-solo|handle':     { type: null,           qty: 0 },
  'fixed-solo|hinge':      { type: null,           qty: 0 },   // חסום ב-lgValidate
  'fixed-solo|free':       { type: null,           qty: 0 },
  'hinge|hinge':   { type: null,           qty: 0 },   // חסום ב-lgValidate
  // זכוכית חופשית אינה מתחברת לכלום, לא לקיר ולא לשכנתה
  'free|wall':     { type: null,           qty: 0 },
  'free|free':     { type: null,           qty: 0 },
  'fixed|free':    { type: null,           qty: 0 },
  'free|hinge':    { type: null,           qty: 0 },
  'free|handle':   { type: null,           qty: 0 },

  // ── הרמוניקה ───────────────────────────────────────────────────
  //
  // אותו פרזול בדיוק — hinge-gg ו-hinge-wall — בווריאנט אחר.
  // הווריאנט יושב **בטבלה** ולא נגזר בליקוט, כדי שלא יהיה
  // צורך בתנאי "אם הרמוניקה" בעוד מקום.
  //
  // ציר אחד עובר בשתי הזכוכיות ולכן יש לו שני פינויים — אחד
  // בכל זכוכית — ובליקוט הוא **ציר אחד**. הספירה לפי צומת
  // כבר עושה בדיוק את זה, ולכן qty 2 הוא עליון ותחתון.
  'fixed|hinge-h':   { type: 'hinge-gg',   qty: 2, variant: 'harmonica' },
  'hinge-h|hinge-h': { type: 'hinge-gg',   qty: 2, variant: 'harmonica' },
  // מול קיר — **רק באקורדיון שכולו מתקפל**, ולזה דואגת lgValidate.
  // הטבלה אומרת מה הפרזול כשזה חוקי; הולידציה אומרת מתי.
  'hinge-h|wall':    { type: 'hinge-wall', qty: 2, variant: 'harmonica' },
  // צומת אחד הוא פיסת מתכת אחת. שתי הזכוכיות חייבות להסכים
  // על סוג הציר; אחת שאומרת רגיל ואחת הרמוניקה היא סתירה.
  'hinge|hinge-h':      { type: null, qty: 0 },   // חסום ב-lgValidate
  'handle|hinge-h':     { type: null, qty: 0 },   // חסום ב-lgValidate
  'fixed-solo|hinge-h': { type: null, qty: 0 },   // חסום ב-lgValidate
  'free|hinge-h':       { type: null, qty: 0 },   // חסום ב-lgValidate
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
      // סוג הציר נקבע במפגש ולכן הוא נוסע על הצומת,
      // ומשם הליקוט והציור קוראים אותו — שניהם מאותו מקום.
      variant: rule.variant || null,
    });
  }
  return out;
}

// ─── מה המנוע עוצר ──────────────────────────────────────────────────────
//
// ההודעה נושאת את מזהה השייף, כדי שהמסך יוכל להצביע עליו.
// "דלת לא יושבת על דלת" חל **רק על צד הציר**: שתי דלתות שנפגשות ידית מול
// ידית הן קומבינציה לגיטימית וקיימת — כל דלת נתלית על הקבוע שלה.
// האם האקורדיון שהדלת הזאת שייכת אליו נתלה על הקיר **בציר**
// ולא יושב על קבוע. הולכים אחורה בשרשרת הדלתות עד לקצה:
// אם הגענו לקיר — זה אקורדיון של דלתות; אם הגענו לקבוע — לא.
function _lgAccordionOnWall(shapes, bound, i) {
  var seen = {};
  var cur = i;
  while (cur >= 0 && cur < shapes.length && !seen[cur]) {
    seen[cur] = 1;
    var d = shapes[cur];
    if (!d || d.kind !== 'door') return false;
    // הצד שבו הדלת תלויה: hingeSide אם יש, אחרת צד ההרמוניקה
    var side = d.hingeSide === 'left' ? 'left'
             : d.hingeSide === 'right' ? 'right'
             : (d.harmonicaSide === 'left' ? 'left' : 'right');
    var j = side === 'right' ? cur - 1 : cur + 1;
    if (j < 0 || j >= shapes.length) return bound[side === 'right' ? 'right' : 'left'] === 'wall';
    cur = j;
  }
  return false;
}

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
      // ‏**החריג היחיד.** באקורדיון דלת מתקפלת אל הדלת שלפניה, וזה
      // בדיוק "דלת על דלת". החוק נפתח במידה אחת בלבד: **רק כשהציר
      // ביניהן הוא הרמוניקה** — ושתיהן חייבות להסכים על כך.
      var bothSay = _lgHarmonicaOn(sh, side) &&
                    _lgHarmonicaOn(neighbour, side === 'right' ? 'left' : 'right');
      if (!bothSay)
        errors.push({ at: sh.id, msg: 'דלת לא יכולה להיתלות על דלת — אלא אם הציר ביניהן הוא הרמוניקה' });
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
  // ══════════════ אקורדיון ══════════════
  //
  // כל מה שמיוחד להרמוניקה יושב כאן, במקום אחד, ולא מפוזר
  // בצייר ובמסך. מי שיוסיף סוג ציר נוסף ידע איפה לכתוב.
  var folding = [];
  for (var h = 0; h < shapes.length; h++) {
    var d = shapes[h];
    if (!d || d.kind !== 'door' || !d.harmonicaSide) continue;
    folding.push(h);

    var sides = d.harmonicaSide === 'both' ? ['right', 'left'] : [d.harmonicaSide];
    for (var q = 0; q < sides.length; q++) {
      var sd = sides[q];
      // מי עומד מול הפאה הזאת. 'right' פונה לשייף הקודם במערך.
      var nIdx = sd === 'right' ? h - 1 : h + 1;
      var n = _lgSideNeighbor(shapes, bound, h, sd);

      // ‏קצה פתוח (לא קיר, ואין שם עוד זכוכית) אינו שגיאה — הוא פשוט טרם
      // נבנה. בהוספה אחת-אחת הדלת המתקפלת הראשונה יושבת לבדה לרגע, לפני
      // שהשותפה שלה נוספת, ואי אפשר לפסול אותה על שכנה שעוד לא הגיע
      // תורה. ברגע שמשהו כן ייבנה שם, הבדיקות שלמטה ישפטו אותו.
      if (!n) continue;

      // ‏**הרמוניקה לא מגיעה לקיר** — חוץ ממקרה אחד: אקורדיון
      // שכולו מתקפל, שבו אותה דלת נושאת הרמוניקה גם בפאה שמול.
      // זו תצורה נדירה וקיימת, ולכן היא חריג מפורש ולא פרצה.
      if (n === 'wall' && d.harmonicaSide !== 'both') {
        errors.push({ at: d.id, msg: 'ציר הרמוניקה לא מתחבר לקיר — רק לזכוכית' });
        continue;
      }
      if (n === 'wall') continue;

      if (_LG_FREE[n.kind]) {
        errors.push({ at: d.id, msg: 'ציר הרמוניקה לא מתחבר לזכוכית חופשית' });
        continue;
      }
      if (n.kind !== 'door' && n.carriesDoor === false) {
        errors.push({ at: d.id, msg: 'הקבוע נבחר עם זוויות בלבד — אין עליו הכנה לצירים' });
        continue;
      }

      if (n.kind === 'door') {
        // צומת אחד הוא פיסת מתכת אחת: שתי הזכוכיות חייבות להסכים על סוגו
        if (!_lgHarmonicaOn(n, sd === 'right' ? 'left' : 'right')) {
          errors.push({ at: d.id, msg: 'שתי הזכוכיות חייבות להסכים על סוג הציר — הרמוניקה בצד אחד בלבד' });
          continue;
        }
        // ‏**אותו גובה.** שתי דלתות שמתקפלות זו על זו ואינן באותו
        // גובה הן מקלחון עקום. כאן אין חוק קבוע-מול-דלת — אלה שתי דלתות.
        var ha = Number(d.h) || 0, hb = Number(n.h) || 0;
        if (ha && hb && ha !== hb) {
          errors.push({ at: d.id, msg: 'שתי דלתות שמחוברות בהרמוניקה חייבות להיות באותו גובה' });
        }

        // ‏**שני חלקים, קצה אחד לקיר.** הזוג נפתח בכיוון אחד — הפאה
        // שממנה d נתלה על הקיר (אם יש) היא העוגן היחיד שמחזיק את כל
        // הזוג. הפאה המקבילה ב-n, שאינה ההרמוניקה שביניהם, היא הקצה
        // החופשי שנפתח — ובנוי אי אפשר לתלות אותה גם היא על קיר, כמו
        // מנוף שמחובר משני קצותיו ולא יכול לזוז. ‏d < n בודק את הזוג
        // פעם אחת, לא פעמיים משני הכיוונים.
        if (d.harmonicaSide !== 'both' && n.harmonicaSide !== 'both' && h < nIdx) {
          var dOtherSide = sd === 'right' ? 'left' : 'right';
          var nOtherSide = sd; // הפאה של n שאינה פונה ל-d היא אותו כיוון כמו sd, נמדד מ-n
          var dOther = _lgSideNeighbor(shapes, bound, h, dOtherSide);
          var nOther = _lgSideNeighbor(shapes, bound, nIdx, nOtherSide);
          if (dOther === 'wall' && nOther === 'wall') {
            errors.push({ at: d.id,
              msg: 'שני חלקי ההרמוניקה תלויים על קיר משני הקצוות — הזוג לא יכול להיפתח, לקצה אחד חייב להיות חופשי' });
          }
        }
      }
    }

    // שיפוע — רק באקורדיון שנתלה על הקיר בציר, לא בזה שיושב על קבוע
    var sloped = (d.slopeH1 > 0 && d.slopeH2 > 0 && d.slopeH1 !== d.slopeH2) ||
                 (d.slopeW1 > 0 && d.slopeW2 > 0 && d.slopeW1 !== d.slopeW2);
    if (sloped && !_lgAccordionOnWall(shapes, bound, h)) {
      errors.push({ at: d.id, msg: 'שיפוע באקורדיון מותר רק כשהוא נתלה על הקיר בציר' });
    }
  }

  // ‏**עד שתי דלתות מתקפלות.** בסוף הכול נשען על צירי הקיר,
  // והם מוגבלים במשקל. זו מגבלה של חומרה, לא של ציור.
  if (folding.length > 2) {
    errors.push({ at: shapes[folding[2]].id,
                  msg: 'עד שתי דלתות מתקפלות — צירי הקיר מוגבלים במשקל' });
  }

  // ══════════════ פינוי חופשי מול פאה משופעת/מדורגת ══════════════
  //
  // הפינוי החופשי נמדד מהתיבה החוסמת של הזכוכית, לא מהפאה — כך מודדים
  // בשטח (ר' lgLayout). אבל שיפוע או פינוי מדרגה על אותה פאה גורעים
  // משולש מהזכוכית האמיתית, שהתיבה החוסמת לא יודעת עליו. פינוי שנופל
  // שם מבקש זכוכית שלא קיימת, ובלי הבדיקה הזאת זה מתגלה רק כשהזכוכית
  // מגיעה חתוכה לא נכון. ‏lgOutline כבר בונה את המתאר האמיתי ובודק מולו
  // — כאן רק מתרגמים לשגיאה, במקום אחד שהמסך כבר קורא ממנו.
  if (typeof lgOutline === 'function') {
    var outlines = lgOutline(shower);
    for (var oi = 0; oi < outlines.length; oi++) {
      var ol = outlines[oi];
      if (ol.cutoutErrors && ol.cutoutErrors.length) {
        errors.push({ at: ol.id,
          msg: 'פינוי חופשי חורג מהזכוכית — הפאה משופעת או במדרגה שם, ואין שם זכוכית למדוד ממנה' });
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
    // הווריאנט של הצומת גובר — הרמוניקה נקבעת במפגש ולא
    // בהעדפה של לוח בודד. ההעדפה נשארת למי שבוחר גימור אחר.
    add(j.type, j.variant || (isBracket ? owner.bracketVariant : owner.hingeVariant), qty);
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

  // ── מה שנוגע במקלחון כולו ─────────────────────────────────────────
  //
  // מוט חיזוק ומעטפת שחורה הם **בקשת לקוח שאין עליה חוקיות**. המנוע
  // אינו מחליט עליהם ואינו מציע אותם — הוא רק סופר מה שנבחר.
  //
  // שניהם על ההרכבה ולא על לוח בודד, כמו שהם נבחרים — בבחירת
  // הפרזול, שהיא של המקלחון כולו. מספר מתקבל כמות, כדי שמקלחון
  // גדול שצריך שני מוטות לא יחייב שינוי במנוע.
  if (shower.supportBar) add('support-bar', null, Number(shower.supportBar) || 1);
  if (shower.blackTrim)  add('black-trim',  null, Number(shower.blackTrim)  || 1);

  // ── גומיות ───────────────────────────────────────────────────────
  //
  // כל מקלחון מקבל מגב רצפה ומגנט — פינתי או ישר, תלוי במקלחון.
  // **החוקיות שקובעת איזה מגנט עוד לא נבנתה**, ולכן אין כאן ניחוש:
  // מה שנבחר במפורש נספר, ומה שלא — לא. כשהכלל ייקבע, זה המקום היחיד
  // שצריך לגעת בו.
  if (shower.seals) {
    var seals = shower.seals;
    if (seals.floorWiper) add('seal-floor-wiper', null, Number(seals.floorWiper) || 1);
    if (seals.magnet === 'corner')   add('seal-magnet-corner', null, 1);
    if (seals.magnet === 'straight') add('seal-magnet-straight', null, 1);
  }

  var out = [];
  for (var key2 in lines) if (lines.hasOwnProperty(key2)) out.push(lines[key2]);
  return out;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { lgJunctions: lgJunctions, lgValidate: lgValidate, lgBOM: lgBOM };
