#!/usr/bin/env node
/**
 * opty-shape.js — קריאת קובץ צורה של אופטי-ווי (<מספר>.dat) וציורו (בן, 16/11).
 * Run: node scripts/test-opty-shape.js
 */
const fs = require('fs'), path = require('path');
const S = require('../opty-shape.js');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const read = n => S.lgOptyShapeParse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opty-shapes', n + '.dat'), 'utf8'));

const g = read('274378');
check('size and 3 outlines (2 hinge notches + a hole)', [g.w, g.h, g.c.map(c => c.length)], [427, 1992, [9, 1, 9]]);
check('line = y1 y2 0 x1 x2 → [0,x1,y1,x2,y2]', g.c[0][0], [0, 10, 168.5, 27.88, 168.5]);
check('arc = cx cy r a0 a1', g.c[1][0], [1, 366, 996, 6, -5.0699, 1.2133]);
check('4 round holes', read('274122').c.map(c => c[0][3]), [9, 9, 9, 9]);
check('slanted cut = one line', read('274219').c, [[[0, 1118, 0, 1120, 1192]]]);
check('garbage → null', [S.lgOptyShapeParse(''), S.lgOptyShapeParse('abc\n1')], [null, null]);
const svg = S.lgOptyShapeSvg(g);
check('svg: glass rectangle + cut path with arcs', [/<rect[^>]*width="427" height="1992"/.test(svg), /<path d="M[^"]*A/.test(svg)], [true, true]);
check('svg: full circle drawn as two half arcs', (S.lgOptyShapeSvg(read('274122')).match(/A9 9/g) || []).length, 8);
// מסלול רציף: נקודת הסוף של כל מקטע = ההתחלה של הבא (אחרי ההיפוך) → M אחד לכל קו מתאר
check('notch outline is continuous (one M per outline)', (S.lgOptyShapeSvg({ w: g.w, h: g.h, c: [g.c[0]] }).match(/M/g) || []).length, 1);
check('no shape → empty', S.lgOptyShapeSvg(null), '');
//  מידות לכל דבר בצורה (בן, 16/11: "שייראו בדיוק את הנתונים") — במסגרת של אופטי-ווי, מהקצה הקרוב
const F = g2 => S.lgOptyFeatures(g2).map(f => [f.kind, f.text]);
check('hinge cuts + hole (274378)', F(g), [
  ['notch', 'חריץ משמאל · עומק 49 · רוחב 80 · 161 מלמטה'],
  ['hole', 'חור Ø12 · 61 מימין · 996 מלמטה'],
  ['notch', 'חריץ משמאל · עומק 49 · רוחב 80 · 161 מלמעלה']]);
check('round holes: diameter and centre from the near edges (274122)', F(read('274122')).map(x => x[1].split(' · ')[0]), ['חור Ø18', 'חור Ø18', 'חור Ø18', 'חור Ø18']);
check('rounded corners (274347)', F(read('274347')), [
  ['corner', 'פינה מעוגלת R50 · שמאל למעלה'], ['corner', 'פינה מעוגלת R50 · שמאל למטה'],
  ['corner', 'פינה מעוגלת R50 · ימין למטה'], ['corner', 'פינה מעוגלת R50 · ימין למעלה']]);
const g388 = read('274388');
check('corner cut-out + slots (274388)', F(g388), [
  ['cornercut', 'חיתוך פינה שמאל למטה · 145 × 1216'],
  ['cut', 'שקע 36 × 20 · 145 משמאל · 876 מלמעלה'],
  ['notch', 'חריץ משמאל · עומק 37 · רוחב 20 · 191 מלמעלה'],
  ['cut', 'שקע 36 × 20 · 145 משמאל · 191 מלמטה']]);
check('features numbered 1..n', S.lgOptyFeatures(g388).map(f => f.n), [1, 2, 3, 4]);
const sd = S.lgOptyShapeSvg(g388, { dims: true });
check('svg with dims: overall size + a numbered tag per feature', [/>809</.test(sd), />1902</.test(sd), (sd.match(/class="lg-opty-tag"/g) || []).length], [true, true, 4]);
check('svg without dims: no tags (label/order window stay clean)', /lg-opty-tag/.test(S.lgOptyShapeSvg(g388)), false);
check('no features → empty list', S.lgOptyFeatures({ w: 500, h: 500, c: [] }), []);


//  מידה נטו (בן, 16/11): 1 מ"מ ליטוש מכל צד, ושיפוע = הצד הרחב של קו החיתוך
{
  const g593 = { w: 852, h: 2092, c: [[[1, 801, 951, 5, -5.4157, 0.8675]]] };
  const n = S.lgOptyNetGeo(g593);
  check('net size = OptyWay − 2 (852×2092 → 850×2090)', [n.w, n.h, n.opty], [850, 2090, { w: 852, h: 2092 }]);
  check('holes move 1 mm with the polish (801,951 → 800,950)', [n.c[0][0][1], n.c[0][0][2]], [800, 950]);
  check('net hole distance from the right edge = 50 (was 51)', S.lgOptyFeatures(n)[0].text.includes('50 מימין'), true);
  const g579 = { w: 624, h: 2002, c: [[[0, 604, 0, 601, 2002]], [[1, 590, 200, 10, 0, 6.2832]]] };
  const s = S.lgOptyNetGeo(g579);
  check('slope on the right → net width 602, line kept out of the list', [s.w, s.h, s.c.length, s.slopes.length], [602, 2000, 1, 1]);
  check('slope text: width at the bottom 602, at the top 599', S.lgOptySlopeText(s), ['שיפוע מימין · רוחב למטה 602 · למעלה 599']);
  check('cut size keeps the polish (604×2002) — for matching', S.lgOptyCutSize(g579), { w: 604, h: 2002 });
  const top = S.lgOptyNetGeo({ w: 402, h: 1912.01, c: [[[0, 0, 24.02, 402, 20]]] });
  check('slope at the bottom edge → net height 1890 (wide side), 1886 at the low side', [top.w, top.h, S.lgOptySlopeText(top)], [400, 1890, ['שיפוע למטה · גובה משמאל 1886 · מימין 1890']]);
  check('net of net = same (no double −2)', S.lgOptyNetGeo(n), n);
  check('slope line is drawn on the net edge (602 at the bottom → 599 at the top)', S.lgOptyShapeSvg(s).includes('M602 2000L599 0'), true);
}
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
