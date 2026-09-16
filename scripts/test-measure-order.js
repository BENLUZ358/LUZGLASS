#!/usr/bin/env node
/**
 * "הזמנה לפי מידה" — the glass menu, and the SKU that was never written.
 *
 * This form predates the Hashavshevet API. Its glass list was eleven strings
 * typed by hand — 'גלינה שקוף 8מ"מ' and friends — none of them a part number,
 * and two of them naming glass the factory does not stock. The consequence was
 * silent and total: an item created here carried **no `sku` at all**, and
 * `api/hashavshevet-order.js` skips every line without one. A customer could
 * place a complete order and the agent order would open in Hashavshevet with
 * nothing in it.
 *
 * So the list now comes from the live catalogue, and the rule for what is
 * offered is "this customer has a price for it" — client list first, then the
 * global one, the same order `lgCalcOrderTotal` and the order endpoint price
 * by. A combination the form offers is a combination that can be invoiced.
 *
 * Ben's rules, 2026-09-16:
 *
 *   CUT is not a third flag. An item that is neither chisum nor litush is
 *   already displayed as "חיתוך" in workday.html and already rides the litush
 *   path (`hasLitush = o.litush || !o.chisum`). Giving it its own flag would
 *   have forked the chain for no reason.
 *
 *   CHALAVI is a modifier, not a processing. It combines with all three —
 *   `08HH` cut, `08HM` polished, `8HMH` tempered — and it exists for only
 *   eight of the forty types. The checkbox appears only where a part number
 *   does.
 *
 *   GRAPHIC stays out. Chalavi is sandblasting over the whole pane and needs
 *   no drawing; graphic is sandblasting to a customer's design and therefore
 *   requires a sketch. That difference is the whole reason one is here and the
 *   other is not.
 *
 *   MIRRORS have no tempered form — you cannot temper a mirror — and the
 *   catalogue agrees: every mirror has cut and polished only.
 *
 * Run: node scripts/test-measure-order.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const FB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const FORM = fs.readFileSync(path.join(ROOT, 'new-order.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* pull the shared helpers out of firebase-db.js and run them for real */
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
const need = [
  /const LG_GLASS_DEFAULT_BASE = .*?;/,
  /const LG_MEASURE_EXCLUDE = .*?;/,
  /const LG_MEASURE_PROCS = \[[\s\S]*?\];/,
  /function lgParseGlassName[\s\S]*?\n}/,
  /function lgMeasureMenu[\s\S]*?\n}/,
  /function lgMeasureSku[\s\S]*?\n}/,
  /function lgMeasureHasChalavi[\s\S]*?\n}/,
  /function lgMeasureProcs[\s\S]*?\n}/,
].map(re => {
  const hit = FB.match(re);
  if (!hit) { console.error('FAIL  could not extract ' + re); process.exit(1); }
  return hit[0];
});
vm.runInContext(need.join('\n'), ctx);
const call = (expr, args) => { ctx.__a = args; return vm.runInContext(expr, ctx); };
const parse = n => call('lgParseGlassName(__a[0])', [n]);

console.log('');

/* ── reading a catalogue name ─────────────────────────────────────────── */
{
  check('a plain pane parses into its four parts',
        parse('8 מ"מ שקוף מחוסם'),
        { mm: 8, type: 'שקוף', chalavi: false, proc: 'chisum' });
  check('cut is a processing like any other',
        parse('8 מ"מ שקוף חתוך').proc, 'cut');
  check('and polished too', parse('8 מ"מ שקוף מלוטש').proc, 'litush');

  /* the factory writes '' where a keyboard would write " */
  check("the factory's doubled apostrophe reads as a quote",
        parse("8 מ''מ קליר מחוסם"), { mm: 8, type: 'קליר', chalavi: false, proc: 'chisum' });

  /* chalavi leaves the type and becomes a flag */
  check('chalavi is lifted out of the name',
        parse("8 מ''מ חלבי מחוסם"), { mm: 8, type: 'שקוף', chalavi: true, proc: 'chisum' });
  check('and a named base keeps its type',
        parse("8 מ''מ קליר חלבי חתוך"), { mm: 8, type: 'קליר', chalavi: true, proc: 'cut' });

  check('a mirror is a type, not a special case',
        parse("5 מ''מ מראה חתוך"), { mm: 5, type: 'מראה', chalavi: false, proc: 'cut' });

  /* what must never reach this form */
  ['8 מ"מ שקוף גרפיקה מחוסם', 'טריפלקס 4+4 חתוך', '6 מ"מ שקוף דלתות נגרים',
   '6 מ"מ שקוף צורתי', '8 מ"מ קליר CNC', '8 מ"מ קליר צבע']
    .forEach(n => check('  refused: ' + n, parse(n), null));

  check('and so is anything that is not a rectangle of glass',
        [parse(''), parse('שכר חיסום'), parse(null)], [null, null, null]);
}

/* ── the menu ─────────────────────────────────────────────────────────── */
/* a slice of the real catalogue, names exactly as the factory writes them */
const CAT = [
  { code: '8SH',   name: "8 מ''מ שקוף חתוך" },
  { code: '8SM',   name: "8 מ''מ שקוף מלוטש" },
  { code: '8SMH',  name: "8 מ''מ שקוף מחוסם" },
  { code: '08HH',  name: "8 מ''מ חלבי חתוך" },      // leading zero — real
  { code: '08HM',  name: "8 מ''מ חלבי מלוטש" },
  { code: '8HMH',  name: "8 מ''מ חלבי מחוסם" },     // and none here
  { code: '6SH',   name: "6 מ''מ שקוף חתוך" },
  { code: '6SM',   name: "6 מ''מ שקוף מלוטש" },
  { code: '6SMH',  name: "6 מ''מ שקוף מחוסם" },
  { code: '5MIRH', name: "5 מ''מ מראה חתוך" },
  { code: '5MIRM', name: "5 מ''מ מראה מלוטש" },
  { code: '8SGMH', name: "8 מ''מ שקוף גרפיקה מחוסם" },
  { code: '8TSH',  name: "טריפלקס 4+4 חתוך" },
  { code: '6SDM',  name: "6 מ''מ שקוף דלתות נגרים" },
  { code: '9XXX',  name: "9 מ''מ שקוף מחוסם", active: false },
];
const menu = all => call('lgMeasureMenu(__a[0], __a[1] ? (c => __a[1].indexOf(c) > -1) : null)',
                         [CAT, all || null]);

{
  const m = menu();
  check('only orderable glass reaches the menu',
        Object.keys(m).sort(), ['מראה', 'שקוף']);
  check('graphic, triplex and carpenter doors are not types',
        ['גרפיקה', 'טריפלקס', 'דלתות נגרים'].filter(t => t in m), []);
  check('an inactive row is not offered', '9' in (m['שקוף'] || {}), false);

  check('a thickness carries its three plain codes',
        m['שקוף'][8].plain, { cut: '8SH', litush: '8SM', chisum: '8SMH' });
  check('and its chalavi codes separately — leading zero and all',
        m['שקוף'][8].chalavi, { cut: '08HH', litush: '08HM', chisum: '8HMH' });

  check('resolving a combination gives a real part number',
        call('lgMeasureSku(__a[0],"שקוף",8,false,"chisum")', [m]), '8SMH');
  check('and the chalavi one is a different part number',
        call('lgMeasureSku(__a[0],"שקוף",8,true,"chisum")', [m]), '8HMH');
  check('a combination that does not exist returns null, not a guess',
        [call('lgMeasureSku(__a[0],"מראה",5,false,"chisum")', [m]),
         call('lgMeasureSku(__a[0],"שקוף",6,true,"cut")', [m]),
         call('lgMeasureSku(__a[0],"ברונזה",8,false,"cut")', [m])],
        [null, null, null]);
}

/* ── the two rules Ben stated ─────────────────────────────────────────── */
{
  const m = menu();
  check('a mirror is offered cut and polished only — you cannot temper one',
        call('lgMeasureProcs(__a[0],"מראה",5,false).map(p=>p.key)', [m]), ['cut', 'litush']);
  check('chalavi is offered where a part number exists',
        call('lgMeasureHasChalavi(__a[0],"שקוף",8)', [m]), true);
  check('and hidden where none does',
        [call('lgMeasureHasChalavi(__a[0],"שקוף",6)', [m]),
         call('lgMeasureHasChalavi(__a[0],"מראה",5)', [m])], [false, false]);
  check('the processings keep one fixed order everywhere',
        call('lgMeasureProcs(__a[0],"שקוף",8,false).map(p=>p.key)', [m]),
        ['cut', 'litush', 'chisum']);
}

/* ── price decides what may be ordered ────────────────────────────────── */
{
  const m = menu(['8SMH', '8SM', '5MIRH']);
  check('only what this customer has a price for is offered',
        m['שקוף'][8].plain, { litush: '8SM', chisum: '8SMH' });
  check('an unpriced combination is absent, not zero-priced',
        call('lgMeasureSku(__a[0],"שקוף",8,false,"cut")', [m]), null);
  check('a thickness with nothing priced drops out entirely',
        8 in (m['שקוף'] || {}) && !(6 in (m['שקוף'] || {})), true);
  check('and chalavi disappears with it',
        call('lgMeasureHasChalavi(__a[0],"שקוף",8)', [m]), false);
}

/* ── the form itself ──────────────────────────────────────────────────── */
{
  check('no glass option is written by hand any more',
        /גלינה שקוף 8מ"מ|<option value='שקוף 8מ"מ'>/.test(FORM), false);
  check('the list is built from the live catalogue',
        /_mfMenu = lgMeasureMenu\(_mfCatalog, _mfHasPrice\)/.test(FORM), true);
  check('the client price list is consulted before the global one',
        /const c = _mfClient\[code\], g = _mfGlobal\[code\]/.test(FORM), true);
  check('and it is read from the branch Firebase lets a client read',
        /prices\/clients\/' \+ cid/.test(FORM), true);

  check('an item without a part number is refused, not sent',
        /const sku = mfCurrentSku\(\);[\s\S]{0,120}if \(!sku\)/.test(FORM), true);
  check('the part number is written onto the saved item',
        /sku:\s+it\.sku,/.test(FORM), true);
  check('the name comes from the catalogue, not built in the screen',
        /_mfName\[sku\]/.test(FORM), true);

  /* the chain: cut is the absence of both flags */
  check('tempered sets chisum', /chisum:\s+it\.proc === 'chisum'/.test(FORM), true);
  check('polished sets litush', /litush:\s+it\.proc === 'litush'/.test(FORM), true);
  check('and cut sets neither — no third flag was invented',
        /(cut|חתוך):\s*(true|it\.proc)/.test(FORM), false);
  check('chalavi rides through as surface work', /chalavi:\s+!!it\.chalavi/.test(FORM), true);

  /* it still goes to the sketch queue — no new privilege, no rule change */
  check('the order is still created by the client, at no stage',
        /stage/.test(FORM.slice(FORM.indexOf('saveSubmission({'),
                                FORM.indexOf('saveSubmission({') + 900)), false);
  // the point is that no privilege was added here: the screen still only
  // writes an order the client is already allowed to write. A comment may
  // name the endpoint; a call to it would be the regression.
  check('and nothing here calls Hashavshevet or moves a stage',
        /\/api\/hashavshevet|updateStage\(/.test(FORM), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll measure-order checks passed.');
