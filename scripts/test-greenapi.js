#!/usr/bin/env node
/**
 * ארבע נעילות הבטיחות של כלי הבדיקה של GREEN API.
 *
 * ⚠️ הכלי הזה אינו ארכיטקטורה. השליחה ללקוחות רצה דרך api/whatsapp-send.js
 * מול Meta Cloud API, והיא לא נגעה. api/whatsapp-test.js קיים כדי להוכיח
 * דבר אחד: ש-TEST מסוגל לשלוח הודעה אחת דרך GREEN API.
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

  const SRC = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-test.js'), 'utf8');
  /* ה-URL הוא סוד בפני עצמו — הוא מכיל את הטוקן */
  check('the endpoint never logs the url',      /console\.(log|error)\([^)]*\burl\b/.test(SRC), false);
  check('and never returns it',                 /res\.status\([^)]*\)\.json\([^}]*\burl\b/.test(SRC), false);
  /* חילוץ מדויק של כל גוף json({...}) — חלון של N תווים היה חוצה את סוף
     הקריאה ותופס את const token שאחריה, וזה היה כישלון של הבדיקה ולא
     ממצא בקוד */
  const jsonBodies = [];
  for (let i = SRC.indexOf('.json({'); i > -1; i = SRC.indexOf('.json({', i + 1)) {
    let depth = 0, j = i + 6;
    for (; j < SRC.length; j++) {
      if (SRC[j] === '{') depth++;
      else if (SRC[j] === '}') { depth--; if (!depth) break; }
    }
    jsonBodies.push(SRC.slice(i, j + 1));
  }
  check('every response body was found', jsonBodies.length > 0, true);

  /* ⚠️ נלמד בדרך הקשה, 2026-10-01. ההנחה הייתה ש"גוף התשובה של GREEN API
     אינו מכיל את הטוקן", וההנחה הייתה שגויה: בשגיאה הם מחזירים שדה path
     עם ה-URL המלא, ובו הטוקן. השליחה הראשונה הדליפה אותו, והוא הוחלף.
     מכאן: הגוף הגולמי לא מוחזר, ומה שכן מוחזר עובר redact. */
  check('the raw GREEN API body is never returned',
        jsonBodies.filter(b => /\braw\b/.test(b) && !/redact\(/.test(b)), []);
  check('a redactor strips the token from anything that leaves',
        /const redact = s => String\(s == null \? '' : s\)\.split\(token\)\.join\('\*\*\*'\)/.test(SRC), true);
  check('and the failure reason goes through it',
        /reason:\s+ok \? null : redact\(/.test(SRC), true);
  /* path הוא השדה שהחזיק את ה-URL — אסור שיוחזר בשום צורה */
  check('the path field is never echoed back',
        jsonBodies.filter(b => /\bpath\b/.test(b)), []);
  check('the token is never put in a response',
        jsonBodies.filter(b => /\btoken\b/i.test(b)), []);
  check('nor the instance id',
        jsonBodies.filter(b => /idInstance/.test(b)), []);
  /* e.message של fetch עלול להכיל את ה-URL, ועם זה את הטוקן */
  check('a network error reports its type, not its message',
        /name: e && e\.name/.test(SRC) && !/message: e\.message/.test(SRC), true);
  check('what is logged is the instance id and the status only',
        /console\.log\('whatsapp-test: '[\s\S]{0,120}?\{ idInstance, to: gate\.to, httpStatus/.test(SRC), true);
}

/* ── שליחה קבוצתית אינה אפשרית ─────────────────────────────────────── */
{
  const SRC = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-test.js'), 'utf8');
  /* מבנית ולא בבדיקה: אין לולאה בקובץ בכלל */
  check('the endpoint contains no loop at all',
        /\bfor\s*\(|\.forEach\(|\.map\(|while\s*\(/.test(SRC), false);
  check('a list in the body is refused outright',
        /Array\.isArray\(body\.to\) \|\| Array\.isArray\(body\.orderIds\) \|\| Array\.isArray\(body\.text\)/.test(SRC), true);
  check('one fetch, not many', (SRC.match(/await fetch\(/g) || []).length, 1);
  check('the text is capped', /text\.length > MAX_TEXT/.test(SRC), true);
}

/* ── הבידוד מהתשתית הקיימת ─────────────────────────────────────────── */
{
  const SRC  = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-test.js'), 'utf8');
  const SEND = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8');
  /* הכלי לא נוגע בהזמנות — אין דרך שישלח למישהו בגלל נתון בהזמנה */
  check('it never reads or writes orders', /orders\//.test(SRC), false);
  check('it never opens a database at all', /getDatabase|firebase-admin/.test(SRC), false);
  check('it still requires an authenticated admin', /await verifyAdmin\(req\)/.test(SRC), true);
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
