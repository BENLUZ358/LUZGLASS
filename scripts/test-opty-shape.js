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
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
