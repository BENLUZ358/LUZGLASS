#!/usr/bin/env node
/**
 * PDF → תמונות JPEG לעמודים (api/_pdf-pages.js).
 * אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.3
 *
 * מה נבדק כאן:
 *   - קובץ סינתטי של 3 עמודים → 3 תמונות ברוחב 1600, JPEG אמיתי, לא ריק, קטן מ-400KB
 *   - יותר עמודים מהמותר → שגיאה בעברית עם שני המספרים (וגם כשדות: numPages, maxPages)
 *   - קריסה שאינה של הקובץ בציור עמוד → נזרקת כמו שהיא (תקלה זמנית)
 *   - קובץ חתוך / בייטים שאינם PDF → "פגום ולא נפתח"
 *   - מיפוי סיסמה (חיבור בדיקה _reasonFor)
 *   - vercel.json כולל את includeFiles (גופנים ו-cmaps) בשתי הפונקציות
 *
 * Run: node scripts/test-pdf-pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pp = require(path.join(ROOT, 'api', '_pdf-pages.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const CORRUPT = 'קובץ ה-PDF פגום ולא נפתח';

(async () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf', 'synthetic-3p.pdf'));

  const pages = await pp.lgPdfToJpegs(fixture);
  check('שלושה עמודים', pages.length, 3);
  pages.forEach((p, i) => {
    check(`עמוד ${i + 1}: רוחב 1600`, p.w, 1600);
    check(`עמוד ${i + 1}: גובה A4`, p.h >= 2200 && p.h <= 2300, true);
    check(`עמוד ${i + 1}: JPEG`, [p.bytes[0], p.bytes[1]], [0xFF, 0xD8]);
    check(`עמוד ${i + 1}: קטן מ-400KB`, p.bytes.length < 400 * 1024, true);
  });
  check('עמוד 1 לא ריק (>15KB)', pages[0].bytes.length > 15 * 1024, true);

  let err = null;
  try { await pp.lgPdfToJpegs(fixture, { maxPages: 2 }); } catch (e) { err = e; }
  check('maxPages: PdfError', err instanceof pp.PdfError, true);
  check('maxPages: סיבה מדויקת', err && err.reason, 'ב-PDF יש 3 עמודים — יותר מ-2, לטפל ידנית');
  check('maxPages: השגיאה נושאת את מספר העמודים ואת התקרה', [err && err.numPages, err && err.maxPages], [3, 2]);
  check('maxPages: name הוא PdfError (לזיהוי בלי instanceof)', err && err.name, 'PdfError');

  err = null;
  try { await pp.lgPdfToJpegs(fixture, { maxPages: 0 }); } catch (e) { err = e; }
  check('maxPages 0 ("לא נשאר מקום") נאכף, לא הופך ל-30', [err && err.numPages, err && err.maxPages], [3, 0]);

  // תקלה שאינה של הקובץ באמצע ציור עמוד (זיכרון / קנבס) — נזרקת כמו שהיא, לא PdfError.
  // טוענים עותק טרי של המודול אחרי שמחליפים את createCanvas, ומחזירים הכל בסוף.
  {
    const canvasMod = require('@napi-rs/canvas');
    const real = canvasMod.createCanvas;
    const modPath = require.resolve(path.join(ROOT, 'api', '_pdf-pages.js'));
    const keep = require.cache[modPath];
    delete require.cache[modPath];
    canvasMod.createCanvas = (w, h) => { if (w === 1600) throw new Error('out of memory'); return real(w, h); };
    let e2 = null;
    try { await require(modPath).lgPdfToJpegs(fixture); } catch (e) { e2 = e; }
    finally { canvasMod.createCanvas = real; require.cache[modPath] = keep; }
    check('קריסת קנבס בעמוד: נזרקת כמו שהיא (זמנית), לא PdfError',
          [e2 && e2.name, e2 && e2.message], ['Error', 'out of memory']);
  }

  err = null;
  try { await pp.lgPdfToJpegs(fixture.subarray(0, 2048)); } catch (e) { err = e; }
  check('קובץ חתוך: PdfError', err instanceof pp.PdfError, true);
  check('קובץ חתוך: סיבה', err && err.reason, CORRUPT);

  err = null;
  try { await pp.lgPdfToJpegs(Buffer.from('hello')); } catch (e) { err = e; }
  check('לא PDF: PdfError', err instanceof pp.PdfError, true);
  check('לא PDF: סיבה', err && err.reason, CORRUPT);

  check('סיסמה: מיפוי', pp._reasonFor({ name: 'PasswordException' }), 'ה-PDF מוגן בסיסמה — לבקש מהלקוח לשלוח בלי סיסמה');
  for (const n of ['InvalidPDFException', 'MissingPDFException', 'UnknownErrorException', 'FormatError']) {
    check('שגיאת קובץ: ' + n, pp._reasonFor({ name: n }), CORRUPT);
  }
  check('שגיאה שאינה של הקובץ: null', pp._reasonFor(new Error('out of memory')), null);
  check('לא שגיאה: null', pp._reasonFor(null), null);

  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const glob = 'node_modules/pdfjs-dist/{standard_fonts,cmaps}/**,node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
  for (const f of ['api/email-inbound.js', 'api/wa-inbound-drain.js']) {
    check(`vercel.json includeFiles: ${f}`, vj.functions[f] && vj.functions[f].includeFiles, glob);
    check(`vercel.json maxDuration נשמר: ${f}`, vj.functions[f] && vj.functions[f].maxDuration, 60);
  }

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nהכל עבר');
})().catch(e => { console.error(e); process.exit(1); });
