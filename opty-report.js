//  ─── דוחות ותעודות (בן, 24/11) ───
//  "דוח" — למעקב שלנו: כל מה שנחתך ביום עבודה והולך לחיסום, לפי לקוח (באופטי-ווי) ושם הזמנה.
//  "תעודה" — למי שמעבד (חיסום: לכבוד עוזי), כמו התעודה של התוכנה הקודמת (מס' 5900): בלי שמות,
//    "חיסום בלבד 8 מ"מ", גובה, רוחב, כמות, שטח (מ"ר) — שורה לכל זכוכית, לפי רוחב מהקטן לגדול.
//  ארבע תעודות נפרדות, כל אחת עם מספר משלה:
//    חיסום — רק מה שרשום "חיסום" בהערה באופטי-ווי (בן, 24/11: "כל עוד לא רשום חיסום, זה לא נכנס")
//    צבע — "צבע <קוד>" בהערה; נמצא גם בחיסום
//    CNC — "CNC" בהערה; בחיסום רק אם רשום גם "חיסום"
//    טריפלקס — "טריפלקס" בהערה; רק בתעודת טריפלקס, לא בחיסום
//  המידות נטו (בלי 2 מ"מ ליטוש) והתאריך המודפס = יום העבודה שאחרי החיתוך (אז זה יוצא) — כמו בתוכנה הקודמת.
//  שמירה: meta/optyReports/<יום>/{ nos/<סוג>, manual/<id>, hide/<key> } · מספור רץ אחד: meta/optyReportSeq
//
//  דוחות ממוספרים (בן, 26/11 — "יום חיתוך" ו"תאריך על הדף" בלבלו את העובדים):
//    "ממתין" = כל מה שנקלט מאופטי-ווי ועוד לא נכנס לשום דוח (+ שורות ידניות, meta/optyRepPending/{manual,hide}).
//    "הוצא דוח" = מספר חדש (meta/optyReportSeq) → meta/optyRepBatches/<no> = { no, at, date, rows, keys, notes }.
//    הדוח לא משתנה אחרי שיצא. התעודות של הדוח (חיסום / צבע / CNC / טריפלקס) — באותו מספר בדיוק (בן: "כדי שנדע מה שייך למה").
//    ימי החיתוך שכבר הודפסו בשיטה הישנה (meta/optyReports/<יום>/nos) — לא חוזרים ל"ממתין".

const LG_REPORT_FIRST_NO = 5901;
const LG_REP_START_DAY = '2026-11-25';    // לפני זה הדוחות יצאו מהתוכנה הקודמת — לא "ממתין"          // המספר האחרון בתוכנה הקודמת: 5900 (בן, 24/11)
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
//  מההערה: { triplex: '' | 'טריפלקס' | 'טריפלקס מט', paint: '' | '7016', cnc }
function lgOptyReportProc(note) {
  const t = String(note || '').replace(/\s+/g, ' ').trim();
  const tr = t.match(/טריפלקס(\s*מט)?/), pc = t.match(/צבע\s*([^/]*)/);
  return { triplex: tr ? tr[0].replace(/\s+/g, ' ') : '', paint: pc ? (pc[1].trim() || 'צבע') : '', cnc: /\bCNC\b/i.test(t) };
}

//  מידה נטו, כמו בתעודה 5900 של התוכנה הקודמת, במ"מ שלמים. "רוחב" = Y באופטי-ווי, "גובה" = X.
//  זכוכית שהמידה שלה כוללת את הליטוש (MOLATURA 0 — השרטט הוסיף 2) → פחות 2; MOLATURA > 0 (אופטי-ווי מוסיף לבד) → כמו שהיא.
//  (נבדק 24/11 מול 5900: 39 שורות של החיתוך של 23/11 עם ליטוש 0 → פחות 2, 2 שורות עם ליטוש 2 → כמו שהן)
function lgOptyReportNet(v, grind) { const n = Number(v) || 0; return Math.round(Number(grind) > 0 || n <= 2 ? n : n - 2); }

//  jobs = meta/optyJobs · rep = meta/optyReports/<day> → שורות:
//  { key, src: 'opty'|'manual', client, name, glass, mat, w (רוחב), h (גובה), qty, job, chisum, paint, cnc, triplex, hidden }
//  רק זכוכית שהולכת לאחד מהעיבודים. hidden = שורות שבן הוריד (מוצגות בעמוד עם "החזר", לא בהדפסה)
function lgOptyReportRows(jobs, day, mats, rep) {
  const r = rep || {}, hide = r.hide || {}, rows = [];
  const push = x => { if (x.chisum || x.paint || x.cnc || x.triplex) rows.push(x); };
  Object.values(jobs || {}).filter(j => j && j.day === day).sort((a, b) => String(a.job).localeCompare(String(b.job))).forEach(j => {
    Object.entries(j.pieces || {}).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([pos, p]) => {
      if (!p) return;
      //  בן, 24/11: "כל עוד לא רשום חיסום, זה לא נכנס לחיסום" — רק ההערה קובעת, לא סוג הזכוכית
      const pr = lgOptyReportProc(p.note), chisum = !pr.triplex && _repNoteChisum(p.note) === true;
      const key = j.job + '_' + pos;
      push({ key, src: 'opty', job: j.job, client: String(p.client || '').trim(), name: String(p.name || '').trim(),
        glass: String(j.matName || j.mat || '').trim(), mat: String(j.mat || ''), w: lgOptyReportNet(p.h, p.grind), h: lgOptyReportNet(p.w, p.grind), qty: Number(p.qty) || 1,
        chisum, paint: pr.paint, cnc: pr.cnc, triplex: pr.triplex, hidden: !!hide[key] });
    });
  });
  //  ידני: kind = chisum | paint | cnc | triplex. צבע ו-CNC נכנסים גם לחיסום, טריפלקס — רק לטריפלקס
  Object.entries(r.manual || {}).sort((a, b) => (Number(a[1] && a[1].at) || 0) - (Number(b[1] && b[1].at) || 0)).forEach(([id, m]) => {
    if (!m) return;
    const k = LG_REPORT_KINDS[m.kind] ? m.kind : 'chisum';
    push({ key: 'm_' + id, id, src: 'manual', client: String(m.client || '').trim(), name: String(m.name || '').trim(),
      glass: String(m.glass || '').trim(), mat: '', w: Number(m.w) || 0, h: Number(m.h) || 0, qty: Number(m.qty) || 1,
      chisum: k === 'chisum' || k === 'paint', paint: k === 'paint' ? (String(m.color || '').trim() || 'צבע') : '', cnc: k === 'cnc', triplex: k === 'triplex' ? 'טריפלקס' : '', hidden: false });
  });
  return rows;
}
//  השורות של תעודה אחת (בלי מה שהורד). 'report' = הדוח שלנו = מה שבחיסום; 'report-triplex' = דוח טריפלקס נפרד (בן, 25/11)
const LG_REPORT_OF = { report: 'chisum', 'report-triplex': 'triplex' };
function lgOptyReportFor(rows, kind) {
  const k = LG_REPORT_OF[kind] || kind;
  return (rows || []).filter(r => !r.hidden && r[k]);
}

//  "ממתין לדוח": כל הזכוכית מאופטי-ווי מיום LG_REP_START_DAY שלא נכנסה לדוח (batches) ולא ביום שהודפס בשיטה הישנה (legacy),
//  + השורות הידניות שמחכות. pend = meta/optyRepPending { manual, hide } · batches = meta/optyRepBatches · legacy = meta/optyReports
function lgOptyPendingRows(jobs, mats, pend, batches, legacy) {
  const used = {}, oldDays = {}, p = pend || {};
  Object.values(batches || {}).forEach(b => Object.keys((b && b.keys) || {}).forEach(k => { used[k] = 1; }));
  Object.entries(legacy || {}).forEach(([d, r]) => { if (r && r.nos && Object.keys(r.nos).length) oldDays[d] = 1; });
  const days = [...new Set(Object.values(jobs || {}).map(j => j && j.day).filter(d => d && d >= LG_REP_START_DAY && !oldDays[d]))].sort();
  const rows = [];
  days.forEach(d => lgOptyReportRows(jobs, d, mats, { hide: p.hide }).forEach(r => { if (!used[r.key]) rows.push(Object.assign(r, { day: d })); }));
  lgOptyReportRows({}, '', mats, { manual: p.manual }).forEach(r => { r.hidden = !!(p.hide || {})[r.key]; rows.push(r); });
  return rows;
}
//  סיכום לכרטיס: יחידות, לקוחות, ולכל סוג תעודה — כמה יחידות (0 = אין תעודה כזאת)
function lgOptyRepSummary(rows) {
  const live = (rows || []).filter(r => !r.hidden), u = rs => rs.reduce((n, r) => n + (Number(r.qty) || 1), 0);
  const by = {}; Object.keys(LG_REPORT_KINDS).forEach(k => { by[k] = u(lgOptyReportFor(live, k)); });
  return { rows: live.length, units: u(live), clients: new Set(live.map(r => r.client || '')).size, by };
}
//  חיפוש בדוחות ובממתין (בן, 26/11): לקוח, שם הזמנה, סוג זכוכית, מספר אופטימיזציה, מידה.
//  "1885" — רוחב או גובה (±2: נטו מול ברוטו); "550x1885" / "550 1885" — שתי המידות, בכל סדר. כל המילים חייבות להתאים.
function lgOptyRepMatch(r, q) {
  const toks = String(q || '').toLowerCase().replace(/(\d)\s*[×x*]\s*(?=\d)/g, '$1 ').replace(/×/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const txt = [r.client, r.name, r.glass, r.job, r.mat].map(v => String(v || '').toLowerCase()).join(' ');
  const nums = [Number(r.w) || 0, Number(r.h) || 0], used = [false, false];
  return toks.every(t => {
    if (/^\d{2,}$/.test(t)) {
      const n = Number(t), i = nums.findIndex((v, k) => !used[k] && Math.abs(v - n) <= 2);
      if (i >= 0) { used[i] = true; return true; }
      return txt.includes(t);
    }
    return txt.includes(t);
  });
}
//  → [{ no (null = ממתין), b, rows }] — הממתין ראשון, אחר כך מהדוח החדש לישן
function lgOptyRepSearch(q, pending, batches, max) {
  const out = [], cap = max || 150; let n = 0;
  const add = (no, b, rows) => { const hit = rows.filter(r => r && !r.hidden && lgOptyRepMatch(r, q)).slice(0, Math.max(0, cap - n)); if (hit.length) { out.push({ no, b, rows: hit }); n += hit.length; } };
  add(null, null, pending || []);
  Object.values(batches || {}).filter(b => b && b.no).sort((a, b) => Number(b.no) - Number(a.no))
    .forEach(b => add(b.no, b, Array.isArray(b.rows) ? b.rows : Object.values(b.rows || {})));
  return out;
}
//  מספר התעודה = מספר הדוח. רק בדוחות הישנים (לפני 27/11) לטריפלקס/CNC/צבע היה מספר משלו — שומרים אותו.
function lgOptyBatchNoteNo(b, kind) {
  return (b && b.legacy && b.legacy.nos && b.legacy.nos[kind]) || (b && b.no) || '';
}

//  דוח: [{ client, orders: [{ name, rows }] }] — לפי סדר ההופעה (כמו באופטי-ווי)
//  סדר לקוחות (בן, 26/11): לפי א-ב, אנגלית קודם ("BathPlace", "H.B.GLASS"), אחר כך עברית; "בלי שם לקוח" בסוף
function lgOptyClientCmp(a, b) {
  const grp = s => { s = String(s || '').trim(); if (!s || s === 'בלי שם לקוח') return 2; const L = s.replace(/[^A-Za-z֐-׿]/g, '')[0] || ''; return /[A-Za-z]/.test(L) ? 0 : 1; };   // לפי האות הראשונה
  const ga = grp(a), gb = grp(b);
  if (ga !== gb) return ga - gb;
  return String(a || '').localeCompare(String(b || ''), ga === 0 ? 'en' : 'he', { sensitivity: 'base', numeric: true });
}
function lgOptyReportByClient(rows) {
  const out = [], byC = {};
  (rows || []).forEach(r => {
    const c = r.client || 'בלי שם לקוח';
    if (!byC[c]) { byC[c] = { client: c, orders: [], _o: {} }; out.push(byC[c]); }
    const g = byC[c], n = r.name || '';
    if (!g._o[n]) { g._o[n] = { name: n, rows: [] }; g.orders.push(g._o[n]); }
    g._o[n].rows.push(r);
  });
  return out.sort((x, y) => lgOptyClientCmp(x.client, y.client)).map(g => ({ client: g.client, orders: g.orders }));
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
    return { i, t, code: kind === "paint" && r.paint !== "צבע" ? r.paint : "", item: what + ' ' + (t ? t + ' מ"מ' : (r.glass || '')), w: r.w, h: r.h, qty: r.qty,
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

//  התאריך על הדף = יום העבודה שאחרי החיתוך (תעודה 5900 מ-24/11 = החיתוך של 23/11)
function lgOptyReportOutDay(day) {
  const f = typeof lgOptyWorkAdd === 'function' ? lgOptyWorkAdd : (typeof require === 'function' ? require('./opty-layout.js').lgOptyWorkAdd : null);
  return f && /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? f(day, 1) : day;
}
//  עמוד הדפסה מלא. kind: 'report' (הדוח שלנו) | chisum | paint | cnc | triplex (תעודות)
function lgOptyReportHtml(kind, rows, day, no, outDay) {
  const printDay = /^\d{4}-\d{2}-\d{2}$/.test(String(outDay || '')) ? outDay : lgOptyReportOutDay(day);   // בן 26/11: אפשר לבחור תאריך אחר
  const e = _repEsc, isNote = !LG_REPORT_OF[kind], repName = kind === 'report-triplex' ? 'דוח טריפלקס' : 'דוח חיסום', H = LG_REPORT_HEAD, K = LG_REPORT_KINDS[kind] || LG_REPORT_KINDS.chisum;
  const title = 'הזמנה מס׳ ' + (no || '—');
  let body = '', cols = '';
  if (isNote) {
    const ns = lgOptyNoteRows(rows, kind), qty = ns.reduce((n, r) => n + r.qty, 0), m2 = ns.reduce((n, r) => n + r.m2, 0);
    cols = '<th>פריט</th><th>גובה</th><th>רוחב</th><th>כמות</th><th>שטח</th>';
    body = ns.length ? `<tbody>${ns.map((r, i) => `<tr${i % 2 ? ' class="z"' : ''}><td class="g">${r.code ? e(r.item).replace(e(r.code), "<bdi dir=\"ltr\">" + e(r.code) + "</bdi>") : e(r.item)}</td><td>${e(r.h)}</td><td>${e(r.w)}</td><td>${e(r.qty)}</td><td>${r.m2.toFixed(2)}</td></tr>`).join('')}</tbody>
      <tbody><tr class="t all"><td colspan="3">סה"כ</td><td>${qty}</td><td>${m2.toFixed(2)}</td></tr></tbody>` : '';
  } else {
    cols = '<th>פריט</th><th>גובה</th><th>רוחב</th><th>כמות</th>';
    let zi = 0; const row = r => `<tr${zi++ % 2 ? ' class="z"' : ''}><td class="g"><bdi dir="ltr">${e(r.glass)}</bdi></td><td>${e(r.h)}</td><td>${e(r.w)}</td><td>${e(r.qty)}</td></tr>`;
    body = lgOptyReportByClient(lgOptyReportFor(rows, kind)).map(c => `<tbody><tr class="c"><th colspan="4">${e(c.client)}</th></tr>${c.orders.map(o =>
      (o.name ? `<tr class="o"><th colspan="4">${e(o.name)}</th></tr>` : '') + o.rows.map(row).join('')).join('')}</tbody>`).join('');
  }
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${isNote ? 'תעודת ' + e(K.he) : repName} ${e(no || '')} · ${e(day)}</title><style>
  @page { size: A4; margin: 12mm 12mm 16mm; @bottom-center { content: "דף " counter(page) " מ-" counter(pages); font: 11px Arial, sans-serif; } }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact} body{font-family:Arial,"Heebo",sans-serif;color:#111;margin:0;font-size:14px}
  .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px}
  .hd .n{font-size:22px;font-weight:900} .hd .id{font-size:12px}
  .mid{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;margin:12px 0 6px}
  .ttl{font-size:22px;font-weight:700;text-align:center} .ttl small{display:block;font-size:14px;font-weight:400}
  .side{font-size:13px;text-align:left} .side b{display:block;font-style:italic}
  .to{font-size:14px;margin-bottom:6px} .to .blank{display:inline-block;width:60mm;border-bottom:1px solid #111;vertical-align:-2px}
  table{width:100%;border-collapse:collapse} thead th{font-size:12px;font-weight:400;border-bottom:1px solid #111;padding:4px 6px;text-align:center}
  thead th:first-child,td.g{text-align:right} td{padding:4px 6px;text-align:center} tr.z td{background:#dcdcdc}
  tr.c th{font-size:17px;padding:12px 6px 4px;text-align:center} tr.o th{font-size:14px;text-align:center;padding:6px;text-decoration:underline}
  tr.t td{font-weight:700;border-top:2px solid #111;background:#fff!important;font-size:15px} tr.t td:first-child{text-align:right}
  tr{break-inside:avoid} .empty{text-align:center;padding:40px;color:#666}
  </style></head><body>
  <div class="hd"><span class="n">${e(H.name)}</span><span class="id">ע.מ. ${e(H.id)}</span></div>
  <div class="mid"><span></span><div class="ttl">${e(title)}<small>${isNote ? 'תעודת ' + e(K.he) : repName}</small></div><div class="side">${isNote ? '<b>מקור</b>' : ''}${e(lgOptyReportDate(printDay))}</div></div>
  ${isNote ? `<div class="to">לכבוד: ${K.to ? e(K.to) : '<span class="blank"></span>'}</div>` : ''}
  ${body ? `<table><thead><tr>${cols}</tr></thead>${body}</table>` : '<p class="empty">אין זכוכית לתעודה הזאת בדוח הזה</p>'}
  </body></html>`;
}

//  הדפסה ישר ל-Brother (בן, 26/11: "מהאייפון / אייפד — שיישאל ויישלח למדפסת הרגילה")
//  מודל עמודים לציור על קנבס (A4): כותרת בכל עמוד, שורות עם פס כל שנייה, "דף i מ-N".
//  per = כמה יחידות גובה בעמוד (שורה = 1). כותרת לקוח לא נשארת לבד בתחתית עמוד.
function lgOptyReportPrintModel(kind, rows, day, no, outDay, per) {
  const isNote = !LG_REPORT_OF[kind], K = LG_REPORT_KINDS[kind] || LG_REPORT_KINDS.chisum, cap = per || 40;
  const printDay = /^\d{4}-\d{2}-\d{2}$/.test(String(outDay || '')) ? outDay : lgOptyReportOutDay(day);
  const head = { company: LG_REPORT_HEAD.name, id: 'ע.מ. ' + LG_REPORT_HEAD.id, title: 'הזמנה מס׳ ' + (no || '—'),
    sub: isNote ? 'תעודת ' + K.he : (kind === 'report-triplex' ? 'דוח טריפלקס' : 'דוח חיסום'),
    date: lgOptyReportDate(printDay), orig: isNote, to: isNote ? (K.to ? 'לכבוד: ' + K.to : 'לכבוד: ____________') : '' };
  const cols = isNote ? ['פריט', 'גובה', 'רוחב', 'כמות', 'שטח'] : ['פריט', 'גובה', 'רוחב', 'כמות'];
  const lines = [];
  if (isNote) {
    const ns = lgOptyNoteRows(rows, kind);
    ns.forEach((r, i) => lines.push({ t: 'r', z: i % 2 === 1, cells: [r.item, String(r.h), String(r.w), String(r.qty), r.m2.toFixed(2)] }));
    if (ns.length) lines.push({ t: 't', cells: ['סה"כ', '', '', String(ns.reduce((n, r) => n + r.qty, 0)), ns.reduce((n, r) => n + r.m2, 0).toFixed(2)] });
  } else {
    let zi = 0;
    lgOptyReportByClient(lgOptyReportFor(rows, kind)).forEach(c => {
      lines.push({ t: 'c', text: String(c.client || '') });
      c.orders.forEach(o => { if (o.name) lines.push({ t: 'o', text: String(o.name) });
        o.rows.forEach(r => lines.push({ t: 'r', z: zi++ % 2 === 1, cells: [String(r.glass || ''), String(r.h), String(r.w), String(r.qty)] })); });
    });
  }
  const H = { c: 1.8, o: 1.3, r: 1, t: 1.5 };
  const pages = [[]]; let used = 0;
  lines.forEach((ln, i) => {
    let need = H[ln.t];
    if (ln.t === 'c' || ln.t === 'o') for (let j = i + 1; j < lines.length && lines[j].t !== 'r'; j++) need += H[lines[j].t];
    if (ln.t === 'c' || ln.t === 'o') need += 1;                     // לפחות שורה אחת אחרי הכותרת
    if (used + need > cap && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(ln); used += H[ln.t];
  });
  return { head, cols, pages, empty: !lines.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lgOptyReportRows, lgOptyReportProc, lgOptyReportFor, lgOptyReportByClient, lgOptyReportThick, lgOptyNoteRows, lgOptyReportHtml, lgOptyReportDate, lgOptyReportOutDay, lgOptyReportNet, lgOptyReportPrintModel, lgOptyClientCmp, LG_REPORT_FIRST_NO, LG_REPORT_KINDS,
    lgOptyPendingRows, lgOptyRepSummary, lgOptyBatchNoteNo, LG_REP_START_DAY, lgOptyRepMatch, lgOptyRepSearch };
}
