// ═══════════════════════════════════════════════════════════════════
//  _po-pdf.js — הזמנת רכש ב-PDF ממוחשב של לקוח → שורות בהזמנה (בן, 28/10/2026)
//
//  אביבי (יצחק אביבי ייצור) שולחים במייל PDF של "הזמנת רכש" מהמחשב שלהם.
//  הטקסט שמור בקובץ, ולכן נקרא כמו שהוא — בלי בינה מלאכותית ובלי ניחוש.
//  נקראים שלושה דברים בלבד, כמו בהזמנות הטקסט של אגן ברזל:
//    1. מספר ההזמנה (PO26H016504)       → שם הסקיצה
//    2. בכל שורה: אורך, רוחב (מ"מ), יחידות → פריטים
//    3. המק"ט של אביבי בשורה             → המק"ט שלנו, לפי טבלה קבועה (בן קובע)
//  מק"ט שלא בטבלה → בלי מק"ט, ובן בוחר בתור. מחירים, הערות ושעות — לא נקראים.
//
//  בדיקת שפיות: אורך × רוחב × יחידות חייב להתאים לכמות במ"ר שבשורה. אם לא —
//  השורה נכנסת, ובהערות כתוב לבדוק אותה (אולי יחידות אחרות, אולי קריאה שגויה).
//
//  טהור לגמרי — בלי Firebase ובלי pdfjs. מקבל את פריטי הטקסט של עמוד אחד
//  ({str, x, y} — כפי ש-getTextContent מחזיר, y גדל כלפי מעלה).
//  נבדק ב-scripts/test-po-pdf.js.
// ═══════════════════════════════════════════════════════════════════

// המק"ט של אביבי → המק"ט שלנו. בן, 28/10: 102400009 "זכוכית אקסטרה קליר 8 מ"מ ליטוש מסביב" = 8CM
const LG_PO_SKU_MAP = {
  avivi: { '102400009': '8CM' },
};

const ROW_START = /^\d{1,3}$/;          // מספר השורה בעמודה "שורה"
const CODE = /^\d{6,}$/;                // המק"ט של אביבי
const NUM = /^\d+(?:\.\d+)?$/;
const PO_REF = /\b(PO[0-9A-Z]{6,})\b/;

const _txt = items => items.map(i => i.str).join(' ');

//  שורות לפי גובה (y), ובכל שורה מימין לשמאל
function _lines(items) {
  const by = new Map();
  for (const it of items) {
    const s = String(it.str || '').trim();
    if (!s) continue;
    const y = Math.round(Number(it.y));
    if (!by.has(y)) by.set(y, []);
    by.get(y).push({ str: s, x: Number(it.x), y });
  }
  return [...by.keys()].sort((a, b) => b - a).map(y => by.get(y).sort((a, b) => b.x - a.x));
}

function lgPoSupplier(items) {
  const t = _txt(items);
  if (/הזמנת רכש/.test(t) && (/אביבי/.test(t) || /avivi\.com/i.test(t))) return 'avivi';
  return null;
}

//  items — פריטי הטקסט של עמוד אחד. מחזיר null אם זה לא הזמנת רכש מוכרת.
function lgPoParse(items) {
  const supplier = lgPoSupplier(items || []);
  if (!supplier) return null;
  const lines = _lines(items);
  const ref = (_txt(items).match(PO_REF) || [])[1] || null;

  // עמודות לפי הכותרת: "אורך" ... "כמות". המידות יושבות בשורת משנה מתחת לשורה,
  // בטווח ה-x של העמודות האלה (קצת שמאלה מ"כמות" — שם יושב מספר היחידות)
  const head = lines.find(l => l.some(i => i.str === 'אורך') && l.some(i => i.str === 'רוחב'));
  if (!head) return { supplier, ref, rows: [], warnings: ['לא נמצאה כותרת הטבלה בעמוד'] };
  const xL = head.find(i => i.str === 'אורך').x;
  const xQ = (head.find(i => i.str === 'כמות') || head.find(i => i.str === 'רוחב')).x;
  const inDims = i => i.x <= xL + 20 && i.x >= xQ - 30;

  // תחילת שורה: מספר שורה בצד ימין ומיד אחריו מק"ט
  const starts = [];
  lines.forEach((l, li) => {
    if (l.length >= 2 && ROW_START.test(l[0].str) && CODE.test(l[1].str)) starts.push(li);
  });

  const rows = [], warnings = [];
  starts.forEach((li, k) => {
    const first = lines[li];
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const code = first[1].str;
    // תאור: הטקסט שבין הברקוד (*...*) לבין התאריך, בשורה הראשונה + שורת ההמשך
    const desc = first.slice(2).filter(i => !/^\*.*\*$/.test(i.str) && i.x > xL + 20 && !/\d\d\/\d\d\/\d\d/.test(i.str))
      .map(i => i.str).join(' ');
    // הכמות במ"ר בשורה הראשונה — בעמודת "כמות" (המספר הראשון משמאל ל"אורך")
    const m2Tok = first.find(i => NUM.test(i.str) && i.x <= xL + 20 && i.x >= xQ - 30);
    const m2 = m2Tok ? Number(m2Tok.str) : null;
    // המידות: שלושה מספרים בטווח העמודות, בשורות המשנה בלבד
    let dims = null;
    for (let j = li + 1; j < end && !dims; j++) {
      const nums = lines[j].filter(i => NUM.test(i.str) && inDims(i));
      if (nums.length === 3) dims = nums.map(i => Number(i.str));
    }
    if (!dims) { warnings.push('שורה ' + first[0].str + ': לא נמצאו מידות'); return; }
    const [l, w, qty] = dims;
    const okQty = Number.isInteger(qty) && qty >= 1 && qty <= 200;
    const okSize = l >= 50 && l <= 6000 && w >= 50 && w <= 6000;
    if (!okQty || !okSize) { warnings.push('שורה ' + first[0].str + ': מידות לא סבירות (' + dims.join(' / ') + ')'); return; }
    // ⚠️ אורך × רוחב × יחידות במ"ר, מעוגל כמו אצלם (2 ספרות) — סטייה = לבדוק
    const calc = l * w * qty / 1e6;
    const check = m2 == null || Math.abs(calc - m2) <= Math.max(0.011, m2 * 0.03);
    if (!check) warnings.push('שורה ' + first[0].str + ': המידות לא מתאימות לכמות במ"ר (' + m2 + ') — לבדוק');
    rows.push({ line: Number(first[0].str), code, desc, l: Math.round(l), w: Math.round(w), qty, m2, check });
  });
  return { supplier, ref, rows, warnings };
}

//  המבנה ש-lgWaTextItems מקבל — קבוצה לכל שורה, הכותרת היא התאור של הלקוח
function lgPoGroups(po) {
  const map = (po && LG_PO_SKU_MAP[po.supplier]) || {};
  return (po && po.rows || []).map(r => ({
    heading: r.desc || ('מק"ט ' + r.code), sku: map[r.code] || null,
    lines: [{ w: r.l, h: r.w, qty: r.qty }],
  }));
}

module.exports = { lgPoParse, lgPoGroups, lgPoSupplier, LG_PO_SKU_MAP };
