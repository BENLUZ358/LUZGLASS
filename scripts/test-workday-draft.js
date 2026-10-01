#!/usr/bin/env node
/**
 * הטיוטה של יום העבודה — הדרך היחידה פנימה.
 *
 * "בנה יום עבודה" עובד בשני שלבים בכוונה:
 *   1. בוחרים פריטים  → draftItems (טיוטה)
 *   2. "הורד לעבודה"  → commitDraftToWork → addSingleItem לכל פריט
 *                       ואז handleWorkdayStart, שמפצל: ליטוש נשאר ביום
 *                       העבודה, חיסום עובר ל-workday/inChisum = תחנת הבדיקה
 *
 * מה שנשבר (נמצא 2026-09-29 על שלוש הזמנות אמיתיות): "הוסף הזמנה שלמה"
 * עקף את שלב 1 לגמרי — דחף ישר ל-inWork, מילא itemsSel בכל הפריטים וסימן
 * stage='workday'. הפיצול קורה רק ב-handleWorkdayStart, שלא רץ.
 *
 * התוצאה הייתה שקטה וגרועה: getActiveItemsForOrder מסתירה פריטי חיסום
 * מיום העבודה כי היא מניחה שהם כבר בתחנת הבדיקה — אבל הם לא הגיעו לשם.
 * L1065-3 הציגה 3 מראות מתוך 7 פריטים; L1068-1, שכולה חיסום, הציגה כלום
 * ונראתה כאילו נמחקה. הפריטים לא אבדו מ-Firebase — הם פשוט לא היו גלויים
 * בשום מסך, ולא היה שום דבר שמודיע על כך.
 *
 * הכלל שהקובץ הזה נועל: שום מסלול הוספה לא מדלג על הטיוטה, והמקום היחיד
 * שמעביר לתחנת הבדיקה הוא handleWorkdayStart.
 *
 * Run: node scripts/test-workday-draft.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WD   = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = name =>
  (WD.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── "הוסף הזמנה שלמה" עובר דרך הטיוטה, כמו כל פריט בודד ──────────────── */
{
  const fn = bodyOf('addWholeOrder');
  check('the function exists', fn.length > 0, true);
  check('it adds to the draft', /addGroupToDraft\(sid, _avail\)/.test(fn), true);

  /* אלה שלוש השורות שהיו שם ועקפו את הטיוטה. כל אחת מהן לבדה מחזירה את הבאג */
  check('it does not push straight into inWork',
        /workDay\.inWork\.push/.test(fn), false);
  check('it does not fill itemsSel itself',
        /workDay\.itemsSel\[sid\]\s*=/.test(fn), false);
  check('and it does not mark the stage — that belongs to the commit',
        /markStageWorkday/.test(fn), false);

  /* הזמנה ללא פריטים (באג 18) — נשאר */
  check('an order with no items is still refused, not silently added',
        /if\(!_oi\.length\)\{[\s\S]{0,140}?return;/.test(fn), true);

  /* פריט שכבר ביום העבודה לא חוזר לטיוטה — אותו סינון כמו availIdx בשורה */
  check('items already in the work day are filtered out first',
        /_avail = _oi\.map\(\(_,i\)=>i\)\.filter\(i => !_selIdxs\.includes\(i\)\)/.test(fn), true);
  check('and when nothing is left it says so instead of doing nothing',
        /כבר ביום העבודה או בטיוטה/.test(fn), true);
}

/* ── הזמנה שכולה בטיוטה יורדת מרשימת "בנה יום עבודה" ─────────────────── */
/*
 * שורת פריט נעלמת כשהוא נבחר או בטיוטה (availIdx). הכותרת של ההזמנה נשלטת
 * ב-getFiltered, וקודם היא ספרה רק את itemsSel — וגם זה רק כשההזמנה ב-inWork.
 * מאז ש"הוסף הזמנה שלמה" עובר דרך הטיוטה, הזמנה שכולה בטיוטה אינה ב-inWork
 * ו-itemsSel שלה ריק, ולכן היא נשארה על המסך ככותרת בלי אף שורה מתחתיה.
 */
{
  const fn = bodyOf('getFiltered');
  check('the list counts what is in the draft, not only what is in the work day',
        /draftItems\.forEach\(d => \{ if\(String\(d\.orderId\) === sid\) taken\.add/.test(fn), true);
  check('and it counts itemsSel too, so both routes hide the order',
        /workDay\.itemsSel && workDay\.itemsSel\[sid\]/.test(fn), true);
  check('an order with nothing left to add is hidden',
        /if\(totalItems && taken\.size >= totalItems\) return false;/.test(fn), true);
  /* באג 18 — הזמנה ללא פריטים חייבת להישאר, אחרת אי אפשר להוסיף לה ידנית */
  check('but an order with no items at all stays visible',
        /totalItems &&/.test(fn), true);
  check('the old inWork-only gate is gone',
        /if\(workDay\.inWork\.includes\(sid\)\)\{[\s\S]{0,200}?uniqueSel/.test(fn), false);
}

/* ── הטיוטה שורדת רענון ──────────────────────────────────────────────── */
/*
 * draftItems היה משתנה בזיכרון בלבד: טיוטה של חמישה-עשר פריטים נעלמה
 * ברענון בטעות, בלי שום אזהרה. אותו מנגנון כמו lgCheckState בתחנת הבדיקה.
 *
 * ⚠️ והשחזור חייב לאמת. הטיוטה מצביעה על orderId ו-itemIdx, ושניהם
 * מתיישנים: ההזמנה ירדה לעבודה, הפריט נמחק, או שמישהו בחר אותו ממכשיר
 * אחר. שחזור עיוור היה מאפשר להוריד לעבודה פריט שכבר לא קיים, או פעמיים
 * את אותו אחד.
 */
{
  check('the draft is persisted', /safeStorage\.setItem\(LG_DRAFT_KEY/.test(WD), true);
  /* נקודה אחת לשמירה — updateDraftBadge נקראת מכל שינוי בטיוטה */
  const badge = bodyOf('updateDraftBadge');
  check('and saved from the one place every change already goes through',
        /safeStorage\.setItem\(LG_DRAFT_KEY/.test(badge), true);
  check('an empty draft clears the key instead of storing []',
        /else\s+safeStorage\.removeItem\(LG_DRAFT_KEY\)/.test(badge), true);
  /* כשל ב-localStorage לא מפיל את הדף — safari בגלישה פרטית זורק */
  check('a storage failure cannot break the page', /catch\(e\)\{ console\.warn\('draft save/.test(WD), true);

  const restore = bodyOf('restoreDraft');
  check('restore runs once', /if\(_draftRestored \|\| !allOrders\.length\) return;/.test(restore), true);
  check('it drops an order that left the queue',
        /if\(!\['opty','workday'\]\.includes\(o\.stage\|\|''\)\) return false;/.test(restore), true);
  check('an item that no longer exists',
        /if\(!items\[Number\(d\.itemIdx\)\]\) return false;/.test(restore), true);
  check('and one that is already in the work day',
        /return !selIdxs\.includes\(Number\(d\.itemIdx\)\);/.test(restore), true);
  check('it says how many were restored and how many were dropped',
        /כבר לא רלוונטיים/.test(restore), true);

  /* השחזור חייב לרוץ אחרי שההזמנות הגיעו — אין מול מה לאמת לפני כן */
  const listen = (WD.match(/_workdayUnsub = listenAllOrders\(function\(fbOrders\)\{[\s\S]*?\n  \}\);/) || [''])[0];
  check('and only after the orders have arrived', /restoreDraft\(\);/.test(listen), true);

  /* ⚠️ אותה מלכודת TDZ כמו draftItems: renderAll() נקרא ברמה העליונה */
  check('the key is declared before the top-level renderAll that can reach it',
        WD.indexOf("const LG_DRAFT_KEY") > -1 && WD.indexOf('\nrenderAll();') > -1 &&
        WD.indexOf("const LG_DRAFT_KEY") < WD.indexOf('\nrenderAll();'), true);
}

/* ── סדר ההצהרות ─────────────────────────────────────────────────────── */
/*
 * renderAll() נקרא ברמה העליונה של הסקריפט, ו-getFiltered קוראת draftItems.
 * כל עוד ההצהרה ישבה בתחתית הקובץ זה היה ReferenceError בהמתנה — הוא לא
 * נדלק רק כי allOrders עדיין ריק באותו רגע והלולאה לא נכנסת.
 */
{
  const decl = WD.indexOf('let draftItems');
  const call = WD.indexOf('\nrenderAll();');
  check('draftItems is declared exactly once', (WD.match(/let draftItems/g) || []).length, 1);
  check('and before the top-level renderAll that reads it', decl > -1 && call > -1 && decl < call, true);
}

/* ── הטיוטה היא השער היחיד ליום העבודה ───────────────────────────────── */
{
  const commit = bodyOf('commitDraftToWork');
  check('the commit is what calls addSingleItem', /addSingleItem\(d\.orderId, d\.itemIdx\)/.test(commit), true);
  check('and it is what starts the day, so the split always follows',
        /handleWorkdayStart\(\)/.test(commit), true);
  check('it empties the draft, so a second press cannot add twice',
        /draftItems = \[\]/.test(commit), true);
}

/* ── הפיצול יושב במקום אחד בלבד ──────────────────────────────────────── */
{
  /* inChisum נכתב רק ב-handleWorkdayStart. אם עוד מישהו יכתוב לשם, שני
     מקורות אמת יחליטו מה נמצא בתחנת הבדיקה — וזה הדפוס שנשבר כאן שוב ושוב */
  const pushes = (WD.match(/workDay\.inChisum\.push/g) || []).length;
  check('exactly one place pushes into the check station', pushes, 1);
  check('and it is inside handleWorkdayStart',
        /workDay\.inChisum\.push/.test(bodyOf('handleWorkdayStart')), true);

  const start = bodyOf('handleWorkdayStart');
  check('the split keeps only non-chisum items in the work day',
        /workDay\.itemsSel\[_sid\] = _allSelIdxs\.filter/.test(start), true);
  /* אותה פעולה, שני חצאים: מוחקים את החיסום מיום העבודה רק כי הוא עובר
     לתחנה. חצי אחד בלי השני הוא בדיוק הבאג הזה */
  check('and the same run is what moves them to the station',
        /hasChisum && !workDay\.inChisum/.test(start), true);
}

/* ── תחנת הבדיקה מציגה בדיוק את inChisum ─────────────────────────────── */
{
  const CS = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8').replace(/\r\n/g, '\n');
  check('the check station shows exactly what is in inChisum',
        /fbOrders\.filter\(o=>wdInChisum\.includes\(String\(o\.id\)\)\)/.test(CS), true);
  /* ולכן הזמנה שלא נדחפה לשם פשוט לא קיימת שם — אין מסלול חלופי שיציל אותה.
     ההצהרה הריקה לא נספרת; מה שנספר הוא מאיפה הערך באמת מגיע */
  const sources = (CS.match(/wdInChisum\s*=\s*(?!\[\];)/g) || []).length;
  check('the queue has exactly one source, and it is Firebase', sources, 1);
  check('and that source is workday/inChisum',
        /wdInChisum = objToArr\(wd\.inChisum\)/.test(CS), true);
}

/* ── ההסתרה שהפכה את הבאג לשקט ───────────────────────────────────────── */
{
  const fn = bodyOf('getActiveItemsForOrder');
  check('the work day view hides chisum items', /!it\.chisum/.test(fn), true);
  /* זו הסיבה שאיש לא ראה את הפריטים החסרים: הם נעלמו מהמסך בלי הודעה.
     ההסתרה נכונה — אבל רק כשהם באמת עברו לתחנה, וזה מה שהטיוטה מבטיחה */
  check('which is only correct because the draft guarantees the split ran',
        /addGroupToDraft/.test(bodyOf('addWholeOrder')), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll workday-draft checks passed.');
