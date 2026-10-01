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

/* ═══ 3 · ארבע הנעילות, דרך הספק ════════════════════════════════════ */
{
  withEnv({ ...GREEN_ENV, FIREBASE_SERVICE_ACCOUNT: sa('lussglass') }, m =>
    check('green is refused on production even when fully configured',
          m.lgWaProvider().gate('0501234567').allowed, false));
  withEnv({ ...GREEN_ENV, GREENAPI_TEST_ENABLED: undefined }, m =>
    check('green is refused without GREENAPI_TEST_ENABLED=1',
          m.lgWaProvider().gate('0501234567').allowed, false));
  withEnv({ ...GREEN_ENV }, m => {
    const p = m.lgWaProvider();
    check('the allowed number passes',    p.gate('0501234567').allowed, true);
    check('a different number is refused', p.gate('0509999999').allowed, false);
    check('and refused, not silently redirected',
          /אינו המספר המורשה/.test(p.gate('0509999999').reason), true);
  });

  /* ⚠️ המלכודת שעלתה לנו דקה של חשיבה ושווה בדיקה לנצח: lgGreenApiTest
     משווה ל-GREENAPI_TEST_TO בפורמט מקומי. אם מעבירים לשער את המספר אחרי
     ההמרה לבין-לאומי, הוא לא תואם — וכל שליחה הייתה נחסמת בלי סיבה. */
  withEnv({ ...GREEN_ENV }, m => {
    const p = m.lgWaProvider();
    check('the gate takes the LOCAL phone, not the 972 form',
          [p.gate('0501234567').allowed, p.gate('972501234567').allowed], [true, false]);
  });

  /* Meta עוברת דרך החסימה הגלובלית, ובכיוון ההפוך: הייצור הוא המותר */
  withEnv(META_ENV, m =>
    check('meta is allowed on production', m.lgWaProvider().gate().allowed, true));
  withEnv({ ...META_ENV, FIREBASE_SERVICE_ACCOUNT: sa('luz-glass-test') }, m =>
    check('and blocked everywhere else', m.lgWaProvider().gate().allowed, false));
  withEnv({ ...META_ENV, LG_ENV: 'test' }, m =>
    check('LG_ENV=test still blocks meta even on production',
          m.lgWaProvider().gate().allowed, false));
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
        async transaction(fn) {
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
