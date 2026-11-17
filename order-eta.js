// ═══════════════════════════════════════════════════════════════════
//  order-eta.js — צפי "מוכן" להזמנה (בן, 17/11)
//  שני מקורות: השלב בממשק + החיתוך באופטי-ווי (item.optyCut = יום החיתוך של הזכוכית המחוברת).
//  חוקים (בן): חיסום — נחתך א', ב' בבוקר יוצא, ג' בבוקר חוזר (שני ימי עבודה, א'–ה');
//  בלי חיסום — מוכן ביום החיתוך; גרפיקה / טריפלקס — בלי צפי.
//  צפי ללקוח (פורטל) — רק כשלכל הזכוכיות יש תאריך חיתוך אמיתי.
//  טהור: דפדפן (admin, portal) וגם Node (scripts/test-order-eta.js).
// ═══════════════════════════════════════════════════════════════════

function _etaIsoAdd(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function lgEtaWorkAdd(iso, n) {
  let d = iso;
  for (let k = 0; k < n; k++) {
    d = _etaIsoAdd(d, 1);
    for (let i = 0; i < 3; i++) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd !== 5 && wd !== 6) break; d = _etaIsoAdd(d, 1); }
  }
  return d;
}
function lgEtaToday(ms) { return new Date(ms || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); }
const _ETA_DAYS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
//  "היום" / "מחר" / "יום ג' 18/11"
function lgEtaWhen(iso, today) {
  if (iso === today) return 'היום';
  if (iso === _etaIsoAdd(today, 1)) return 'מחר';
  return 'יום ' + _ETA_DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()] + ' ' + iso.split('-').reverse().slice(0, 2).join('/');
}
const _etaDm = iso => iso.split('-').reverse().slice(0, 2).join('/');
const LG_ETA_DONE = ['done', 'delivery', 'collected'];

//  ההערה באופטי-ווי ("חיסום/חור", "ללא חיסום/ללא", "/גרפיקה", "/צבע") — כמו lgOptyNoteInfo
function _etaNote(note) {
  const t = String(note || '').replace(/\s+/g, ' ').trim(), first = t.split('/')[0].trim();
  return { chisum: /^ללא\s*חיסום/.test(first) ? false : /^חיסום/.test(first) ? true : null, graphic: /גרפיקה|צבע/.test(t) };
}

//  זכוכית אחת → { date: 'YYYY-MM-DD'|null, label, warn }
//  note (רשות, רק באדמין): ההערה של הזכוכית באופטי-ווי — לבדיקת התאמה מול ההזמנה
function lgItemEta(it, stage, today, note) {
  if (LG_ETA_DONE.includes(stage)) return { date: today, label: 'מוכן', warn: '' };
  const c = it && it.optyCut, cut = c && !c.undone && c.at ? String(c.at) : '';
  const ni = _etaNote(note);
  let warn = '';
  if (note && ni.chisum !== null && ni.chisum !== !!(it && it.chisum))
    warn = 'באופטי-ווי "' + String(note).trim() + '", בהזמנה ' + (it && it.chisum ? 'חיסום' : 'בלי חיסום');
  const chisum = !!(it && it.chisum) || ni.chisum === true;      // בסתירה — הצפי המאוחר
  const graphic = !!(it && it.graphic) || ni.graphic;
  if (it && it.triplex) return { date: null, label: 'טריפלקס' + (cut ? ' · נחתך ' + _etaDm(cut) : '') + ' · בלי צפי', warn };
  if (!cut) return { date: null, label: stage === 'workday' ? 'ביום עבודה · עוד לא חובר לאופטי-ווי' : 'עוד לא באופטימיזציה', warn };
  if (graphic) return { date: null, label: (cut <= today ? 'נחתך ' : 'לחיתוך ') + _etaDm(cut) + (chisum ? ' · חיסום' : '') + ' · גרפיקה · בלי צפי', warn };
  if (!chisum) {
    if (cut > today) return { date: cut, label: 'לחיתוך ' + lgEtaWhen(cut, today) + ' · מוכן באותו יום', warn };
    return { date: cut, label: 'נחתך ' + _etaDm(cut) + ' · מוכן', warn };
  }
  const out = lgEtaWorkAdd(cut, 1), back = lgEtaWorkAdd(cut, 2);
  if (cut > today) return { date: back, label: 'לחיתוך ' + lgEtaWhen(cut, today) + ' · חיסום · חוזר ' + lgEtaWhen(back, today), warn };
  if (today < out) return { date: back, label: 'נחתך ' + _etaDm(cut) + ' · יוצא לחיסום ' + lgEtaWhen(out, today), warn };
  if (today < back) return { date: back, label: 'בחיסום · חוזר ' + lgEtaWhen(back, today) + ' בבוקר', warn };
  return { date: back, label: 'אמור היה לחזור מחיסום ' + _etaDm(back), warn, late: stage !== 'chisum' || today > back };
}

//  הזמנה → { final, date, label, items:[{label,date,warn}], late, partial }
//  notes (רשות): [note לכל זכוכית לפי האינדקס]
function lgOrderEta(o, today, notes) {
  const stage = String((o && o.stage) || ''), td = today || lgEtaToday();
  const its = Array.isArray(o && o.items) ? o.items : Object.values((o && o.items) || {});
  if (LG_ETA_DONE.includes(stage)) return { final: true, date: td, label: 'מוכן', items: [], late: false, partial: false };
  const items = its.map((it, i) => lgItemEta(it, stage, td, (notes || [])[i]));
  const dated = items.filter(x => x.date);
  if (!items.length || dated.length < items.length) {
    const max = dated.reduce((m, x) => (x.date > m ? x.date : m), '');
    return { final: false, date: null, label: dated.length ? 'צפי חלקי — ' + dated.length + ' מתוך ' + items.length + ' זכוכיות עם תאריך' : 'אין צפי עדיין', items, late: false, partial: !!dated.length, partialDate: max || null };
  }
  const date = dated.reduce((m, x) => (x.date > m ? x.date : m), '');
  const late = date < td || items.some(x => x.late);
  return { final: false, date, label: late ? 'באיחור לפי החיתוך — היה אמור להיות מוכן ' + _etaDm(date) : 'צפי מוכן: ' + lgEtaWhen(date, td), items, late, partial: false };
}

//  ללקוח (פורטל): רק תאריך אמיתי, עתידי או היום. אחרת — כלום (לא מבטיחים).
function lgPortalEta(o, today) {
  const e = lgOrderEta(o, today);
  if (e.final || !e.date || e.late) return '';
  return 'צפי מוכן: ' + lgEtaWhen(e.date, today || lgEtaToday());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lgEtaWorkAdd, lgEtaToday, lgEtaWhen, lgItemEta, lgOrderEta, lgPortalEta };
}
