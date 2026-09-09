#!/usr/bin/env node
/**
 * Tests the unit switch in the dimension editor.
 *
 * Every measurement is stored in millimetres, because that is what the
 * cutter receives and what the engine computes in. The unit is only the
 * language of typing: someone who measures in centimetres types 20, not 200.
 *
 * The old parser GUESSED — "20" became 200 and "200" became 2000 — because
 * with no declared unit there was no other way. Once the unit is declared
 * the guess is harmful: in millimetre mode, 200 means 200. A factor of ten
 * is the error this file exists to prevent, and it is the error a glass
 * shop pays for.
 *
 * Run: node scripts/test-dim-units.js
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

/* pull the unit helpers out and run them for real */
function withUnit(unit) {
  const grab = name => {
    const i = DEMO.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('missing ' + name);
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const ctx = vm.createContext({ Math, String, Number, parseFloat, isFinite });
  vm.runInContext('let dimUnit=' + JSON.stringify(unit) + ';', ctx);
  ['_dimUnitLabel', '_dimToUnit', '_dimFromUnit', '_dimParse'].forEach(n =>
    vm.runInContext(grab(n), ctx));
  return ctx;
}

console.log('');

/* ── millimetres: what you type is what you get ─────────────────────────── */
{
  const c = withUnit('mm');
  const mm = s => vm.runInContext('_dimParse(' + JSON.stringify(s) + ')', c);

  check('the label says millimetres', vm.runInContext('_dimUnitLabel()', c), 'מ"מ');
  check('200 is two hundred millimetres, not two thousand', mm('200').mm, 200);
  check('2000 stays two thousand', mm('2000').mm, 2000);
  check('20 stays twenty', mm('20').mm, 20);
  check('1985 stays itself', mm('1985').mm, 1985);
  check('and a decimal rounds to the nearest millimetre', mm('12.4').mm, 12);
}

/* ── centimetres: ten times, and nothing else changes ───────────────────── */
{
  const c = withUnit('cm');
  const mm = s => vm.runInContext('_dimParse(' + JSON.stringify(s) + ')', c);

  check('the label says centimetres', vm.runInContext('_dimUnitLabel()', c), 'ס"מ');
  check('20 becomes two hundred millimetres', mm('20').mm, 200);
  check('200 becomes two thousand', mm('200').mm, 2000);
  check('198.5 becomes 1985 — the case the old parser refused', mm('198.5').mm, 1985);
  check('and a stored value is shown back in centimetres',
        vm.runInContext('_dimToUnit(200)', c), 20);
}

/* ── the round trip loses nothing ───────────────────────────────────────── */
/* Type a number, switch units, switch back: the millimetres must be the
   same. Otherwise the value drifts every time someone changes their mind. */
{
  const cm = withUnit('cm'), mmc = withUnit('mm');
  [200, 1985, 2000, 45, 12].forEach(v => {
    const shownCm = vm.runInContext('_dimToUnit(' + v + ')', cm);
    const backCm  = vm.runInContext('_dimParse(' + JSON.stringify(String(shownCm)) + ')', cm).mm;
    const shownMm = vm.runInContext('_dimToUnit(' + v + ')', mmc);
    const backMm  = vm.runInContext('_dimParse(' + JSON.stringify(String(shownMm)) + ')', mmc).mm;
    check(`${v}mm survives a round trip in both units`, [backCm, backMm], [v, v]);
  });
}

/* ── what it refuses ────────────────────────────────────────────────────── */
{
  const c = withUnit('mm');
  const mm = s => vm.runInContext('_dimParse(' + JSON.stringify(s) + ')', c);
  check('an empty box is not a measurement', mm('').ok, false);
  check('nor is a word', mm('abc').ok, false);
  check('a negative measurement is refused', mm('-5').ok, false);
  check('and anything past five metres is refused', mm('6000').ok, false);
  check('with the limit stated in the unit being typed',
        mm('6000').error.indexOf('5000') > -1, true);

  const cc = withUnit('cm');
  check('in centimetres the same limit reads as 500',
        vm.runInContext('_dimParse("600")', cc).error.indexOf('500') > -1, true);
}

/* ── the switch is in the markup, and the unit is always named ──────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the editor offers both units', has('id="dimUnitMm"') && has('id="dimUnitCm"'), true);
  check('and each is a 44px target',
        /\.dim-ed-row button\{[^}]*min-height:44px/.test(DEMO), true);
  check('the editor title names the current unit',
        has("+' — '+_dimUnitLabel()"), true);
  check('and the sheet labels its fields too', has('_dimUnitLabel()+\'</span>'), true);
  check('the preference is remembered', has("localStorage.setItem('lgDimUnit'"), true);

  /* nothing still routes through the guessing parser */
  const guessing = (DEMO.match(/lgParseDimensionInput\(/g) || []).length;
  check('the editor and the sheet no longer guess the unit', guessing <= 1, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll unit checks passed.');
