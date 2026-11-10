#!/usr/bin/env node
/**
 * מנהל — סיכום בוקר בחדר (פריטים 8+9, 11/11).
 *  • פעם ביום, בדופק הראשון אחרי 07:00 בישראל (ראשון–שישי), רק עם הגדרות במסך והמנהל לא כבוי.
 *  • שאלות פתוחות לבן, טיוטה לשרטט + משלוחים פתוחים, חשבוניות/קבצים תקועים, נשלחו לחשבשבת אתמול.
 *  • ביום ראשון: אחוז ✓ לכל סוכן מ-7 הימים האחרונים (verdict ב-agentShadow); ≥95% ו-≥20 דגימות
 *    וסוכן ב"שקט" → "אפשר להדליק 'עונה' ל<סוכן>". חדר בלבד.
 * Run:  node scripts/test-agent-morning.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const M = require(path.join(ROOT, 'api', '_agent-morning.js'));
const W = require(path.join(ROOT, 'api', '_agent-watch.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const SUN_0705 = Date.UTC(2026, 10, 15, 5, 5);     // ראשון 15/11 07:05 בישראל (UTC+2)
const SUN_0655 = Date.UTC(2026, 10, 15, 4, 55);
const MON_0710 = Date.UTC(2026, 10, 16, 5, 10);
const SAT_0900 = Date.UTC(2026, 10, 14, 7, 0);
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = (over) => ({ agents: { markazan: 'shadow', okev: 'reply', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'shadow', ...(over || {}) } });

//  20 סימונים למרכזן (19 ✓ = 95%), 10 לעוקב (8 ✓), אחד ישן מדי, אחד של צוות
const shadow = now => {
  const out = {};
  for (let i = 0; i < 20; i++) out['m' + i] = { route: 'menu', createdAt: now - DAY, verdict: { ok: i !== 0, at: now - DAY } };
  for (let i = 0; i < 10; i++) out['o' + i] = { route: 'okev', createdAt: now - DAY, verdict: { ok: i < 8, at: now - DAY } };
  out.old = { route: 'menu', createdAt: now - 9 * DAY, verdict: { ok: false, at: now - 8 * DAY } };
  out.staff = { route: 'staff', staff: true, createdAt: now - DAY, verdict: { ok: false, at: now - DAY } };
  out.none = { route: 'menu', createdAt: now - DAY };
  return out;
};
const seed = (cfg, now) => fakeDb({
  orders: {
    d1: { orderNum: 'L1', orderClient: 'כהן', stage: 'drafter', createdAt: now - DAY },
    d2: { orderNum: 'L2', orderClient: 'נאור', stage: 'chash', createdAt: now - DAY, drafterBatch: 4 },
    d3: { orderNum: 'L3', stage: 'drafter', createdAt: now - DAY, drafterHold: true },
    h1: { orderNum: 'L10', stage: 'opty', hashavshevet: { sentAt: now - DAY, httpOk: true } },
    h2: { orderNum: 'L11', stage: 'opty', hsOrder: { sentAt: now - DAY + H, httpOk: true } },
    h3: { orderNum: 'L12', stage: 'opty', hashavshevet: { sentAt: now - DAY, simulated: true, httpOk: true } },
    h4: { orderNum: 'L13', stage: 'opty', hashavshevet: { sentAt: now - 3 * DAY, httpOk: true } },
    h5: { orderNum: 'L14', stage: 'opty', hashavshevet: { sentAt: now - 5 * MIN, httpOk: true } },
    h6: { orderNum: 'L15', stage: 'opty', hashavshevet: { sentAt: now - DAY, httpOk: false } },   // ניסיון שנכשל — לא "נשלח"
    h7: { orderNum: 'L16', stage: 'opty', hashavshevet: { sentAt: now - DAY } },                  // בלי httpOk — לא "נשלח"
  },
  waMeta: {
    ...(cfg ? { agentConfig: cfg } : {}),
    agentRoomOpen: { k1: { at: now - H, agent: 'markazan', customer: 'כהן זכוכית' } },
    drafterBatches: { _next: 5, 4: { n: 4, at: now - DAY, count: 1, orderIds: ['d2'] }, 3: { n: 3, at: now - 2 * DAY, count: 2, doneAt: now - DAY } },
    agentWatch: { problems: {
      printed_x: { level: 'ask', agent: 'archive', at: now - H, text: 'חשבונית 67001 הודפסה לפני יותר משעה ועדיין לא נרשמה בתחנת החשבוניות' },
      long_4: { level: 'info', agent: 'kolet', at: now - H, text: 'משלוח 4 אצל השרטט כבר יותר מיום' },
      file_y: { level: 'info', agent: 'archive', at: now - H, text: 'נסגר', dismissed: true },
    } },
    agentShadow: shadow(now),
  },
});
const summaries = d => Object.values(d._data.waMeta.agentRoom || {}).filter(e => e.kind === 'summary');

(async () => {
  /* ── טהור ── */
  check('due: Sunday 07:05', M.lgMorningDue(SUN_0705), true);
  check('due: Sunday 06:55 → no', M.lgMorningDue(SUN_0655), false);
  check('due: Saturday → no', M.lgMorningDue(SAT_0900), false);
  check('due: Friday 08:00 → yes', M.lgMorningDue(Date.UTC(2026, 10, 13, 6, 0)), true);
  const rates = M.lgVerdictRates(shadow(SUN_0705), SUN_0705);
  check('rates: last 7 days, no staff, by agent', rates, { markazan: { n: 20, ok: 19 }, okev: { n: 10, ok: 8 } });

  /* ── ראשון: הסיכום המלא + ההמלצה השבועית ── */
  {
    const d = seed(CFG(), SUN_0705);
    const r = await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 });
    const s = summaries(d);
    check('posted once, manager summary', [r.posted, s.length, s[0] && s[0].agent], [true, 1, 'manager']);
    check('text', s[0].text, [
      'בוקר טוב — סיכום בוקר 15.11.2026',
      'שאלות שמחכות לך בחדר: 1 (כהן זכוכית)',
      'טיוטה לשרטט: 1 הזמנות · משלוחים פתוחים אצל השרטט: 1 (משלוח 4 — 1)',
      'חשבוניות / קבצים תקועים: 1 — חשבונית 67001 הודפסה לפני יותר משעה ועדיין לא נרשמה בתחנת החשבוניות',
      'נשלחו לחשבשבת אתמול: 2 (L10, L11)',
      '✓ בשבוע האחרון: מרכזן 95% (20) · עוקב 80% (10)',
      "אפשר להדליק 'עונה' למרכזן",
    ].join('\n'));
    await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 + 30 * MIN });
    check('same day → not again', summaries(d).length, 1);
  }
  {
    //  עוקב כבר "עונה", ומרכזן "עונה" → אין המלצה
    const d = seed(CFG({ markazan: 'reply' }), SUN_0705);
    await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 });
    check('agent already replying → no recommendation', /אפשר להדליק/.test(summaries(d)[0].text), false);
  }
  {
    //  שני — בלי השורה השבועית
    const d = seed(CFG(), MON_0710);
    await M.lgAgentMorningRun(d, { env: ENV, now: MON_0710 });
    check('Monday: no weekly line', /בשבוע האחרון/.test(summaries(d)[0].text), false);
  }
  for (const [name, cfg, now, env] of [
    ['no agentConfig → nothing', null, SUN_0705, ENV],
    ['manager off → nothing', CFG({ manager: 'off' }), SUN_0705, ENV],
    ['before 07:00 → nothing', CFG(), SUN_0655, ENV],
    ['Saturday → nothing', CFG(), SAT_0900, ENV],
    ['master switch off → nothing', CFG(), SUN_0705, {}],
  ]) {
    const d = seed(cfg, now);
    await M.lgAgentMorningRun(d, { env, now });
    check(name, summaries(d).length, 0);
  }

  {
    //  סקירת שחרור 11/11: היום מסומן "בוצע" רק אחרי פרסום מוצלח; ריצה שנכשלה — שוב לכל היותר פעם ב-10 דק'
    const d = seed(CFG(), SUN_0705);
    const R = require(path.join(ROOT, 'api', '_agent-room.js'));
    const post0 = R.lgRoomPost;
    R.lgRoomPost = async () => null;
    const r1 = await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 });
    const r2 = await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 + 5 * MIN });
    R.lgRoomPost = post0;
    check('room post failed → not posted; retry within 10 min → throttled', [r1.posted, r2.skipped], [false, 'retry-wait']);
    const r3 = await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 + 11 * MIN });
    check('after 10 min → posted', [r3.posted, summaries(d).length], [true, 1]);
    const r4 = await M.lgAgentMorningRun(d, { env: ENV, now: SUN_0705 + 30 * MIN });
    check('after success → done for the day', [r4.skipped, summaries(d).length], ['done-today', 1]);
  }

  /* ── מהדופק ── */
  {
    const d = seed(CFG(), SUN_0705);
    await W.lgAgentWatchRun(d, { env: ENV, now: SUN_0705 });
    await W.lgAgentWatchRun(d, { env: ENV, now: SUN_0705 + 2 * MIN });
    check('heartbeat posts the morning summary once', summaries(d).length, 1);
    const outbox = Object.keys(d._data.waMeta.agentOutbox || {}).length;
    check('room only — nothing queued to WhatsApp', outbox, 0);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
