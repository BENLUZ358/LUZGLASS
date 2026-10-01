#!/usr/bin/env node
/**
 * החסימה של פניות חיצוניות בסביבה שאינה הייצור.
 *
 * שתי מערכות חיצוניות גורמות נזק שאי אפשר להחזיר: חשבשבת פותחת מסמך
 * חשבונאי אמיתי, ו-WhatsApp שולח ללקוח אמיתי. מסמך מיותר מבטלים; הודעה
 * שיצאה כבר נקראה.
 *
 * ⚠️ הכלל שהקובץ הזה נועל, ושתי הטעויות שהוא מונע:
 *
 *   1. fail-open — "חסום כש-LG_ENV=test" נשבר ממשתנה שנשכח, מ-LG_ENV=Test
 *      באות גדולה, או מפרויקט Vercel שהועתק. לכן ההחלטה נגזרת ממפתח
 *      השירות, שכבר שונה בין הסביבות בהכרח ואי אפשר לשכוח להגדיר אותו.
 *
 *   2. שבירת הפרודקשן — "שלח רק כש-LG_ENV=production" הוא fail-safe, אבל
 *      הפרודקשן אינו מגדיר משתנה כזה והתוספת הייתה משביתה אותו. לכן
 *      project_id='lussskip' ובלי שום משתנה = שולח, בדיוק כמו היום.
 *
 * LG_ENV יכול רק להחמיר. אם אי פעם יתווסף ערך שמתיר משהו שאסור בלעדיו,
 * החסימה חוזרת להיות fail-open — והבדיקה האחרונה כאן תיפול.
 *
 * Run: node scripts/test-env-isolation.js
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

/* ── הפרודקשן ממשיך לשלוח, בלי שום קונפיגורציה חדשה ─────────────────── */
{
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), LG_ENV: undefined }, m => {
    const e = m.lgExternal();
    check('production sends, with no new env var at all', e.allowed, true);
    check('and says which project it is', e.projectId, 'lussglass');
    check('with no reason to show, because nothing is blocked', e.reason, '');
  });
  /* משתנה ריק או רווחים הוא לא "test" */
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), LG_ENV: '' }, m =>
    check('an empty LG_ENV does not block production', m.lgExternal().allowed, true));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), LG_ENV: 'production' }, m =>
    check('LG_ENV=production is allowed too', m.lgExternal().allowed, true));
}

/* ── TEST חסום אוטומטית, בלי שהגדירו בו כלום ────────────────────────── */
{
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'), LG_ENV: undefined }, m => {
    const e = m.lgExternal();
    check('the test project is blocked with no configuration', e.allowed, false);
    check('and the reason names it, in Hebrew', /luz-glass-test/.test(e.reason), true);
  });
}

/* ── שלוש הדרכים שבהן fail-open היה נשבר ────────────────────────────── */
{
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('some-other-project'), LG_ENV: undefined }, m =>
    check('an unknown project is blocked — default is deny, not allow',
          m.lgExternal().allowed, false));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: undefined, LG_ENV: undefined }, m =>
    check('a missing service account is blocked', m.lgExternal().allowed, false));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: '{not json', LG_ENV: undefined }, m =>
    check('a corrupt service account is blocked, not crashed', m.lgExternal().allowed, false));
}

/* ── LG_ENV מחמיר בלבד ──────────────────────────────────────────────── */
{
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), LG_ENV: 'test' }, m =>
    check('LG_ENV=test blocks even on the production project — a dry run',
          m.lgExternal().allowed, false));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), LG_ENV: ' TEST ' }, m =>
    check('…and case and spaces do not get around it', m.lgExternal().allowed, false));
  /* הכיוון ההפוך: אין ערך של LG_ENV שפותח פרויקט שאינו הייצור */
  const opens = ['production', 'prod', 'live', 'lussglass', '1', 'true', 'yes', ''].filter(v =>
    withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'), LG_ENV: v }, m => m.lgExternal().allowed));
  check('no LG_ENV value can open a non-production project', opens, []);
}

/* ── כל endpoint שפונה החוצה מתייעץ עם השומר ────────────────────────── */
{
  /* ⚠️ חריג יחיד ומפורש: api/whatsapp-test.js הוא כלי בדיקה של GREEN API,
     ויש לו שומר משלו — lgGreenApiTest — שנעילותיו הפוכות: הוא חסום דווקא
     בייצור. הוא נרשם כאן בשם ולא מוחרג לפי דפוס, כדי ש-endpoint חדש שישכח
     את lgExternal עדיין ייפול. */
  const OWN_GUARD = { 'whatsapp-test.js': 'lgGreenApiTest' };

  const files = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    const callsOut = /await fetch\(/.test(src);
    const guard    = OWN_GUARD[f] || 'lgExternal';
    const guarded  = new RegExp(guard + '\\(').test(src);
    if (callsOut && !guarded) missing.push(f);
  }
  check('every endpoint that calls out consults a guard', missing, []);

  /* והחריג חייב להישאר חריג: רק הוא רשאי לא לעבור ב-lgExternal */
  const exempt = files.filter(f => {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    return /await fetch\(/.test(src) && !/lgExternal\(/.test(src);
  });
  check('and only the GREEN API test tool is exempt from the global block',
        exempt, ['whatsapp-test.js']);

  /* והשומר נבדק לפני ה-fetch, לא אחריו */
  for (const f of ['hashavshevet-order.js', 'hashavshevet-invoice.js', 'whatsapp-send.js',
                   'hashavshevet-items.js', 'hashavshevet-accounts.js', 'hashavshevet-getpdf.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    check(f.padEnd(28) + ' checks before it fetches',
          // ‎-1‎ על צד חסר קטן מכל דבר, ולכן בלי הקיום הבדיקה חסרת ערך
          src.includes('lgExternal()') && src.includes('await fetch(') &&
          src.indexOf('lgExternal()') < src.indexOf('await fetch('), true);
  }
}

/* ── נקודות הכתיבה מדמות הצלחה, נקודות הקריאה אומרות שנחסמו ─────────── */
{
  for (const f of ['hashavshevet-order.js', 'hashavshevet-invoice.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    check(f.padEnd(28) + ' simulates instead of sending',
          /if \(!env\.allowed\) \{[\s\S]{0,200}?simulated: true, blocked: true/.test(src), true);
    /* הרישום ל-Firebase חייב להמשיך לקרות — אחרת לא רואים שהניסיון היה */
    check(f.padEnd(28) + ' still records the attempt',
          /orders\/'? ?\+ ?orderId|update\(/.test(src), true);
  }
  const wa = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8');
  check('whatsapp adds the block to the existing preview gate',
        /if \(dryRun \|\| !configured \|\| !env\.allowed\)/.test(wa), true);
  check('and reports it as blocked, not as a silent dry run',
        /blocked: !env\.allowed/.test(wa), true);

  for (const f of ['hashavshevet-items.js', 'hashavshevet-accounts.js', 'hashavshevet-getpdf.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    check(f.padEnd(28) + ' refuses rather than faking data',
          /lgBlockExternal\(res,/.test(src), true);
  }
  /* 503 ולא 403 — זו אינה בעיית הרשאה אלא שירות שלא קיים בסביבה הזו */
  const env = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  check('a blocked read answers 503, not 403', /res\.status\(503\)/.test(env), true);
}

/* ── השומר לא נעקף דרך משתנה סביבה ──────────────────────────────────── */
{
  const env = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  /* שם הפרויקט החי נעול בקוד. ברגע שהוא ייקרא ממשתנה סביבה, אפשר יהיה
     להפוך כל סביבה ל"ייצור" בלי commit — וזו בדיוק הדלת שסגרנו */
  check('the live project name is hard-coded, not read from the environment',
        /const LG_LIVE_PROJECT = 'lussglass';/.test(env) &&
        !/LG_LIVE_PROJECT\s*=\s*process\.env/.test(env), true);
}

/* ── כתובת ה-Database של השרת ────────────────────────────────────────── */
/*
 * הייתה קשיחה בארבעה קבצים, ועל הפרודקשן זה עבד במקרה — זו הייתה הכתובת
 * הנכונה. ב-TEST זה נשבר בשקט ובצורה מטעה: הפונקציה מתאמתת עם מפתח השירות
 * של TEST אבל פונה לבסיס של הייצור, שאין לה בו הרשאה, והבקשה נתקעת עד
 * timeout בלי שום הודעה. נתפס בבדיקת הקבלה ב-2026-09-30, כשכל ששת
 * ה-endpoints של TEST נתקעו.
 */
{
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('lussglass'), FIREBASE_DATABASE_URL: undefined }, m =>
    check('production derives byte-for-byte the URL that used to be hard-coded',
          m.lgDatabaseUrl(), 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'), FIREBASE_DATABASE_URL: undefined }, m =>
    check('and the test project derives its own',
          m.lgDatabaseUrl(), 'https://luz-glass-test-default-rtdb.europe-west1.firebasedatabase.app'));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: sa('x'), FIREBASE_DATABASE_URL: 'https://custom.example.app' }, m =>
    check('an explicit FIREBASE_DATABASE_URL wins', m.lgDatabaseUrl(), 'https://custom.example.app'));
  withEnv({ FIREBASE_SERVICE_ACCOUNT: undefined, FIREBASE_DATABASE_URL: undefined }, m => {
    let threw = false;
    try { m.lgDatabaseUrl(); } catch (_) { threw = true; }
    check('with no service account it throws rather than guessing a database', threw, true);
  });

  /* אף קובץ לא מחזיק את הכתובת בעצמו יותר */
  const hard = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js'))
    .filter(f => /const DATABASE_URL = 'https/.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')));
  check('no endpoint hard-codes a database URL any more', hard, []);
}

/* ── הדפדפן: איזה פרויקט Firebase נבחר, ולפי מה ─────────────────────── */
/*
 * לאתר אין שלב בנייה, ולכן אין איך להזריק משתנה סביבה לדפדפן. הבחירה היא
 * לפי שם המארח.
 *
 * ⚠️ כיוון הסכנה אינו סימטרי, וזה כל מה שקובע כאן:
 *   ייצור שמצביע על בדיקות  → מסך ריק. רועש, מיידי, הפיך.
 *   בדיקות שמצביעות על ייצור → הזמנות בדיקה נכתבות לנתונים אמיתיים, בשקט.
 * לכן רק מארח ברשימה מפורשת מקבל את הייצור, וכל השאר מקבלים בדיקות.
 */
{
  const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const m = DB.match(/const LG_PROD_HOSTS[\s\S]*?function lgEnvForHost[\s\S]*?\n}/);
  check('the host→environment mapping exists and is isolated enough to test', !!m, true);
  const lgEnvForHost = new Function(m[0] + '; return lgEnvForHost;')();

  check('the production host gets production', lgEnvForHost('luzglass.vercel.app'), 'production');
  check('and case does not matter', lgEnvForHost('LUZGLASS.VERCEL.APP'), 'production');

  /* everything else is test — each of these would be a silent corruption
     if it resolved the other way */
  const mustBeTest = ['luz-glass-test.vercel.app', 'localhost', '127.0.0.1', '',
                      'luzglass-git-main-benluz.vercel.app', 'luzglass.co.il',
                      'evil.example.com', 'luzglass.vercel.app.evil.com'];
  const leaked = mustBeTest.filter(h => lgEnvForHost(h) === 'production');
  check('no other host reaches production — including a look-alike domain', leaked, []);

  /* the list itself */
  const hosts = new Function(m[0] + '; return LG_PROD_HOSTS;')();
  check('exactly one production host is listed today', hosts, ['luzglass.vercel.app']);

  /* both configs present, and pointing at different projects */
  check('both environments are defined',
        /production: \{[\s\S]*?projectId:\s*'lussglass'/.test(DB) &&
        /test: \{[\s\S]*?projectId:\s*'luz-glass-test'/.test(DB), true);
  check('and the test config points at the test database',
        /luz-glass-test-default-rtdb\.europe-west1/.test(DB), true);
  check('firebase is initialised from the selected config, not a literal',
        /firebase\.initializeApp\(LG_CONFIG\)/.test(DB) &&
        /const LG_CONFIG\s*=\s*LG_ENVIRONMENTS\[LG_ENV_NAME\]/.test(DB), true);

  /* the badge is the loud half of the safety story: if production ever
     resolves to test, it appears there and the mistake is visible */
  check('a test environment paints a permanent badge',
        /id = 'lgEnvBadge'/.test(DB) && /if \(!LG_IS_TEST/.test(DB), true);
  check('and the badge names the project, so you know which one',
        /LG_CONFIG\.projectId/.test(DB), true);

  /* the CSP must allow the test auth domain, or login breaks there */
  const vercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  check('the CSP allows both auth domains',
        /lussglass\.firebaseapp\.com/.test(vercel) &&
        /luz-glass-test\.firebaseapp\.com/.test(vercel), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll environment-isolation checks passed.');
