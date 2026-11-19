#!/usr/bin/env node
/** חיתוך סקיצה לעמוד "לשרטט" (בן, 19/11 — המקום לאמבט: צילום של דף על שולחן יצא קטנטן).
 *  Run: node scripts/test-sketch-fit.js */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const F = require(path.join(ROOT, 'api', '_sketch-fit.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const jpg = draw => { const c = createCanvas(1080, 1920); const x = c.getContext('2d'); draw(x); return { buf: c.toBuffer('image/jpeg', 90), mime: 'image/jpeg' }; };
const pen = (x, color) => { x.strokeStyle = color || '#1a2a9a'; x.lineWidth = 6; };

(async () => {
  //  1. צילום: שולחן חום, דף לבן באמצע-למעלה, ציור על החלק העליון של הדף, ברכיים למטה
  const photo = jpg(x => {
    x.fillStyle = '#9a6b3c'; x.fillRect(0, 0, 1080, 1920);              // שולחן
    x.fillStyle = '#d9dde3'; x.fillRect(0, 0, 1080, 120);               // דפים אחרים למעלה (עם מרווח)
    x.fillStyle = '#2d3e66'; x.fillRect(0, 1550, 1080, 370);            // ג'ינס
    x.fillStyle = '#eef0f2'; x.fillRect(180, 300, 720, 1020);           // הדף
    pen(x); x.strokeRect(260, 380, 240, 420); x.strokeRect(580, 380, 240, 420);
    x.fillStyle = '#d02020'; x.font = '60px sans-serif'; x.fillText('8 mm', 560, 900);
  });
  const r1 = await F.lgFitSketch(photo);
  check('photo of a sheet → cropped JPEG', [!!r1.crop, r1.mime], [true, 'image/jpeg']);
  const c = r1.crop || { x: 0, y: 0, w: 1080, h: 1920 };
  check('crop is inside the sheet (no desk / jeans / other papers)', [c.x >= 170, c.y >= 290, c.x + c.w <= 910, c.y + c.h <= 1330], [true, true, true, true]);
  check('crop keeps the whole drawing and the red text', [c.x <= 260, c.y <= 380, c.x + c.w >= 820, c.y + c.h >= 900], [true, true, true, true]);
  check('cropped picture is much smaller than the photo', c.w * c.h < 0.4 * 1080 * 1920, true);
  const back = await loadImage(r1.buf);
  check('output size = crop', [back.width, back.height], [c.w, c.h]);

  //  2. סקיצה מהמערכת: רקע לבן, ציור על כל הדף → לא נוגעים
  const full = jpg(x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 1080, 1920); pen(x); x.strokeRect(40, 40, 1000, 1840); x.strokeRect(300, 600, 400, 600); });
  check('drawing fills the image → unchanged', (await F.lgFitSketch(full)).buf === full.buf, true);

  //  3. רקע לבן, ציור קטן בפינה → נחתכים השוליים הלבנים
  const corner = jpg(x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 1080, 1920); pen(x); x.strokeRect(100, 100, 400, 500); x.beginPath(); x.moveTo(100, 100); x.lineTo(500, 600); x.stroke(); });
  const r3 = await F.lgFitSketch(corner);
  check('small drawing on white → white margins cut', !!r3.crop && r3.crop.w < 600 && r3.crop.h < 750 && r3.crop.x <= 100 && r3.crop.y <= 100, true);

  //  4. שני מלבנים סגורים זה ליד זה (L1300) — לא נחתך לאחד מהם
  const two = jpg(x => { x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 1080, 1920); pen(x, '#333'); x.strokeRect(60, 300, 420, 1300); x.strokeRect(600, 300, 420, 1300); x.fillStyle = '#ddd'; x.fillRect(80, 320, 380, 1260); });
  const r4 = await F.lgFitSketch(two);
  const c4 = r4.crop || { x: 0, w: 1080 };
  check('two closed boxes → both stay in the picture', [c4.x <= 60, c4.x + c4.w >= 1020], [true, true]);

  //  5. קבצים שבורים / לא תמונה → כמו שהם, בלי לקרוס (napi-rs קורס על קובץ קצר)
  const bad = { buf: Buffer.from('AAAA', 'base64'), mime: 'image/png' };
  check('broken image → unchanged', (await F.lgFitSketch(bad)) === bad, true);
  const cut = { buf: photo.buf.slice(0, 5000), mime: 'image/jpeg' };
  check('truncated JPEG → unchanged', (await F.lgFitSketch(cut)) === cut, true);
  check('null / svg → as is', [await F.lgFitSketch(null), (await F.lgFitSketch({ buf: Buffer.from('<svg/>'), mime: 'image/svg+xml' })).mime], [null, 'image/svg+xml']);

  //  6. הטיוטה והמשלוח לשרטט עוברים דרך החיתוך (רק תמונות, לא הודעות טקסט)
  const SRC = fs.readFileSync(path.join(ROOT, 'api', '_drafter-batch.js'), 'utf8');
  check('drafter items crop the sketch image', /const d = d0 && \/\^image\\\/\/\.test\(d0\.mime\) && !\/svg\/\.test\(d0\.mime\) \? await require\('\.\/_sketch-fit'\)\.lgFitSketch\(d0\) : d0;/.test(SRC), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll sketch-fit checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
