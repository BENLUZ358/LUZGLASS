#!/usr/bin/env node
/**
 * Tests how many screens stand between "הועבר לחשבשבת" and the next sketch.
 *
 * There were two: a preview listing every line, then a result showing the raw
 * Hashavshevet reply. Both were written for reasons that were real at the time.
 * The preview so a mapping mistake would not silently create a document. The
 * result because an early version auto-closed, marked the order sent, and left
 * no evidence when nothing had actually been created in Hashavshevet.
 *
 * Across twenty orders in a row, two modals that almost always say "fine" cost
 * forty clicks. So the fast path is a toast and the modal is kept only for the
 * cases where it has something to say:
 *
 *   an error                → modal, with the agent code and a retry
 *   an item was skipped     → modal, because the document is missing a panel
 *   already sent            → modal, showing what went and refusing to repeat
 *
 * The last one is new and is why `force` had to go. It used to be sent on every
 * call, which was safe while a human confirmed in a modal first; with one-click
 * sending it would mean a second click opens a second document.
 *
 * What the toast may NOT do is call a real send a success. The API records, in
 * its own comments and from experience, that Hashavshevet returned HTTP 200
 * while no document was created — httpOk means "the request was accepted", not
 * "the document exists", and the reply carries no dependable marker of the
 * difference. A green tick here would reproduce exactly the failure the old
 * result modal was written to catch. The toast therefore says "נשלח … לאמת
 * בחשבשבת", and only a fictitious run, which has nothing to verify, is closed
 * out as done.
 *
 * The record survives regardless — but a record nobody can reach is not
 * evidence, so the 409 returns the stored reply and the modal prints it. It is
 * deliberately not carried on every order: 4,000 characters times every order
 * in a node every page downloads whole. See test-sketch-storage.js.
 *
 * Run: node scripts/test-chash-flow.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const API   = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-order.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (name, src = ADMIN) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── one click ─────────────────────────────────────────────────────────── */
{
  const stage = bodyOf('sqSetStage');
  check('the button sends instead of previewing',
        /sqSendHashavshevet\(id\);/.test(stage), true);
  check('and no longer opens a preview first',
        /sqPreviewHashavshevet\(id\);/.test(stage), false);
}

/* ── nothing on screen when it works ───────────────────────────────────── */
{
  const send = bodyOf('sqSendHashavshevet');
  check('a clean send closes rather than renders',
        /if\(clean\)\{\s*_sqHbClose\(\);\s*sqShowChashConfirm\(id, data\);/.test(send), true);
  /* the three conditions, spelled out — a skipped item is not a clean send */
  check('"clean" means ok, ok, and nothing skipped',
        /const clean = res\.ok && data\.ok && !\(data\.skipped && data\.skipped\.length\);/.test(send), true);
  check('anything else opens the modal',
        /_sqHbOpen\(\);\s*_sqHbRender\(id, data, res\.ok\);/.test(send), true);
  check('the modal is built only when needed, not up front',
        /function _sqHbOpen\(\)/.test(ADMIN), true);
}

/* ── the toast carries what the modal used to ──────────────────────────── */
{
  const toast = bodyOf('sqShowChashConfirm');
  check('the confirmation takes the server reply', /function sqShowChashConfirm\(id, data\)/.test(ADMIN), true);
  check('and shows the reference', /אסמכתא \$\{ref\}/.test(toast), true);
  /* "נשלח", never "נפתח". Hashavshevet have already returned HTTP 200 with no
     document created — that is recorded in the API from experience — and the
     reply carries no reliable "created" marker. The toast may therefore claim
     only what is known: the request went out, here is the reference, verify.
     A fictitious run is the one case with nothing to verify. */
  check('a real send does not claim the document exists',
        /נשלח · אסמכתא \$\{ref\} · \$\{data\.lineCount\} שורות — לאמת בחשבשבת/.test(toast), true);
  check('and no green tick is shown for it',
        /'#27ae60'/.test(toast), false);
  check('a simulated run says so instead',
        /sim {13}\? `הורץ כפיקטיבי/.test(toast), true);
  check('it disappears on its own — nothing to dismiss',
        /setTimeout\(\(\)=>toast\.remove\(\),3200\)/.test(toast), true);
}

/* ── a second click must not open a second document ────────────────────── */
{
  const send = bodyOf('sqSendHashavshevet');
  check('force is no longer sent by default',
        /force: true/.test(send), false);
  check('it is opt-in, on an argument',
        /if\(force\) payload\.force = true;/.test(send), true);
  check('and the only caller that passes it asks first',
        /confirm\('לשלוח שוב לחשבשבת\?[\s\S]{0,200}?sqSendHashavshevet\(id, true\)/.test(bodyOf('sqResendHashavshevet')), true);
  check('the server still refuses a repeat without it',
        /order\.hashavshevet && order\.hashavshevet\.sentAt && !force/.test(API), true);
  check('"already sent" is reported, not shown as a failure',
        /if\(!ok && data\.sentAt\)\{[\s\S]{0,1200}?כבר נשלחה לחשבשבת/.test(ADMIN), true);
  /* and it is where the stored reply becomes readable again — a record nobody
     can reach is not evidence */
  check('the stored reply comes back on the 409',
        /response:  order\.hashavshevet\.response \|\| null/.test(API), true);
  check('it is not carried on every order instead',
        /hashavshevet:/.test(fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8')), false);
  check('and the modal shows it',
        /const stored = data\.response[\s\S]{0,240}?תשובת חשבשבת/.test(ADMIN), true);
}

/* ── the loud cases stay loud ──────────────────────────────────────────── */
{
  const render = bodyOf('_sqHbRender');
  check('a skipped item is spelled out, not buried in the raw reply',
        /פריטים לא נכללו במסמך/.test(render), true);
  /* the agent code lived in the preview footer, and the preview is no longer
     on the path — without this, a "קוד עובד לא קיים" failure is a dead end */
  check('the error offers the agent code',
        /<input id="sqHbAgent"[\s\S]{0,400}?onchange="_sqHbAgent=this\.value"/.test(render), true);
  check('and a retry',
        /onclick="sqSendHashavshevet\('\$\{lgEsc\(id\)\}'\)">נסה שוב/.test(render), true);
  check('the preview is still reachable when you want it',
        /onclick="sqPreviewHashavshevet\('\$\{lgEsc\(id\)\}'\)">הצג מה נשלח/.test(render), true);
}

/* ── the evidence does not depend on the screen ────────────────────────── */
check('every attempt is recorded server-side regardless',
      /db\.ref\('orders\/' \+ orderId \+ '\/hashavshevet'\)\.set\(attempt\)/.test(API), true);
check('including the raw reply', /response:   text\.slice\(0, 4000\)/.test(API), true);
check('and whether it was simulated', /simulated:  isTest \|\| null/.test(API), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll Hashavshevet-flow checks passed.');
