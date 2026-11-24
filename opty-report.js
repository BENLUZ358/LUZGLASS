//  ─── דוחות ותעודות (בן, 24/11) ───
//  "דוח" — למעקב שלנו: כל מה שנחתך ביום עבודה והולך לחיסום, לפי לקוח (באופטי-ווי) ושם הזמנה.
//  "תעודה" — למי שמעבד (חיסום: לכבוד עוזי), כמו התעודה של התוכנה הקודמת (מס' 5900): בלי שמות,
//    "חיסום בלבד 8 מ"מ", גובה, רוחב, כמות, שטח (מ"ר) — שורה לכל זכוכית, לפי רוחב מהקטן לגדול.
//  ארבע תעודות נפרדות, כל אחת עם מספר משלה:
//    חיסום — ההערה באופטי-ווי גוברת ("חיסום" / "ללא חיסום"), אחרת סוג הזכוכית (הגדרות)
//    צבע — "צבע <קוד>" בהערה; נמצא גם בחיסום
//    CNC — "CNC" בהערה; נמצא גם בחיסום
//    טריפלקס — "טריפלקס" בהערה; רק בתעודת טריפלקס, לא בחיסום
//  המידות כמו שהן באופטי-ווי (כמו בתוכנה הקודמת שמשכה מאופטי-ווי).
//  שמירה: meta/optyReports/<יום>/{ nos/<סוג>, manual/<id>, hide/<key> } · מספור רץ אחד: meta/optyReportSeq

const LG_REPORT_FIRST_NO = 5901;          // המספר האחרון בתוכנה הקודמת: 5900 (בן, 24/11)
const LG_REPORT_HEAD = { name: 'לוז זגגות ומראות האחים בע"מ', id: '513020198' };
const LG_REPORT_KINDS = {
  chisum:  { he: 'חיסום',   item: 'חיסום בלבד', to: 'עוזי' },
  paint:   { he: 'צבע',     item: 'צבע',        to: '' },
  cnc:     { he: 'CNC',     item: 'CNC',        to: '' },
  triplex: { he: 'טריפלקס', item: 'טריפלקס',    to: '' },
};

function _repNoteChisum(note) {
  const f = typeof lgOptyNoteInfo === 'function' ? lgOptyNoteInfo : (typeof require === 'function' ? require('./opty-layout.js').lgOptyNoteInfo : null);
  return f ? f(note).chisum : null;
}
function _repMatChisum(code, en, mats) {
  const f = typeof lgOptyMatChisum === 'function' ? lgOptyMatChisum : (typeof require === 'function' ? require('./opty-layout.js').lgOptyMatChisum : null);
  return !!(f && f(code, en, mats));
}
//  מההערה: { triplex: '' | 'טריפלקס' | 'טריפלקס מט', paint: '' | '7016', cnc }
function lgOptyReportProc(note) {
  const t = String(note || '').replace(/\s+/g, ' ').trim();
  const tr = t.match(/טריפלקס(\s*מט)?/), pc = t.match(/צבע\s*([^/]*)/);
  return { triplex: tr ? tr[0].replace(/\s+/g, ' ') : '', paint: pc ? (pc[1].trim() || 'צבע') : '', cnc: /\bCNC\b/i.test(t) };
}

//  jobs = meta/optyJobs · rep = meta/optyReports/<day> → שורות:
//  { key, src: 'opty'|'manual', client, name, glass, mat, w, h, qty, job, chisum, paint, cnc, triplex, hidden }
//  רק זכוכית שהולכת לאחד מהעיבודים. hidden = שורות שבן הוריד (מוצגות בעמוד עם "החזר", לא בהדפסה)
function lgOptyReportRows(jobs, day, mats, rep) {
  const r = rep || {}, hide = r.hide || {}, rows = [];
  const push = x => { if (x.chisum || x.paint || x.cnc || x.triplex) rows.push(x); };
  Object.values(jobs || {}).filter(j => j && j.day === day).sort((a, b) => String(a.job).localeCompare(String(b.job))).forEach(j => {
    Object.entries(j.pieces || {}).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([pos, p]) => {
      if (!p) return;
      const pr = lgOptyReportProc(p.note), n = _repNoteChisum(p.note);
      const chisum = !pr.triplex && (n !== null ? n : _repMatChisum(j.mat, j.matName, mats));
      const key = j.job + '_' + pos;
      push({ key, src: 'opty', job: j.job, client: String(p.client || '').trim(), name: String(p.name || '').trim(),
        glass: String(j.matName || j.mat || '').trim(), mat: String(j.mat || ''), w: Number(p.w) || 0, h: Number(p.h) || 0, qty: Number(p.qty) || 1,
        chisum, paint: pr.paint, cnc: pr.cnc, triplex: pr.triplex, hidden: !!hide[key] });
    });
  });
  //  ידני: kind = chisum | paint | cnc | triplex. צבע ו-CNC נכנסים גם לחיסום, טריפלקס — רק לטריפלקס
  Object.entries(r.manual || {}).sort((a, b) => (Number(a[1] && a[1].at) || 0) - (Number(b[1] && b[1].at) || 0)).forEach(([id, m]) => {
    if (!m) return;
    const k = LG_REPORT_KINDS[m.kind] ? m.kind : 'chisum';
    push({ key: 'm_' + id, id, src: 'manual', client: String(m.client || '').trim(), name: String(m.name || '').trim(),
      glass: String(m.glass || '').trim(), mat: '', w: Number(m.w) || 0, h: Number(m.h) || 0, qty: Number(m.qty) || 1,
      chisum: k !== 'triplex', paint: k === 'paint' ? (String(m.color || '').trim() || 'צבע') : '', cnc: k === 'cnc', triplex: k === 'triplex' ? 'טריפלקס' : '', hidden: false });
  });
  return rows;
}
//  השורות של תעודה אחת (בלי מה שהורד). 'report' = הדוח שלנו = מה שבחיסום
function lgOptyReportFor(rows, kind) {
  const k = kind === 'report' ? 'chisum' : kind;
  return (rows || []).filter(r => !r.hidden && r[k]);
}

//  דוח: [{ client, orders: [{ name, rows }] }] — לפי סדר ההופעה (כמו באופטי-ווי)
function lgOptyReportByClient(rows) {
  const out = [], byC = {};
  (rows || []).forEach(r => {
    const c = r.client || 'בלי שם לקוח';
    if (!byC[c]) { byC[c] = { client: c, orders: [], _o: {} }; out.push(byC[c]); }
    const g = byC[c], n = r.name || '';
    if (!g._o[n]) { g._o[n] = { name: n, rows: [] }; g.orders.push(g._o[n]); }
    g._o[n].rows.push(r);
  });
  return out.map(g => ({ client: g.client, orders: g.orders }));
}

//  עובי: "08S" → "8" · "10C" → "10" · "03+3S" → "3+3"; בשורה ידנית — המספר הראשון בטקסט ("8 mm clear" → "8")
function lgOptyReportThick(mat, glass) {
  const m = String(mat || '').match(/^(\d{1,2})(\+\d{1,2})?/) || String(glass || '').match(/(\d{1,2})(\s*\+\s*\d{1,2})?/);
  return m ? String(Number(m[1])) + (m[2] ? '+' + Number(m[2].replace(/\D/g, '')) : '') : '';
}
//  תעודה: שורה לכל זכוכית { item: 'חיסום בלבד 8 מ"מ' | 'צבע 7016 8 מ"מ' | ..., w, h, qty, m2 } — לפי השם, ואז לפי רוחב מהקטן לגדול
function lgOptyNoteRows(rows, kind) {
  const K = LG_REPORT_KINDS[kind] || LG_REPORT_KINDS.chisum;
  return lgOptyReportFor(rows, kind).map((r, i) => {
    const t = lgOptyReportThick(r.mat, r.glass);
    const what = kind === 'paint' ? 'צבע' + (r.paint && r.paint !== 'צבע' ? ' ' + r.paint : '') : kind === 'triplex' ? r.triplex || K.item : K.item;
    return { i, t, item: what + ' ' + (t ? t + ' מ"מ' : (r.glass || '')), w: r.w, h: r.h, qty: r.qty,
      m2: Math.round((r.w * r.h * r.qty) / 10000) / 100 };
  }).sort((a, b) => (parseFloat(a.t) || 99) - (parseFloat(b.t) || 99) || a.item.localeCompare(b.item) || a.w - b.w || a.i - b.i);
}

const _repEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LG_REPORT_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const LG_REPORT_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
//  "יום שלישי 18 אוגוסט 2026"
function lgOptyReportDate(iso) {
  const d = new Date(String(iso) + 'T12:00:00Z'); if (isNaN(d)) return '';
  return 'יום ' + LG_REPORT_DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + LG_REPORT_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

//  עמוד הדפסה מלא. kind: 'report' (הדוח שלנו) | chisum | paint | cnc | triplex (תעודות)
function lgOptyReportHtml(kind, rows, day, no) {
  const e = _repEsc, isNote = kind !== 'report', H = LG_REPORT_HEAD, K = LG_REPORT_KINDS[kind] || LG_REPORT_KINDS.chisum;
  const title = 'הזמנה מס׳ ' + (no || '—');
  let body = '', cols = '';
  if (isNote) {
    const ns = lgOptyNoteRows(rows, kind), qty = ns.reduce((n, r) => n + r.qty, 0), m2 = ns.reduce((n, r) => n + r.m2, 0);
    cols = '<th>פריט</th><th>גובה</th><th>רוחב</th><th>כמות</th><th>שטח</th>';
    body = ns.length ? `<tbody>${ns.map(r => `<tr><td class="g">${e(r.item)}</td><td>${e(r.h)}</td><td>${e(r.w)}</td><td>${e(r.qty)}</td><td>${r.m2.toFixed(2)}</td></tr>`).join('')}</tbody>
      <tbody><tr class="t all"><td colspan="3">סה"כ</td><td>${qty}</td><td>${m2.toFixed(2)}</td></tr></tbody>` : '';
  } else {
    cols = '<th>פריט</th><th>גובה</th><th>רוחב</th><th>כמות</th>';
    const row = r => `<tr><td class="g"><bdi dir="ltr">${e(r.glass)}</bdi></td><td>${e(r.h)}</td><td>${e(r.w)}</td><td>${e(r.qty)}</td></tr>`;
    body = lgOptyReportByClient(lgOptyReportFor(rows, 'report')).map(c => `<tbody><tr class="c"><th colspan="4">${e(c.client)}</th></tr>${c.orders.map(o =>
      (o.name ? `<tr class="o"><th colspan="4">${e(o.name)}</th></tr>` : '') + o.rows.map(row).join('')).join('')}</tbody>`).join('');
  }
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${isNote ? 'תעודת ' + e(K.he) : 'דוח חיסום'} ${e(no || '')} · ${e(day)}</title><style>
  @page { size: A4; margin: 12mm 12mm 16mm; @bottom-center { content: "דף " counter(page) " מ-" counter(pages); font: 11px Arial, sans-serif; } }
  *{box-sizing:border-box} body{font-family:Arial,"Heebo",sans-serif;color:#111;margin:0;font-size:14px}
  .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px}
  .hd .n{font-size:22px;font-weight:900} .hd .id{font-size:12px}
  .mid{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;margin:12px 0 6px}
  .ttl{font-size:22px;font-weight:700;text-align:center} .ttl small{display:block;font-size:14px;font-weight:400}
  .side{font-size:13px;text-align:left} .side b{display:block;font-style:italic}
  .to{font-size:14px;margin-bottom:6px}
  table{width:100%;border-collapse:collapse} thead th{font-size:12px;font-weight:400;border-bottom:1px solid #111;padding:4px 6px;text-align:center}
  thead th:first-child,td.g{text-align:right} td{padding:4px 6px;text-align:center} tbody tr:nth-child(even) td{background:#e4e4e4}
  tr.c th{font-size:17px;padding:12px 6px 4px;text-align:center} tr.o th{font-size:14px;text-align:center;padding:6px;text-decoration:underline}
  tr.t td{font-weight:700;border-top:2px solid #111;background:#fff!important;font-size:15px} tr.t td:first-child{text-align:right}
  tr{break-inside:avoid} .empty{text-align:center;padding:40px;color:#666}
  </style></head><body>
  <div class="hd"><span class="n">${e(H.name)}</span><span class="id">ע.מ. ${e(H.id)}</span></div>
  <div class="mid"><span></span><div class="ttl">${e(title)}<small>${isNote ? 'תעודת ' + e(K.he) : 'דוח חיסום'}</small></div><div class="side">${isNote ? '<b>מקור</b>' : ''}${e(lgOptyReportDate(day))}</div></div>
  ${isNote ? `<div class="to">לכבוד: ${e(K.to)}</div>` : ''}
  ${body ? `<table><thead><tr>${cols}</tr></thead>${body}</table>` : '<p class="empty">אין זכוכית לתעודה הזאת ביום הזה</p>'}
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lgOptyReportRows, lgOptyReportProc, lgOptyReportFor, lgOptyReportByClient, lgOptyReportThick, lgOptyNoteRows, lgOptyReportHtml, lgOptyReportDate, LG_REPORT_FIRST_NO, LG_REPORT_KINDS };
}
