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
//
//  ⚠️ fontkit מחליט אם להפוך לפי האות הראשונה שיש לה כתב (ספרות ורווחים לא
//  נחשבים): שורה שמתחילה באות לועזית ("L9902 · לקוח") לא מתהפכת והעברית בה
//  יוצאת הפוכה (בן, 13/11). לכן שורות מתחילות במילה בעברית ("הזמנה L9902").
//  כשההיפוך קורה, fontkit לא מחליף סוגריים — ")לחבר(" — אז מחליפים כאן מראש.
const _MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
const _visual = s => {
  const t = String(s || '');
  if (!/[֐-׿]/.test(t)) return t;
  const runs = t.replace(/[A-Za-z0-9][A-Za-z0-9.,:/\-×]*[A-Za-z0-9]|[A-Za-z0-9]/g, m => [...m].reverse().join(''));
  const first = t.match(/[A-Za-z֐-׿]/);
  return first && /[֐-׿]/.test(first[0]) ? runs.replace(/[()[\]{}]/g, c => _MIRROR[c]) : runs;
};

async function _toPng(buf) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(buf);
  if (!img.width || !img.height) throw new Error('empty image');
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toBuffer('image/png');
}

//  תמונה מעל maxBytes → JPEG מתחת לזה (רקע לבן; קודם איכות, אחר כך מקטינים).
//  לקבצים שיוצאים אחד-אחד בתשובה של Vercel (תקרה 4.5MB, ו-base64 מוסיף שליש).
//  → { buf, mime } — תמונה שכבר קטנה מספיק חוזרת כמו שהיא. לא מצליח → זורק.
async function lgShrinkImage(buf, mime, maxBytes) {
  if (buf.length <= maxBytes) return { buf, mime };
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(buf);
  if (!img.width || !img.height) throw new Error('empty image');
  let scale = 1;
  for (let i = 0; i < 12; i++) {
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = c.toBuffer('image/jpeg', i === 0 ? 85 : 75);
    if (out.length <= maxBytes) return { buf: out, mime: 'image/jpeg' };
    scale *= 0.75;
  }
  throw new Error('image too large');
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

//  עמוד A4 אחד לסקיצה: פס כותרת (title בגדול, info מתחת, "3 / 6" משמאל) והתמונה.
//  img = { buf, mime } או null → "אין סקיצה" במקום התמונה (משלוח לשרטט, 10/11).
//  תמונה פגומה → זורק (החשבונית משמיטה; השרטט — הקורא תופס ומעביר null).
async function lgAddSketchPage(doc, font, img, head) {
  const { rgb } = require('pdf-lib');
  const black = rgb(0, 0, 0), grey = rgb(0.35, 0.35, 0.35);
  const h0 = head || {};
  const pic = !img ? null
            : img.mime === 'image/jpeg' ? await doc.embedJpg(_own(img.buf))
            : img.mime === 'image/png'  ? await doc.embedPng(_own(img.buf))
            :                             await doc.embedPng(_own(await _toPng(img.buf)));
  const page = doc.addPage(A4);
  const [W, H] = A4;
  const top = H - MARGIN, right = W - MARGIN - 14;
  page.drawRectangle({ x: MARGIN, y: top - BAND, width: W - 2 * MARGIN, height: BAND, color: rgb(0.93, 0.93, 0.93) });

  //  שורה 1, מימין: שם הסקיצה בגדול (שם ארוך מוקטן עד שנכנס)
  const name = _visual(String(h0.title || '').trim() || 'סקיצה');
  const ns = _fit(font, name, NAME_SIZE, 16, W - 2 * MARGIN - 110);
  page.drawText(name, { x: right - font.widthOfTextAtSize(name, ns), y: top - 14 - ns, size: ns, font, color: black });
  //  שורה 1, משמאל: "3 / 6"
  if (h0.total > 1) {
    page.drawText((h0.idx + 1) + ' / ' + h0.total, { x: MARGIN + 14, y: top - 14 - INFO_SIZE - 4, size: INFO_SIZE, font, color: grey });
  }
  //  שורה 2, מימין: הזמנה · לקוח · ...
  const info = _visual(String(h0.info || ''));
  if (info) {
    const is = _fit(font, info, INFO_SIZE, 11, W - 2 * MARGIN - 28);
    page.drawText(info, { x: right - font.widthOfTextAtSize(info, is), y: top - BAND + 16, size: is, font, color: black });
  }

  const boxW = W - 2 * MARGIN, boxH = H - 2 * MARGIN - BAND - 10;
  if (!pic) {
    const t = _visual('אין סקיצה');
    page.drawText(t, { x: (W - font.widthOfTextAtSize(t, 28)) / 2, y: MARGIN + boxH / 2, size: 28, font, color: grey });
    return page;
  }
  const k = Math.min(boxW / pic.width, boxH / pic.height);
  const w = pic.width * k, h = pic.height * k;
  page.drawImage(pic, { x: (W - w) / 2, y: MARGIN + (boxH - h) / 2, width: w, height: h });
  return page;
}

//  pdf: Buffer של המקור. sketches: [{ buf, mime, num, name }] → Buffer של PDF אחד.
//  meta (רשות): { docNumber, client } — נכתבים בשורת הפרטים בכל עמוד סקיצה.
async function lgInvoiceMerge(pdf, sketches, meta) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(_own(pdf));
  if (!doc.getPageCount()) throw new Error('empty invoice pdf');
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const list = sketches || [];
  const font = list.length ? await doc.embedFont(_fontBytes(), { subset: true }) : null;
  const m = meta || {};
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    await lgAddSketchPage(doc, font, { buf: s.buf, mime: s.mime }, {
      title: String(s.name || '').trim() || 'סקיצה',
      info: [s.num ? 'הזמנה ' + s.num : '', String(m.client || '').trim(), m.docNumber ? 'חשבונית ' + m.docNumber : ''].filter(Boolean).join('   ·   '),
      idx: i, total: list.length });
  }
  return Buffer.from(await doc.save());
}

module.exports = { lgInvoiceMerge, lgAddSketchPage, lgShrinkImage, _visual, _fontBytes, A4 };
