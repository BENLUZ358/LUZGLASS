#!/usr/bin/env node
/**
 * Tests lg-parse.js — how a typed dimension becomes millimetres, and how a
 * stored millimetre value goes back into an edit field.
 *
 * The parsing rule is the trade's own shorthand and was already right:
 *
 *     a decimal        → metres × 1000    0.885 → 885    1.95 → 1950
 *     a whole ≤ 300    → centimetres × 10    44 → 440     200 → 2000
 *     a whole > 300    → millimetres as-is  445 → 445    1985 → 1985
 *
 * What was wrong was the way back. The edit fields were filled with
 * lgMmToMeterStr, so a 2000 mm panel came back as "2" and a 500 mm one as
 * "0.5" — metres, in a builder whose drawing is entirely in millimetres. The
 * operator typed 200 meaning 2000 and the field answered "2".
 *
 * The trap in simply printing the millimetres instead: anything at or below
 * 300 would be read back as centimetres on the next render. A 250 mm panel
 * would silently become 2500 mm just by being redrawn. Every value a field
 * shows must parse back to exactly the value it was given — that round trip
 * is the property worth pinning, and it is why lgMmToInputStr exists.
 *
 * Run: node scripts/test-dimensions.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'lg-parse.js'), 'utf8');

const ctx = vm.createContext({});
vm.runInContext(SRC, ctx);
const { lgParseDimensionInput: parse, lgMmToInputStr: toInput } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the shorthand, in the operator's own words ────────────────────────── */
check('200 is 2000 mm',   parse('200').mm,  2000);
check('198 is 1980 mm',   parse('198').mm,  1980);
check('1985 stays 1985',  parse('1985').mm, 1985);
check('80 is 800 mm',     parse('80').mm,   800);
check('800 stays 800',    parse('800').mm,  800);
check('the boundary 300 is still centimetres', parse('300').mm, 3000);
check('and 301 is already millimetres',        parse('301').mm, 301);
check('a decimal is metres', parse('1.95').mm, 1950);
check('a comma works like a point', parse('1,95').mm, 1950);

check('nothing typed is refused',   parse('').ok,      false);
check('letters are refused',        parse('abc').ok,   false);
check('zero is refused',            parse('0').ok,     false);
check('negative is refused',        parse('-5').ok,    false);
check('over five metres is refused', parse('6000').ok, false);

/* ── the way back into an edit field ───────────────────────────────────── */
/*
 * What the operator sees must be the number they think in — millimetres —
 * never 198.5 for 1985.
 */
check('2000 mm shows as 2000',  toInput(2000), '2000');
check('1985 mm shows as 1985',  toInput(1985), '1985');
check('500 mm shows as 500',    toInput(500),  '500');
check('and never as a fraction of a metre',
      /\./.test(toInput(1985)), false);

check('nothing shows as nothing', toInput(null), '');
check('and so does an empty value', toInput(''), '');
check('zero has no dimension to show', toInput(0), '');

/* ── the round trip is the whole point ─────────────────────────────────── */
/*
 * Below the 300 boundary a bare number would be read back as centimetres, so
 * a 250 mm panel would become 2500 mm just by being re-rendered. Every value
 * must survive the trip out to the field and back unchanged.
 */
for (const mm of [1, 50, 250, 299, 300, 301, 445, 500, 800, 1985, 2000, 2200, 5000]) {
  const shown = toInput(mm);
  const back  = parse(shown);
  check(`${mm} mm survives the trip to the field and back`,
        back.ok && back.mm === mm, true);
}

/* the specific case that would have been silently corrupted */
check('250 mm is not turned into 2500 by a redraw', parse(toInput(250)).mm, 250);

/* ── the builder uses it ───────────────────────────────────────────────── */
{
  const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
  check('the sketch builder fills its fields in millimetres',
        /value="\$\{lgMmToInputStr\(/.test(DEMO), true);
  check('and no longer in metres',
        /lgMmToMeterStr/.test(DEMO), false);
  check('it still parses what is typed through the shared rule',
        /lgParseDimensionInput\(/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension checks passed.');
