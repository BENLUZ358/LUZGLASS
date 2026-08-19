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

/* ── 2. the line payload is exactly the confirmed fields ───────────────── */
const build = SRC.match(/lines\.push\(\{([\s\S]*?)\}\);/);
check('found the line builder', !!build);
if (build) {
  const fields = [...build[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]);
  const EXPECTED = ['accountKey', 'documentid', 'Reference', 'itemkey', 'Quantity', 'price', 'Agent'];
  check('the line carries exactly the expected fields',
        JSON.stringify(fields) === JSON.stringify(EXPECTED),
        `got: ${fields.join(', ')}`);

  /* This file used to assert the opposite — that price is theirs, not ours,
     because Hashavshevet price the line from the item card. Order 1058, the
     first real send ever made, disproved it: the line landed with price 0.000
     and total 0.00, while the same item key typed by hand into their own
     screen priced itself at 171. The card lookup belongs to the data-entry
     screen, not to the API. An assumption held for months by a test that
     agreed with it. */
  check('price is sent', /^\s*price\s*:/m.test(build[1]),
        'a line with no price is stored at zero — see order 1058');
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

/* ── 3. an unpriced item is skipped, not billed at zero ────────────────── */
/* Also the reverse of what this file once asserted, and for the same reason:
   the fallback was "send it and let them price it", which produces a zero
   line. A zero line reads in the document like an item given away and nobody
   audits it; a missing item is listed in the modal and cannot be ignored. */
check('an item with no price anywhere is skipped',
      /skipped\.push\([^)]*אין מחיר/.test(SRC),
      'sending it unpriced puts a ₪0 line in an accounting document');
check('and the client list is preferred over the global one',
      /const ppm2 = parseFloat\(cp\[sku\] \|\| gp\[sku\] \|\| 0\);/.test(SRC),
      'the global price overcharges every client who has a list of their own');

/* ── 4. dry run stays the default ──────────────────────────────────────── */
check('dryRun defaults to true', /const dryRun\s*=\s*body\.dryRun\s*!==\s*false/.test(SRC),
      'sending must be an explicit choice');

/* ── 5. every attempt is recorded, success or failure ──────────────────── */
check('the raw response is persisted', /response:\s*text\.slice/.test(SRC),
      'HTTP 200 with no document is only diagnosable from the body');
check('httpOk is stored under its own name', /httpOk:\s*wgRes\.ok/.test(SRC),
      '"accepted" and "document exists" turned out to be different things');

/* ── 6. a test order runs the whole path but never leaves the building ──
   Until the system is fully verified, real orders need to be pushed through
   the entire flow without a document appearing in the accounts — one that
   appears has to be cancelled by hand in Hashavshevet.

   The decision must be made from the ORDER, not from a request parameter,
   and everything except the outbound call must still run: same validation,
   same payload, same record on the order, same response shape. Otherwise
   what gets tested is a shortcut rather than the real path. */
check('the flag is read off the order, not the request body',
      /const isTest\s*=\s*order\.isTest\s*===\s*true/.test(SRC),
      'a browser-supplied parameter could be forged, and would test nothing');
check('the outbound call is the only thing skipped',
      /if\s*\(isTest\)\s*\{[\s\S]{0,300}?\}\s*else\s*\{[\s\S]{0,200}?await fetch\(ENDPOINT/.test(SRC),
      'the point is that the rest of the path is identical');
check('the attempt is still recorded on the order',
      /simulated:\s*isTest\s*\|\|\s*null/.test(SRC),
      'without it there is no way to tell a test order from a real one later');
check('the caller is told it was simulated',
      /simulated:\s*isTest,/.test(SRC),
      'the success screen must not claim a document was created');
check('force does not turn a test order into a real send',
      !/isTest\s*&&\s*!?\s*force/.test(SRC),
      'force exists to resend a real order, not to promote a test one');

{
  /* the flag has to survive the normaliser, or no screen can mark it */
  const db = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
  const norm = (db.match(/function lgNormalizeOrder[\s\S]*?\n}/) || [''])[0];
  check('isTest survives lgNormalizeOrder', /isTest:\s*!!o\.isTest/.test(norm),
        'dropped there, a test order would look identical to a real one on every screen');
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll Hashavshevet order checks passed.');
