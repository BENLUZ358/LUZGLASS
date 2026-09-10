#!/usr/bin/env node
/**
 * Glass is chosen as thickness AND type, and the part number follows.
 *
 * The list of types is not written anywhere. It is DERIVED from
 * LG_SKU_MAP, the single source of part numbers the whole system already
 * uses — so the screen cannot offer a combination the factory has no item
 * for, and cannot forget one it does.
 *
 * Two filters, and both are factory rules rather than choices of code:
 *
 *   EVERY SHOWER IS TEMPERED. Only "מחוסם" items count. The polished item
 *   is the same glass at a different stage, not a different type — which
 *   is exactly why several part numbers can share one type.
 *
 *   GRAPHICS ARE A PROCESS, NOT A TYPE. "שקוף גרפיקה" is plain שקוף that
 *   still owes a trip to the sandblaster, so it is not a separate choice
 *   here. Mirrors are not showers.
 *
 * Run: node scripts/test-glass-choice.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* the shipped implementation, extracted rather than copied */
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
[/const LG_SKU_MAP = \{[\s\S]*?\n\};/,
 /function lgGlassOptions\(\)[\s\S]*?\n\}/,
 /function lgGlassSku\([\s\S]*?\n\}/].forEach(r => {
  const m = DB.match(r);
  if (!m) { console.error('FAIL  could not extract ' + r); process.exit(1); }
  vm.runInContext(m[0], ctx);
});
const run = e => vm.runInContext(e, ctx);
const OPTS = run('lgGlassOptions()');
const MAP = run('LG_SKU_MAP');

console.log('');

/* ── the options come from the part numbers, not from a second list ─────── */
{
  check('there are thicknesses to choose from', Object.keys(OPTS).length > 0, true);

  /* every option points at an item that really exists */
  const missing = [];
  Object.keys(OPTS).forEach(mm => OPTS[mm].forEach(o => {
    if (!MAP[o.sku]) missing.push(o.sku);
  }));
  check('every option names a real item', missing, []);

  /* and every tempered shower item is offered — nothing is forgotten */
  const forgotten = Object.keys(MAP).filter(sku => {
    const n = MAP[sku];
    return /מחוסם/.test(n) && !/גרפיקה|מראה/.test(n) && /^\d+ מ"מ /.test(n)
      && !Object.keys(OPTS).some(mm => OPTS[mm].some(o => o.sku === sku));
  });
  check('and no tempered shower item is left out', forgotten, []);
}

/* ── what the two filters keep out ──────────────────────────────────────── */
{
  const all = [].concat.apply([], Object.keys(OPTS).map(mm => OPTS[mm]));
  check('nothing polished is offered — every shower is tempered',
        all.filter(o => /מלוטש/.test(o.name)).map(o => o.sku), []);
  check('graphics are a process, so they are not a type here',
        all.filter(o => /גרפיקה/.test(o.name)).map(o => o.sku), []);
  check('and mirrors are not showers',
        all.filter(o => /מראה/.test(o.name)).map(o => o.sku), []);

  /* the same type at several stages is still ONE type */
  check('שקוף appears once per thickness, not once per stage',
        (OPTS[8] || []).filter(o => o.type === 'שקוף').length, 1);
}

/* ── the example from the brief ─────────────────────────────────────────── */
{
  check('8mm granite is a real choice',
        (OPTS[8] || []).some(o => o.type === 'גרניט'), true);
  check('and its part number is the one the factory uses',
        run('lgGlassSku(8,"גרניט")'), '8GMH');
  check('which reads back as the item name',
        MAP[run('lgGlassSku(8,"גרניט")')], '8 מ"מ גרניט מחוסם');

  /* a combination the factory does not stock has no number invented for it */
  check('12mm granite does not exist, and nothing is invented',
        run('lgGlassSku(12,"גרניט")'), null);
  check('nor is it offered at that thickness',
        (OPTS[12] || []).some(o => o.type === 'גרניט'), false);
}

/* ── each thickness opens its own types ─────────────────────────────────── */
{
  const at = mm => (OPTS[mm] || []).map(o => o.type).sort();
  check('8mm and 12mm do not offer the same list',
        JSON.stringify(at(8)) === JSON.stringify(at(12)), false);
  check('12mm is the short list it really is', at(12), ['קליר', 'שקוף']);
  check('while 8mm carries the most', at(8).length > at(12).length, true);
}

/* ── the choice reaches the order line, and the part number with it ─────── */
{
  ctx.P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
           { type: 'door', wallSide: 'none', hingeSide: 'right',
             handleSide: 'left', hingeOnFixed: 'prev' }];
  ctx.S = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } };

  [[8, 'גרניט', '8GMH'], [10, 'אסיד קליר', '10ACMH'], [6, 'אפור', '6GRMH']].forEach(
    ([mm, type, sku]) => {
      ctx.MM = mm; ctx.T = type;
      ctx.SH = run('lgFromPanels(P,S,{finish:"shahor",quality:"zamak",' +
                   'thickness:MM,glassType:T})');
      const line = run('lgOrderLines(SH)').filter(l => l.key.kind === 'glass')[0];
      check(`${mm}mm ${type} reaches the order line`,
            [line.key.thickness, line.key.glassType], [mm, type]);
      check('  and resolves to its part number', run('lgGlassSku(MM,T)'), sku);
      check('  with an area to price', line.qty > 0, true);
    });
}

/* ── a pane may still override the shower ───────────────────────────────── */
{
  ctx.S = { 0: { w: 500, h: 2000, thickness: 10 }, 1: { w: 800, h: 1985 } };
  ctx.MM = 8; ctx.T = 'שקוף';
  ctx.SH = run('lgFromPanels(P,S,{finish:"shahor",quality:"zamak",' +
               'thickness:MM,glassType:T})');
  const lines = run('lgOrderLines(SH)').filter(l => l.key.kind === 'glass');
  check('a pane given its own thickness is grouped apart', lines.length, 2);
  check('and the two thicknesses are the ones asked for',
        lines.map(l => l.key.thickness).sort((a, b) => a - b), [8, 10]);
}

/* ── the screen asks; it does not keep its own list ─────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the thickness row is built from the options',
        has('lgGlassOptions()') , true);
  check('the types shown are the ones for the chosen thickness',
        has('const types=(opts[selMM]||[]);'), true);
  check('the part number is looked up, never composed',
        has('lgGlassSku(selMM,selG)'), true);
  check('and the choice travels on the shower', has('glassType: selG,'), true);

  /* the old flat list may still supply colours and prices, but must not
     decide WHICH types exist */
  check('the swatch list no longer decides what is available',
        /const types=GL\b/.test(DEMO), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll glass-choice checks passed.');
