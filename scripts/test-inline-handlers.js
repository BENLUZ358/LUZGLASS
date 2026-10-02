#!/usr/bin/env node
/**
 * מטפלי אירוע שכתובים בתוך HTML — onclick="..." וחבריו.
 *
 * ─── הבאג שהוליד את הקובץ הזה ─────────────────────────────────────────
 *
 * ב-workday.html ישבה הערה בתוך onclick:
 *
 *     // דיווחה על כולן ושלוש הזמנות נשארו "בחוץ" בלי שאיש ידע.
 *
 * ב-HTML ערך של attribute מסתיים במרכאה הכפולה הראשונה. הדפדפן חתך שם —
 * **570 תווים לפני סוף המטפל** — ואיתם את כל Promise.allSettled ואת
 * _ov.remove(). הכפתור "✓ כן, קיבלתי" הפסיק לעבוד לגמרי.
 *
 * ⚠️ ומה שהפך את זה למסוכן: שום דבר לא נראה שבור. הדיאלוג נפתח יפה, הקוד
 * במקור תקין וקריא, הקונסולה שקטה עד הלחיצה. זה עלה לפרודקשן ושרד שם,
 * כי אין בדיקה שמסתכלת על מה שהדפדפן **באמת** מקבל.
 *
 * ובעברית מרכאות כפולות הן דבר שבשגרה — "בחוץ", בע"מ, מק"ט. לכן זו לא
 * תאונה חד-פעמית אלא מלכודת פתוחה בכל מחרוזת HTML בפרויקט.
 *
 * ─── למה הכלל צר ──────────────────────────────────────────────────────
 *
 * הניסיון הראשון כאן היה לחתוך כל מטפל כפי שהדפדפן חותך אותו ולבדוק שהוא
 * עדיין JavaScript תקין. זה נתן **18 כשלים, כולם תוצאות שווא**: רוב
 * המטפלים בפרויקט מורכבים בשרשור מחרוזות ('...onclick="' + fn + '...'),
 * ולכן קטע מהמקור אינו אמור להיות JS תקין בכלל. בדיקה שצועקת על קוד תקין
 * גרועה מבדיקה שלא קיימת — מפסיקים להאמין לה.
 *
 * לכן נשמר הסימן שהוא גם מדויק וגם הגורם בפועל: **הערת // בתוך מטפל**.
 * היא זו שהביאה את המרכאות פנימה, ובשורה אחת של attribute אין לה מה
 * לחפש ממילא.
 *
 * Run: node scripts/test-inline-handlers.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── הכלל: אין הערות בתוך מטפל אירוע ───────────────────────────────── */
{
  const offenders = [];
  let scanned = 0;
  for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const re  = /\son[a-z]+\s*=\s*"/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
      const start = m.index + m[0].length;
      const end   = src.indexOf('"', start);        // ← בדיוק כמו הדפדפן
      if (end < 0) continue;
      scanned++;
      const value = src.slice(start, end);
      // הערה שנמשכת לשורה הבאה היא הצורה המסוכנת: היא גוררת פנימה טקסט
      // חופשי, ובעברית טקסט חופשי מכיל מרכאות.
      if (value.includes('\n') && /\/\//.test(value)) {
        offenders.push(file + ':' + (src.slice(0, start).split('\n').length) +
                       '  ' + m[0].trim().replace(/\s*=\s*"$/, ''));
      }
    }
  }
  check('every inline handler was scanned', scanned > 300, true);
  check('no inline handler carries a // comment', offenders, []);
  if (offenders.length) {
    console.error('        Move the handler out of the attribute (addEventListener),');
    console.error('        rather than just deleting the quotes from the comment.');
  }
}

/* ── והמקרה עצמו, נעול ─────────────────────────────────────────────── */
{
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');

  /* ⚠️ התיקון אינו הסרת המרכאות אלא הוצאת הקוד מה-attribute. בדיקה
     שרק מוודאת שאין "בחוץ" הייתה נותנת לבאג לחזור בניסוח אחר. */
  check('the chisum confirm button carries no inline handler at all',
        /id="chisumArrivedOk"\s*\n?\s*style=/.test(WD), true);
  check('it is wired with addEventListener instead',
        /querySelector\('#chisumArrivedOk'\)[\s\S]{0,80}addEventListener\('click'/.test(WD), true);
  check('and so is cancel — it used to be inline too',
        /querySelector\('#chisumArrivedCancel'\)[\s\S]{0,80}addEventListener\('click'/.test(WD), true);

  /* הלקח המקורי שלא ייעלם בתיקון: forEach בלי await דיווח "הכל נשמר" גם
     כששלוש מתוך חמש נכשלו. */
  const fn = (WD.match(/async function _confirmChisumReportArrived[\s\S]*?\n}/) || [''])[0];
  check('the handler still awaits every write',
        /await Promise\.allSettled\(ids\.map\(id => updateOrder\(id, \{ chisumArrived: true \}\)\)\)/.test(fn), true);
  check('and still reports partial failure instead of claiming success',
        /bad\.length[\s\S]{0,120}נכשלו, נסה שוב/.test(fn), true);
  check('the overlay closes only after the writes resolve',
        fn.indexOf('await Promise.allSettled') < fn.indexOf('ov.remove()'), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll inline handler checks passed.');
