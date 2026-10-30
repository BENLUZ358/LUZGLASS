// ═══════════════════════════════════════════════════════════════════
//  api/_agent-daily.js — מנהל: סיכום יומי ב-15:00 לבן ולשאול + רשת ביטחון לתור.
//
//  לא route (קידומת _). נקרא מ-wa-inbound.js כש-?agent=daily (rewrite
//  /api/agent-daily, ו-cron של Vercel קורא ב-GET עם Authorization: Bearer
//  <CRON_SECRET> — Vercel מוסיפה אותו לבד כשמשתנה הסביבה קיים).
//
//  עושה, לפי הסדר:
//    1. lgAgentSendPending — מה שנתקע בתור ההודעות של הסוכנים.
//    2. lgAgentShadowPending + lgAgentShadowProcess — רשומות צל שלא עובדו.
//    3. אם AGENT_SHADOW_ENABLED — סיכום 24 השעות האחרונות לכל מספר
//       ב-AGENT_SUMMARY_TO, דרך lgAgentEnqueue (צוות), ואז שליחה נוספת.
//
//  ⚠️ הנמען הוא איש צוות: שכבת השליחה מתירה אותו רק אם הוא ב-AGENT_STAFF_PHONES.
//     מספר ב-AGENT_SUMMARY_TO שאינו שם — מדולג כאן, עם סיבה בתשובה (אחרת
//     הרשומה הייתה נחסמת בשקט). הסיכום נשלח גם רק כששני המתגים דולקים
//     (SHADOW + REPLY), כדי שמפתח היום לא יישרף על רשומה חסומה.
//  ⚠️ מפתח התור לפי תאריך+מספר: ריצה שנייה באותו יום לא שולחת שוב.
//  ⚠️ מספרים מקומיים (0…) בלבד; לא נרשם ללוג ולא מוחזר טקסט הודעות לקוח.
//  שעון: 13:00 UTC = 15:00 חורף; בשעון קיץ 16:00 — במרץ לעדכן ל-'0 12 * * *'.
// ═══════════════════════════════════════════════════════════════════

const { lgHookTokenOk } = require('./_hook-token');
const { lgAgentSendPending, lgAgentEnqueue, lgAgentStaff } = require('./_agent-send');
const { lgAgentShadowPending, lgAgentShadowProcess, SHADOW } = require('./_agent-shadow');
const { lgWaSenderKey } = require('./_wa-recipient');

const QUOTES = 'waMeta/agentQuotes';
const CANCELS = 'waMeta/agentCancels';
const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_MS = 3 * 60 * 60 * 1000;     // בקשה שמחכה מעל 3 שעות
const SHADOW_LIMIT = 40;
//  R14: נמדד מול מגבלת 60ש׳ של הפונקציה, מתחילת הריצה. פריט צל (סיווג 20ש׳ + הצעה 20ש׳ + שליחה)
//  מתחיל רק אם עברו ≤10ש׳; שליחה מתחילה רק אם נשארו ≥35ש׳. הגבול — הדדליין המוחלט (תיקון סופי 1).
const FN_LIMIT_MS = 60 * 1000;
const SHADOW_MAX_ELAPSED_MS = 10 * 1000;
const SEND_MIN_LEFT_MS = 35 * 1000;
//  תיקון סופי 1: דדליין מוחלט אחד לכל עבודת הסוכן בריצה (צל → act → שליחה), 50ש׳ מההתחלה
const CHAIN_MS = 50 * 1000;

const _vals = snap => { const out = []; if (snap) snap.forEach(ch => { out.push({ key: ch.key, v: ch.val() || {} }); }); return out; };
const _list = a => a.length ? ' (' + a.join(', ') + ')' : '';

//  תאריך בשעון ישראל: { text: 'dd.mm.yyyy', iso: 'yyyy-mm-dd' }
function _jerDate(now) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { text: `${p.day}.${p.month}.${p.year}`, iso: `${p.year}-${p.month}-${p.day}` };
}

//  ספירות מהנתונים. { counts, text }
async function lgAgentDailySummary(db, now) {
  const since = now - DAY_MS;
  //  once('value') + סינון (בלי orderByChild: אין אינדקס על createdAt)
  const shadow = _vals(await db.ref(SHADOW).once('value'))
    .filter(r => (r.v.createdAt || 0) >= since && r.v.staff !== true && r.v.route !== 'staff');   // הודעות צוות לא נספרות
  //  ⚠️ הצעות וביטולים: כל הפריטים הממתינים כרגע, לא רק 24 השעות האחרונות
  const quotes = _vals(await db.ref(QUOTES).once('value'));
  const cancels = _vals(await db.ref(CANCELS).once('value'));

  const acted = shadow.filter(r => r.v.acted === true);
  const toShaul = acted.filter(r => (r.v.wouldAct || []).some(a => a && (a.type === 'staff' || a.type === 'quote-ask')));
  const toShaulKeys = new Set(toShaul.map(r => r.key));
  const waiting = quotes.filter(r => r.v.state === 'waiting');
  const stuck = quotes.filter(r => (r.v.state === 'waiting' || r.v.state === 'relaying') && r.v.at && now - r.v.at > STUCK_MS);
  const hsWait = cancels.filter(r => r.v.confirmed === true && r.v.hsSent === true && !r.v.done);
  const counts = {
    incoming: shadow.length,
    selfClosed: acted.filter(r => r.v.route !== 'shaul' && !toShaulKeys.has(r.key)).length,
    toShaul: toShaul.length,
    quotesWaiting: waiting.length,
    cancelsWaitingHs: hsWait.length,
    markedWrong: shadow.filter(r => r.v.verdict && r.v.verdict.ok === false).length,
    unlinked: shadow.filter(r => r.v.linked === false).length,
    quotesStuck: stuck.length,
  };
  const num = r => '#' + r.key;
  const orderNum = r => String((r.v.order && r.v.order.orderNum) || r.key);
  const text = [
    'סיכום סוכנים — ' + _jerDate(now).text,
    'הודעות שנכנסו: ' + counts.incoming,
    'נסגרו לבד: ' + counts.selfClosed,
    'הועברו לשאול: ' + counts.toShaul,
    'הצעות מחיר שמחכות לשאול: ' + counts.quotesWaiting + _list(waiting.map(num)),
    'ביטולים שמחכים לחשבשבת: ' + counts.cancelsWaitingHs + _list(hsWait.map(orderNum)),
    'סומנו ✗ בפאנל: ' + counts.markedWrong,
    'ממספרים לא מקושרים: ' + counts.unlinked,
    'הצעות מחיר תקועות (מעל 3 שעות): ' + counts.quotesStuck + _list(stuck.map(num)),
  ].join('\n');
  return { counts, text };
}

//  deps: { db, env, now, provider, fetchImpl, clock }.  { status, body }
//  ⚠️ תקציב אחד לכל הריצה: מדידה מתחילת הריצה מול 60ש׳ (R14); clock = Date.now, ניתן להחלפה בבדיקה.
//     הסיכום נבנה ונכנס לתור **קודם**, ואז נשלח; רק אחר כך רשת הביטחון.
async function lgAgentDailyRun(req, deps) {
  const env = deps.env || process.env;
  const headers = (req && req.headers) || {};
  if (!lgHookTokenOk(headers.authorization || headers.Authorization, env.CRON_SECRET, 'agent-daily'))
    return { status: 401, body: { error: 'unauthorized' } };
  const db = deps.db;
  const now = deps.now || Date.now();
  const clock = deps.clock || Date.now;
  const t0 = clock();
  const deadline = t0 + CHAIN_MS;
  const body = { ok: true, sent: 0, failed: 0, shadowProcessed: 0, summary: null };
  const addSend = r => { if (r) { body.sent += r.sent || 0; body.failed += r.failed || 0; } };
  //  שליחה עד הדדליין המוחלט (R14: מתחילים רק אם נשארו ≥35ש׳)
  const send = async () => {
    const left = FN_LIMIT_MS - (clock() - t0);
    if (left < SEND_MIN_LEFT_MS) return;
    try { addSend(await lgAgentSendPending(db, { env, now: deps.now, provider: deps.provider, deadline, clock })); }
    catch (e) { body.failed++; console.warn('agent-daily: send', e && e.name); }
  };

  const shadowOn = env.AGENT_SHADOW_ENABLED === 'true';
  if (shadowOn) {
    if (env.AGENT_REPLY_ENABLED !== 'true') {
      body.skipped = [{ reason: 'AGENT_REPLY_ENABLED כבוי — הסיכום לא נשלח' }];
    } else {
      try {
        const sum = await lgAgentDailySummary(db, now);
        body.summary = sum.counts;
        const staff = lgAgentStaff(env);
        const date = _jerDate(now).iso;
        const to = String(env.AGENT_SUMMARY_TO || '').split(',').map(s => lgWaSenderKey(s.trim())).filter(Boolean);
        body.skipped = [];
        for (const phone of to) {
          if (!staff.includes(phone)) { body.skipped.push({ to: phone, reason: 'לא ב-AGENT_STAFF_PHONES — לא נשלח' }); continue; }
          await lgAgentEnqueue(db, { key: 'daily-' + date + '-' + phone, to: phone, customerId: '', text: sum.text, reason: 'סיכום יומי' });
        }
      } catch (e) { body.failed++; console.warn('agent-daily: summary', e && e.name); }
    }
  }

  await send();   // כולל הסיכום שנכנס עכשיו + מה שנתקע בתור

  if (shadowOn) {
    try {
      const keys = await lgAgentShadowPending(db, SHADOW_LIMIT, now);
      for (const key of keys) {
        if (clock() - t0 > SHADOW_MAX_ELAPSED_MS) break;
        try {
          const p = await lgAgentShadowProcess(db, key, { now, env, fetchImpl: deps.fetchImpl, provider: deps.provider, deadline, clock });
          if (p.ok) body.shadowProcessed++; else body.failed++;
        } catch (e) { body.failed++; }
      }
    } catch (e) { body.failed++; console.warn('agent-daily: shadow', e && e.name); }
    if (body.shadowProcessed) await send();   // תשובות שהעיבוד הכניס לתור
  }
  return { status: 200, body };
}

//  ה-handler של Vercel (נקרא מ-wa-inbound.js)
async function handler(req, res) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) { res.status(500).json({ error: 'server not configured' }); return; }
    const { _db } = require('./wa-inbound');
    const r = await lgAgentDailyRun(req, { db: _db() });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('agent-daily: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
}

module.exports = handler;
module.exports.lgAgentDailyRun = lgAgentDailyRun;
module.exports.lgAgentDailySummary = lgAgentDailySummary;
