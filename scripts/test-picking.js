#!/usr/bin/env node
/**
 * Tests the picking lists — the hardware from lgBOM and the glass from
 * lgGlass.
 *
 * A drawing that is right and a picking list that is wrong is worse than
 * both being wrong: the sketch says one thing, the warehouse sends another,
 * and nobody finds out until the fitter is on site.
 *
 * The two must come from ONE engine. lgBOM already reads lgJunctions rather
 * than counting joints itself; lgGlass reads lgOutline rather than measuring
 * shapes itself. These tests hold both to that.
 *
 * Run: node scripts/test-picking.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgBOM, lgGlass, lgGlassTotals, lgJunctions, lgLayout } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, e) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, e || {});
const door = (id, hs, h, e) => Object.assign({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hs || 'right' }, e || {});
const qty = (bom, type) => bom.filter(l => l.type === type).reduce((n, l) => n + l.qty, 0);

console.log('');

/* ── glass: one line per pane, measured as it is cut ────────────────────── */
{
  const g = lgGlass(shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' }));
  check('one line per pane', g.length, 2);
  check('the fixed panel is 500 × 2000', [g[0].cutW, g[0].cutH], [500, 2000]);
  check('and that is one square metre', g[0].m2, 1);
  check('the door is 800 × 1985', [g[1].cutW, g[1].cutH], [800, 1985]);
  check('a plain pane wastes nothing', [g[0].wasteM2, g[1].wasteM2], [0, 0]);
  check('and both are described as rectangles', g.map(x => x.shape), ['מלבן', 'מלבן']);
}

/* ── the area is the bounding box, on every shape ───────────────────────── */
/* The glass is cut from a rectangular sheet and whatever comes off it goes
   in the bin, so the charge follows the largest height and the largest
   width. The net area is shown beside it, and the gap between them is the
   waste — but the number that is billed is the rectangle. */
{
  const sl = lgGlass(shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1500 }),
                             door('b', 'right')], { right: 'wall', left: 'open' }))[0];
  check('a sloped pane is charged by its largest height', sl.cutH, 2000);
  check('so the area is the full rectangle', sl.m2, 1);
  check('while the net area is smaller', sl.netM2 < sl.m2, true);
  check('and the difference is named as waste', sl.wasteM2, Math.round((1 - sl.netM2) * 100) / 100);
  check('the shape is called what it is', sl.shape, 'משופע בגובה');

  const nt = lgGlass(shower([fixed('a', 2000, { notchW: 200, notchH: 500 })]))[0];
  check('a notched pane is charged by its largest width and height',
        [nt.cutW, nt.cutH, nt.m2], [500, 2000, 1]);
  check('its net area is the rectangle minus the notch',
        nt.netM2, Math.round((1 - 0.2 * 0.5) * 100) / 100);
  check('and it is named a step notch', nt.shape, 'פינוי מדרגה');

  const both = lgGlass(shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1950, slopeW1: 500, slopeW2: 455 }),
                               door('b', 'right')], { right: 'wall', left: 'open' }))[0];
  check('sloped both ways is still charged by the bounding rectangle',
        [both.cutW, both.cutH], [500, 2000]);
  check('and named for both slopes', both.shape, 'משופע בגובה וברוחב');
}

/* ── holes: a hinge drills BOTH panes ───────────────────────────────────── */
/* The hardware list counts a hinge once, because one hinge is bought. The
   glass list counts it twice, because two holes are drilled. Counting it
   once in both places is how a pane arrives undrilled. */
{
  const s = shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' });
  const g = lgGlass(s), bom = lgBOM(s);
  check('the hardware list buys one set of hinges', qty(bom, 'hinge-gg'), 2);
  check('but both panes are drilled for them',
        [g[0].holes > 0, g[1].holes > 0], [true, true]);

  /* each pane counts the holes at its own joints, plus one for the handle if
     it is a door. The fixed panel here meets a wall AND the hinge, so it has
     more holes than the door — which meets only the hinge. */
  const js2 = lgJunctions(s);
  const atJoints = i => [js2[i], js2[i + 1]].reduce((n, j) => n + (j && j.type ? j.qty : 0), 0);
  check('the fixed pane is drilled for its wall brackets and the hinge',
        g[0].holes, atJoints(0));
  check('and the door for the hinge plus its handle',
        g[1].holes, atJoints(1) + 1);
}

/* ── hardware: read off the junctions, never recounted ──────────────────── */
{
  const s = shower([fixed('a'), door('b', 'right'), fixed('c')]);
  const bom = lgBOM(s), js = lgJunctions(s);
  const wanted = {};
  js.forEach(j => { if (j.type) wanted[j.type] = (wanted[j.type] || 0) + j.qty; });
  check('every junction type appears in the list',
        Object.keys(wanted).every(t => qty(bom, t) === wanted[t]), true);
  check('one handle per door', qty(bom, 'handle'), 1);
  check('and nothing is invented that has no junction',
        bom.filter(l => l.type !== 'handle' && l.type !== 'bracket-floor')
           .every(l => wanted[l.type] != null), true);
}

/* ── the floor bracket is a choice, not a consequence ───────────────────── */
{
  check('no floor bracket unless asked for',
        qty(lgBOM(shower([fixed('a')])), 'bracket-floor'), 0);
  check('one per pane that asks',
        qty(lgBOM(shower([fixed('a', 2000, { floorBracket: true }),
                          fixed('b', 2000, { floorBracket: true })])), 'bracket-floor'), 2);
  check('and it has nothing to do with the notch',
        qty(lgBOM(shower([fixed('a', 2000, { notchW: 200, notchH: 500 })])), 'bracket-floor'), 0);
}

/* ── the two lists must describe the same shower ────────────────────────── */
/* This is the check that matters: the drawing, the glass and the hardware
   all come from one engine, so a pane in the drawing has a line in the glass
   list, and a symbol on the drawing has a part in the hardware list. */
{
  const s = shower([fixed('a', 2000, { notchW: 200, notchH: 500 }),
                    door('b', 'right'), fixed('c')], { right: 'wall', left: 'wall' });
  const L = lgLayout(s, { canvasW: 900 }), g = lgGlass(s), bom = lgBOM(s);

  check('a pane in the drawing is a line in the glass list',
        g.length, L.shapes.length);
  check('and they agree on the cut sizes',
        g.every((x, i) => x.cutW === L.shapes[i].mmW && x.cutH === L.shapes[i].mmH), true);
  check('the shape of each pane matches what the drawing drew',
        g.map(x => x.notched), L.shapes.map(x => !!x.notch));

  const symbols = L.hardware.filter(h => h.kind === 'bracket' || h.kind === 'hinge').length;
  const parts = bom.filter(l => /bracket|hinge/.test(l.type) && l.type !== 'bracket-floor')
                   .reduce((n, l) => n + l.qty, 0);
  check('every hardware symbol on the drawing has a part in the list',
        symbols, parts);
  check('and every door drawn with a hole has a handle in the list',
        L.hardware.filter(h => h.kind === 'hole').length, qty(bom, 'handle'));
}

/* ── thickness and weight ───────────────────────────────────────────────── */
/* The customer picks the thickness while drawing. Weight follows from it,
   and weight is what decides how many people it takes to lift a pane. */
{
  const s = shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' });
  s.thickness = 8;
  const g = lgGlass(s), t = lgGlassTotals(s);
  check('the thickness reaches every pane', g.map(x => x.thickness), [8, 8]);
  check('and one square metre of 8mm weighs 20kg', g[0].kg, 20);
  check('the totals carry the weight', t.kg, Math.round((g[0].kg + g[1].kg) * 100) / 100);
  check('and name the heaviest single pane', t.heaviest, Math.max(g[0].kg, g[1].kg));

  /* a single pane can override — a door in 10mm beside 8mm fixed panels */
  const mixed = shower([fixed('a'), door('b', 'right', 1985, { thickness: 10 })],
                       { right: 'wall', left: 'open' });
  mixed.thickness = 8;
  check('a pane may be thicker than the rest',
        lgGlass(mixed).map(x => x.thickness), [8, 10]);

  check('and with no thickness chosen, nothing is invented',
        lgGlass(shower([fixed('a')]))[0].thickness, null);
}

/* ── totals, for the order sheet ────────────────────────────────────────── */
{
  const t = lgGlassTotals(shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' }));
  check('the totals count the panes', t.panes, 2);
  check('and add up the area', t.m2, Math.round((1 + 0.8 * 1.985) * 100) / 100);
  check('and the holes to drill', t.holes > 0, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll picking checks passed.');
