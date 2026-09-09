#!/usr/bin/env node
/**
 * Flip, and the `+` that only appears where the rules allow.
 *
 * Two principles this file guards, because both are easy to lose:
 *
 *   A flip is NOT a new shape and NOT new rules. It is a transform on the
 *   existing definition: everything tied to a side swaps, everything else
 *   stays. Separate right-hand and left-hand entries in the gallery were
 *   two definitions of one thing, free to drift apart.
 *
 *   The `+` asks the rules engine; it does not keep a copy of it. "May I
 *   connect here?" is answered the only way that cannot be faked — build
 *   the candidate arrangement and run lgValidate on it. A UI that decided
 *   for itself would offer connections the order then rejects.
 *
 * Run: node scripts/test-flip-and-add.js
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

function bench() {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var selQ="zamak"; var shapeBoundary={right:"wall",left:"open"};' +
    'let shapeList=[],shapePS={}; let flipped={}; let libFactory=[],libPersonal=[];' +
    'var appMode="shape"; var DOOR_H_MM=1985; var HANDLE_EDGE_CM=6;' +
    'var TOWEL_SPACING_CM=40; let panelState={},items=[]; var curCombo={panels:[]};', ctx);
  ['mkPS', 'getPS', 'getPStates', '_shapePanels', '_lgShowerOf', 'galleryEntries',
   'entryCanFlip', '_tryArrangement', '_arrangementErrors', 'allowedAt',
   'sideBlocked', 'canAddAt'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (ctx, e) => vm.runInContext(e, ctx);

/* asks the engine directly, so the test never trusts the UI's own answer */
const ENGINE_OK =
  'function _ok(a){ var hands = a.kind==="door" ? [a.hingeSide, a.hingeSide==="right"?"left":"right"] : [a.hingeSide];' +
  '  for (var h=0; h<hands.length; h++){' +
  '    var probe={id:"p",kind:a.kind,hingeSide:hands[h],carriesDoor:a.carriesDoor};' +
  '    if (_arrangementErrors(shapeList.concat([probe])).length===0) return true;' +
  '  } return false; }';

console.log('');

/* ── a flip swaps sides and nothing else ────────────────────────────────── */
{
  const ctx = bench();
  const seeds = run(ctx, 'lgCatalogSeeds()');

  seeds.forEach(e => {
    ctx.E = e;
    const f = run(ctx, 'lgFlipEntry(E)');
    /* the kind, the name and the identity survive untouched */
    check(e.name + ': a flip keeps what is not a side',
          [f.add.kind, f.name, f.id, !!f.add.slope, !!f.add.notch],
          [e.add.kind, e.name, e.id, !!e.add.slope, !!e.add.notch]);
  });

  /* and a flipped flip is the original */
  const notInvolutive = seeds.filter(e => {
    ctx.E = e;
    return JSON.stringify(run(ctx, 'lgFlipAdd(lgFlipAdd(E.add))')) !== JSON.stringify(e.add);
  });
  check('flipping twice returns the original, for every shape',
        notInvolutive.map(e => e.id), []);

  /* every side-bearing field really does swap */
  ctx.E = { id: 'x', name: 'x', add: { kind: 'door', hingeSide: 'right',
    notchSide: 'left', slopeSideV: 'right',
    holes: [{ role: 'bracket-floor', dia: 20,
              x: { from: 'left', mm: 25 }, y: { from: 'bottom', mm: 60 } }] } };
  const f = run(ctx, 'lgFlipAdd(E.add)');
  check('every side-bearing field swaps',
        [f.hingeSide, f.notchSide, f.slopeSideV, f.holes[0].x.from],
        ['left', 'right', 'left', 'right']);
  check('and the height is not a side, so it stays',
        f.holes[0].y, { from: 'bottom', mm: 60 });
}

/* ── the gallery holds one entry per shape, not one per hand ────────────── */
{
  const ctx = bench();
  const seeds = run(ctx, 'lgCatalogSeeds()');
  const doors = seeds.filter(e => e.add.kind === 'door');
  check('there is one door in the gallery, not two', doors.length, 1);
  ctx.D = doors[0];
  check('and it can be flipped to the other hand', run(ctx, 'entryCanFlip(D)'), true);

  /* a symmetric shape offers no flip, because it would do nothing */
  ctx.P = seeds.find(e => e.id === 'fixed');
  check('a plain fixed offers no flip button', run(ctx, 'entryCanFlip(P)'), false);
}

/* ── the + follows the rules engine, never its own opinion ──────────────── */
{
  const ctx = bench();
  run(ctx, ENGINE_OK);

  /* an empty canvas: the wall end is blocked, the open end is not */
  check('a wall end shows no +', run(ctx, 'canAddAt("left")'), false);
  check('and the open end does', run(ctx, 'canAddAt("right")'), true);

  run(ctx, 'shapeList=[{id:"a",kind:"fixed"}]');
  check('a fixed against the wall still offers only the open side',
        [run(ctx, 'canAddAt("left")'), run(ctx, 'canAddAt("right")')], [false, true]);

  const offered = run(ctx, 'allowedAt("right").map(function(c){return galleryEntries()[c.i].add.kind;})');
  check('a door may hang on that fixed', offered.indexOf('door') > -1, true);
  check('and a mirror may stand beside it', offered.indexOf('mirror') > -1, true);

  /* the honest checks, in both directions */
  check('nothing offered is rejected by the engine',
        run(ctx, 'allowedAt("right").filter(function(c){return !_ok(galleryEntries()[c.i].add);}).length'), 0);
  check('and nothing the engine accepts is hidden from the gallery',
        run(ctx, 'galleryEntries().filter(function(e,i){ return _ok(e.add) &&' +
                 ' !allowedAt("right").some(function(c){return c.i===i;}); }).length'), 0);
}

/* ── what needs support is refused where there is none ──────────────────── */
/* A door at the end of a run brings its own wall — lgFromPanels says so,
   because a door always hangs on something. A FIXED brings nothing, so at
   an open end with no neighbour it has nothing to lean on and is refused.
   The screen must reach the same conclusion as the drawing, which is why
   both now build the candidate through the same chain. */
{
  const ctx = bench();
  run(ctx, 'shapeBoundary={right:"open",left:"open"}; shapeList=[]');
  const offered = run(ctx, 'allowedAt("right").map(function(c){return galleryEntries()[c.i].add.kind;})');
  check('a fixed with nothing to lean on is refused', offered.indexOf('fixed') > -1, false);
  check('free glass needs nothing and is offered', offered.indexOf('mirror') > -1, true);
  check('and a door is offered, because a door at an end brings its own wall',
        offered.indexOf('door') > -1, true);
}

/* ── the UI holds no copy of the rules ──────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the + asks lgValidate for its answer',
        has('return lgValidate(_lgShowerOf(_shapePanels(list),pss));'), true);
  check('through the same chain the drawing uses',
        has('_arrangementErrors') && has('_shapePanels(list)'), true);
  check('and the gallery filter is that same answer', has('addSide ? allowedAt(addSide)'), true);
  check('the blocked end is read from the boundary the engine uses',
        has("shapeBoundary[side==='left'?'right':'left']==='wall'"), true);

  /* the removed UI really is gone */
  check('build direction is gone', /buildDir|setBuildDir|renderBuildDir/.test(DEMO), false);
  check('the wall-end buttons are gone', /shapeSetEnd/.test(DEMO), false);
  check('and the move arrows with them', /shapeMove/.test(DEMO), false);
  check('but the boundary itself remains, because the engine needs it',
        has('let shapeBoundary='), true);

  /* the picking bar */
  check('advanced edit enters a picking mode', has('function setPickMode('), true);
  check('with arrows either way', has('pickStep(-1)') && has('pickStep(1)'), true);
  check('the chosen pane is highlighted on the drawing', has('function paintPick('), true);
  check('and Edit opens the sheet that already existed', has('openShapeSheet('), true);
  check('the sheet now serves both tabs', has('function _sheetIdx()'), true);
  check('every control in the bar is a 44px target',
        /\.pick-bar>button\{[^}]*min-height:44px/.test(DEMO), true);
  check('and the + itself is 44px', /\.add-btn\{[^}]*width:44px;height:44px/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll flip and add checks passed.');
