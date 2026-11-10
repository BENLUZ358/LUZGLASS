'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-price-check.js — מחירון: בדיקת מחיר אחרי שליחה לחשבשבת
//  (שיפור 5, חדר הסוכנים, 11/11).
//
//  עוזר משותף, לא route. נקרא מ-api/hashavshevet-order.js אחרי שליחה אמיתית
//  שהתקבלה (לא dryRun, לא הזמנת בדיקה). קריאה בלבד — לא משנה הזמנה, מחיר או מסמך.
//
//  מקור האמת: prices/clients/<מפתח החשבון בחשבשבת> — המחירון שבן עורך באדמין
//  (הצומת שהשליחה עצמה קוראת דרך clientPricesByName לפי שם הלקוח). המחיר שנשלח —
//  ppm2 של כל שורה ב-preview (אותו ערך שנכתב ל-price בשורה).
//  • רק מק"ט שקיים במחירון של הלקוח נבדק (אין בו → אין "צפוי"). לקוח בלי מחירון — לא נבדק.
//  • frozenPrices על ההזמנה (מחיר שהוקפא כשבן שינה מחירון אחריה) — מכוון, לא פער.
//  • פער → שורה אחת בחדר למחירון (lgAgentEvent: כבוי → כלום; בלי הגדרות → אפור).
// ═══════════════════════════════════════════════════════════════════

const EPS = 0.005;
const MAX_LINES = 6;
const _pos = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : 0; };

//  → [{ hsLine, sku, name, expected, sent }]
function lgPriceCheckLines({ preview, clientList, frozen } = {}) {
  const list = clientList && typeof clientList === 'object' ? clientList : null;
  if (!list) return [];
  const fz = frozen || {};
  const out = [];
  for (const p of Array.isArray(preview) ? preview : []) {
    if (!p || !p.sku) continue;
    const expected = _pos(list[p.sku]);
    if (!expected) continue;
    const sent = Number(p.ppm2) || 0;
    if (Math.abs(sent - expected) <= EPS) continue;
    if (_pos(fz[p.sku]) && Math.abs(sent - _pos(fz[p.sku])) <= EPS) continue;
    out.push({ hsLine: Number(p.hsLine) || 0, sku: String(p.sku), name: String(p.name || ''), expected, sent: Math.round(sent * 1000) / 1000 });
  }
  return out;
}

const _orderLabel = o => 'הזמנה ' + String(o.orderNum || o.refNum || '') + (o.sketchName ? ' (' + String(o.sketchName).slice(0, 60) + ')' : '')
  + (o.orderClient || o.businessName ? ' של ' + String(o.orderClient || o.businessName).slice(0, 60) : '');

//  { checked, mismatches }. לא זורק.
async function lgPriceCheckRun(db, p) {
  const x = p || {};
  try {
    const order = x.order || {};
    if (order.isTest === true) return { checked: false, mismatches: 0 };
    const list = ((x.prices && x.prices.clients) || {})[String(x.accountKey || '')];
    if (!list || typeof list !== 'object' || !Object.keys(list).length) return { checked: false, mismatches: 0 };
    const mm = lgPriceCheckLines({ preview: x.preview, clientList: list, frozen: order.frozenPrices });
    if (mm.length) {
      const parts = mm.slice(0, MAX_LINES).map(m => 'שורה ' + m.hsLine + ' ' + m.name + ' (' + m.sku + ') — נשלח ' + m.sent + ', במחירון ' + m.expected);
      const text = _orderLabel(order) + ' נשלחה לחשבשבת במחיר שונה מהמחירון: ' + parts.join('; ')
        + (mm.length > MAX_LINES ? '; ועוד ' + (mm.length - MAX_LINES) + ' שורות' : '');
      await require('./_agent-watch').lgAgentEvent(db, 'price', { kind: 'info', text, ref: { orderId: String(x.orderId || '') } },
        { env: x.env || process.env, now: x.now });
    }
    return { checked: true, mismatches: mm.length };
  } catch (e) {
    console.warn('price-check:', e && e.name);
    return { checked: false, mismatches: 0 };
  }
}

module.exports = { lgPriceCheckLines, lgPriceCheckRun };
