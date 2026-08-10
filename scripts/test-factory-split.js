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

/* ── the chisum screen must enumerate through the splitter ─────────────
   workday.html counted panels with items.filter(it => it.chisum), which is a
   different set from what actually travels on the chisum report: it also
   swept up mirrors, which are cut in-house and never leave, and laminated
   triplex, which goes to the same factory on a SEPARATE report and is ticked
   back through triplexArrived rather than chisumArrivedIdxs.

   So those panels were counted in the chisum badge and again in the triplex
   badge, and nothing the worker could do would clear them from the first —
   the chisum badge could never reach zero on such an order. */
{
  const order = { items: [
    { chisum: true, glass: 'שקוף' },                 // 0 — on the chisum report
    { chisum: true, glass: 'מראה' },                  // 1 — never leaves the building
    { chisum: true, triplex: true, glass: 'שקוף' },   // 2 — on the triplex report
    { graphic: true, glass: 'שקוף' },                 // 3 — not a factory panel at all
  ]};
  const split = lgSplitFactoryItems(order.items);
  check('only the real chisum panel is on the chisum report',
        split.chisum.map(e => e.idx), [0]);
  check('the laminated triplex panel is on the triplex report',
        split.triplex.map(e => e.idx), [2]);

  const naive = order.items.filter(it => it.chisum).length;
  check('the old count really did inflate this order from 1 to 3', naive, 3);
  check('and really did count the triplex panel on both reports',
        naive - split.chisum.length, split.triplex.length + 1);   // +1 for the mirror
}

const fs2      = require('fs');
const workday  = fs2.readFileSync(require('path').join(__dirname, '..', 'workday.html'), 'utf8');
check('workday exposes one definition of what is on the chisum report',
      /function _chisumIdxsOf\(/.test(workday), true);
check('and it is built from lgSplitFactoryItems',
      /function _chisumIdxsOf\([\s\S]{0,200}?lgSplitFactoryItems\(/.test(workday), true);
{
  /* no arrival path may go back to the raw flag. The remaining it.chisum uses
     are display labels (מחוסם/מלוטש) and the build tab, which are not the
     factory report — so this pins the arrival call sites by name instead. */
  for (const fn of ['markAllClientArrived']) {
    const body = (workday.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
    check(`${fn} enumerates through _chisumIdxsOf`, /_chisumIdxsOf\(/.test(body), true);
    check(`${fn} does not filter on the raw flag`, /\.chisum\b(?!Arrived|Report|Sent)/.test(body), false);
  }
  const uses = (workday.match(/_chisumIdxsOf\(/g) || []).length;
  check('every chisum arrival site uses it', uses >= 6, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll factory split checks passed.');
