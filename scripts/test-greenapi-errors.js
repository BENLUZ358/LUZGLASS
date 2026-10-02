#!/usr/bin/env node
/**
 * מה קורה כש-GREEN API נכשלת — והאם הטוקן יכול לדלוף משם.
 *
 * ─── למה הקובץ הזה קיים ───────────────────────────────────────────────
 *
 * זה הענף היחיד במסלול ה-WhatsApp ש**אי אפשר לכסות ב-QA אמיתי**. השער
 * מתיר נמען אחד בלבד, ולכן אין דרך בטוחה לגרום ל-GREEN API להחזיר שגיאה
 * מבלי לשבש אישורי חיבור אמיתיים. לכן fetch מדומה.
 *
 * ─── ולמה דווקא כאן זה קריטי ──────────────────────────────────────────
 *
 * ⚠️ 2026-10-01: ההנחה הייתה ש"גוף התשובה של GREEN API אינו מכיל את
 * הטוקן". ההנחה הייתה שגויה — בשגיאה הם מחזירים שדה `path` עם ה-URL
 * המלא, ובו הטוקן. השליחה הראשונה הדליפה אותו והוא הוחלף.
 *
 * ב-GREEN API הטוקן יושב **בתוך ה-URL**, ולכן כל מחרוזת שמגיעה משם —
 * גוף תשובה, הודעת שגיאת רשת, לוג — היא סוד פוטנציאלי. הבדיקות כאן
 * מריצות את הספק מול תשובות שגיאה אמיתיות בצורתן, ומוודאות ששום דבר
 * רגיש לא יוצא: לא בתשובה, לא בשגיאה, ולא בקונסולה.
 *
 * Run: node scripts/test-greenapi-errors.js
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const TOKEN    = 'SECRET-TOKEN-abc123xyz';
const INSTANCE = '1101900001';
const URL_WITH_SECRET = 'https://api.green-api.com/waInstance' + INSTANCE + '/sendMessage/' + TOKEN;

const GREEN_ENV = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x', private_key: 'k' }),
  WA_PROVIDER: 'green',
  GREENAPI_ID_INSTANCE: INSTANCE,
  GREENAPI_TOKEN: TOKEN,
  GREENAPI_TEST_ENABLED: '1',
  GREENAPI_TEST_TO: '0501234567',
};

//  מריץ שליחה אחת מול fetch מדומה, ואוסף גם את כל מה שנכתב לקונסולה.
async function sendWith(fetchImpl) {
  const savedEnv   = { ...process.env };
  const savedFetch = global.fetch;
  const savedLog   = console.log, savedErr = console.error;
  const logged     = [];

  Object.assign(process.env, GREEN_ENV);
  global.fetch  = fetchImpl;
  console.log   = (...a) => logged.push(a.map(x => JSON.stringify(x)).join(' '));
  console.error = (...a) => logged.push(a.map(x => JSON.stringify(x)).join(' '));

  ['api/_env.js', 'api/_wa-recipient.js', 'api/_wa-provider.js']
    .forEach(m => { delete require.cache[require.resolve(path.join(ROOT, m))]; });

  try {
    const p = require(path.join(ROOT, 'api', '_wa-provider.js')).lgWaProvider();
    const out = await p.send({ to: '0501234567', kind: 'ready',
                               clientName: 'דני', orderNums: ['L1234'] });
    return { out, logged: logged.join('\n') };
  } finally {
    console.log = savedLog; console.error = savedErr;
    global.fetch = savedFetch; process.env = savedEnv;
  }
}

//  ⚠️ כל מה שיוצא מהספק נבדק מול הרשימה הזו. לא רק הטוקן: ה-URL עצמו הוא
//  סוד, כי הטוקן בתוכו, ומזהה המופע מזהה את החשבון.
const SECRETS = [TOKEN, URL_WITH_SECRET, 'api.green-api.com', 'waInstance', INSTANCE];
function assertClean(label, text) {
  const found = SECRETS.filter(s => String(text).includes(s));
  check(label, found, []);
}

(async () => {

  /* ── 1 · שגיאה שמחזירה את ה-URL בגוף — התקלה האמיתית ──────────────── */
  {
    //  ⚠️ זו הצורה המדויקת שהדליפה את הטוקן ב-2026-10-01.
    const body = JSON.stringify({
      statusCode: 401, error: 'Unauthorized',
      message: 'instance not authorized',
      path: '/waInstance' + INSTANCE + '/sendMessage/' + TOKEN,
      url: URL_WITH_SECRET,
    });
    const { out, logged } = await sendWith(async () => ({
      status: 401, text: async () => body,
    }));

    check('a GREEN API error is not reported as success', out.ok, false);
    check('and the http status is kept',                  out.httpStatus, 401);
    check('no message id is invented',                    out.messageId, null);
    check('a reason is given, not silence',               !!out.reason, true);

    /* ⚠️ הטענה המרכזית של הקובץ */
    assertClean('the token never leaves in the result',   JSON.stringify(out));
    assertClean('nor does the url, the instance id or the host', JSON.stringify(out));
    assertClean('and nothing sensitive is logged',        logged);
    /* הגוף הגולמי מכיל path — אסור שיוחזר בשלמותו */
    check('the raw body is not returned verbatim',
          String(out.detail || '').includes('"path"'), false);
  }

  /* ── 2 · redact מחליף את הטוקן גם כשהוא חוזר כמה פעמים ─────────────── */
  {
    const body = JSON.stringify({
      message: 'failed at ' + TOKEN + ' and again ' + TOKEN,
      path: '/x/' + TOKEN,
    });
    const { out } = await sendWith(async () => ({ status: 500, text: async () => body }));
    assertClean('every occurrence of the token is stripped', JSON.stringify(out));
    check('and the redaction marker is what replaced it',
          /\*\*\*/.test(String(out.reason || '')), true);
    /* ⚠️ מה שסביב הטוקן נשאר קריא — אחרת אי אפשר לחקור כישלון */
    check('while the explanation itself survives',
          /failed at/.test(String(out.reason || '')), true);
  }

  /* ── 3 · 200 בלי idMessage — "התקבל" אינו "נשלח" ───────────────────── */
  {
    const { out } = await sendWith(async () => ({
      status: 200, text: async () => JSON.stringify({ ok: true }),
    }));
    /* ⚠️ אותו לקח מחשבשבת: HTTP 200 אינו "נוצר מסמך". כאן 200 בלי
       idMessage אינו "הלקוח קיבל", ולכן זה כישלון ולא הצלחה. */
    check('200 without an idMessage is a failure, not a success', out.ok, false);
    check('and it is not stamped as sent',                        out.messageId, null);
  }

  /* ── 4 · תקלת רשת — e.message עלול להכיל את ה-URL ─────────────────── */
  {
    const { out, logged } = await sendWith(async () => {
      const e = new Error('request to ' + URL_WITH_SECRET + ' failed, reason: ECONNRESET');
      e.name = 'FetchError';
      throw e;
    });
    check('a network failure is reported as a failure', out.ok, false);
    check('with no http status',                        out.httpStatus, 0);
    /* ⚠️ הודעת השגיאה של fetch מכילה את ה-URL המלא, ובו הטוקן */
    assertClean('the thrown message never reaches the result', JSON.stringify(out));
    assertClean('nor the console',                             logged);
    check('the error type is reported instead',
          /FetchError/.test(String(out.reason || '')), true);
  }

  /* ── 5 · גוף שאינו JSON בכלל ───────────────────────────────────────── */
  {
    const { out } = await sendWith(async () => ({
      status: 502, text: async () => '<html>Bad Gateway ' + TOKEN + '</html>',
    }));
    check('a non-JSON body is still a failure', out.ok, false);
    assertClean('and still cannot leak the token', JSON.stringify(out));
  }

  /* ── 6 · ההצלחה לא נשברה ──────────────────────────────────────────── */
  {
    let seenUrl = null, seenBody = null;
    const { out } = await sendWith(async (url, opts) => {
      seenUrl = url; seenBody = JSON.parse(opts.body);
      return { status: 200, text: async () => JSON.stringify({ idMessage: 'BGEM123' }) };
    });
    check('a good send is still a success', out.ok, true);
    check('and carries the message id',     out.messageId, 'BGEM123');
    /* chatId חייב להיות בין-לאומי — המספר המקומי נדחה ב-
       "Validation failed. Details: 'chatId'" */
    check('the chatId is international with @c.us', seenBody.chatId, '972501234567@c.us');
    check('and the token is in the url, which is why the url is a secret',
          seenUrl.endsWith('/' + TOKEN), true);
    check('the message text reaches the api', /מוכנה לאיסוף/.test(seenBody.message), true);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll GREEN API error-path checks passed.');
})();
