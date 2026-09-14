#!/usr/bin/env node
/**
 * What a sketch becomes when it leaves the screen.
 *
 * The rest of the system — the sketch queue, the check station, the work
 * day, and the agent order in Hashavshevet — is built on `order.items[]`.
 * The queue loads it with one line (`sqCurrentItems = o.items`), and
 * Hashavshevet needs exactly three things per item: `sku`, `w`, `h`. So
 * the sketch does not invent a shape; it fills in the one already there.
 *
 * Ben's decisions, 2026-09-14:
 *   · one pane is one item — each has its own measurement
 *   · no quantity: two identical panes are two items, because the factory
 *     cuts two pieces of glass
 *   · the items are LOCKED — the customer's geometry, not the clerk's
 *   · hardware travels as a picking list for the employee, not as order
 *     lines, because it has no part numbers yet
 *   · pricing is by SKU only; the old per-name price list is out
 *
 * And the decision that matters most for later: **the shower itself is
 * stored, not only what was derived from it.** A third hinge, a bracket
 * type, a sliding door — every rule added later can be re-derived from
 * orders saved today. Storing only the output would leave every existing
 * order behind the first time a rule changes, and that is exactly the
 * throwing-away we are trying to avoid.
 *
 * Run: node scripts/test-sketch-order.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

/* the real part-number catalogue, lifted out of firebase-db so the engine
   is tested against the numbers the factory actually orders by */
['const LG_SKU_MAP = \\{[\\s\\S]*?\\n\\};',
 'const LG_GLASS_DEFAULT_BASE = [^;]+;',
 'function _lgWorkRows\\(\\) \\{[\\s\\S]*?\\n\\}',
 'const LG_SHOWER_WORKS = _lgWorkRows\\(\\);',
 'function lgGlassSku\\(mm, type, work\\) \\{[\\s\\S]*?\\n\\}'
].forEach(re => vm.runInContext(DB.match(new RegExp(re))[0], ctx));

/* the resolver the screen will pass in: a combination in, a part number out */
vm.runInContext(
  'function skuOf(k){' +
  '  if(!k.thickness || !k.glassType) return null;' +
  '  var code = lgGlassSku(k.thickness, k.glassType, k.glassWork);' +
  '  return code ? { sku: code, name: LG_SKU_MAP[code] } : null;' +
  '}', ctx);

function order(panels, states, opts) {
  ctx.P = panels; ctx.S = states;
  ctx.O = Object.assign({ finish: 'shahor', quality: 'zamak',
                          thickness: 8, glassType: 'שקוף' }, opts || {});
  ctx.SH = vm.runInContext('lgFromPanels(P,S,O)', ctx);
  return vm.runInContext('lgSketchOrder(SH, skuOf)', ctx);
}
const PAIR = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
              { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' }];
const SIZES = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } };

console.log('');

/* ── one pane, one item ───────────────────────────────────────────────── */
{
  const o = order(PAIR, SIZES);
  check('two panes make two items', o.items.length, 2);
  check('each carries its own measurement',
        o.items.map(i => i.w + '×' + i.h), ['500×2000', '800×1985']);

  /* two identical panes are still two items — the factory cuts two */
  const twin = order(
    [{ type: 'fixed', wallSide: 'right' }, { type: 'fixed', wallSide: 'left' }],
    { 0: { w: 600, h: 2000 }, 1: { w: 600, h: 2000 } });
  check('two identical panes are two items, not one of quantity two',
        twin.items.length, 2);
  check('and neither pretends to be a quantity group',
        twin.items.filter(i => i.quantityGroupId).length, 0);
}

/* ── the three things Hashavshevet needs ──────────────────────────────── */
{
  const o = order(PAIR, SIZES);
  o.items.forEach(i => {
    check(`  ${i.paneId} has a part number`, !!i.sku, true);
    check('  and both measurements', i.w > 0 && i.h > 0, true);
  });
  check('the part number is the real one for 8mm clear tempered',
        o.items[0].sku, '8SMH');
  check('and the name is the catalogue name, not one we composed',
        o.items[0].name, '8 מ"מ שקוף מחוסם');
}

/* ── the route through the factory is read off the part number ────────── */
{
  const o = order(PAIR, SIZES);
  check('a tempered code marks the pane for tempering',
        [o.items[0].chisum, o.items[0].litush], [true, false]);
  check('and it is derived from the code, never assumed',
        /function _lgProcOf/.test(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8')), true);

  const g = order(PAIR, SIZES, { glassWork: 'graphic' });
  check('graphics reach the item, because they change the route',
        [g.items[0].graphic, g.items[0].chalavi], [true, false]);
  check('with the graphics part number', g.items[0].sku, '8SGMH');
}

/* ── a pane with no part number is still an item ──────────────────────── */
/* dropping it would send a shower to the factory with a pane missing, and
   nobody would know. An item with an empty sku is skipped by Hashavshevet
   with a reason on screen — which is the loud failure we want. */
{
  const o = order(PAIR, SIZES, { glassType: 'סוג שלא קיים' });
  check('an unknown type still produces its items', o.items.length, 2);
  check('with no part number rather than a guessed one', o.items[0].sku, null);
  check('and a name that at least says what the glass is',
        o.items[0].name, '8 מ"מ סוג שלא קיים');
}

/* ── the items are locked ─────────────────────────────────────────────── */
{
  const o = order(PAIR, SIZES);
  check('every item is marked locked', o.items.every(i => i.locked), true);
  check('and each points back at the pane it came from',
        o.items.map(i => i.paneId), ['p0', 'p1']);
}

/* ── the hardware rides along as a list, not as order lines ───────────── */
{
  const o = order(PAIR, SIZES, {});
  check('the hardware is its own field', Array.isArray(o.hardware), true);
  check('and it is not mixed into the items',
        o.items.filter(i => /bracket|hinge|handle/.test(i.sku || '')).length, 0);
  check('the wall brackets are there', o.hardware.some(h => h.type === 'bracket-wall'), true);
  check('and the hinge between the fixed and the door',
        o.hardware.some(h => h.type === 'hinge-gg'), true);
  check('with a quantity each', o.hardware.every(h => h.qty > 0), true);
  check('and no part number, because hardware has none yet',
        o.hardware.some(h => 'sku' in h), false);

  const towel = order(PAIR, { 0: { w: 500, h: 2000 },
                              1: { w: 800, h: 1985, handleType: 'towel' } });
  check('the handle variant survives, so the picker knows which one',
        towel.hardware.filter(h => h.type === 'handle')[0].variant, 'towel');
}

/* ── the shower itself is kept ────────────────────────────────────────── */
/* the guarantee against throwing work away later */
{
  const o = order(PAIR, { 0: { w: 500, h: 2000 },
                          1: { w: 800, h: 1985, handleType: 'vertical',
                               hingeBot: 300 } });
  check('the order carries the shower it was built from', !!o.builder.shower, true);
  check('with a version on it, so a later reader knows what it is reading',
        typeof o.builder.version, 'number');
  check('and every pane inside it', o.builder.shower.shapes.length, 2);

  /* the details that the items do NOT carry are still there to re-derive */
  const door = o.builder.shower.shapes[1];
  check('the handle type is kept', door.handleType, 'vertical');
  check('a hinge height someone typed is kept', door.hingeBot, 300);
  check('and the boundary, which decides where the wall brackets go',
        !!o.builder.shower.boundary, true);

  /* the proof: the saved shower alone re-derives the same items */
  ctx.SAVED = o.builder.shower;
  const again = vm.runInContext('lgSketchOrder(SAVED, skuOf)', ctx);
  check('re-deriving from the saved shower gives the same items',
        JSON.stringify(again.items), JSON.stringify(o.items));
  check('and the same hardware',
        JSON.stringify(again.hardware), JSON.stringify(o.hardware));
}

/* ── the engine still knows no part numbers of its own ────────────────── */
{
  const ENG = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');
  check('no part number is written into the engine',
        /['"][0-9]+[A-Z]{1,3}H?['"]/.test(ENG.replace(/\/\/.*$/gm, '')), false);
  check('the caller supplies the resolver, as lgOrderLines already did',
        /function lgSketchItems\(shower, skuOf\)/.test(ENG), true);
  check('and with no resolver it returns items without part numbers',
        (ctx.SH2 = ctx.SH, vm.runInContext('lgSketchItems(SH2)', ctx))
          .every(i => i.sku === null), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-order checks passed.');
