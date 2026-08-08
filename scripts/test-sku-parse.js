#!/usr/bin/env node
/**
 * Tests lgGuessOperationalFromName against real item names from Hashavshevet.
 *
 * This parser decides three separate things that used to be conflated into one
 * `glass` field:
 *   what the material IS      glass
 *   how it is cut             proc
 *   what it still owes        graphic / chalavi / triplex
 *
 * The cases that matter are the ones that were wrong before:
 *   חלבי is a finish, not a material — "8 מ''מ חלבי" is 8 שקוף owing a trip
 *     to the sandblaster, and must be findable under 8 שקוף
 *   'אסיד קליר' must beat 'אסיד', or the two-word type is lost
 *   triplex חלבי arrives already frosted and must NOT be flagged for
 *     sandblasting
 *
 * Extracted from firebase-db.js rather than copied, so it fails if the shipped
 * implementation changes shape.
 *
 * Run: node scripts/test-sku-parse.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');

const parts = [
  SRC.match(/const LG_GLASS_TYPES_BY_LENGTH\s*=\s*\[[\s\S]*?\];/),
  SRC.match(/const LG_GLASS_DEFAULT_BASE\s*=\s*'[^']*';/),
  SRC.match(/const LG_IMPLIES_BASE_GLASS\s*=\s*\[[^\]]*\];/),
  SRC.match(/function lgGuessOperationalFromName[\s\S]*?\n}/),
];
if (parts.some(p => !p)) {
  console.error('FAIL  could not extract the parser from firebase-db.js');
  process.exit(1);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);
const parse = ctx.lgGuessOperationalFromName;

let failed = 0;
function check(name, actual, expected) {
  const keys = Object.keys(expected);
  const bad  = keys.filter(k => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
  if (!bad.length) { console.log('ok    ' + name); return; }
  failed++;
  console.error('FAIL  ' + name);
  bad.forEach(k => console.error(`        ${k}: expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(actual[k])}`));
}

/* ── the ordinary case, unchanged behaviour ───────────────────────────── */
check('8 מ\'\'מ שקוף מחוסם', parse("8 מ''מ שקוף מחוסם"),
      { mm: 8, glass: 'שקוף', proc: 'chisum' });
check('6 מ\'\'מ אפור מלוטש', parse("6 מ''מ אפור מלוטש"),
      { mm: 6, glass: 'אפור', proc: 'litush' });

/* ── חלבי is a finish. The material underneath is שקוף. ───────────────── */
check('8 מ\'\'מ חלבי חתוך → 8 שקוף + chalavi', parse("8 מ''מ חלבי חתוך"),
      { mm: 8, glass: 'שקוף', chalavi: true });
check('12 מ\'\'מ חלבי מחוסם keeps its proc', parse("12 מ''מ חלבי מחוסם"),
      { mm: 12, glass: 'שקוף', proc: 'chisum', chalavi: true });
/* the one case where חלבי sits on a named material */
check('4 מ\'\'מ צנצילה חלבי מחוסם → צנצילה, not שקוף', parse("4 מ''מ צנצילה חלבי מחוסם"),
      { mm: 4, glass: 'צנצילה', proc: 'chisum', chalavi: true });

/* ── longest-first ordering. This is what broke 10 SKUs. ──────────────── */
check('10 מ\'\'מ אסיד חתוך → אסיד (was blank)', parse("10 מ''מ אסיד חתוך"),
      { mm: 10, glass: 'אסיד' });
check('10 מ\'\'מ אסיד קליר מלוטש → אסיד קליר, not אסיד', parse("10 מ''מ אסיד קליר מלוטש"),
      { mm: 10, glass: 'אסיד קליר', proc: 'litush' });
check('4 מ\'\'מ לקובל שחור חתוך → לקובל שחור', parse("4 מ''מ לקובל שחור חתוך"),
      { mm: 4, glass: 'לקובל שחור' });
check('4 מ\'\'מ לקובל לבן מלוטש → לקובל לבן', parse("4 מ''מ לקובל לבן מלוטש"),
      { mm: 4, glass: 'לקובל לבן', proc: 'litush' });

/* ── the rest of the types that were invisible ────────────────────────── */
check('6 מ\'\'מ פפיטה מחוסם ללא פינויים', parse("6 מ''מ פפיטה מחוסם ללא פינויים"),
      { mm: 6, glass: 'פפיטה', proc: 'chisum' });
check('4 מ\'\'מ סבתא חתוך', parse("4 מ''מ סבתא חתוך"),
      { mm: 4, glass: 'סבתא' });
check('8 מ\'\'מ מאסטר ליין מחוסם', parse("8 מ''מ מאסטר ליין מחוסם"),
      { mm: 8, glass: 'מאסטר ליין', proc: 'chisum' });
check('4 מ\'\'מ צנצילה מלוטש', parse("4 מ''מ צנצילה מלוטש"),
      { mm: 4, glass: 'צנצילה', proc: 'litush' });

/* ── דלתות נגרים is 5mm שקוף with holes, nothing special ──────────────── */
check('5 מ\'\'מ דלתות נגרים מחוסם → שקוף', parse("5 מ''מ דלתות נגרים מחוסם"),
      { mm: 5, glass: 'שקוף', proc: 'chisum' });

/* ── triplex: thickness comes from the 3+3 form, and חלבי triplex arrives
      already frosted so it must NOT be sent to the sandblaster ──────────── */
check('3+3 טריפלקס מלוטש → mm 6, triplex', parse("3+3 טריפלקס מלוטש"),
      { mm: 6, triplex: true, proc: 'litush' });
check('טריפלקס 4+4 חתוך → mm 8, triplex', parse("טריפלקס 4+4 חתוך"),
      { mm: 8, triplex: true });
check('טריפלקס 4+4 חלבי חתוך → triplex, chalavi FALSE', parse("טריפלקס 4+4 חלבי חתוך"),
      { mm: 8, triplex: true, chalavi: false });
check('10+10 טריפלקס קליר מחוסם', parse("10+10 טריפלקס קליר מחוסם"),
      { mm: 20, glass: 'קליר', triplex: true, proc: 'chisum' });

/* ── graphics still works ─────────────────────────────────────────────── */
check('8 מ\'\'מ שקוף גרפיקה מחוסם', parse("8 מ''מ שקוף גרפיקה מחוסם"),
      { mm: 8, glass: 'שקוף', graphic: true, proc: 'chisum' });

/* ── a labour line is not glass and must claim nothing ────────────────── */
{
  const r = parse('שכר חיסום');
  check('שכר חיסום claims no glass and no thickness', r,
        { glass: undefined, mm: undefined });
  /* it does contain "חיסום", so proc is set — harmless, but noted here so the
     behaviour is deliberate rather than a surprise. These two SKUs are removed
     from the catalogue anyway. */
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll SKU parse checks passed.');
