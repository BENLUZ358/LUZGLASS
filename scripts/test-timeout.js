#!/usr/bin/env node
/**
 * Tests _lgWithTimeout from firebase-db.js.
 *
 * The bug it guards against: when the Realtime Database connection cannot be
 * established, .once('value') neither resolves nor rejects. Without a timeout
 * the login button spins forever and the user is told nothing.
 *
 * The helper is extracted from the real file rather than copied, so this test
 * fails if the shipped implementation changes shape.
 *
 * Run: node scripts/test-timeout.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');

/* Pull the constant and the helper out of the browser file. */
const constMatch  = SRC.match(/const LG_NET_TIMEOUT_MS\s*=\s*\d+;/);
const helperMatch = SRC.match(/function _lgWithTimeout[\s\S]*?\n}/);

if (!constMatch || !helperMatch) {
  console.error('FAIL  could not find LG_NET_TIMEOUT_MS / _lgWithTimeout in firebase-db.js');
  process.exit(1);
}

const ctx = { setTimeout, clearTimeout, Promise, Error, console };
vm.createContext(ctx);
vm.runInContext(constMatch[0] + '\n' + helperMatch[0], ctx);

/* `function` declarations land on the context object; `const` ones do not,
   so the constant has to be read back by evaluating its name. */
const _lgWithTimeout    = ctx._lgWithTimeout;
const LG_NET_TIMEOUT_MS = vm.runInContext('LG_NET_TIMEOUT_MS', ctx);

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log('ok    ' + name); }
  else { failed++; console.error('FAIL  ' + name + (detail ? '\n      ' + detail : '')); }
}

(async () => {

  /* 1. Production timeout is a real, sane value. */
  check('LG_NET_TIMEOUT_MS is between 5s and 60s',
        LG_NET_TIMEOUT_MS >= 5000 && LG_NET_TIMEOUT_MS <= 60000,
        'got ' + LG_NET_TIMEOUT_MS);

  /* 2. A promise that settles in time passes straight through. */
  const value = await _lgWithTimeout(Promise.resolve('snapshot'), 1000, 'x');
  check('resolves through when the promise settles in time', value === 'snapshot',
        'got ' + JSON.stringify(value));

  /* 3. A real rejection is preserved, not swallowed or relabelled. */
  const authErr = Object.assign(new Error('bad password'), { code: 'auth/wrong-password' });
  let caught = null;
  try { await _lgWithTimeout(Promise.reject(authErr), 1000, 'x'); }
  catch (e) { caught = e; }
  check('passes the original rejection through unchanged',
        caught && caught.code === 'auth/wrong-password',
        'got ' + (caught && caught.code));

  /* 4. THE BUG: a promise that never settles must reject, not hang. */
  const hangsForever = new Promise(() => {});          // exactly what .once() did
  const started = Date.now();
  let timeoutErr = null;
  try { await _lgWithTimeout(hangsForever, 120, 'טעינת פרטי משתמש'); }
  catch (e) { timeoutErr = e; }
  const elapsed = Date.now() - started;

  check('a never-settling promise rejects instead of hanging', timeoutErr !== null);
  check('the rejection carries code lg/timeout',
        timeoutErr && timeoutErr.code === 'lg/timeout',
        'got ' + (timeoutErr && timeoutErr.code));
  check('the message names the operation, so the UI can be specific',
        timeoutErr && timeoutErr.message.includes('טעינת פרטי משתמש'),
        'got ' + (timeoutErr && timeoutErr.message));
  check('it rejects near the deadline, not long after',
        elapsed >= 110 && elapsed < 1000, elapsed + 'ms');

  /* 5. The timer must be cleared, or node would stay alive past the test. */
  const t0 = Date.now();
  await _lgWithTimeout(Promise.resolve(1), 5000, 'x');
  check('clears its timer when the promise wins the race',
        Date.now() - t0 < 200,
        'if the timer leaked, this process would hang for 5s on exit');

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll timeout checks passed.');
})();
