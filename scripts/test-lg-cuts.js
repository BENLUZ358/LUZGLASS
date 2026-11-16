#!/usr/bin/env node
/**
 * lg-cuts — קבועי חיתוך וקונטור חלון הציר מול 274378.dat.
 * Run:  node scripts/test-lg-cuts.js
 */
const fs = require('fs');
const path = require('path');
const { lgOptyShapeParse } = require(path.join(__dirname, '..', 'opty-shape.js'));
const { LG_CUT, LG_HINGE_CONTOUR } = require(path.join(__dirname, '..', 'lg-cuts.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

check('constants', [LG_CUT.hinge.end, LG_CUT.allowance], [161, 2]);

const geo = lgOptyShapeParse(fs.readFileSync(path.join(__dirname, 'fixtures', 'exact-glass', '274378.dat'), 'utf8'));
const c0 = geo.c[0];
const xs = [], ys = [];
for (const s of c0) {
  if (s[0] === 0) { xs.push(s[1], s[3]); ys.push(s[2], s[4]); }
  else for (let i = 0; i <= 400; i++) { const a = s[4] + (s[5] - s[4]) * i / 400; xs.push(s[1] + s[3] * Math.cos(a)); ys.push(s[2] + s[3] * Math.sin(a)); }
}
const x0 = Math.min(...xs), y0 = Math.min(...ys);
const bw = Math.max(...xs) - x0, bh = Math.max(...ys) - y0;
check('bbox 39x80', Math.abs(bw - 39) <= 0.5 && Math.abs(bh - 80) <= 0.5, true);

const shifted = c0.map(s => s[0] === 0 ? [0, s[1] - x0, s[2] - y0, s[3] - x0, s[4] - y0] : [1, s[1] - x0, s[2] - y0, s[3], s[4], s[5]]);
check('same segment count', LG_HINGE_CONTOUR.length, shifted.length);
const same = shifted.every((s, i) => { const e = LG_HINGE_CONTOUR[i]; return e && e.length === s.length && e.every((v, j) => Math.abs(v - s[j]) <= 0.01); });
check('contour matches 274378.dat', same, true);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
