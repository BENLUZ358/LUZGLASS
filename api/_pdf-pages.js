/**
 * ══════════════════════════════════════════════════════════════════
 *  PDF → תמונות JPEG, עמוד לכל סקיצה (קליטת מייל / וואטסאפ, חלק 2)
 *  אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.3
 * ══════════════════════════════════════════════════════════════════
 *  מקבל Buffer של PDF ומחזיר תמונה לכל עמוד, לפי הסדר.
 *
 *  ⚠️ pdfjs-dist 4 הוא ESM בלבד והפרויקט CommonJS — לכן import() דינמי,
 *     נטען פעם אחת ונשמר (בלי זה כל קריאה טוענת את הספרייה מחדש).
 *  ⚠️ עמוד אחד בכל פעם, והקנבס משוחרר מיד — אחרת 30 עמודים ברוחב 1600
 *     יושבים בזיכרון יחד ופונקציית Vercel נופלת.
 *  ⚠️ מילוי לבן לפני הציור: PDF בלי רקע יוצא שחור ב-JPEG (אין שקיפות).
 *  ⚠️ standardFontDataUrl / cMapUrl חייבים להסתיים ב-path.sep, ושתי
 *     התיקיות חייבות להיכלל בפונקציה ב-vercel.json (includeFiles).
 *
 *  ⚠️ opts.deadline — רגע מוחלט (ms, לפי opts.clock) שאחריו לא מתחילים עמוד
 *     נוסף. הקורא מעביר את הדדליין של כל הבקשה (לא תקציב חדש לכל קובץ),
 *     אחרת תקציבים נערמים ופונקציית Vercel נהרגת באמצע. נבדק לפני כל עמוד.
 *
 *  שגיאה למשתמש: PdfError.reason — עברית פשוטה, מוצגת לבן.
 * ══════════════════════════════════════════════════════════════════
 */
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const PDF_TARGET_W = 1600;   // רוחב הדף בפיקסלים
const PDF_JPEG_Q   = 80;     // איכות JPEG
const PDF_MAX_PAGES = 30;    // יותר מזה — לא נקלט

const REASON_PASSWORD = 'ה-PDF מוגן בסיסמה — לבקש מהלקוח לשלוח בלי סיסמה';
const REASON_CORRUPT  = 'קובץ ה-PDF פגום ולא נפתח';
const REASON_SLOW     = 'עיבוד ה-PDF לקח יותר מדי זמן — לטפל ידנית';

class PdfError extends Error {
  //  extra — פרטים לקורא, למשל { numPages, maxPages } כשיש יותר מדי עמודים
  constructor(reason, extra) {
    super(reason);
    this.name = 'PdfError';
    this.reason = reason;
    if (extra) Object.assign(this, extra);
  }
}

// שגיאת pdfjs → סיבה בעברית. רק שגיאות של הקובץ עצמו ממופות; כל דבר אחר
// (זיכרון, רשת, באג) מחזיר null — והקורא מתייחס אליו כתקלה זמנית לניסיון חוזר.
const FILE_ERRORS = ['InvalidPDFException', 'MissingPDFException', 'UnknownErrorException', 'FormatError'];
function _reasonFor(err) {
  const name = err && err.name;
  if (name === 'PasswordException') return REASON_PASSWORD;
  if (FILE_ERRORS.includes(name)) return REASON_CORRUPT;
  return null;
}

// מפעל קנבס מינימלי ש-pdfjs משתמש בו לתמונות מוטמעות ולמסכות
class CanvasFactory {
  create(w, h) {
    const canvas = createCanvas(w, h);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}

let _pdfjsP = null;
function _pdfjs() {
  if (!_pdfjsP) {
    // ⚠️ טעינת ה-worker במפורש: כך Vercel מזהה את הקובץ ב-bundle, ו-pdfjs
    //    לא מנסה import() דינמי של נתיב שלא נארז.
    _pdfjsP = (async () => {
      globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })().catch(e => { _pdfjsP = null; throw e; });
  }
  return _pdfjsP;
}

async function lgPdfToJpegs(buf, opts) {
  const o = opts || {};
  // ⚠️ 0 הוא ערך תקין (הקורא: "לא נשאר מקום") — לא || שהיה הופך אותו ל-30
  const maxPages = o.maxPages != null ? o.maxPages : PDF_MAX_PAGES;
  const targetW  = o.targetW  || PDF_TARGET_W;
  const quality  = o.quality  || PDF_JPEG_Q;
  const clock    = o.clock || Date.now;
  const deadline = o.deadline != null ? o.deadline : Infinity;

  const pdfjs = await _pdfjs();
  const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // ⚠️ _fontDir — לבדיקות בלבד: תיקיית גופנים שגויה מוכיחה שהטקסט באמת מצויר
  const fontDir = o._fontDir || path.join(pdfjsDir, 'standard_fonts') + path.sep;

  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    CanvasFactory,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: fontDir,
    cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
    cMapPacked: true,
    stopAtErrors: true,   // עמוד פגום זורק שגיאה — הכל או כלום, אף פעם סקיצה חלקית
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const reason = _reasonFor(e);
    if (!reason) throw e;
    throw new PdfError(reason);
  }

  try {
    if (!doc.numPages) throw new PdfError('ב-PDF אין עמודים');
    if (doc.numPages > maxPages) {
      // numPages / maxPages — כדי שהקורא ידע איזו תקרה נפרצה (שלו או של ה-PDF)
      throw new PdfError(`ב-PDF יש ${doc.numPages} עמודים — יותר מ-${maxPages}, לטפל ידנית`,
                         { numPages: doc.numPages, maxPages });
    }

    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      // timedOut — הקורא הופך את זה לסיבה של כל המייל, לא של ה-PDF
      if (clock() > deadline) throw new PdfError(REASON_SLOW, { timedOut: true });
      let page;
      try {
        page = await doc.getPage(n);
        const scale = targetW / page.getViewport({ scale: 1 }).width;
        const vp = page.getViewport({ scale });
        const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const bytes = await canvas.encode('jpeg', quality);
        // opts.withText — גם הטקסט של העמוד (הזמנת רכש ממוחשבת, _po-pdf.js).
        // ⚠️ כשל בקריאת הטקסט לא מפיל את העמוד — הסקיצה נקלטת כמו תמיד, בלי שורות
        let text = null;
        if (o.withText) {
          try {
            text = (await page.getTextContent()).items
              .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
          } catch (e) { console.warn('pdf-pages: no text on page', n, e && e.name); }
        }
        out.push({ bytes, w: canvas.width, h: canvas.height, text });
        canvas.width = 0; canvas.height = 0;   // שחרור הזיכרון לפני העמוד הבא
      } catch (e) {
        // ⚠️ רק שגיאה של הקובץ עצמו הופכת לדחייה. זיכרון / באג בקנבס — נזרקים
        //    כמו שהם, והקורא מתייחס אליהם כתקלה זמנית (ניסיון חוזר).
        if (!_reasonFor(e)) throw e;
        console.warn('pdf-pages: page', n, e && e.name, e && String(e.message).slice(0, 200));
        throw new PdfError(`עמוד ${n} ב-PDF לא נפתח`);
      } finally {
        if (page) page.cleanup();
      }
    }
    return out;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

module.exports = { PDF_TARGET_W, PDF_JPEG_Q, PDF_MAX_PAGES, PdfError, lgPdfToJpegs, _reasonFor, _pdfjs };
