#!/usr/bin/env node
/**
 * פעולה שנכשלת חייבת להגיע למסך, לא ל-console.
 *
 * הדפוס שחזר ב-7 מתוך 13 ממצאי ה-audit (2026-09-30): הקוד "מטפל" בשגיאה
 * בכך שהוא מדפיס אותה למקום שאיש לא פותח, והמסך ממשיך כאילו הצליח.
 *
 * ⚠️ הגרוע מכולם היה invoiceMarkDone: שני catch שבלעו את הכישלון, ולכן
 * markDoneAndNotify — שעוטף אותה ב-try/catch — לא יכול היה לתפוס כלום,
 * והציג "✓ המחיר ננעל" גם כשהנעילה נכשלה. ה-catch שם היה קוד מת.
 * הודעה כזו גרועה מכלום: בלעדיה הכישלון שקט, איתה הוא משקר.
 *
 * Run: node scripts/test-silent-failures.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const WD    = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (name, src) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── הכלל הכללי: אין כתיבה להזמנה בלי טיפול בכישלון ─────────────────── */
{
  for (const [label, src] of [['admin.html', ADMIN], ['workday.html', WD]]) {
    // קריאה ל-updateOrder שאינה ממתינה, אינה מחזירה, ואין אחריה catch/then
    const unguarded = (src.match(/(?<!await )(?<!\. )\bupdateOrder\([^;]*;/g) || [])
      .filter(c => !/catch|await|then|return/.test(c));
    check(label.padEnd(14) + ' has no write that fails silently', unguarded, []);
  }
}

/* ── נעילת המחיר חייבת להיכשל כלפי חוץ ──────────────────────────────── */
{
  const fn = bodyOf('invoiceMarkDone', ADMIN);
  check('the function exists', fn.length > 0, true);
  /* שני ה-catch שהיו כאן הם מה שהפך את ההודעה לשקר */
  check('it no longer swallows its own failure', /\.catch\(/.test(fn), false);
  check('the price lock is awaited, so a rejection propagates',
        /await lgLockAndAdvance\(/.test(fn), true);
  check('and so is the plain stage change', /await updateStage\(/.test(fn), true);
  /* האזהרה על פריטים לא מתומחרים לא נעלמה בדרך */
  check('the unpriced warning still runs', /_lgWarnUnpriced\(/.test(fn), true);

  /* ומי שקורא לה כן תופס */
  const caller = bodyOf('markDoneAndNotify', ADMIN);
  check('the caller wraps it in try/catch', /try \{[\s\S]*?await invoiceMarkDone/.test(caller), true);
  check('and its catch is reachable now, so the message can be honest',
        /catch\s*\(e\)\s*\{[\s\S]*?showToast\('הפעולה נכשלה/.test(caller), true);
}

/* ── הפריטים — הנתון שהכי יקר לאבד ──────────────────────────────────── */
{
  /* הם מניעים את הייצור ואת החשבונית. עריכה שלא נשמרה לא תיתפס בתחנת
     החשבוניות, כי שני הצדדים יראו את אותו מידע ישן. */
  check('admin item edits report a failed save',
        /updateOrder\(sqCurrent\.id, \{ items: sqCurrentItems \}\)[\s\S]{0,180}?showToast\('שמירת הפריטים נכשלה/.test(ADMIN), true);
  check('workday item adds report a failed save',
        /updateOrder\(String\(o\.id\), \{ items: o\.items \}\)[\s\S]{0,260}?showToast\('שמירת הפריט נכשלה/.test(WD), true);
  /* ההודעה החיובית עברה ל-then — אחרת היא מוצגת גם כשהכתיבה נכשלה */
  check('and the success toast moved into then(), not before the write',
        /\.then\(\(\)\s*=> showToast\(qty > 1/.test(WD), true);
}

/* ── שינוי שלב ──────────────────────────────────────────────────────── */
{
  const fn = bodyOf('markStageValue', WD);
  check('a failed stage change reaches the screen',
        /showToast\('שינוי השלב לא נשמר/.test(fn), true);
}

/* ── חזרה מהמפעל: כישלון חלקי ──────────────────────────────────────── */
{
  /* היה כאן forEach בלי await: אם שלוש מתוך חמש נכשלו, ההודעה דיווחה על
     כולן ושלוש הזמנות נשארו "בחוץ" בלי שאיש ידע */
  check('the arrival marking waits for every write',
        /Promise\.allSettled\(orders\.map\(id=>updateOrder\(id,\{chisumArrived:true\}\)\)\)/.test(WD), true);
  check('it counts what actually failed',
        /rs\.filter\(r=>r\.status==='rejected'\)/.test(WD), true);
  check('and says how many of how many were saved',
        /נשמרו[\s\S]{0,40}?נכשלו, נסה שוב/.test(WD), true);
  check('the old fire-and-forget loop is gone',
        /orders\.forEach\(id=>updateOrder\(id,\{chisumArrived:true\}\)\.catch/.test(WD), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll silent-failure checks passed.');
