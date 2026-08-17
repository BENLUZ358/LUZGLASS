#!/usr/bin/env node
/**
 * Tests the check-station's guard against a stale checkState snapshot.
 *
 * The symptom: press "סיים סקיצה" and the list claims every sketch is done,
 * while sketches plainly remain. Leaving the station and coming back corrects
 * it — so the stored data was right the whole time and only the screen was
 * wrong.
 *
 * The cause is a flag whose lifetime is a beat too short:
 *
 *   saveCS set _csLocalPending, wrote, and cleared it in finally — that is,
 *   when the WRITE was acknowledged. The listener event carrying that same
 *   write arrives afterwards, by which time the flag is already off.
 *
 * With one write nothing goes wrong: the late snapshot equals what we hold.
 * With two in quick succession — tick an item, immediately press finish — the
 * ordering that bites is:
 *
 *   write 1 acknowledged
 *   write 2 begins, flag set
 *   snapshot of write 2 arrives → skipped, because the flag is set
 *   write 2 acknowledged, flag cleared
 *   snapshot of write 1 arrives → accepted → cs reverts to the older state
 *
 * and nothing arrives afterwards to correct it.
 *
 * The guard keeps what was written and ignores snapshots until it sees exactly
 * that, so an older echo can never be applied. A timeout releases it if the
 * snapshot never comes, because a deaf screen is worse than a stale one.
 *
 * Run: node scripts/test-checkstate-race.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the ordering, run against both behaviours ─────────────────────────── */
function simulate(guarded) {
  let cs = {}, pending = null, inFlight = false;

  const onSnapshot = incoming => {
    if (inFlight) return;
    if (guarded && pending) {
      if (JSON.stringify(incoming) === pending) pending = null;
      return;
    }
    cs = incoming;
  };
  const beginWrite = payload => { inFlight = true; if (guarded) pending = JSON.stringify(payload); cs = payload; };
  const ackWrite   = () => { inFlight = false; };

  return { cs: () => cs, onSnapshot, beginWrite, ackWrite, pending: () => pending };
}

/* the exact sequence that reverts the screen */
for (const [label, guarded, expected] of [
  ['unguarded, an older echo wins', false, { A: { 0: true } }],
  ['guarded, the newer state holds', true, { A: { 0: true, 1: true } }],
]) {
  const s = simulate(guarded);
  s.beginWrite({ A: { 0: true } });            s.ackWrite();   // tick an item
  s.beginWrite({ A: { 0: true, 1: true } });                   // finish, still in flight
  s.onSnapshot({ A: { 0: true, 1: true } });                   // its echo — skipped
  s.ackWrite();
  s.onSnapshot({ A: { 0: true } });                            // the older echo lands
  check(label, s.cs(), expected);
}

/* ── the guard must not make the screen deaf ───────────────────────────── */
{
  const s = simulate(true);
  s.beginWrite({ A: { 0: true } }); s.ackWrite();
  s.onSnapshot({ A: { 0: true } });                 // our own write returns
  check('the guard releases once its snapshot arrives', s.pending(), null);

  /* and a later change from another station is then accepted */
  s.onSnapshot({ A: { 0: true, 5: true } });
  check('a genuine change from elsewhere still applies', s.cs(), { A: { 0: true, 5: true } });
}

/* a legitimate deletion must still get through — an earlier "restore" branch
   was removed from this file precisely because it blocked those */
{
  const s = simulate(true);
  s.beginWrite({ A: { 0: true } }); s.ackWrite();
  s.onSnapshot({ A: { 0: true } });
  s.onSnapshot({});                                  // someone reset the list
  check('a reset is not blocked', s.cs(), {});
}

/* ── the code carries the guard, and a release for when it fails ───────── */
check('saveCS records what it wrote',
      /_csPendingWrite = payload;/.test(SRC), true);
check('and does not clear it on acknowledgement',
      /finally \{\s*_csLocalPending = false;\s*\}/.test(SRC), true);
check('the listener waits for that exact snapshot',
      /if\(JSON\.stringify\(incoming\) === _csPendingWrite\) _csClearPending\(\)/.test(SRC), true);
check('a failed write releases the guard',
      /_csClearPending\(\);\s*\/\/ הכתיבה נכשלה/.test(SRC), true);
check('and a timeout releases it if the snapshot never comes',
      /_csPendingTimer = setTimeout\(_csClearPending, 8000\)/.test(SRC), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll check-state race checks passed.');
