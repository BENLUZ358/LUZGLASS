// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-catalog.js  v1.0
//  ספריית הצורות. טהור: בלי קנבס, בלי DOM, בלי Firebase.
// ════════════════════════════════════════════════════════════════════════
//
// אין כאן "צורות מובנות" מול "צורות שנוספו". יש **קטלוג אחד**, והצורות
// שאנחנו משגרים הן פשוט השורות הראשונות בו. מה שהאדמין יבנה במסך
// הצורות ייראה ויתנהג בדיוק כמו מה שכתוב כאן, כי זה אותו פורמט ואותו
// מסלול ציור. הדרך השנייה — גלריה קשיחה שאחר כך מוסיפים לה — הייתה
// מחייבת לכתוב את הגלריה פעמיים.
//
// ─── מה יש בערך אחד ────────────────────────────────────────────────────
//
//   id      מזהה יציב. הזמנה שמורה מצביעה עליו.
//   name    מה שהלקוח קורא בגלריה.
//   origin  'seed' משוגר · 'factory' ספריית המפעל · 'personal' של הלקוח
//   glass   **בדיוק** השדות ש-lg-layout.js כבר קורא, בלי תרגום.
//
// ה-glass אינו סכמה משלנו אלא אותה זכוכית שהמנוע צורך. כל שכבת תרגום
// בין השתיים הייתה נקודה שבה הקטלוג והצייר יכולים להיפרד, ואז תמונה
// בגלריה מבטיחה דבר אחד והחיתוך יוצא אחר.

var LG_CAT_VERSION = 1;

// ─── תפקידי הקדחים ─────────────────────────────────────────────────────
//
// לכל תפקיד קוטר ברירת מחדל ושם בעברית. הקוטר הוא מה שנקדח; התפקיד הוא
// מה שמוברג בו. ‏junction=true אומר שהתפקיד נולד גם מצומת — ולכן הוא
// מושמט כשהצומת כבר ייצר אותו, כדי שתישאר פיסת מתכת אחת. זווית רצפה
// אינה צומת ולכן שורדת תמיד, גם לצד זווית קיר על אותה פאה.
var LG_CAT_ROLES = {
  'hinge':         { he: 'ציר',          dia: 20, junction: true  },
  'bracket-wall':  { he: 'זווית קיר',    dia: 20, junction: true  },
  'bracket-gg':    { he: 'זווית זכוכית', dia: 20, junction: true  },
  'bracket-floor': { he: 'זווית רצפה',   dia: 20, junction: false },
  'handle':        { he: 'ידית',         dia: 12, junction: false },
};

// מרחק ברירת מחדל של קדח מהפאה ומהקצה, במילימטרים
var LG_CAT_INSET = 25;
var LG_CAT_EDGE  = 200;

// ─── עזר לבניית קדחים ──────────────────────────────────────────────────
//
// קדח נמדד כמו שקודחים אותו: קוטר, ומרחק משתי פאות. שתי הפאות נלקחות
// מהמצולע ולא מהתיבה, כך ששיפוע ופינוי מזיזים את הקדח איתם.
function lgHole(role, fromX, mmX, fromY, mmY, dia) {
  return {
    role: role,
    dia:  dia || (LG_CAT_ROLES[role] || {}).dia || 20,
    x: { from: fromX === 'right' ? 'right' : 'left', mm: mmX || 0 },
    y: { from: fromY === 'top'   ? 'top'   : 'bottom', mm: mmY || 0 },
  };
}

// זוג קדחים על אותה פאה — למעלה ולמטה. זה הדפוס שחוזר כמעט תמיד:
// זווית קיר, זווית זכוכית וציר כולם באים בזוג.
function lgHolePair(role, side, h, inset) {
  var ins = inset != null ? inset : (role === 'hinge' ? 0 : LG_CAT_INSET);
  return [
    lgHole(role, side, ins, 'top',    LG_CAT_EDGE),
    lgHole(role, side, ins, 'bottom', LG_CAT_EDGE),
  ];
}

// ─── הצורות המשוגרות ───────────────────────────────────────────────────
//
// אלה שורות ראשונות, לא קוד מיוחד. אפשר למחוק אחת, אפשר להוסיף עשר,
// ואפשר לבנות אותן מחדש במסך האדמין בלי לגעת בקובץ הזה.
function lgCatalogSeeds() {
  return [
    // קבוע שעומד בין שני קירות — זוויות קיר בשתי הפאות. זה מה שנחתך בו
    // באמת, ולכן זה מה שרואים בגלריה.
    { id: 'fixed', name: 'קבוע', origin: 'seed',
      glass: { kind: 'fixed', w: 500, h: 2000,
               holes: lgHolePair('bracket-wall', 'left')
                 .concat(lgHolePair('bracket-wall', 'right')) } },

    // קבוע שנושא את הדלת: קיר בצד אחד, צירים בצד השני. כשדלת באמת
    // תישען עליו הצומת לא יוסיף זוג שני — אותה פיסת מתכת, ספירה אחת.
    { id: 'fixed-hinges', name: 'קבוע עם צירים', origin: 'seed',
      glass: { kind: 'fixed', w: 500, h: 2000,
               holes: lgHolePair('bracket-wall', 'left')
                 .concat(lgHolePair('hinge', 'right')) } },

    // קבוע שנשען על קבוע אחר — זווית זכוכית-זכוכית במקום קיר
    { id: 'fixed-gg', name: 'קבוע על קבוע', origin: 'seed',
      glass: { kind: 'fixed', w: 500, h: 2000,
               holes: lgHolePair('bracket-wall', 'left')
                 .concat(lgHolePair('bracket-gg', 'right')) } },

    { id: 'fixed-floor', name: 'קבוע עם זווית רצפה', origin: 'seed',
      glass: { kind: 'fixed', w: 900, h: 2000,
               holes: lgHolePair('bracket-wall', 'left')
                 .concat(lgHolePair('bracket-wall', 'right'))
                 .concat([lgHole('bracket-floor', 'left', 450, 'bottom', 60)]) } },

    { id: 'fixed-slope', name: 'קבוע משופע', origin: 'seed',
      glass: { kind: 'fixed', w: 500, h: 2000,
               slopeH1: 2000, slopeH2: 1800, slopeSideH: 'bottom',
               holes: lgHolePair('bracket-wall', 'left')
                 .concat(lgHolePair('bracket-wall', 'right')) } },

    { id: 'fixed-notch', name: 'קבוע עם מדרגה', origin: 'seed',
      glass: { kind: 'fixed', w: 900, h: 2000,
               notchSide: 'left', notchW: 300, notchH: 400,
               notchHIn: 400, notchRest: 600,
               holes: lgHolePair('bracket-wall', 'right') } },

    // דלת: צירים בצד שהיא נתלית ממנו. הידית אינה מוצהרת — המנוע מצייר
    // אותה לכל דלת ממילא, ושתי הצהרות היו נותנות שני קדחים.
    { id: 'door-right', name: 'דלת · ציר ימין', origin: 'seed',
      glass: { kind: 'door', w: 800, h: 1985, hingeSide: 'right',
               holes: lgHolePair('hinge', 'right') } },

    { id: 'door-left', name: 'דלת · ציר שמאל', origin: 'seed',
      glass: { kind: 'door', w: 800, h: 1985, hingeSide: 'left',
               holes: lgHolePair('hinge', 'left') } },

    { id: 'door-slope', name: 'דלת משופעת', origin: 'seed',
      glass: { kind: 'door', w: 800, h: 1985, hingeSide: 'right',
               slopeH1: 1985, slopeH2: 1785, slopeSideH: 'bottom',
               holes: lgHolePair('hinge', 'right') } },

    { id: 'mirror', name: 'מראה', origin: 'seed',
      glass: { kind: 'mirror', w: 600, h: 800 } },

    // ריקה בכוונה. מנוע הפינוי והחורים שלה עוד לא נבנה, ולוח שמגיע
    // עם זוויות של קבוע הוא לא "צורה חופשית".
    { id: 'shape', name: 'צורה חופשית', origin: 'seed',
      glass: { kind: 'shape', w: 500, h: 500 } },
  ];
}

// ─── מה הקטלוג עוצר ────────────────────────────────────────────────────
//
// ערך פגום בקטלוג גרוע מערך חסר: הוא נראה תקין בגלריה ונשבר בהזמנה.
// הבדיקה כאן רצה גם על מה שהאדמין בונה במסך, לפני השמירה.
function lgCatalogValidate(entry) {
  var errors = [];
  if (!entry || typeof entry !== 'object') return ['ערך ריק'];
  if (!entry.id)   errors.push('לצורה אין מזהה');
  if (!entry.name) errors.push('לצורה אין שם');

  var g = entry.glass;
  if (!g || typeof g !== 'object') { errors.push('לצורה אין זכוכית'); return errors; }

  var KINDS = { fixed: 1, door: 1, mirror: 1, shape: 1, panel: 1 };
  if (!KINDS[g.kind]) errors.push('סוג זכוכית לא מוכר: ' + g.kind);
  if (!(g.w > 0)) errors.push('רוחב חייב להיות גדול מאפס');
  if (!(g.h > 0)) errors.push('גובה חייב להיות גדול מאפס');
  if (g.kind === 'door' && g.hingeSide !== 'left' && g.hingeSide !== 'right')
    errors.push('לדלת חייב להיות צד ציר');

  // זכוכית חופשית אינה נושאת פרזול — לא מהצומת ולא מהצהרה
  if ((g.kind === 'shape' || g.kind === 'mirror' || g.kind === 'panel') &&
      g.holes && g.holes.length)
    errors.push('זכוכית חופשית אינה נושאת פרזול');

  (g.holes || []).forEach(function (h, i) {
    var at = 'קדח ' + (i + 1) + ': ';
    if (!h || !LG_CAT_ROLES[h.role]) { errors.push(at + 'תפקיד לא מוכר'); return; }
    if (!(h.dia > 0)) errors.push(at + 'קוטר חייב להיות גדול מאפס');
    var hx = h.x || {}, hy = h.y || {};
    if (!(hx.mm >= 0)) errors.push(at + 'מרחק מהפאה חסר');
    if (!(hy.mm >= 0)) errors.push(at + 'מרחק מהקצה חסר');
    // קדח שיושב מחוץ לזכוכית ייחתך בשפה ולא יחזיק כלום
    if (hx.mm > g.w) errors.push(at + 'מרחק מהפאה גדול מרוחב הזכוכית');
    if (hy.mm > g.h) errors.push(at + 'מרחק מהקצה גדול מגובה הזכוכית');
  });

  return errors;
}

// ─── מהקטלוג לזכוכית ───────────────────────────────────────────────────
//
// אין כאן תרגום, רק העתקה והדבקת מזהה. זה הרצון: מה שנשמר בקטלוג הוא
// מה שהמנוע יקבל, בלי שדה באמצע שמישהו ישכח לעדכן.
function lgCatalogToShape(entry, id) {
  if (!entry || !entry.glass) return null;
  var g = entry.glass, out = { id: id || entry.id };
  for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) out[k] = g[k];
  if (out.holes) out.holes = out.holes.map(function (h) {
    return { role: h.role, dia: h.dia,
             x: { from: h.x.from, mm: h.x.mm },
             y: { from: h.y.from, mm: h.y.mm } };
  });
  out.fromCatalog = entry.id;
  return out;
}

// ─── התמונה בגלריה ─────────────────────────────────────────────────────
//
// התמונה מצוירת **על ידי המנוע**, לא נשמרת כקובץ. צורה חדשה היא שורה
// בטבלה ולא נכס שמישהו צריך לצייר, ותמונה לא יכולה לשקר על מה שייחתך —
// כי היא באה מאותו קוד שמחשב את החיתוך.
//
// הגבולות פתוחים בשני הצדדים בכוונה: התמונה מראה מה **הצורה עצמה**
// נושאת, ולא מה יקרה לה כשתשב ליד קיר. הקדחים שרואים בה הם המוצהרים,
// והם בדיוק מה שייחתך בלוח בודד שמוזמן להחלפה.
function lgCatalogThumb(entry, opts) {
  if (typeof lgLayout !== 'function') return '';
  var o = opts || {}, box = o.size || 96, pad = o.pad != null ? o.pad : 6;
  var sh = lgCatalogToShape(entry, 'thumb');
  if (!sh) return '';

  var L = lgLayout({ boundary: { right: 'open', left: 'open' },
                     finish: 'shahor', quality: 'zamak', shapes: [sh] },
                   { canvasW: 400, dims: false });
  var g = L.shapes[0];
  if (!g) return '';

  // מכווצים את מה שהמנוע צייר לתוך ריבוע התמונה, שומרים על היחס
  var xs = g.poly.map(function (p) { return p[0]; });
  var ys = g.poly.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(Math, xs), x1 = Math.max.apply(Math, xs);
  var y0 = Math.min.apply(Math, ys), y1 = Math.max.apply(Math, ys);
  var k  = Math.min((box - pad * 2) / (x1 - x0 || 1),
                    (box - pad * 2) / (y1 - y0 || 1));
  var ox = (box - (x1 - x0) * k) / 2 - x0 * k;
  var oy = (box - (y1 - y0) * k) / 2 - y0 * k;
  var X = function (v) { return (v * k + ox).toFixed(1); };
  var Y = function (v) { return (v * k + oy).toFixed(1); };

  var p = ['<svg viewBox="0 0 ' + box + ' ' + box + '" width="' + box +
           '" height="' + box + '" aria-hidden="true">'];
  p.push('<polygon points="' + g.poly.map(function (q) { return X(q[0]) + ',' + Y(q[1]); }).join(' ') +
         '" fill="#eef4f5" stroke="#2f4f4f" stroke-width="1.2"/>');

  // אותה חלוקה כמו על הקנבס: ציר סמל מלא, זווית וידית קדח חשוף
  L.hardware.forEach(function (h) {
    if (h.kind === 'hinge') {
      p.push('<rect x="' + X(h.x - 12 / k) + '" y="' + Y(h.y - 8 / k) +
             '" width="' + (24 * k).toFixed(1) + '" height="' + (16 * k).toFixed(1) +
             '" rx="2" fill="#2b2620"/>');
      return;
    }
    var r = Math.max((h.dia || 20) * L.scale * k / 2, 1.6);
    p.push('<circle cx="' + X(h.x) + '" cy="' + Y(h.y) + '" r="' + r.toFixed(1) +
           '" fill="#fff" stroke="' + (h.kind === 'bracket' ? '#8a6a2a' : '#3a3128') +
           '" stroke-width="1"/>');
  });

  p.push('</svg>');
  return p.join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_CAT_VERSION: LG_CAT_VERSION, LG_CAT_ROLES: LG_CAT_ROLES,
                     lgHole: lgHole, lgHolePair: lgHolePair,
                     lgCatalogSeeds: lgCatalogSeeds,
                     lgCatalogValidate: lgCatalogValidate,
                     lgCatalogToShape: lgCatalogToShape,
                     lgCatalogThumb: lgCatalogThumb };
}
