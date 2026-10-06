#!/usr/bin/env node
/**
 * סיום הובלה אינו נעשה מ-Admin.
 *
 * ─── למה החסימה קיימת ─────────────────────────────────────────────────
 *
 * הודעת "ההובלה יצאה" נשלחת ממסך ההובלות ביום עבודה, ושם בלבד. שם
 * ההזמנות מקובצות לפי לקוח והוא מקבל **הודעה אחת** עם כל מספרי ההזמנות
 * שבאותה משאית.
 *
 * קידום delivery → collected מ-Admin היה מעביר לנאסף **בלי שום הודעה** —
 * הלקוח לא היה יודע שההובלה יצאה אליו.
 *
 * ⚠️ וחיבור WhatsApp למסך ההוא אינו הפתרון: שם מקדמים הזמנה אחת בכל פעם,
 * ולקוח עם שלוש הזמנות באותה הובלה היה מקבל שלוש הודעות — בדיוק הכלל
 * שביטלנו. וגרוע מזה: ל-kind='dispatched' אין שומר פר-הזמנה (יש רק
 * ל-ready), ולכן הזמנה שכבר נשלחה בקבוצה הייתה מקבלת הודעה שנייה.
 * ר' ממצא 14 ב-AUDIT_STABILIZATION.md.
 *
 * ─── מה נבדק ──────────────────────────────────────────────────────────
 *
 * השומר עצמו מורץ, לא נקרא. בדיקה שמחפשת מחרוזת הייתה עוברת גם על שומר
 * שתמיד מחזיר false.
 *
 * Run: node scripts/test-delivery-finish-guard.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const WD    = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── השומר, מורץ ───────────────────────────────────────────────────── */
{
  const src = (ADMIN.match(/function _lgBlockDeliveryFinish[\s\S]*?\n\}/) || [''])[0];
  check('the guard was found in admin.html', src.length > 0, true);

  const shown = [];
  const ctx = { showDeliveryFinishBlocked: o => shown.push(o) };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const blocks = (stage, next) => { shown.length = 0;
                                    return [ctx._lgBlockDeliveryFinish({ stage, id: 'x' }, next), shown.length]; };

  /* ⚠️ המקרה היחיד שנחסם */
  check('delivery → collected is blocked, and explains why', blocks('delivery', 'collected'), [true, 1]);

  /* ⚠️ וזה שחייב להמשיך לעבוד: הלקוח בא ואסף, והוא כבר קיבל "מוכן לאיסוף" */
  check('done → collected still passes',       blocks('done', 'collected'),      [false, 0]);

  /* שום מעבר אחר אינו מושפע */
  for (const [st, nx] of [['delivery','done'], ['workday','delivery'], ['chisum','done'],
                          ['graphic','delivery'], ['', 'chash'], ['collected','collected']]) {
    check('and ' + (st||"''") + ' → ' + nx + ' is untouched', blocks(st, nx), [false, 0]);
  }

  /* קלט חסר אינו חוסם ואינו קורס */
  check('a missing order does not block',
        [ctx._lgBlockDeliveryFinish(null, 'collected'), ctx._lgBlockDeliveryFinish(undefined, 'collected')],
        [false, false]);
  check('an order with no stage does not block', ctx._lgBlockDeliveryFinish({}, 'collected'), false);
}

/* ── שתי נקודות החנק, לא אחת ────────────────────────────────────────── */
//
//  ⚠️ יש שני מסלולים לנאסף ב-Admin: כפתור "קדם" (advance) ובחירת סטטוס
//  ידנית (saveMod). שומר שמכסה רק אחד מהם ניתן לעקיפה בשתי לחיצות.
{
  const adv  = (ADMIN.match(/async function advance\(id\)[\s\S]*?\n\}/) || [''])[0];
  const save = (ADMIN.match(/async function saveMod\(\)[\s\S]*?\n\}/) || [''])[0];

  check('the advance button consults the guard', /_lgBlockDeliveryFinish\(o, newStage\)/.test(adv), true);
  check('and so does the manual status edit',    /_lgBlockDeliveryFinish\(o, newStage\)/.test(save), true);

  /* ⚠️ הסדר: החסימה **לפני** הכתיבה, אחרת ההזמנה כבר זזה */
  check('advance checks before it opens the prompt',
        adv.indexOf('_lgBlockDeliveryFinish') < adv.indexOf('showCollectedPrompt'), true);
  check('saveMod checks before it writes',
        save.indexOf('_lgBlockDeliveryFinish') < save.indexOf('lgLockAndAdvance'), true);
  check('and before the plain updateStage too',
        save.indexOf('_lgBlockDeliveryFinish') < save.indexOf('await updateStage'), true);
}

/* ── ההודעה למשתמש ─────────────────────────────────────────────────── */
{
  const dlg = (ADMIN.match(/function showDeliveryFinishBlocked[\s\S]*?\n\}/) || [''])[0];
  check('it says where the action belongs',
        /יש לבצע "סיים הובלה" דרך יום עבודה/.test(dlg), true);
  check('and explains that the customer gets one message',
        /יחד עם שאר ההזמנות שלו/.test(dlg), true);
  check('and offers a way there',  /workday\.html/.test(dlg), true);

  /* ⚠️ הטקסט מכיל מרכאות כפולות. ב-attribute הן חותכות את המטפל —
     בדיוק הבאג של "קיבלתי את הדוח". לכן addEventListener בלבד. */
  check('the dialog carries no inline handler', /onclick=/.test(dlg), false);
  check('and wires its buttons with addEventListener',
        (dlg.match(/addEventListener\('click'/g) || []).length, 2);
}

/* ── מה שלא נגע ─────────────────────────────────────────────────────── */
{
  /* ⚠️ Admin נשאר בלי מסלול **שליחה** — זו כל הנקודה. מאז 05/10 יש בו
     אינדיקציית מצב (lgWaStatus / lgWaCheckState), והיא קריאה בלבד:
     הראשונה קוראת צומת, השנייה שואלת את GREEN API על המצב מבלי לגעת
     בתור. אף אחת מהן אינה יכולה להוציא הודעה. */
  const live = ADMIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  /* ⚠️ צומצם ב-06/10 בהחלטת בן (שלב 6, אפיון §16): תור הסקיצות שולח
     "הסקיצות טופלו" — והסוג הזה בלבד. "ההובלה יצאה" ו"מוכן לאיסוף" עדיין
     לא יוצאים מ-Admin: אין whatsapp-send, אין קיבוץ הובלה, ואין קריאה ל-
     dispatch עם סוג אחר. test-wa-sketch-ack בודק שיש קריאה אחת בדיוק. */
  check('admin never sends ready / dispatched',
        /whatsapp-send|lgWaEnqueue|_waSendReadyGrouped|_waDispatch/.test(live), false);
  const dispatchCalls = [...live.matchAll(/whatsapp-dispatch'\s*,\s*\{([^}]*)\}/g)].map(m => m[1]);
  check('every admin dispatch call is "sketches handled"',
        dispatchCalls.length > 0 && dispatchCalls.every(c => /kind:\s*'sketches-handled'/.test(c)), true);
  check('and no other mention of dispatch slips through',
        (live.match(/whatsapp-dispatch/g) || []).length, dispatchCalls.length);
  /* lgWaIn* — פאנל הקליטות הנכנסות (06/10). הוא לא שולח ללקוח דבר: פותח
     וסוגר פאנל, ופעולותיו עוברות ב-/api/wa-inbound-drain. מוחרג כאן בשמו,
     ובנפרד נבדק שהקובץ שלו לא נוגע במסלול השליחה.
     lgWaDrain — שלב 6: אחרי "טופלו" מרוקנים את התור, אחרת ההודעה הייתה
     מחכה עד שמישהו יפתח יום עבודה (ה-drain רץ רק משם). */
  check('and its only WhatsApp calls are status and the queue drain',
        (live.match(/lgWa(?!In)[A-Z][A-Za-z]*\(/g) || []).sort().filter((v,i,a)=>a.indexOf(v)===i),
        ['lgWaCheckState(', 'lgWaDrain(', 'lgWaStatus(']);
  const PANEL = fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8');
  check('the inbound panel it loads cannot send either',
        /whatsapp-dispatch|whatsapp-send|whatsapp-drain|lgWaEnqueue|lgWaDrain/.test(PANEL), false);
  /* ⚠️ checkOnly חייב להישאר — בלעדיו הכפתור "בדוק שוב" היה מרוקן את התור */
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('the recheck asks for a status only, never a drain',
        /_lgAuthPost\('\/api\/whatsapp-drain', \{ checkOnly: true \}\)/.test(FB), true);

  /* תחנת החשבוניות היא העברה אדמיניסטרטיבית, ולא נגעה */
  const inv = (ADMIN.match(/async function invSend\(\)[\s\S]*?\n\}/) || [''])[0];
  check('invSend is untouched by the guard', /_lgBlockDeliveryFinish/.test(inv), false);
  check('and still moves orders to collected', /updateStage\(id, 'collected'\)/.test(inv), true);

  /* ומסך ההובלות ממשיך לעבוד בדיוק כפי שהוא */
  check('the delivery screen still finishes deliveries',
        /showClientDeliveryPrompt\(btn\.dataset\.ids\)/.test(WD), true);
  check('and still sends the grouped dispatched message',
        /_waDispatch\(orderIds, clientName\)/.test(WD), true);
  check('with the business action first',
        WD.indexOf('finalizeDelivery') < WD.indexOf('_waDispatch(orderIds'), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll delivery-finish guard checks passed.');
