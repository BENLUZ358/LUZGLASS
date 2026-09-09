#!/usr/bin/env node
/**
 * "Brackets only" means no door may hang here.
 *
 * The gallery offers two fixed panes: one with brackets alone, one
 * prepared to carry a door. Picking the first is a statement — there is no
 * hinge preparation in that glass — and the system must honour it instead
 * of quietly hinging a door onto it anyway.
 *
 * Two things this file holds down:
 *
 *   The rule lives in the engine, not in the gallery. A UI that decided
 *   this for itself would let an order through that the factory cannot
 *   build.
 *
 *   `undefined` is not `false`. Combinations, item mode, and every sketch
 *   saved before today declare nothing, and they must keep behaving
 *   exactly as they always did. Only a pane that explicitly says "no
 *   hinges" gets the refusal.
 *
 * Run: node scripts/test-carries-door.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const grab = n => {
  const i = DEMO.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
};

function screen(boundary) {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var selQ="zamak"; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'let shapeBoundary=' + JSON.stringify(boundary || { right: 'wall', left: 'open' }) + ';' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null;' +
    'function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', '_shapePanels', '_lgShowerOf', 'galleryEntries', 'entryCanFlip', 'galleryShown',
   '_tryArrangement', 'allowedAt', 'sideBlocked', 'canAddAt', 'hingeHolesFromEngine',
   'shapeAdd', 'shapeAddFromCatalog'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (c, e) => vm.runInContext(e, c);
const idOf = (c, n) => run(c, 'galleryEntries().findIndex(function(e){return e.name===' + JSON.stringify(n) + ';})');
const SHOWER = '_lgShowerOf(_shapePanels(),Object.fromEntries(' +
  'shapeList.map(function(s,i){return [i,shapePS[s.id]];})))';
const PLAIN = 'קבוע · זוויות בלבד', CARRIER = 'קבוע נושא דלת';

console.log('');

/* ── the engine refuses it, and says why ────────────────────────────────── */
{
  const ctx = screen();
  ctx.S = { boundary: { right: 'wall', left: 'open' }, finish: 'shahor', quality: 'zamak',
    shapes: [{ id: 'f', kind: 'fixed', carriesDoor: false },
             { id: 'd', kind: 'door', hingeSide: 'right' }] };
  const errs = run(ctx, 'lgValidate(S)');
  check('a door hung on a brackets-only fixed is refused', errs.length, 1);
  check('and the message says what is wrong',
        errs[0].msg.indexOf('זוויות בלבד') > -1, true);
  check('the joint produces no hardware either',
        run(ctx, 'lgJunctions(S).map(function(j){return j.type;})'),
        ['bracket-wall', null, null]);
}

/* ── undefined is not false: nothing that existed before changes ────────── */
{
  const ctx = screen();
  ctx.S = { boundary: { right: 'wall', left: 'open' }, finish: 'shahor', quality: 'zamak',
    shapes: [{ id: 'f', kind: 'fixed' }, { id: 'd', kind: 'door', hingeSide: 'right' }] };
  check('a fixed that declares nothing still carries a door', run(ctx, 'lgValidate(S)'), []);
  check('and the joint is still a glass-to-glass hinge',
        run(ctx, 'lgJunctions(S).map(function(j){return j.type;})'),
        ['bracket-wall', 'hinge-gg', null]);

  /* and one that says yes, of course */
  ctx.T = { boundary: { right: 'wall', left: 'open' }, finish: 'shahor', quality: 'zamak',
    shapes: [{ id: 'f', kind: 'fixed', carriesDoor: true },
             { id: 'd', kind: 'door', hingeSide: 'right' }] };
  check('a fixed prepared for a door carries one', run(ctx, 'lgValidate(T)'), []);
}

/* ── everything else about a brackets-only fixed is unchanged ───────────── */
{
  const ctx = screen();
  const wall = k => ({ boundary: { right: 'wall', left: 'wall' }, finish: 'shahor',
    quality: 'zamak', shapes: [{ id: 'f', kind: 'fixed', carriesDoor: k }] });
  ctx.A = wall(false); ctx.B = wall(undefined);
  check('it takes its wall brackets exactly as before',
        run(ctx, 'lgJunctions(A).map(function(j){return j.type;})'),
        run(ctx, 'lgJunctions(B).map(function(j){return j.type;})'));

  const two = k => ({ boundary: { right: 'wall', left: 'open' }, finish: 'shahor',
    quality: 'zamak', shapes: [{ id: 'a', kind: 'fixed', carriesDoor: k },
                               { id: 'b', kind: 'fixed', carriesDoor: k }] });
  ctx.C = two(false); ctx.D = two(undefined);
  check('and leans on another fixed exactly as before',
        run(ctx, 'lgJunctions(C).map(function(j){return j.type;})'),
        run(ctx, 'lgJunctions(D).map(function(j){return j.type;})'));
  check('with no complaint from validation', run(ctx, 'lgValidate(C)'), []);
}

/* ── the gallery stops offering a door where it cannot hang ─────────────── */
{
  const ctx = screen({ right: 'wall', left: 'open' });
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ')');
  const offered = run(ctx, 'allowedAt("right").map(function(x){return galleryEntries()[x.i].add.kind;})');
  check('no door is offered beside a brackets-only fixed with an open far end',
        offered.indexOf('door') > -1, false);
  check('but the other panes still are', offered.indexOf('fixed') > -1, true);

  const c2 = screen({ right: 'wall', left: 'open' });
  run(c2, 'shapeAddFromCatalog(' + idOf(c2, CARRIER) + ')');
  check('while a fixed prepared for a door does offer one',
        run(c2, 'allowedAt("right").map(function(x){return galleryEntries()[x.i].add.kind;})')
          .indexOf('door') > -1, true);
}

/* ── with a wall behind it, the door sits beside and hinges away ────────── */
/* This is the case the rule is for: the door is not forbidden, it simply
   hangs on the other side. The hand is chosen by the engine, not the card. */
{
  const ctx = screen({ right: 'wall', left: 'wall' });
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ')');
  const offer = run(ctx, 'allowedAt("right").filter(function(x){' +
    'return galleryEntries()[x.i].add.kind==="door";})');
  check('a door is offered when it has a wall of its own', offer.length, 1);

  run(ctx, 'addSide="right"; shapeAddFromCatalog(' + idOf(ctx, 'דלת') + '); addSide=null;');
  check('and it lands beside the fixed', run(ctx, 'shapeList.length'), 2);
  check('with no complaint', run(ctx, 'lgValidate(' + SHOWER + ')'), []);
  check('hinged to the wall, not to the fixed',
        run(ctx, 'lgJunctions(' + SHOWER + ').map(function(j){return j.type;})'),
        ['bracket-wall', null, 'hinge-wall']);

  /* the card said one hand; the engine chose the other, and the engine won */
  const card = run(ctx, 'lgCatalogSeeds().find(function(e){return e.add.kind==="door";}).add.hingeSide');
  check('the hand on the card was overruled by the rules',
        run(ctx, 'shapeList[1].hingeSide') !== card, true);
}

/* ── the declaration really travels from the card to the engine ─────────── */
{
  const ctx = screen();
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ')');
  check('the pane on the canvas carries the declaration',
        run(ctx, 'shapeList[0].carriesDoor'), false);
  check('and it reaches the shower the engine is given',
        run(ctx, SHOWER + '.shapes[0].carriesDoor'), false);

  const c2 = screen();
  run(c2, 'shapeAddFromCatalog(' + idOf(c2, CARRIER) + ')');
  check('and the carrier declares the opposite',
        run(c2, SHOWER + '.shapes[0].carriesDoor'), true);
}

/* ── a contradiction in the catalogue is refused ────────────────────────── */
{
  const ctx = screen();
  ctx.E = { id: 'x', name: 'x', add: { kind: 'fixed', carriesDoor: false, hingesFor: 'right' } };
  check('a shape cannot both refuse doors and carry hinges',
        run(ctx, 'lgCatalogValidate(E)').length > 0, true);
  ctx.F = { id: 'x', name: 'x', add: { kind: 'fixed', carriesDoor: 'maybe' } };
  check('and the declaration must be yes or no', run(ctx, 'lgCatalogValidate(F)').length > 0, true);
}

/* ── a flip does not change what it declares ────────────────────────────── */
{
  const ctx = screen();
  const seeds = run(ctx, 'lgCatalogSeeds()');
  seeds.forEach(e => {
    ctx.E = e;
    check(e.name + ': flipping leaves the declaration alone',
          run(ctx, 'lgFlipAdd(E.add).carriesDoor'), e.add.carriesDoor);
  });
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll carries-door checks passed.');
