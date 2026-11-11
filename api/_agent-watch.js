'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-watch.js — הבדיקות שהדופק מכלי החשבוניות מריץ (חדר הסוכנים, שלב ב׳, 10/11).
//
//  עוזר משותף, לא route. אין cron תכוף (Hobby) — "השעון" הוא כלי החשבוניות
//  במחשב במשרד: כל דקה הוא שולח דופק ל-/api/invoice-pdf-upload ({op:'heartbeat'}),
//  השרת שומר waMeta/invoiceWatcher/<pc> ומריץ את lgAgentWatchRun (לכל היותר פעם בדקה).
//  אפיון: docs/superpowers/specs/2026-11-10-agents-room-design.md
//    ("הארכיון — אחראי חשבוניות", "תשובות בן לשאלות הבודק" #1, "מי אחראי על מה").
//
//  כל דקה (מהדופק עצמו): קובץ מחכה בתיקיית ההדפסות > 10 דק' → אפור; > 30 → צהוב.
//    שגיאת הדפסה בדופק → צהוב (נשאר עד ההדפסה המוצלחת הבאה — הכלי מנקה אותה רק אז).
//  פעם ב-10 דק' (מפתח lastRunSlow נפרד — עלות קריאה, סקירה 10/11):
//    • הדפסה ('printed') שלא נרשמה בתחנה > שעה, ללקוח שבמערכת — known שנשמר
//      ברשומה בהעלאה (_invoice-upload.js); לא קוראים את users. שאילתה: state==='printed'.
//    • שליחה ללקוח נכשלה (invoicePdf/<key>/delivery failed), רק חשבוניות מ-48 השעות האחרונות.
//      ⚠️ פעולה אוטומטית מול לקוח — רק כשהארכיון "עונה" (החלטת בן): ניסיון חוזר אחד
//      (lgInvoiceDeliver הקיים), רק לכשל מהשעתיים האחרונות, אף פעם לא לרשומת תור שפג
//      תוקפה, ואף פעם לא פעמיים לאותה חשבונית (retried נשמר 14 יום). אחרת — צהוב.
//      סדר: retried + רשומת הבעיה נכתבים **לפני** השליחה; ניסיון אחד לכל ריצה; ריצה
//      שנהרגה לא חוזרת על הניסיון. הריצה עוצרת אחרי ~40ש׳ (deadline).
//    • קולט: המייל של משלוח נכשל / פג → צהוב; משלוח פתוח > 30 שעות → אפור.
//      waMeta/drafterBatches נקרא כולו: אין אינדקס על doneAt (waMeta בלי indexOn, ובן
//      מעדיף בלי שינוי חוקים) — הצומת קטן.
//
//  כפילויות: waMeta/agentWatch/problems/<מפתח בעיה> = { level, agent, at, text, src, roomKey, asked, dismissed? }
//    בעיה חדשה / שעלתה מאפור לצהוב → שורה בחדר. אותה רמה → כלום. dismissed ("סגור" של בן) → לא עולה שוב.
//    בעיה שנעלמה → בודקים את המקור לפי המפתח (לא לפי השאילתה — ייתכן שרק יצאה מהחלון):
//    באמת תוקנה → הצהוב נסגר לבד (lgRoomClose) ושורת "תוקן"; שליחה — רק כשהיא 'sent'.
//    בעיה של סוכן כבוי / מחשב שלא ענה — לא נפתחת ולא "מתוקנת". מחשב שלא ענה 7 ימים —
//    נמחק מ-invoiceWatcher יחד עם הבעיות שלו.
//
//  עוקב (שיפורים 2+3, 11/11) — בריצה האיטית, רק כשיש הגדרות במסך והעוקב לא כבוי, ולכל היותר
//    פעם בשעה (שומר עלות — lastOrdersScan; בלי agentConfig אין סריקה בכלל): קורא את orders, מחשב כמה זמן
//    לוקח כל שלב (_agent-stats.js, לכל היותר פעם ביום — computedAt) → waMeta/agentStats/stageDays (לתשובת "מתי יהיה מוכן"),
//    והזמנה של לקוח במערכת שתקועה בשלב > פי 2 מהרגיל (ו>יומיים) → info פעם אחת (stuck_<id>_<שלב>).
//    יצאה מהשלב → הבעיה יורדת בשקט (בלי "תוקן").
//  קולט (בן, 11/11) — באותה סריקה (כשהקולט לא כבוי): הזמנה שהגיעה ל-opty ב-24 השעות האחרונות
//    בלי drafterBatch → info פעם אחת (opty_<id>), "הגיעה לבנה יום עבודה בלי משלוח לשרטט".
//
//  מתגים (lgAgentMode): כבוי → כלום. שקט/עונה → לחדר. התראה לבן — רק "עונה".
//  בלי waMeta/agentConfig בכלל (פרודקשן היום) → הכל לחדר כאפור, אף פעם לא לבן ולא ניסיון חוזר.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { LG_AGENT_KEYS, lgAgentConfig, lgAgentModeOf, lgAgentEscalatePhone } = require('./_agent-config');
const { lgRoomPost, lgRoomClose, lgRoomAskBenText, ROOM } = require('./_agent-room');

const WATCHERS = 'waMeta/invoiceWatcher';
const WATCH = 'waMeta/agentWatch';
const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const RUN_GAP_MS = 55 * 1000;              // "לכל היותר פעם בדקה" (דופק כל 60ש׳ + רעש)
const SLOW_GAP_MS = 10 * MIN;              // בדיקות החשבוניות / הקולט — לכל היותר פעם ב-10 דק'
const RUN_BUDGET_MS = 40 * 1000;           // הריצה עוצרת אחרי ~40ש׳
const FRESH_MS = 10 * MIN;                 // דופק ישן מזה — הדיווח שלו לא נבדק
const PC_STALE_MS = 7 * DAY;               // מחשב בלי דופק שבוע — נמחק
const FILE_INFO_MS = 10 * MIN, FILE_ASK_MS = 30 * MIN;
const PRINTED_MS = H;
const BATCH_LONG_MS = 30 * H;
const FAILED_LOOKBACK_MS = 48 * H;         // שליחות שנכשלו — רק חשבוניות מ-48 השעות האחרונות
const RETRY_WINDOW_MS = 2 * H;             // ניסיון חוזר — רק לכשל מהשעתיים האחרונות
const RETRIED_KEEP_MS = 14 * DAY;
const MAIL_FAILED = ['failed', 'expired', 'cancelled'];   // כמו _drafter-batch.js
const WHO = { archive: 'כלי החשבוניות', kolet: 'משלוחים לשרטט' };
const INTERNAL_NOTE = 'פנימי — ייסגר לבד כשיתוקן';
const RANK = { info: 1, ask: 2 };
const SLOW_KEY = /^(printed|deliv|mail|long|stuck|opty)_/;
const SCAN_ROOM_MAX = 5;                         // שורות חדשות בחדר לכל סריקת orders (השאר — סיכום)
const SCAN_KEY = /^(stuck|opty)_/;              // נבדק רק בסריקת orders (פעם בשעה)
const ORDERS_SCAN_GAP_MS = H;              // שומר עלות: orders נקרא לכל היותר פעם בשעה
const STATS_GAP_MS = DAY;                  // הזמן הרגיל לכל שלב — לכל היותר פעם ביום

const _safeKey = s => String(s == null ? '' : s).replace(/[.#$[\]/\s]/g, '_').slice(0, 60);
const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && !/[.#$[\]/]/.test(k);
const _s = (v, n) => String(v == null ? '' : v).slice(0, n);
const _sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const _retriedAt = v => (v && typeof v === 'object' ? Number(v.at) || 0 : Number(v) || 0);

// ─── טהור ─────────────────────────────────────────────────────────────

//  שעות עבודה: ראשון–חמישי 07:00–18:00 בישראל
function lgIsWorkingHours(now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  const h = Number(p.hour);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(p.weekday) && h >= 7 && h < 18;
}

//  גוף הדופק מהכלי → רשומה נקייה { pc, pending:[{name, ageSec}], lastPrintError, version } או null
function lgWatchHeartbeatClean(body) {
  const b = body || {};
  const pc = _safeKey(b.pc);
  if (!pc) return null;
  const pending = (Array.isArray(b.pending) ? b.pending : [])
    .filter(x => x && typeof x.name === 'string' && x.name && Number.isFinite(Number(x.ageSec)))
    .slice(0, 50).map(x => ({ name: _s(x.name, 200), ageSec: Math.max(0, Math.floor(Number(x.ageSec))) }));
  const e = b.lastPrintError;
  const lastPrintError = e && typeof e === 'object' && e.message
    ? { at: Number(e.at) || 0, message: _s(e.message, 300), file: _s(e.file, 200) } : null;
  return { pc, pending, lastPrintError, version: _s(b.version, 40) };
}

//  הבעיות עכשיו. in: { now, watchers, invoices?, retried?, reply?, noRetry?, batches?, mail? }
//    invoices — רשומות invoicePdf (printed עם known; ready עם delivery). reply — הארכיון "עונה"
//    (ויש הגדרות). noRetry — { key: true } לרשומת תור שפג תוקפה.
//  → [{ key, agent, level:'info'|'ask', text, src?, retry? }]
function lgWatchProblems(input) {
  const x = input || {}, now = Number(x.now) || 0, out = [];
  for (const [pc, w] of Object.entries(x.watchers || {})) {
    if (!w || now - (Number(w.at) || 0) > FRESH_MS) continue;   // מחשב שלא ענה — לא נבדק
    for (const f of Array.isArray(w.pending) ? w.pending : []) {
      const ms = (Number(f && f.ageSec) || 0) * 1000;
      if (ms <= FILE_INFO_MS) continue;
      const m = Math.floor(ms / MIN);
      out.push({ key: 'file_' + _safeKey(pc) + '_' + _sha(f.name), agent: 'archive', level: ms > FILE_ASK_MS ? 'ask' : 'info',
                 text: `הקובץ "${_s(f.name, 120)}" מחכה בתיקיית ההדפסות במשרד כבר ${m} דקות`
                       + (ms > FILE_ASK_MS ? ' — כדאי לבדוק את כלי החשבוניות' : '') });
    }
    if (w.lastPrintError && w.lastPrintError.message) {
      out.push({ key: 'print_' + _safeKey(pc), agent: 'archive', level: 'ask',
                 text: 'שגיאת הדפסה בכלי החשבוניות במשרד: ' + _s(w.lastPrintError.message, 200)
                       + (w.lastPrintError.file ? ' (' + _s(w.lastPrintError.file, 80) + ')' : '')
                       + ' — נשאר פתוח עד ההדפסה המוצלחת הבאה' });
    }
  }
  const retried = x.retried || {}, noRetry = x.noRetry || {};
  for (const [k, r] of Object.entries(x.invoices || {})) {
    if (!r) continue;
    const doc = String(r.docNumber || k);
    if (r.state === 'printed' && now - (Number(r.createdAt) || now) > PRINTED_MS && r.known === true) {
      out.push({ key: 'printed_' + _safeKey(k), src: k, agent: 'archive', level: 'ask',
                 text: `חשבונית ${doc} הודפסה לפני יותר משעה ועדיין לא נרשמה בתחנת החשבוניות` });
    }
    const dv = r.delivery;
    if (r.state === 'ready' && !r.simulated && dv && dv.state === 'failed') {
      const why = dv.reason ? ' (' + _s(dv.reason, 120) + ')' : '';
      const to = r.client ? ' ל' + _s(r.client, 60) : '';
      const key = 'deliv_' + _safeKey(k);
      const canRetry = x.reply === true && !noRetry[k] && now - (Number(dv.at) || 0) <= RETRY_WINDOW_MS;
      out.push(retried[k]
        ? { key, src: k, agent: 'archive', level: 'ask', text: `שליחת חשבונית ${doc}${to} נכשלה גם אחרי ניסיון חוזר${why}` }
        : canRetry
          ? { key, src: k, agent: 'archive', level: 'info', retry: k, text: `שליחת חשבונית ${doc}${to} נכשלה${why} — מנסה שוב פעם אחת` }
          : { key, src: k, agent: 'archive', level: 'ask', text: `שליחת חשבונית ${doc}${to} נכשלה${why}` });
    }
  }
  for (const [k, b] of Object.entries(x.batches || {})) {
    if (k[0] === '_' || !b || !b.n || b.doneAt) continue;
    const mail = b.emailKey && x.mail ? x.mail[b.emailKey] : '';
    if (b.emailError || MAIL_FAILED.includes(mail)) {
      out.push({ key: 'mail_' + b.n, src: k, agent: 'kolet', level: 'ask', text: `המייל למשלוח ${b.n} לשרטט נכשל — לחץ שלח שוב` });
    }
    if (now - (Number(b.at) || now) > BATCH_LONG_MS) {
      out.push({ key: 'long_' + b.n, src: k, agent: 'kolet', level: 'info', text: `משלוח ${b.n} אצל השרטט כבר יותר מיום` });
    }
  }
  return out;
}

//  קולט (בן, 11/11): הזמנה שהגיעה ל-opty ("בנה יום עבודה") ב-24 השעות האחרונות (optyAt) בלי
//  שהייתה בשום משלוח לשרטט (אין drafterBatch) → info אחד להזמנה. יוצאת מהחלון → יורדת בשקט.
const OPTY_NOBATCH_MS = DAY;
function lgOptyWithoutBatch(orders, now) {
  const out = [];
  for (const [id, o] of Object.entries(orders || {})) {
    if (!o || typeof o !== 'object' || o.isTest === true || o.isSample === true || o.agentCancelled) continue;
    const t = Number(o.optyAt) || 0;
    if (!t || t > now || now - t > OPTY_NOBATCH_MS || o.drafterBatch != null) continue;
    const who = String(o.orderClient || o.client || '').trim();
    out.push({ key: 'opty_' + _safeKey(id), src: String(id), agent: 'kolet', level: 'info',
               text: 'הזמנה ' + _s(o.orderNum || id, 40) + (who ? ' · ' + _s(who, 60) : '') + ' הגיעה לבנה יום עבודה בלי משלוח לשרטט' });
  }
  return out;
}

//  prev = { key: {level, dismissed?} }, problems = [{key, level}] → { open:[key], clear:[key] }
//  dismissed ("סגור" של בן) — לא נפתח שוב כל עוד הבעיה קיימת
function lgWatchDiff(prev, problems) {
  const p = prev || {}, now = new Set();
  const open = [];
  for (const x of problems || []) {
    now.add(x.key);
    if (p[x.key] && p[x.key].dismissed) continue;
    if (!p[x.key] || (RANK[x.level] || 0) > (RANK[p[x.key].level] || 0)) open.push(x.key);
  }
  return { open, clear: Object.keys(p).filter(k => !now.has(k)) };
}

//  שורה לסיכום היומי: אין דופק 30 דק' בשעות עבודה. '' כשהכל בסדר / מחוץ לשעות.
function lgWatcherSilentLine(watchers, now) {
  if (!lgIsWorkingHours(now)) return '';
  const last = Math.max(0, ...Object.values(watchers || {}).map(w => Number(w && w.at) || 0));
  if (!last) return 'כלי החשבוניות במשרד עוד לא שלח דופק';
  const m = Math.floor((now - last) / MIN);
  return m > 30 ? `כלי החשבוניות במשרד לא ענה ${m} דקות` : '';
}

// ─── אירוע לחדר לפי המתג ────────────────────────────────────────────
//  ev: { kind:'info'|'ask', text, ref? }. o: { env, now, cfg? (undefined → נקרא), sendPending?, deadline? }
//  → { roomKey, asked, pinged } או null (כבוי / לא נכתב)
async function lgAgentEvent(db, agent, ev, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (env.AGENT_SHADOW_ENABLED !== 'true') return null;
  const cfg = opt.cfg !== undefined ? opt.cfg : await lgAgentConfig(db);
  const mode = lgAgentModeOf(cfg, agent, env);
  if (mode === 'off') return null;
  const text = _s(ev && ev.text, 500);
  //  בלי הגדרות במסך (פרודקשן היום) — הכל אפור, לא צהוב ולא לבן
  const ask = !!cfg && ev && ev.kind === 'ask';
  const roomKey = await lgRoomPost(db, ask
    ? { agent, kind: 'ask', state: 'open', text, question: text, customerName: WHO[agent] || 'סוכן', note: INTERNAL_NOTE, internal: true, ref: ev.ref }
    : { agent, kind: 'info', text, ref: ev && ev.ref }, now);
  if (!roomKey) return null;
  let pinged = false;
  if (ask && mode === 'reply') {
    try {
      const S = require('./_agent-send');
      const q = await S.lgAgentEnqueue(db, { key: 'watch_' + roomKey, to: lgAgentEscalatePhone(cfg), customerId: '',
        text: lgRoomAskBenText(WHO[agent] || 'סוכן', text, env), reason: S.AGENT_ASK_REASON, agent });
      pinged = !!q.queued;
      //  ⚠️ לא אחרי הדדליין של הריצה (הדופק חייב להיגמר < 60ש׳)
      if (pinged) await (opt.sendPending || S.lgAgentSendPending)(db, { env, deadline: Math.min(Date.now() + 20 * 1000, Number(opt.deadline) || Infinity) });
    } catch (e) { console.warn('agent-watch: ping', e && e.name); }
  }
  return { roomKey, asked: ask, pinged };
}

// ─── בעיה שנעלמה: מה קרה באמת (תיקון סקירה I3) ───────────────────────
//  לפי המפתח, לא לפי השאילתה — ייתכן שהרשומה רק יצאה מהחלון.
//  → { act:'keep' } | { act:'fixed', text? } | { act:'drop' } (המקור נמחק — בלי "תוקן")
async function _gone(db, k, p) {
  const src = String((p && p.src) || k.replace(/^[a-z]+_/, ''));
  if (!_keyOk(src)) return { act: 'drop' };
  if (k.startsWith('printed_')) {
    const r = (await db.ref('invoicePdf/' + src).once('value')).val();
    return r && r.state === 'printed' ? { act: 'keep' } : { act: 'fixed' };
  }
  if (k.startsWith('deliv_')) {
    const r = (await db.ref('invoicePdf/' + src).once('value')).val();
    if (!r) return { act: 'drop' };
    //  'queued' עוד לא אומר שהלקוח קיבל — רק 'sent' (סקירה I1)
    return r.delivery && r.delivery.state === 'sent' ? { act: 'fixed' } : { act: 'keep' };
  }
  //  הזמנה תקועה שזזה / נמחקה — בלי "תוקן" (זה דיווח, לא תקלה שמישהו תיקן)
  if (k.startsWith('stuck_') || k.startsWith('opty_')) return { act: 'drop' };
  if (k.startsWith('mail_') || k.startsWith('long_')) {
    const b = (await db.ref('waMeta/drafterBatches/' + src).once('value')).val();
    if (!b) return { act: 'drop' };
    return k.startsWith('long_') && b.doneAt ? { act: 'fixed', text: `משלוח ${b.n || src} הסתיים` } : { act: 'fixed' };
  }
  return { act: 'fixed' };
}

// ─── ההרצה מהדופק ───────────────────────────────────────────────────
//  o: { env, now, deadline?, deliver?(db, key, {now}), sendPending? } → { ok, skipped?, opened, cleared }
async function lgAgentWatchRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  const deadline = Number(opt.deadline) || Date.now() + RUN_BUDGET_MS;
  const late = () => Date.now() > deadline;
  if (env.AGENT_SHADOW_ENABLED !== 'true') return { ok: true, skipped: 'off', opened: 0, cleared: 0 };
  //  שחרור "הכל כבוי" (11/11): בלי waMeta/agentConfig — הבדיקות לא רצות בכלל (לא חדר, לא ניסיון חוזר).
  //  הדופק עצמו נשמר (_invoice-upload) — זה מה ששורת המצב של הכלי במשרד קוראת.
  const cfg = await lgAgentConfig(db);
  if (!cfg) return { ok: true, skipped: 'no-config', opened: 0, cleared: 0 };
  //  פעם בדקה לכל היותר (גם כמה מחשבים / דופק כפול). null-first: הקריאה הראשונה מחזירה ערך
  const gate = (path, gap) => db.ref(WATCH + '/' + path).transaction(cur => (cur != null && Math.abs(now - Number(cur)) < gap ? undefined : now));
  if (!(await gate('lastRun', RUN_GAP_MS)).committed) return { ok: true, skipped: 'throttled', opened: 0, cleared: 0 };
  //  בדיקות החשבוניות והקולט — פעם ב-10 דק' (מפתח נפרד)
  const slow = (await gate('lastRunSlow', SLOW_GAP_MS)).committed;

  const modeOf = a => lgAgentModeOf(cfg, a, env);
  const on = a => modeOf(a) !== 'off';
  //  פעולה אוטומטית מול לקוח — רק "עונה" שנבחר במסך (בלי הגדרות — אף פעם)
  const reply = !!cfg && modeOf('archive') === 'reply';
  const state = (await db.ref(WATCH).once('value')).val() || {};
  const prev = { ...(state.problems || {}) };
  const retried = { ...(state.retried || {}) };
  const setProblem = (k, v) => db.ref(WATCH + '/problems/' + k).set(v);
  let opened = 0, cleared = 0;

  //  מחשב שלא שלח דופק שבוע — נמחק, יחד עם הבעיות שלו (הצהוב נסגר, בלי "תוקן")
  const watchers = { ...((await db.ref(WATCHERS).once('value')).val() || {}) };
  for (const [pc, w] of Object.entries(watchers)) {
    if (now - (Number(w && w.at) || 0) <= PC_STALE_MS) continue;
    for (const [k, p] of Object.entries(prev)) {
      if (k !== 'print_' + pc && !k.startsWith('file_' + pc + '_')) continue;
      if (p && p.roomKey && p.asked && !p.dismissed) await lgRoomClose(db, p.roomKey, now, { by: 'stale' });
      await setProblem(k, null);
      delete prev[k];
    }
    await db.ref(WATCHERS + '/' + pc).set(null);
    delete watchers[pc];
  }

  let invoices = {}, batches = {};
  const mail = {}, noRetry = {};
  if (slow) {
    //  retried — נשמר 14 יום לכל חשבונית, ואז נשכח
    for (const [k, v] of Object.entries(retried)) {
      if (now - _retriedAt(v) > RETRIED_KEEP_MS) { await db.ref(WATCH + '/retried/' + k).set(null); delete retried[k]; }
    }
  }
  if (slow && on('archive')) {
    const printed = (await db.ref('invoicePdf').orderByChild('state').equalTo('printed').once('value')).val() || {};
    const recent = (await db.ref('invoicePdf').orderByChild('createdAt').startAt(now - FAILED_LOOKBACK_MS).once('value')).val() || {};
    invoices = { ...recent, ...printed };
    //  רשומת תור שפג תוקפה — לא מאפסים ולא שולחים שוב (lgInvoiceDeliver היה מאפס אותה)
    if (reply) {
      for (const [k, r] of Object.entries(recent)) {
        const dv = r && r.delivery;
        if (!dv || r.state !== 'ready' || dv.state !== 'failed' || retried[k] || !dv.outboxKey) continue;
        if (now - (Number(dv.at) || 0) > RETRY_WINDOW_MS) continue;
        if (!_keyOk(String(dv.outboxKey))) { noRetry[k] = true; continue; }
        const st = (await db.ref((dv.channel === 'email' ? 'waMeta/emailOutbox/' : 'waOutbox/') + dv.outboxKey + '/state').once('value')).val();
        if (st === 'expired') noRetry[k] = true;
      }
    }
  }
  if (slow && on('kolet')) {
    //  כל הצומת: אין אינדקס על doneAt ב-waMeta (בלי שינוי חוקים) — והוא קטן
    batches = (await db.ref('waMeta/drafterBatches').once('value')).val() || {};
    for (const [k, b] of Object.entries(batches)) {
      if (k[0] === '_' || !b || b.doneAt || !b.emailKey) continue;
      mail[b.emailKey] = String((await db.ref('waMeta/emailOutbox/' + b.emailKey + '/state').once('value')).val() || '');
    }
  }

  //  ⚠️ שומר עלות (11/11): orders נקרא רק כשיש הגדרות במסך, והעוקב לא כבוי — לכל היותר
  //  פעם בשעה (מפתח lastOrdersScan); הזמן הרגיל לכל שלב מחושב מחדש לכל היותר פעם ביום (computedAt).
  //  בלי waMeta/agentConfig (פרודקשן היום) — אף פעם לא קוראים את orders.
  let stuck = [], scanned = false;
  if (slow && cfg && (on('okev') || on('kolet'))) {
    if ((await gate('lastOrdersScan', ORDERS_SCAN_GAP_MS)).committed) {
      try {
        const orders = (await db.ref('orders').once('value')).val() || {};
        if (on('okev')) {
          const ST = require('./_agent-stats');
          let stats = (await db.ref(ST.AGENT_STATS).once('value')).val();
          if (!stats || !(now - (Number(stats.computedAt) || 0) < STATS_GAP_MS) || Number(stats.computedAt) > now) {
            stats = { ...ST.lgStageStats(orders, now), computedAt: now };
            await db.ref(ST.AGENT_STATS).set(stats);
          }
          stuck = ST.lgStuckOrders(orders, stats, now);
        }
        //  קולט: הגיעה לבנה יום עבודה בלי משלוח לשרטט (אותה קריאה של orders)
        if (on('kolet')) stuck = stuck.concat(lgOptyWithoutBatch(orders, now));
        scanned = true;   // רק סריקה שהצליחה "מנקה" בעיות ישנות
      } catch (e) { console.warn('agent-watch: orders scan', e && e.name); }
    }
  }
  const all = lgWatchProblems({ now, watchers, invoices, retried, reply, noRetry, batches, mail }).concat(stuck).filter(p => on(p.agent));
  const byKey = {};
  all.forEach(p => { byKey[p.key] = p; });
  //  לא "מתוקן": בעיה של סוכן כבוי, או של מחשב שלא שלח דופק עדכני, או בדיקה איטית שלא רצה עכשיו
  const freshPc = pc => { const w = watchers[pc]; return !!w && now - (Number(w.at) || 0) <= FRESH_MS; };
  const keep = (k, p) => !p || !on(p.agent) || (!slow && SLOW_KEY.test(k)) || (!scanned && SCAN_KEY.test(k)) || ((k.startsWith('file_') || k.startsWith('print_'))
    && !Object.keys(watchers).some(pc => freshPc(pc) && (k === 'print_' + _safeKey(pc) || k.startsWith('file_' + _safeKey(pc) + '_'))));
  const diff = lgWatchDiff(prev, all);

  let retriedNow = false;
  //  סקירת שחרור 11/11: סריקת orders ראשונה יכולה למצוא עשרות הזמנות — עד SCAN_ROOM_MAX שורות חדשות
  //  בסריקה, השאר נרשמות (כדי שלא יעלו שוב) ושורת סיכום אחת לכל סוכן "ועוד N הזמנות"
  let scanPosted = 0;
  const scanExtra = {};
  for (const k of diff.open) {
    if (late()) break;
    const p = byKey[k];
    const rec = { level: p.level, agent: p.agent, at: now, text: _s(p.text, 300), src: p.src || null, roomKey: null, asked: false };
    if (SCAN_KEY.test(k)) {
      if (scanPosted >= SCAN_ROOM_MAX) {
        scanExtra[p.agent] = (scanExtra[p.agent] || 0) + 1;
        await setProblem(k, rec);
        opened++;
        continue;
      }
      scanPosted++;
    }
    if (p.retry) {
      //  ניסיון אחד לכל ריצה; השאר — בריצה הבאה
      if (retriedNow) continue;
      retriedNow = true;
      //  נרשם לפני השליחה: ריצה שנהרגה באמצע לא תנסה שוב
      await db.ref(WATCH + '/retried/' + p.retry).set({ at: now });
      await setProblem(k, rec);
      try { await (opt.deliver || require('./_invoice-deliver').lgInvoiceDeliver)(db, p.retry, { now }); }
      catch (e) { console.warn('agent-watch: deliver retry', e && e.name); }
    }
    const r = await lgAgentEvent(db, p.agent, { kind: p.level, text: p.text }, { env, now, cfg, sendPending: opt.sendPending, deadline });
    //  נכתב או לא — נרשם, כדי לא לנסות בכל דקה (החדר הוא תיעוד, לא העבודה)
    await setProblem(k, { ...rec, roomKey: r ? r.roomKey : null, asked: !!(r && r.asked) });
    opened++;
  }
  for (const [agent, n] of Object.entries(scanExtra)) {
    const what = agent === 'kolet' ? 'שהגיעו לבנה יום עבודה בלי משלוח לשרטט' : 'תקועות יותר מהרגיל';
    await lgAgentEvent(db, agent, { kind: 'info', text: `ועוד ${n} הזמנות ${what}` }, { env, now, cfg });
  }
  for (const k of diff.clear) {
    if (late()) break;
    const p = prev[k];
    if (keep(k, p)) continue;
    const g = SLOW_KEY.test(k) ? await _gone(db, k, p) : { act: 'fixed' };
    if (g.act === 'keep') continue;
    if (p.roomKey && p.asked && !p.dismissed) await lgRoomClose(db, p.roomKey, now);
    if (g.act === 'fixed' && p.roomKey && !p.dismissed) {
      await lgAgentEvent(db, p.agent, { kind: 'info', text: 'תוקן: ' + _s(g.text || p.text, 200) }, { env, now, cfg });
    }
    await setProblem(k, null);
    cleared++;
  }
  //  מנהל (פריט 8, 11/11): סיכום בוקר בחדר — פעם ביום, בדופק הראשון אחרי 07:00 (א'–ו').
  //  רק עם הגדרות במסך והמנהל לא כבוי (_agent-morning.js). תקלה לא נוגעת בבדיקות.
  if (!late()) {
    try { await require('./_agent-morning').lgAgentMorningRun(db, { env, now, cfg }); }
    catch (e) { console.warn('agent-watch: morning', e && e.name); }
  }
  return { ok: true, opened, cleared };
}

// ─── "סגור" של בן על שאלה פנימית צהובה (סקירה I4) ─────────────────────
//  agent-room-close (wa-inbound-drain, מאחורי verifyAdmin). נסגרת עם answeredBy 'ben',
//  והבעיה מסומנת dismissed — לא תעלה שוב לאותו מפתח עד שתיעלם.
async function lgWatchDismiss(db, key, deps) {
  const d = deps || {}, now = Number(d.now) || Date.now();
  if (!_keyOk(key)) return { ok: false, code: 'bad-key', message: 'מזהה הודעה לא תקין' };
  const cur = (await db.ref(ROOM + '/' + key).once('value')).val();
  if (!cur) return { ok: false, code: 'missing', message: 'ההודעה לא נמצאה' };
  if (cur.kind !== 'ask' || cur.internal !== true) return { ok: false, code: 'not-internal', message: 'רק שאלה פנימית נסגרת כאן' };
  await lgRoomClose(db, key, now, { by: 'ben' });
  const probs = (await db.ref(WATCH + '/problems').once('value')).val() || {};
  for (const [k, p] of Object.entries(probs)) {
    if (p && p.roomKey === key) {
      await db.ref(WATCH + '/problems/' + k).update({ dismissed: true, dismissedAt: now, dismissedBy: _s(d.by, 60) });
    }
  }
  return { ok: true, code: '' };
}

module.exports = { WATCHERS, WATCH, LG_AGENT_KEYS, lgOptyWithoutBatch, lgIsWorkingHours, lgWatchHeartbeatClean, lgWatchProblems, lgWatchDiff,
                   lgWatcherSilentLine, lgAgentEvent, lgAgentWatchRun, lgWatchDismiss };
