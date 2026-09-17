#!/usr/bin/env node
/**
 * Finding out where each field actually lands in Hashavshevet.
 *
 * Hashavshevet stores a measurement as three "factors" whose product is the
 * quantity: 1 units · 2 width · 3 length, in metres (0.5500 = 550 mm). The
 * docs never mention this mechanism at all, so which API field feeds which
 * slot has to be discovered rather than read.
 *
 * ROUND ONE (16/09) tried all four numeric LINE fields — SM_ExtraSum1,
 * SM_Extrasum2, SM_ExtraNum1, SM_ExtraNum2. Hashavshevet showed
 * "אין נתוני מכפלה": none of them is a factor. A certain negative, and worth
 * the one order it cost.
 *
 * ROUND TWO asks what is left, on both fronts at once — the three header sums
 * Hashavshevet themselves pointed at, and the text fields. The texts matter
 * even if every number fails, because the real goal is the dimensions
 * appearing on the copy the secretary holds against the sketch, and text
 * serves that better than a number: decimal 9.2 would round .885 to .89,
 * while text keeps 885 exactly.
 *
 * Guessing instead of probing would put a wrong measurement on a customer's
 * invoice, and length-for-width gives the identical area — so the mistake
 * would never surface in the total, only on the paper the customer holds.
 *
 * THE PROPERTY THIS FILE GUARDS: the probe is never on unless asked for
 * explicitly. These are junk values; on a real order they are written into an
 * accounting document, and no API call can take them back.
 *
 * Delete this file together with LG_PROBE_FIELDS once Hashavshevet answers.
 *
 * Run: node scripts/test-probe-flag.js
 */
const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'hashavshevet-order.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

console.log('');

/* ── the flag ─────────────────────────────────────────────────────────── */
{
  check('the probe is off unless the request says true, exactly',
        /const probe\s+= body\.probe === true;/.test(SRC), true);
  check('not truthy, not a string, not a default',
        /body\.probe\s*(\|\||\?\?|!==)/.test(SRC), false);
  check('and the fields are added only under it',
        /if \(probe\) Object\.assign\(line, LG_PROBE_FIELDS\)/.test(SRC), true);
}

/* ── round two: what is being probed now ──────────────────────────────── */
/*
 * Round one ruled out all four numeric LINE fields — Hashavshevet reported
 * "אין נתוני מכפלה", so those are not the multiplication factors. Round two
 * asks the two questions that are left, in one order:
 *
 *   the numbers  — S_ExtraSum1/2/3, three header fields, exactly as many as
 *                  there are factors. Header cannot feed a line's factors by
 *                  any logic I can see, but Hashavshevet named these, and a
 *                  one-item order makes the distinction moot for the test.
 *
 *   the texts    — and if no number lands, what actually matters is still
 *                  reachable: the dimensions PRINTED on the copy the
 *                  secretary holds against the sketch. Text is better there
 *                  than a number, because decimal 9.2 would round .885 to
 *                  .89 while text keeps 885 exactly.
 */
{
  const block = (SRC.match(/const LG_PROBE_FIELDS = \{[\s\S]*?\};/) || [''])[0];

  check('the three header sums are probed — one per factor',
        ['S_ExtraSum1', 'S_ExtraSum2', 'S_ExtraSum3'].filter(f => block.indexOf(f + ':') < 0), []);
  check('and three text fields, header and line and details',
        ['S_ExtraText1', 'SM_Extratext1', 'SM_Details'].filter(f => block.indexOf(f + ':') < 0), []);

  check('the four fields ruled out in round one are not retried',
        ['SM_ExtraSum1', 'SM_Extrasum2', 'SM_ExtraNum1', 'SM_ExtraNum2']
          .filter(f => block.indexOf(f + ':') > -1), []);

  /* every value distinct, or the answer is ambiguous */
  const vals = (block.match(/'([^']+)'/g) || []).map(v => v.replace(/'/g, ''));
  check('six values', vals.length, 6);
  check('and no two alike — an ambiguous answer is no answer',
        new Set(vals).size, 6);

  check('the numbers carry three decimals, to test what the pipe keeps',
        vals.filter(v => /^\d\.\d{3}$/.test(v)).length, 3);
  check('the details field carries a real measurement, as it would in production',
        /SM_Details:\s+'550x1885'/.test(block), true);
  check('and it fits the 20-character limit', '550x1885'.length <= 20, true);

  /* Hebrew in a field we have never written before would mix an encoding
     question into a mapping question, and a failure would not say which */
  check('the probe values are ASCII, so a failure means mapping and nothing else',
        vals.every(v => /^[ -~]+$/.test(v)), true);
}

/* ── what comes back ──────────────────────────────────────────────────── */
{
  check('the sent line is echoed, so it can be compared with what landed',
        /probeSent: probe \? lines\[0\] : undefined/.test(SRC), true);
  check('and nothing is echoed on an ordinary send',
        /probeSent: lines\[0\]/.test(SRC), false);
}

/* ── the signature still covers what is sent ──────────────────────────── */
{
  check('the body is still built from the exact string that was signed',
        /const pluginDataJson = JSON\.stringify\(lines\);[\s\S]{0,200}sign\(pluginDataJson/.test(SRC), true);
  check('and the extra keys go on the end of the line, after Agent',
        /Agent:\s+String\(agent\),\s*\n\s*\};/.test(SRC), true);
}

/* ── it is marked as temporary ────────────────────────────────────────── */
{
  check('the block says it comes out again',
        /זמני/.test((SRC.match(/\/\/ ── ניסוי זמני[\s\S]*?const LG_PROBE_FIELDS/) || [''])[0]), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll probe-flag checks passed.');
