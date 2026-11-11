'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-guards.js — השומרים: מוצאים מה נתקע, מעבירים לסוכן האחראי, שולחים שוב
//  כשבטוח ושואלים את בן כשלא (בן, 11/11).
//
//  עוזר משותף, לא route. רץ מתוך lgAgentWatchRun (_agent-watch.js) בסבב האיטי (פעם ב-10 דק'),
//  רק כשיש waMeta/agentConfig והמתג העליון AGENT_SHADOW_ENABLED דלוק.
//  אפיון: docs/superpowers/specs/2026-11-11-agents-talk-design.md — סעיפים ו (הטבלאות), ז (השיחה), יא.
//
//  כל טיפול = שיחה אחת בחדר (lgRoomSay): מוצא → (מעביר) → ✓ נפתר / ⚠ צריך את בן / ⏸ "הייתי…".
//    כמה בעיות מאותו סוג באותו סבב → שיחה אחת ("3 הודעות מחכות…"), מפתח grp_<סוג>_<זמן>.
//    אותה בעיה בסבב הבא → אותה שיחה (waMeta/agentWatch/problems/<מפתח>, lgWatchDiff).
//    בעיה שחוזרת אחרי שנפתרה → שיחה חדשה (מזהה השיחה = מפתח הבעיה + זמן הפתיחה).
//
//  ⚠️ שליחה חוזרת — רק פעם אחת לכל בעיה (waMeta/agentWatch/retried/<מפתח>, 14 יום), נכתב **לפני**
//     הפעולה, ורק על כשל ברור (lgGuardResendOk): לא נשלח בכלל / מנותק / מכסה / קצב. כשל לא ברור
//     (רשת, נמען, אחר, או רשומה ישנה בלי failureKind) → שואלים את בן ("לא ברור אם יצא").
//  ⚠️ טריות: "מוכן" רק < 24 שעות מההכנסה לתור; "ההובלה" רק באותו יום בישראל; תמונה נכנסת רק < 24 שעות.
//  ⚠️ לעולם לא לבד: חשבשבת, הדפסות, ושורה שכבר 'sent'.
//  ⚠️ וואטסאפ מנותק (waMeta/whatsapp.state !== 'authorized') — לא נוגעים בתור הוואטסאפ בכלל;
//     ההתראה היא של שלב 4 (תקלות). השקט כאן מכוון.
//  ⚠️ פעולת שליחה אחת לכל ערוץ בכל סבב, ותמיד לפני הדדליין של הדופק.
//
//  מתגים לפי הסוכן המטפל: כבוי → כלום · שקט → רק החדר, "הייתי שולח שוב" · עונה → פועל.
//  הודעה לבן — רק כשהמטפל "עונה" (דרך module.exports._notifyBen → lgBenNotify ב-_agent-ben.js).
//
//  עלות (סבב של 10 דק'): waOutbox לפי state (pending / failed / expired), waMeta/emailOutbox (קטן),
//  invoicePdf לפי createdAt 48 שעות (מגיע מהבדיקות של הארכיון) + state awaiting, waInbound / emailInbound
//  לפי state, waMeta/printJobs לפי מפתח (48 שעות), waMeta/sendersSeen / groupsSeen.
//  חשבשבת (שורה 10) — רק מה-orders שסריקת השעה כבר קראה. אף פעם לא כל orders.
// ═══════════════════════════════════════════════════════════════════

const { lgAgentModeOf } = require('./_agent-config');
const { lgRoomSay, lgRoomClose } = require('./_agent-room');

const WATCH = 'waMeta/agentWatch';
const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const PENDING_MS = 10 * MIN;           // שורה 1: בתור יותר מ-10 דק'
const PENDING_BEN_MS = H;              // ועדיין בתור אחרי שעה → בן
const WA_MAX_ATTEMPTS = 3;             // = MAX_ATTEMPTS ב-_wa-outbox.js
const CLAIM_TTL_MS = 2 * MIN;          // = CLAIM_TTL_MS ב-_wa-outbox.js / _wa-inbound.js
const ROW_WINDOW_MS = 48 * H;          // שורות ישנות מזה — לא נבדקות (expired / dead נשארות לנצח)
const READY_FRESH_MS = 24 * H;
const INVOICE_FRESH_MS = 48 * H;       // ניסיון חוזר לחשבונית — עד 48 שעות (היה שעתיים)
const DEFAULT_FRESH_MS = 24 * H;
const INV_QUEUED_MS = H;               // שורה 3: חשבונית "בתור" יותר משעה
const INBOUND_STUCK_MS = 2 * MIN;      // שורה 7: received / processing יותר מ-2 דק'
const INBOUND_FRESH_MS = 24 * H;       // אחרי זה הקובץ נמחק אצל ספק הוואטסאפ
const AWAITING_MS = DAY, AWAITING_MAX_MS = 7 * DAY;   // שורה 11
const HS_WINDOW_MS = 7 * DAY;          // שורה 10
const PRINT_WINDOW_MS = 48 * H;        // שורה 12
const UNLINKED_WINDOW_MS = DAY;        // שורה 12א
const KEEP_MS = 14 * DAY;              // בעיה שלא נפתרה ולא נעלמה — נשכחת אחרי שבועיים
const OPEN_MAX = 20;                   // בעיות חדשות לכל סבב (השאר — בסבב הבא)
const WA_MIN_BUDGET_MS = 16 * 1000;    // שליחה אחת בגרוע ביותר (15ש׳) + מרווח
const WA_MAX_BUDGET_MS = 20 * 1000;
const INBOUND_MIN_LEFT_MS = 15 * 1000;
const CLEAR_KINDS = ['disconnected', 'rate', 'quota'];
const GUARD_KEY = /^(wao|deliv|emo|win|ein|hs|hsi|await|pjob|unl)_/;
//  ⚠️ שמות הסוכנים בעברית — שלושה עותקים, לעדכן יחד: api/_agent-room.js (AGENT_HEB), api/_agent-guards.js (AGENT_HEB), agents-dash.js (LG_AD_AGENTS, קובץ דפדפן)
const AGENT_HEB = { markazan: 'מרכזן', kolet: 'קולט', archive: 'ארכיון', okev: 'עוקב', price: 'מחירון', manager: 'מנהל' };

const _safeKey = s => String(s == null ? '' : s).replace(/[.#$[\]/\s]/g, '_').slice(0, 60);
const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && !/[.#$[\]/]/.test(k);
const _s = (v, n) => String(v == null ? '' : v).slice(0, n);
const _list = v => (Array.isArray(v) ? v : Object.values(v || {}));
const _ilDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(t));

// ─── טהור ─────────────────────────────────────────────────────────────

//  סיבה קצרה בעברית לחדר / לבן. ⚠️ לעולם לא טקסט גולמי מהספק (lastError / delivery.reason) —
//  רק סוג הכשל או משפט מוכר של המערכת; אחרת "סיבה לא ידועה".
const UNCLEAR = 'לא ברור אם יצאה';
const UNKNOWN_REASON = 'סיבה לא ידועה';
const KIND_HEB = { disconnected: 'הוואטסאפ היה מנותק', quota: 'נגמרה המכסה אצל ספק הוואטסאפ', rate: 'יותר מדי הודעות בבת אחת',
                   recipient: 'בעיה במספר של הלקוח', network: 'תקלת תקשורת', other: 'תקלה אצל ספק הוואטסאפ' };
const KNOWN_REASONS = [
  [/אין מספר טלפון|אין נמען/, 'אין מספר טלפון ללקוח'],
  [/חשבוניות לפרטי/, 'סומן "חשבוניות לפרטי" בלי מספר פרטי'],
  [/ההזמנה לא נמצאה|הזמנה חסרה|ההזמנות כבר לא קיימות/, 'ההזמנה לא נמצאה'],
  [/פיקטיבית/, 'ההזמנה סומנה פיקטיבית'],
  [/קובץ החשבונית חסר|קבצי החשבונית לא זמינים/, 'קובץ החשבונית חסר'],
  [/פג תוקף/, 'פג תוקף בתור'],
  [/לא מקושרת/, 'הכתובת כבר לא מקושרת'],
  [/הסקריפט דיווח/, 'סקריפט המייל דיווח על כישלון'],
  [/מנותק/, 'הוואטסאפ היה מנותק'],
  [/ניסיונות נכשלו/, 'נכשל 3 פעמים'],
  [/אינו תמונה|לא נתמך/, 'הקובץ לא נתמך'],
  [/עברו 24 שעות/, 'עברו 24 שעות'],
  [/כבר נוצרה הזמנה/, 'כבר נקלט'],
  [/פג בתור המייל/, 'פג בתור המייל'],
  [/^שגיאה$/, 'תקלה בשליחה'],
];
function _reason(failureKind, text) {
  if (failureKind && KIND_HEB[failureKind]) return KIND_HEB[failureKind];
  const t = String(text || '');
  for (const [re, heb] of KNOWN_REASONS) if (re.test(t)) return heb;
  return UNKNOWN_REASON;
}
const _paren = (fk, text) => ' (' + _reason(fk, text) + ')';

//  מותר לשלוח שוב את השורה הזו (waOutbox / emailOutbox)? → { ok, why }
//  טריות לפי סוג, ואחר כך כשל ברור בלבד. why — בעברית, לחדר.
function lgGuardResendOk(row, now) {
  const t = Number(now) || Date.now();
  if (!row || typeof row !== 'object') return { ok: false, why: 'הרשומה לא נמצאה' };
  if (row.state === 'sent') return { ok: false, why: 'כבר נשלח' };
  if (row.state === 'cancelled') return { ok: false, why: 'בוטל' };
  //  זמן היצירה המקורי — שליחה חוזרת (email-requeue) לא מאפסת אותו (תיקון סקירה סופית I4).
  //  firstCreatedAt — רק בשורות שנכתבו לפני התיקון.
  const at = Number(row.firstCreatedAt) || Number(row.createdAt) || 0;
  const kind = String(row.kind || '');
  if (kind === 'sketches-received') return { ok: false, why: '"נקלטו" באיחור לא נשלח' };
  if (kind === 'dispatched') {
    if (!at || _ilDay(at) !== _ilDay(t)) return { ok: false, why: 'עבר יום — "ההובלה" לא נשלחת יום אחרי' };
  } else {
    const fresh = kind === 'ready' ? READY_FRESH_MS : kind === 'invoice' ? INVOICE_FRESH_MS : DEFAULT_FRESH_MS;
    if (!at || t - at >= fresh) return { ok: false, why: kind === 'ready' ? 'עברה יממה מ"מוכן"' : 'ההודעה ישנה מדי' };
  }
  if (row.state === 'pending') return { ok: true, why: 'לא נשלחה בכלל' };
  if ((Number(row.attempts) || 0) === 0) return { ok: true, why: 'לא נוסתה בכלל' };
  if (CLEAR_KINDS.includes(row.failureKind)) return { ok: true, why: 'לא יצאה — ' + KIND_HEB[row.failureKind] };
  return { ok: false, why: UNCLEAR };
}

const WA_LABEL = { ready: '"מוכן"', dispatched: '"ההובלה"', 'sketches-handled': '"הסקיצות טופלו"', 'sketches-received': '"נקלטו"',
                   'broken-returned': '"פריט חזר מחיסום"' };
const _label = r => (r && r.kind === 'sketches-handled' && r.variant === 'po' ? 'אישור הזמנת רכש' : WA_LABEL[r && r.kind] || 'הודעה');
const _who = r => {
  const c = _s(r && r.clientName, 60), n = _list(r && r.orderNums).slice(0, 3).map(x => _s(x, 20)).join(', ');
  return (c || 'הלקוח') + (n ? ' (' + n + ')' : '');
};
//  מי מטפל בהודעה לפי הסוג ("בעלות" באפיון)
function _ownerOf(r) {
  const k = r && r.kind;
  if (k === 'ready' || k === 'dispatched' || k === 'broken-returned') return 'okev';
  if (k === 'invoice') return 'archive';
  if (k === 'sketches-handled') return 'kolet';
  if (k === 'sketches-received') return 'markazan';
  return 'manager';
}
const _collected = (stages, r) => {
  const id = _list(r && r.orderIds)[0];
  const st = id != null && stages ? stages[id] : null;
  return st === 'collected' || st === 'delivered';
};

//  הודעה שכבר לא שולחים (ישנה מדי): "ההובלה" → רק רושמים; "נקלטו" → כלום; "מוכן" שנאסף → כלום; השאר → בן
function _stale(out, base, r, why, stages) {
  if (r.kind === 'sketches-received') return;
  if (r.kind === 'dispatched') {
    out.push({ ...base, level: 'info', text: `הודעת ${_label(r)} ל${_who(r)} לא יצאה — ${why}`, doneText: 'רק רושם — לא שולח' });
    return;
  }
  if (r.kind === 'ready' && _collected(stages, r)) return;
  out.push({ ...base, level: 'ben', text: `הודעת ${_label(r)} ל${_who(r)} לא יצאה — ${why}. לא שולח לבד` });
}

//  הבעיות עכשיו. in: { now, waOutbox, emailOutbox, invoices, invOutbox?, waInbound, emailInbound, orders?, waState,
//    sendersSeen, groupsSeen, linkedSenders?, linkedGroups?, awaiting?, printJobs?, retried?, orderStages? }
//  → [{ key, finder, owner, level:'fix'|'ben'|'info', text, group, src, rkey?, ref?, fix?: { type, src, channel } }]
function lgGuardProblems(input) {
  const x = input || {}, now = Number(x.now) || Date.now(), out = [];
  const retried = x.retried || {}, stages = x.orderStages || {};
  const inWin = at => { const a = Number(at) || 0; return a > 0 && now - a <= ROW_WINDOW_MS; };

  // ── 1+2: תור הוואטסאפ (לא חשבוניות — הן בשורה 3). מנותק → כלום (התראה של שלב 4) ──
  if (x.waState === 'authorized') {
    for (const [k, r] of Object.entries(x.waOutbox || {})) {
      if (!r || r.kind === 'invoice' || !inWin(r.createdAt)) continue;
      const key = 'wao_' + _safeKey(k), owner = _ownerOf(r);
      const base = { key, finder: 'manager', owner, src: k, rkey: key, ref: _list(r.orderIds)[0] ? { orderId: _list(r.orderIds)[0] } : null };
      const ok = lgGuardResendOk(r, now);
      if (r.state === 'pending') {
        if (r.claimedAt && now - r.claimedAt < CLAIM_TTL_MS) continue;          // באוויר
        //  שורה שהשומר איפס (wa-resend) — הזמן נספר מהאיפוס, לא "תקועה יותר משעה" מיד אחריו
        const age = now - (Math.max(Number(r.createdAt) || 0, Number(r.guardResendAt) || 0) || now);
        if (age <= PENDING_MS) continue;
        if (!ok.ok) { _stale(out, { ...base, group: 'wa-stale' }, r, ok.why, stages); continue; }
        if (age > PENDING_BEN_MS) {
          out.push({ ...base, group: 'wa-stuck', level: 'ben', text: `הודעת ${_label(r)} ל${_who(r)} תקועה בתור יותר משעה` });
          continue;
        }
        out.push({ ...base, group: 'wa-pending', level: 'fix', text: `הודעת ${_label(r)} ל${_who(r)} מחכה בתור ${Math.floor(age / MIN)} דק'`,
                   fix: { type: 'wa-drain', src: k, channel: 'wa' } });
      } else if (r.state === 'failed') {
        if ((Number(r.attempts) || 0) < WA_MAX_ATTEMPTS) continue;              // התור עוד מנסה לבד
        const err = _paren(r.failureKind, r.lastError);
        if (retried[key]) { out.push({ ...base, group: 'wa-failed', level: 'ben', text: `הודעת ${_label(r)} ל${_who(r)} נכשלה גם אחרי ששלחתי שוב${err}` }); continue; }
        if (ok.ok) {
          out.push({ ...base, group: 'wa-failed', level: 'fix', text: `הודעת ${_label(r)} ל${_who(r)} נכשלה ${r.attempts} פעמים${err}`,
                     fix: { type: 'wa-resend', src: k, channel: 'wa' } });
        } else if (ok.why === UNCLEAR) {
          out.push({ ...base, group: 'wa-failed', level: 'ben', text: `הודעת ${_label(r)} ל${_who(r)} נכשלה${err}. לא ברור אם יצאה — לשלוח שוב?` });
        } else _stale(out, { ...base, group: 'wa-stale' }, r, ok.why, stages);
      } else if (r.state === 'expired') {
        _stale(out, { ...base, group: 'wa-stale' }, r, ok.ok ? 'פג תוקף בתור' : ok.why, stages);
      }
    }
  }

  // ── 3 + 9: חשבונית שלא נשלחה (invoicePdf/<k>/delivery) — ארכיון → ארכיון ──
  for (const [k, inv] of Object.entries(x.invoices || {})) {
    if (!inv || inv.state !== 'ready' || inv.simulated || !inWin(inv.createdAt)) continue;
    const dv = inv.delivery;
    if (!dv || !['queued', 'failed', 'blocked'].includes(dv.state)) continue;
    const key = 'deliv_' + _safeKey(k), doc = _s(inv.docNumber || k, 20);
    const to = inv.client ? ' ל' + _s(inv.client, 60) : '';
    const why = dv.state === 'queued' ? '' : _paren(null, dv.reason);
    const base = { key, finder: 'archive', owner: 'archive', src: k, rkey: k, group: 'invoice', ref: { invoiceKey: k } };
    if (dv.state === 'blocked') { out.push({ ...base, level: 'ben', text: `חשבונית ${doc}${to} לא נשלחה${why} — חסר נתון` }); continue; }
    if (dv.state === 'queued' && now - (Number(dv.at) || now) <= INV_QUEUED_MS) continue;
    const row = (x.invOutbox || {})[k];
    if (row && row.state === 'sent') continue;                                   // השליחה עוד תסמן את delivery
    if (row && dv.channel === 'email' && row.state === 'pending') continue;     // מחכה לסקריפט המייל (התראה של שלב 4)
    if (row && dv.channel !== 'email' && row.state === 'pending' && row.claimedAt && now - row.claimedAt < CLAIM_TTL_MS) continue;
    const what = dv.state === 'queued' ? `חשבונית ${doc}${to} מחכה לשליחה יותר משעה` : `שליחת חשבונית ${doc}${to} נכשלה${why}`;
    if (retried[k]) { out.push({ ...base, level: 'ben', text: `שליחת חשבונית ${doc}${to} נכשלה גם אחרי ניסיון חוזר${why}` }); continue; }
    const ok = row ? lgGuardResendOk({ ...row, kind: 'invoice', createdAt: Number(inv.createdAt) || row.createdAt }, now)
                   : { ok: false, why: UNCLEAR };
    if (ok.ok) out.push({ ...base, level: 'fix', text: what, fix: { type: 'invoice-redeliver', src: k, channel: dv.channel === 'email' ? 'email' : 'wa' } });
    else out.push({ ...base, level: 'ben', text: what + ' — ' + ok.why + (ok.why === UNCLEAR ? ', לשלוח שוב?' : '') });
  }

  // ── 6: מייל ללקוח שנכשל / פג (לא חשבונית — שורה 3; לא משלוח לשרטט — בדיקת הקולט הקיימת) ──
  for (const [k, r] of Object.entries(x.emailOutbox || {})) {
    //  agent-alarm — התראת תקלה לבן (_agent-ben.js), לא מייל ללקוח
    if (!r || r.kind === 'invoice' || r.kind === 'drafter-batch' || r.kind === 'agent-alarm' || !['failed', 'expired'].includes(r.state) || !inWin(r.createdAt)) continue;
    const key = 'emo_' + _safeKey(k);
    const owner = r.kind === 'sketches-handled' ? 'kolet' : _ownerOf(r);
    const base = { key, finder: owner, owner, src: k, rkey: key, group: 'email' };
    const what = `מייל ${_label(r)} ל${_who(r)} ${r.state === 'failed' ? 'נכשל' : 'לא יצא (פג בתור)'}`;
    if (retried[key]) { out.push({ ...base, level: 'ben', text: `מייל ${_label(r)} ל${_who(r)} נכשל גם אחרי ששלחתי שוב` }); continue; }
    const ok = lgGuardResendOk(r, now);
    if (ok.ok) out.push({ ...base, level: 'fix', text: what, fix: { type: 'email-requeue', src: k, channel: 'email' } });
    else if (ok.why === UNCLEAR) out.push({ ...base, level: 'ben', text: what + ' — לא ברור אם יצא, לשלוח שוב?' });
    else if (r.kind === 'sketches-received') continue;
    else if (r.kind === 'dispatched') out.push({ ...base, level: 'info', text: what + ' — ' + ok.why, doneText: 'רק רושם — לא שולח' });
    else if (r.kind === 'ready' && _collected(stages, r)) continue;
    else out.push({ ...base, level: 'ben', text: what + ' — ' + ok.why + '. לא שולח לבד' });
  }

  // ── 7 + 8: קליטה שנתקעה — קולט → קולט ──
  for (const [ch, rows] of [['whatsapp', x.waInbound], ['email', x.emailInbound]]) {
    for (const [k, r] of Object.entries(rows || {})) {
      if (!r || !inWin(r.createdAt)) continue;
      const st = r.state;
      if (ch === 'email' && !['failed', 'dead'].includes(st)) continue;
      if (st === 'received' && now - (Number(r.createdAt) || now) <= INBOUND_STUCK_MS) continue;
      if (st === 'processing' && (!r.claimedAt || now - r.claimedAt < INBOUND_STUCK_MS)) continue;
      if (!['received', 'processing', 'failed', 'dead'].includes(st)) continue;
      const key = (ch === 'email' ? 'ein_' : 'win_') + _safeKey(k);
      const from = ch === 'email' ? _s(r.from, 80) : _s(r.groupName || r.sender || r.chatId, 60);
      const what = ch === 'email' ? `מייל נכנס מ${from || 'לקוח'} נתקע בקליטה` : `תמונה מ${from || 'לקוח'} נתקעה בקליטה`;
      const why = st === 'received' || st === 'processing' ? '' : _paren(null, r.reason);
      const base = { key, finder: 'kolet', owner: 'kolet', src: k, rkey: key, group: ch === 'email' ? 'in-email' : 'in-wa' };
      if (ch === 'whatsapp' && now - (Number(r.createdAt) || 0) >= INBOUND_FRESH_MS) {
        out.push({ ...base, level: 'ben', text: what + why + ' — עברו 24 שעות, צריך לבקש מהלקוח לשלוח שוב' });
        continue;
      }
      if (retried[key]) { out.push({ ...base, level: 'ben', text: what + ' גם אחרי ניסיון חוזר' + why }); continue; }
      out.push({ ...base, level: 'fix', text: what + why, fix: { type: 'inbound-retry', src: k, channel: ch === 'email' ? 'email-in' : 'wa-in', inbox: ch, state: st } });
    }
  }

  // ── 10: חשבשבת דחה — רק מה-orders שסריקת השעה קראה ──
  for (const [id, o] of Object.entries(x.orders || {})) {
    if (!o || typeof o !== 'object' || o.isTest === true) continue;
    const num = _s(o.orderNum || o.refNum || id, 30), who = _s(o.orderClient || o.client, 60);
    for (const [f, pre, owner, what] of [['hashavshevet', 'hs_', 'okev', 'את הזמנה'], ['hashavshevetInvoice', 'hsi_', 'archive', 'את החשבונית של הזמנה']]) {
      const h = o[f];
      if (!h || h.httpOk !== false || h.simulated || now - (Number(h.sentAt) || 0) > HS_WINDOW_MS) continue;
      out.push({ key: pre + _safeKey(id), finder: owner, owner, src: String(id), group: pre === 'hs_' ? 'hs' : 'hsi', level: 'ben', ref: { orderId: String(id) },
                 text: `חשבשבת דחה ${what} ${num}${who ? ' · ' + who : ''}${h.httpStatus ? ' (קוד ' + _s(h.httpStatus, 6) + ')' : ''} — לא שולח שוב לבד, עלול להיווצר מסמך כפול` });
    }
  }

  // ── 11: חשבונית שנרשמה בתחנה ולא הותאמה להדפסה יותר מיום ──
  for (const [k, r] of Object.entries(x.awaiting || {})) {
    if (!r || r.state !== 'awaiting' || r.simulated) continue;
    const age = now - (Number(r.createdAt) || now);
    if (age <= AWAITING_MS || age > AWAITING_MAX_MS) continue;
    out.push({ key: 'await_' + _safeKey(k), finder: 'archive', owner: 'archive', src: k, group: 'await', level: 'ben', ref: { invoiceKey: k },
               text: `חשבונית ${_s(r.docNumber || k, 20)}${r.client ? ' ל' + _s(r.client, 60) : ''} נרשמה בתחנה לפני יותר מיום ועדיין לא הותאמה להדפסה` });
  }

  // ── 12: הדפסה שנכשלה / לא ידוע אם יצאה — לא מדפיסים שוב לבד ──
  const jobs = x.printJobs || {};
  const reprinted = new Set(Object.values(jobs).map(j => j && j.reprintOf).filter(Boolean));
  for (const [id, j] of Object.entries(jobs)) {
    if (!j || !['failed', 'unknown'].includes(j.state) || reprinted.has(id) || now - (Number(j.createdAt) || 0) > PRINT_WINDOW_MS) continue;
    out.push({ key: 'pjob_' + _safeKey(id), finder: 'kolet', owner: 'kolet', src: id, group: 'print', level: 'ben',
               text: `הדפסת מדבקות${j.client ? ' ל' + _s(j.client, 60) : ''} ${j.state === 'unknown' ? 'לא ידוע אם יצאה' : 'נכשלה'} — לא מדפיס שוב לבד` });
  }

  // ── 12א: מספרים / קבוצות לא מקושרים ששלחו — פעם ביום ──
  const ls = x.linkedSenders || {}, lg = x.linkedGroups || {};
  const names = [];
  for (const [k, s] of Object.entries(x.sendersSeen || {})) {
    if (!s || s.ignored || ls[k] || !(Number(s.count) > 0) || now - (Number(s.lastAt) || 0) > UNLINKED_WINDOW_MS) continue;
    names.push(_s(s.phone || k, 20));
  }
  for (const [k, g] of Object.entries(x.groupsSeen || {})) {
    if (!g || g.ignored || lg[k] || now - (Number(g.lastAt) || 0) > UNLINKED_WINDOW_MS) continue;
    names.push('קבוצה ' + _s(g.name || k, 40));
  }
  if (names.length) {
    out.push({ key: 'unl_' + _ilDay(now), finder: 'markazan', owner: 'markazan', src: _ilDay(now), group: 'unlinked', level: 'ben',
               text: `${names.length === 1 ? 'מספר לא מקושר שלח' : names.length + ' מספרים/קבוצות לא מקושרים שלחו'} תמונות: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''} — לקשר בקליטות` });
  }
  return out;
}

//  כותרת לשיחה של כמה בעיות מאותו סוג
const GROUP_TEXT = {
  'wa-pending': n => `${n} הודעות וואטסאפ מחכות בתור יותר מ-10 דק'`,
  'wa-stuck': n => `${n} הודעות וואטסאפ תקועות בתור יותר משעה`,
  'wa-failed': n => `${n} הודעות וואטסאפ נכשלו`,
  'wa-stale': n => `${n} הודעות וואטסאפ לא יצאו ועבר הזמן שלהן`,
  invoice: n => `${n} חשבוניות לא נשלחו`,
  email: n => `${n} מיילים ללקוחות לא יצאו`,
  'in-wa': n => `${n} תמונות נתקעו בקליטה`,
  'in-email': n => `${n} מיילים נכנסים נתקעו בקליטה`,
  hs: n => `חשבשבת דחה ${n} הזמנות`,
  hsi: n => `חשבשבת דחה ${n} חשבוניות`,
  await: n => `${n} חשבוניות נרשמו בתחנה ולא הותאמו להדפסה יותר מיום`,
  print: n => `${n} הדפסות נכשלו או לא ידוע אם יצאו`,
};
const WOULD = { 'wa-drain': 'הייתי שולח עכשיו', 'inbound-retry': 'הייתי מנסה לקלוט שוב' };
const RESEND = ['wa-resend', 'invoice-redeliver', 'email-requeue', 'inbound-retry'];

// ─── ההרצה ──────────────────────────────────────────────────────────

const _val = async (db, p) => (await db.ref(p).once('value')).val();
//  ⚠️ לפי createdAt (אינדקס קיים), 48 שעות, והמצב מסונן בזיכרון — expired / dead / failed סופיים נשארים
//  לנצח, ושאילתה לפי state הייתה גדלה בלי סוף. החלון חסום בכמות התנועה של יומיים.
const _recent = async (db, path, now, states) => {
  const all = (await db.ref(path).orderByChild('createdAt').startAt(now - ROW_WINDOW_MS).once('value')).val() || {};
  const out = {};
  for (const [k, v] of Object.entries(all)) if (v && states.includes(v.state)) out[k] = v;
  return out;
};

//  הפעולה עצמה. → { out:'sent'|'failed'|'pending'|'skip', reason? }
async function _perform(db, p, o) {
  const d = o.deps || {}, now = o.now, f = p.fix;
  const budgetMs = () => Math.min(WA_MAX_BUDGET_MS, o.deadline - Date.now() - 2000);
  const drain = async keys => {
    const fn = d.drain || require('./_wa-drain-core').drainNow;
    const r = await fn(db, keys, 'agent-guard', { budgetMs: budgetMs() });
    const res = ((r && r.results) || []).find(x => x.key === keys[0]);
    if (res && res.status === 'sent') return { out: 'sent' };
    if (res && (res.status === 'error' || res.status === 'blocked')) return { out: 'failed', reason: res.reason || '' };
    return { out: 'pending' };
  };
  if (f.type === 'wa-drain') return drain([f.src]);
  if (f.type === 'wa-resend') {
    //  מאפס ניסיונות רק לשורה שבאמת נגמרו לה — ושלא נשלחה בינתיים
    const tx = await db.ref('waOutbox/' + f.src).transaction(cur => {
      if (cur === null) return null;   // null-first
      if (cur.state !== 'failed' || (Number(cur.attempts) || 0) < WA_MAX_ATTEMPTS) return;
      return { ...cur, state: 'pending', attempts: 0, claimedAt: null, claimedBy: null, lastError: null, failureKind: null,
               updatedAt: now, guardResendAt: now };
    });
    if (!tx.committed || !tx.snapshot.val()) return { out: 'skip' };
    return drain([f.src]);
  }
  if (f.type === 'invoice-redeliver') {
    const dv = await _val(db, 'invoicePdf/' + f.src + '/delivery');
    //  מייל שפג בתור לא מסמן את delivery — מסמנים 'failed' כדי ש-lgInvoiceDeliver יכניס שורה חדשה
    if (dv && dv.channel === 'email' && dv.state === 'queued') {
      await db.ref('invoicePdf/' + f.src + '/delivery').update({ state: 'failed', reason: 'פג בתור המייל', at: now });
    }
    const deliver = d.deliver || require('./_invoice-deliver').lgInvoiceDeliver;
    const r = await deliver(db, f.src, { now, drain: (db2, keys, by) => (d.drain || require('./_wa-drain-core').drainNow)(db2, keys, by, { budgetMs: budgetMs() }) });
    if (r && r.state === 'sent') return { out: 'sent' };
    if (r && (r.state === 'blocked' || (r.result && ['error', 'blocked'].includes(r.result.status)))) return { out: 'failed', reason: (r.result && r.result.reason) || '' };
    //  עדיין בתור (חלון שליחה תפוס / מייל שמחכה לסקריפט): השעה נספרת מעכשיו — לא "נכשלה שוב" בסבב הבא
    await db.ref('invoicePdf/' + f.src + '/delivery').transaction(cur => (cur === null ? null : cur.state === 'queued' ? { ...cur, at: now } : undefined));
    return { out: 'pending' };
  }
  if (f.type === 'email-requeue') {
    //  "שורה חדשה בתור המייל" — אותה רשומה מתחילה מחדש, רק מ-failed / expired.
    //  ⚠️ createdAt נשאר המקורי (תיקון סקירה סופית I4): "פג תוקף" בתפיסה (lgEmailClaim, 24ש׳) והחלונות כאן
    //  נספרים ממנו — מייל בן 23 שעות שנשלח שוב פג בזמנו, לא 47 שעות אחרי. מתי נשלח שוב — requeuedAt.
    const tx = await db.ref('waMeta/emailOutbox/' + f.src).transaction(cur => {
      if (cur === null) return null;
      if (!['failed', 'expired'].includes(cur.state)) return;
      return { ...cur, state: 'pending', attempts: 0, requeuedAt: now,
               updatedAt: now, leaseToken: null, leaseUntil: null, notBefore: null, lastError: null, requeuedBy: 'agent-guard' };
    });
    return tx.committed && tx.snapshot.val() ? { out: 'pending' } : { out: 'skip' };
  }
  if (f.type === 'inbound-retry') {
    const wa = f.inbox === 'whatsapp';
    const M = wa ? require('./_wa-inbound') : require('./_email-inbound');
    const retry = (wa ? d.waInboundRetry : d.emailInboundRetry) || (wa ? M.lgWaInboundRetry : M.lgEmailInboundRetry);
    const proc = (wa ? d.waInboundProcess : d.emailInboundProcess) || (wa ? M.lgWaInboundProcess : M.lgEmailInboundProcess);
    if (f.state === 'failed' || f.state === 'dead') {
      const rt = await retry(db, f.src, 'agent-guard', now);
      //  השתנה בינתיים: כבר נקלט / סומן כטופל / כבר בתור — לא "נכשל"
      if (rt && !rt.ok && ['done', 'closed'].includes(rt.code)) return { out: 'sent' };
      if (rt && !rt.ok && ['queued', 'processing'].includes(rt.code)) return { out: 'pending' };
      if (!rt || !rt.ok) return { out: 'failed', reason: (rt && rt.message) || '' };
    }
    const r = await proc(db, f.src, { by: 'agent-guard', now, deadline: o.deadline });
    const ok = r && (r.ok === true || r.state === 'done');
    return ok ? { out: 'sent' } : { out: 'failed', reason: (r && r.reason) || '' };
  }
  return { out: 'skip' };
}

const DONE_TEXT = { 'wa-drain': 'שלחתי ✓', 'inbound-retry': 'נקלט ✓' };

//  o: { env, now, cfg, deadline, invoices?, orders?, watchState?, deps? } → { found, fixed, asked }
async function lgGuardRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now(), cfg = opt.cfg;
  const deadline = Number(opt.deadline) || Date.now() + 30 * 1000;
  const late = () => Date.now() > deadline;
  const res = { found: 0, fixed: 0, asked: 0 };
  if (env.AGENT_SHADOW_ENABLED !== 'true' || !cfg) return res;
  const modeOf = a => lgAgentModeOf(cfg, a, env);
  const on = a => modeOf(a) !== 'off';
  const any = (...a) => a.some(on);

  // ── קריאה — רק למה שיש לו סוכן פעיל ──
  const waState = String((await _val(db, 'waMeta/whatsapp/state')) || '');
  const waOutbox = any('okev', 'kolet', 'markazan', 'manager') && waState === 'authorized'
    ? await _recent(db, 'waOutbox', now, ['pending', 'failed', 'expired']) : {};
  const emailOutbox = any('okev', 'kolet', 'markazan', 'manager') ? (await _val(db, 'waMeta/emailOutbox')) || {} : {};
  let invoices = {}, awaiting = {};
  const invOutbox = {};
  if (on('archive')) {
    invoices = opt.invoices || (await db.ref('invoicePdf').orderByChild('createdAt').startAt(now - ROW_WINDOW_MS).once('value')).val() || {};
    awaiting = (await db.ref('invoicePdf').orderByChild('state').equalTo('awaiting').once('value')).val() || {};
    for (const [k, inv] of Object.entries(invoices)) {
      const dv = inv && inv.delivery;
      if (!dv || inv.state !== 'ready' || !['queued', 'failed'].includes(dv.state) || !_keyOk(String(dv.outboxKey || ''))) continue;
      invOutbox[k] = await _val(db, (dv.channel === 'email' ? 'waMeta/emailOutbox/' : 'waOutbox/') + dv.outboxKey);
    }
  }
  let waInbound = {}, emailInbound = {}, printJobs = {};
  if (on('kolet')) {
    waInbound = await _recent(db, 'waInbound', now, ['received', 'processing', 'failed', 'dead']);
    emailInbound = await _recent(db, 'emailInbound', now, ['failed', 'dead']);
    //  רק 48 השעות האחרונות: המפתח מתחיל בזמן היצירה (base36, _print-jobs.js) — orderByKey בלי אינדקס
    printJobs = (await db.ref('waMeta/printJobs').orderByKey().startAt((now - PRINT_WINDOW_MS).toString(36)).once('value')).val() || {};
  }
  let sendersSeen = {}, groupsSeen = {};
  const linkedSenders = {}, linkedGroups = {};
  if (on('markazan')) {
    sendersSeen = (await _val(db, 'waMeta/sendersSeen')) || {};
    groupsSeen = (await _val(db, 'waMeta/groupsSeen')) || {};
    for (const [k, s] of Object.entries(sendersSeen)) {
      if (s && !s.ignored && now - (Number(s.lastAt) || 0) <= UNLINKED_WINDOW_MS && _keyOk(k)) linkedSenders[k] = !!(await _val(db, 'waSenders/' + k));
    }
    for (const [k, g] of Object.entries(groupsSeen)) {
      if (g && !g.ignored && now - (Number(g.lastAt) || 0) <= UNLINKED_WINDOW_MS && _keyOk(k)) linkedGroups[k] = !!(await _val(db, 'waGroups/' + k));
    }
  }
  //  waMeta/agentWatch — מה שהדופק כבר קרא (retried אחרי הניקוי), בלי קריאה שנייה
  const st = opt.watchState || (await _val(db, WATCH)) || {};
  const retried = { ...(st.retried || {}) };
  //  "מוכן" שלא יצא — נאסף כבר? (קריאה אחת להזמנה, רק לשורות כאלה)
  const orderStages = {};
  for (const r of [...Object.values(waOutbox), ...Object.values(emailOutbox)]) {
    const inWin = r && now - (Number(r.createdAt) || 0) <= ROW_WINDOW_MS;   // מחוץ לחלון — לא נבדק, לא נקרא
    const final = inWin && (r.state === 'expired' || (r.state === 'failed' && (Number(r.attempts) || 0) >= WA_MAX_ATTEMPTS));
    const id = final && r.kind === 'ready' ? _list(r.orderIds)[0] : null;
    if (id != null && _keyOk(String(id)) && !(id in orderStages)) orderStages[id] = await _val(db, 'orders/' + id + '/stage');
  }

  const W = require('./_agent-watch');
  const problems = lgGuardProblems({ now, waOutbox, emailOutbox, invoices, invOutbox, waInbound, emailInbound, orders: opt.orders,
    waState, sendersSeen, groupsSeen, linkedSenders, linkedGroups, awaiting, printJobs, retried, orderStages })
    .filter(p => on(p.owner))
    .map(p => (on(p.finder) ? p : { ...p, finder: p.owner }));   // מוצא כבוי → המטפל מוצא לבד
  const byKey = {};
  problems.forEach(p => { byKey[p.key] = p; });
  const prev = {};
  Object.entries(st.problems || {}).forEach(([k, v]) => { if (GUARD_KEY.test(k) && v) prev[k] = v; });
  const setProblem = (k, v) => db.ref(WATCH + '/problems/' + k).set(v);
  const say = (e) => lgRoomSay(db, e, now);
  const used = {};

  //  פעולה / סוף שיחה לבעיה אחת. rec = הרשומה שכבר נכתבה
  async function act(p, rec) {
    const mode = modeOf(p.owner);
    const thread = rec.thread;
    if (p.level === 'info') {
      await say({ thread, from: p.owner, step: 'done', text: p.doneText || 'רק רושם', ref: p.ref });
      return setProblem(p.key, { ...rec, acted: true, resolved: true });
    }
    if (p.level === 'ben') return askBen(p, rec, p.text);
    if (p.level !== 'fix' || !p.fix || rec.asked === true) return null;   // כבר אצל בן — לא שולחים לבד
    if (mode !== 'reply') {
      if (rec.acted === 'would') return null;
      await say({ thread, from: p.owner, step: 'would', text: (WOULD[p.fix.type] || 'הייתי שולח שוב') + ' (מצב שקט)', ref: p.ref });
      return setProblem(p.key, { ...rec, acted: 'would', fixType: p.fix.type });
    }
    //  פעולה אחת לכל ערוץ בכל סבב, ורק כשנשאר זמן
    const ch = p.fix.channel;
    if (used[ch] || late()) return null;
    if ((ch === 'wa' && (waState !== 'authorized' || deadline - Date.now() < WA_MIN_BUDGET_MS))
        || ((ch === 'wa-in' || ch === 'email-in') && deadline - Date.now() < INBOUND_MIN_LEFT_MS)) return null;
    used[ch] = true;
    const resend = RESEND.includes(p.fix.type);
    //  ⚠️ נרשם לפני הפעולה: ריצה שנהרגה באמצע לא תנסה שוב
    if (resend) await db.ref(WATCH + '/retried/' + p.rkey).set({ at: now });
    const base = { ...rec, acted: true, fixType: p.fix.type };
    await setProblem(p.key, base);
    let r;
    try { r = await _perform(db, p, { now, deadline, deps: opt.deps }); }
    catch (e) { console.warn('agent-guards: fix', p.fix.type, e && e.name); r = { out: 'failed', reason: 'שגיאה' }; }
    if (r.out === 'sent') {
      res.fixed++;
      await say({ thread, from: p.owner, step: 'done', text: DONE_TEXT[p.fix.type] || 'שלחתי שוב ✓', ref: p.ref });
      return setProblem(p.key, { ...base, resolved: true });
    }
    if (r.out === 'failed' && resend) {
      return askBen(p, base, 'ניסיתי שוב ולא הצליח' + _paren(null, r.reason) + ' — ' + p.text);
    }
    return null;   // עוד בתור / לא נתפס — הסבב הבא יראה מה קרה
  }

  async function askBen(p, rec, text, o2) {
    if (rec.asked) return null;
    const key = await say({ thread: rec.thread, from: p.owner, step: 'need-ben', text: 'בן, צריך אותך — ' + _s(text, 400), ref: p.ref });
    const next = { ...rec, level: 'ben', asked: !!key, roomKey: key || rec.roomKey };
    await setProblem(p.key, next);
    res.asked++;
    if (key && modeOf(p.owner) === 'reply' && !(o2 && o2.noPing)) {
      try {
        await module.exports._notifyBen(db, { key: p.key, text: _s(text, 400), reason: 'guard', urgent: false, env, now, cfg,
          agent: p.owner, open: WATCH + '/problems/' + p.key, deadline });
      }
      catch (e) { console.warn('agent-guards: notify', e && e.name); }
    }
    return next;
  }

  //  ⚠️ רשומה שכבר עלתה לבן (asked / ask / ben) — לעולם לא שולחים שוב לבד: אולי בן כבר טיפל ביד.
  //  רשומה ישנה של _agent-watch (בלי thread, שאלה צהובה פתוחה) → שיחה חדשה: מוצא + צריך את בן,
  //  והשאלה הישנה נסגרת — כדי שבן לא יראה שתיים. בלי הודעה נוספת לבן (הוא כבר קיבל).
  const escalated = r => !!r && (r.asked === true || r.level === 'ask' || r.level === 'ben');
  const legacy = [];
  for (const [k, r] of Object.entries(prev)) {
    if (!byKey[k] || !escalated(r)) continue;
    if (byKey[k].level === 'fix') byKey[k] = { ...byKey[k], level: 'ben', fix: undefined };
    if (!r.thread && !r.dismissed) legacy.push(k);
  }
  for (let i = 0; i < problems.length; i++) problems[i] = byKey[problems[i].key];
  for (const k of legacy) {
    if (late()) break;
    const p = byKey[k], r = prev[k];
    const thread = k + '_' + now.toString(36);
    const foundKey = await say({ thread, from: p.finder, to: p.owner !== p.finder ? p.owner : undefined, step: 'found', text: _s(p.text, 500), ref: p.ref });
    if (r.roomKey) await lgRoomClose(db, r.roomKey, now, { by: 'stale' });   // רק שאלה פתוחה נסגרת; שורת info לא נוגעים
    const rec = { ...r, level: 'ben', agent: p.owner, finder: p.finder, text: _s(p.text, 300), thread, roomKey: foundKey || null, asked: false, acted: true };
    await setProblem(k, rec);
    await askBen(p, rec, p.text, { noPing: true });
    prev[k] = { ...rec, level: 'ben', asked: true };
  }

  const diff = W.lgWatchDiff(prev, problems);
  const fresh = diff.open.filter(k => !prev[k]).slice(0, OPEN_MAX);
  const upgraded = diff.open.filter(k => prev[k]);

  // ── בעיות חדשות: שיחה לכל סוג (מוצא + קבוצה) ──
  const groups = new Map();
  for (const k of fresh) {
    const p = byKey[k], g = p.finder + '|' + p.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  for (const items of groups.values()) {
    if (late()) break;
    const p0 = items[0];
    const thread = items.length > 1 ? 'grp_' + p0.finder + '_' + p0.group + '_' + now.toString(36) : p0.key + '_' + now.toString(36);
    const owners = [...new Set(items.map(p => p.owner))];
    const text = items.length > 1 ? (GROUP_TEXT[p0.group] || (n => n + ' בעיות'))(items.length) + ': '
      + items.slice(0, 5).map(p => p.text).join(' · ') + (items.length > 5 ? ' …' : '') : p0.text;
    const foundKey = await say({ thread, from: p0.finder, to: owners.length === 1 && owners[0] !== p0.finder ? owners[0] : undefined,
                                 step: 'found', text: _s(text, 500), ref: items.length === 1 ? p0.ref : undefined });
    for (const ow of owners) {
      if (ow === p0.finder) continue;
      const mine = items.filter(p => p.owner === ow).length;
      await say({ thread, from: p0.finder, to: ow, step: 'handoff',
                  text: AGENT_HEB[ow] + ', ' + (items.length === 1 ? 'שלך' : (mine === 1 ? 'אחת שלך' : mine + ' שלך')) });
    }
    for (const p of items) {
      const rec = { level: p.level, agent: p.owner, finder: p.finder, at: now, text: _s(p.text, 300), src: p.src || null,
                    thread, roomKey: foundKey || null, asked: false, acted: false };
      await setProblem(p.key, rec);
      res.found++;
      if (late()) continue;
      await act(p, rec);
    }
  }

  // ── בעיה שעלתה דרגה (למשל נכשלה גם אחרי השליחה החוזרת) — באותה שיחה ──
  for (const k of upgraded) {
    if (late()) break;
    const p = byKey[k], rec = { ...prev[k], level: p.level, text: _s(p.text, 300) };
    if (!rec.thread) rec.thread = k + '_' + now.toString(36);
    await setProblem(k, rec);
    await act(p, rec);
  }

  // ── תיקון שעוד לא נעשה (מצב עבר ל"עונה", ערוץ היה תפוס, תור שעוד מחכה) ──
  for (const p of problems) {
    if (late()) break;
    const rec = prev[p.key];
    if (!rec || rec.dismissed || escalated(rec) || p.level !== 'fix' || !p.fix || upgraded.includes(p.key)) continue;
    const same = rec.fixType === p.fix.type;
    const due = p.fix.type === 'wa-drain' ? !rec.resolved
      : modeOf(p.owner) === 'reply' ? !(rec.acted === true && same) : rec.acted !== 'would';
    //  רשומה מלפני השיחות (deliv_ של _agent-watch) — בלי thread: נפתחת שיחה עכשיו
    if (due) await act(p, { ...rec, level: 'fix', thread: rec.thread || p.key + '_' + now.toString(36) });
  }

  // ── בעיה שנעלמה: נבדק לפי המפתח מה קרה באמת ──
  const watched = k => (/^wao_/.test(k) ? waState === 'authorized' : /^hsi?_/.test(k) ? !!opt.orders : true);
  for (const k of diff.clear) {
    if (late()) break;
    const p = prev[k];
    if (!p || !on(p.agent) || !watched(k)) continue;
    const g = await _gone(db, k, p, now);
    if (g === 'keep') {
      if (now - (Number(p.at) || now) <= KEEP_MS) continue;
      if (p.asked && p.roomKey && !p.dismissed) await lgRoomClose(db, p.roomKey, now, { by: 'stale' });
      await setProblem(k, null);
      continue;
    }
    if (p.asked && p.roomKey && !p.dismissed) await lgRoomClose(db, p.roomKey, now, g === 'fixed' ? undefined : { by: 'stale' });
    if (g === 'fixed' && !p.resolved && !p.dismissed && p.thread) {
      await say({ thread: p.thread, from: p.agent, step: 'done', text: 'נפתר ✓' });
      res.fixed++;
    }
    await setProblem(k, null);
  }
  return res;
}

//  → 'fixed' | 'drop' (המקור נמחק / היום התחלף) | 'keep' (עדיין לא בסדר — רק יצא מהחלון)
async function _gone(db, k, p, now) {
  const src = String((p && p.src) || '');
  if (k.startsWith('unl_')) return 'drop';
  if (!_keyOk(src)) return 'drop';
  const pre = k.slice(0, k.indexOf('_'));
  const path = { wao: 'waOutbox/', emo: 'waMeta/emailOutbox/', deliv: 'invoicePdf/', win: 'waInbound/', ein: 'emailInbound/',
                 hs: 'orders/', hsi: 'orders/', await: 'invoicePdf/', pjob: 'waMeta/printJobs/' }[pre];
  if (!path) return 'drop';
  const r = await _val(db, path + src);
  if (!r) return 'drop';
  if (pre === 'wao' || pre === 'emo') return r.state === 'sent' ? 'fixed' : 'keep';
  //  'queued' עוד לא אומר שהלקוח קיבל — רק 'sent'
  if (pre === 'deliv') return r.delivery && r.delivery.state === 'sent' ? 'fixed' : 'keep';
  if (pre === 'win' || pre === 'ein') return ['done', 'closed'].includes(r.state) ? 'fixed' : 'keep';
  if (pre === 'hs') return r.hashavshevet && r.hashavshevet.httpOk ? 'fixed' : 'keep';
  if (pre === 'hsi') return r.hashavshevetInvoice && r.hashavshevetInvoice.httpOk ? 'fixed' : 'keep';
  if (pre === 'await') return r.state !== 'awaiting' ? 'fixed' : 'keep';
  if (pre === 'pjob') return r.state === 'printed' ? 'fixed' : 'keep';
  return 'keep';
}

//  הודעה לבן — דרך lgBenNotify (_agent-ben.js): אחת למפתח, תזכורת אחת אחרי 3 שעות, לא בלילה, עד 20 ביום.
//  'guard' → agent-guard. נשאר module.exports._notifyBen כדי שהבדיקות יוכלו להחליף.
async function _notifyBen(db, a) {
  return require('./_agent-ben').lgBenNotify(db, { ...(a || {}), reason: 'agent-guard' });
}

module.exports = { lgGuardProblems, lgGuardResendOk, lgGuardRun, GUARD_KEY, CLEAR_KINDS, _notifyBen, _reason };
