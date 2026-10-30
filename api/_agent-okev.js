// ═══════════════════════════════════════════════════════════════════
//  api/_agent-okev.js — עוקב: מציאת הזמנה ונוסח תשובה ללקוח.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  טהור: בלי DB ובלי שליחה. מקבל רשימת הזמנות של הלקוח ומחזיר החלטה / טקסט.
//  בשלב הצללית (shadow) שום דבר מכאן לא יוצא ללקוח.
// ═══════════════════════════════════════════════════════════════════

// stage → מה אומרים ללקוח
const OKEV_STATUS_TEXT = {
  '': 'קיבלנו, ההזמנה בבדיקה',
  pending: 'קיבלנו, ההזמנה בבדיקה',
  chash: 'ההזמנה בהכנה',
  drafter: 'ההזמנה בהכנה',
  opty: 'ההזמנה בהכנה',
  workday: 'ההזמנה בייצור',
  chisum: 'ההזמנה בחיסום',
  graphic: 'ההזמנה בגרפיקה',
  delivery: 'מוכן, יוצא אליך במשלוח',
  done: 'מוכן, אפשר לבוא לאסוף',
  collected: 'ההזמנה כבר נאספה',
};

const AGENT_MENU_TEXT = [
  "הצ'אט הזה מיועד לעבודה בלבד. אפשר:",
  '1. לבדוק איפה הזמנה',
  '2. לבטל או לשנות הזמנה',
  '3. לקבל חשבונית או סקיצה',
  '4. לקבל הצעת מחיר',
  '5. לשלוח הזמנה חדשה',
  'לכל דבר אחר: שאול, 050-6824365',
].join('\n');

// ביטול/שינוי מותר רק לפני שההזמנה נכנסה לייצור
const CHANGEABLE = ['', 'pending', 'chash', 'drafter', 'opty'];
function lgOkevCanChange(order) {
  return CHANGEABLE.includes(String((order && order.stage) || ''));
}

// הזמנה "פתוחה": לא נאספה ולא בוטלה על ידי הסוכן
const isOpen = o => o.stage !== 'collected' && !o.agentCancelled;

// ── נרמול הפניה: רווחים, גרש/גרשיים, אותיות קטנות ──
const normRef = s => String(s == null ? '' : s).toLowerCase().replace(/[\s'"`׳״‘’“”]/g, '');
// מספר הזמנה → ספרות בלבד אם זה L+ספרות או ספרות; אחרת ''
const digitsOf = s => { const m = normRef(s).replace(/^l/, ''); return /^\d+$/.test(m) ? m : ''; };

// ⚠️ מספר: התאמה מדויקת בספרות (123 לא מתאים ל-1234).
//    טקסט: שם הסקיצה, equal או includes, ורק מ-2 תווים ומעלה.
function refMatches(order, ref) {
  const n = normRef(ref);
  if (!n) return false;
  const d = digitsOf(ref);
  if (d) return digitsOf(order.orderNum) === d || digitsOf(order.refNum) === d;
  if (n.length < 2) return false;
  const sk = normRef(order.sketchName);
  return !!sk && (sk === n || sk.includes(n));
}

const verdict = (orders, via) => ({ match: orders.length === 1 ? 'one' : orders.length ? 'many' : 'none', orders, via: orders.length ? via : '' });

// quoted גובר על ref, ref גובר על "הפתוחה היחידה"
function lgOkevFind(orders, q) {
  orders = orders || []; q = q || {};
  if (q.quotedId) {
    // התאמה לפי ההודעה שהלקוח ציטט — בלי קשר לשלב או לפתיחות
    return verdict(orders.filter(o => o.waMessageId === q.quotedId), 'quoted');
  }
  if (normRef(q.ref)) {
    // קודם בין הפתוחות; אם אין, גם הזמנה שכבר נאספה (כדי לענות "כבר נאספה")
    const alive = orders.filter(o => !o.agentCancelled);
    let hit = alive.filter(o => isOpen(o) && refMatches(o, q.ref));
    if (!hit.length) hit = alive.filter(o => refMatches(o, q.ref));
    return verdict(hit, 'ref');
  }
  return verdict(orders.filter(isOpen), 'open');
}

const label = o => 'הזמנה ' + (o.orderNum || o.refNum || '') + (o.sketchName ? ' (סקיצה: ' + o.sketchName + ')' : '');
const NOT_FOUND = 'לא מצאתי את ההזמנה. אפשר לכתוב את שם הסקיצה?';

function lgOkevReply(intent, found) {
  if (!found || found.match === 'none') return NOT_FOUND;
  if (found.match === 'many') {
    return 'על איזו הזמנה מדובר?\n' + found.orders.map((o, i) =>
      (i + 1) + '. ' + (o.orderNum || o.refNum || '') + (o.sketchName ? ' — ' + o.sketchName : '')).join('\n');
  }
  const o = found.orders[0];
  if (intent === 'status') {
    const st = String(o.stage || '');
    return label(o) + ': ' + (OKEV_STATUS_TEXT[st] || OKEV_STATUS_TEXT['']);
  }
  if (!lgOkevCanChange(o)) return 'הזמנה ' + (o.orderNum || o.refNum || '') + ' כבר בייצור ואי אפשר לבטל או לשנות אותה';
  if (intent === 'cancel') return 'בטוח לבטל את ' + label(o) + '?';
  if (intent === 'change') return 'מה בדיוק לשנות ב' + label(o) + '?';
  return NOT_FOUND;
}

// ── ניתוב לפי כוונה. לא מקושר → שאול; אדם עונה עכשיו → שקט ──
function lgOkevRoute(p) {
  const { intent, isGroup, linked, humanQuiet } = p || {};
  if (!linked) return 'shaul';
  if (humanQuiet) return 'silent-human';
  switch (intent) {
    case 'status': case 'cancel': case 'change': return 'okev';
    case 'order': return 'kolet';
    case 'document': return 'archive';
    case 'quote': return 'quote';
    case 'chitchat': return isGroup ? 'ignore' : 'menu';
    case 'thanks': return 'none';
    default: return 'shaul';
  }
}

module.exports = { OKEV_STATUS_TEXT, AGENT_MENU_TEXT, lgOkevCanChange, lgOkevFind, lgOkevReply, lgOkevRoute };
