// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-parse.js  v1.0
//  ספריית עזר לפירוש קלט מידות — standalone (ללא Firebase)
//  כלול על-ידי: firebase-db.js (בעקיפין), mekhlahon.html, sketch-demo.html
// ════════════════════════════════════════════════════════════════════════
//
//  חוק הפירוש (חשבשבת):
//    קלט עם נקודה   → מטרים × 1000  (.885→885  1.95→1950  3.01→3010)
//    שלם עד 300     → ס"מ × 10       (44→440   195→1950   300→3000)
//    שלם מעל 300    → מ"מ ישיר       (445→445  885→885   3010→3010)
//    גבול 300 לפירוש הקלט בלבד — לא גבול עסקי.
//    ולידציה עסקית: 1–5000 מ"מ.
//
//  פונקציות:
//    lgParseDimensionInput(str) → { ok, mm } | { ok:false, error }
//    lgMmToMeterStr(mm)         → "0.885"  (לשדות עריכה — ללא אפסים מיותרים)
//    lgDimPreviewText(raw)      → "195 = 1950 מ״מ"  (לתצוגה חיה)

function lgParseDimensionInput(rawStr) {
  const s = String(rawStr ?? '').trim().replace(',', '.');
  if (!s) return { ok: false, error: 'יש להזין מידה' };

  const hasDecimal = s.includes('.');
  const n = parseFloat(s);

  if (isNaN(n) || !isFinite(n)) return { ok: false, error: 'יש להזין מספר תקין' };
  if (n <= 0) return { ok: false, error: 'יש להזין מידה חיובית' };

  let mm;
  if (hasDecimal) {
    mm = Math.round(n * 1000);
  } else {
    const intVal = Math.trunc(n);
    mm = intVal <= 300 ? intVal * 10 : intVal;
  }

  if (mm < 1)    return { ok: false, error: `מידה קטנה מדי (${mm} מ"מ)` };
  if (mm > 5000) return { ok: false, error: `מידה גדולה מדי — ${mm} מ"מ (מקסימום 5000 מ"מ)` };

  return { ok: true, mm };
}

// 885 → "0.885"  /  1900 → "1.9"  /  2000 → "2"  (ללא trailing zeros)
function lgMmToMeterStr(mm) {
  if (mm == null || mm === '') return '';
  return (mm / 1000).toString();
}

// "195" → "195 = 1950 מ"מ"  /  "abc" → "יש להזין מספר תקין"  /  "" → ""
function lgDimPreviewText(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const r = lgParseDimensionInput(s);
  return r.ok ? s + ' → ' + r.mm + ' מ"מ' : r.error;
}
