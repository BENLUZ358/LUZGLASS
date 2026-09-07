#!/usr/bin/env node
/**
 * Tests lg-shapes.js — the rules engine behind the shape builder.
 *
 * The rules were always there; they were trapped inside the drawer.
 * drawSinglePanel both decided that a wall-mounted fixed panel takes four
 * brackets and drew them, so a bill of materials could not be derived without
 * writing the same rules a second time — and two copies drift.
 *
 * The counting case is the one that matters. Hardware belongs to the JUNCTION,
 * not to the shape: the hinge between a fixed panel and a door is one piece
 * shared by both, not one for each. Count per shape and every shower comes out
 * as six pieces instead of four, and that number reaches the warehouse.
 *
 * Run: node scripts/test-shapes-engine.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');

/* the engine must be pure — it has to run with no DOM, no window, no firebase */
const ctx = vm.createContext({});
vm.runInContext(SRC, ctx);
const { lgJunctions, lgValidate } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, extra) => Object.assign({ id, kind: 'fixed', w: 700, h: 2000 }, extra || {});
const door  = (id, hingeSide, extra) =>
  Object.assign({ id, kind: 'door', w: 600, h: 2000, hingeSide: hingeSide || 'right' }, extra || {});

const types = s => lgJunctions(s).map(j => j.type);
const counts = s => {
  const out = {};
  lgJunctions(s).forEach(j => { if (j.type) out[j.type] = (out[j.type] || 0) + j.qty; });
  return out;
};

/* ── the five cases the spec names ─────────────────────────────────────── */

/* fixed + door + fixed: four wall brackets, two glass-glass hinges, one
   handle. Counting per shape instead of per junction gives six hinges. */
{
  const s = shower([fixed('s1'), door('s2', 'right'), fixed('s3')]);
  check('fixed + door + fixed — the wall brackets', counts(s)['bracket-wall'], 4);
  check('and the hinges are counted once for the pair, not once per shape',
        counts(s)['hinge-gg'], 2);
  check('the shower is valid', lgValidate(s), []);
}

/* a door cannot hang on another door — but two doors may meet handle to
   handle, which is the existing p_2k2d combination */
{
  /* in the array, 'right' faces index 0. For two doors to meet handle to
     handle each must hinge outward, onto its own fixed panel:
         s1 fixed │ s2 door ⟵hinge │ hinge⟶ s3 door │ s4 fixed
     This is the existing p_2k2d combination. */
  const ok  = shower([fixed('s1'), door('s2', 'right'), door('s3', 'left'), fixed('s4')]);
  const bad = shower([fixed('s1'), door('s2', 'left'), door('s3', 'left')]);
  check('two doors meeting handle to handle are allowed', lgValidate(ok), []);
  check('but a door hinged onto another door is refused', lgValidate(bad).length > 0, true);
  /* s2 hangs from its left onto s3, which is a door — s2 is the one at fault,
     and the message has to name it so the screen can point at it */
  check('and the message names the offending shape', lgValidate(bad)[0].at, 's2');
}

/* a door needs something to hang on */
{
  const s = shower([door('s1', 'right')], { right: 'open', left: 'open' });
  check('a door anchored to nothing is refused', lgValidate(s).length > 0, true);
}

/* the two simple shapes */
{
  /* a lone fixed panel hangs off ONE wall; its other edge is free. That is
     the spec's "קבוע בודד → 2 זוויות קיר". Two walls is wallSide:'both' in
     the old drawer, and that is the four-bracket case. */
  const one = shower([fixed('s1')], { right: 'wall', left: 'open' });
  check('a single fixed panel on one wall takes two brackets',
        counts(one)['bracket-wall'], 2);
  check('and nothing else', Object.keys(counts(one)), ['bracket-wall']);

  const both = shower([fixed('s1')], { right: 'wall', left: 'wall' });
  check('the same panel between two walls takes four',
        counts(both)['bracket-wall'], 4);

  const two = shower([fixed('s1'), fixed('s2')]);
  check('fixed + fixed — four wall brackets', counts(two)['bracket-wall'], 4);
  check('and two glass-to-glass brackets', counts(two)['bracket-gg'], 2);
}

/* ── the junction table, read directly ─────────────────────────────────── */
{
  const s = shower([fixed('s1'), door('s2', 'right')]);
  const js = lgJunctions(s);
  check('every gap between the walls is a junction', js.length, 3);
  check('the far end carries the wall', js[0].between[0], 'wall');

  const lone = shower([door('s1', 'right')]);
  check('a door hinged to a wall takes a wall hinge', types(lone)[0], 'hinge-wall');
  check('and its handle end against a wall carries no hardware', types(lone)[1], null);
}

/* ── the handle is derived, never chosen ───────────────────────────────── */
/* the shape says which side it hangs from; the handle is always the other one,
   so there is no field in which to put a handle on the hinge side */
{
  const s = shower([fixed('s1'), door('s2', 'right')]);
  check('a shape carries no hardware of its own',
        Object.keys(s.shapes[1]).some(k => /^(hinge|bracket|handle)(?!Side)/i.test(k)), false);
}

/* ── an empty shower does not throw ────────────────────────────────────── */
check('no shapes, no junction between two walls', lgJunctions(shower([])).length, 1);
check('and nothing to validate', lgValidate(shower([])), []);
check('a missing shower is survivable', lgJunctions(null), []);

/* ── the bill of materials ─────────────────────────────────────────────── */
/*
 * lgBOM reads lgJunctions. It must never work the junctions out for itself:
 * the moment the picking list and the drawing each compute them separately
 * they drift, and the drift stays invisible until the wrong count reaches the
 * warehouse. Same shape as LG_TRACK in workday.html — one engine, two
 * consumers.
 */
{
  const { lgBOM } = ctx;
  check('lgBOM exists', typeof lgBOM, 'function');

  const s = shower([fixed('s1'), door('s2', 'right'), fixed('s3')]);
  const bom = lgBOM(s);
  const line = t => bom.find(b => b.type === t);

  check('the wall brackets are one line of four', line('bracket-wall').qty, 4);
  check('the hinges are one line of two',         line('hinge-gg').qty, 2);
  check('a handle is derived for the door',       line('handle').qty, 1);
  check('and there is exactly one handle, not one per junction',
        bom.filter(b => b.type === 'handle').length, 1);
  check('nothing is listed twice',
        bom.length, new Set(bom.map(b => b.type + '|' + b.variant)).size);

  /* the architectural decision the spec calls the most important in the
     document: types, never skus */
  check('no line carries a sku',
        bom.some(b => 'sku' in b || 'itemkey' in b), false);
  check('every line carries the finish and quality instead',
        bom.every(b => b.finish === 'shahor' && b.quality === 'zamak'), true);

  /* it agrees with the junctions by construction, not by coincidence */
  check('the picking list cannot contradict the drawing',
        line('bracket-wall').qty, counts(s)['bracket-wall']);

  /* the engine decides the TYPE; the contractor decides HOW MANY */
  const three = shower([fixed('s1', { wallBracketQty: 3 }), door('s2', 'right'), fixed('s3')]);
  check('three brackets on one panel is a choice the engine honours',
        lgBOM(three).find(b => b.type === 'bracket-wall').qty, 5);

  /* a variant changes the line, never the type */
  const open = shower([fixed('s1', { bracketVariant: 'open' }), door('s2', 'right'), fixed('s3')]);
  const ob = lgBOM(open);
  check('an open bracket is a variant of the same type',
        ob.some(b => b.type === 'bracket-wall' && b.variant === 'open'), true);
  check('and the regular ones stay on their own line',
        ob.filter(b => b.type === 'bracket-wall').length, 2);

  /* a floor bracket is an explicit choice, never derived */
  const floor = shower([fixed('s1', { floorBracket: true })], { right: 'wall', left: 'open' });
  check('a floor bracket appears only when asked for',
        lgBOM(floor).find(b => b.type === 'bracket-floor').qty, 1);
  check('and is absent otherwise',
        lgBOM(shower([fixed('s1')])).some(b => b.type === 'bracket-floor'), false);

  /* nothing to pick from nothing */
  check('an empty shower has an empty list', lgBOM(shower([])), []);
  check('and a missing one does not throw', lgBOM(null), []);
}

/* ── purity ────────────────────────────────────────────────────────────── */
/* comments stripped: the header explains what the engine deliberately does
   NOT touch, and a check that reads comments fails on its own explanation */
const CODE = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('the engine names no sku', /skuCatalog|itemkey|hashavshevet/i.test(CODE), false);
check('and touches no document', /document\.|window\.|canvas/i.test(CODE), false);
check('and no firebase', /firebase|_lgDb/i.test(CODE), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll shape-engine checks passed.');
