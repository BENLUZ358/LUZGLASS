// ═══════════════════════════════════════════════════════════════════
//  api/_wa-server-drain.js — שליחת תור הוואטסאפ מהשרת, בכל דופק.
//
//  עד היום waOutbox יצא רק כשדף אדמין פתוח (whatsapp-drain) או מ-drainNow של
//  חשבונית / רשת "מוכן". הודעה שנתקעה בלילה או כשאין דף פתוח חיכתה. הדופק
//  מהמחשב במשרד מגיע כל ~דקה — הוא מריץ גם את זה, ראשון.
//
//  ⚠️ מתג WA_SERVER_DRAIN==='true', ברירת מחדל כבוי, בלי קשר למתגי הסוכנים.
//  ⚠️ אין כאן מנגנון נגד שליחה כפולה משלו: lgWaClaim (טרנזקציה) הוא זה. דף פתוח,
//     _ready-net והשרת על אותה שורה → בדיוק שליחה אחת, השאר מדלגים.
//  ⚠️ מנותק → לא נוגעים בכלום (drainNow בודק חיבור לפני תפיסה).
//  ⚠️ הבקשה כולה < 60ש׳: תקציב 18ש׳ כאן במקום BUDGET_MS (45ש׳) של _wa-drain-core; drainKeys לא מתחיל
//     סבב שהמתנה לחלון + שליחה בגרוע ביותר (15ש׳) חורגים ממנו, ו-drainNow סופר מלפני בדיקת החיבור.
//  ⚠️ מצב החיבור (waMeta/whatsapp.checkedAt) — התראת "וואטסאפ מנותק" (_agent-ben) סומכת רק על מצב
//     שנבדק ב-30 הדק' האחרונות. לכן גם כשהתור ריק בודקים ורושמים מצב, לכל היותר פעם ב-10 דק'
//     (שער טרנזקציה STATE_GATE), וכשהתור לא ריק ונמצא מנותק — רושמים את מה שנמצא (תיקון סקירה סופית I1).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const GATE = 'waMeta/serverDrain/lastRun';
const GATE_GAP_MS = 55 * 1000;
const DEFAULT_BUDGET_MS = 18 * 1000;
const STATE_GATE = 'waMeta/serverDrain/lastState';
const STATE_GAP_MS = 10 * 60 * 1000;

//  שער הרישום — לכל היותר פעם ב-10 דק' (טרנזקציה)
async function _stateGate(db, now) {
  const g = await db.ref(STATE_GATE).transaction(cur => (cur != null && Math.abs(now - Number(cur)) < STATE_GAP_MS ? undefined : now));
  return g.committed;
}
const _record = (db, o, st) => (o.recordState || require('./_wa-drain-core').recordState)(db, st);

//  תור ריק: בדיקת חיבור + רישום, לכל היותר פעם ב-10 דק'. o: { now, provider?, recordState? } → state | null
async function _refreshState(db, o) {
  const provider = o.provider || require('./_wa-provider').lgWaProvider();
  if (!provider || !provider.configured || typeof provider.getState !== 'function') return null;
  if (!(await _stateGate(db, o.now))) return null;
  const st = await provider.getState();
  await _record(db, o, { state: st && st.state, reason: (st && st.reason) || '', pending: 0 });
  return (st && st.state) || null;
}

//  o: { env, now, budgetMs?, drain?(db, keys, by, {budgetMs}), provider?, recordState? }
//  → { ok, skipped?: 'off'|'throttled'|'empty'|'disconnected'|'not-configured', processed, state? }
async function lgWaServerDrain(db, o) {
  const opt = o || {};
  const env = opt.env || process.env;
  if (env.WA_SERVER_DRAIN !== 'true') return { ok: true, skipped: 'off', processed: 0 };
  const now = Number(opt.now) || Date.now();

  const g = await db.ref(GATE).transaction(cur => (cur != null && Math.abs(now - Number(cur)) < GATE_GAP_MS ? undefined : now));
  if (!g.committed) return { ok: true, skipped: 'throttled', processed: 0 };

  const { lgWaPending } = require('./_wa-outbox');
  const keys = await lgWaPending(db, 20);
  if (!keys.length) {
    let state = null;
    try { state = await _refreshState(db, { now, provider: opt.provider, recordState: opt.recordState }); }
    catch (e) { console.warn('wa-server-drain: state', e && e.name); }
    return state ? { ok: true, skipped: 'empty', processed: 0, state } : { ok: true, skipped: 'empty', processed: 0 };
  }

  const drain = opt.drain || require('./_wa-drain-core').drainNow;
  const budgetMs = opt.budgetMs > 0 ? opt.budgetMs : DEFAULT_BUDGET_MS;
  const r = await drain(db, keys, 'server', { budgetMs });
  //  state מלא = לא מחובר / לא מוגדר / ניתוק באמצע — ההודעות נשארות ממתינות
  if (r && r.state === 'not-configured') return { ok: true, skipped: 'not-configured', processed: 0 };
  try {
    if (r && r.state) {
      //  drainNow בדק לפני הסבב ולא רושם בעצמו — רושמים כל פעם (בשביל ההתראה).
      //  ניתוק באמצע סבב (יש תוצאות) כבר נרשם ב-drainKeys.
      if (!(r.results && r.results.length)) await _record(db, opt, { state: r.state, reason: '', pending: keys.length });
    } else if (await _stateGate(db, now)) {
      //  מחובר (drainNow בדק) — רישום "מחובר" לכל היותר פעם ב-10 דק'
      await _record(db, opt, { state: 'authorized', reason: '', pending: Math.max(0, keys.length - ((r && r.processed) || 0)) });
    }
  } catch (e) { console.warn('wa-server-drain: state', e && e.name); }
  if (r && r.state) return { ok: true, skipped: 'disconnected', processed: r.processed || 0 };
  return { ok: true, processed: (r && r.processed) || 0 };
}

module.exports = { lgWaServerDrain, GATE, GATE_GAP_MS, STATE_GATE, STATE_GAP_MS };
