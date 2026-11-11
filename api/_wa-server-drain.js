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
//  ⚠️ הבקשה כולה < 60ש׳: תקציב 18ש׳ כאן, ו-45ש׳ ברירת המחדל לא חלה.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const GATE = 'waMeta/serverDrain/lastRun';
const GATE_GAP_MS = 55 * 1000;
const DEFAULT_BUDGET_MS = 18 * 1000;

//  o: { env, now, budgetMs?, drain?(db, keys, by, {budgetMs}) }
//  → { ok, skipped?: 'off'|'throttled'|'empty'|'disconnected', processed }
async function lgWaServerDrain(db, o) {
  const opt = o || {};
  const env = opt.env || process.env;
  if (env.WA_SERVER_DRAIN !== 'true') return { ok: true, skipped: 'off', processed: 0 };
  const now = Number(opt.now) || Date.now();

  const g = await db.ref(GATE).transaction(cur => (cur != null && Math.abs(now - Number(cur)) < GATE_GAP_MS ? undefined : now));
  if (!g.committed) return { ok: true, skipped: 'throttled', processed: 0 };

  const { lgWaPending } = require('./_wa-outbox');
  const keys = await lgWaPending(db, 20);
  if (!keys.length) return { ok: true, skipped: 'empty', processed: 0 };

  const drain = opt.drain || require('./_wa-drain-core').drainNow;
  const budgetMs = opt.budgetMs > 0 ? opt.budgetMs : DEFAULT_BUDGET_MS;
  const r = await drain(db, keys, 'server', { budgetMs });
  //  state מלא = לא מחובר / לא מוגדר / ניתוק באמצע — ההודעות נשארות ממתינות
  if (r && r.state) return { ok: true, skipped: 'disconnected', processed: r.processed || 0 };
  return { ok: true, processed: (r && r.processed) || 0 };
}

module.exports = { lgWaServerDrain, GATE, GATE_GAP_MS };
