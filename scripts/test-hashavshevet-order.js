#!/usr/bin/env node
/**
 * Guards the /api/hashavshevet-order contract.
 *
 * Two things this exists to catch:
 *
 * 1. Duplicate keys in the response object. `preview` was defined twice — once
 *    as the array the preview table maps over, once as the request envelope —
 *    and the second silently won, so the browser threw
 *    "(data.preview || []).map is not a function". JavaScript allows duplicate
 *    keys without complaint, and node --check does not flag them.
 *
 * 2. Drift in the payload. Hashavshevet confirmed a line carries exactly
 *    accountKey, documentid, Reference, itemkey, Quantity — and specifically
 *    that price is theirs to decide, not ours to send. Several rounds of
 *    guessing added and removed warehouse, Agent, copies and price; this
 *    pins the answer.
 *
 * Run: node scripts/test-hashavshevet-order.js
 */

const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'hashavshevet-order.js'), 'utf8');

let failed = 0;
const check = (name, cond, detail) => cond
  ? console.log('ok    ' + name)
  : (failed++, console.error('FAIL  ' + name + (detail ? '\n        ' + detail : '')));

/* ── 1. no duplicate keys in any res.json({...}) object ──────────────────
   Only the multi-line responses are scanned, and the opening brace has to be
   followed by a newline. Without that the pattern starts on a one-line
   response and runs on to the next closing brace several statements later,
   collecting keys from three different objects — which is what it did first
   time round and reported as a duplicate. */
const responses = [...SRC.matchAll(/res\.status\([^)]*\)\.json\(\{[ \t]*\n([\s\S]*?)\n[ \t]*\}\);/g)];
check('found the multi-line response objects', responses.length >= 4, `found ${responses.length}`);

responses.forEach((m, i) => {
  const body = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  /* top-level keys only: ignore anything nested inside braces */
  let depth = 0;
  const keys = [];
  body.split('\n').forEach(line => {
    if (depth === 0) {
      for (const km of line.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g)) keys.push(km[1]);
    }
    depth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
  });
  const dupes = keys.filter((k, idx) => keys.indexOf(k) !== idx);
  check(`response ${i + 1} has no duplicate keys`, dupes.length === 0,
        dupes.length ? `duplicated: ${[...new Set(dupes)].join(', ')} — in: ${keys.join(', ')}` : '');
});

/* ── 2. the line payload is exactly the five confirmed fields ──────────── */
const build = SRC.match(/lines\.push\(\{([\s\S]*?)\}\);/);
check('found the line builder', !!build);
if (build) {
  const fields = [...build[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]);
  const EXPECTED = ['accountKey', 'documentid', 'Reference', 'itemkey', 'Quantity', 'Agent'];
  check('the line carries exactly the expected fields',
        JSON.stringify(fields) === JSON.stringify(EXPECTED),
        `got: ${fields.join(', ')}`);

  /* price is theirs, not ours */
  check('price is not sent', !/^\s*price\s*:/m.test(build[1]),
        'Hashavshevet price the line from the item card');
  ['warehouse', 'copies'].forEach(f => {
    check(`${f} is not sent`, !new RegExp('^\\s*' + f + '\\s*:', 'm').test(build[1]));
  });

  /* Agent was removed once on the strength of a phone call and the import
     then failed with "קוד עובד לא קיים" on every line. It is required. */
  check('Agent is sent', /^\s*Agent\s*:/m.test(build[1]),
        'without it the import defaults to 0, and agent 0 does not exist');
}

/* a zero or missing agent is refused before the request goes out, rather than
   being discovered later in the capture log */
check('a non-positive agent is refused up front',
      /Number\(agent\)\s*>\s*0/.test(SRC),
      'rule 2: אסמכתא, סוכן, מחסנים ומספר עותקים must be positive and non-zero');

/* ── 3. an item with no local price must still be sent ─────────────────── */
check('items are not skipped for want of a local price',
      !/skipped\.push\([^)]*אין מחיר/.test(SRC),
      'Hashavshevet supply the price — skipping unpriced items shipped short orders');

/* ── 4. dry run stays the default ──────────────────────────────────────── */
check('dryRun defaults to true', /const dryRun\s*=\s*body\.dryRun\s*!==\s*false/.test(SRC),
      'sending must be an explicit choice');

/* ── 5. every attempt is recorded, success or failure ──────────────────── */
check('the raw response is persisted', /response:\s*text\.slice/.test(SRC),
      'HTTP 200 with no document is only diagnosable from the body');
check('httpOk is stored under its own name', /httpOk:\s*wgRes\.ok/.test(SRC),
      '"accepted" and "document exists" turned out to be different things');

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll Hashavshevet order checks passed.');
