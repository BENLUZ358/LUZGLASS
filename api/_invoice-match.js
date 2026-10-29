// ═══════════════════════════════════════════════════════════════════
//  api/_invoice-match.js — זיהוי חשבונית מודפסת (DB-00004).
//
//  עוזר משותף, לא route. לוגיקה טהורה בלבד (חוץ מ-lgPdfPageTexts) כדי
//  שאפשר לבדוק אותה בלי PDF אמיתי.
//
//  כוונן מול חשבונית אמיתית (67346, 29/10): חשבשבת מדפיס "חשבונית מס 67346",
//  "תאריך 29/10/2026", "מפתח 99" (כרטיס הלקוח) ו"מקור" / "העתק 1", בסדר לוגי.
//  שם הסקיצה לא מודפס על החשבונית — השיוך לפי מספר מסמך + כרטיס לקוח.
//  כל אי-ודאות מחזירה "לא זוהה", לעולם לא ניחוש.
// ═══════════════════════════════════════════════════════════════════

//  רווחים/סימני כיוון/גרשיים אחידים, כדי ששם סקיצה יתאים גם אחרי PDF.
function norm(s) {
  return String(s || '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[׳’‘`]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

//  pdfjs מחזיר לפעמים עברית בסדר ויזואלי (הפוך). בודקים את שני הכיוונים.
function _hay(text) {
  const n = norm(text);
  return [n, [...n].reverse().join('')];
}
function _has(text, needle) {
  const w = norm(needle);
  return !!w && _hay(text).some(h => h.includes(w));
}

//  'original' | 'copy' | null.
//  "העתק" גובר: דף שכתוב בו העתק לעולם לא יוגדר כמקור (כיוון בטוח).
//  מקור דורש "מקור" ואפס "העתק".
function pageRole(text) {
  if (_has(text, 'העתק')) return 'copy';
  if (_has(text, 'מקור')) return 'original';
  return null;
}

//  מספר מסמך: ספרות אחרי "חשבונית (מס)" / "מס'" / "מספר". null אם לא ברור.
function extractDocNumber(text) {
  const t = norm(text);
  const m = t.match(/(?:חשבונית(?: מס)?(?: קבלה)?|מס'|מספר)\s*[:#]?\s*(\d{4,9})\b/);
  return m ? m[1] : null;
}

//  תאריך dd/mm/yyyy | dd.mm.yy → ISO 'YYYY-MM-DD', או null.
function extractDate(text) {
  const m = norm(text).match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

//  כרטיס הלקוח בחשבשבת: "מפתח 99". null אם לא ברור.
function extractAccountKey(text) {
  const m = norm(text).match(/מפתח\s*:?\s*(\d{1,9})(?!\d)/);
  return m ? m[1] : null;
}

//  מספרים שלמים שעומדים לבד בטקסט (3–9 ספרות, אפשר עם L לפני) — המועמדים
//  למספרי הזמנה בטור "מ.מקור". בלי נקודה עשרונית: מחיר 1115.00 לא נספר.
function extractRefs(text) {
  const out = new Set();
  for (const t of norm(text).split(' ')) {
    const m = t.match(/^l?(\d{3,9})$/);
    if (m) out.add(String(Number(m[1])));
  }
  return [...out];
}

//  האם החשבונית המודפסת שייכת לחשבונית ממתינה.
//  מספר מסמך רשום שאינו תואם → false.
//  יש כרטיס לקוח ברשומה → חייב להופיע זהה ב"מפתח".
//  אין (רשומה ישנה) → כל שמות הסקיצות בטקסט; שם ריק/כפול → false.
function matchesPending(text, pending) {
  const dn = extractDocNumber(text);
  if (pending.docNumber && dn !== String(pending.docNumber)) return false;
  if (pending.accountKey) return extractAccountKey(text) === String(pending.accountKey);
  const names = (pending.sketchNames || []).map(norm);
  if (!names.length || names.some(n => !n)) return false;
  if (new Set(names).size !== names.length) return false;
  return names.every(n => _has(text, n));
}

//  מחזיר { ok, key } כשיש בדיוק חשבונית ממתינה אחת שמתאימה; אחרת
//  { ok:false, code:'no-match'|'ambiguous' }.
function pickPending(text, pendingMap) {
  const hits = Object.keys(pendingMap || {}).filter(k => matchesPending(text, pendingMap[k]));
  if (hits.length === 1) return { ok: true, key: hits[0] };
  return { ok: false, code: hits.length ? 'ambiguous' : 'no-match' };
}

//  טקסט לכל עמוד ב-PDF. זורק PdfError על קובץ פגום (ר' _pdf-pages).
async function lgPdfPageTexts(buf) {
  const pp = require('./_pdf-pages');
  const pdfjs = await pp._pdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false,
    stopAtErrors: true, verbosity: 0,
  });
  let doc;
  try { doc = await task.promise; } catch (e) {
    await task.destroy().catch(() => {});
    const reason = pp._reasonFor(e);
    if (!reason) throw e;
    throw new pp.PdfError(reason);
  }
  try {
    if (doc.numPages > 5) throw new pp.PdfError(`ב-PDF יש ${doc.numPages} עמודים, צפוי עמוד אחד`);
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      out.push(tc.items.map(i => i.str).join(' '));
      page.cleanup();
    }
    return out;
  } finally { await doc.destroy().catch(() => {}); }
}

module.exports = { norm, pageRole, extractDocNumber, extractDate, extractAccountKey, extractRefs, matchesPending, pickPending, lgPdfPageTexts };
