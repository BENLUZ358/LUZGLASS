// ═════════════════════════════════════════════════════════════════════
//  _wa-free-text.js — הזמנה מהודעת טקסט חופשית בוואטסאפ (בן, 26/10/2026)
//
//  לקוחות שבן מגדיר כותבים חופשי: "מה קורה אחי תכין לי מראה 5 מ״מ 89 על 123",
//  "אני צריך מראה 50*89", "מראה 5 76 54 X2". הכללים שבן קבע:
//    • "מראה" בלי פירוט = מראה 5 מלוטש. אחרת — לפי מה שכתוב.
//    • אין כמות = 1. "X2" / "x 3" בסוף השורה, או "2 יח'", זו כמות.
//    • שני מספרים = רוחב × גובה, בס"מ (×10 למ"מ), בסדר שנכתבו.
//    • העובי ("מראה 5", "5 מ"מ") אינו מידה.
//  שורה שלא ברור מה היא — לא נוצר ממנה פריט; היא חוזרת ב-unparsed, ובן רואה
//  אותה בהערות ובתמונת ההודעה. מק"ט נבחר מהקטלוג רק כשבדיוק אחד מתאים.
//
//  טהור — בלי Firebase ובלי רשת. נבדק ב-scripts/test-wa-free-text.js.
//  Spec: docs/superpowers/specs/2026-10-26-wa-free-text-orders-design.md
// ═════════════════════════════════════════════════════════════════════

const { _norm } = require('./_wa-text-order');

const MAX_CM = 400;                         // מעל 4 מטר — כנראה נכתב במ"מ; לא מנחשים
const MIN_CM = 10;                          // מתחת ל-10 ס"מ — כנראה מטרים או שעה; לא מנחשים
const MAX_QTY = 50;
const THICK = [3, 4, 5, 6, 8, 10, 12];
const MIRROR = /מרא(?:ה|ות)/;
const GLASS_COLORS = ['שקוף', 'קליר', 'חלבי', 'אסיד', 'ברונזה', 'אפור'];
// מילה שלמה, עם תחילית אחת לכל היותר — "משקוף" (מסגרת דלת) אינו זכוכית
const GLASS_WORD = /(?<![א-ת])[והבל]?(?:זכוכית|זכוכיות|שקוף|שקופה|שקופות|קליר|חלבי|חלבית|אסיד)(?![א-ת])/;
const CUT_WORD = /(?<![א-ת])[וה]?(?:חתוך|חתוכה|חתוכות|חתוכים)(?![א-ת])/;   // לא "חתונה", לא "תחתון"
// מחיר, מלאי, ביטול, איסוף או הזמנה קיימת — שיחה על הזמנה, לא הזמנה חדשה (סקירה, 26/10).
// סימן שאלה לבד לא חוסם: "תוכל להכין לי מראה 80 על 120?" היא הזמנה (בן, 26/10).
const NOT_ORDER = /כמה עולה|מחיר|במלאי|בוטל|לבטל|ביטול|הזמנתי|מוכנה|מוכן|לקחת|לאסוף|איסוף/;
// "מראה 2 על 3" = מטרים (בן, 26/10): המילה מטר, או שתי מידות עד 4
const MAX_M = 4;
const NUM = /\d+(?:\.\d+)?/g;
const UNIT_MM = /(\d+(?:\.\d+)?)\s*מ["']{0,2}מ(?![א-ת])/;   // 5 מ"מ · 5 מ'מ · 5 ממ (לא "ממש")

function _desc(line) {
  const mirror = MIRROR.test(line);
  if (!mirror && !GLASS_WORD.test(line)) return null;
  const proc = CUT_WORD.test(line) ? 'חתוך' : /מלוטש/.test(line) ? 'מלוטש' : /מחוסם/.test(line) ? 'מחוסם' : '';
  if (mirror) {
    const color = /ברונזה/.test(line) ? 'ברונזה' : /אפור|שחור/.test(line) ? 'אפורה' : '';
    return { kind: 'mirror', color, mm: null, proc: proc || 'מלוטש' };
  }
  return { kind: 'glass', color: GLASS_COLORS.find(c => line.includes(c)) || '', mm: null, proc };
}

//  מחזיר { desc|null, dims:[w,h]|null, qty, extraNums } לשורה אחת
function _line(raw) {
  let s = ' ' + raw + ' ';
  const desc = _desc(raw);
  let qty = 1, mm = null;

  const u = s.match(/(\d{1,3})\s*יח/);
  if (u) { qty = parseInt(u[1], 10); s = s.replace(u[0], ' '); }
  const um = s.match(UNIT_MM);
  if (um) { mm = Number(um[1]); s = s.replace(um[0], ' '); }

  let nums = (s.match(NUM) || []).map(Number);
  // "X2" / "x 3" בסוף: כמות — רק אם לפניו כבר שתי מידות, בלי לספור עובי מוביל.
  // אחרת "מראה 5 70 X 120" היה הופך ל-120 יחידות של 50×700 (סקירה, 26/10).
  const lead = !!desc && mm == null && THICK.includes(nums[0]);
  const tail = s.match(/[xX×]\s*(\d{1,3})\s*$/);
  if (tail && !u && (nums.length - 1) - (lead ? 1 : 0) >= 2) { qty = parseInt(tail[1], 10); nums = nums.slice(0, -1); }
  // עובי בלי יחידה: המספר הראשון אחרי המוצר, כשנשארות אחריו עוד שתי מידות
  if (lead && nums.length >= 3) mm = nums.shift();
  // שורת מוצר בלי מידות: "מראה 5"
  if (mm == null && desc && nums.length === 1 && THICK.includes(nums[0])) mm = nums.shift();

  const dims = nums.length === 2 ? nums : null;
  return { desc: desc && { ...desc, mm }, dims, qty: Math.max(1, qty || 1), count: nums.length };
}

function lgWaFreeTextParse(text) {
  const lines = _norm(text).split('\n').map(l => l.trim()).filter(Boolean);
  const groups = [], unparsed = [];
  let cur = null;                 // הקבוצה שהשורות הבאות בלי מוצר מצטרפות אליה
  for (const l of lines) {
    if (NOT_ORDER.test(l)) {
      cur = null;
      if ((l.match(NUM) || []).length >= 2) unparsed.push(l);
      continue;
    }
    const p = _line(l);
    if (p.desc) {
      const d = { ...p.desc, mm: p.desc.mm != null ? p.desc.mm : (p.desc.kind === 'mirror' ? 5 : null) };
      cur = { heading: l, desc: d, sku: null, lines: [] };
      groups.push(cur);
    }
    if (p.dims && cur) {
      const [w, h] = p.dims;
      const metres = /מטר/.test(l) || (w <= MAX_M && h <= MAX_M);
      const bad = metres ? (w <= 0 || h <= 0 || w > MAX_M || h > MAX_M) : (w > MAX_CM || h > MAX_CM || w < MIN_CM || h < MIN_CM);
      if (bad || p.qty > MAX_QTY) { unparsed.push(l); continue; }
      const k = metres ? 1000 : 10;
      cur.lines.push({ w: Math.round(w * k), h: Math.round(h * k), qty: p.qty });
      continue;
    }
    if (p.count >= 2) unparsed.push(l);
  }
  return { groups: groups.filter(g => g.lines.length), unparsed };
}

function lgWaFreeTextIsOrder(text) {
  return lgWaFreeTextParse(text).groups.length > 0;
}

const EXTRAS = ['גרפיקה', 'צורתית', 'עגול', 'עגולה', 'טריפלקס', 'דלתות', 'פינויים', 'אסיד', 'קליר', 'חלבי', 'ברונזה', 'אפורה', 'אפור', 'מראה', 'שקוף'];

function lgWaFreeTextSku(desc, catalog) {
  if (!desc || desc.mm == null) return null;
  const need = [];
  if (desc.kind === 'mirror') need.push('מראה');
  else if (!desc.color || !desc.proc) return null;      // לזכוכית אין ברירת מחדל
  if (desc.color) need.push(desc.color);
  if (desc.proc) need.push(desc.proc);
  const thick = new RegExp("(^|\\s)" + desc.mm + " מ''מ(\\s|$)");
  const hits = Object.entries(catalog || {}).filter(([, e]) => {
    if (!e || e.active === false) return false;
    const n = String(e.name || '');
    if (!thick.test(n) || !need.every(w => n.includes(w))) return false;
    return !EXTRAS.some(x => n.includes(x) && !need.some(w => w.includes(x) || x.includes(w)));
  });
  return hits.length === 1 ? hits[0][0] : null;
}

function lgWaFreeTextResolve(parsed, catalog) {
  return { ...parsed, groups: (parsed.groups || []).map(g => ({ ...g, sku: lgWaFreeTextSku(g.desc, catalog) })) };
}

module.exports = { lgWaFreeTextParse, lgWaFreeTextIsOrder, lgWaFreeTextSku, lgWaFreeTextResolve };
