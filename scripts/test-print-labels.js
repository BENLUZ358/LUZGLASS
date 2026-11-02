#!/usr/bin/env node
/**
 * מדבקות מחיסום — המודל, הציור והאריזה (print-labels.js). בן, 3/11.
 *   A. מדבקה לכל זכוכית שהגיעה (idxs), לא לשאר. קבוצה של 3 עם 2 שהגיעו → 2.
 *   B. התוכן: שם הלקוח, מידה רוחב × גובה, שם הסקיצה, מספר הזמנה.
 *   C. אריזה: 560×560 → 70 בתים לשורה; לבן = 1, שחור = 0 (TSPL מדפיס 0).
 *   D. שם ארוך מתכווץ עד שנכנס ברוחב — לא נחתך בשקט.
 * Run: node scripts/test-print-labels.js
 */
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'api', '_heebo.ttf'), 'Heebo');
const PL = require(path.join(__dirname, '..', 'print-labels.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const it = (w, h) => ({ name: 'שקוף 8', w, h });
const O1 = { id: 'o1', orderNum: 'L1200', orderClient: 'המקום לאמבט', sketchName: 'אסף', items: [it(500, 2000), it(600, 2000), it(600, 2000), it(600, 2000)] };
const O2 = { id: 'o2', orderNum: 'L1201', orderClient: 'המקום לאמבט', sketchName: '', items: [it(885, 1985)] };

/* A + B */
const labels = PL.lgLabelsForClient([{ order: O1, idxs: [0, 1, 3] }, { order: O2, idxs: [] }]);
check('A1 one label per arrived glass, none for the rest', labels.length, 3);
check('B1 content', labels[0], { title: 'המקום לאמבט', dims: '500 × 2000', sketch: 'אסף', orderNum: 'L1200', orderId: 'o1', idx: 0 });
check('A2 in item order', labels.map(l => l.idx), [0, 1, 3]);
check('B2 no sketch name → empty, not "undefined"', PL.lgLabelsForClient([{ order: O2, idxs: [0] }])[0].sketch, '');

/* C */
const W = PL.LG_LABEL_PX;
check('C0 560 dots = 70 mm at 203 dpi', W, 560);
const white = createCanvas(W, W), wc = white.getContext('2d');
wc.fillStyle = '#fff'; wc.fillRect(0, 0, W, W);
const pw = Buffer.from(PL.lgLabelPack(wc.getImageData(0, 0, W, W)), 'base64');
check('C1 70 bytes × 560 rows', pw.length, 39200);
check('C2 white → all bits 1', pw.every(b => b === 0xFF), true);
wc.fillStyle = '#000'; wc.fillRect(0, 0, 8, 1);
const pb = Buffer.from(PL.lgLabelPack(wc.getImageData(0, 0, W, W)), 'base64');
check('C3 black → 0, first pixel is the high bit', [pb[0], pb[1], pb[70]], [0x00, 0xFF, 0xFF]);

/* D + drawing */
const c = createCanvas(W, W), ctx = c.getContext('2d');
PL.lgLabelDraw(ctx, labels[0]);
const px = Buffer.from(PL.lgLabelPack(ctx.getImageData(0, 0, W, W)), 'base64');
check('D1 something black is drawn', px.some(b => b !== 0xFF), true);
const long = { ...labels[0], sketch: 'מקלחון פינתי גדול עם דלת הזזה ומדף זכוכית בקומה השנייה', title: 'א.מ. מראות וזכוכית בע"מ סניף ראשי' };
const sizes = PL.lgLabelDraw(ctx, long);
check('D2 long lines are shrunk to fit the width', sizes.every(s => s.width <= W - 40), true);
check('D3 and the text is kept (ellipsis only if even the smallest size cannot fit)', sizes.filter(s => s.cut).length <= 1, true);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
