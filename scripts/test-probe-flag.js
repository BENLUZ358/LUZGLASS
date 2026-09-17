#!/usr/bin/env node
/**
 * The multiplication-factor probe — and the one property that must not slip.
 *
 * Hashavshevet stores a measurement as three "factors" whose product is the
 * quantity: 1 units · 2 width · 3 length, in metres (0.5500 = 550 mm). The
 * dialog numbers them 1/2/3, but the API exposes FOUR numeric line fields —
 * SM_ExtraSum1, SM_Extrasum2, SM_ExtraNum1, SM_ExtraNum2 — and nobody has told
 * us which one feeds which slot. Guessing would put a wrong measurement on a
 * customer's invoice, and length-for-width gives the identical area, so the
 * mistake would never show up in the total — only on the copy the customer
 * holds.
 *
 * So: one order carrying four unmistakable numbers. Whichever lands in the
 * dialog identifies its field. The decimals test the pipe at the same time —
 * the docs say decimal 9.2 (two places) while the screen shows four, and if
 * 1.111 comes back as 1.11 the millimetres do not survive.
 *
 * THE PROPERTY THIS FILE GUARDS: the probe is never on unless asked for
 * explicitly. These are junk numbers; on a real order they would be written
 * into a customer's accounting document, and no API call can take them back.
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

/* ── the four values ──────────────────────────────────────────────────── */
{
  const block = (SRC.match(/const LG_PROBE_FIELDS = \{[\s\S]*?\};/) || [''])[0];
  check('all four line-level numeric fields are covered',
        ['SM_ExtraSum1', 'SM_Extrasum2', 'SM_ExtraNum1', 'SM_ExtraNum2']
          .filter(f => block.indexOf(f + ':') < 0), []);
  check('no header field is used — those are one per document, not per pane',
        /['"]?S_Extra/.test(block.replace(/SM_Extra/g, '')), false);

  /* every value distinct, or the answer would be ambiguous */
  const vals = (block.match(/'([\d.]+)'/g) || []).map(v => v.replace(/'/g, ''));
  check('four values', vals.length, 4);
  check('and no two alike — an ambiguous answer is no answer',
        new Set(vals).size, 4);
  check('two carry three decimals, to test what the pipe keeps',
        vals.filter(v => /^\d\.\d{3}$/.test(v)).length, 2);
  check('and they go in the decimal fields, not the integer ones',
        [/SM_ExtraSum1: '1\.111'/.test(block), /SM_Extrasum2: '2\.222'/.test(block)],
        [true, true]);

  check('the exact casing of the docs is preserved — SM_Extrasum2 is lowercase there',
        /SM_Extrasum2:/.test(block) && !/SM_ExtraSum2:/.test(block), true);
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
