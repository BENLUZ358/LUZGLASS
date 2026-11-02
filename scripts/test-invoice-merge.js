'use strict';
// בן, 2/11: הלקוח מקבל קובץ PDF אחד — עמודי החשבונית (המקור) כמו שהם, ואחריהם
// כל סקיצה בעמוד A4 משלה עם כותרת (מספר הזמנה + שם הסקיצה).
// Run: node scripts/test-invoice-merge.js
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
const { lgInvoiceMerge } = require('../api/_invoice-merge');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok ' + name); }

async function invoicePdf(pages) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText('page ' + (i + 1));
  return Buffer.from(await d.save());
}
function image(mime, w, h) {
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#c33'; g.fillRect(0, 0, w, h);
  return c.toBuffer(mime);
}

(async () => {
  await test('invoice pages first, unchanged; then one page per sketch', async () => {
    const out = await lgInvoiceMerge(await invoicePdf(2), [
      { buf: image('image/jpeg', 800, 600), mime: 'image/jpeg', num: 'L1120', name: 'טל יצחקי' },
      { buf: image('image/png', 300, 900), mime: 'image/png', num: 'L1121', name: 'מאור עיני' },
    ]);
    const d = await PDFDocument.load(out);
    assert.equal(d.getPageCount(), 4);
    assert.deepEqual(d.getPage(0).getSize(), { width: 595, height: 842 });
    assert.equal(out.subarray(0, 5).toString(), '%PDF-');
  });
  await test('webp sketch is converted, not dropped', async () => {
    const out = await lgInvoiceMerge(await invoicePdf(1), [{ buf: image('image/webp', 400, 400), mime: 'image/webp', num: 'L1', name: '' }]);
    assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  });
  await test('svg sketch is converted, not dropped', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>');
    const out = await lgInvoiceMerge(await invoicePdf(1), [{ buf: svg, mime: 'image/svg+xml', num: 'L2', name: 'מקלחון' }]);
    assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  });
  //  סקיצה שמגיעה מ-base64 היא Buffer קטן בתוך זיכרון משותף (byteOffset ≠ 0) — כך היא באמת
  //  מגיעה מ-Firebase. pdf-lib קרא מתחילת הזיכרון ונכשל ("SOI not found in JPEG").
  await test('sketches decoded from base64 (pooled buffers) embed fine', async () => {
    const j = Buffer.from(image('image/jpeg', 40, 30).toString('base64'), 'base64');
    const p = Buffer.from(image('image/png', 40, 30).toString('base64'), 'base64');
    const pdf = Buffer.from((await invoicePdf(1)).toString('base64'), 'base64');
    const out = await lgInvoiceMerge(pdf, [{ buf: j, mime: 'image/jpeg', num: 'L1', name: '' }, { buf: p, mime: 'image/png', num: 'L2', name: '' }]);
    assert.equal((await PDFDocument.load(out)).getPageCount(), 3);
  });
  await test('a broken sketch throws — the caller never sends a partial package', async () => {
    await assert.rejects(lgInvoiceMerge(await invoicePdf(1), [{ buf: Buffer.from('not an image'), mime: 'image/jpeg', num: 'L3', name: '' }]));
  });
  await test('a broken invoice PDF throws', async () => {
    await assert.rejects(lgInvoiceMerge(Buffer.from('%PDF-1.4 nothing'), []));
  });
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
