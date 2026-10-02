#!/usr/bin/env node
/**
 * שכבת הספק, תור היציאה והקצב.
 *
 * ─── מה נבדק כאן ──────────────────────────────────────────────────────
 *
 * שתי טענות שהכל תלוי בהן:
 *
 *   1. **הפרודקשן לא השתנה.** סביבה שאינה מגדירה WA_PROVIDER מקבלת Meta
 *      עם 250ms, 60 להרצה, בלי תור, ועם אותם שני פרמטרים לתבנית.
 *
 *   2. **ה-idempotency עובד באמת.** לא "יש קוד שנראה כמו טרנזקציה" אלא:
 *      לחיצה כפולה לא מייצרת הודעה שנייה, retry שולח רק את מה שנכשל,
 *      והצלחה נעולה לנצח.
 *
 * ⚠️ הבדיקות מריצות את הקוד עצמו מול בסיס נתונים מדומה, ולא בודקות טקסט.
 * הניסיון בפרויקט הזה: בדיקה שמחפשת מחרוזת עברה בהצלחה על קוד שבור, וגם
 * נכשלה בגלל הערה שציטטה קוד שהוסר.
 *
 * Run: node scripts/test-whatsapp-provider.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MODULES = ['api/_env.js', 'api/_wa-provider.js', 'api/_wa-recipient.js', 'api/_wa-outbox.js'];
function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.keys(vars).forEach(k => {
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  });
  MODULES.forEach(m => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  try { return fn(require(path.join(ROOT, 'api', '_wa-provider.js'))); }
  finally { process.env = saved; }
}
const sa = id => JSON.stringify({ project_id: id, client_email: 'x@y', private_key: 'k' });

const META_ENV = {
  FIREBASE_SERVICE_ACCOUNT: sa('lussglass'),
  WA_PHONE_NUMBER_ID: '111', WA_ACCESS_TOKEN: 'meta-token', WA_TEMPLATE_NAME: 'order_ready',
  WA_PROVIDER: undefined, GREENAPI_TOKEN: undefined, GREENAPI_ID_INSTANCE: undefined,
  GREENAPI_TEST_ENABLED: undefined, GREENAPI_TEST_TO: undefined,
  GREENAPI_GAP_MS: undefined, GREENAPI_MAX_PER_RUN: undefined,
};
const GREEN_ENV = {
  ...META_ENV,
  FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test'),
  WA_PROVIDER: 'green',
  GREENAPI_ID_INSTANCE: '1101900001', GREENAPI_TOKEN: 'SECRET-TOKEN-abc',
  GREENAPI_TEST_ENABLED: '1', GREENAPI_TEST_TO: '0501234567',
};

/* ═══ 1 · הפרודקשן לא השתנה ═════════════════════════════════════════ */
{
  withEnv(META_ENV, m => {
    const p = m.lgWaProvider();
    check('with no WA_PROVIDER the provider is meta', p.name, 'meta');
    check('meta keeps the gap it always had',         p.gapMs, 250);
    check('meta keeps the per-run cap it always had', p.maxPerRun, 60);
    /* ⚠️ תור היה משנה את התנהגות הייצור — בדיוק מה שנאסר */
    check('meta does NOT go through a queue',         p.queued, false);
    check('and it is configured when Meta vars exist', p.configured, true);
    /* התבנית מקבלת שני משתנים. עבור ready עם הזמנה אחת זו אותה מחרוזת
       בדיוק שנשלחה עד היום — וזה מה שנועל את אי-השינוי. */
    check('the template params are byte-identical to before',
          p.params({ kind: 'ready', clientName: 'דני', orderNums: ['L1234'] }),
          ['דני', 'L1234']);
    check('a missing client name still falls back exactly as before',
          p.params({ kind: 'ready', clientName: '', orderNums: ['L1'] }), ['לקוח', 'L1']);
  });

  /* ערך לא מוכר נופל ל-meta, לא לשקט ולא לשגיאה */
  for (const v of ['', 'META', 'Meta', 'twilio', 'greenish', 'yes']) {
    withEnv({ ...META_ENV, WA_PROVIDER: v }, m =>
      check('WA_PROVIDER=' + JSON.stringify(v) + ' falls back to meta',
            m.lgWaProvider().name, 'meta'));
  }
  withEnv({ ...META_ENV, WA_PROVIDER: ' GREEN ' }, m =>
    check('only an exact "green" (trimmed, any case) switches provider',
          m.lgWaProvider().name, 'green'));

  /* בייצור בלי משתני Meta — לא מוגדר, ולכן לא שולח. אותה התנהגות כמו תמיד. */
  withEnv({ ...META_ENV, WA_ACCESS_TOKEN: undefined }, m =>
    check('meta without a token reports itself unconfigured',
          m.lgWaProvider().configured, false));
}

/* ═══ 2 · הקצב של GREEN API ═════════════════════════════════════════ */
{
  withEnv(GREEN_ENV, m => {
    const p = m.lgWaProvider();
    check('green defaults to 10 seconds between recipients', p.gapMs, 10000);
    /* ⚠️ חייב תור: 40 נמענים × 10 שניות = מעל 6 דקות, ואין request כזה */
    check('green must go through the queue',                 p.queued, true);
    check('and its per-run cap is small',                    p.maxPerRun, 10);
  });

  withEnv({ ...GREEN_ENV, GREENAPI_GAP_MS: '3000' }, m =>
    check('the gap is configurable from the environment', m.lgWaProvider().gapMs, 3000));
  withEnv({ ...GREEN_ENV, GREENAPI_MAX_PER_RUN: '4' }, m =>
    check('so is the per-run cap', m.lgWaProvider().maxPerRun, 4));
  for (const bad of ['', 'abc', '-5', undefined]) {
    withEnv({ ...GREEN_ENV, GREENAPI_GAP_MS: bad }, m =>
      check('a nonsense gap (' + JSON.stringify(bad) + ') falls back to 10s',
            m.lgWaProvider().gapMs, 10000));
  }

  /* ⚠️ GREEN API מגדירים שפחות מ-500ms בין צ'אטים שונים נחשב דיוור
     אוטומטי. גם אם מישהו יגדיר 10ms, לא יורדים מתחת לרצפה. */
  withEnv({ ...GREEN_ENV, GREENAPI_GAP_MS: '10' }, m => {
    const p = m.lgWaProvider();
    const gaps = Array.from({ length: 200 }, () => p.nextGap());
    check('never below the 500ms floor they define themselves',
          gaps.filter(g => g < 500).length, 0);
  });

  /* מרווח קבוע מושלם הוא חתימת בוט — ולכן ±30% ולא ערך אחד */
  withEnv(GREEN_ENV, m => {
    const p = m.lgWaProvider();
    const gaps = Array.from({ length: 400 }, () => p.nextGap());
    check('the gap is jittered, not constant', new Set(gaps).size > 50, true);
    check('and stays inside ±30%',
          gaps.filter(g => g < 7000 || g > 13000).length, 0);
  });
  withEnv(META_ENV, m => {
    const p = m.lgWaProvider();
    /* ⚠️ אצל Meta אין jitter — זה היה שינוי בהתנהגות הייצור */
    check('meta has no jitter at all',
          new Set(Array.from({ length: 50 }, () => p.nextGap())), new Set([250]));
  });
}

/* ═══ 3 · השער המשותף — שש נעילות, קוד אחד לשתי הסביבות ═══════════ */
//
//  ⚠️ אין בשער שום הסתעפות על "איזו סביבה זו" לצורך לוגיקה עסקית.
//  ההבדל היחיד שמודע לסביבה הוא ה-invariant של הרשימה החתומה, והוא
//  בדיקת שפיות ולא כלל עסקי.
{
  const LIVE = { ...GREEN_ENV,
    FIREBASE_SERVICE_ACCOUNT:  sa('lussglass'),
    GREENAPI_ALLOWED_ACCOUNTS: 'lussglass:14201',
    GREENAPI_ONLY_TO:          undefined };        // בייצור אין נעילת נמען
  const TESTENV = { ...GREEN_ENV,
    GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:TEST-WA',
    GREENAPI_ONLY_TO:          '0547725552' };

  /* ── TEST ── */
  withEnv(TESTENV, m => {
    const p = m.lgWaProvider();
    check('TEST-WA with the test number passes',
          p.gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, true);
    check('and the number may be written with dashes',
          p.gate({ accountKey: 'TEST-WA', phone: '054-772-5552' }).allowed, true);

    /* ⚠️ נעילה 6 — "GREENAPI_ONLY_TO חוסם נמען אחר" */
    check('GREENAPI_ONLY_TO blocks a different recipient',
          p.gate({ accountKey: 'TEST-WA', phone: '0509999999' }).allowed, false);
    check('and says so, rather than silently redirecting',
          /אינו המספר המורשה/.test(p.gate({ accountKey: 'TEST-WA', phone: '0509999999' }).reason), true);

    /* ⚠️ נעילה 3 — "הזמנה ללא כרטיס נחסמת" */
    for (const k of [null, undefined, '', '   ']) {
      check('an order with no account card is blocked (' + JSON.stringify(k) + ')',
            p.gate({ accountKey: k, phone: '0547725552' }).allowed, false);
    }
    check('and the reason names the missing card',
          /אין כרטיס לקוח/.test(p.gate({ accountKey: null, phone: '0547725552' }).reason), true);

    /* ⚠️ נעילה 5 — "account שאינו מורשה נחסם" */
    check('an account outside the allowlist is blocked',
          p.gate({ accountKey: '14201', phone: '0547725552' }).allowed, false);
    check('and the reason names it',
          /14201 אינו ברשימת המורשים/.test(p.gate({ accountKey: '14201', phone: '0547725552' }).reason), true);
  });

  /* ── ה-invariant: הרשימה חתומה על שם הפרויקט ──
     ⚠️ הדרישה המרכזית: טעות אנוש שתעתיק את משתני הייצור לפרויקט TEST
     לא תאפשר ל-TEST לשלוח ללקוחות אמיתיים. */
  withEnv({ ...TESTENV, GREENAPI_ALLOWED_ACCOUNTS: 'lussglass:14201' }, m => {
    const p = m.lgWaProvider();
    check('copying the production allowlist into TEST blocks the real customer',
          p.gate({ accountKey: '14201', phone: '0505887576' }).allowed, false);
    check('and blocks everything else too — not partially',
          p.gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false);
    check('the reason points at the mismatch, not at the customer',
          /מונפקת לפרויקט lussglass/.test(p.gate({ accountKey: '14201' }).reason), true);
  });
  /* ⚠️ והכיוון ההפוך: רשימת TEST לא פותחת כלום בייצור */
  withEnv({ ...LIVE, GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:TEST-WA' }, m =>
    check('and a TEST allowlist opens nothing on production',
          m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false));

  check('TEST-WA works under luz-glass-test, and only where the list says so',
        [ withEnv(TESTENV, m => m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed),
          withEnv({ ...TESTENV, FIREBASE_SERVICE_ACCOUNT: sa('lussglass') },
                  m => m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed) ],
        [true, false]);

  /* ── ייצור: אותו קוד, הגדרה אחרת ── */
  withEnv(LIVE, m => {
    const p = m.lgWaProvider();
    check('the approved pilot customer passes on production',
          p.gate({ accountKey: '14201', phone: '0505887576' }).allowed, true);
    /* ⚠️ בייצור אין נעילת נמען — חייבים לשלוח לכל לקוח מאושר */
    check('and any phone of theirs is fine, because ONLY_TO is unset',
          p.gate({ accountKey: '14201', phone: '0500000000' }).allowed, true);
    check('while a different customer is still blocked',
          p.gate({ accountKey: '9021', phone: '0525187857' }).allowed, false);
    check('and a missing card is blocked on production too',
          p.gate({ accountKey: null, phone: '0505887576' }).allowed, false);
  });

  /* ── נעילות 1, 2, 4 ── */
  withEnv({ ...TESTENV, WA_PROVIDER: undefined }, m =>
    check('without WA_PROVIDER=green nothing is allowed',
          m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false));
  for (const bad of [undefined, '', '   ', 'TEST-WA', ':TEST-WA', 'luz-glass-test:', 'luz-glass-test']) {
    withEnv({ ...TESTENV, GREENAPI_ALLOWED_ACCOUNTS: bad }, m =>
      check('a malformed allowlist (' + JSON.stringify(bad) + ') blocks everything',
            m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false));
  }
  withEnv({ ...TESTENV, GREENAPI_TOKEN: undefined }, m =>
    check('missing credentials block',
          m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false));
  withEnv({ ...TESTENV, FIREBASE_SERVICE_ACCOUNT: '{bad json' }, m =>
    check('an unreadable service account blocks — fail-safe, not fail-open',
          m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0547725552' }).allowed, false));

  /* ── רשימה עם כמה לקוחות ── */
  withEnv({ ...LIVE, GREENAPI_ALLOWED_ACCOUNTS: 'lussglass:14201, 9021 ,509' }, m => {
    const p = m.lgWaProvider();
    check('several accounts can be approved, spaces and all',
          ['14201', '9021', '509', '999'].map(k => p.gate({ accountKey: k }).allowed),
          [true, true, true, false]);
  });

  /* ⚠️ אותה רשימה לשני סוגי ההודעות: השער אינו מקבל kind בכלל, ולכן אי
     אפשר לאשר ready ולשכוח dispatched */
  const ENVSRC = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  const gateFn = ENVSRC.slice(ENVSRC.indexOf('function lgGreenApiGate'));
  check('the gate cannot tell ready from dispatched — one list covers both',
        /\bkind\b/.test(gateFn.slice(0, gateFn.indexOf('\n}'))), false);

  /* ── Meta לא נגעה ── */
  withEnv(META_ENV, m =>
    check('meta is still allowed on production', m.lgWaProvider().gate({}).allowed, true));
  withEnv({ ...META_ENV, FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test') }, m =>
    check('and blocked everywhere else', m.lgWaProvider().gate({}).allowed, false));
  withEnv({ ...META_ENV, LG_ENV: 'test' }, m =>
    check('LG_ENV=test still blocks meta even on production',
          m.lgWaProvider().gate({}).allowed, false));
  /* ⚠️ ומסלול Meta אינו רואה את הרשימה בכלל */
  withEnv({ ...META_ENV, GREENAPI_ALLOWED_ACCOUNTS: 'lussglass:999' }, m =>
    check('meta ignores the allowlist entirely', m.lgWaProvider().gate({}).allowed, true));
}

/* ═══ 3ב · מה שהשער עצמו מחזיר ═════════════════════════════════════ */
//
//  הועבר מ-scripts/test-greenapi.js, שנמחק: הוא נבנה סביב lgGreenApiTest
//  ובדק את אותו שער מזווית שנייה. שני קבצים שבודקים שער אחד הם בדיוק
//  התחזוקה הכפולה שאנחנו מנסים למנוע.
{
  const SECRET = 'SECRET-TOKEN-abc123xyz';
  withEnv({ ...GREEN_ENV,
            GREENAPI_TOKEN: SECRET,
            GREENAPI_ID_INSTANCE: '1101900001',
            GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:TEST-WA',
            GREENAPI_ONLY_TO: '0501234567' }, m => {
    const g = m.lgWaProvider().gate({ accountKey: 'TEST-WA', phone: '0501234567' });
    const asText = JSON.stringify(g);
    /* ⚠️ ב-GREEN API הטוקן יושב בתוך ה-URL, ולכן כל אובייקט שמכיל אותו
       עלול להגיע ללוג או לתשובה. השער מחזיר החלטה בלבד. */
    check('the gate never returns the token',  asText.includes(SECRET), false);
    check('nor the instance id',               asText.includes('1101900001'), false);
    check('only the decision and its reason',  Object.keys(g).sort(), ['allowed', 'reason']);
  });

  /* החסימה הגלובלית לא ידעה ולא תדע דבר על GREEN API */
  const ENV3 = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  const ext  = (ENV3.match(/function lgExternal\(\)[\s\S]*?\n\}/) || [''])[0];
  check('lgExternal is untouched by the GREEN API gate', /GREENAPI/.test(ext), false);

  /* ומסלול Meta אינו קורא אף אישור של GREEN API */
  const strip3 = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const SEND3  = strip3(fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8'));
  check('the sender never reads a GREEN API credential',
        /GREENAPI_(TOKEN|ID_INSTANCE|ALLOWED|ONLY_TO)/.test(SEND3), false);
}

/* ═══ 3ג · נוסח ההודעה ושם הסקיצה ══════════════════════════════════ */
//
//  ⚠️ מספר ההזמנה הוא המזהה **שלנו**. שם הסקיצה הוא מה שהלקוח הקליד
//  בתור הסקיצות, ומה שהפורטל מציג לו — ולכן זה מה שהוא מזהה לפיו את
//  העבודה. שרשרת ה-fallback אינה חדשה: היא זו של lgNormalizeOrder.
{
  const R = (kind, nums, sketches, who) =>
    m0.renderText({ kind, clientName: who || 'דני', orderNums: nums, sketchNames: sketches });
  const m0 = require(path.join(ROOT, 'api', '_wa-provider.js'));

  /* ── ready ── */
  const ready1 = R('ready', ['L1234'], ['מקלחון']);
  check('ready names the order and the sketch', /ההזמנה L1234 — מקלחון מוכנה לאיסוף\./.test(ready1), true);
  check('and greets the client',                /^שלום דני,\n\n/.test(ready1), true);
  check('and points at the portal',
        /לפרטים נוספים ניתן להיכנס למשתמש שלך בלוז גלאס ולצפות בפרטי ההזמנה\./.test(ready1), true);
  check('and signs off',                        /לוז זגגות ומראות האחים בע"מ$/.test(ready1), true);

  /* ⚠️ בלי שם — רק המספר, **בלי מקף תלוי באוויר** */
  const ready0 = R('ready', ['L1234'], ['']);
  check('without a sketch name the order still goes out',
        /ההזמנה L1234 מוכנה לאיסוף\./.test(ready0), true);
  check('and no dangling dash is left behind', /—/.test(ready0), false);
  for (const empty of [null, undefined, '   ', []]) {
    const t = m0.renderText({ kind: 'ready', clientName: 'דני', orderNums: ['L1'],
                              sketchNames: Array.isArray(empty) ? empty : [empty] });
    check('an empty sketch name (' + JSON.stringify(empty) + ') leaves no dash', /—/.test(t), false);
  }

  /* ── dispatched ── */
  const one = R('dispatched', ['L1234'], ['מקלחון']);
  check('a single delivery reads naturally',
        /ההובלה יצאה אליך עם הזמנה L1234 — מקלחון\./.test(one), true);

  const two = R('dispatched', ['L1234', 'L1235'], ['מקלחון', 'מראה']);
  check('a grouped delivery lists every order on its own line',
        /ההובלה יצאה אליך עם ההזמנות:\n• L1234 — מקלחון\n• L1235 — מראה/.test(two), true);
  /* ⚠️ הודעה אחת, לא אחת לכל הזמנה — זה הכלל שבן קבע */
  check('and it is still one message, not one per order',
        (two.match(/שלום/g) || []).length, 1);
  check('each order keeps its own sketch name',
        two.includes('L1234 — מקלחון') && two.includes('L1235 — מראה'), true);

  /* ⚠️ המקרה המעורב: לאחת יש שם ולשנייה אין */
  const mixed = R('dispatched', ['L1234', 'L1235'], ['מקלחון', '']);
  check('a group where one order has no name keeps the other intact',
        /• L1234 — מקלחון\n• L1235\n/.test(mixed + '\n'), true);
  check('and the nameless one carries no dash',
        (mixed.match(/—/g) || []).length, 1);

  /* ── שם הסקיצה: שרשרת ה-fallback, הגדרה אחת ── */
  const { orderSketchName } = require(path.join(ROOT, 'api', '_wa-recipient.js'));
  check('sketchName wins',            orderSketchName({ sketchName: 'א', type: 'ב', desc: 'ג' }), 'א');
  check('then type',                  orderSketchName({ type: 'ב', desc: 'ג' }), 'ב');
  check('then desc',                  orderSketchName({ desc: 'ג' }), 'ג');
  check('and nothing is an answer',   orderSketchName({}), '');
  check('whitespace is not a name',   orderSketchName({ sketchName: '   ' }), '');
  /* ⚠️ אותה שרשרת בדיוק כמו lgNormalizeOrder — לא עותק שהתפצל */
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('the chain matches the one lgNormalizeOrder already uses',
        /sketchName:\s+o\.sketchName\s+\|\| o\.type\s+\|\| o\.desc \|\| ''/.test(FB), true);

  /* ── Meta לא ראתה דבר מזה ── */
  withEnv(META_ENV, m =>
    /* ⚠️ לתבנית של Meta שני משתנים קבועים. שם הסקיצה אינו נכנס אליהם,
       אחרת התנהגות הייצור הייתה משתנה. */
    check('the meta template params are untouched by the sketch name',
          m.lgWaProvider().params({ kind: 'ready', clientName: 'דני',
                                    orderNums: ['L1234'], sketchNames: ['מקלחון'] }),
          ['דני', 'L1234']));
}

/* ═══ 3ה · הטוסט שותק כשאין WhatsApp בסביבה ════════════════════════ */
//
//  ⚠️ "WhatsApp אינו מוגדר כאן" הוא מצב, לא תקלה. המזכירה לא אמורה לראות
//  אותו בכל "סיים הובלה". אבל נחסם או נכשל — כן.
{
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  const report   = (WD.match(/function _waReport[\s\S]*?\n}/) || [''])[0];
  const dispatch = (WD.match(/async function _waDispatch[\s\S]*?\n}/) || [''])[0];

  for (const [name, fn] of [['the ready path', report], ['the delivery path', dispatch]]) {
    check(name + ' stays silent when WhatsApp is not configured',
          /if\(!data\.configured\)\{/.test(fn), true);
    check(name + ' still leaves something in the console',
          /console\.info\('\[WhatsApp\]/.test(fn), true);
    check(name + ' returns without a toast in that case',
          /console\.info\([\s\S]{0,120}?\n\s*return;/.test(fn), true);
  }
  /* ⚠️ ומה שכן חייב להישאר גלוי */
  check('a mixed-phone refusal is still shown', /res\.status === 409/.test(dispatch), true);
  check('and a real block is still shown',      /הודעת ההובלה לא נשלחה/.test(dispatch), true);
  check('a failed send is still shown',         /נכשלו/.test(report), true);

  /* השרת מספק את הדגל שהמסך מסתמך עליו */
  const DISP = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-dispatch.js'), 'utf8');
  check('the dispatch endpoint reports whether the provider is configured',
        (DISP.match(/configured: provider\.configured/g) || []).length, 2);
}

/* ═══ 4 · הטוקן אינו דולף ═══════════════════════════════════════════ */
{
  const SRC = fs.readFileSync(path.join(ROOT, 'api', '_wa-provider.js'), 'utf8');
  /* ⚠️ נלמד בדרך הקשה 2026-10-01: GREEN API מחזירה את ה-URL (ובו הטוקן)
     בשדה path של גוף השגיאה. הגוף הגולמי לא יוצא מכאן. */
  check('the raw GREEN API body is never returned',
        /\braw\b\s*[,}]/.test(SRC.split('return {')[2] || ''), false);
  check('a redactor exists and is built from the token',
        /const redact = s => String\(s == null \? '' : s\)\.split\(token\)\.join\('\*\*\*'\)/.test(SRC), true);
  check('the failure reason goes through it',  /reason:\s+ok \? null\s+: redact\(/.test(SRC), true);
  check('and so does the detail',              /detail:\s+ok \? 'sent' : redact\(/.test(SRC), true);
  check('the url is never logged',             /console\.(log|error)\([^)]*\burl\b/.test(SRC), false);
  /* ⚠️ רק בחלק של GREEN API. אצל Meta הטוקן יושב ב-header ולא ב-URL, ולכן
     e.message שם אינו סוד — וזו גם ההתנהגות של היום שאסור לשנות. */
  /* ⚠️ מפשיטים הערות לפני בדיקת היעדרות. זו טעות שחזרה בפרויקט הזה ארבע
     פעמים: הביטוי תפס את ההערה שמסבירה למה הקוד הוסר, והבדיקה נכשלה על
     תיעוד נכון. בדיקת "אין X" חייבת לרוץ על קוד חי בלבד. */
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const green = strip(SRC.slice(SRC.indexOf('function greenProvider')));
  check('a GREEN API network error reports its name, not its message',
        /e && e\.name/.test(green) && !/e\.message/.test(green), true);
  check('while meta keeps using e.message, as it always did',
        /e\.message/.test(strip(SRC.slice(SRC.indexOf('function metaProvider'),
                                         SRC.indexOf('function greenProvider')))), true);
  check('the token never reaches a returned object literal',
        /(messageId|detail|reason|params)[^\n]*\btoken\b/.test(SRC), false);
}

/* ═══ 5 · התור — idempotency אמיתי מול בסיס מדומה ═══════════════════ */

//  בסיס נתונים מדומה עם טרנזקציות. מספיק קטן כדי להיות ברור, ומדויק
//  במה שחשוב: transaction שמחזירה undefined היא abort.
function fakeDb(initial) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  const keys = p => String(p).split('/').filter(Boolean);
  const get  = p => keys(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const put  = (p, v) => {
    const ks = keys(p); let o = data;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const snapOf = v => ({
    val: () => (v === undefined ? null : v),
    exists: () => v !== undefined,
    forEach(cb) {
      // מסודר לפי createdAt, כמו orderByChild בפועל
      Object.keys(v || {})
        .sort((a, b) => ((v[a] || {}).createdAt || 0) - ((v[b] || {}).createdAt || 0))
        .forEach(k => cb({ key: k, val: () => v[k] }));
    },
  });
  return {
    _data: data,
    ref(p) {
      const self = {
        orderByChild: () => self, limitToFirst: () => self,
        once: async () => snapOf(get(p)),
        set:  async v => put(p, v),
        update: async v => put(p, { ...(get(p) || {}), ...v }),
        //  ⚠️ פיירבייס קוראת לפונקציה **פעמיים**: תחילה עם הערך שבמטמון
        //  המקומי — שהוא null — ורק אחר כך עם הערך מהשרת. פונקציה שמחזירה
        //  undefined בקריאה הראשונה מבטלת את הטרנזקציה כולה, ופיירבייס
        //  לעולם לא מביאה את הערך האמיתי.
        //
        //  הכפיל הקודם קרא פעם אחת בלבד, עם הערך האמיתי. הוא היה נדיב מדי,
        //  ולכן אחת-עשרה בדיקות idempotency עברו על קוד ששום תפיסה בו לא
        //  עבדה בפועל. L9005 נתקעה בתור בגלל בדיוק זה.
        async transaction(fn) {
          const first = fn(null);
          if (first === undefined) return { committed: false, snapshot: snapOf(undefined) };
          const cur  = get(p);
          const next = fn(cur === undefined ? null : cur);
          if (next === undefined) return { committed: false, snapshot: snapOf(cur) };
          put(p, next); return { committed: true, snapshot: snapOf(next) };
        },
      };
      return self;
    },
  };
}

const ob = require(path.join(ROOT, 'api', '_wa-outbox.js'));

/* ── המפתח ── */
{
  check('the key is deterministic',
        ob.lgWaMsgKey('ready', ['a', 'b']), ob.lgWaMsgKey('ready', ['a', 'b']));
  /* ⚠️ בלי מיון, ['b','a'] ו-['a','b'] היו שתי הודעות לאותו לקוח */
  check('and order-independent — the ids are sorted',
        ob.lgWaMsgKey('ready', ['b', 'a']), ob.lgWaMsgKey('ready', ['a', 'b']));
  check('duplicates in the list do not change it',
        ob.lgWaMsgKey('ready', ['a', 'a', 'b']), ob.lgWaMsgKey('ready', ['a', 'b']));
  /* אותן הזמנות בדיוק יכולות לייצר שתי הודעות שונות — ולכן kind בגיבוב */
  check('but kind does change it',
        ob.lgWaMsgKey('ready', ['a']) === ob.lgWaMsgKey('dispatched', ['a']), false);
}

/* ── תיעוד מקור המספר ───────────────────────────────────────────────── */
//
//  ⚠️ תיעוד, לא לוגיקה. השדות האלה אינם קובעים למי נשלח — resolvePhone
//  כבר הכריע — אלא עונים על "דרך מה נמצא המספר". בחקירת L9005 בדיוק
//  המידע הזה היה חסר מהחותמת, ולכן אי אפשר היה לענות בדיעבד.
(async () => {
  const db = fakeDb({});
  const q = await ob.lgWaEnqueue(db, {
    kind: 'ready', to: '0501234567', clientName: 'דני',
    orderNums: ['L1'], orderIds: ['o1'], queuedBy: 'admin',
    phoneSource: 'hashavshevet', accountKey: 'TEST-WA',
  });
  const e = db._data.waOutbox[q.key];
  check('the queue records how the number was found', e.phoneSource, 'hashavshevet');
  check('and which account card it came from',        e.accountKey, 'TEST-WA');

  /* נפילה לטלפון שעל ההזמנה — גם היא חייבת להירשם */
  const db2 = fakeDb({});
  const q2 = await ob.lgWaEnqueue(db2, {
    kind: 'ready', to: '0509999999', clientName: 'ל', orderNums: ['L2'],
    orderIds: ['o2'], queuedBy: 'a', phoneSource: 'order', accountKey: null,
  });
  check('a fallback to the order phone is recorded as such',
        db2._data.waOutbox[q2.key].phoneSource, 'order');
  /* ⚠️ null הופך למחרוזת ריקה ולא נעלם — פיירבייס משמיט undefined בשקט,
     וחסר שדה אינו מבדיל בין "אין כרטיס" לבין "לא נרשם" */
  check('and a missing account key is empty, not absent',
        db2._data.waOutbox[q2.key].accountKey, '');

  /* ⚠️ accountKey כבר אינו תיעוד בלבד — הוא **מפתח ההרשאה** של השער.
     phoneSource נשאר תיעוד טהור, ואסור שישפיע על החלטה כלשהי. */
  const PROV = fs.readFileSync(path.join(ROOT, 'api', '_wa-provider.js'), 'utf8');
  check('phoneSource never influences a decision',
        /phoneSource/.test(PROV), false);
  const ENVSRC2 = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  check('while accountKey is what the gate authorises on',
        /env\.keys\.indexOf\(key\) < 0/.test(ENVSRC2), true);
  const REC = fs.readFileSync(path.join(ROOT, 'api', '_wa-recipient.js'), 'utf8');
  check('and resolvePhone itself was not touched',
        /return \{ phone: norm\(acc\.phone\), source: 'hashavshevet', accountKey: String\(key\) \};/.test(REC), true);

  /* ⚠️ החותמת משקפת את מה שנפתר **ברגע השליחה**, לא את מה שנשמר בהכנסה
     לתור. מה שנשמר נשאר לצד זה, כדי שאפשר יהיה לראות פער. */
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  check('the stamp records what actually decided the send',
        /phoneSource: live\.source/.test(DRAIN) && /accountKey:\s+live\.accountKey/.test(DRAIN), true);
  check('and keeps the queued value beside it for comparison',
        /queuedAccountKey: entry\.accountKey/.test(DRAIN), true);
})();

/* ═══ 5ו · הבדיקה החוזרת מהנתונים החיים ════════════════════════════ */
//
//  ⚠️ ה-accountKey שברשומה הוא תיעוד, לא הרשאה. בין ההכנסה לתור לבין
//  השליחה יכולים לחלוף דקות: הכרטיס יכול להשתנות, הלקוח יכול לרדת
//  מרשימת המורשים, וההזמנה יכולה להיות מסומנת פיקטיבית.
{
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');

  check('the drain re-resolves the card from the order before sending',
        /const live = await resolvePhone\(db, order\);/.test(DRAIN), true);
  /* ⚠️ הסדר הוא העיקר: הפתרון מחדש **לפני** השער, והשער לפני השליחה */
  check('and it does so before the gate, which is before the send',
        DRAIN.indexOf('await resolvePhone(db, order)') < DRAIN.indexOf('provider.gate(') &&
        DRAIN.indexOf('provider.gate(') < DRAIN.indexOf('await provider.send('), true);
  check('the gate is asked with the live result, not the stored one',
        /provider\.gate\(\{ phone: live\.phone, accountKey: live\.accountKey \}\)/.test(DRAIN), true);
  /* ⚠️ לא רק ההרשאה — גם הנמען. הכרטיס הוא מקור האמת בשני הדברים. */
  check('and the message goes to the live phone, not the queued one',
        /to:\s+live\.phone/.test(DRAIN), true);
  check('the stored accountKey is never consulted for permission',
        /entry\.accountKey/.test(DRAIN.slice(DRAIN.indexOf('const live ='),
                                             DRAIN.indexOf('await provider.send('))), false);

  /* הזמנה שנעלמה או סומנה פיקטיבית אחרי ההכנסה לתור */
  check('an order that vanished blocks the send', /ההזמנה לא נמצאה/.test(DRAIN), true);
  check('and one marked fictitious after queueing blocks too',
        /if \(order\.isTest\)/.test(DRAIN), true);
  check('a blocked message is closed as failed, not left hanging',
        (DRAIN.match(/status: 'blocked'/g) || []).length >= 3, true);
}

/* ── הכלי הזמני אינו קיים יותר ──────────────────────────────────────── */
{
  check('api/whatsapp-test.js is gone',
        fs.existsSync(path.join(ROOT, 'api', 'whatsapp-test.js')), false);
  /* ⚠️ אבל השער שלו נשאר ועבר תפקיד: הוא היום השער של ספק green */
  const ENV = fs.readFileSync(path.join(ROOT, 'api', '_env.js'), 'utf8');
  /* ⚠️ lgGreenApiTest הוחלף ב-lgGreenApiGate — שער אחד לשתי הסביבות.
     שתי פונקציות שער היו אומרות שכל תיקון עתידי צריך להיעשות פעמיים. */
  check('there is exactly one gate, not one per environment',
        [/function lgGreenApiGate/.test(ENV), /function lgGreenApiTest\s*\(/.test(ENV)], [true, false]);
  /* ⚠️ על קוד חי בלבד. ההפניה ההיסטורית בהערה של _env.js מסבירה מאיפה
     הנעילות הגיעו, והיא שווה יותר מההקפדה על היעדר המחרוזת. זו הפעם
     השלישית היום שביטוי "אין X" תפס תיעוד נכון. */
  const live = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const files = fs.readdirSync(path.join(ROOT, 'api'));
  check('and no live code references the removed tool',
        files.filter(f => live(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'))
                            .includes('whatsapp-test')), []);
}

/* ── לחיצה כפולה ── */
(async () => {
  const db = fakeDb({});
  const msg = { kind: 'ready', to: '0501234567', clientName: 'דני',
                orderNums: ['L1'], orderIds: ['o1'], queuedBy: 'admin' };

  const first  = await ob.lgWaEnqueue(db, msg);
  const second = await ob.lgWaEnqueue(db, msg);
  check('the first enqueue is accepted',  first.queued, true);
  /* ⚠️ זו הדרישה: לחיצה כפולה לא מייצרת הודעה שנייה */
  check('the second is refused — already queued', [second.queued, second.reason], [false, 'כבר בתור']);
  check('and there is exactly one entry in the outbox',
        Object.keys(db._data.waOutbox).length, 1);
  check('under the same key', second.key, first.key);

  /* ── התפיסה ── */
  const c1 = await ob.lgWaClaim(db, first.key, 'admin');
  check('a pending entry can be claimed', c1.claimed, true);
  check('and the attempt is counted',     db._data.waOutbox[first.key].attempts, 1);

  const c2 = await ob.lgWaClaim(db, first.key, 'admin2');
  /* ⚠️ שני drains במקביל — השני לא שולח את אותה הודעה */
  check('a freshly claimed entry cannot be claimed again', c2.claimed, false);

  /* ── הצלחה נעולה לנצח ── */
  await ob.lgWaComplete(db, first.key, { ok: true, messageId: 'M1', httpStatus: 200 });
  check('success marks it sent',  db._data.waOutbox[first.key].state, 'sent');
  const c3 = await ob.lgWaClaim(db, first.key, 'admin');
  check('a sent entry can never be claimed again', c3.claimed, false);
  const third = await ob.lgWaEnqueue(db, msg);
  /* ⚠️ וגם לא דרך הדלת הקדמית: אותה פעולה שוב לא מחזירה אותה לתור */
  check('nor re-enqueued', [third.queued, third.reason], [false, 'כבר נשלחה']);
  check('a sent entry is not retryable', await ob.lgWaPending(db, 10), []);
})();

/* ── retry שולח רק את מה שנכשל ── */
(async () => {
  const db = fakeDb({});
  const mk = (id, num) => ({ kind: 'ready', to: '0501234567', clientName: 'ל',
                             orderNums: [num], orderIds: [id], queuedBy: 'a' });
  const A = await ob.lgWaEnqueue(db, mk('o1', 'L1'));
  const B = await ob.lgWaEnqueue(db, mk('o2', 'L2'));

  // A הצליח, B נכשל
  await ob.lgWaClaim(db, A.key, 'a');
  await ob.lgWaComplete(db, A.key, { ok: true, messageId: 'M1', httpStatus: 200 });
  await ob.lgWaClaim(db, B.key, 'a');
  await ob.lgWaComplete(db, B.key, { ok: false, reason: 'GREEN API נפלה' });

  check('the failure is recorded as failed', db._data.waOutbox[B.key].state, 'failed');
  /* ⚠️ זה הסעיף שמאפשר retry: בכישלון התפיסה מתנקה */
  check('and its claim was released',        db._data.waOutbox[B.key].claimedAt, null);

  /* ⚠️ הדרישה במלואה: retry רואה רק את הכושל, לא את ה-batch */
  check('a retry sees only the failed one', await ob.lgWaPending(db, 10), [B.key]);
  const again = await ob.lgWaClaim(db, B.key, 'a');
  check('and can claim it',                 again.claimed, true);
  check('counting a second attempt',        db._data.waOutbox[B.key].attempts, 2);

  /* אחרי שלושה כישלונות מפסיקים — תקלה חוזרת צריכה להיראות, לא להסתובב */
  await ob.lgWaComplete(db, B.key, { ok: false, reason: 'שוב' });
  await ob.lgWaClaim(db, B.key, 'a');
  await ob.lgWaComplete(db, B.key, { ok: false, reason: 'ושוב' });
  check('after MAX_ATTEMPTS it stops being retried', await ob.lgWaPending(db, 10), []);
  check('and the last error is kept', db._data.waOutbox[B.key].lastError, 'ושוב');
})();

/* ── פג תוקף ── */
(async () => {
  const db = fakeDb({});
  const q  = await ob.lgWaEnqueue(db, { kind: 'ready', to: '0501234567', clientName: 'ל',
                                        orderNums: ['L9'], orderIds: ['o9'], queuedBy: 'a' });
  // מזקן את הרשומה ביממה ושנייה
  db._data.waOutbox[q.key].createdAt = Date.now() - ob.MAX_AGE_MS - 1000;
  const c = await ob.lgWaClaim(db, q.key, 'a');
  /* ⚠️ "ההזמנה מוכנה לאיסוף" שמגיעה יום אחרי שהלקוח אסף גרועה משום הודעה */
  check('a day-old message is not sent', c.claimed, false);
  check('it is closed as expired',       db._data.waOutbox[q.key].state, 'expired');
  check('and never retried',             await ob.lgWaPending(db, 10), []);
})();

/* ═══ 5ב · הלקח של הטרנזקציה ═══════════════════════════════════════ */
//
//  ⚠️ זה הבאג שהחזיק את L9005 בתור שעה שלמה (02/10/2026):
//
//      if (!cur) return;   // abort
//
//  פיירבייס קוראת לפונקציית העדכון פעמיים — תחילה עם המטמון המקומי,
//  שהוא null, ורק אחר כך עם הערך מהשרת. undefined פירושו "בטל", ולכן
//  הטרנזקציה מתה בקריאה הראשונה והערך האמיתי מעולם לא נקרא.
//
//  committed=false תמיד · attempts נשאר 0 · שום הודעה לא יצאה אי פעם.
{
  const SRC = fs.readFileSync(path.join(ROOT, 'api', '_wa-outbox.js'), 'utf8');
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const claim = strip(SRC.slice(SRC.indexOf('async function lgWaClaim'),
                               SRC.indexOf('async function lgWaComplete')));
  check('the claim never aborts on the initial null pass',
        /if\s*\(\s*!\s*cur\s*\)\s*return\s*;/.test(claim), false);
  check('it returns null there so firebase re-runs with the server value',
        /if\s*\(cur === null\)\s*return null;/.test(claim), true);
  /* ⚠️ commit על null פירושו שהרשומה באמת אינה קיימת — אחרת היינו
     "תופסים" רשומה ריקה ומנסים לשלוח אותה */
  check('and a commit on null is not treated as a claim',
        /if \(!entry\) return \{ claimed: false/.test(SRC), true);

  /* ואותה טעות לא חוזרת בהזמנת החלון */
  const slot = strip(SRC.slice(SRC.indexOf('async function lgWaReserveSlot')));
  check('the slot reservation never aborts on null either',
        /if\s*\(\s*!\s*cur\s*\)\s*return\s*;/.test(slot), false);
}

/* ═══ 5ג · הקצב גלובלי, לא לכל תהליך ═══════════════════════════════ */
//
//  ⚠️ הגרסה הראשונה הסתמכה על sleep בתוך ה-drain. שני טאבים פתוחים נתנו
//  קצב אפקטיבי של gap/2 — ו-WhatsApp סופרת את הקצב של **המספר**, לא של
//  התהליך ששלח. המרווח הוא תכונה של המופע, ולכן הוא חי בבסיס הנתונים.
(async () => {
  const GAP = 10000, MAX_WAIT = 15000;

  withEnv(GREEN_ENV, m => {
    check('green paces through the global slot', m.lgWaProvider().globalSlot, true);
  });
  withEnv(META_ENV, m => {
    /* ⚠️ Meta היא הערוץ הרשמי, אין סיכון חסימה, וההתנהגות בייצור לא זזה */
    check('meta does NOT — its pacing stays in-process', m.lgWaProvider().globalSlot, false);
  });

  const db = fakeDb({});
  const r1 = await ob.lgWaReserveSlot(db, GAP, MAX_WAIT);
  const r2 = await ob.lgWaReserveSlot(db, GAP, MAX_WAIT);

  check('the first sender goes immediately', [r1.ok, r1.waitMs < 500], [true, true]);
  /* ⚠️ זו הטענה שבן ביקש: שני drain-ים מקבילים לא יכולים לשלוח לשני
     נמענים בתוך פחות מ-10 שניות. השני **חייב** להמתין gap מלא. */
  check('a second concurrent sender must wait a full gap',
        [r2.ok, r2.waitMs >= GAP - 500], [true, true]);
  check('and their send windows are a full gap apart',
        r2.slotAt - r1.slotAt >= GAP, true);

  /* השלישי כבר מעבר למה שמותר להמתין — נסוג במקום לתפוס עתיד רחוק */
  const r3 = await ob.lgWaReserveSlot(db, GAP, MAX_WAIT);
  check('a third one is refused rather than queued far into the future', r3.ok, false);
  check('and refusing costs nothing — it took no window',
        db._data.waMeta.sendSlot.nextAllowedAt - Date.now() <= 2 * GAP + 500, true);

  /* ⚠️ crash אחרי תפיסת חלון: החלון מתבזבז, אבל התור אינו נתקע. המחיר
     חסום ב-gap אחד, כי nextAllowedAt מתקדם ב-gap בדיוק. */
  const before = db._data.waMeta.sendSlot.nextAllowedAt;
  await ob.lgWaReserveSlot(db, GAP, 60000);          // "נתפס ואז קרס"
  const after = db._data.waMeta.sendSlot.nextAllowedAt;
  check('a crash after reserving costs exactly one window, no more',
        after - before, GAP);

  /* ⚠️ ערך פגום או שעון שסטה היו מקפיאים את התור לשעות. התקרה מאפסת. */
  const db2 = fakeDb({ waMeta: { sendSlot: { nextAllowedAt: Date.now() + 86400000 } } });
  const r4 = await ob.lgWaReserveSlot(db2, GAP, MAX_WAIT);
  check('a corrupt far-future value does not freeze the queue', r4.ok, true);
  check('it sends now instead of in a day', r4.waitMs < 500, true);

  /* הקצב אינו ניתן לעקיפה בריבוי "תהליכים" — עשר הזמנות, עשרה חלונות */
  const db3 = fakeDb({});
  const slots = [];
  for (let i = 0; i < 10; i++) {
    const r = await ob.lgWaReserveSlot(db3, GAP, 10 * GAP);
    if (r.ok) slots.push(r.slotAt);
  }
  check('ten concurrent drains get ten windows, not ten sends', slots.length, 10);
  const tooClose = slots.slice(1).filter((t, i) => t - slots[i] < GAP);
  check('and no two windows are closer than the gap', tooClose, []);
})();

/* ═══ 5ד · ה-drain מכבד את החלון ═══════════════════════════════════ */
{
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  check('the drain reserves a window before it claims',
        DRAIN.indexOf('lgWaReserveSlot') > -1 &&
        DRAIN.indexOf('lgWaReserveSlot') < DRAIN.indexOf('await lgWaClaim'), true);
  /* ⚠️ הסדר מכוון: תפיסה לפני חלון הייתה מחייבת לשחרר תפיסה שכבר ספרה ניסיון */
  check('only for a provider that paces globally', /if \(provider\.globalSlot\)/.test(DRAIN), true);
  check('and the in-process sleep is now meta-only',
        /if \(!provider\.globalSlot &&/.test(DRAIN), true);
  check('a busy window defers rather than sending early',
        /status: 'deferred'/.test(DRAIN), true);
}

/* ═══ 5ה · הכשל מפסיק להיות שקט ════════════════════════════════════ */
{
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');

  /* ⚠️ זה מה שהסתיר את L9005 שעה שלמה: ענף אחד להצלחה ו-catch ריק */
  check('the load kick no longer swallows everything',
        /lgWaDrain\(\)\.then\(r => \{\s*if\(r && r\.ok && r\.sent\)/.test(WD), false);
  check('it routes through one outcome handler',
        /lgWaDrain\(\)\.then\(_waDrainOutcome\)/.test(WD), true);
  check('messages waiting with nothing moving is reported as a fault',
        /const stalled = remaining > 0 && sent === 0 && failed === 0 && deferred === 0/.test(FB), true);
  check('and the server answer is kept so there is something to investigate',
        /detail = \(d\.results \|\| \[\]\)\.slice/.test(FB), true);
  const outcome = (WD.match(/function _waDrainOutcome[\s\S]*?\n}/) || [''])[0];
  check('a stall reaches both the screen and the console',
        /console\.error\('\[WhatsApp\]/.test(outcome) && /showToast\(/.test(outcome), true);
  /* ⚠️ אבל בלי הצפה: מי שרק פתח מסך ואין מה לשלוח לא מקבל כלום */
  check('while a quiet queue stays quiet',
        /if\(!r \|\| r\.alreadyRunning\) return;/.test(outcome), true);
}

/* ═══ 3ד · המערך המקביל לא נגע במנגנון ═════════════════════════════ */
(async () => {
  const db = fakeDb({});
  const base = { kind: 'dispatched', to: '0501234567', clientName: 'ל',
                 orderIds: ['b', 'a'], queuedBy: 'x' };

  const q = await ob.lgWaEnqueue(db, { ...base,
    orderNums: ['L2', 'L1'], sketchNames: ['מראה', 'מקלחון'] });
  const e = db._data.waOutbox[q.key];

  /* ⚠️ orderNums לא שינה צורה ולא סדר — הוא עדיין מערך מחרוזות כפי שהיה */
  check('orderNums is still a plain array of strings', e.orderNums, ['L2', 'L1']);
  check('and sketchNames sits beside it, in the same order', e.sketchNames, ['מראה', 'מקלחון']);
  check('neither carries rendered text', /—|שלום/.test(JSON.stringify(e.orderNums)), false);

  /* ⚠️ המפתח מגבב orderIds בלבד, ולכן שם סקיצה אינו יכול לשנות אותו —
     וזה מה ששומר על ה-idempotency בדיוק כפי שנבדק אתמול */
  check('the message key is unchanged by sketch names',
        q.key, ob.lgWaMsgKey('dispatched', ['a', 'b']));
  const db2 = fakeDb({});
  const q2 = await ob.lgWaEnqueue(db2, { ...base,
    orderNums: ['L2', 'L1'], sketchNames: ['שם אחר לגמרי', 'וגם זה'] });
  check('two different sketch names still produce the same key', q2.key, q.key);

  /* חסר/עודף באורך המערך לא שובר כלום */
  const db3 = fakeDb({});
  const q3 = await ob.lgWaEnqueue(db3, { ...base, orderNums: ['L1', 'L2', 'L3'], sketchNames: ['רק אחד'] });
  check('a short sketch list is padded, never misaligned',
        db3._data.waOutbox[q3.key].sketchNames, ['רק אחד', '', '']);

  /* ה-drain מעביר את המערך הלאה */
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  check('the drain passes the sketch names to the provider',
        /sketchNames: entry\.sketchNames \|\| \[\]/.test(DRAIN), true);
})();

/* ═══ 5ז · ה-re-resolve חוסם בפועל, לא רק במבנה ════════════════════ */
//
//  ⚠️ הבדיקות הקודמות מאמתות שהקוד **כתוב** נכון. כאן מריצים את ההחלטה
//  עצמה: resolvePhone האמיתי מול בסיס נתונים מדומה, ואז השער האמיתי.
//
//  זה התרחיש שבגללו ביקשנו re-resolve: רשומה יושבת בתור עם accountKey
//  אחד, ועד שהיא יוצאת הכרטיס אומר משהו אחר. אם נסמוך על מה שנשמר —
//  נשלח הודעה שאסור לשלוח.
(async () => {
  const { resolvePhone } = require(path.join(ROOT, 'api', '_wa-recipient.js'));

  //  TEST: קיים כרטיס TEST-WA בלבד, בדיוק כמו בסביבה האמיתית
  const db = fakeDb({
    hashavshevetAccounts: { 'TEST-WA': { key: 'TEST-WA', phone: '0547725552' } },
    users: { '0500000777': { customerId: 'TEST-WA' },
             '0505887576': { customerId: '14201' } },
    orders: {
      ok:      { id: 'ok',      customerId: 'TEST-WA', phone: '0500000777' },
      moved:   { id: 'moved',   customerId: '14201',   phone: '0505887576' },
      viaUser: { id: 'viaUser', clientPhone: '0500000777', phone: '0500000777' },
      noCard:  { id: 'noCard',  clientPhone: '0509999999', phone: '0509999999' },
    },
  });

  const TESTENV = { ...GREEN_ENV,
    GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:TEST-WA',
    GREENAPI_ONLY_TO:          '0547725552' };

  const decide = async id => {
    const order = (await db.ref('orders/' + id).once('value')).val();
    const live  = await resolvePhone(db, order);
    const allowed = withEnv(TESTENV, m =>
      m.lgWaProvider().gate({ phone: live.phone, accountKey: live.accountKey }).allowed);
    return { allowed, key: live.accountKey, source: live.source };
  };

  const ok = await decide('ok');
  check('a live card that is on the list sends',
        [ok.allowed, ok.key, ok.source], [true, 'TEST-WA', 'hashavshevet']);

  /* ⚠️ זה הלב: ההזמנה מצביעה על 14201, הכרטיס אינו קיים בסביבה הזו,
     resolvePhone נופל ל-order.phone — ו**אין accountKey**. חסום. */
  const moved = await decide('moved');
  check('an order whose card is not in this environment resolves to no key',
        [moved.key, moved.source], [null, 'order']);
  check('and is therefore blocked, however it got into the outbox', moved.allowed, false);

  /* המסלול שעובד בפרודקשן: בלי customerId, דרך טלפון ההתחברות */
  const viaUser = await decide('viaUser');
  check('the usual path — no customerId, found through the login phone',
        [viaUser.allowed, viaUser.key], [true, 'TEST-WA']);

  const noCard = await decide('noCard');
  check('a customer with no card at all is blocked', noCard.allowed, false);

  /* ⚠️ והתרחיש המלא שביקשנו: הרשומה בתור אומרת TEST-WA ומאושרת, אבל
     הנתונים החיים אומרים אחרת. מה שנשמר אינו מה שמחליט. */
  const q = await ob.lgWaEnqueue(db, {
    kind: 'ready', to: '0547725552', clientName: 'ל', orderNums: ['L1'],
    orderIds: ['moved'], queuedBy: 'a',
    phoneSource: 'hashavshevet', accountKey: 'TEST-WA',   // ← נשמר כמאושר
  });
  check('the queued record claims an approved account',
        db._data.waOutbox[q.key].accountKey, 'TEST-WA');
  const atSendTime = await decide('moved');
  check('but the live re-resolve overrides it and blocks the send',
        atSendTime.allowed, false);
})();

/* ═══ 6 · מקור אמת אחד ═════════════════════════════════════════════ */
{
  const SEND = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-send.js'), 'utf8');
  const DISP = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-dispatch.js'), 'utf8');
  const PROV = fs.readFileSync(path.join(ROOT, 'api', '_wa-provider.js'), 'utf8');

  /* ⚠️ התקלה החוזרת של הפרויקט הזה היא מקורות אמת מקבילים: DATABASE_URL
     בארבעה קבצים, שני מסלולי חשבונית, itemsSel מול draftItems. resolvePhone
     היה הופך לעותק שני ברגע שנוסף whatsapp-dispatch לידו. */
  const defines = f => (f.match(/function (resolvePhone|toWaNumber)\b/g) || []);
  check('resolvePhone is defined exactly once in the whole api folder',
        [defines(SEND).length, defines(DISP).length, defines(PROV).length], [0, 0, 0]);
  check('and all three import it instead',
        [/require\('\.\/_wa-recipient'\)/.test(SEND),
         /require\('\.\/_wa-recipient'\)/.test(DISP),
         /require\('\.\/_wa-recipient'\)/.test(PROV)], [true, true, true]);

  /* הדילוג על הזמנה פיקטיבית נשאר בשני המסלולים — לא הוסר ולא הוחלש */
  check('whatsapp-send still skips test orders', /if \(order\.isTest\)/.test(SEND), true);
  check('whatsapp-dispatch skips them too',     /if \(order\.isTest\)/.test(DISP), true);
  check('the once-only guard is still there',   /prev\.sentAt && !force/.test(SEND), true);
  check('and the admin check',                  /await verifyAdmin\(req\)/.test(SEND), true);

  /* ⚠️ הסירוב על טלפונים שונים — ההגנה על הקיבוץ לפי שם */
  check('dispatch refuses a group that resolves to different phones',
        /phones\.length > 1/.test(DISP) && /409/.test(DISP), true);
  check('and it resolves the phone server-side, per order',
        /await resolvePhone\(db, x\.order\)/.test(DISP), true);
}

/* ═══ 7 · התקציב מתחת לתקרת הפונקציה ═══════════════════════════════ */
{
  const DRAIN  = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const ceiling = VERCEL.functions['api/whatsapp-drain.js'].maxDuration;
  const budget  = Number((DRAIN.match(/BUDGET_MS = (\d+)/) || [])[1]);

  check('the drain declares a duration ceiling', ceiling, 60);
  /* ⚠️ ב-Hobby המקסימום הוא 60 שניות. תקציב שחורג ממנו היה נחתך באמצע
     שליחה, וההודעה הייתה נשארת תפוסה עד שהתפיסה מתיישנת. */
  check('and its budget leaves room under it', budget * 10 < ceiling * 1000, true);
  check('the drain stops on the provider cap too', /processed >= provider\.maxPerRun/.test(DRAIN), true);
  check('it reports what is left so the caller can return', /remaining/.test(DRAIN), true);
  /* ההודעה כבר יצאה — כישלון ברישום לא מחזיר אותה לתור */
  check('a stamp failure does not resurrect a sent message',
        /stamp failed/.test(DRAIN), true);
}

/* ═══ 8 · הפעולה העסקית לא תלויה ב-WhatsApp ════════════════════════ */
{
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');

  /* ⚠️ הסדר הוא העיקר: השלב נכתב, ורק אחר כך ההודעה. ההפוך היה הופך כשל
     ב-GREEN API לכשל בהובלה. */
  const prompt = (WD.match(/function showClientDeliveryPrompt[\s\S]*?\n}/) || [''])[0];
  check('the delivery prompt advances the stage first',
        prompt.indexOf('finalizeDelivery') > -1 &&
        prompt.indexOf('finalizeDelivery') < prompt.indexOf('_waDispatch'), true);
  check('and the message is fired from .then, never awaited into it',
        /\.then\(\(\) => \{[\s\S]*_waDispatch\(orderIds, clientName\)/.test(prompt), true);
  check('_waDispatch exists and takes ids, not phones',
        /async function _waDispatch\(orderIds, clientName\)/.test(WD), true);

  /* 409 הוא ממצא בנתונים ולא תקלה טכנית — חייב להיראות, לא להיבלע */
  check('a mixed-phone refusal reaches the screen',
        /res\.status === 409/.test(WD) && /מובילות למספרים שונים/.test(WD), true);

  /* רשת הביטחון: מה שנשאר בתור יוצא בטעינה הבאה, פעם אחת */
  check('the outbox is drained once on load', /if\(!_waKicked\)/.test(WD), true);
  check('with the flag declared',             /let _waKicked = false/.test(WD), true);

  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('the drain loop has a hard round cap',   /round < 40/.test(FB), true);
  /* ⚠️ בלי זה: לופ אינסופי כשאין התקדמות, למשל כשהספק חסום בסביבה */
  check('and stops when a round made no progress', /if\(!d\.processed\) break/.test(FB), true);
  check('single-flight inside the tab',            /if\(_lgDraining\)/.test(FB), true);
}

process.on('exit', () => {
  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exitCode = 1; }
  else console.log('\nAll WhatsApp provider / outbox checks passed.');
});
