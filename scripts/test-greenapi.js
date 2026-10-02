#!/usr/bin/env node
/**
 * ארבע נעילות הבטיחות של כלי הבדיקה של GREEN API.
 *
 * ⚠️ הנעילות נולדו ככלי בדיקה זמני (api/whatsapp-test.js), אבל הן **כבר
 * לא** כאלה: lgGreenApiTest הוא היום השער של ספק green ב-_wa-provider.js,
 * והוא מה שמונע מ-TEST לשלוח לכל מספר שאינו GREENAPI_TEST_TO. הכלי הזמני
 * נמחק ב-02/10/2026; הנעילות נשארו וחשובות מתמיד.
 *
 * הקובץ הזה מריץ את הקוד עצמו מול סביבות מדומות — לא בודק טקסט — ומוכיח
 * חמש טענות שבן דרש במפורש:
 *   1. הייצור חסום
 *   2. TEST בלי GREENAPI_TEST_ENABLED=1 חסום
 *   3. מספר שאינו GREENAPI_TEST_TO חסום
 *   4. אין אפשרות לשליחה קבוצתית
 *   5. הטוקן אינו דולף לתשובה ולא ללוג
 *
 * Run: node scripts/test-greenapi.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

// טוען את _env.js מחדש בכל פעם, עם סביבה אחרת
function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.keys(vars).forEach(k => {
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  });
  delete require.cache[require.resolve(path.join(ROOT, 'api', '_env.js'))];
  try { return fn(require(path.join(ROOT, 'api', '_env.js'))); }
  finally { process.env = saved; }
}
const sa = id => JSON.stringify({ project_id: id, client_email: 'x@y', private_key: 'k' });

const TOKEN = 'SECRET-TOKEN-abc123xyz';
const READY = {
  FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'),
  GREENAPI_TEST_ENABLED: '1',
  GREENAPI_TEST_TO: '0501234567',
  GREENAPI_ID_INSTANCE: '1101900001',
  GREENAPI_TOKEN: TOKEN,
};

/* ── 1 · הייצור חסום ────────────────────────────────────────────────── */
{
  withEnv({ ...READY, FIREBASE_SERVICE_ACCOUNT: sa('lussglass') }, m => {
    const g = m.lgGreenApiTest();
    check('production is blocked even when fully configured', g.allowed, false);
    check('and the reason says so', /ייצור/.test(g.reason), true);
  });
  /* ⚠️ הכיוון ההפוך מ-lgExternal, ובכוונה: שם הייצור הוא היחיד שמותר,
     כאן הוא היחיד שאסור. כלי בדיקה לא רץ מול לקוחות אמיתיים. */
  withEnv({ ...READY }, m =>
    check('while the test project is allowed — the direction is inverted on purpose',
          m.lgGreenApiTest().allowed, true));
}

/* ── 2 · בלי הפעלה מפורשת ──────────────────────────────────────────── */
{
  for (const v of [undefined, '', '0', 'true', 'yes', 'TEST', ' 1 x']) {
    withEnv({ ...READY, GREENAPI_TEST_ENABLED: v }, m =>
      check('GREENAPI_TEST_ENABLED=' + JSON.stringify(v) + ' does not open it',
            m.lgGreenApiTest().allowed, false));
  }
  withEnv({ ...READY, GREENAPI_TEST_ENABLED: ' 1 ' }, m =>
    check('only an exact "1" (trimmed) opens it', m.lgGreenApiTest().allowed, true));
}

/* ── 3 · נמען ──────────────────────────────────────────────────────── */
{
  withEnv({ ...READY }, m => {
    check('the allowed number passes',        m.lgGreenApiTest('0501234567').allowed, true);
    check('and so does the same one formatted', m.lgGreenApiTest('050-123-4567').allowed, true);
    check('a different number is refused',    m.lgGreenApiTest('0509999999').allowed, false);
    /* ⚠️ לא "מתוקן" בשקט לנמען המורשה — מסורב, כדי שהטעות תיראה */
    check('and refused, not silently redirected',
          /אינו המספר המורשה/.test(m.lgGreenApiTest('0509999999').reason), true);
    check('no number at all falls back to the allowed one', m.lgGreenApiTest().to, '0501234567');
  });
  withEnv({ ...READY, GREENAPI_TEST_TO: undefined }, m =>
    check('with no allowed number configured, nothing can be sent', m.lgGreenApiTest().allowed, false));
}

/* ── 4 · אישורי חיבור ──────────────────────────────────────────────── */
{
  withEnv({ ...READY, GREENAPI_TOKEN: undefined }, m =>
    check('a missing token blocks', m.lgGreenApiTest().allowed, false));
  withEnv({ ...READY, GREENAPI_ID_INSTANCE: undefined }, m =>
    check('a missing instance id blocks', m.lgGreenApiTest().allowed, false));
}

/* ── 5 · הטוקן אינו דולף ───────────────────────────────────────────── */
{
  withEnv({ ...READY }, m => {
    const g = m.lgGreenApiTest();
    const asText = JSON.stringify(g);
    /* ⚠️ ב-GREEN API הטוקן יושב בתוך ה-URL, ולכן כל אובייקט שמכיל אותו
       עלול להגיע ללוג או לתשובה. השער מחזיר נמען בלבד. */
    check('the gate never returns the token', asText.includes(TOKEN), false);
    check('nor the instance id',              asText.includes('1101900001'), false);
    check('only the decision and the recipient',
          Object.keys(g).sort(), ['allowed', 'reason', 'to']);
  });

  /*  ⚠️ api/whatsapp-test.js נמחק (02/10/2026). הוא היה כלי זמני שהוכיח
      ש-TEST מסוגל לשלוח דרך GREEN API, והמסלול האמיתי החליף אותו: השליחה
      עוברת ב-_wa-provider.js דרך תור ו-drain.

      מה שנבדק כאן על הקובץ ההוא — שהגוף הגולמי לא מוחזר, ש-redact עובד,
      שאין לולאה — עבר ל-scripts/test-greenapi-errors.js, ושם הוא נבדק
      **בהרצה מול fetch מדומה** ולא בחיפוש מחרוזות. */
}

/* ── הבידוד מהתשתית הקיימת ─────────────────────────────────────────── */
{
  const SEND = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8');
  const fs2  = fs;
  /* ⚠️ הכלי הזמני אינו קיים יותר — ואסור שיחזור בשקט */
  check('the temporary GREEN API test endpoint is gone',
        fs2.existsSync(path.join(ROOT, 'api', 'whatsapp-test.js')), false);
  /* אבל lgGreenApiTest נשאר, והוא כבר לא כלי בדיקה אלא השער של ספק green */
  const PROV = fs2.readFileSync(path.join(ROOT, 'api', '_wa-provider.js'), 'utf8');
  check('and its four locks now guard the real path',
        /lgGreenApiTest\(localPhone\)/.test(PROV), true);
  /* ⚠️ הטענה הזו השתנתה, ובכוונה. היא הייתה "whatsapp-send אינו מזכיר
     GREEN API", ועכשיו הוא פונה לשכבת ספק שאחד הספקים בה **הוא** GREEN API.
     לכן נועלים את הטענה החזקה יותר במקומה: **הייצור אינו יכול להגיע ל-GREEN
     API**, וזה נבדק בהרצה ולא בחיפוש מחרוזת.

     ומה שכן נשאר טענה מבנית: whatsapp-send עצמו לא קורא שום משתנה של
     GREEN API — האישורים נקראים רק בספק, ברגע השליחה. */
  /* ⚠️ מפשיטים הערות לפני בדיקת היעדרות. זו טעות שחזרה בפרויקט הזה חמש
     פעמים: הביטוי תפס את ההערה שמסבירה את הכלל, לא קוד. "אין X" חייב לרוץ
     על קוד חי בלבד. */
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  check('the Meta sender never reads a GREEN API credential',
        /GREENAPI_(TOKEN|ID_INSTANCE|TEST_)/.test(strip(SEND)), false);

  /* ⚠️ השער נקרא **בתוך** תחום הסביבה ולא אחריו. lgGreenApiTest קורא את
     process.env ברגע הקריאה, ולכן gate() שנקרא אחרי השחזור היה נחסם תמיד —
     והבדיקה הייתה "עוברת" מהסיבה הלא נכונה. */
  const provGate = (id, phone) => {
    const saved = { ...process.env };
    process.env.FIREBASE_SERVICE_ACCOUNT = sa(id);
    process.env.WA_PROVIDER = 'green';
    process.env.GREENAPI_TEST_ENABLED = '1';
    process.env.GREENAPI_TEST_TO      = '0501234567';
    process.env.GREENAPI_ID_INSTANCE  = '1101900001';
    process.env.GREENAPI_TOKEN        = TOKEN;
    ['api/_env.js', 'api/_wa-provider.js', 'api/_wa-recipient.js']
      .forEach(m => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
    try {
      const p = require(path.join(ROOT, 'api', '_wa-provider.js')).lgWaProvider();
      return p.gate(phone);
    }
    finally { process.env = saved; }
  };
  /* ⚠️ גם אם מישהו יגדיר WA_PROVIDER=green בפרודקשן בטעות — הנעילה
     הראשונה חוסמת, ושום הודעה לא תצא דרך GREEN API ללקוח אמיתי. */
  check('even WA_PROVIDER=green on production cannot send',
        provGate('lussglass', '0501234567').allowed, false);
  check('while on TEST the same configuration is allowed',
        provGate('luz-glass-test', '0501234567').allowed, true);
  /* והחסימה הגלובלית נשארת המקור לשער של Meta — ר' test-env-isolation.js */
  check('and the meta gate still is lgExternal',
        /lgExternal\(\)/.test(fs.readFileSync(path.join(ROOT, 'api', '_wa-provider.js'), 'utf8')), true);

  /* lgExternal לא שונה — החסימה הגלובלית נשארת על כל ששת ה-endpoints */
  const ENV = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  const ext = (ENV.match(/function lgExternal\(\)[\s\S]*?\n\}/) || [''])[0];
  check('lgExternal is untouched by the GREEN API gate', /GREENAPI/.test(ext), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll GREEN API safety checks passed.');
