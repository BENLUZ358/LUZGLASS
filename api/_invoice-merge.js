'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_invoice-merge.js — חשבונית + סקיצות בקובץ PDF אחד (בן, 2/11).
//
//  עוזר משותף, לא route. עמודי החשבונית (המקור) נכנסים כמו שהם, ואחריהם
//  עמוד A4 לכל סקיצה: פס כותרת למעלה (שם הסקיצה בגדול, ומתחתיו הזמנה ·
//  לקוח · חשבונית) והתמונה מוקטנת לשאר העמוד. JPG/PNG נכנסים ישר;
//  WEBP/SVG מומרים ל-PNG.
//  כל תקלה (סקיצה פגומה, PDF לא קריא) → זורק. הקורא (_invoice-deliver)
//  בודק כל סקיצה לבד ומשמיט את מה שנכשל.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const A4 = [595.28, 841.89];
//  בן, 4/11: "השם של הסקיצה יותר ברור וגדול" — קודם הכל היה בשורה אחת בגודל 14.
const MARGIN = 28, NAME_SIZE = 30, INFO_SIZE = 17, BAND = 96;

let _font = null;
const _fontBytes = () => _font || (_font = fs.readFileSync(path.join(__dirname, '_heebo.ttf')));

//  ⚠️ fontkit (בתוך pdf-lib) כבר הופך שורה שיש בה עברית — את כל התווים, גם
//  ספרות. עד 4/11 הפכנו גם כאן, ולכן העברית בעמודי הסקיצות יצאה הפוכה.
//  עכשיו: טקסט רגיל, ורק רצפי ספרות / אותיות לועזיות הפוכים מראש, כדי
//  שאחרי ההיפוך של fontkit "L1120" ו"דירה 12" ייצאו נכון. בלי עברית — כמו שהוא.
const _visual = s => {
  const t = String(s || '');
  if (!/[֐-׿]/.test(t)) return t;
  return t.replace(/[A-Za-z0-9][A-Za-z0-9.,:/\-×]*[A-Za-z0-9]|[A-Za-z0-9]/g, m => [...m].reverse().join(''));
};

async function _toPng(buf) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(buf);
  if (!img.width || !img.height) throw new Error('empty image');
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toBuffer('image/png');
}

//  ⚠️ Buffer מ-base64 (כך מגיעות הסקיצות מ-Firebase) יושב בתוך זיכרון משותף
//  (byteOffset ≠ 0), ו-pdf-lib קורא מתחילת הזיכרון — "SOI not found in JPEG".
//  עותק עצמאי לכל קלט.
const _own = b => new Uint8Array(b);

//  גודל הכי גדול (עד max) שבו הטקסט נכנס ברוחב
function _fit(font, text, max, min, width) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 1;
  return size;
}

//  pdf: Buffer של המקור. sketches: [{ buf, mime, num, name }] → Buffer של PDF אחד.
//  meta (רשות): { docNumber, client } — נכתבים בשורת הפרטים בכל עמוד סקיצה.
async function lgInvoiceMerge(pdf, sketches, meta) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const doc = await PDFDocument.load(_own(pdf));
  if (!doc.getPageCount()) throw new Error('empty invoice pdf');
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const list = sketches || [];
  const font = list.length ? await doc.embedFont(_fontBytes(), { subset: true }) : null;
  const m = meta || {};
  const black = rgb(0, 0, 0), grey = rgb(0.35, 0.35, 0.35);

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const img = s.mime === 'image/jpeg' ? await doc.embedJpg(_own(s.buf))
              : s.mime === 'image/png'  ? await doc.embedPng(_own(s.buf))
              :                           await doc.embedPng(_own(await _toPng(s.buf)));
    const page = doc.addPage(A4);
    const [W, H] = A4;
    const top = H - MARGIN, right = W - MARGIN - 14;
    page.drawRectangle({ x: MARGIN, y: top - BAND, width: W - 2 * MARGIN, height: BAND, color: rgb(0.93, 0.93, 0.93) });

    //  שורה 1, מימין: שם הסקיצה בגדול (שם ארוך מוקטן עד שנכנס)
    const name = _visual(String(s.name || '').trim() || 'סקיצה');
    const ns = _fit(font, name, NAME_SIZE, 16, W - 2 * MARGIN - 110);
    page.drawText(name, { x: right - font.widthOfTextAtSize(name, ns), y: top - 14 - ns, size: ns, font, color: black });
    //  שורה 1, משמאל: "3 / 6"
    if (list.length > 1) {
      page.drawText((i + 1) + ' / ' + list.length, { x: MARGIN + 14, y: top - 14 - INFO_SIZE - 4, size: INFO_SIZE, font, color: grey });
    }
    //  שורה 2, מימין: הזמנה · לקוח · חשבונית
    const info = _visual([s.num ? 'הזמנה ' + s.num : '', String(m.client || '').trim(),
                          m.docNumber ? 'חשבונית ' + m.docNumber : ''].filter(Boolean).join('   ·   '));
    if (info) {
      const is = _fit(font, info, INFO_SIZE, 11, W - 2 * MARGIN - 28);
      page.drawText(info, { x: right - font.widthOfTextAtSize(info, is), y: top - BAND + 16, size: is, font, color: black });
    }

    const boxW = W - 2 * MARGIN, boxH = H - 2 * MARGIN - BAND - 10;
    const k = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (W - w) / 2, y: MARGIN + (boxH - h) / 2, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}

module.exports = { lgInvoiceMerge, _visual };
