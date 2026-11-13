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
//  • פער → שורה אחת בחדר למחירון, פעם אחת להזמנה (עד 5 שורות שגויות בה).
//  • שחרור "הכל כבוי" (11/11): בלי waMeta/agentConfig או מחירון כבוי → לא רץ בכלל.
// ═══════════════════════════════════════════════════════════════════

const EPS = 0.005;
const MAX_LINES = 5;
const CHECKED_PATH = 'waMeta/agentPriceChecked/';   // שורה אחת לכל הזמנה (שליחה חוזרת לא מוסיפה)

//  המחירון של הלקוח — **אותה דרך שהשליחה תמחרה** (clientPricesByName ב-hashavshevet-order.js):
//  prices/clients/<מפתח> → שם דרך prices/clientKeys → לפי orderClient של ההזמנה.
//  השם לא ממופה → השליחה לקחה מחירון כללי → אין "צפוי" (סקירת שחרור 11/11: לא לסמן כל שורה).
//  ⚠️ אם clientPricesByName משתנה — גם כאן.
function lgPriceClientList(prices, orderClient) {
  const keyMap = (prices && prices.clientKeys) || {};
  const name = String(orderClient || '');
  let out = null;
  for (const [key, list] of Object.entries((prices && prices.clients) || {})) {
    if ((keyMap[key] || key) === name) out = list || {};
  }
  return out;
}
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
    //  שחרור "הכל כבוי" (11/11): רק עם הגדרות במסך והמחירון לא כבוי (כולל המתג העליון)
    const C = require('./_agent-config');
    const cfg = await C.lgAgentConfig(db);
    if (!cfg || C.lgAgentModeOf(cfg, 'price', x.env || process.env) === 'off') return { checked: false, mismatches: 0 };
    //  הזמנה ידנית על כרטיס מזדמן: המחירון לפי שם הכרטיס (priceClient), לא שם הלקוח הפרטי.
    //  אותו כלל כמו lgPriceClientName (hashavshevet-order.js / firebase-db.js) — אם אחד משתנה, גם זה.
    const list = lgPriceClientList(x.prices, order.priceClient || order.orderClient);
    if (!list || typeof list !== 'object' || !Object.keys(list).length) return { checked: false, mismatches: 0 };
    const mm = lgPriceCheckLines({ preview: x.preview, clientList: list, frozen: order.frozenPrices });
    const oid = String(x.orderId || '');
    if (mm.length && oid && !/[.#$[\]/]/.test(oid)) {
      const t = Number(x.now) || Date.now();
      const cl = await db.ref(CHECKED_PATH + oid).transaction(cur => (cur ? undefined : t));
      if (!cl.committed) return { checked: true, mismatches: mm.length };
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

module.exports = { lgPriceCheckLines, lgPriceCheckRun, lgPriceClientList };
