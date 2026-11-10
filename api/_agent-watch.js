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
//  ארכיון (רק חשבוניות שבמערכת):
//    • קובץ מחכה בתיקיית ההדפסות > 10 דק' → אפור; > 30 דק' → צהוב.
//    • שגיאת הדפסה בדופק → צהוב.
//    • הדפסה ('printed') שלא נרשמה בתחנה > שעה, ללקוח שיש לו משתמש → צהוב.
//    • שליחה ללקוח נכשלה (invoicePdf/<key>/delivery failed) → ניסיון חוזר אחד
//      (lgInvoiceDeliver הקיים) + אפור; עדיין נכשלת בסבב הבא → צהוב.
//  קולט (משלוחים לשרטט):
//    • המייל של משלוח נכשל / פג → צהוב פעם אחת. • משלוח פתוח > 30 שעות → אפור פעם אחת.
//
//  כפילויות: waMeta/agentWatch/problems/<מפתח בעיה> = { level, agent, at, text, roomKey, asked }.
//    בעיה חדשה / שעלתה מאפור לצהוב → שורה בחדר. אותה רמה → כלום.
//    בעיה שנעלמה → הצהוב נסגר לבד (lgRoomClose) ושורת "תוקן", והרשומה נמחקת.
//    בעיה של סוכן כבוי / מחשב שלא ענה — לא נפתחת ולא "מתוקנת".
//
//  מתגים (lgAgentMode): כבוי → כלום. שקט/עונה → לחדר. התראה לבן — רק "עונה".
//  בלי waMeta/agentConfig בכלל (פרודקשן היום) → הכל לחדר כאפור, אף פעם לא לבן.
//  ⚠️ פנימי בלבד: שום דבר מכאן לא יוצא ללקוח (חוץ מהניסיון החוזר של החשבונית —
//     אותה פונקציה שהדפסה חוזרת מחשבשבת מפעילה).
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { LG_AGENT_KEYS, lgAgentConfig, lgAgentModeOf, lgAgentEscalatePhone } = require('./_agent-config');
const { lgRoomPost, lgRoomClose, lgRoomAskBenText } = require('./_agent-room');

const WATCHERS = 'waMeta/invoiceWatcher';
const WATCH = 'waMeta/agentWatch';
const MIN = 60 * 1000, H = 60 * MIN;
const RUN_GAP_MS = 55 * 1000;              // "לכל היותר פעם בדקה" (דופק כל 60ש׳ + רעש)
const FRESH_MS = 10 * MIN;                 // דופק ישן מזה — הדיווח שלו לא נבדק
const FILE_INFO_MS = 10 * MIN, FILE_ASK_MS = 30 * MIN;
const PRINTED_MS = H;
const BATCH_LONG_MS = 30 * H;
const INVOICE_LOOKBACK_MS = 14 * 24 * H;
const MAIL_FAILED = ['failed', 'expired', 'cancelled'];   // כמו _drafter-batch.js
const WHO = { archive: 'כלי החשבוניות', kolet: 'משלוחים לשרטט' };
const INTERNAL_NOTE = 'פנימי — ייסגר לבד כשיתוקן';
const RANK = { info: 1, ask: 2 };

const _safeKey = s => String(s == null ? '' : s).replace(/[.#$[\]/\s]/g, '_').slice(0, 60);
const _s = (v, n) => String(v == null ? '' : v).slice(0, n);
const _sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

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

//  הבעיות עכשיו. in: { now, watchers, invoices?, knownAccount?(rec)→bool, retried?, batches?, mail? }
//  → [{ key, agent, level:'info'|'ask', text, retry? }]
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
                       + (w.lastPrintError.file ? ' (' + _s(w.lastPrintError.file, 80) + ')' : '') });
    }
  }
  const retried = x.retried || {};
  for (const [k, r] of Object.entries(x.invoices || {})) {
    if (!r) continue;
    const doc = String(r.docNumber || k);
    if (r.state === 'printed' && now - (Number(r.createdAt) || now) > PRINTED_MS && x.knownAccount && x.knownAccount(r)) {
      out.push({ key: 'printed_' + _safeKey(k), agent: 'archive', level: 'ask',
                 text: `חשבונית ${doc} הודפסה לפני יותר משעה ועדיין לא נרשמה בתחנת החשבוניות` });
    }
    if (r.state === 'ready' && !r.simulated && r.delivery && r.delivery.state === 'failed') {
      const why = r.delivery.reason ? ' (' + _s(r.delivery.reason, 120) + ')' : '';
      const to = r.client ? ' ל' + _s(r.client, 60) : '';
      out.push(retried[k]
        ? { key: 'deliv_' + _safeKey(k), agent: 'archive', level: 'ask', text: `שליחת חשבונית ${doc}${to} נכשלה גם בניסיון החוזר${why}` }
        : { key: 'deliv_' + _safeKey(k), agent: 'archive', level: 'info', retry: k, text: `שליחת חשבונית ${doc}${to} נכשלה${why} — מנסה שוב פעם אחת` });
    }
  }
  for (const [k, b] of Object.entries(x.batches || {})) {
    if (k[0] === '_' || !b || !b.n || b.doneAt) continue;
    const mail = b.emailKey && x.mail ? x.mail[b.emailKey] : '';
    if (b.emailError || MAIL_FAILED.includes(mail)) {
      out.push({ key: 'mail_' + b.n, agent: 'kolet', level: 'ask', text: `המייל למשלוח ${b.n} לשרטט נכשל — לחץ שלח שוב` });
    }
    if (now - (Number(b.at) || now) > BATCH_LONG_MS) {
      out.push({ key: 'long_' + b.n, agent: 'kolet', level: 'info', text: `משלוח ${b.n} אצל השרטט כבר יותר מיום` });
    }
  }
  return out;
}

//  prev = { key: {level} }, problems = [{key, level}] → { open:[key], clear:[key] }
function lgWatchDiff(prev, problems) {
  const p = prev || {}, now = new Set();
  const open = [];
  for (const x of problems || []) {
    now.add(x.key);
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
//  ev: { kind:'info'|'ask', text, ref? }. o: { env, now, cfg? (undefined → נקרא), sendPending? }
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
      if (pinged) await (opt.sendPending || S.lgAgentSendPending)(db, { env, deadline: Date.now() + 20 * 1000 });
    } catch (e) { console.warn('agent-watch: ping', e && e.name); }
  }
  return { roomKey, asked: ask, pinged };
}

// ─── ההרצה מהדופק ───────────────────────────────────────────────────
//  o: { env, now, deliver?(db, key, {now}), sendPending? } → { ok, skipped?, opened, cleared }
async function lgAgentWatchRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (env.AGENT_SHADOW_ENABLED !== 'true') return { ok: true, skipped: 'off', opened: 0, cleared: 0 };
  //  פעם בדקה לכל היותר (גם כמה מחשבים / דופק כפול). null-first: הקריאה הראשונה מחזירה ערך
  const t = await db.ref(WATCH + '/lastRun').transaction(cur => (cur != null && Math.abs(now - Number(cur)) < RUN_GAP_MS ? undefined : now));
  if (!t.committed) return { ok: true, skipped: 'throttled', opened: 0, cleared: 0 };

  const cfg = await lgAgentConfig(db);
  const modeOf = a => lgAgentModeOf(cfg, a, env);
  const on = a => modeOf(a) !== 'off';
  const state = (await db.ref(WATCH).once('value')).val() || {};
  const prev = state.problems || {};
  const retried = { ...(state.retried || {}) };

  const watchers = (await db.ref(WATCHERS).once('value')).val() || {};
  let invoices = {}, batches = {}, mail = {};
  if (on('archive')) {
    invoices = (await db.ref('invoicePdf').orderByChild('createdAt').startAt(now - INVOICE_LOOKBACK_MS).once('value')).val() || {};
  }
  //  "רק לקוחות שבמערכת": מפתח הכרטיס שעל החשבונית שייך למשתמש. users נקרא רק כשיש מועמדת
  let users = null;
  const needUsers = Object.values(invoices).some(r => r && r.state === 'printed' && now - (Number(r.createdAt) || now) > PRINTED_MS);
  if (needUsers) users = (await db.ref('users').once('value')).val() || {};
  const M = require('./_invoice-match');
  const knownAccount = r => {
    const acct = M.extractAccountKey(String(r.text || ''));
    return !!acct && Object.values(users || {}).some(u => u && String(u.customerId || '') === acct);
  };
  if (on('kolet')) {
    batches = (await db.ref('waMeta/drafterBatches').once('value')).val() || {};
    for (const [k, b] of Object.entries(batches)) {
      if (k[0] === '_' || !b || b.doneAt || !b.emailKey) continue;
      mail[b.emailKey] = String((await db.ref('waMeta/emailOutbox/' + b.emailKey + '/state').once('value')).val() || '');
    }
  }

  const all = lgWatchProblems({ now, watchers, invoices, knownAccount, retried, batches, mail }).filter(p => on(p.agent));
  const byKey = {};
  all.forEach(p => { byKey[p.key] = p; });
  //  לא "מתוקן": בעיה של סוכן כבוי, או של מחשב שלא שלח דופק עדכני
  const freshPc = pc => { const w = watchers[pc]; return !!w && now - (Number(w.at) || 0) <= FRESH_MS; };
  const keep = (k, p) => !on(p.agent) || ((k.startsWith('file_') || k.startsWith('print_'))
    && !Object.keys(watchers).some(pc => freshPc(pc) && (k === 'print_' + _safeKey(pc) || k.startsWith('file_' + _safeKey(pc) + '_'))));
  const diff = lgWatchDiff(prev, all);
  const next = { ...prev };
  let opened = 0, cleared = 0;

  for (const k of diff.open) {
    const p = byKey[k];
    if (p.retry) {
      try { await (opt.deliver || require('./_invoice-deliver').lgInvoiceDeliver)(db, p.retry, { now }); }
      catch (e) { console.warn('agent-watch: deliver retry', e && e.name); }
      retried[p.retry] = now;
    }
    const r = await lgAgentEvent(db, p.agent, { kind: p.level, text: p.text }, { env, now, cfg, sendPending: opt.sendPending });
    //  נכתב או לא — נרשם, כדי לא לנסות בכל דקה (החדר הוא תיעוד, לא העבודה)
    next[k] = { level: p.level, agent: p.agent, at: now, text: _s(p.text, 300),
                roomKey: r ? r.roomKey : null, asked: !!(r && r.asked) };
    opened++;
  }
  for (const k of diff.clear) {
    const p = prev[k];
    if (keep(k, p)) continue;
    if (p.roomKey && p.asked) await lgRoomClose(db, p.roomKey, now);
    if (p.roomKey) await lgAgentEvent(db, p.agent, { kind: 'info', text: 'תוקן: ' + _s(p.text, 200) }, { env, now, cfg });
    delete next[k];
    if (k.startsWith('deliv_')) Object.keys(retried).forEach(ik => { if ('deliv_' + _safeKey(ik) === k) delete retried[ik]; });
    cleared++;
  }
  //  כותבים רק כשמשהו השתנה
  if (opened || cleared || JSON.stringify(retried) !== JSON.stringify(state.retried || {})) {
    await db.ref(WATCH + '/problems').set(Object.keys(next).length ? next : null);
    await db.ref(WATCH + '/retried').set(Object.keys(retried).length ? retried : null);
  }
  return { ok: true, opened, cleared };
}

module.exports = { WATCHERS, WATCH, LG_AGENT_KEYS, lgIsWorkingHours, lgWatchHeartbeatClean, lgWatchProblems, lgWatchDiff,
                   lgWatcherSilentLine, lgAgentEvent, lgAgentWatchRun };
