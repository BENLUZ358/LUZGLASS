#!/usr/bin/env node
/** ברקוד על מדבקות אביבי (בן 17/11). Run: node scripts/test-avivi-barcode.js
 *  הקורא כאן נכתב בנפרד מהמצייר (lg-qr.js) — קורא את הפורמט, מוריד מסכה, אוסף לפי
 *  סדר הזיגזג של התקן, בודק את קודי התיקון ומפענח את הטקסט. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'lg-qr.js'));
const A = require(path.join(ROOT, 'avivi-wrap.js'));
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };

/* ── 1. מול ערכי הדוגמה המוכרת של התקן (HELLO WORLD, 1-M) ── */
const hw = Q.lgQrData('HELLO WORLD', 1, 'M');
check('Q1 data codewords', hw, [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
check('Q2 error-correction codewords', Q.lgQrEcc(hw, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
check('Q3 format bits M/mask0 and L/mask4', [Q.lgQrFormatBits('M', 0).toString(2).padStart(15, '0'), Q.lgQrFormatBits('L', 4).toString(2).padStart(15, '0')],
      ['101010000010010', '110011000101111']);

/* ── 2. קורא עצמאי ── */
function readQr(m) {
  const size = m.length, ver = (size - 17) / 4;
  let f1 = 0, f2 = 0;                       // שני העותקים של הפורמט, ביט 14 ראשון
  const c1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  c1.forEach(([x, y], i) => { if (m[y][x]) f1 |= 1 << i; });
  for (let i = 0; i < 8; i++) if (m[8][size - 1 - i]) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[size - 15 + i][8]) f2 |= 1 << i;
  if (f1 !== f2) return { err: 'format copies differ' };
  const fmt = f1 ^ 0x5412, ecl = (fmt >> 13) === 1 ? 'L' : (fmt >> 13) === 0 ? 'M' : '?', mask = (fmt >> 10) & 7;
  const isFn = (x, y) => (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8) || x === 6 || y === 6
    || (ver >= 2 && Math.abs(x - (size - 7)) <= 2 && Math.abs(y - (size - 7)) <= 2);
  const mk = [(x, y) => (y + x) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (y + x) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((y * x) % 2) + ((y * x) % 3) === 0,
    (x, y) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0, (x, y) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0][mask];
  const bits = [];
  let x = size - 1, up = true;
  while (x > 0) {
    if (x === 6) x--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const xx of [x, x - 1]) if (!isFn(xx, y)) bits.push((m[y][xx] !== mk(xx, y)) ? 1 : 0);
    }
    x -= 2; up = !up;
  }
  const cap = { L: [0, [19, 7], [34, 10], [55, 15]], M: [0, [16, 10], [28, 16], [44, 26]] }[ecl][ver];
  const cw = [];
  for (let i = 0; i + 8 <= bits.length && cw.length < cap[0] + cap[1]; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const data = cw.slice(0, cap[0]), ecc = cw.slice(cap[0]);
  const eccOk = JSON.stringify(Q.lgQrEcc(data, cap[1])) === JSON.stringify(ecc);
  const db = data.map(b => b.toString(2).padStart(8, '0')).join('');
  if (db.slice(0, 4) !== '0010') return { err: 'not alphanumeric' };
  const n = parseInt(db.slice(4, 13), 2); let p = 13, t = '';
  for (let i = 0; i < n; i += 2) {
    if (i + 1 < n) { const v = parseInt(db.slice(p, p + 11), 2); p += 11; t += Q.LG_QR_ALNUM[Math.floor(v / 45)] + Q.LG_QR_ALNUM[v % 45]; }
    else { t += Q.LG_QR_ALNUM[parseInt(db.slice(p, p + 6), 2)]; p += 6; }
  }
  return { ver, ecl, mask, eccOk, text: t };
}
const finderOk = (m, cx, cy) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  const d = Math.max(Math.abs(dx), Math.abs(dy)); if (m[cy + dy][cx + dx] !== (d !== 2)) return false; } return true; };

const URLS = ['HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3', 'HTTPS://LUZGLASS-TEST.VERCEL.APP/AV/91234-12', 'HELLO WORLD'];
URLS.forEach(u => {
  const m = Q.lgQrMatrix(u, 'L'), r = readQr(m), s = m.length;
  check('R ' + u + ' → reads back', [r.text, r.eccOk, r.ecl], [u, true, 'L']);
  check('R ' + u + ' → three corner squares', [finderOk(m, 3, 3), finderOk(m, s - 4, 3), finderOk(m, 3, s - 4)], [true, true, true]);
});
for (let mask = 0; mask < 8; mask++) {
  const r = readQr(Q.lgQrMatrix('HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3', 'L', { mask }));
  check('R every mask reads back (' + mask + ')', [r.mask, r.text, r.eccOk], [mask, 'HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3', true]);
}
check('R label URL fits version 2 (25×25 → 4 dots a square)', Q.lgQrMatrix('HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3', 'L').length, 25);
check('R lowercase is refused (not in the alphanumeric set)', Q.lgQrMatrix('https://x', 'L'), null);

/* ── 3. רק אביבי ── */
const av = { id: 'em_1', customerId: '450', orderClient: 'יצחק אביבי', orderNum: 'L1247', sketchName: 'PO26H017595', items: [{ w: 831, h: 248 }, { w: 848, h: 248 }, { w: 511, h: 471 }] };
const peleg = { id: 'p1', customerId: '07', orderClient: 'פלג מקלחונים', orderNum: 'L1300', items: [{ w: 700, h: 1900 }] };
check('C1 code = order number - glass number from 1', A.lgAvScanCode(av, 2), '1247-3');
check('C2 not Avivi → no code', A.lgAvScanCode(peleg, 0), '');
check('C3 url uppercase', A.lgAvScanUrl('1247-3'), 'HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3');
check('C4 parse plain / url / typed with L', [A.lgAvParseScan('1247-3'), A.lgAvParseScan('https://luzglass.vercel.app/AV/1247-3'), A.lgAvParseScan('L1247-3')],
      [{ num: '1247', idx: 2 }, { num: '1247', idx: 2 }, { num: '1247', idx: 2 }]);
check('C5 parse rejects PO suffix / dims / glass 0', [A.lgAvParseScan('17595'), A.lgAvParseScan('600*800'), A.lgAvParseScan('1247-0')], [null, null, null]);
check('C6 find the Avivi order only', [A.lgAvFindScan([peleg, av], { num: '1247', idx: 0 }) === av, A.lgAvFindScan([peleg, av], { num: '1300', idx: 0 })], [true, null]);
check('C7 search box with the code highlights that glass', A.lgAvMatch(av, '1247-2'), { hit: true, idxs: [1] });
check('C8 code of another order → no hit', A.lgAvMatch(av, '1248-1').hit, false);

/* ── 4. המדבקה ── */
global.lgAvScanCode = A.lgAvScanCode; global.lgAvScanUrl = A.lgAvScanUrl;
global.lgQrMatrix = Q.lgQrMatrix; global.lgQrDraw = Q.lgQrDraw;
const PL = require(path.join(ROOT, 'print-labels.js'));
const [la] = PL.lgLabelsForClient([{ order: av, idxs: [0] }]);
const [lp] = PL.lgLabelsForClient([{ order: peleg, idxs: [0] }]);
check('L1 Avivi label carries the barcode', la.qr, 'HTTPS://LUZGLASS.VERCEL.APP/AV/1247-1');
check('L2 other customers: no barcode field at all', 'qr' in lp, false);

let createCanvas = null;
try { ({ createCanvas } = require('@napi-rs/canvas')); } catch (_) {}
if (!createCanvas) console.log('skip  L3–L5 (no @napi-rs/canvas — set NODE_PATH)');
else {
  const W = PL.LG_LABEL_PX;
  const draw = l => { const c = createCanvas(W, W), ctx = c.getContext('2d'); const out = PL.lgLabelDraw(ctx, l); return { ctx, out }; };
  const inkIn = (ctx, x0, y0, x1, y1) => { const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; };
  for (const shape of ['', '274328']) {
    const { ctx, out } = draw({ ...la, shape, title: 'יצחק אביבי בע"מ שם ארוך מאוד מאוד', glass: '8 מ"מ קליר מלוטש', job: 'M00320' });
    const q = out.qr || {};
    check('L3 barcode drawn top-right, 4 dots a square' + (shape ? ' (with shape)' : ''), [q.mod, q.side, q.x + q.side, q.y], [4, 100, 540, 8]);
    //  שוליים לבנים סביב הברקוד (2 ריבועים) — אף טקסט או קו לא נכנס אליהם
    const ring = inkIn(ctx, q.x - 8, 0, q.x, q.y + q.side + 8) + inkIn(ctx, q.x - 8, q.y + q.side, W, q.y + q.side + 8);
    check('L4 quiet zone around the barcode is empty' + (shape ? ' (with shape)' : ''), ring, 0);
    //  הקורא העצמאי קורא את מה שצויר בפועל על המדבקה
    const m = []; for (let r = 0; r < 25; r++) { m.push([]); for (let c = 0; c < 25; c++) m[r].push(inkIn(ctx, q.x + c * 4 + 1, q.y + r * 4 + 1, q.x + c * 4 + 3, q.y + r * 4 + 3) > 0); }
    check('L5 the printed barcode reads back' + (shape ? ' (with shape)' : ''), readQr(m).text, 'HTTPS://LUZGLASS.VERCEL.APP/AV/1247-1');
  }
  const { ctx: cp } = draw(lp);
  check('L6 other customer: top-right corner untouched by a barcode', inkIn(cp, 440, 8, 540, 30), 0);
}

/* ── 5. השרת והכתובת ── */
const fs = require('fs');
const PJ = fs.readFileSync(path.join(ROOT, 'api', '_print-jobs.js'), 'utf8');
const re = new RegExp(PJ.match(/l\.qr === 'string' && \/(.+?)\/\.test/)[1]);
check('S1 server keeps only an Avivi-tab barcode', [re.test('HTTPS://LUZGLASS.VERCEL.APP/AV/1247-3'), re.test('HTTPS://LUZGLASS-TEST.VERCEL.APP/AV/91234-12'),
  re.test('HTTPS://EVIL.COM/AV/1247-3'), re.test('HTTPS://LUZGLASS.VERCEL.APP/ADMIN.HTML')], [true, true, false, false]);
const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
check('S2 /AV/<code> is a redirect (the page loads its files from the root)', (VJ.redirects || []).some(r => r.source === '/AV/:code' && r.destination === '/workday.html?av=:code'), true);
const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
check('S3 workday handles the scan once orders are loaded', WD.includes('_avHandlePendingScan();') && WD.includes(".get('av')"), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
