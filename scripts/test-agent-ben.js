#!/usr/bin/env node
/**
 * הודעות לבן — בלי הצפה, ושני שעונים עם התראות תקלה (בן, 11/11). api/_agent-ben.js
 * אפיון: docs/superpowers/specs/2026-11-11-agents-talk-design.md — סעיפים ח, י, יא.
 *  • אותה בעיה = הודעה אחת; תזכורת אחת אחרי 3 שעות; 21:00–06:00 בשקט → הודעה אחת ב-06:00; עד 20 ביום.
 *  • התראות תקלה (וואטסאפ מנותק / המחשב במשרד שקט / סקריפט המייל שקט) — גם בלילה וגם כשהסוכנים "שקט",
 *    ישר דרך ספק הוואטסאפ; וואטסאפ מנותק → מייל ל-escalateEmail.
 *  • המספר של בן בשכבת השליחה: רק AGENT_BEN_REASONS.
 * Run: node scripts/test-agent-ben.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const B = require(path.join(ROOT, 'api', '_agent-ben.js'));
const S = require(path.join(ROOT, 'api', '_agent-send.js'));
const G = require(path.join(ROOT, 'api', '_agent-guards.js'));
const W = require(path.join(ROOT, 'api', '_agent-watch.js'));
const EO = require(path.join(ROOT, 'api', '_email-outbox.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
//  שלישי 10.11.2026 10:00 בישראל (UTC+2)
const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const NIGHT = Date.UTC(2026, 10, 10, 21, 0, 0);          // 23:00 בישראל
const MORNING = Date.UTC(2026, 10, 11, 4, 5, 0);         // רביעי 06:05
const BEN = '0547725552';
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const ALL = m => ({ markazan: m, okev: m, archive: m, price: m, kolet: m, manager: m });
const CFG = (m, extra) => ({ agents: ALL(m), escalatePhone: BEN, ...(extra || {}) });
const mk = (cfg, extra) => fakeDb({ waMeta: { whatsapp: { state: 'authorized' }, ...(cfg ? { agentConfig: cfg } : {}), ...(extra || {}) } });
const outbox = db => Object.entries(((db._data.waMeta || {}).agentOutbox) || {}).map(([key, v]) => ({ key, ...v }));
const emails = db => Object.values(((db._data.waMeta || {}).emailOutbox) || {});
const room = db => Object.values(((db._data.waMeta || {}).agentRoom) || {}).sort((a, b) => a.at - b.at);
const ben = db => ((db._data.waMeta || {}).agentBen) || {};
const noSend = async () => ({ sent: 0 });
function provider(over) {
  const p = { name: 'fake', configured: true, globalSlot: false, maxPerRun: 10, checksState: false, nextGap: () => 0, texts: [],
    gate() { return { allowed: true, reason: '' }; },
    async sendText(f) { p.texts.push(f); return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length }; }, ...(over || {}) };
  return p;
}
const notify = (db, a, o) => B.lgBenNotify(db, { reason: 'agent-guard', urgent: false, env: ENV, cfg: CFG('reply'), sendPending: noSend, ...a, ...(o || {}) });

(async () => {
  // ═══ טהור: lgBenPolicy ═══
  const P = a => B.lgBenPolicy({ now: NOW, key: 'k', urgent: false, sentLog: {}, dayCount: 0, ...a });
  check('policy: first ping in the day → now, reminder in 3h', P({}), { send: 'now', reminderAt: NOW + 3 * H });
  check('policy: night → night', P({ now: NIGHT }).send, 'night');
  check('policy: 05:59 is still night, 06:00 is not', [P({ now: Date.UTC(2026, 10, 11, 3, 59) }).send, P({ now: Date.UTC(2026, 10, 11, 4, 0) }).send], ['night', 'now']);
  check('policy: 21:00 is night', P({ now: Date.UTC(2026, 10, 10, 19, 0) }).send, 'night');
  check('policy: 20 already today → skip', P({ dayCount: 20 }).send, 'skip');
  check('policy: same key within 3h → skip', P({ sentLog: { k: { at: NOW - H } } }).send, 'skip');
  check('policy: same key after 3h → reminder', P({ sentLog: { k: { at: NOW - 3 * H } } }), { send: 'now', reminder: true });
  check('policy: reminder already sent → skip', P({ sentLog: { k: { at: NOW - 5 * H, reminded: true } } }).send, 'skip');
  check('policy: urgent at night, over the cap → now', P({ urgent: true, now: NIGHT, dayCount: 25 }).send, 'now');
  check('policy: urgent same key within 3h → skip', P({ urgent: true, sentLog: { k: { at: NOW - H } } }).send, 'skip');
  check('reasons', S.AGENT_BEN_REASONS, ['agent-ask', 'agent-upset', 'agent-guard', 'agent-digest', 'agent-alarm']);
  check('night window', [B.lgBenIsNight(NIGHT), B.lgBenIsNight(NOW)], [true, false]);

  // ═══ אותה בעיה פעמיים → הודעה אחת; תזכורת אחת אחרי 3 שעות ═══
  {
    const db = mk(CFG('reply'));
    const r1 = await notify(db, { key: 'wao_1', text: 'הודעה לא יצאה', now: NOW });
    const r2 = await notify(db, { key: 'wao_1', text: 'הודעה לא יצאה', now: NOW + 10 * MIN });
    check('same key twice → one ping', [r1.sent, r2.sent, outbox(db).length], ['now', 'skip', 1]);
    check('the ping goes to Ben, reason agent-guard, fixed text', [outbox(db)[0].to, outbox(db)[0].reason, outbox(db)[0].text], [BEN, 'agent-guard', 'הודעה לא יצאה']);
    const r3 = await notify(db, { key: 'wao_1', text: 'הודעה לא יצאה', now: NOW + 3 * H + MIN });
    const r4 = await notify(db, { key: 'wao_1', text: 'הודעה לא יצאה', now: NOW + 7 * H });
    check('reminder once after 3h', [r3.sent, r4.sent, outbox(db).length], ['now', 'skip', 2]);
    check('reminder says so', outbox(db).map(o => o.text).sort()[1].startsWith('תזכורת: '), true);
    check('day counter counts both', ben(db).day['20261110'].n, 2);
  }

  // ═══ 50 בעיות בסבב אחד → 20 הודעות, השאר רק בחדר ═══
  {
    const db = mk(CFG('reply'));
    const res = [];
    for (let i = 0; i < 50; i++) res.push((await notify(db, { key: 'p' + i, text: 'בעיה ' + i, now: NOW + i })).sent);
    check('21st ping same day → room only (skip)', [res.filter(x => x === 'now').length, res[20], outbox(db).length], [20, 'skip', 20]);
    check('over-cap counted for the summary', ben(db).day['20261110'].over, 30);
  }

  // ═══ לילה → נשמר, לא נשלח; 06:00 → הודעה אחת ═══
  {
    const db = mk(CFG('reply'));
    const a = await notify(db, { key: 'n1', text: 'בעיה ראשונה', now: NIGHT });
    const b = await notify(db, { key: 'n2', text: 'בעיה שנייה', now: NIGHT + H });
    check('night → queued for the morning, not sent', [a.sent, b.sent, outbox(db).length, Object.keys(ben(db).night).sort()], ['night', 'night', 0, ['n1', 'n2']]);
    const p = provider();
    const d0 = await B.lgBenDigestRun(db, { env: ENV, now: NIGHT + 2 * H, cfg: CFG('reply'), sendPending: noSend });
    check('digest does not run before 06:00', [d0.sent, outbox(db).length], [false, 0]);
    const d1 = await B.lgBenDigestRun(db, { env: ENV, now: MORNING, cfg: CFG('reply'), sendPending: noSend, provider: p });
    const d2 = await B.lgBenDigestRun(db, { env: ENV, now: MORNING + 10 * MIN, cfg: CFG('reply'), sendPending: noSend });
    const ob = outbox(db);
    check('digest at 06:00 sends one message, once a day', [d1.sent, d2.sent, ob.length, ob[0].reason, ob[0].to], [true, false, 1, 'agent-digest', BEN]);
    check('digest lists both night items', [/בעיה ראשונה/.test(ob[0].text), /בעיה שנייה/.test(ob[0].text), /2/.test(ob[0].text)], [true, true, true]);
    check('night list emptied', ben(db).night || null, null);
  }

  // ═══ ניקוי: רשומות ישנות מ-14 יום נמחקות בריצת הבוקר ═══
  {
    const db = mk(CFG('reply'), { agentBen: { sent: { old: { at: MORNING - 15 * DAY }, fresh: { at: MORNING - 2 * DAY } },
                                              day: { 20261020: { n: 3 }, 20261109: { n: 1 } } } });
    await B.lgBenDigestRun(db, { env: ENV, now: MORNING, cfg: CFG('reply'), sendPending: noSend });
    check('prune: sent and day entries older than 14 days dropped', [Object.keys(ben(db).sent), Object.keys(ben(db).day)], [['fresh'], ['20261109']]);
  }

  // ═══ אין הגדרות / מתג עליון כבוי → כלום חדש ═══
  {
    const db = mk(null);
    const r = await B.lgBenNotify(db, { key: 'x', text: 't', reason: 'agent-guard', urgent: true, env: ENV, now: NOW, cfg: null, provider: provider() });
    const c = await B.lgClockCheck(db, 'office', { env: ENV, now: NOW, provider: provider() });
    check('no config: urgent skipped, clock does not run, nothing written', [r.sent, !!c.skipped, !!db._data.waMeta.clocks, !!db._data.waMeta.agentBen], ['skip', true, false, false]);
    const db2 = mk(CFG('reply'));
    const c2 = await B.lgClockCheck(db2, 'office', { env: {}, now: NOW, provider: provider() });
    check('master switch off: clock does not run', [!!c2.skipped, !!db2._data.waMeta.clocks], [true, false]);
  }
  {
    const db = mk(CFG('reply'));
    const r = await notify(db, { key: 'x', text: 't', reason: 'agent-reply', now: NOW });
    check('reason outside AGENT_BEN_REASONS → refused', [r.sent, outbox(db).length], ['skip', 0]);
  }

  // ═══ התראה בלילה / כשהסוכנים "שקט" — ישר דרך הספק ═══
  {
    const db = mk(CFG('shadow')), p = provider();
    const r = await B.lgBenNotify(db, { key: 'alarm_gmail', text: 'סקריפט המייל לא פנה', reason: 'agent-alarm', urgent: true, env: ENV, now: NIGHT, cfg: CFG('shadow'), provider: p });
    check('alarm at night still sent, agents on shadow, not through the queue', [r.sent, r.channel, p.texts.map(t => t.to), outbox(db).length], ['now', 'wa', [BEN], 0]);
  }
  {
    const db = mk(CFG('shadow', { escalateEmail: 'ben@example.com' }), { whatsapp: { state: 'notAuthorized' } }), p = provider();
    const r = await B.lgBenNotify(db, { key: 'alarm_wa', text: 'הוואטסאפ מנותק', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW,
                                        cfg: CFG('shadow', { escalateEmail: 'ben@example.com' }), provider: p });
    const em = emails(db);
    check('WA down → email to escalateEmail', [r.sent, r.channel, p.texts.length, em.length, em[0] && em[0].sendTo, em[0] && em[0].kind], ['now', 'email', 0, 1, 'ben@example.com', 'agent-alarm']);
    //  התפיסה של הסקריפט: מייל פנימי — בלי מזהה מייל של לקוח ובלי קישור, עם נושא
    process.env.EMAIL_ONLY_TO = 'ben@example.com';
    const items = await EO.lgEmailClaim(db, 5, NOW + MIN);
    delete process.env.EMAIL_ONLY_TO;
    check('email claim hands the alarm to the script', [items.length, items[0] && items[0].sendTo, !!(items[0] && items[0].subject), items[0] && /מנותק/.test(items[0].text)], [1, 'ben@example.com', true, true]);
  }
  {
    const db = mk(CFG('shadow'), { whatsapp: { state: 'notAuthorized' } }), p = provider();
    const r = await B.lgBenNotify(db, { key: 'alarm_wa', text: 'הוואטסאפ מנותק', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg: CFG('shadow'), provider: p });
    check('WA down and no email → room only', [r.sent, r.channel, p.texts.length, emails(db).length], ['now', 'room', 0, 0]);
  }

  // ═══ התראה על סקריפט המייל — אף פעם לא במייל (בן, 12/11: התזכורת של 16:10 יצאה רק ב-17:32) ═══
  {
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    //  ניסיון ראשון נכשל → ניסיון שני מצליח
    const db = mk(cfg); let n = 0;
    const p = provider({ async sendText(f) { n++; p.texts.push(f); return n === 1 ? { ok: false, httpStatus: 500 } : { ok: true, httpStatus: 200 }; } });
    const r = await B.lgBenNotify(db, { key: 'alarm_gmail_1', text: 'התראה: סקריפט המייל לא פנה', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg, provider: p, retryGapMs: 0 });
    check('mail-script alarm: WA fails once → second try goes out on WA, no email', [r.channel, p.texts.length, emails(db).length], ['wa', 2, 0]);
  }
  {
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg);
    const p = provider({ async sendText(f) { p.texts.push(f); return { ok: false, httpStatus: 500 }; } });
    const r = await B.lgBenNotify(db, { key: 'alarm_gmail_2', text: 'התראה: סקריפט המייל לא פנה', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg, provider: p, retryGapMs: 0 });
    check('mail-script alarm: WA fails twice → room only, never email', [r.channel, p.texts.length, emails(db).length], ['room', 2, 0]);
  }
  {
    //  המצב השמור "מנותק" — עדיין מנסים וואטסאפ (ולא מייל)
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg, { whatsapp: { state: 'notAuthorized' } }), p = provider();
    const r = await B.lgBenNotify(db, { key: 'alarm_gmail_3', text: 'התראה: סקריפט המייל לא פנה', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg, provider: p, retryGapMs: 0 });
    check('mail-script alarm: stored WA state not authorized → still tries WA, no email', [r.channel, p.texts.length, emails(db).length], ['wa', 1, 0]);
  }
  {
    //  תזכורת אחרי 3 שעות — גם היא בוואטסאפ, לא במייל
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg); let n = 0;
    const p = provider({ async sendText(f) { n++; p.texts.push(f); return n === 2 ? { ok: false } : { ok: true }; } });
    await B.lgBenNotify(db, { key: 'alarm_gmail_4', text: 'התראה: x', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg, provider: p, retryGapMs: 0 });
    const r = await B.lgBenNotify(db, { key: 'alarm_gmail_4', text: 'התראה: x', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW + 3 * H + MIN, cfg, provider: p, retryGapMs: 0 });
    check('mail-script reminder after 3h: WA (with retry), no email', [r.channel, p.texts.length, /^תזכורת: /.test(p.texts[2].text), emails(db).length], ['wa', 3, true, 0]);
  }
  {
    //  התראה אחרת (וואטסאפ מנותק) — ניסיון אחד בלבד, כמו קודם
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg);
    const p = provider({ async sendText(f) { p.texts.push(f); return { ok: false }; } });
    const r = await B.lgBenNotify(db, { key: 'alarm_office_1', text: 'המחשב', reason: 'agent-alarm', urgent: true, env: ENV, now: NOW, cfg, provider: p, retryGapMs: 0 });
    check('office alarm unchanged: one WA try, then email', [r.channel, p.texts.length, emails(db).length], ['email', 1, 1]);
  }

  // ═══ המספר של בן בשכבת השליחה ═══
  {
    const db = mk(CFG('reply')), p = provider();
    await S.lgAgentEnqueue(db, { key: 'r1', to: BEN, customerId: '', text: 'x', reason: 'agent-reply', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'r2', to: BEN, customerId: '', text: 'x', reason: 'agent-guard', agent: 'okev' });
    await S.lgAgentEnqueue(db, { key: 'r3', to: BEN, customerId: '', text: 'x', reason: 'agent-digest', agent: '' });
    await S.lgAgentEnqueue(db, { key: 'r4', to: BEN, customerId: '', text: 'x', reason: 'agent-staff', agent: 'okev' });
    await S.lgAgentSendPending(db, { provider: p, env: ENV });
    const ob = db._data.waMeta.agentOutbox;
    check('Ben number refuses reason agent-reply / agent-staff, allows guard / digest', [ob.r1.state, ob.r2.state, ob.r3.state, ob.r4.state], ['blocked', 'sent', 'sent', 'blocked']);
  }

  // ═══ השומרים עוברים דרך lgBenNotify ═══
  {
    const db = mk(CFG('reply'));
    const r = await G._notifyBen(db, { key: 'wao_9', text: 'שאלה לבן', reason: 'guard', urgent: false, env: ENV, now: NOW, cfg: CFG('reply'), sendPending: noSend });
    check('guard notify → agent-guard ping', [r.sent, outbox(db).map(o => o.reason)], ['now', ['agent-guard']]);
  }

  // ═══ אירוע "שאלה" מהבדיקות (lgAgentEvent) — דרך lgBenNotify, גם בלילה ═══
  {
    const db = mk(CFG('reply'));
    const e1 = await W.lgAgentEvent(db, 'archive', { kind: 'ask', text: 'קובץ מחכה' }, { env: ENV, now: NOW, cfg: CFG('reply'), sendPending: noSend });
    const db2 = mk(CFG('reply'));
    const e2 = await W.lgAgentEvent(db2, 'archive', { kind: 'ask', text: 'קובץ מחכה' }, { env: ENV, now: NIGHT, cfg: CFG('reply'), sendPending: noSend });
    check('watch ask → agent-ask ping by day, morning list by night',
      [e1.pinged, outbox(db).map(o => o.reason), e2.pinged, outbox(db2).length, Object.keys(ben(db2).night || {}).length], [true, ['agent-ask'], false, 0, 1]);
  }

  // ═══ השעונים ═══
  //  gmail שקט 16 דק' → הדופק מהמשרד מתריע פעם אחת
  {
    const { handleUpload } = require(path.join(ROOT, 'api', '_invoice-upload.js'));
    const db = mk(CFG('shadow'), { clocks: { gmail: { at: NOW - 16 * MIN } } }), p = provider();
    const beat = now => handleUpload({ method: 'POST', headers: { authorization: 'Bearer T' }, body: { op: 'heartbeat', pc: 'OFFICE', pending: [] } }, {
      db, env: { ...ENV, INVOICE_UPLOAD_TOKEN: 'T' }, now, provider: p,
      waDrain: async () => ({}), watchRun: async () => ({}), readyNet: async () => ({}) });
    await beat(NOW);
    await beat(NOW + MIN);
    await beat(NOW + 2 * MIN);
    check('gmail silent 16 min → office heartbeat alarms once', [p.texts.length, p.texts[0] && p.texts[0].to, /מייל/.test(p.texts[0] && p.texts[0].text)], [1, BEN, true]);
    check('office clock recorded', db._data.waMeta.clocks.office.at, NOW + 2 * MIN);
    check('alarm in the room', room(db).filter(r => /מייל/.test(r.text)).length, 1);
    //  הסקריפט חוזר → שורת "חזר" בחדר, ואפשר להתריע שוב בפעם הבאה
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW + 3 * MIN, provider: p });
    check('gmail back → room done line, alarm cleared', [room(db).some(r => r.step === 'done' && /מייל/.test(r.text)), !!(db._data.waMeta.clocks.alarms || {}).alarm_gmail], [true, false]);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 20 * MIN, provider: p });
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 23 * MIN, provider: p });
    check('gmail silent again within 2h → no second alarm (cooldown)', p.texts.length, 1);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 2 * H + 5 * MIN, provider: p });
    check('after 2h, still silent → alarms again', p.texts.length, 2);
  }
  //  המחשב במשרד שקט > 30 דק' בשעות עבודה → השעון של המייל מתריע; מחוץ לשעות — לא
  {
    const db = mk(CFG('shadow'), { clocks: { office: { at: NOW - 31 * MIN } } }), p = provider();
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW, provider: p });
    check('office silent seen once → not yet', p.texts.length, 0);
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW + MIN, provider: p });
    check('second check only 1 min later → not yet', p.texts.length, 0);
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW + 2 * MIN, provider: p });
    check('office silent 31 min in working hours → alarm from the gmail clock', [p.texts.length, /משרד/.test(p.texts[0] && p.texts[0].text)], [1, true]);
    const db2 = mk(CFG('shadow'), { clocks: { office: { at: NIGHT - 2 * H } } }), p2 = provider();
    await B.lgClockCheck(db2, 'gmail', { env: ENV, now: NIGHT, provider: p2 });
    await B.lgClockCheck(db2, 'gmail', { env: ENV, now: NIGHT + 3 * MIN, provider: p2 });
    check('office silent at night → no alarm', p2.texts.length, 0);
  }
  //  וואטסאפ מנותק → מייל (פעם אחת), חזר → שורת "חזר"
  {
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg, { whatsapp: { state: 'notAuthorized', checkedAt: NOW } }), p = provider();
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW, provider: p });
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW + 30 * 1000, provider: p });
    check('WA down seen by both clocks within 2 min → not yet', emails(db).length, 0);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 2 * MIN, provider: p });
    await B.lgClockCheck(db, 'gmail', { env: ENV, now: NOW + 2 * MIN + 30 * 1000, provider: p });
    check('WA disconnected → one email alarm (both clocks)', [emails(db).length, p.texts.length], [1, 0]);
    db._data.waMeta.whatsapp = { state: 'authorized', checkedAt: NOW + 31 * MIN - 40 * MIN };   // נבדק לפני 40 דק' — לא ידוע
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 31 * MIN, provider: p });
    check('stale "authorized" (checked 40 min ago) → no back line, alarm stays', [room(db).some(r => r.step === 'done' && /וואטסאפ/.test(r.text)), !!db._data.waMeta.clocks.alarms.alarm_wa], [false, true]);
    db._data.waMeta.whatsapp = { state: 'authorized', checkedAt: NOW + 33 * MIN };
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 33 * MIN, provider: p });
    check('WA back → done line', room(db).some(r => r.step === 'done' && /וואטסאפ/.test(r.text)), true);
  }
  //  מצב וואטסאפ ישן (נבדק לפני יותר מ-30 דק') → לא ידוע: לא מתריעים (תיקון סקירה סופית I1)
  {
    const cfg = CFG('shadow', { escalateEmail: 'ben@example.com' });
    const db = mk(cfg, { whatsapp: { state: 'notAuthorized', checkedAt: NOW - 31 * MIN } }), p = provider();
    for (let i = 0; i < 4; i++) await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + i * 2 * MIN, provider: p, sendPending: noSend });
    check('stale "notAuthorized" (checked 31+ min ago) → no alarm', [emails(db).length, p.texts.length, !!(db._data.waMeta.clocks.alarms || {}).alarm_wa], [0, 0, false]);
    const db2 = mk(cfg, { whatsapp: { state: 'notAuthorized' } }), p2 = provider();
    for (let i = 0; i < 4; i++) await B.lgClockCheck(db2, 'office', { env: ENV, now: NOW + i * 2 * MIN, provider: p2, sendPending: noSend });
    check('state with no checkedAt → no alarm', emails(db2).length, 0);
  }
  //  המחשב במשרד: כבוי כל הלילה → אין התראה בבוקר; עבד היום ונעצר → התראה (תיקון סקירה סופית I2)
  {
    const D = Date.UTC(2026, 10, 10, 5, 2, 0);            // שלישי 07:02 בישראל
    const db = mk(CFG('shadow'), { clocks: { office: { at: Date.UTC(2026, 10, 9, 16, 0, 0) } } }), p = provider();   // אתמול 18:00
    for (let i = 0; i < 5; i++) await B.lgClockCheck(db, 'gmail', { env: ENV, now: D + i * 2 * MIN, provider: p, sendPending: noSend });
    check('office off all night → no alarm at 07:02', [p.texts.length, !!(db._data.waMeta.clocks.alarms || {}).alarm_office], [0, false]);
    const H8 = Date.UTC(2026, 10, 10, 6, 0, 0);           // 08:00
    const db2 = mk(CFG('shadow'), { clocks: { office: { at: H8 } } }), p2 = provider();
    await B.lgClockCheck(db2, 'gmail', { env: ENV, now: H8 + 31 * MIN, provider: p2, sendPending: noSend });
    await B.lgClockCheck(db2, 'gmail', { env: ENV, now: H8 + 33 * MIN, provider: p2, sendPending: noSend });
    check('office heartbeat 08:00 then silent 31+ min → alarm', [p2.texts.length, /משרד/.test(p2.texts[0] && p2.texts[0].text)], [1, true]);
  }
  //  תזכורת מהשעון: בעיית שומר שעדיין פתוחה אחרי 3 שעות → תזכורת אחת; שנפתרה → כלום
  {
    const db = mk(CFG('reply'), { agentWatch: { problems: { wao_1: { level: 'ben', asked: true }, wao_2: { level: 'ben', asked: true } } } });
    await notify(db, { key: 'wao_1', text: 'בעיה פתוחה', now: NOW, open: 'waMeta/agentWatch/problems/wao_1', agent: 'okev' });
    await notify(db, { key: 'wao_2', text: 'בעיה שנפתרה', now: NOW, open: 'waMeta/agentWatch/problems/wao_2', agent: 'okev' });
    db._data.waMeta.agentWatch.problems.wao_2.resolved = true;
    const p = provider();
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + H, provider: p, sendPending: noSend });
    check('sweep: nothing before 3h', outbox(db).length, 2);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 3 * H + MIN, provider: p, sendPending: noSend });
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 4 * H, provider: p, sendPending: noSend });
    const texts = outbox(db).map(o => o.text).sort();
    check('sweep: one reminder for the open problem only', [outbox(db).length, texts.filter(t => t === 'תזכורת: בעיה פתוחה').length], [3, 1]);
  }
  //  התראה בלי זמן לשליחה ישירה → לא נתפסת עכשיו (תנסה בדופק הבא)
  {
    const db = mk(CFG('shadow'), { clocks: { gmail: { at: NOW - 16 * MIN } } }), p = provider();
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW, provider: p });
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 2 * MIN, provider: p, deadline: Date.now() + 5000 });
    check('no time left → alarm not claimed, nothing sent', [p.texts.length, !!(db._data.waMeta.clocks.alarms || {}).alarm_gmail], [0, false]);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + 3 * MIN, provider: p });
    check('next beat with time → alarm sent', p.texts.length, 1);
  }
  //  וואטסאפ קופץ כל הלילה (מנותק / מחובר כל 5 דק') → לכל היותר התראה אחת בשעתיים
  {
    const cfg = CFG('shadow');
    const db = mk(cfg), p = provider();
    const fires = [];
    for (let t = NIGHT; t < NIGHT + 8 * H; t += MIN) {
      db._data.waMeta.whatsapp.state = Math.floor((t - NIGHT) / (5 * MIN)) % 2 ? 'authorized' : 'notAuthorized';
      db._data.waMeta.whatsapp.checkedAt = t;
      const n0 = room(db).filter(r => r.step === 'found').length;
      await B.lgClockCheck(db, 'office', { env: ENV, now: t, provider: p, sendPending: noSend });
      if (room(db).filter(r => r.step === 'found').length > n0) fires.push(t);
    }
    const gaps = fires.slice(1).map((t, i) => t - fires[i]);
    check('flapping WA over one night → at most one alarm per 2h', [fires.length >= 1, fires.length <= 4, gaps.every(g => g >= 2 * H)], [true, true, true]);
  }
  {
    const db = mk(CFG('shadow'), { whatsapp: { state: 'starting' } }), p = provider();
    for (let i = 0; i < 6; i++) await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + i * 2 * MIN, provider: p, sendPending: noSend });
    db._data.waMeta.whatsapp.state = 'sleepMode';
    for (let i = 6; i < 10; i++) await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + i * 2 * MIN, provider: p, sendPending: noSend });
    check('passing starting / sleepMode → no alarm', [p.texts.length, emails(db).length, !!(db._data.waMeta.clocks.alarms || {}).alarm_wa], [0, 0, false]);
  }
  //  הודעה לבן שנכנסה לתור ולא יצאה → הבדיקה הבאה של השעון שולחת אותה (תיקון סקירה I2)
  {
    const db = mk(CFG('reply')), p = provider();
    await G._notifyBen(db, { key: 'wao_7', text: 'שומר שואל', reason: 'guard', urgent: false, env: ENV, now: NOW, cfg: CFG('reply'), agent: 'okev', sendPending: noSend });
    check('guard ping queued, not sent yet', outbox(db).map(o => o.state), ['pending']);
    await B.lgClockCheck(db, 'office', { env: ENV, now: NOW + MIN, provider: p });
    check('next clock tick sends it', [outbox(db).map(o => o.state), p.texts.map(t => t.to)], [['sent'], [BEN]]);
  }
  //  הודעת הבוקר שנחסמה בשכבת השליחה (כל הסוכנים "שקט") → רשימת הלילה נשמרת
  {
    const db = mk(CFG('reply'));
    await notify(db, { key: 'n1', text: 'בעיה בלילה', now: NIGHT });
    db._data.waMeta.agentConfig = CFG('shadow');
    const d = await B.lgBenDigestRun(db, { env: ENV, now: MORNING, cfg: CFG('shadow'), provider: provider() });
    check('digest blocked by the send layer → night list kept', [d.sent, Object.keys(ben(db).night || {})], [false, ['n1']]);
  }
  //  התקרה נספרת בטרנזקציה: ריצה שראתה 19 ואז מישהו אחר הגיע ל-20 → לא נשלח, המפתח חוזר
  {
    const db = mk(CFG('reply'), { agentBen: { day: { 20261110: { n: 19 } } } });
    const orig = db.ref.bind(db);
    let bumped = false;
    db.ref = p => {
      const r = orig(p);
      if (p === 'waMeta/agentBen/sent/race' && !bumped) {
        const t0 = r.transaction;
        r.transaction = async fn => { bumped = true; db._data.waMeta.agentBen.day['20261110'].n = 20; return t0(fn); };
      }
      return r;
    };
    const r = await notify(db, { key: 'race', text: 'x', now: NOW });
    check('cap counted inside a transaction → 21st not sent, key released', [r.sent, outbox(db).length, ben(db).sent && ben(db).sent.race || null, ben(db).day['20261110'].n],
          ['skip', 0, null, 20]);
  }
  //  תפיסת המייל רושמת את השעון — ברקע (waitUntil), לא מעכבת את התשובה
  {
    const { handleEmailInbound } = require(path.join(ROOT, 'api', 'email-inbound.js'));
    const db = mk(CFG('shadow'));
    const later = [];
    process.env.EMAIL_INBOUND_TOKEN = 'E';
    const r = await handleEmailInbound({ method: 'POST', headers: { authorization: 'Bearer E' }, body: { op: 'outbox-claim' } },
      { db, now: NOW, waitUntil: p => later.push(p), env: ENV });
    check('claim answers; the clock work goes to the background', [r.status, Array.isArray(r.body.items), later.length >= 1], [200, true, true]);
    await Promise.all(later);
    delete process.env.EMAIL_INBOUND_TOKEN;
    check('claim records the gmail clock', db._data.waMeta.clocks.gmail.at, NOW);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
