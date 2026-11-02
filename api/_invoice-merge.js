'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_invoice-merge.js — חשבונית + סקיצות בקובץ PDF אחד (בן, 2/11).
//
//  עוזר משותף, לא route. עמודי החשבונית (המקור) נכנסים כמו שהם, ואחריהם
//  עמוד A4 לכל סקיצה: כותרת למעלה (מספר הזמנה · שם הסקיצה) והתמונה מוקטנת
//  לשאר העמוד. JPG/PNG נכנסים ישר; WEBP/SVG מומרים ל-PNG.
//  כל תקלה (סקיצה פגומה, PDF לא קריא) → זורק. הקורא לא שולח חבילה חלקית.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const A4 = [595.28, 841.89];
const MARGIN = 28, TITLE = 22;

let _font = null;
const _fontBytes = () => _font || (_font = fs.readFileSync(path.join(__dirname, '_heebo.ttf')));

//  pdf-lib כותב משמאל לימין ובלי bidi. לעברית בלבד (אין חיבורי אותיות) מספיק
//  להפוך את סדר התווים; מספר ההזמנה (L1120) נכתב בנפרד, בכיוון שלו.
const _visual = s => [...String(s || '')].reverse().join('');

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

//  pdf: Buffer של המקור. sketches: [{ buf, mime, num, name }] → Buffer של PDF אחד.
async function lgInvoiceMerge(pdf, sketches) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const doc = await PDFDocument.load(_own(pdf));
  if (!doc.getPageCount()) throw new Error('empty invoice pdf');
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const font = (sketches || []).length ? await doc.embedFont(_fontBytes(), { subset: true }) : null;

  for (const s of sketches || []) {
    const img = s.mime === 'image/jpeg' ? await doc.embedJpg(_own(s.buf))
              : s.mime === 'image/png'  ? await doc.embedPng(_own(s.buf))
              :                           await doc.embedPng(_own(await _toPng(s.buf)));
    const page = doc.addPage(A4);
    const [W, H] = A4;
    //  כותרת: מספר ההזמנה משמאל, "סקיצה · שם" מימין
    const num = String(s.num || '');
    if (num) page.drawText(num, { x: MARGIN, y: H - MARGIN - 14, size: 14, font, color: rgb(0, 0, 0) });
    const he = _visual('סקיצה' + (s.name ? ' · ' + s.name : ''));
    page.drawText(he, { x: W - MARGIN - font.widthOfTextAtSize(he, 14), y: H - MARGIN - 14, size: 14, font, color: rgb(0, 0, 0) });
    const boxW = W - 2 * MARGIN, boxH = H - 2 * MARGIN - TITLE;
    const k = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (W - w) / 2, y: MARGIN + (boxH - h) / 2, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}

module.exports = { lgInvoiceMerge };
