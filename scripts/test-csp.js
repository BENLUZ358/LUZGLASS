#!/usr/bin/env node
/**
 * CSP regression test.
 *
 * The Content-Security-Policy in vercel.json has now broken production twice:
 *   e4815f4  reCAPTCHA script + auth iframe blocked
 *   (this)   Realtime Database long-polling blocked -> login hangs forever
 *
 * Both had the same shape: a host the app genuinely needs was present in one
 * directive but missing from another. This asserts every host the app loads is
 * allowed in the directive that actually governs how it is loaded.
 *
 * Run: node scripts/test-csp.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const csp  = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
  .headers.flatMap(h => h.headers)
  .find(h => h.key === 'Content-Security-Policy').value;

/* Parse "directive a b c; directive2 d" into { directive: [a,b,c] } */
const policy = {};
for (const part of csp.split(';')) {
  const [name, ...sources] = part.trim().split(/\s+/);
  if (name) policy[name] = sources;
}

/**
 * Each case states WHAT loads the resource and HOW, because the "how"
 * determines which directive applies — that is precisely what was got wrong.
 */
const CASES = [
  { directive: 'script-src', host: 'https://www.gstatic.com',
    why: 'firebase-app/database/auth-compat.js are <script src> from gstatic' },

  { directive: 'script-src', host: 'https://apis.google.com',
    why: 'Firebase Auth loads apis.google.com/js/api.js for the auth iframe' },

  { directive: 'script-src', host: 'https://*.firebasedatabase.app',
    why: 'RTDB long-polling injects <script src="https://<db-host>/.lp?...">. ' +
         'Being in connect-src is NOT enough — the SDK uses a script tag, not fetch. ' +
         'When blocked, .once() never resolves and never rejects, so login hangs ' +
         'on the spinner with no error.' },

  { directive: 'connect-src', host: 'https://*.firebasedatabase.app',
    why: 'RTDB REST + websocket handshake' },

  { directive: 'connect-src', host: 'wss://*.firebasedatabase.app',
    why: 'RTDB websocket transport (the path used when it is not long-polling)' },

  { directive: 'connect-src', host: 'https://*.googleapis.com',
    why: 'identitytoolkit — signInWithEmailAndPassword' },

  { directive: 'style-src', host: 'https://fonts.googleapis.com',
    why: 'Heebo + Playfair Display stylesheet' },

  { directive: 'font-src', host: 'https://fonts.gstatic.com',
    why: 'the font files the above stylesheet points at' },

  { directive: 'frame-src', host: 'https://lussglass.firebaseapp.com',
    why: 'Firebase Auth helper iframe (authDomain in firebase-db.js)' },
];

let failed = 0;
for (const c of CASES) {
  const sources = policy[c.directive] || [];
  const ok = sources.includes(c.host);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${c.directive} is missing ${c.host}`);
    console.error(`      ${c.why}\n`);
  } else {
    console.log(`ok    ${c.directive} allows ${c.host}`);
  }
}

/* The font-src directive has no 'self'; make sure that stays deliberate. */
if (!policy['default-src'] || !policy['default-src'].includes("'self'")) {
  console.error("FAIL  default-src must include 'self'");
  failed++;
}

if (failed) {
  console.error(`\n${failed} CSP check(s) failed.`);
  process.exit(1);
}
console.log('\nAll CSP checks passed.');
