#!/usr/bin/env node
/**
 * Tests that a note written in the sketch queue reaches the people it is for.
 *
 * The sketch queue wrote notes to Firebase; check-station read them from
 * localStorage only. Two note systems that never met, so the popup in
 * check-station fired only for notes written in check-station itself, and the
 * drafter had no notes at all. A note saying "the 8mm here is tempered, not
 * polished" simply never arrived.
 *
 * Run: node scripts/test-order-notes.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const CS   = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
const DR   = fs.readFileSync(path.join(ROOT, 'drafter.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the merge rule ────────────────────────────────────────────────────── */
{
  const fn = (CS.match(/function mergeOrderNotes[\s\S]*?\n}/) || [''])[0];
  check('the merge function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const merge = (local, orders) => ctx.mergeOrderNotes(local, orders);

  check('a note from the order arrives',
        merge({}, [{ id: 'a', notes: 'בדוק מידות' }]), { a: 'בדוק מידות' });
  check('and overrides a stale local copy',
        merge({ a: 'ישן' }, [{ id: 'a', notes: 'חדש' }]), { a: 'חדש' });
  /* the risk this guards: check-station's own notes were never in Firebase,
     so a blind overwrite would delete every note written at the station */
  check('a local note survives an order that carries none',
        merge({ a: 'נכתב בתחנה' }, [{ id: 'a' }]), { a: 'נכתב בתחנה' });
  check('an empty note on the order does not erase the local one',
        merge({ a: 'נכתב בתחנה' }, [{ id: 'a', notes: '' }]), { a: 'נכתב בתחנה' });
  check('notes for other orders are left alone',
        merge({ b: 'שלי' }, [{ id: 'a', notes: 'חדש' }]), { b: 'שלי', a: 'חדש' });
  check('no orders, no change', merge({ a: 'x' }, []), { a: 'x' });
  check('and a missing list does not throw', merge({ a: 'x' }, null), { a: 'x' });
  /* it must not mutate what it was handed — the caller keeps the old map */
  {
    const before = { a: 'ישן' };
    merge(before, [{ id: 'a', notes: 'חדש' }]);
    check('the input map is left untouched', before, { a: 'ישן' });
  }
}

/* ── check-station writes through, not only to localStorage ────────────── */
check('the station merges the orders it receives',
      /listenAllOrders\(function\(fbOrders\)\{[\s\S]{0,300}?mergeOrderNotes\(/.test(CS), true);
check('saving a note at the station reaches Firebase',
      /function saveQN[\s\S]{0,400}?updateOrder\(/.test(CS), true);
check('and so does saving it from the sheet',
      /function saveSkNote[\s\S]{0,400}?updateOrder\(/.test(CS), true);
check('localStorage is still written, so nothing is lost offline',
      /function saveQN[\s\S]{0,400}?saveNotes\(\)/.test(CS), true);

/* ── the drafter sees them at all ──────────────────────────────────────── */
check('the drafter has a note popup', /function drShowNote/.test(DR), true);
check('and opening a sketch triggers it',
      /function showOrder[\s\S]*?drShowNote\(/.test(DR), true);
check('the popup can be dismissed', /function drDismissNote/.test(DR), true);
check('its text is escaped, not injected as html',
      /function drShowNote[\s\S]{0,300}?textContent/.test(DR), true);
check('and it never uses innerHTML for the note',
      /function drShowNote[\s\S]{0,300}?innerHTML/.test(DR), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-note checks passed.');
