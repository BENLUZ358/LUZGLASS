'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_workday-remind.js — תזכורת "סיים יום עבודה" בוואטסאפ לבן ולשאול (בן, 14/11).
//
//  בן שוכח לפעמים ללחוץ "סיים יום עבודה" — ואז הסחורה המוכנה נשארת "בעבודה"
//  והלקוחות לא מקבלים "מוכן". כאן: א׳–ה׳ מ-17:00 (שעון ישראל), אם יש הזמנות
//  ב-workday/inWork — הודעה אחת ביום לבן ולשאול.
//
//  עוזר, לא route. נקרא מ-email-inbound (outbox-claim — סקריפט המייל קורא כל דקה),
//  ברקע. לא תלוי במתגים של הסוכנים. כיבוי: WORKDAY_REMIND_ENABLED=false.
//  נמענים: WORKDAY_REMIND_TO (מקומי, מופרד בפסיקים), אחרת בן + שאול.
//
//  רשומה: waMeta/workdayRemind = { day:'yyyy-mm-dd', at, tries, sent, sentAt?, sentTo?, count? }
//    • ניסיון נתפס בטרנזקציה — שתי קריאות באותה דקה לא שולחות פעמיים.
//    • נכשל (וואטסאפ לא מחובר / שליחה נכשלה) → ניסיון נוסף אחרי 2 דק', עד 5 ביום.
//  עלות לכל קריאה לפני 17:00 / בסופ"ש: אפס קריאות. אחרי שנשלח: קריאה אחת קטנה.
//  ⚠️ טקסט קבוע בלבד — בלי שמות לקוחות.
//  הבאנר בדף הראשי והחלון ב"הורד לעבודה" — workday-remind.js (בדפדפן).
// ═══════════════════════════════════════════════════════════════════

const REMIND = 'waMeta/workdayRemind';
const WA_STATE = 'waMeta/whatsapp/state';
const TO_DEFAULT = ['0547725552', '0506824365'];      // בן, שאול
const HOUR = 17;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
const RETRY_MS = 2 * 60 * 1000;
const MAX_TRIES = 5;
const GAP_MS = 3000;                                    // בין שתי ההודעות — לא "דיוור"

//  שעון ישראל: { iso:'yyyy-mm-dd', weekday:'Sun'…, hour }
function _il(now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { iso: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hour: Number(p.hour) };
}

function _inTime(now) { const t = _il(now); return DAYS.includes(t.weekday) && t.hour >= HOUR; }
//  בדיקה זולה לפני שמפעילים עבודת רקע: המתג + השעה
function lgWorkdayRemindWanted(env, now) {
  return String((env || {}).WORKDAY_REMIND_ENABLED || '').trim() !== 'false' && _inTime(Number(now) || Date.now());
}

//  המזהים ב-inWork (Firebase מחזיר מערך או אובייקט)
function lgWorkdayIds(inWork) {
  if (!inWork || typeof inWork !== 'object') return [];
  return [...new Set(Object.values(inWork).filter(v => v != null && v !== '').map(String))];
}
//  כמו הסינון ב-workday.html: הזמנה שכבר עברה שלב (מוכן / גרפיקה / הובלות) — לא בעבודה.
//  inWork נשמר רק כשהדף פתוח, ולכן יכול להכיל הזמנות שכבר זזו ממקום אחר.
const WORK_STAGES = ['opty', 'workday', 'chisum'];
const MAX_IDS = 80;
async function lgWorkdayLiveCount(db, inWork) {
  const ids = lgWorkdayIds(inWork).filter(id => /^[^.#$[\]/]+$/.test(id)).slice(0, MAX_IDS);
  const st = await Promise.all(ids.map(id => db.ref('orders/' + id + '/stage').once('value').then(x => x.val(), () => null)));
  return st.filter(v => WORK_STAGES.includes(String(v || ''))).length;
}

//  טהור: האם לנסות לשלוח עכשיו
function lgWorkdayRemindDue({ now, count, state }) {
  if (!_inTime(now) || !(count > 0)) return false;
  const s = state || {}, day = _il(now).iso;
  if (s.day !== day) return true;
  if (s.sent || (s.tries || 0) >= MAX_TRIES) return false;
  return now - (Number(s.at) || 0) >= RETRY_MS;
}

function lgWorkdayRemindText(count) {
  const n = count === 1 ? 'יש הזמנה אחת בעבודה' : 'יש ' + count + ' הזמנות בעבודה';
  return '⏰ תזכורת: עוד לא נלחץ "סיים יום עבודה" היום.\n' + n + ', והלקוחות עוד לא קיבלו הודעת "מוכן".';
}

function _to(env) {
  const { lgWaSenderKey } = require('./_wa-recipient');
  const raw = String((env && env.WORKDAY_REMIND_TO) || '').trim();
  const list = (raw ? raw.split(',') : TO_DEFAULT).map(s => lgWaSenderKey(s.trim())).filter(p => /^05\d{8}$/.test(p));
  return [...new Set(list)];
}

//  o: { now?, env?, provider?, gapMs? } → { sent, count } או { skip }
async function lgWorkdayRemindRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (String(env.WORKDAY_REMIND_ENABLED || '').trim() === 'false') return { skip: 'off' };
  if (!_inTime(now)) return { skip: 'time' };
  const day = _il(now).iso;
  const state = (await db.ref(REMIND).once('value')).val();
  if (state && state.day === day && (state.sent || (state.tries || 0) >= MAX_TRIES)) return { skip: 'done-today' };
  const count = await lgWorkdayLiveCount(db, (await db.ref('workday/inWork').once('value')).val());
  if (!lgWorkdayRemindDue({ now, count, state })) return { skip: count ? 'wait' : 'empty' };
  const wa = (await db.ref(WA_STATE).once('value')).val();
  if (wa !== 'authorized') return { skip: 'wa-down' };
  const p = opt.provider || require('./_wa-provider').lgWaProvider();
  if (!p || !p.configured || typeof p.sendText !== 'function') return { skip: 'no-provider' };
  const to = _to(env);
  if (!to.length) return { skip: 'no-recipient' };

  const r = await db.ref(REMIND).transaction(cur => {
    if (!lgWorkdayRemindDue({ now, count, state: cur })) return;     // abort — מישהו אחר כבר ניסה
    const tries = cur && cur.day === day ? (Number(cur.tries) || 0) + 1 : 1;
    return { day, at: now, tries, sent: false };
  });
  if (!r.committed) return { skip: 'claimed' };

  const text = lgWorkdayRemindText(count);
  let sentTo = 0;
  for (let i = 0; i < to.length; i++) {
    if (i) await new Promise(res => setTimeout(res, opt.gapMs != null ? Number(opt.gapMs) : GAP_MS));
    const g = typeof p.gate === 'function' ? p.gate({ phone: to[i], accountKey: 'staff', linked: true }) : { allowed: true };
    if (!g || !g.allowed) continue;
    let out;
    try { out = await p.sendText({ to: to[i], text }); } catch (e) { out = { ok: false }; console.warn('workday-remind: send', e && e.name); }
    if (out && out.ok) sentTo++;
  }
  if (sentTo) await db.ref(REMIND).update({ sent: true, sentAt: Date.now(), sentTo, count });
  return { sent: sentTo, count };
}

module.exports = { lgWorkdayRemindWanted, REMIND, HOUR, MAX_TRIES, RETRY_MS, lgWorkdayIds, lgWorkdayLiveCount, lgWorkdayRemindDue, lgWorkdayRemindText, lgWorkdayRemindRun };
