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
 /const LG_GLASS_DEFAULT_BASE = [^\n]*/,
 /const LG_GLASS_WORK = \{[\s\S]*?\n\};/,
 /function lgGlassOptions\(\)[\s\S]*?\n\}/,
 /function lgGlassSku\([\s\S]*?\n\}/,
 /function lgGlassWorks\([\s\S]*?\n\}/].forEach(r => {
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
    return /מחוסם/.test(n) && !/גרפיקה|חלבי|מראה/.test(n) && /^\d+ מ"מ /.test(n)
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
  /* sandblasting carries an item name of its own, which is exactly why it
     slipped into the type list — it is still a process, not a material */
  check('nor is sandblasting a type, despite having its own item',
        all.filter(o => /חלבי/.test(o.name)).map(o => o.sku), []);
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
        has('lgGlassSku(selMM,selG,selWork)'), true);
  check('and the choice travels on the shower', has('glassType: selG,'), true);

  /* the old flat list may still supply colours and prices, but must not
     decide WHICH types exist */
  check('the swatch list no longer decides what is available',
        /const types=GL\b/.test(DEMO), false);
}

/* ── inside work: graphics and sandblasting ─────────────────────────────── */
/* Neither is a KIND of glass — they are what is DONE to it — but each has
   its own item and its own price, so each pulls a different part number.
   Two different rules, and both come from the item names themselves:
   graphics is ADDED to the type (שקוף → שקוף גרפיקה), while חלבי REPLACES
   it, because it is sandblasting on plain glass. */
{
  const sku = (mm, t, w) => run('lgGlassSku(' + mm + ',' + JSON.stringify(t) + ',' +
                                JSON.stringify(w) + ')');
  const works = (mm, t) => run('lgGlassWorks(' + mm + ',' + JSON.stringify(t) + ')');

  /* the two examples from the brief, exactly */
  check('8mm clear with nothing done to it', sku(8, 'שקוף', ''), '8SMH');
  check('8mm clear sandblasted is its own item', sku(8, 'שקוף', 'chalavi'), '8HMH');
  check('and reads as חלבי, not as שקוף חלבי',
        MAP[sku(8, 'שקוף', 'chalavi')], '8 מ"מ חלבי מחוסם');
  check('8mm clear with graphics', sku(8, 'שקוף', 'graphic'), '8SGMH');
  check('and that one keeps the type in its name',
        MAP[sku(8, 'שקוף', 'graphic')], '8 מ"מ שקוף גרפיקה מחוסם');

  /* every work still lands on a tempered item */
  ['', 'chalavi', 'graphic'].forEach(w => {
    const s = sku(8, 'שקוף', w);
    check(`  ${w || 'plain'} is tempered like everything else`,
          /מחוסם$/.test(MAP[s]), true);
  });

  /* sandblasting is done to PLAIN glass, so it is offered nowhere else.
     Without this it resolved to the clear-glass item from a granite
     choice — one item answering to two different combinations. */
  check('sandblasting is offered on plain glass', works(8, 'שקוף').indexOf('chalavi') > -1, true);
  check('but not on granite', works(8, 'גרניט').indexOf('chalavi') > -1, false);
  check('nor on acid', works(8, 'אסיד').indexOf('chalavi') > -1, false);
  check('and asking for it anyway returns nothing', sku(8, 'גרניט', 'chalavi'), null);

  /* graphics exist only where the factory has the item */
  check('graphics on plain glass', sku(8, 'שקוף', 'graphic'), '8SGMH');
  check('graphics on clear', sku(8, 'קליר', 'graphic'), '8CGMH');
  check('but not on granite', sku(8, 'גרניט', 'graphic'), null);
  check('nor at 12mm, where no graphic item exists', sku(12, 'שקוף', 'graphic'), null);
  check('so it is not offered there either',
        works(12, 'שקוף').indexOf('graphic') > -1, false);

  /* what IS offered always resolves */
  const broken = [];
  Object.keys(OPTS).forEach(mm => OPTS[mm].forEach(o =>
    works(mm, o.type).forEach(w => { if (!sku(mm, o.type, w)) broken.push(mm + ' ' + o.type + ' ' + w); })));
  check('every work offered has an item behind it', broken, []);
}

/* ── the work reaches the order line ────────────────────────────────────── */
{
  ctx.P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
           { type: 'door', wallSide: 'none', hingeSide: 'right',
             handleSide: 'left', hingeOnFixed: 'prev' }];
  ctx.S = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } };
  [['', '8SMH'], ['chalavi', '8HMH'], ['graphic', '8SGMH']].forEach(([w, want]) => {
    ctx.W = w;
    ctx.SH = run('lgFromPanels(P,S,{finish:"shahor",quality:"zamak",' +
                 'thickness:8,glassType:"שקוף",glassWork:W})');
    const line = run('lgOrderLines(SH)').filter(l => l.key.kind === 'glass')[0];
    check(`the ${w || 'plain'} choice reaches the order line`, line.key.glassWork, w || null);
    check('  and pulls its own part number',
          run('lgGlassSku(8,"שקוף",W)'), want);
  });

  /* the same glass with different work is a DIFFERENT item, not the same one */
  const seen = ['', 'chalavi', 'graphic'].map(w => run('lgGlassSku(8,"שקוף",' + JSON.stringify(w) + ')'));
  check('three works give three different part numbers', new Set(seen).size, 3);
}

/* ── the screen offers only what resolves ───────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the work row is built from what has an item',
        has('lgGlassWorks(selMM,selG)'), true);
  check('a work with no item is dropped rather than left selected',
        has("if(works.indexOf(selWork)<0){ selWork=''; sand=false; }"), true);
  check('the part number is looked up with the work',
        has('lgGlassSku(selMM,selG,selWork)'), true);
  check('and the choice travels on the shower', has('glassWork: selWork,'), true);
  check('sandblasting still feeds the old flag, so the summary keeps working',
        has("sand = (selWork==='chalavi');"), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll glass-choice checks passed.');
