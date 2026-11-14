#!/usr/bin/env node
/** תזכורת "סיים יום עבודה" (בן, 14/11): הבאנר, החלון לפני "הורד לעבודה", והוואטסאפ לבן ולשאול.
 *  Run: node scripts/test-workday-remind.js */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const W = require(path.join(ROOT, 'workday-remind.js'));
const R = require(path.join(ROOT, 'api', '_workday-remind.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

//  שעון ישראל בנובמבר = UTC+2
const il = (date, hh, mm) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00+02:00`);
const wd = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(new Date(ms));
const SUN = '2026-11-15', MON = '2026-11-16', FRI = '2026-11-20', SAT = '2026-11-21', THU = '2026-11-19';
check('calendar sanity', [wd(il(SUN, 12)), wd(il(MON, 12)), wd(il(THU, 12)), wd(il(FRI, 12)), wd(il(SAT, 12))], ['Sun', 'Mon', 'Thu', 'Fri', 'Sat']);

// ─── הדפדפן: lgWorkdayForgot ───
const F = (count, since, now) => W.lgWorkdayForgot({ count, since, now });
check('nothing in work → nothing', F(0, il(SUN, 8), il(MON, 18)), null);
check('today, before 17:00 → nothing', F(3, il(SUN, 8), il(SUN, 16, 59)), null);
check('today, 17:00 → late', F(3, il(SUN, 8), il(SUN, 17)), 'late');
check('Thursday 18:30 → late', F(1, il(THU, 9), il(THU, 18, 30)), 'late');
check('Friday afternoon, from today → nothing', F(2, il(FRI, 8), il(FRI, 17)), null);
check('from yesterday → old, also in the morning', F(2, il(SUN, 9), il(MON, 7)), 'old');
check('from Thursday, seen on Saturday → old', F(2, il(THU, 9), il(SAT, 10)), 'old');
check('late night 23:30 is still the same day (Israel time)', F(2, il(SUN, 9), il(SUN, 23, 30)), 'late');
check('no since recorded yet → only the hour counts', [F(2, null, il(MON, 10)), F(2, null, il(MON, 17))], [null, 'late']);
check('count of a Firebase array/object', [W.lgWorkdayCountOf(['a', 'b']), W.lgWorkdayCountOf({ 0: 'a', 2: 'c' }), W.lgWorkdayCountOf(null)], [2, 2, 0]);
check('old text names the day', /3 הזמנות ביום העבודה מ-15\/11/.test(W.lgWorkdayForgotText('old', 3, il(SUN, 9))), true);
check('late text, one order', W.lgWorkdayForgotText('late', 1), 'עוד לא נלחץ "סיים יום עבודה" היום. יש הזמנה אחת בעבודה.');

// ─── השרת: מתי שולחים ───
const D = (now, count, state) => R.lgWorkdayRemindDue({ now, count, state });
check('due: Sun 17:00 with work', D(il(SUN, 17), 2, null), true);
check('not due: 16:59 / Friday / Saturday / empty', [D(il(SUN, 16, 59), 2), D(il(FRI, 17), 2), D(il(SAT, 20), 2), D(il(SUN, 18), 0)], [false, false, false, false]);
check('not due: already sent today', D(il(SUN, 19), 2, { day: SUN, sent: true, at: il(SUN, 17), tries: 1 }), false);
check('due: sent yesterday', D(il(MON, 17), 2, { day: SUN, sent: true, at: il(SUN, 17), tries: 1 }), true);
check('retry after 2 minutes, not before', [D(il(SUN, 17, 1), 2, { day: SUN, at: il(SUN, 17), tries: 1 }), D(il(SUN, 17, 2), 2, { day: SUN, at: il(SUN, 17), tries: 1 })], [false, true]);
check('at most 5 tries a day', D(il(SUN, 20), 2, { day: SUN, at: il(SUN, 17), tries: 5 }), false);
check('the WhatsApp text', R.lgWorkdayRemindText(3), '⏰ תזכורת: עוד לא נלחץ "סיים יום עבודה" היום.\nיש 3 הזמנות בעבודה, והלקוחות עוד לא קיבלו הודעת "מוכן".');

const provider = (ok = true) => {
  const p = { configured: true, texts: [], gate: () => ({ allowed: true }), async sendText(x) { p.texts.push(x); return { ok: typeof ok === 'function' ? ok(x) : ok }; } };
  return p;
};
const base = extra => ({
  workday: { inWork: ['o1', 'o2', 'o3', 'o4'] },
  orders: { o1: { stage: 'workday' }, o2: { stage: 'chisum' }, o3: { stage: 'done' }, o4: { stage: 'opty' } },
  waMeta: { whatsapp: { state: 'authorized' } }, ...(extra || {}),
});
const env = {};

(async () => {
  {
    const db = fakeDb(base()), p = provider();
    const r = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 3), env, provider: p, gapMs: 0 });
    check('sends to Ben and Shaul, counts only orders still in work (done is not)', [r, p.texts.map(t => t.to)], [{ sent: 2, count: 3 }, ['0547725552', '0506824365']]);
    check('text has the live count', /יש 3 הזמנות בעבודה/.test(p.texts[0].text), true);
    const st = (await db.ref('waMeta/workdayRemind').once('value')).val();
    check('marked sent for the day', [st.day, st.sent, st.sentTo, st.count], [SUN, true, 2, 3]);
    const r2 = await R.lgWorkdayRemindRun(db, { now: il(SUN, 18), env, provider: p, gapMs: 0 });
    check('second call the same day sends nothing', [r2.skip, p.texts.length], ['done-today', 2]);
    const r3 = await R.lgWorkdayRemindRun(db, { now: il(MON, 17, 1), env, provider: p, gapMs: 0 });
    check('next day — again', [r3.sent, p.texts.length], [2, 4]);
  }
  {
    const p = provider();
    const r = await R.lgWorkdayRemindRun(fakeDb(base()), { now: il(SUN, 16, 30), env, provider: p, gapMs: 0 });
    check('before 17:00 — no reads, nothing sent', [r.skip, p.texts.length], ['time', 0]);
    const r2 = await R.lgWorkdayRemindRun(fakeDb(base()), { now: il(FRI, 17, 30), env, provider: p, gapMs: 0 });
    check('Friday — nothing', r2.skip, 'time');
  }
  {
    const p = provider();
    const db = fakeDb(base({ workday: { inWork: ['o3'] } }));
    const r = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 5), env, provider: p, gapMs: 0 });
    check('only finished orders left in the list → nothing', [r.skip, p.texts.length], ['empty', 0]);
    const r2 = await R.lgWorkdayRemindRun(fakeDb(base({ workday: {} })), { now: il(SUN, 17, 5), env, provider: p, gapMs: 0 });
    check('pressed "finish" (empty list) → nothing', r2.skip, 'empty');
  }
  {
    const p = provider();
    const db = fakeDb(base({ waMeta: { whatsapp: { state: 'notAuthorized' } } }));
    const r = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 5), env, provider: p, gapMs: 0 });
    check('WhatsApp down → not sent and not counted as a try', [r.skip, p.texts.length, (await db.ref('waMeta/workdayRemind').once('value')).val()], ['wa-down', 0, null]);
  }
  {
    const p = provider(false), db = fakeDb(base());
    const r = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 5), env, provider: p, gapMs: 0 });
    const st = (await db.ref('waMeta/workdayRemind').once('value')).val();
    check('send failed → try recorded, not sent', [r.sent, st.sent, st.tries], [0, false, 1]);
    const r1 = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 6), env, provider: p, gapMs: 0 });
    check('retry waits 2 minutes', r1.skip, 'wait');
    const ok = provider(), r2 = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 8), env, provider: ok, gapMs: 0 });
    check('retry later succeeds', [r2.sent, ok.texts.length], [2, 2]);
  }
  {
    const p = provider(x => x.to === '0547725552'), db = fakeDb(base());
    const r = await R.lgWorkdayRemindRun(db, { now: il(SUN, 17, 5), env, provider: p, gapMs: 0 });
    check('one of two reached → counted as sent (no repeat to the one who got it)', r.sent, 1);
  }
  {
    const p = provider();
    const r = await R.lgWorkdayRemindRun(fakeDb(base()), { now: il(SUN, 17, 5), env: { WORKDAY_REMIND_ENABLED: 'false' }, provider: p, gapMs: 0 });
    check('switch off', [r.skip, p.texts.length], ['off', 0]);
    const p2 = provider();
    await R.lgWorkdayRemindRun(fakeDb(base()), { now: il(SUN, 17, 5), env: { WORKDAY_REMIND_TO: '050-111-2222' }, provider: p2, gapMs: 0 });
    check('recipients from WORKDAY_REMIND_TO', p2.texts.map(t => t.to), ['0501112222']);
    const p3 = { ...provider(), gate: () => ({ allowed: false }) };
    p3.texts = []; p3.sendText = async x => { p3.texts.push(x); return { ok: true }; };
    const r3 = await R.lgWorkdayRemindRun(fakeDb(base()), { now: il(SUN, 17, 5), env, provider: p3, gapMs: 0 });
    check('provider gate (test environment lock) respected', [r3.sent, p3.texts.length], [0, 0]);
  }

  // ─── החיווט ───
  const live = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const EI = fs.readFileSync(path.join(ROOT, 'api', 'email-inbound.js'), 'utf8');
  check('email script tick (every minute) runs the reminder, not behind the agents switch',
    [/b\.op === 'outbox-claim'[\s\S]{0,600}_workdayTick\(deps\)/.test(EI), /function _workdayTick[\s\S]{0,400}lgWorkdayRemindRun/.test(EI),
     /function _workdayTick[\s\S]{0,300}AGENT_SHADOW_ENABLED/.test(EI)], [true, true, false]);
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
  check('workday page loads the helper', /<script src="workday-remind\.js\?v=\d+"><\/script>/.test(WD), true);
  check('saveWorkDay records since / clears it when empty',
    [/function saveWorkDay\(\)\{[\s\S]{0,500}if\(!workDay\.inWork\.length\) workDay\.inWorkSince = null;[\s\S]{0,120}workDay\.inWorkSince = Date\.now\(\)/.test(WD),
     /inWorkSince: workDay\.inWorkSince \|\| null/.test(WD), /workDay\.inWorkSince = Number\(wd\.inWorkSince\) \|\| null/.test(WD)], [true, true, true]);
  check('"הורד לעבודה" asks first when old work is left, with both buttons',
    [/function commitDraftToWork\(force, oldOk\)\{[\s\S]{0,400}lgWorkdayForgot\([\s\S]{0,120}=== 'old'[\s\S]{0,40}wdShowOldWork\(\); return;/.test(WD),
     /closeDraftPreview\(\); finishDay\(\);">סיים את הקודם קודם/.test(WD), /commitDraftToWork\(false, true\)">הורד בכל זאת/.test(WD),
     /commitDraftToWork\(true, true\)">הורד בכל זאת/.test(WD)], [true, true, true, true]);
  check('the old-work text is escaped', /\$\{lgEsc\(lgWorkdayForgotText\('old'/.test(WD), true);
  const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('main page: helper, bar linking to workday, listeners + minute timer',
    [/<script src="workday-remind\.js\?v=\d+"><\/script>/.test(A), /<a id="wdForgotBar" href="workday\.html"/.test(A),
     /lgWdForgotInit\(\);/.test(live(A)), /setInterval\(lgWdForgotRender, 60 \* 1000\)/.test(A), /orders = remoteOrders;\s*lgWdForgotRender\(\);/.test(A),
     /el\.textContent = /.test(A)], [true, true, true, true, true, true]);
  //  השעה זהה בשני המקומות
  const SV = fs.readFileSync(path.join(ROOT, 'api', '_workday-remind.js'), 'utf8');
  check('same hour and days in browser and server', [R.HOUR === W.LG_WD_REMIND_HOUR, /const DAYS = \['Sun', 'Mon', 'Tue', 'Wed', 'Thu'\]/.test(SV)], [true, true]);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll workday-remind checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
