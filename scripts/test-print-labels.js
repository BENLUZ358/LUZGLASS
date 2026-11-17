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
check('B1 content', labels[0], { title: 'המקום לאמבט', dims: '500 × 2000', sketchName: 'אסף', glass: 'שקוף 8', orderNum: 'L1200', shape: '', job: '', orderId: 'o1', idx: 0 });
check('A2 in item order', labels.map(l => l.idx), [0, 1, 3]);
{   //  סוג הזכוכית + "שבר" (בן, 16/11) — נכתבים על המדבקה
  const texts = [];
  const rec = new Proxy({ measureText: t => ({ width: String(t).length * 10 }), fillText: t => texts.push(String(t)) }, { get: (o, k) => k in o ? o[k] : () => {}, set: () => true });
  PL.lgLabelDraw(rec, { title: 'נאור', dims: '1 × 2', sketchName: 'ז', glass: 'שקוף 8', orderNum: 'L1', broken: true });
  check('B3 glass type and "שבר" are drawn', [texts.includes('שקוף 8'), texts.includes('שבר')], [true, true]);
  texts.length = 0; PL.lgLabelDraw(rec, { title: 'נאור', dims: '1 × 2', sketchName: 'ז', orderNum: 'L1' });
  check('B4 no flag → no "שבר"', texts.includes('שבר'), false);
}
{   //  מדבקת לוח (בן, 17/11): "לוח 1/4", האופטימיזציה, סוג הזכוכית, כמה זכוכיות — בלי מידה
  const texts = [];
  const rec = new Proxy({ measureText: t => ({ width: String(t).length * 10 }), fillText: t => texts.push(String(t)) }, { get: (o, k) => k in o ? o[k] : () => {}, set: () => true });
  PL.lgLabelDraw(rec, { marker: 'לוח 1/4', job: 'M00337', mat: '10S · 10 שקוף', pieces: 7, dims: '1 × 2' });
  check('B5 marker label: sheet, job, glass, count; no size', [texts.includes('לוח 1/4'), texts.includes('M00337'), texts.includes('10S · 10 שקוף'), texts.includes('7 זכוכיות'), texts.includes('1 × 2')], [true, true, true, true, false]);
}
check('B2 no sketch name → empty, not "undefined"', PL.lgLabelsForClient([{ order: O2, idxs: [0] }])[0].sketchName, '');

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
const long = { ...labels[0], sketchName: 'מקלחון פינתי גדול עם דלת הזזה ומדף זכוכית בקומה השנייה', title: 'א.מ. מראות וזכוכית בע"מ סניף ראשי' };
const sizes = PL.lgLabelDraw(ctx, long);
check('D2 long lines are shrunk to fit the width', sizes.every(s => s.width <= W - 40), true);
check('D3 and the text is kept (ellipsis only if even the smallest size cannot fit)', sizes.filter(s => s.cut).length <= 1, true);

/* E — מספר צורה מאופטי-ווי (בן, 16/11) */
const O3 = { ...O1, items: [{ ...it(502, 1902), optyShape: '274328' }] };
check('E1 shape number travels from the item to the label', PL.lgLabelsForClient([{ order: O3, idxs: [0] }])[0].shape, '274328');
const ink = l => { const cc = createCanvas(W, W), x = cc.getContext('2d'); PL.lgLabelDraw(x, l);
  const d = x.getImageData(W - 200, 515, 180, 40).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; };
//  17/11 (בן): "מספר השייפ בגדול, סוג הזכוכית בקטן" — הצורה עברה מהפינה לשורה גדולה מעל השורה התחתונה
const sz = l => { const cc = createCanvas(W, W); return PL.lgLabelDraw(cc.getContext('2d'), l); };
const withShape = sz({ ...labels[0], glass: '8 אקסטרה קליר', shape: '274328' }), noShape = sz({ ...labels[0], glass: '8 אקסטרה קליר' });
check('E2 shape number is the biggest line; glass type small above it', [Math.max(...withShape.map(x => x.size)) >= 64, withShape[withShape.length - 2].size <= 30, withShape.every(x => x.width <= W - 40)], [true, true, true]);
check('E2b no shape → glass type stays big as before; bottom-right corner empty', [noShape[noShape.length - 1].size >= 50, ink(labels[0])], [true, 0]);
global.lgOptyShapeDraw = require(path.join(__dirname, '..', 'opty-shape.js')).lgOptyShapeDraw;
const box = l => { const cc = createCanvas(W, W), x = cc.getContext('2d'); const r = PL.lgLabelDraw(x, l);
  const d = x.getImageData(20, 160, 230, 230).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return [n > 100, r.every(s => s.width <= W - 40)]; };
check('E3 label with shape: drawing on the left, size still fits', box({ ...labels[0], geo: { w: 427, h: 1992, c: [[[1, 366, 996, 6, 0, 6.2832]]] } }), [true, true]);

/* E4 — מספר אופטימיזציה (M00272) על המדבקה, באמצע השורה התחתונה (בן, 16/11) */
const O4 = { ...O1, items: [{ ...it(502, 1902), optyShape: '274328', optyJob: 'M00272' }] };
check('E4a optimisation number travels from the item to the label', PL.lgLabelsForClient([{ order: O4, idxs: [0] }])[0].job, 'M00272');
const mid = l => { const cc = createCanvas(W, W), x = cc.getContext('2d'); PL.lgLabelDraw(x, l);
  const d = x.getImageData(140, 508, 180, 38).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; };
check('E4b printed in the middle of the bottom row; no number → empty', [mid({ ...labels[0], shape: '274328', job: 'M00272' }) > 50, mid({ ...labels[0], shape: '274328' })], [true, 0]);
check('E4c shape number no longer sits in the bottom row (nothing to collide with)', ink({ ...labels[0], shape: '274328' }), 0);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
