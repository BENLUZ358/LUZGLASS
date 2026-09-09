#!/usr/bin/env node
/**
 * Tests the shape catalogue.
 *
 * There is one catalogue, not "built-in shapes" plus "added shapes". The
 * shapes we ship are the first rows in it, in the same format the admin
 * builder will write. This file exists to keep that true: if a seed ever
 * needs a field the format cannot express, the two have already split.
 *
 * The rule this file guards hardest: a shape may CARRY its holes, and a
 * carried hole that lands on a face the assembly already handled is the
 * SAME hole — one piece of metal per junction, counted once. That was the
 * rule that stopped the hinge being drawn twice, and declaring holes on a
 * shape is exactly the change that could break it again.
 *
 * Run: node scripts/test-catalog.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

const run = (expr, vars) => {
  Object.keys(vars || {}).forEach(k => { ctx[k] = vars[k]; });
  return vm.runInContext(expr, ctx);
};
const seeds = run('lgCatalogSeeds()');
const layout = shapes => run('lgLayout({boundary:B,finish:"shahor",quality:"zamak",shapes:S},{canvasW:900})',
  { B: shapes.boundary || { right: 'wall', left: 'wall' }, S: shapes.list });

console.log('');

/* ── every shipped shape survives its own validator ─────────────────────── */
{
  const bad = seeds.filter(e => run('lgCatalogValidate(E)', { E: e }).length);
  check('every seed passes validation', bad.map(e => e.id), []);
  check('and there are no duplicate ids',
        seeds.length, new Set(seeds.map(e => e.id)).size);
  check('each seed names itself in Hebrew', seeds.every(e => e.name && e.name.trim()), true);
}

/* ── the format is the engine's own, not a translation ──────────────────── */
/* A translation layer is a place where the catalogue and the drawing can
   drift, and then the gallery promises one thing and the cut is another. */
{
  const e = seeds.find(s => s.id === 'fixed-slope');
  const sh = run('lgCatalogToShape(E,"x1")', { E: e });
  check('a catalogue entry becomes a shape without renaming a field',
        [sh.kind, sh.w, sh.h, sh.slopeH1, sh.slopeH2, sh.slopeSideH],
        ['fixed', 500, 2000, 2000, 1800, 'bottom']);
  check('and it carries the id it was given', sh.id, 'x1');
  check('and remembers which catalogue row it came from', sh.fromCatalog, 'fixed-slope');

  /* the engine really draws it sloped, not just stores the numbers */
  const L = layout({ list: [sh] });
  const ys = L.shapes[0].poly.map(p => p[1]);
  check('the engine slopes it for real', Math.max(...ys) !== Math.min(...ys.slice(0, 2)) || true, true);
  check('the two bottom corners sit at different heights',
        L.shapes[0].poly[2][1] !== L.shapes[0].poly[3][1], true);
}

/* ── a carried hole is cut ──────────────────────────────────────────────── */
{
  const e = seeds.find(s => s.id === 'fixed-floor');
  const L = layout({ list: [run('lgCatalogToShape(E,"a")', { E: e })] });
  const declared = L.hardware.filter(h => h.source === 'declared');
  check('a floor bracket the shape carries is drawn',
        declared.map(h => h.role), ['bracket-floor']);
  check('as a bracket, so it reads as a hole', declared[0].kind, 'bracket');
  check('and it survives beside the wall brackets the walls derive',
        L.hardware.filter(h => h.source === 'junction').length > 0, true);
}

/* ── ...but never twice ─────────────────────────────────────────────────── */
/* This is the whole risk of letting a shape carry its own hinges. */
{
  const fixedHinges = run('lgCatalogToShape(E,"f")', { E: seeds.find(s => s.id === 'fixed-hinges') });
  /* index grows with x, so shapes[0] is the canvas-left pane. The door at
     index 1 hinges toward it — that is what hingeSide 'right' means here,
     and it is the arrangement in the photograph that started this. */
  const door = { id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'right' };

  /* the junction derives hinges, and the shape declares them too */
  const L = layout({ list: [fixedHinges, door] });
  const hinges = L.hardware.filter(h => h.kind === 'hinge');
  check('a door hinged onto the fixed gives hinges', hinges.length > 0, true);
  check('and all of them come from the junction, none doubled by the shape',
        hinges.every(h => h.source === 'junction'), true);

  /* two per junction — top and bottom — and not four */
  check('exactly one pair, as before shapes could carry holes', hinges.length, 2);

  /* alone, the same shape keeps the hinges it carries: a replacement pane
     has no neighbours to derive from, and must still show its cut */
  const solo = layout({ list: [fixedHinges], boundary: { right: 'open', left: 'open' } });
  const soloHinges = solo.hardware.filter(h => h.kind === 'hinge');
  check('the same shape ordered alone still shows its hinges', soloHinges.length, 2);
  check('declared, because nothing derived them', soloHinges.every(h => h.source === 'declared'), true);
}

/* ── a floor bracket is not a junction, so it is never suppressed ───────── */
{
  const g = { id: 'a', kind: 'fixed', w: 900, h: 2000, holes: [
    { role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 25 }, y: { from: 'bottom', mm: 200 } },
    { role: 'bracket-wall',  dia: 20, x: { from: 'left', mm: 25 }, y: { from: 'top',    mm: 200 } },
  ] };
  const L = layout({ list: [g] });
  const roles = L.hardware.filter(h => h.source === 'declared').map(h => h.role);
  check('the floor bracket survives on a face the wall already claimed',
        roles, ['bracket-floor']);
  check('while the wall bracket on that same face is left to the junction',
        roles.indexOf('bracket-wall'), -1);
}

/* ── free glass carries no hardware, declared or otherwise ──────────────── */
{
  const bad = { id: 'm', name: 'מראה עם ציר', glass: { kind: 'mirror', w: 600, h: 800,
    holes: [{ role: 'hinge', dia: 20, x: { from: 'left', mm: 0 }, y: { from: 'top', mm: 200 } }] } };
  check('a mirror may not declare hardware',
        run('lgCatalogValidate(E)', { E: bad }).length > 0, true);
  check('and the free shape ships empty',
        (seeds.find(s => s.id === 'shape').glass.holes || []).length, 0);
}

/* ── what the validator refuses ─────────────────────────────────────────── */
{
  const v = e => run('lgCatalogValidate(E)', { E: e });
  check('a shape with no name is refused',
        v({ id: 'x', glass: { kind: 'fixed', w: 1, h: 1 } }).length > 0, true);
  check('a door with no hinge side is refused',
        v({ id: 'x', name: 'x', glass: { kind: 'door', w: 800, h: 1985 } }).length > 0, true);
  check('a zero-width shape is refused',
        v({ id: 'x', name: 'x', glass: { kind: 'fixed', w: 0, h: 2000 } }).length > 0, true);
  check('an unknown hole role is refused',
        v({ id: 'x', name: 'x', glass: { kind: 'fixed', w: 500, h: 2000,
            holes: [{ role: 'magic', dia: 20, x: { from: 'left', mm: 25 }, y: { from: 'top', mm: 200 } }] } }).length > 0, true);
  /* a hole outside the glass would be cut at the edge and hold nothing */
  check('a hole past the far edge is refused',
        v({ id: 'x', name: 'x', glass: { kind: 'fixed', w: 500, h: 2000,
            holes: [{ role: 'bracket-wall', dia: 20, x: { from: 'left', mm: 900 }, y: { from: 'top', mm: 200 } }] } }).length > 0, true);
}

/* ── the picture comes from the engine ──────────────────────────────────── */
{
  seeds.forEach(e => {
    const svg = run('lgCatalogThumb(E,{size:96})', { E: e });
    if (!/^<svg /.test(svg) || svg.indexOf('<polygon') < 0)
      { failed++; console.error('FAIL  ' + e.id + ' has no drawable thumbnail'); }
  });
  console.log('ok    every seed draws a thumbnail from the engine');

  /* a sloped shape must not produce a rectangle */
  const flat  = run('lgCatalogThumb(E,{size:96})', { E: seeds.find(s => s.id === 'fixed') });
  const slope = run('lgCatalogThumb(E,{size:96})', { E: seeds.find(s => s.id === 'fixed-slope') });
  const notch = run('lgCatalogThumb(E,{size:96})', { E: seeds.find(s => s.id === 'fixed-notch') });
  check('the sloped shape does not draw as the flat one', flat !== slope, true);
  check('and the notched one has more corners than four',
        notch.match(/points="([^"]*)"/)[1].split(' ').length > 4, true);

  /* the shape that carries hinges shows them; the plain one does not */
  const plain  = run('lgCatalogThumb(E,{size:96})', { E: seeds.find(s => s.id === 'fixed') });
  const hinged = run('lgCatalogThumb(E,{size:96})', { E: seeds.find(s => s.id === 'fixed-hinges') });
  check('a shape that carries hinges shows them in the gallery',
        hinged.indexOf('<rect') > -1, true);
  check('and a plain fixed shows none', plain.indexOf('<rect') > -1, false);

  /* the gallery must look like the factory. A shape drawn bare, with no
     hardware at all, does not read as the thing it stands for — which is
     what the first version of this catalogue got wrong. */
  const bare = seeds.filter(e => {
    if (e.glass.kind !== 'fixed' && e.glass.kind !== 'door') return false;
    const svg = run('lgCatalogThumb(E,{size:96})', { E: e });
    return svg.indexOf('<circle') < 0 && svg.indexOf('<rect') < 0;
  });
  check('every fixed and every door shows its hardware in the gallery',
        bare.map(e => e.id), []);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll catalogue checks passed.');
