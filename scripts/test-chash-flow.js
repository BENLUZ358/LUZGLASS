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
 * Whether a reply is worth interrupting for is decided on the SERVER, not in
 * the browser and not by whoever is entering orders — they do not read
 * Hashavshevet replies and should not be asked to judge one. So the message on
 * a good send is an ordinary Hebrew sentence with no reply text in it at all,
 * and anything technical everywhere else is folded behind a <details>.
 *
 * The warning does not rest on httpOk, which means "the request was accepted" —
 * Hashavshevet have already returned HTTP 200 with nothing created. It rests on
 * the body. The first real send ever recorded, order 1058, answered:
 *
 *   {"apiRes":{"status":"ok"},"actionType":"imovein","messType":"apiReplay"}
 *
 * so the check is positive rather than negative: look for the marker known to
 * mean fine, and warn on anything else. That direction is the point. A reply in
 * a shape nobody has seen stops you instead of passing as success. A false
 * warning costs one click; a missing document costs a great deal more.
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
  check('"clean" means ok, ok, nothing skipped, and nothing flagged',
        /const clean = res\.ok && data\.ok && !\(data\.skipped && data\.skipped\.length\) && !data\.warn;/.test(send), true);
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
  /* An ordinary sentence. No reply text, no status code, no instruction to go
     and verify — the server has already decided there is nothing wrong, and a
     verify-every-time nag is one people stop reading by the tenth order. */
  check('a good send reads as an ordinary message',
        /`נשלח לחשבשבת · אסמכתא \$\{ref\}`/.test(toast), true);
  check('with nothing technical in it',
        /response|httpStatus|JSON/.test(toast), false);
  check('a simulated run says so instead',
        /sim  \? `הורץ כפיקטיבי · אסמכתא \$\{ref\}`/.test(toast), true);
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
        /const stored = _sqHbRaw\(data\.response, 'תשובת חשבשבת \(טכני\)'\);/.test(ADMIN), true);
}

/* ── the server decides what is worth interrupting for ─────────────────── */
{
  check('the flag is computed server-side, not in the browser',
        /const warn = isTest \? null/.test(API), true);
  check('a fictitious run is never flagged', /isTest \? null/.test(API), true);
  check('an empty reply is flagged', /חשבשבת החזירו תשובה ריקה/.test(API), true);
  check('so is one that is not JSON', /parsed === null +\? 'התשובה מחשבשבת אינה בפורמט צפוי'/.test(API), true);
  /* the marker from the first real reply, order 1058 */
  check('the known-good marker is what clears it',
        /String\(apiStatus\|\|''\)\.toLowerCase\(\) === 'ok' \? null/.test(API), true);
  check('and it is read from apiRes.status',
        /const apiStatus = parsed && parsed\.apiRes && parsed\.apiRes\.status;/.test(API), true);
  /* the direction matters: an unrecognised shape must warn, not pass */
  check('another status is named in the warning',
        /חשבשבת החזירו סטטוס "' \+ apiStatus \+ '" ולא "ok"/.test(API), true);
  check('and a reply with no status at all still warns',
        /התשובה מחשבשבת לא כללה סטטוס/.test(API), true);
  check('the flag reaches the browser', /^\s*warn,$/m.test(API), true);
}

/* ── nothing technical in anyone's face ────────────────────────────────── */
{
  const render = bodyOf('_sqHbRender');
  check('the raw reply is folded away everywhere',
        (render.match(/_sqHbRaw\(/g) || []).length >= 3, true);
  check('and there is only one place that formats it',
        /function _sqHbRaw\(resp, label\)/.test(ADMIN), true);
  check('it is behind a summary, not printed open',
        /<summary[\s\S]{0,120}?פרטים טכניים/.test(bodyOf('_sqHbRaw')), true);
  check('the warning itself is a plain Hebrew sentence',
        /כדאי לפתוח את חשבשבת ולוודא שההזמנה קיימת/.test(render), true);
}

/* ── the confirmation must survive the order leaving the queue ─────────── */
/*
 * This is where the first version of the feature failed outright, and it failed
 * silently, which is worse. sqSetStage writes the stage BEFORE sending. The
 * queue is built from orders that have no stage, so the Firebase echo removes
 * the order from sqItems while the request is still in flight. The confirmation
 * then began with
 *
 *     const item = sqItems.find(i => i.id === id);
 *     if (!item) return;
 *
 * and returned before the toast and before advancing — so a send that worked
 * perfectly showed nothing at all and left the screen on the order just sent.
 *
 * The client name is the only thing needed from that lookup, and there are
 * three places to get it.
 */
{
  const toast = bodyOf('sqShowChashConfirm');
  check('the confirmation does not bail when the row is gone',
        /if\(!item\) return;/.test(toast), false);
  check('it falls back to the open order',
        /\(sqCurrent && sqCurrent\.id === id \? sqCurrent : null\)/.test(toast), true);
  check('and then to the order list itself',
        /orders\.find\(o => o\.id === id\)/.test(toast), true);
  check('a missing name does not print a stray dash',
        /\$\{client\?lgEsc\(client\)\+' — ':''\}/.test(toast), true);

  /* and the advance, which is the other half of the same complaint */
  check('the sent order is excluded from what comes next',
        /const list=full\.filter\(i=>i\.id!==id\);/.test(toast), true);
  check('the index is measured against the full list',
        /sqCurrentIdx=full\.findIndex\(i=>i\.id===sqCurrent\.id\);/.test(toast), true);
  check('the next order is opened, not just highlighted',
        /sqCurrent=list\[0\];[\s\S]{0,200}?sqShowDetail\(\);/.test(toast), true);
  check('and an empty queue says so instead of going blank',
        /כל הסקיצות טופלו/.test(toast), true);
}

/* the ordering that causes it, pinned so the reason stays visible */
{
  const stage = bodyOf('sqSetStage');
  check('the stage is written before the send',
        stage.indexOf("updateStage(id, 'chash')") < stage.indexOf('sqSendHashavshevet(id)'), true);
  const build = bodyOf('buildSQItems');
  check('and the queue excludes anything with a stage',
        /if \(o\.stage && o\.stage !== ''\) return;/.test(build), true);
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
