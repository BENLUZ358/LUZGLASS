'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-ben.js — הודעות לבן בלי הצפה, שני שעונים, והתראות תקלה (בן, 11/11).
//
//  עוזר משותף, לא route. אפיון: docs/superpowers/specs/2026-11-11-agents-talk-design.md — ח, י, יא.
//
//  כל הודעה לבן עוברת כאן (lgBenNotify): שאלה מהחדר (_agent-act / _agent-watch), שומר (_agent-guards),
//  ההודעה של הבוקר, והתראות תקלה. הכללים (lgBenPolicy, טהור):
//    • אותה בעיה (מפתח) = הודעה אחת. תזכורת אחת אחרי 3 שעות אם עדיין פתוחה. לא יותר.
//    • 21:00–06:00 בישראל — לא שולחים. נשמר ב-waMeta/agentBen/night/<מפתח>, ונשלח כהודעה אחת
//      מהשעון הראשון שפועל אחרי 06:00 (lgBenDigestRun, פעם ביום — טרנזקציה על digestDay).
//    • עד 20 הודעות ביום. מעבר לזה — רק בחדר (השורה הצהובה כבר נכתבה אצל הקורא) + שורה בהודעת הבוקר.
//    • התראת תקלה (urgent) — גם בלילה, גם מעבר ל-20, וגם כשהסוכנים "שקט": לא בתור, ישר דרך ספק
//      הוואטסאפ; וואטסאפ לא מחובר (waMeta/whatsapp.state) / השליחה נכשלה → מייל ל-agentConfig.escalateEmail
//      דרך תור המייל (הסקריפט בג'ימייל); אין מייל → רק השורה בחדר.
//  ⚠️ רק טקסט קבוע של המערכת יוצא לבן — אף פעם לא פלט של המודל. הקוראים בונים את הטקסט בקוד.
//  ⚠️ המתג העליון AGENT_SHADOW_ENABLED + waMeta/agentConfig קיים — אחרת כלום חדש לא רץ ולא נכתב.
//     בלי הגדרות: רק ההתראה הישנה על שאלה (agent-ask) עוברת, כמו קודם — בלי מדיניות ובלי רשומות.
//
//  רשומות: waMeta/agentBen/sent/<מפתח> = { at, reminded?, night?, reason, agent, customerId, text, open?, urgent? }
//          waMeta/agentBen/day/<yyyymmdd> = { n, over }   waMeta/agentBen/night/<מפתח> = { at, text, reason }
//          waMeta/agentBen/digestDay = 'yyyymmdd'.  ישנות מ-14 יום נמחקות בריצת הבוקר.
//
//  שני שעונים (lgClockCheck): הדופק מהמחשב במשרד (_invoice-upload heartbeat) וסקריפט המייל
//  (email-inbound outbox-claim, כל דקה). כל אחד רושם waMeta/clocks/<שלו> = { at } ובודק את השני:
//    משרד שקט > 30 דק' בשעות עבודה (lgIsWorkingHours) · סקריפט המייל שקט > 15 דק' · וואטסאפ מנותק.
//  התראה אחת לכל מפתח (alarm_office / alarm_gmail / alarm_wa) כל עוד המצב נמשך — waMeta/clocks/alarms/<מפתח>;
//  חזר לעבוד → שורת "חזר" בחדר והמפתח נמחק. נגד הצפה (תיקון סקירה I1):
//    • התקלה צריכה להיראות בשתי בדיקות רצופות בהפרש 2 דק' לפחות (waMeta/clocks/seen/<מפתח>);
//    • וואטסאפ — רק notAuthorized / blocked (לא starting / sleepMode);
//    • אותו סוג לכל היותר פעם בשעתיים, גם אם "חזר" בינתיים (waMeta/clocks/alarmLast/<מפתח>).
//  בסוף כל בדיקה — שליחת תור הסוכנים עד הדדליין (הודעה רגילה לבן שלא יצאה בחלון שלה).
//  עלות לכל פנייה: agentConfig, waMeta/clocks (צומת קטן), waMeta/whatsapp/state + שער טרנזקציה פעם בדקה.
// ═══════════════════════════════════════════════════════════════════

const S = require('./_agent-send');
const { lgAgentConfig, lgAgentEscalatePhone } = require('./_agent-config');
const { lgRoomSay, ROOM_OPEN } = require('./_agent-room');

const BEN = 'waMeta/agentBen';
const CLOCKS = 'waMeta/clocks';
const WA_STATE = 'waMeta/whatsapp/state';
const PROBLEMS = 'waMeta/agentWatch/problems';
const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const DAY_CAP = 20;
const REMIND_MS = 3 * H;
const KEEP_MS = 14 * DAY;
const OFFICE_SILENT_MS = 30 * MIN;
const GMAIL_SILENT_MS = 15 * MIN;
const CHECK_GAP_MS = 55 * 1000;          // כל שעון בודק לכל היותר פעם בדקה
const SWEEP_GAP_MS = 10 * MIN;           // תזכורות — לכל היותר פעם ב-10 דק'
const URGENT_MIN_LEFT_MS = 16 * 1000;    // שליחה ישירה אחת בגרוע ביותר (15ש׳) + מרווח
const SEND_WINDOW_MS = 20 * 1000;        // ניסיון שליחה מהתור אחרי הכנסה — כמו ב-lgAgentEvent
const DIGEST_LINES = 10;
const SWEEP_MAX = 5;
const ALARM_COOLDOWN_MS = 2 * H;         // התראה מאותו סוג — לכל היותר פעם בשעתיים, גם אם "חזר" בינתיים
const ALARM_CONFIRM_MS = 2 * MIN;        // התקלה נראית בשתי בדיקות רצופות, בהפרש של 2 דק' לפחות
//  רק מצבים שבאמת אומרים "מנותק". starting / sleepMode וכו' — מעבר, לא התראה.
//  כשל שליחה מסוג disconnected נרשם כ-notAuthorized (_wa-drain-core recordState).
const WA_DOWN = ['notAuthorized', 'blocked'];
const SWEEP_MIN_LEFT_MS = 3 * 1000;

//  'guard' (השומרים) → agent-guard. השאר — כמו שהם, ורק מתוך AGENT_BEN_REASONS.
const REASON_MAP = { guard: 'agent-guard' };

const _safeKey = s => String(s == null ? '' : s).replace(/[.#$[\]/\s]/g, '_').slice(0, 120);
const _oneLine = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

//  שעה ותאריך בישראל — אותה גישת Intl כמו lgIsWorkingHours
function _il(now) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { hour: Number(p.hour), day: p.year + p.month + p.day };
}

//  21:00–06:00 בישראל
function lgBenIsNight(now) {
  const h = _il(now).hour;
  return h >= 21 || h < 6;
}

// ─── טהור ─────────────────────────────────────────────────────────────
//  { now, key, urgent, sentLog: { <מפתח>: { at, reminded } }, dayCount } → { send:'now'|'night'|'skip', reminderAt?, reminder?, over? }
function lgBenPolicy({ now, key, urgent, sentLog, dayCount }) {
  const rec = sentLog && typeof sentLog === 'object' ? sentLog[key] : null;
  const over = (Number(dayCount) || 0) >= DAY_CAP;
  if (rec && Number(rec.at)) {
    if (rec.reminded || now - Number(rec.at) < REMIND_MS) return { send: 'skip' };
    if (urgent) return { send: 'now', reminder: true };
    if (lgBenIsNight(now)) return { send: 'night', reminder: true };
    if (over) return { send: 'skip', over: true };
    return { send: 'now', reminder: true };
  }
  if (urgent) return { send: 'now', reminderAt: now + REMIND_MS };
  if (lgBenIsNight(now)) return { send: 'night' };
  if (over) return { send: 'skip', over: true };
  return { send: 'now', reminderAt: now + REMIND_MS };
}

// ─── שליחה ────────────────────────────────────────────────────────────

//  רגיל: לתור הסוכנים (שכבת השליחה בודקת שוב מתגים ונמען), ואז ניסיון שליחה קצר.
//  o.flush === false — הקורא שולח בעצמו (_agent-act).
async function _queue(db, o, { key, text, reason, cfg, env, reminder }) {
  const outKey = (o.outboxKey ? String(o.outboxKey) : 'ben_' + key) + (reminder ? '_r' : '');
  const q = await S.lgAgentEnqueue(db, { key: outKey, to: lgAgentEscalatePhone(cfg), customerId: o.customerId || '', text,
    files: reminder ? [] : (Array.isArray(o.files) ? o.files : []), reason, agent: o.agent || '' });
  if (q.queued && o.flush !== false) {
    try {
      await (o.sendPending || S.lgAgentSendPending)(db, { env, provider: o.provider,
        deadline: Math.min(Date.now() + SEND_WINDOW_MS, Number(o.deadline) || Infinity) });
    } catch (e) { console.warn('agent-ben: send', e && e.name); }
  }
  return { sent: 'now', channel: 'queue', queued: q.queued, key: q.key };
}

//  התראה: ישר דרך הספק לבן; לא מחובר / נכשל → מייל; אין מייל → רק החדר. → 'wa'|'email'|'room'
async function _urgent(db, o, { key, text, cfg, now }) {
  const st = o.waState !== undefined ? o.waState : (await db.ref(WA_STATE).once('value')).val();
  if (st === 'authorized') {
    const p = o.provider || require('./_wa-provider').lgWaProvider();
    const to = lgAgentEscalatePhone(cfg);
    if (p && p.configured && typeof p.sendText === 'function') {
      //  השער של הספק (נעילת סביבת הבדיקות) חל גם כאן
      const g = typeof p.gate === 'function' ? p.gate({ phone: to, accountKey: 'staff', linked: true }) : { allowed: true };
      if (g && g.allowed) {
        let out;
        try { out = await p.sendText({ to, text }); } catch (e) { out = { ok: false }; console.warn('agent-ben: alarm send', e && e.name); }
        if (out && out.ok) return 'wa';
      }
    }
  }
  const { lgEmailAddr } = require('./_email-recipient');
  const email = lgEmailAddr(cfg && cfg.escalateEmail);
  if (email) {
    const { lgEmailEnqueue } = require('./_email-outbox');
    const q = await lgEmailEnqueue(db, { kind: 'agent-alarm', thread: 'alarm', messageId: 'alarm-' + key, email, sendTo: email,
      clientName: '', orderNums: [], orderIds: [], extraLines: String(text).split('\n'), keySuffix: key + '_' + now,
      queuedBy: 'agent-ben', now });
    if (q.queued) return 'email';
  }
  return 'room';
}

//  a: { key, text, reason, urgent, env, now, cfg?, agent?, customerId?, files?, outboxKey?, open?,
//       deadline?, sendPending?, flush?, provider?, waState? } → { sent:'now'|'night'|'skip', channel?, queued?, key? }
async function lgBenNotify(db, a) {
  const o = a || {}, env = o.env || process.env, now = Number(o.now) || Date.now();
  const skip = why => ({ sent: 'skip', why });
  const reason = REASON_MAP[o.reason] || String(o.reason || '');
  if (!S.AGENT_BEN_REASONS.includes(reason)) return skip('reason');
  if (env.AGENT_SHADOW_ENABLED !== 'true') return skip('off');
  const key = _safeKey(o.key);
  const text = String(o.text == null ? '' : o.text).trim();
  if (!key || !text) return skip('empty');
  const cfg = o.cfg !== undefined ? o.cfg : await lgAgentConfig(db);
  const urgent = o.urgent === true;
  //  בלי הגדרות במסך: רק ההתראה הישנה על שאלה, כמו קודם (בלי מדיניות ובלי רשומות חדשות)
  if (!cfg) {
    if (urgent || reason !== S.AGENT_ASK_REASON) return skip('no-config');
    return _queue(db, o, { key, text, reason, cfg, env, reminder: false });
  }
  if (urgent && o.deadline != null && Number(o.deadline) - Date.now() < URGENT_MIN_LEFT_MS) return skip('time');

  const today = _il(now).day;
  const sentRef = db.ref(BEN + '/sent/' + key);
  const [cur, n] = await Promise.all([sentRef.once('value').then(s => s.val()),
                                      db.ref(BEN + '/day/' + today + '/n').once('value').then(s => Number(s.val()) || 0)]);
  const first = lgBenPolicy({ now, key, urgent, sentLog: { [key]: cur }, dayCount: n });
  if (first.send === 'skip') {
    if (first.over) await db.ref(BEN + '/day/' + today + '/over').transaction(x => (Number(x) || 0) + 1);
    return skip(first.over ? 'cap' : 'dup');
  }
  //  תפיסה: שתי ריצות יחד על אותו מפתח → הודעה אחת
  let pol = null, prev = null;
  const t = await sentRef.transaction(x => {
    prev = x;
    pol = lgBenPolicy({ now, key, urgent, sentLog: { [key]: x }, dayCount: n });
    if (pol.send === 'skip') return;
    const base = x && Number(x.at) ? x : { at: now, reason, agent: String(o.agent || ''), customerId: String(o.customerId || ''),
      text: text.slice(0, 400), open: o.open ? String(o.open) : null, urgent: urgent || null };
    return pol.reminder ? { ...base, reminded: true, remindedAt: now } : { ...base, night: pol.send === 'night' || null };
  });
  if (!t.committed || !pol || pol.send === 'skip') return skip('dup');
  const body = pol.reminder ? 'תזכורת: ' + text : text;

  if (pol.send === 'night') {
    await db.ref(BEN + '/night/' + key).set({ at: now, text: body.slice(0, 400), reason });
    return { sent: 'night' };
  }
  //  התקרה נספרת בטרנזקציה, לפני השליחה (תיקון סקירה M2). מלא → המפתח חוזר למה שהיה, ורק בחדר.
  //  התראה — תמיד נספרת, אף פעם לא נחסמת.
  const c = await db.ref(BEN + '/day/' + today + '/n').transaction(x => {
    const v = Number(x) || 0;
    return !urgent && v >= DAY_CAP ? undefined : v + 1;
  });
  if (!c.committed) {
    await sentRef.set(prev || null);
    await db.ref(BEN + '/day/' + today + '/over').transaction(x => (Number(x) || 0) + 1);
    return skip('cap');
  }
  if (urgent) return { sent: 'now', channel: await _urgent(db, o, { key, text: body, cfg, now }) };
  return _queue(db, o, { key, text: body, reason, cfg, env, reminder: !!pol.reminder });
}

// ─── הבוקר ───────────────────────────────────────────────────────────

async function _prune(db, now) {
  const cut = now - KEEP_MS, cutDay = _il(cut).day, upd = {};
  const sent = (await db.ref(BEN + '/sent').once('value')).val() || {};
  Object.entries(sent).forEach(([k, v]) => { if (!v || !(Number(v.at) >= cut)) upd['sent/' + k] = null; });
  const days = (await db.ref(BEN + '/day').once('value')).val() || {};
  Object.keys(days).forEach(d => { if (String(d) < cutDay) upd['day/' + d] = null; });
  if (Object.keys(upd).length) await db.ref(BEN).update(upd);
}

//  o: { env, now, cfg?, deadline?, sendPending?, provider? } → { sent }
//  השעון הראשון אחרי 06:00 — פעם ביום. הודעה אחת: מה שהצטבר בלילה + כמה נשארו אתמול רק בחדר.
async function lgBenDigestRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (env.AGENT_SHADOW_ENABLED !== 'true') return { sent: false, skipped: 'off' };
  const cfg = opt.cfg !== undefined ? opt.cfg : await lgAgentConfig(db);
  if (!cfg || lgBenIsNight(now)) return { sent: false };
  const today = _il(now).day;
  const g = await db.ref(BEN + '/digestDay').transaction(cur => (cur === today ? undefined : today));
  if (!g.committed) return { sent: false };
  try { await _prune(db, now); } catch (e) { console.warn('agent-ben: prune', e && e.name); }

  const night = (await db.ref(BEN + '/night').once('value')).val() || {};
  const items = Object.values(night).filter(x => x && x.text).sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
  const over = Number((await db.ref(BEN + '/day/' + _il(now - DAY).day + '/over').once('value')).val()) || 0;
  if (!items.length && !over) return { sent: false, empty: true };
  const lines = [];
  if (items.length) {
    lines.push('בוקר טוב. בלילה הצטברו ' + (items.length === 1 ? 'הודעה אחת' : items.length + ' הודעות') + ':');
    items.slice(0, DIGEST_LINES).forEach(x => lines.push('• ' + _oneLine(x.text, 160)));
    if (items.length > DIGEST_LINES) lines.push('ועוד ' + (items.length - DIGEST_LINES) + ' — בחדר הסוכנים');
  } else lines.push('בוקר טוב.');
  if (over) lines.push('אתמול עוד ' + over + ' הודעות נשארו רק בחדר הסוכנים (יותר מ-' + DAY_CAP + ' ביום).');
  const r = await lgBenNotify(db, { key: 'digest_' + today, text: lines.join('\n'), reason: 'agent-digest', urgent: false, env, now, cfg,
    deadline: opt.deadline, sendPending: opt.sendPending, provider: opt.provider });
  //  לא יצא (כבר 20 היום / שכבת השליחה חסמה — למשל כל הסוכנים "שקט") — הרשימה נשארת להודעה של מחר.
  //  נמחקת רק כשהשורה בתור נשלחה או עדיין ממתינה (תיקון סקירה M3).
  let ok = r.sent === 'now' && !!r.key;
  if (ok) {
    const row = (await db.ref(S.AGENT_OUTBOX + '/' + r.key).once('value')).val();
    ok = !!row && (row.state === 'sent' || row.state === 'pending');
  }
  if (ok) await db.ref(BEN + '/night').set(null);
  return { sent: ok };
}

// ─── תזכורות ─────────────────────────────────────────────────────────
//  הודעה שעדיין פתוחה אחרי 3 שעות → תזכורת אחת. "פתוחה" = השורה הצהובה עדיין ב-agentRoomOpen,
//  או בעיית שומר שלא נפתרה ולא נסגרה. לכל היותר פעם ב-10 דק'.
const _openOk = p => typeof p === 'string' && (p.startsWith(ROOM_OPEN + '/') || p.startsWith(PROBLEMS + '/'))
  && !/[.#$[\]]/.test(p) && p.split('/').length === (p.startsWith(ROOM_OPEN + '/') ? ROOM_OPEN : PROBLEMS).split('/').length + 1;

async function _remindSweep(db, o) {
  const { env, now, cfg } = o;
  const g = await db.ref(CLOCKS + '/lastSweep').transaction(cur => (cur != null && Math.abs(now - Number(cur)) < SWEEP_GAP_MS ? undefined : now));
  if (!g.committed) return 0;
  const sent = (await db.ref(BEN + '/sent').once('value')).val() || {};
  let done = 0;
  for (const [k, r] of Object.entries(sent)) {
    if (done >= SWEEP_MAX) break;
    if (o.deadline && Number(o.deadline) - Date.now() < SWEEP_MIN_LEFT_MS) break;   // תיקון סקירה M7
    if (!r || r.reminded || r.urgent || !_openOk(r.open) || now - (Number(r.at) || 0) < REMIND_MS) continue;
    const v = (await db.ref(r.open).once('value')).val();
    const open = r.open.startsWith(ROOM_OPEN + '/') ? !!v : !!v && !v.resolved && !v.dismissed;
    if (!open) { await db.ref(BEN + '/sent/' + k + '/reminded').set(true); continue; }   // נסגרה — אין תזכורת
    const n = await lgBenNotify(db, { key: k, text: r.text, reason: r.reason, agent: r.agent, customerId: r.customerId, urgent: false,
      env, now, cfg, deadline: o.deadline, sendPending: o.sendPending, provider: o.provider });
    //  לא יצא (מעבר ל-20 היום) — לא מנסים שוב כל 10 דק' (וגם לא סופרים שוב)
    if (n.sent === 'skip') await db.ref(BEN + '/sent/' + k + '/reminded').set(true);
    done++;
  }
  return done;
}

// ─── השעונים ─────────────────────────────────────────────────────────

const ALARM_TEXT = {
  alarm_office: m => 'המחשב במשרד לא עונה כבר ' + m + ' דקות — כלי החשבוניות כנראה כבוי או בלי אינטרנט. בדיקות והודעות שתלויות בו לא רצות.',
  alarm_gmail: m => 'סקריפט המייל לא פנה למערכת כבר ' + m + ' דקות — מיילים לא נקלטים ולא נשלחים.',
  alarm_wa: () => 'הוואטסאפ של המערכת מנותק — הודעות ללקוחות לא יוצאות. צריך לחבר אותו מחדש.',
};
const ALARM_BACK = {
  alarm_office: 'המחשב במשרד חזר לעבוד ✓',
  alarm_gmail: 'סקריפט המייל חזר לעבוד ✓',
  alarm_wa: 'הוואטסאפ מחובר שוב ✓',
};

//  which: 'office' | 'gmail'. o: { env, now, cfg?, deadline?, provider?, sendPending? }
//  → { skipped? , fired:[מפתחות], cleared:[מפתחות], digest, reminders }
async function lgClockCheck(db, which, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (which !== 'office' && which !== 'gmail') return { skipped: 'bad-clock' };
  if (env.AGENT_SHADOW_ENABLED !== 'true') return { skipped: 'off' };
  const cfg = opt.cfg !== undefined ? opt.cfg : await lgAgentConfig(db);
  if (!cfg) return { skipped: 'no-config' };
  const deadline = Number(opt.deadline) || Date.now() + 40 * 1000;

  await db.ref(CLOCKS + '/' + which).set({ at: now });
  const g = await db.ref(CLOCKS + '/lastCheck_' + which).transaction(cur => (cur != null && Math.abs(now - Number(cur)) < CHECK_GAP_MS ? undefined : now));
  if (!g.committed) return { skipped: 'throttled' };

  const [clocks, wa] = await Promise.all([db.ref(CLOCKS).once('value').then(s => s.val() || {}),
                                          db.ref(WA_STATE).once('value').then(s => s.val())]);
  const alarms = clocks.alarms || {};
  const seen = clocks.seen || {};          // מתי התקלה נראתה לראשונה ברצף (נמחק כשהיא לא נראית)
  const last = clocks.alarmLast || {};     // מתי התרענו בפעם האחרונה — לא נמחק ב"חזר" (צינון שעתיים)
  const other = which === 'office' ? 'gmail' : 'office';
  const otherAt = Number(clocks[other] && clocks[other].at) || 0;
  const limit = other === 'office' ? OFFICE_SILENT_MS : GMAIL_SILENT_MS;
  const silent = otherAt > 0 && now - otherAt > limit
    && (other !== 'office' || require('./_agent-watch').lgIsWorkingHours(now));
  //  holds — התקלה נראית עכשיו; back — לסגור. משרד שקט מחוץ לשעות: לא מתריעים ולא סוגרים (רק חזרה אמיתית סוגרת)
  const state = {
    ['alarm_' + which]: { holds: false, back: true },
    ['alarm_' + other]: { holds: silent, back: otherAt > 0 && now - otherAt <= limit },
    alarm_wa: { holds: WA_DOWN.includes(wa), back: wa === 'authorized' },
  };
  const minutes = otherAt ? Math.floor((now - otherAt) / MIN) : 0;
  const res = { fired: [], cleared: [], digest: false, reminders: 0, sent: null };
  //  ⚠️ בלי deadline להתראות: הזמן נבדק כאן לפני התפיסה, ו-lgBenNotify לא ידלג אחריה (תיקון סקירה M1)
  const base = { env, now, cfg, provider: opt.provider, waState: wa };
  const seenUpd = {};

  for (const [key, s] of Object.entries(state)) {
    const cur = alarms[key];
    try {
      //  רצף: נראתה עכשיו → נשמר זמן הפעם הראשונה; לא נראתה → הרצף נשבר (תיקון סקירה I1)
      if (!s.holds) { if (seen[key] != null) seenUpd[key] = null; }
      else if (seen[key] == null) seenUpd[key] = now;
      if (s.holds) {
        const confirmed = seen[key] != null && now - Number(seen[key]) >= ALARM_CONFIRM_MS;
        //  אין זמן לשליחה ישירה אחת — בפעם הבאה (לא תופסים את המפתח בלי לשלוח)
        if (!confirmed || deadline - Date.now() < URGENT_MIN_LEFT_MS) continue;
        const text = ALARM_TEXT[key](key === 'alarm_wa' ? 0 : minutes);
        if (!cur) {
          if (now - (Number(last[key]) || 0) < ALARM_COOLDOWN_MS) continue;   // צינון — גם אם "חזר" בינתיים
          const thread = key + '_' + now;
          const c = await db.ref(CLOCKS + '/alarms/' + key).transaction(x => (x ? undefined : { at: now, thread }));
          if (!c.committed) continue;
          await db.ref(CLOCKS + '/alarmLast/' + key).set(now);
          await lgRoomSay(db, { thread, from: 'manager', step: 'found', text: 'התראה: ' + text }, now);
          await lgBenNotify(db, { ...base, key: thread, text: 'התראה: ' + text, reason: 'agent-alarm', urgent: true });
          res.fired.push(key);
        } else if (!cur.reminded && now - (Number(cur.at) || 0) >= REMIND_MS) {
          let mine = false;
          await db.ref(CLOCKS + '/alarms/' + key).transaction(x => {
            mine = !!x && !x.reminded;
            return x === null ? null : mine ? { ...x, reminded: true } : undefined;
          });
          if (mine) await lgBenNotify(db, { ...base, key: String(cur.thread || key), text: 'התראה: ' + text, reason: 'agent-alarm', urgent: true });
        }
      } else if (cur && s.back) {
        let had = false;
        await db.ref(CLOCKS + '/alarms/' + key).transaction(x => { had = !!x; return null; });
        if (had) {
          await lgRoomSay(db, { thread: String(cur.thread || key), from: 'manager', step: 'done', text: ALARM_BACK[key] }, now);
          res.cleared.push(key);
        }
      }
    } catch (e) { console.warn('agent-ben: alarm', key, e && e.name); }
  }
  if (Object.keys(seenUpd).length) {
    const u = {};
    Object.entries(seenUpd).forEach(([k, v]) => { u['seen/' + k] = v; });
    await db.ref(CLOCKS).update(u);
  }

  const more = { ...base, deadline, sendPending: opt.sendPending };
  try { res.digest = (await lgBenDigestRun(db, more)).sent; }
  catch (e) { console.warn('agent-ben: digest', e && e.name); }
  try { res.reminders = await _remindSweep(db, more); }
  catch (e) { console.warn('agent-ben: remind', e && e.name); }
  //  הודעה רגילה לבן שנכנסה לתור ולא יצאה בחלון שלה — יוצאת מכאן, לכל היותר פעם בדקה (שער lastCheck).
  //  lgAgentSendPending לא מתחיל בלי מספיק זמן עד הדדליין (תיקון סקירה I2).
  try {
    res.sent = await (opt.sendPending || S.lgAgentSendPending)(db, { env, provider: opt.provider, deadline });
  } catch (e) { console.warn('agent-ben: send', e && e.name); }
  return res;
}

module.exports = { BEN, CLOCKS, DAY_CAP, REMIND_MS, lgBenIsNight, lgBenPolicy, lgBenNotify, lgBenDigestRun, lgClockCheck };
