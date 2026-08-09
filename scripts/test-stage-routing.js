#!/usr/bin/env node
/**
 * Tests the item-level routing helpers and lgNextStage.
 *
 * The rules being pinned:
 *   חלבי is sandblasting, not a glass type, and shares the graphic stage —
 *     both are surface work at the same station, so there is no חלבי stage
 *   triplex חלבי arrives already frosted and must NOT be sent for sandblasting
 *   triplex that is not tempered is cut in-house and is ready after the work
 *     day, like a mirror; only tempered triplex travels to the factory
 *   items created before the flags existed carry only a name, so every helper
 *     falls back to reading it
 *
 * Run: node scripts/test-stage-routing.js
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
  SRC.match(/function lgNextStage[\s\S]*?\n}/),
];
if (parts.some(p => !p)) {
  console.error('FAIL  could not extract the routing helpers from firebase-db.js');
  process.exit(1);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);

const { _lgItemHasChalavi, _lgItemIsTriplex, _lgItemIsLaminatedTriplex,
        _lgItemHasSurfaceWork, lgNextStage } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── חלבי ──────────────────────────────────────────────────────────────── */
check('flagged chalavi', _lgItemHasChalavi({ chalavi: true }), true);
check('plain glass is not chalavi', _lgItemHasChalavi({ chalavi: false }), false);
check('legacy item, name says חלבי', _lgItemHasChalavi({ name: "8 מ''מ חלבי חתוך" }), true);
check('legacy item, no חלבי in name', _lgItemHasChalavi({ name: "8 מ''מ שקוף מחוסם" }), false);
/* triplex חלבי comes frosted from the supplier — never sandblasted here */
check('triplex חלבי by name is NOT sandblasted',
      _lgItemHasChalavi({ name: 'טריפלקס 4+4 חלבי חתוך' }), false);
check('an explicit false beats the name',
      _lgItemHasChalavi({ chalavi: false, name: 'טריפלקס 4+4 חלבי חתוך' }), false);

/* ── triplex ───────────────────────────────────────────────────────────── */
check('flagged triplex', _lgItemIsTriplex({ triplex: true }), true);
check('legacy triplex by name', _lgItemIsTriplex({ name: '3+3 טריפלקס מלוטש' }), true);
check('ordinary glass is not triplex', _lgItemIsTriplex({ name: "8 מ''מ שקוף מחוסם" }), false);

/* only tempered triplex goes to the laminator */
check('tempered triplex travels to the factory',
      _lgItemIsLaminatedTriplex({ triplex: true, chisum: true }), true);
check('untempered triplex is ready in-house',
      _lgItemIsLaminatedTriplex({ triplex: true, chisum: false }), false);
check('tempered ordinary glass is not laminated triplex',
      _lgItemIsLaminatedTriplex({ chisum: true, name: "8 מ''מ שקוף מחוסם" }), false);

/* ── surface work = graphic OR chalavi, one stage ─────────────────────── */
check('graphic counts as surface work', _lgItemHasSurfaceWork({ graphic: true }), true);
check('chalavi counts as surface work', _lgItemHasSurfaceWork({ chalavi: true }), true);
check('both at once is still surface work',
      _lgItemHasSurfaceWork({ graphic: true, chalavi: true }), true);
check('plain glass needs no surface work',
      _lgItemHasSurfaceWork({ name: "8 מ''מ שקוף מלוטש" }), false);

/* ── lgNextStage ───────────────────────────────────────────────────────── */
const at = (stage, items) => lgNextStage({ stage, items }, false);

check('workday + plain glass → done', at('workday', [{ name: "6 מ''מ שקוף מלוטש" }]), 'done');
check('workday + tempered → chisum', at('workday', [{ chisum: true }]), 'chisum');
check('workday + graphic → graphic', at('workday', [{ graphic: true }]), 'graphic');
/* the change: חלבי routes through the existing graphic stage */
check('workday + chalavi → graphic (no new stage)',
      at('workday', [{ chalavi: true }]), 'graphic');
check('workday + tempered chalavi → chisum first',
      at('workday', [{ chisum: true, chalavi: true }]), 'chisum');
check('chisum + chalavi → graphic',
      at('chisum', [{ chisum: true, chalavi: true }]), 'graphic');
check('chisum + plain → done', at('chisum', [{ chisum: true }]), 'done');

/* regular triplex is cut in-house: it is not tempered, so it never routes to
   the factory and is ready after the work day, exactly like a mirror */
check('workday + regular triplex → done',
      at('workday', [{ triplex: true, chisum: false, name: '3+3 טריפלקס מלוטש' }]), 'done');
check('workday + tempered triplex → chisum',
      at('workday', [{ triplex: true, chisum: true }]), 'chisum');
/* triplex חלבי owes no surface work, so it must not divert to the graphic stage */
check('workday + triplex חלבי → done, not graphic',
      at('workday', [{ triplex: true, chisum: false, chalavi: false,
                       name: 'טריפלקס 4+4 חלבי חתוך' }]), 'done');

/* delivery clients still win over done */
check('delivery client → delivery',
      lgNextStage({ stage: 'workday', items: [{}], deliveryClient: true }, false), 'delivery');
check('done → collected', at('done', [{}]), 'collected');

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll stage routing checks passed.');
