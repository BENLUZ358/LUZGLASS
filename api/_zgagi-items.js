// ═══════════════════════════════════════════════════════════════════
//  api/_zgagi-items.js — פריט שנשלח מזגאגי → שורות בתור הסקיצות.
//
//  עוזר משותף, לא route. טהור: בלי DB.
//  אפיון: docs/superpowers/specs/2026-11-01-zgagi-luzglass-link-design.md
//
//  ─── שני כללים ─────────────────────────────────────────────────────
//
//  1. **מה שהזגג בנה הוא האמת.** לא מריצים כאן את המנוע מחדש — המנוע של
//     זגאגי כבר התפצל משלנו (ZG1–ZG6), ושינויים שהזגג עשה (פרזול) היו
//     הולכים לאיבוד. רק ממפים כל זכוכית למק"ט.
//  2. **סקיצה לא נדחית בגלל מיפוי.** זכוכית שאין לה מק"ט נכנסת עם
//     skuMissing, והתור כבר יודע לבקש מק"ט ולחסום שליחה לחשבשבת עד אז.
//
//  המק"ט נמצא **לפי השם** בקטלוג (skuCatalog) — אותו עיקרון כמו
//  lgParseGlassName: הקודים לא עקביים, השם הוא מה שהמפעל כותב.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const PROC_HE = { cut: 'חתוך', litush: 'מלוטש', chisum: 'מחוסם' };
const WORK_HE = { graphic: 'גרפיקה', chalavi: 'חלבי' };

//  '' → " , רווחים כפולים → אחד
const normName = s => String(s || '').replace(/''/g, '"').replace(/[״]/g, '"').replace(/\s+/g, ' ').trim();

//  השמות האפשריים לצירוף, לפי הסדר שבו הם כתובים בקטלוג.
//  זכוכית: '8 מ"מ שקוף גרפיקה מחוסם'. חלבי שקוף נכתב גם בלי "שקוף".
//  מראה: 'מראה 5 מ"מ חתוך', ולמראה צבעונית לפעמים בלי עובי ('מראה ברונזה חתוך');
//  'מראה אפורה' בזגאגי = 'מראה אפור' בקטלוג.
function nameCandidates(g) {
  const mm = Number(g.thickness);
  const proc = PROC_HE[g.processing || 'chisum'];
  const type = String(g.type || '').trim();
  if (!mm || !proc || !type) return [];
  if (/^מראה/.test(type)) {
    const types = [type, type.replace(/אפורה$/, 'אפור')];
    const out = [];
    types.forEach(t => { out.push(`${t} ${mm} מ"מ ${proc}`); out.push(`${t} ${proc}`); });
    return out;
  }
  const work = WORK_HE[g.work] || '';
  const out = [`${mm} מ"מ ${type}${work ? ' ' + work : ''} ${proc}`];
  if (g.work === 'chalavi' && type === 'שקוף') out.push(`${mm} מ"מ חלבי ${proc}`);
  return out;
}

//  catalog: [{code, name, active}] (skuCatalog) → פונקציה glass → מק"ט | null
function lgZgagiSkuResolver(catalog) {
  const byName = new Map();
  const names = {};
  (catalog || []).forEach(e => {
    const code = e && String(e.code || e.sku || '').toUpperCase();
    if (!code || e.active === false) return;
    const n = normName(e.name);
    if (n && !byName.has(n)) byName.set(n, code);
    names[code] = n;
  });
  const resolve = g => {
    for (const n of nameCandidates(g || {})) { const c = byName.get(normName(n)); if (c) return c; }
    return null;
  };
  resolve.names = names;     // מק"ט → שם, לשם השורה
  return resolve;
}

//  שם להצגה: מהקטלוג כשיש, אחרת תיאור
const _label = g => `${g.thickness} מ"מ ${g.type || ''}${WORK_HE[g.work] ? ' ' + WORK_HE[g.work] : ''} ${PROC_HE[g.processing || 'chisum'] || ''}`.trim();

function row(g, w, h, sku, extra) {
  const proc = g.processing || 'chisum';
  return Object.assign({
    name: sku ? null : _label(g),
    glass: String(g.type || ''), mm: Number(g.thickness) || '',
    w: Number(w) || 0, h: Number(h) || 0,
    sku: sku || null,
    chisum: proc === 'chisum', litush: proc === 'litush',
    graphic: g.work === 'graphic', chalavi: g.work === 'chalavi',
  }, sku ? {} : { skuMissing: true }, extra || {});
}

//  כמות > 1 → אותה שורה n פעמים, בקבוצת כמות (כמו lgMakeQuantityGroup)
function repeat(rows, qty, gid) {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  if (n === 1) return rows;
  const out = [];
  rows.forEach((r, li) => { for (let i = 0; i < n; i++) out.push({ ...r, quantityGroupId: `${gid}_${li}`, originalQuantity: n, groupIndex: i }); });
  return out;
}

//  item: { itemId, type, title, qty, output?, measure?, withHardware, hardware?, skuHints? }
//  resolve: מ-lgZgagiSkuResolver. active: Set של קודים פעילים (ל-hint).
//  names: { code → name } לשם השורה (לא חובה; ברירת מחדל — resolve.names).
function lgZgagiItems(item, resolve, active, names) {
  const it = item || {};
  const hints = it.skuHints || {};
  const hint = k => { const c = String(hints[k] || '').toUpperCase(); return c && active && active.has(c) ? c : null; };
  const nm = names || resolve.names || {};
  const named = r => (r.sku ? { ...r, name: nm[r.sku] || r.name || r.sku } : r);
  const gid = 'grp_zg_' + String(it.itemId || '').replace(/[^\w-]/g, '_');
  let items = [];
  const notes = [];

  if (it.type === 'sketch') {
    const panels = (it.output && Array.isArray(it.output.panels)) ? it.output.panels : [];
    const rows = panels.map(p => {
      const g = p.glass || {};
      const sku = resolve(g) || hint(p.id);
      const holes = (p.processing && Array.isArray(p.processing.holes)) ? p.processing.holes.length : 0;
      return row(g, p.cutW, p.cutH, sku, { paneId: String(p.id || ''), paneLabel: String(p.label || ''), shape: p.kind || '', holes, locked: true });
    });
    items = repeat(rows, it.qty, gid);
  } else if (it.type === 'measure') {
    const m = it.measure || {};
    const g = { type: m.glassType, thickness: m.thickness, work: m.milky ? 'chalavi' : null, processing: m.processing || 'cut' };
    const sku = resolve(g) || hint('measure');
    if (m.led) notes.push('עם לד');
    if (m.mirror && m.mirror.shape && m.mirror.shape !== 'rect') notes.push('מראה בצורה — ר\' סקיצה');
    if (m.mirror && Number(m.mirror.radius)) notes.push(`פינה מעוגלת ${Number(m.mirror.radius)} מ"מ`);
    items = repeat([row(g, m.w, m.h, sku)], it.qty, gid);
  }
  items = items.map(named);
  // שם לשורה בלי מק"ט — כבר נקבע ב-row
  const hardware = (it.type !== 'uploaded' && it.withHardware !== false && Array.isArray(it.hardware))
    ? it.hardware.map(h => ({ name: String(h.name || ''), qty: Number(h.qty) || 1, sku: h.sku ? String(h.sku) : null }))
    : [];
  return { items, hardware, notes, unmapped: items.filter(i => i.skuMissing).length };
}

//  JSON עם מפתחות ממוינים — כדי שאותו תוכן ייתן אותה טביעה
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

//  מה שמשנה את מה שהמפעל מייצר. שם הפריט לא — שינוי שם לא מסמן "עודכן".
function lgZgagiFingerprint(item) {
  const it = item || {};
  const o = it.output || {};
  const body = canon({ type: it.type, qty: it.qty, withHardware: it.withHardware !== false,
    panels: o.panels || null, hardware: it.hardware || null, measure: it.measure || null });
  return crypto.createHash('sha1').update(body).digest('hex');
}

module.exports = { lgZgagiSkuResolver, lgZgagiItems, lgZgagiFingerprint };
