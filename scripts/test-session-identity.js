#!/usr/bin/env node
/**
 * Tests that a page stays bound to the identity it authenticated as.
 *
 * The bug: open a client's portal, work for a few minutes, refresh or upload a
 * sketch and come back — and the page greets "שלום בן לוז". The sketch queue
 * then showed that upload as if the admin had made it, under the wrong client.
 *
 * Two mechanisms combined:
 *
 * 1. onAuthStateChanged is not a one-shot. lgRequireAuthAsync subscribed and
 *    never unbound, so the callback kept firing for the life of the page.
 * 2. Firebase Auth keeps its user in localStorage, which every tab of the site
 *    shares, while lgSession lives in sessionStorage, which belongs to one tab.
 *
 * So signing in as someone else in ANY tab rewrote lgSession in all the others.
 * A portal tab silently adopted the new user. upload.html and new-order.html
 * then read lgSession at submit time and filed the client's sketch under
 * whoever had signed in last.
 *
 * The fix binds the page to the uid it resolved: a token refresh (same uid) is
 * ignored, a real change ends the session here instead of adopting it, and any
 * write that records who someone is goes through lgVerifiedSession, which
 * checks the display cache against firebase.auth().currentUser.
 *
 * Run: node scripts/test-session-identity.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the guard binds to one identity ───────────────────────────────────── */
const guard = (SRC.match(/function lgRequireAuthAsync[\s\S]*?\n}/) || [''])[0];
check('lgRequireAuthAsync exists', guard.length > 0, true);
check('it remembers the uid it bound to', /boundUid\s*=\s*fbUser\.uid/.test(guard), true);
check('a token refresh for the same user changes nothing',
      /fbUser\.uid\s*===\s*boundUid\)\s*return;/.test(guard), true);
check('a different user ends the session instead of being adopted',
      /lgClearSession\(\);\s*\n\s*window\.location\.href\s*=\s*'login\.html\?switched=1'/.test(guard), true);
check('the session records the uid so writes can verify it',
      /uid:\s*fbUser\.uid/.test(guard), true);

/* ── lgVerifiedSession really compares the two ─────────────────────────── */
{
  const fn = (SRC.match(/function lgVerifiedSession[\s\S]*?\n}/) || [''])[0];
  check('lgVerifiedSession exists', fn.length > 0, true);

  const helpers = ['_lgNormalizePhone', '_lgPhoneFromAuthUser']
    .map(n => (SRC.match(new RegExp('function ' + n + '[\\s\\S]*?\\n}')) || [''])[0]);
  const ctx = { console, sessionStorage: null, firebase: null };
  vm.createContext(ctx);
  vm.runInContext(helpers.join('\n') + '\n' + fn + '\n'
    + 'function lgGetSession(){ return __sess; }\nvar __sess = {};', ctx);

  const run = (sess, currentUser) => {
    ctx.__sess = sess;
    ctx.firebase = { auth: () => ({ currentUser }) };
    return ctx.lgVerifiedSession();
  };

  const client = { uid: 'uid-client', email: '0521234567@luzglass.local' };
  const admin  = { uid: 'uid-admin',  email: '0509999999@luzglass.local' };
  const clientSess = { name: 'א.מ.מראות', phone: '0521234567', uid: 'uid-client' };

  check('the matching user passes', run(clientSess, client), clientSess);
  check('a swapped auth user is rejected', run(clientSess, admin), null);
  check('no signed-in user is rejected', run(clientSess, null), null);
  check('an empty session is rejected', run({}, client), null);

  /* the exact shape of the bug: the cache was rewritten to the admin while the
     tab was still showing the client's portal */
  const rewritten = { name: 'בן לוז', phone: '0509999999', uid: 'uid-admin' };
  check('an old session with no uid still fails on the phone',
        run({ name: 'א.מ.מראות', phone: '0521234567' }, admin), null);
  check('and the rewritten admin session does not pass as the client',
        run(rewritten, client), null);
}

/* ── every write that records a person must verify ─────────────────────── */
for (const [page, fn] of [['upload.html', 'submitUpload'], ['new-order.html', 'mfSubmit']]) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  /* scope to the submit function — logoClick reads the cache too, but only to
     pick a destination, which cannot mis-attribute anything */
  const body = (html.match(new RegExp('async function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
  check(`${page} · ${fn} exists`, body.length > 0, true);
  check(`${fn} verifies the identity before saving`,
        /lgVerifiedSession\(\)/.test(body), true);
  check(`${fn} does not read the display cache directly`,
        /sessionStorage\.getItem\('lgSession'\)/.test(body), false);
  check(`${fn} aborts rather than filing under the wrong client`,
        /if \(!sess\) \{[\s\S]{0,400}?return;/.test(body), true);
}

/* ── login explains the disconnect ─────────────────────────────────────── */
{
  const login = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
  check('login.html explains a switched session', /has\('switched'\)/.test(login), true);
  check('and does not bounce straight back to the closed session',
        /return;\s*\/\/ בלי redirect/.test(login), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll session-identity checks passed.');
