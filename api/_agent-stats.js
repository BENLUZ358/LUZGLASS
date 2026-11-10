'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-stats.js — עוקב: כמה זמן לוקח כל שלב (שיפורים 2+3, חדר הסוכנים, 11/11).
//
//  עוזר משותף, לא route. טהור — בלי DB. הריצה האיטית של הדופק (_agent-watch,
//  פעם ב-10 דק') קוראת את orders, מחשבת כאן, שומרת waMeta/agentStats/stageDays
//  _agent-act קורא את הערך השמור לתשובת "מתי יהיה מוכן".
//
//  ⚠️ מקורות הזמן — מה שבאמת נשמר על ההזמנה (אין היסטוריית שלבים):
//     createdAt  — נכנסה לתור (שלב ''/pending)
//     optyAt     — נכנסה ל-OptyWay (updateStage, firebase-db.js)
//     readyAt    — "מוכן לאיסוף" (lgLockAndAdvance → done)
//     deliveryAt — יצאה להובלה (lgLockAndAdvance → delivery)
//     ל-chash / drafter / workday / chisum / graphic אין חותמת כניסה — ולכן שני "שלבים":
//       pre  = '' / pending / chash / drafter      מ-createdAt עד optyAt
//       prod = opty / workday / chisum / graphic   מ-optyAt עד מוכן (readyAt או deliveryAt, המוקדם)
//     updatedAt לא משמש — כל עריכה מזיזה אותו.
//  דגימות — 60 יום אחרונים לפי רגע היציאה מהשלב (optyAt ל-pre, מוכן ל-prod / "עד מוכן").
//  בלי הזמנות בדיקה (isTest), דוגמאות (isSample) והזמנות שהסוכן ביטל.
// ═══════════════════════════════════════════════════════════════════

const DAY = 24 * 3600 * 1000;
const STATS_WINDOW_DAYS = 60;
const STATS_MIN_SAMPLES = 10;
const AGENT_STATS = 'waMeta/agentStats/stageDays';
const LG_STAGE_PHASE = { '': 'pre', pending: 'pre', chash: 'pre', drafter: 'pre',
                         opty: 'prod', workday: 'prod', chisum: 'prod', graphic: 'prod' };

const _n = v => (Number(v) > 0 ? Number(v) : 0);
const _readyAt = o => Math.min(...[_n(o.readyAt), _n(o.deliveryAt)].filter(Boolean), Infinity);
const _skip = o => !o || typeof o !== 'object' || o.isTest === true || o.isSample === true || !!o.agentCancelled;
const _median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const _sum = a => ({ n: a.length, days: Math.round(_median(a) / DAY * 10) / 10 });
const _phaseOf = o => (Object.prototype.hasOwnProperty.call(LG_STAGE_PHASE, String((o && o.stage) || '')) ? LG_STAGE_PHASE[String(o.stage || '')] : '');
const _anchor = (o, phase) => (phase === 'pre' ? _n(o.createdAt) : phase === 'prod' ? _n(o.optyAt) : 0);

//  orders: { id: order } → { at, windowDays, phases: { pre|prod: { inStage:{n,days}, remain:{n,days} } } }
function lgStageStats(orders, now) {
  const from = Number(now) - STATS_WINDOW_DAYS * DAY;
  const inWin = t => t && t >= from && t <= Number(now);
  const a = { preIn: [], preRemain: [], prodIn: [] };
  for (const o of Object.values(orders || {})) {
    if (_skip(o)) continue;
    const c = _n(o.createdAt), op = _n(o.optyAt), rd = _readyAt(o);
    const ready = Number.isFinite(rd) ? rd : 0;
    if (c && op >= c && inWin(op)) a.preIn.push(op - c);
    if (c && ready >= c && inWin(ready)) a.preRemain.push(ready - c);
    if (op && ready >= op && inWin(ready)) a.prodIn.push(ready - op);
  }
  const prod = _sum(a.prodIn);
  return { at: Number(now), windowDays: STATS_WINDOW_DAYS,
           phases: { pre: { inStage: _sum(a.preIn), remain: _sum(a.preRemain) }, prod: { inStage: prod, remain: prod } } };
}

//  ימים שנשארו (שלם, כלפי מעלה) או 0 = לא אומרים כלום (פחות מ-10 דגימות / כבר עבר את הרגיל / לא בשלב)
function lgOkevEta(order, stats, now) {
  const phase = _phaseOf(order);
  const s = phase && stats && stats.phases && stats.phases[phase] && stats.phases[phase].remain;
  if (!s || !(Number(s.n) >= STATS_MIN_SAMPLES) || !(Number(s.days) > 0)) return 0;
  const anchor = _anchor(order, phase);
  if (!anchor) return 0;
  const left = Math.ceil(Number(s.days) - (Number(now) - anchor) / DAY);
  return left >= 1 ? left : 0;
}
const lgOkevEtaText = n => 'בדרך כלל זה לוקח עוד בערך ' + (Number(n) === 1 ? 'יום' : n + ' ימים');

module.exports = { AGENT_STATS, LG_STAGE_PHASE, STATS_MIN_SAMPLES, STATS_WINDOW_DAYS,
                   lgStageStats, lgOkevEta, lgOkevEtaText, };
