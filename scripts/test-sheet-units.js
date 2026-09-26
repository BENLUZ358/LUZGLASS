#!/usr/bin/env node
/**
 * Every number the installer types into a hole or cutout carries its unit
 * (QA doc 2026-09-25, TEST 03).
 *
 * Width, height and diameter said "מ״מ"; the two position fields — distance
 * from the edge, distance from top/bottom — did not. A position off by ten
 * drills the hole somewhere else entirely, so those are exactly the fields
 * that most need it.
 *
 * The rows are rendered for real (in a VM, with the page's own builders),
 * and every row that contains a number input must also show the unit.
 *
 * Run: node scripts/test-sheet-units.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const fnOf = n => {
  const i = DEMO.indexOf('function ' + n + '(');
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
};

function rowsWithoutUnit(html) {
  return html.split('<div class="sh-row">').slice(1)
    .map(r => r.split('</div>')[0] + '</div>')
    .filter(r => /<input/.test(r) && !/class="sh-unit"/.test(r))
    .map(r => (r.match(/<label>([^<]*)/) || [])[1]);
}

for (const unit of ['mm', 'cm']) {
  const ctx = vm.createContext({
    dimUnit: unit, LG_HOLE_HE: { hole: 'קדח חופשי' },
    _holeRolesFor: () => ['hole'],
  });
  vm.runInContext(['_dimUnitLabel', '_dimToUnit', '_shHole', '_shCut'].map(fnOf).join('\n'), ctx);
  const label = vm.runInContext('_dimUnitLabel()', ctx);

  const hole = vm.runInContext(
    '_shHole(0,{role:"hole",dia:12,x:{from:"left",mm:500},y:{from:"bottom",mm:1500}},"shape")', ctx);
  check(`[${unit}] every number row of a free hole names its unit`, rowsWithoutUnit(hole), []);
  check(`[${unit}] and it is the unit the window is in`, hole.split(label).length - 1, 3);

  const cut = vm.runInContext(
    '_shCut(0,{w:120,h:60,ref:"edge",x:{from:"left",mm:500},y:{from:"bottom",mm:1500}})', ctx);
  check(`[${unit}] every number row of a free cutout names its unit`, rowsWithoutUnit(cut), []);
  check(`[${unit}] four numbers, four units`, cut.split(label).length - 1, 4);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sheet-unit checks passed.');
