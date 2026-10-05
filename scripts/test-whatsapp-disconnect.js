#!/usr/bin/env node
/**
 * מה קורה כש-WhatsApp מתנתק.
 *
 * ─── למה זה שונה מכל כשל אחר ───────────────────────────────────────────
 *
 * ⚠️ המכשיר מקושר ל-WhatsApp כ-Linked Device, והקישור נשבר מדי פעם.
 * כשזה קורה GREEN API **אינה דוחה את ההודעה** — לפי התיעוד שלהם היא
 * מכניסה אותה לתור שלה ל-24 שעות ומוסרת אותה אחרי החיבור מחדש, וממליצים
 * במפורש: "stop requesting sending methods to the API".
 *
 * המשמעות: אפשר שלא נראה שום שגיאה, ועדיין נרשום "נשלח" על הודעה שהלקוח
 * לא קיבל. לכן המנגנון הוא **שאלה לפני שליחה** (getStateInstance), וסיווג
 * השגיאה הוא רשת ביטחון בלבד.
 *
 * ─── ומה שהיה שבור לפני ────────────────────────────────────────────────
 *
 * ⚠️ MAX_ATTEMPTS=3, וכישלון נחשב "טופל" — ולכן שלושת הניסיונות היו
 * נשרפים תוך ~30 שניות מול מכשיר מנותק, ואז lgWaClaim מסרב לנצח.
 * **ההודעה לא הייתה נשלחת גם אחרי שהחיבור חוזר.** בדיוק מה שקרה ב-466,
 * שם נדרש איפוס ידני של attempts כדי להחיות את L1071.
 *
 * Run: node scripts/test-whatsapp-disconnect.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

const ROOT = path.join(__dirname, '..');
let failed = 0;

/*  ⚠️ לא console.log.
 *
 *  withFetch משתיק את הקונסולה כדי לתפוס דליפות של token, והוא נקרא
 *  בתוך פונקציה **אסינכרונית**. ב-await הראשון שלה השליטה חוזרת לקוד
 *  הסינכרוני שאחריה — וכל שורות ה-ok וה-FAIL של אותם קטעים נבלעו למערך
 *  הלוג במקום להגיע למסך. בדיקות רצו ועברו בשקט, ו-FAIL היה נעלם באותה
 *  דרך: המספר בסוף היה מתעדכן, אבל שם הבדיקה שנשברה לא.
 *
 *  הפלט נכתב ישירות ל-stdout, שאינו מושתק.
 */
const say = (w => t => w(t + '\n'))(process.stdout.write.bind(process.stdout));
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? say('ok    ' + name)
  : (failed++, say(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const TOKEN    = 'SECRET-TOKEN-abc123xyz';
const INSTANCE = '1101900001';
const GREEN_ENV = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test', client_email: 'x', private_key: 'k' }),
  WA_PROVIDER: 'green',
  GREENAPI_ID_INSTANCE: INSTANCE,
  GREENAPI_TOKEN: TOKEN,
  GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:TEST-WA',
  GREENAPI_ONLY_TO: undefined,
};

//  מריץ מול fetch מדומה, ומחזיר גם את מה שנכתב לקונסולה
function withFetch(fetchImpl, env) {
  const savedEnv = { ...process.env }, savedFetch = global.fetch;
  const savedLog = console.log, savedWarn = console.warn, savedErr = console.error;
  const logged = [];
  Object.assign(process.env, GREEN_ENV, env || {});
  Object.keys(env || {}).forEach(k => { if (env[k] === undefined) delete process.env[k]; });
  global.fetch = fetchImpl;
  console.log = console.warn = console.error = (...a) => logged.push(a.map(String).join(' '));
  ['api/_env.js', 'api/_wa-recipient.js', 'api/_wa-provider.js']
    .forEach(m => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  const mod = require(path.join(ROOT, 'api', '_wa-provider.js'));
  const restore = () => {
    console.log = savedLog; console.warn = savedWarn; console.error = savedErr;
    global.fetch = savedFetch; process.env = savedEnv;
  };
  return { mod, logged, restore };
}

//  תשובות GREEN API, בצורתן האמיתית
const STATE = st => async () => ({ status: 200, text: async () => JSON.stringify({ stateInstance: st }) });
const SENT  = id => async () => ({ status: 200, text: async () => JSON.stringify({ idMessage: id }) });
const ERR   = (code, msg) => async () => ({ status: code, text: async () => JSON.stringify({ message: msg }) });

/* ═══ 1 · סיווג — כל חמשת המצבים ════════════════════════════════════ */
{
  const { classifyFailure, FAIL } = require(path.join(ROOT, 'api', '_wa-provider.js'));

  /* ⚠️ GREEN API מחזירה 400 גם על ניתוק וגם על בקשה שגויה. הקוד לבדו
     אינו מבדיל — רק הטקסט. אלה הניסוחים האמיתיים מהתיעוד שלהם. */
  for (const m of ['instance is starting or not authorized',
                   'instance account not authorized',
                   'go to console and scan the QR code from the WhatsApp Business application']) {
    check('disconnect is recognised: "' + m.slice(0, 34) + '…"',
          classifyFailure(400, m), FAIL.DISCONNECTED);
  }
  check('quota is not a disconnect',            classifyFailure(466, 'Monthly quota has been exceeded'), FAIL.QUOTA);
  check('rate limit is not a disconnect',       classifyFailure(429, 'Please decrease the frequency requests'), FAIL.RATE);
  check('a bad recipient is not a disconnect',  classifyFailure(400, "Validation failed. Details: 'chatId'"), FAIL.RECIPIENT);
  check('a network error is its own kind',      classifyFailure(0, ''), FAIL.NETWORK);
  /* ⚠️ 400 על אורך הודעה הוא באג אצלנו, לא ניתוק — אסור שיעצור את התור */
  check('an oversized message is not a disconnect',
        classifyFailure(400, "Validation failed. Details: 'message' length"), FAIL.OTHER);
}

/* ═══ 2 · getState — מחובר, מנותק, וכל השאר ═════════════════════════ */
(async () => {
  for (const [st, live] of [['authorized', true], ['notAuthorized', false], ['blocked', false],
                            ['starting', false], ['sleepMode', false], ['suspended', false]]) {
    const { mod, restore } = withFetch(STATE(st));
    const r = await mod.lgWaProvider().getState();
    restore();
    check('getState reports ' + st, [r.ok, r.state], [true, st]);
    check('  and only authorized may send (' + st + ')', r.state === 'authorized', live);
  }

  /* ⚠️ שגיאה בבדיקת המצב אינה "מחובר". unknown חוסם, כמו כל דבר שאינו authorized. */
  const { mod: m2, restore: r2 } = withFetch(async () => { const e = new Error('boom at https://api.green-api.com/waInstance' + INSTANCE + '/x/' + TOKEN); e.name = 'FetchError'; throw e; });
  const bad = await m2.lgWaProvider().getState(); r2();
  check('a failed state check is unknown, never authorized', [bad.ok, bad.state], [false, 'unknown']);
  /* ⚠️ ה-URL מכיל את הטוקן, ו-e.message מכיל את ה-URL */
  check('and it leaks neither token nor url',
        /SECRET-TOKEN|green-api\.com|waInstance/.test(JSON.stringify(bad)), false);

  /* Meta אין לה מכשיר מקושר — היא לעולם לא נחסמת בגלל "מצב" */
  const { mod: m3, restore: r3 } = withFetch(async () => ({ status: 200, text: async () => '{}' }),
                                             { WA_PROVIDER: undefined, WA_PHONE_NUMBER_ID: '1',
                                               WA_ACCESS_TOKEN: 't', WA_TEMPLATE_NAME: 'n' });
  const meta = m3.lgWaProvider();
  const ms = await meta.getState(); r3();
  check('meta never reports itself disconnected', [meta.checksState, ms.state], [false, 'authorized']);
})();

/* ═══ 3 · send מסמן ניתוק ═══════════════════════════════════════════ */
(async () => {
  const facts = { to: '0501234567', kind: 'ready', clientName: 'דני',
                  orderNums: ['L1'], sketchNames: ['מקלחון'] };

  const { mod, logged, restore } = withFetch(ERR(400, 'instance is starting or not authorized'));
  const out = await mod.lgWaProvider().send(facts);
  restore();
  check('a disconnected send is a failure', out.ok, false);
  check('and is labelled as a disconnect',  out.failureKind, 'disconnected');
  check('with nothing sensitive in it',
        /SECRET-TOKEN|green-api\.com|waInstance/.test(JSON.stringify(out) + logged.join('')), false);

  for (const [code, msg, kind] of [[466, 'Monthly quota has been exceeded', 'quota'],
                                   [429, 'Please decrease the frequency requests', 'rate'],
                                   [400, "Validation failed. Details: 'chatId'", 'recipient']]) {
    const { mod: m, restore: r } = withFetch(ERR(code, msg));
    const o = await m.lgWaProvider().send(facts); r();
    check('HTTP ' + code + ' is labelled ' + kind, o.failureKind, kind);
  }

  const { mod: mk, restore: rk } = withFetch(SENT('BGEM1'));
  const good = await mk.lgWaProvider().send(facts); rk();
  check('a successful send carries no failure kind', [good.ok, good.failureKind], [true, null]);
})();

/* ═══ 4 · התור — ניתוק אינו שורף ניסיון ═════════════════════════════ */
(async () => {
  const ob = require(path.join(ROOT, 'api', '_wa-outbox.js'));
  const db = fakeDb({});
  const msg = { kind: 'ready', to: '0501234567', clientName: 'דני', orderNums: ['L1'],
                sketchNames: ['מקלחון'], orderIds: ['o1'], queuedBy: 'a' };

  const q = await ob.lgWaEnqueue(db, msg);
  const row = () => db._data.waOutbox[q.key];

  /* הסבב שבו המכשיר מנותק: תפיסה, ואז שחרור */
  await ob.lgWaClaim(db, q.key, 'admin');
  check('claiming counts an attempt', row().attempts, 1);
  await ob.lgWaRelease(db, q.key, 'WhatsApp מנותק');

  /* ⚠️ זה הלב: הניסיון מוחזר, והרשומה חוזרת להמתין */
  check('releasing gives the attempt back',   row().attempts, 0);
  check('and the record is pending again',    row().state, 'pending');
  check('the claim is cleared',               row().claimedAt, null);
  check('and it says why it is waiting',      row().lastError, 'WhatsApp מנותק');
  check('it stays in the queue',              await ob.lgWaPending(db, 10), [q.key]);
  check('and was never marked sent',          row().sentAt, null);

  /* ⚠️ עשרה סבבים של ניתוק — ובסוף ההודעה עדיין ממתינה.
     לפני התיקון היא הייתה ננעלת אחרי שלושה ולא נשלחת לעולם. */
  for (let i = 0; i < 10; i++) {
    await ob.lgWaClaim(db, q.key, 'admin');
    await ob.lgWaRelease(db, q.key, 'WhatsApp מנותק');
  }
  check('ten disconnected rounds still leave it retryable', await ob.lgWaPending(db, 10), [q.key]);
  check('and attempts never ran out',                       row().attempts, 0);
  /*  ⚠️ להיות ברשימה זה לא מספיק. lgWaPending מחזיר כל 'pending' בלי
      להסתכל על attempts, אבל lgWaClaim מסרב מעל MAX_ATTEMPTS — ולכן
      הודעה יכולה להיראות ממתינה ולעולם לא להיתפס. זו הטענה שבאמת
      מבטיחה שההודעה תצא אחרי שהחיבור יחזור. */
  const after = await ob.lgWaClaim(db, q.key, 'admin');
  check('and it can actually still be claimed',             after.claimed, true);
  await ob.lgWaRelease(db, q.key, 'WhatsApp מנותק');

  /* ⚠️ אבל כשל אמיתי כן נספר — אחרת לא היה הבדל בין "אין חיבור" ל"שבור" */
  await ob.lgWaClaim(db, q.key, 'admin');
  await ob.lgWaComplete(db, q.key, { ok: false, reason: 'משהו אחר' });
  check('a genuine failure still counts', [row().state, row().attempts], ['failed', 1]);

  /* ── והחיבור חזר ── */
  await ob.lgWaClaim(db, q.key, 'admin');
  await ob.lgWaComplete(db, q.key, { ok: true, messageId: 'BGEM9', httpStatus: 200 });
  check('after reconnect the same record is sent',  row().state, 'sent');
  check('with a message id',                        row().messageId, 'BGEM9');
  /* ⚠️ אותו מפתח לאורך כל הדרך — לא נוצרה הודעה חדשה */
  check('and it is the very same record',           q.key, ob.lgWaMsgKey('ready', ['o1']));
  check('one record in the outbox, start to finish', Object.keys(db._data.waOutbox).length, 1);

  /* ⚠️ ואין שליחה כפולה: 'sent' סופי, וגם שחרור לא יחזיר אותו */
  check('a sent record cannot be claimed again',  (await ob.lgWaClaim(db, q.key, 'a')).claimed, false);
  check('nor released back into the queue',       await ob.lgWaRelease(db, q.key, 'x'), false);
  check('nor re-enqueued',                        (await ob.lgWaEnqueue(db, msg)).queued, false);
  check('the queue is empty',                     await ob.lgWaPending(db, 10), []);
  check('and still exactly one record',           Object.keys(db._data.waOutbox).length, 1);
})();

/* ═══ 5 · ה-drain — שואל לפני ששולח, ועוצר כשמנותק ══════════════════ */
{
  const D = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');

  /* ⚠️ הסדר הוא העיקר: המצב נבדק **לפני** התפיסה הראשונה */
  check('the drain asks for the state before it claims anything',
        D.indexOf('await provider.getState()') < D.indexOf('await lgWaClaim'), true);
  check('and returns without touching the queue when not authorized',
        /if \(!isLive\(state\)\)[\s\S]{0,400}?disconnected: true/.test(D), true);
  check('only authorized is treated as live',
        /const isLive = st => st === 'authorized';/.test(D), true);

  /* ניתוק שהתחיל באמצע סבב */
  check('a mid-run disconnect releases instead of failing',
        /failureKind === 'disconnected'[\s\S]{0,200}?lgWaRelease/.test(D), true);
  /* ⚠️ ועוצר. 40 הודעות × 3 ניסיונות × חלון של 10 שניות = 20 דקות של
     קריאות חסרות תוחלת מול מכשיר מנותק. */
  check('and stops the whole round',
        /lgWaRelease[\s\S]{0,400}?break;/.test(D), true);

  check('the state is recorded where a screen can read it', /waMeta\/whatsapp/.test(D), true);
  /* ⚠️ checkOnly חייב לחזור לפני כל תפיסה — אחרת כפתור "בדוק שוב" היה מרוקן */
  check('checkOnly never drains', D.indexOf('if (checkOnly)') < D.indexOf('for (const key of keys)'), true);
}

/* ═══ 6 · הפעולה העסקית אינה תלויה ב-WhatsApp ═══════════════════════ */
//
//  ⚠️ זו הדרישה שלא מתפשרים עליה: ניתוק WhatsApp לא יעצור הובלה ולא
//  יחזיר הזמנה לאחור. השלב נכתב ראשון, וההודעה נורית אחריו.
{
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  const prompt = (WD.match(/function showClientDeliveryPrompt[\s\S]*?\n}/) || [''])[0];
  check('the stage is written before the message is even attempted',
        prompt.indexOf('finalizeDelivery') < prompt.indexOf('_waDispatch'), true);
  check('and the message is fired, never awaited into the business action',
        /\.then\(\(\) => \{[\s\S]*_waDispatch\(orderIds, clientName\)/.test(prompt), true);

  const grp = (WD.match(/async function _waSendReadyGrouped[\s\S]*?\n}/) || [''])[0];
  /* ⚠️ כל קריאה עטופה — שרת שלא עונה לא מפיל את הלולאה ולא את הפעולה */
  check('every send attempt is wrapped so it cannot throw outwards',
        /try \{[\s\S]*\} catch\(e\)\{/.test(grp), true);

  const DISP = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-dispatch.js'), 'utf8');
  /* הכנסה לתור היא הפעולה היחידה שנדרשת — השליחה קורית אחר כך */
  check('queueing is all the business action needs', /lgWaEnqueue\(db, \{/.test(DISP), true);
}

/* ═══ 7 · המסך אומר מה קורה ═════════════════════════════════════════ */
{
  const A  = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

  check('admin can read the status',        /async function lgWaStatus\(\)/.test(FB), true);
  check('and can re-check it on demand',    /async function lgWaCheckState\(\)/.test(FB), true);
  /* ⚠️ checkOnly — הכפתור שואל על המצב, הוא אינו מרוקן את התור */
  check('the recheck asks for a status only',
        /_lgAuthPost\('\/api\/whatsapp-drain', \{ checkOnly: true \}\)/.test(FB), true);

  /* ── השורה עצמה, מורצת ──────────────────────────────────────────────
   *
   * ⚠️ בדיקת מחרוזת על admin.html הייתה עוברת גם על ניסוח שמשקר, וכך
   * באמת קרה: הטקסט "WhatsApp מנותק" היה מקודד בקבוע, והוצג גם על
   * state='unknown' — מצב שפירושו "עוד לא שאלנו", לא "המכשיר מנותק".
   * לכן השורה מורצת כאן ונקרא בדיוק מה שהמזכירה רואה.
   */
  const LABEL = (A.match(/const _WA_LABEL = \{[\s\S]*?\n\};/) || [''])[0];
  const BANNER = (A.match(/function renderWaStatus\(st\)\{[\s\S]*?\n\}/) || [''])[0];
  check('the status line was found in admin.html', LABEL.length > 0 && BANNER.length > 0, true);

  const bar = { style: { display: '', cssText: '' }, innerHTML: '', addEventListener(){} };
  const btn = { style: {}, textContent: '', disabled: false, addEventListener(){} };
  const ctx = {
    document: { getElementById: id => id === 'waStatusBar' ? bar : btn },
    lgEsc: v => String(v),
    lgWaCheckState: async () => ({ state: 'authorized', pending: 0 }),
  };
  vm.createContext(ctx);
  vm.runInContext(LABEL + '\n' + BANNER, ctx);

  /* מה שהמזכירה רואה: null = השורה מוסתרת */
  const seen = st => {
    bar.innerHTML = ''; bar.style.display = '';
    ctx.renderWaStatus(st);
    return bar.innerHTML ? bar.innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  };
  const says = (st, ...words) => { const t = seen(st); return t === null ? 'HIDDEN' : words.map(w => t.includes(w)); };

  /* ⚠️ שורה שמופיעה תמיד נעשית רעש ואיש לא קורא אותה כשהיא כן חשובה */
  check('a healthy, empty queue shows nothing',
        seen({ state: 'authorized', pending: 0, checkedAt: Date.now() }), null);
  /* ⚠️ ובפרודקשן waMeta/whatsapp נכתב רק אחרי ה-drain הראשון, ועד אז
     state='unknown' — ובלי התנאי הזה כל טעינה פתחה ב-"⚠️ לא ידוע" */
  check('and neither does an unmeasured one',
        seen({ state: 'unknown', pending: 0, checkedAt: 0 }), null);

  /* ⚠️ הכשל שהבדיקה הזו נוספה בשבילו: לא-נמדד אינו מנותק */
  check('an unmeasured state with messages waiting does not claim a disconnect',
        says({ state: 'unknown', pending: 2, checkedAt: 0 }, 'מנותק'), [false]);
  check('it says what it does know, and how many are waiting',
        says({ state: 'unknown', pending: 2, checkedAt: 0 }, 'לא ידוע', '2 הודעות ממתינות'), [true, true]);
  /* ⚠️ ולא שולחת לסרוק QR על מצב שחיבור מחדש אינו פותר */
  check('and does not send anyone to re-link the device',
        says({ state: 'unknown', pending: 2, checkedAt: 0 }, 'יש לחבר מחדש'), [false]);

  /* ניתוק אמיתי — כאן ההוראה נכונה */
  check('a real disconnect with messages waiting says all three things',
        says({ state: 'notAuthorized', pending: 2, checkedAt: Date.now() },
             'מנותק', '2 הודעות ממתינות', 'יש לחבר מחדש את המכשיר'), [true, true, true]);
  check('and says it even with nothing waiting yet',
        says({ state: 'notAuthorized', pending: 0, checkedAt: Date.now() },
             'מנותק', 'יש לחבר מחדש את המכשיר'), [true, true]);

  /* ⚠️ טלפון כבוי וחשבון חסום אינם נפתרים בחיבור מחדש */
  check('a sleeping phone is named, without the wrong instruction',
        says({ state: 'sleepMode', pending: 1, checkedAt: Date.now() },
             'הטלפון כבוי', 'יש לחבר מחדש'), [true, false]);
  check('and so is a blocked account',
        says({ state: 'blocked', pending: 0, checkedAt: Date.now() }, 'חסום', 'יש לחבר מחדש'), [true, false]);

  /* מחובר אבל יש תור — זה לא אזהרה */
  check('a live queue is reported, not warned about',
        says({ state: 'authorized', pending: 3, checkedAt: Date.now() }, '📤', '3 הודעות ממתינות', '⚠️'),
        [true, true, false]);

  /* הזמן האחרון שבו נמדד — כדי שיהיה אפשר לדעת אם המידע טרי */
  check('a measured state shows when it was checked',
        says({ state: 'notAuthorized', pending: 1, checkedAt: Date.now() }, 'נבדק'), [true]);

  /* ⚠️ onclick היה נחתך על מרכאות — ר' test-inline-handlers.js */
  check('the recheck button is wired with addEventListener',
        /btn\.addEventListener\('click'/.test(A), true);
}

process.on('exit', () => {
  if (failed) { say(`\n${failed} check(s) failed.`); process.exitCode = 1; }
  else say('\nAll WhatsApp disconnect checks passed.');
});
