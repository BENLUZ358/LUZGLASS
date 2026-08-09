#!/usr/bin/env node
/**
 * Tests lgSplitFactoryItems — which items travel to the factory, and to which
 * of the two processes.
 *
 * The report is a physical sheet that goes to the factory, where tempering and
 * triplex lamination are different jobs. One combined sheet leaves them unable
 * to tell which glass is for which. On top of that, tempering comes back the
 * next day and lamination after several unpredictable days, so a shared report
 * number would let "I received the report" mark triplex as back while it is
 * still out.
 *
 * What must never travel:
 *   mirrors — cut here, ready after the work day
 *   triplex that is not tempered — same
 *
 * Run: node scripts/test-factory-split.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');

const parts = [
  SRC.match(/function _lgItemHasGraphic[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasChalavi[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsLaminatedTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasSurfaceWork[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsMirror[\s\S]*?\n}/),
  SRC.match(/function lgSplitFactoryItems[\s\S]*?\n}/),
];
if (parts.some(p => !p)) {
  console.error('FAIL  could not extract the split helpers from firebase-db.js');
  process.exit(1);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);
const { lgSplitFactoryItems, _lgItemIsMirror } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const counts = items => {
  const s = lgSplitFactoryItems(items);
  return [s.chisum.length, s.triplex.length];
};

/* ── mirrors ───────────────────────────────────────────────────────────── */
check('mirror by glass', _lgItemIsMirror({ glass: 'מראה' }), true);
check('grey mirror is still a mirror', _lgItemIsMirror({ glass: 'מראה אפורה' }), true);
check('bronze mirror is still a mirror', _lgItemIsMirror({ glass: 'מראה ברונזה' }), true);
check('legacy mirror by name', _lgItemIsMirror({ name: "5 מ''מ מראה חתוך" }), true);
check('plain grey glass is not a mirror', _lgItemIsMirror({ glass: 'אפור' }), false);

/* ── the split ─────────────────────────────────────────────────────────── */
check('nothing to send', counts([{ name: "6 מ''מ שקוף מלוטש" }]), [0, 0]);
check('ordinary tempered glass → chisum', counts([{ chisum: true, glass: 'שקוף' }]), [1, 0]);
check('tempered triplex → triplex', counts([{ chisum: true, triplex: true }]), [0, 1]);

/* a tempered mirror still does not travel — it is cut and silvered here */
check('tempered mirror does not travel',
      counts([{ chisum: true, glass: 'מראה' }]), [0, 0]);
check('tempered grey mirror does not travel',
      counts([{ chisum: true, glass: 'מראה אפורה' }]), [0, 0]);

/* regular triplex is not tempered, so it never reaches the split */
check('untempered triplex does not travel',
      counts([{ chisum: false, triplex: true }]), [0, 0]);

/* ── the case the whole thing exists for ──────────────────────────────── */
check('one order with both → one item to each report',
      counts([
        { chisum: true, glass: 'שקוף' },
        { chisum: true, triplex: true },
        { chisum: true, glass: 'מראה' },        // stays here
        { chisum: false, glass: 'קליר' },       // not tempered
      ]), [1, 1]);

check('several of each are counted separately',
      counts([
        { chisum: true, glass: 'שקוף' },
        { chisum: true, glass: 'קליר' },
        { chisum: true, triplex: true },
        { chisum: true, triplex: true },
        { chisum: true, triplex: true },
      ]), [2, 3]);

/* ── indices come back so the caller can mark arrival per item ─────────── */
{
  const s = lgSplitFactoryItems([
    { chisum: true, glass: 'שקוף' },
    { chisum: true, triplex: true },
  ]);
  check('chisum entry keeps its original index', s.chisum[0].idx, 0);
  check('triplex entry keeps its original index', s.triplex[0].idx, 1);
}

/* ── legacy items, name only ───────────────────────────────────────────── */
check('legacy tempered triplex by name → triplex',
      counts([{ chisum: true, name: '8+8 טריפלקס שקוף מחוסם' }]), [0, 1]);
check('empty and missing input are safe', [counts([]), counts(null)], [[0, 0], [0, 0]]);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll factory split checks passed.');
