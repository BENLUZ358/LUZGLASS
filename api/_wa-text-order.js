// ═══════════════════════════════════════════════════════════════════
//  _wa-text-order.js — הזמנת מראות מהודעת טקסט בוואטסאפ (בן, 20/10/2026)
//
//  לקוח (אגן ברזל) מזמין בהודעת טקסט בפורמט קבוע. בן: "תתייחס רק לשורות
//  המידות, הכותרת שלהן היא המק"ט, ומספר ההזמנה על שם הסקיצה — בלי רעש."
//  לכן נקראים שלושה דברים בלבד, וכל השאר לא נקרא ולא מייצר אזהרה:
//    1. מספר ההזמנה (PHR#26037)        → שם הסקיצה
//    2. שורות מידה  (179/74 ס"מ — כמות: 1) → פריטים, ס"מ×10 = מ"מ, בסדר שנכתב
//    3. הכותרת שמעל כל קבוצת מידות      → המק"ט (לפי מילים, לא ניסוח מדויק)
//  כותרת שלא מתאימה לאף כלל → sku: null, ובן בוחר בתור. לא מנחשים מק"ט.
//
//  טהור לגמרי — בלי Firebase ובלי רשת. נבדק ב-scripts/test-wa-text-order.js.
//  Spec: docs/superpowers/specs/2026-10-20-wa-text-mirror-orders-design.md
// ═══════════════════════════════════════════════════════════════════

// הכלל הראשון שמתאים קובע. "מראה" לבד אחרון — אחרת היה תופס גם ברונזה ואפורה.
const LG_WA_TEXT_SKU_RULES = [
  { sku: '8MM',    all: ['מאסטר ליין'] },
  { sku: '6TSH',   all: ['3+3', 'חתוך'] },
  { sku: '6TSM',   all: ['3+3', 'מלוטש'] },
  { sku: '5MIRBM', any: ['מראה', 'מראות'], all: ['ברונזה'] },
  { sku: '5MIRAM', any: ['מראה', 'מראות'], also: ['שחורה', 'שחור', 'אפורה', 'אפור'] },
  { sku: '5MIRM',  any: ['מראה', 'מראות'] },
];

const ORDER_REF = /\b([A-Z]{2,4}#\d+)\b/;
// 179/74 ס"מ — כמות: 1   ·   179.6/49.6 ס"מ כמות: 10   ·   90/50 סמ –כמות: 3
const SIZE_LINE = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*ס"?מ\s*[—–-]?\s*כמות\s*:?\s*(\d+)\s*$/;

function _norm(text) {
  return String(text || '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')   // סימני כיוון שהטלפון מוסיף
    .replace(/[״”“]/g, '"')
    .replace(/\r\n?/g, '\n');
}

function _skuFor(heading) {
  const h = String(heading || '');
  for (const r of LG_WA_TEXT_SKU_RULES) {
    if (r.all && !r.all.every(w => h.includes(w))) continue;
    if (r.any && !r.any.some(w => h.includes(w))) continue;
    if (r.also && !r.also.some(w => h.includes(w))) continue;
    return r.sku;
  }
  return null;
}

const _mm = cm => Math.round(Number(cm) * 10);

// שורה שאינה כותרת גם כשהיא יושבת מעל המידות: תאריך, ושורת מספר ההזמנה
const _notHeading = l => /^\s*תאריך\s*:/.test(l) || ORDER_REF.test(l);

function lgWaTextParse(text) {
  const lines = _norm(text).split('\n').map(l => l.trim());
  const m = _norm(text).match(ORDER_REF);
  const groups = [];
  let heading = null, cur = null;
  for (const l of lines) {
    if (!l) continue;
    const s = l.match(SIZE_LINE);
    if (s) {
      if (!cur) { cur = { heading: heading || '', sku: _skuFor(heading), lines: [] }; groups.push(cur); }
      cur.lines.push({ w: _mm(s[1]), h: _mm(s[2]), qty: Math.max(1, parseInt(s[3], 10) || 1) });
      continue;
    }
    if (_notHeading(l)) continue;
    heading = l;      // הכותרת הבאה — קבוצת המידות הבאה תשתמש בה
    cur = null;
  }
  return { orderRef: m ? m[1] : null, groups };
}

// הזמנה = מספר הזמנה וגם לפחות שורת מידה אחת. כל טקסט אחר — כמו היום, לא נקרא.
function lgWaTextIsOrder(text) {
  const p = lgWaTextParse(text);
  return !!p.orderRef && p.groups.some(g => g.lines.length);
}

// פריטים לתור הסקיצות — אותו מבנה ש-iwAdd בונה (lgMakeQuantityGroup): כמות N = N פריטים
// בקבוצת כמות אחת. השם/סוג/עובי/עיבוד — מכרטיס המק"ט בקטלוג (skuCatalog/<SKU>).
// מק"ט שלא בקטלוג נשאר (התמחור הוא לפי מק"ט), והשם הוא הכותרת. בלי מק"ט — skuMissing.
function lgWaTextItems(parsed, catalog) {
  const cat = catalog || {};
  const out = [];
  (parsed && parsed.groups || []).forEach((g, gi) => g.lines.forEach((l, li) => {
    const e = g.sku ? cat[g.sku] : null;
    const base = g.sku
      ? { sku: g.sku, name: (e && e.name) || g.heading, glass: (e && e.glass) || '', mm: (e && e.mm) || '',
          w: l.w, h: l.h, chisum: !!e && e.proc === 'chisum', litush: !!e && e.proc === 'litush', graphic: !!(e && e.graphic),
          chalavi: !!(e && e.chalavi), triplex: !!(e && e.triplex) }
      : { name: g.heading, glass: '', mm: '', w: l.w, h: l.h, chisum: false, litush: false, graphic: false, skuMissing: true };
    const gid = 'grp_wa_' + gi + '_' + li;
    for (let i = 1; i <= l.qty; i++) out.push({ ...base, quantityGroupId: gid, originalQuantity: l.qty, groupIndex: i });
  }));
  return out;
}

const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "צילום" של ההודעה — במקום סקיצה, כדי שבתחנת הבדיקה ובמפעל יראו בדיוק מה הלקוח כתב.
function lgWaTextSvg(text, meta) {
  const m = meta || {};
  const lines = _norm(text).split('\n').map(l => l.trim()).filter(Boolean);
  const W = 1200, PAD = 60, LH = 56, TOP = 150;
  const H = TOP + lines.length * LH + PAD;
  const head = [m.client, m.when].filter(Boolean).join(' · ');
  const rows = lines.map((l, i) => {
    const size = SIZE_LINE.test(l);
    return `<text x="${W - PAD}" y="${TOP + i * LH}" font-size="${size ? 40 : 36}" font-weight="${size ? 700 : 400}"` +
      ` fill="${size ? '#1a1714' : '#3a342c'}">${_esc(l)}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<g direction="rtl" text-anchor="start" font-family="Heebo, Arial, sans-serif">` +
    `<text x="${W - PAD}" y="70" font-size="30" fill="#886c1f">${_esc('הודעת וואטסאפ' + (head ? ' · ' + head : ''))}</text>` +
    `<line x1="${PAD}" y1="95" x2="${W - PAD}" y2="95" stroke="#d9d2c3" stroke-width="2"/>` +
    rows + `</g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

module.exports = { lgWaTextParse, lgWaTextIsOrder, lgWaTextSvg, lgWaTextItems, LG_WA_TEXT_SKU_RULES, _norm };
