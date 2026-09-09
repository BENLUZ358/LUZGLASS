#!/usr/bin/env node
/**
 * The `+` belongs to every pane, not to the first one.
 *
 * Adding a shape used to stop after the second: nothing could follow. The
 * cause was not the button — it was a frozen assumption underneath it.
 * `shapeBoundary` held the far end at 'open' for ever, because the buttons
 * that used to set it were removed. From that, two limits that looked like
 * bugs in the `+`:
 *
 *   A fixed could never END a chain, because at an open end it has nothing
 *   to lean on and lgValidate rightly refuses it.
 *
 *   A door hung on the end wall LOST that wall the moment anything was put
 *   beyond it, so every candidate became illegal and the button vanished.
 *
 * A wall at an end is not a barrier — it is what the next pane leans on.
 * Treating it as one is what stopped the chain: the + never appeared on
 * the wall side at all, so a run could only ever grow toward the entrance,
 * and there it dead-ends at the door. The only question left is the one
 * the rules engine answers.
 *
 * Nothing here knows about "the first" or "the second" pane. Every free end
 * of the chain goes through the same function.
 *
 * Run: node scripts/test-chain-growth.js
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

function screen() {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set, Map });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  /* the boundary is taken from the source, so the test cannot drift from it */
  const bnd = (DEMO.match(/let shapeBoundary=(\{[^}]*\});/) || [, '{right:"wall",left:"wall"}'])[1];
  vm.runInContext('var selQ="zamak"; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'let shapeBoundary=' + bnd + ';' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null,panelState={},items=[];' +
    'var curCombo={panels:[]}; let TOAST=null; function shapeToast(m){TOAST=m;}' +
    'function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', 'getPS', 'getPStates', '_shapePanels', '_lgShowerOf', '_shapeShower',
   'galleryEntries', 'entryCanFlip', 'galleryShown', '_tryArrangement',
   '_arrangementErrors', '_variantsOf', '_stateFromAdd', '_fits', '_bothFit', '_legalVariant',
   'allowedAt', '_whyNot', 'canAddAt', 'hingeHolesFromEngine', 'shapeAdd',
   'shapeAddFromCatalog', 'shapeRemove'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (c, e) => vm.runInContext(e, c);
const idOf = (c, n) => run(c, 'galleryEntries().findIndex(function(e){return e.name===' + JSON.stringify(n) + ';})');
const NAMES = c => run(c, 'galleryEntries().map(function(e){return e.name;})');
const VALID = c => run(c, 'lgValidate(_shapeShower())');
const PLAIN = 'קבוע · זוויות בלבד', CARRIER = 'קבוע נושא דלת', DOOR = 'דלת';

/* add whatever the engine allows on that side, preferring `want`
   (a single name, or a list tried in order) */
function grow(c, side, want) {
  const cand = run(c, 'allowedAt(' + JSON.stringify(side) + ')');
  if (!cand.length) return null;
  const names = NAMES(c);
  const wants = want == null ? [] : [].concat(want);
  let pick = null;
  for (const w of wants) { pick = cand.find(x => names[x.i] === w); if (pick) break; }
  pick = pick || cand[0];
  const before = run(c, 'shapeList.length');
  run(c, 'addSide=' + JSON.stringify(side) + '; shapeAddFromCatalog(' + pick.i + '); addSide=null;');
  return run(c, 'shapeList.length') > before ? names[pick.i] : null;
}

console.log('');

/* ── the chain keeps going, from any start ──────────────────────────────── */
/* A run is built left to right. A door reaching the entrance CLOSES the
   run — that is the shower being finished, not the chain failing — so
   these grow with panes that leave the entrance open. */
[PLAIN, CARRIER, DOOR, 'מראה', 'קבוע משופע'].forEach(start => {
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, start) + ')');
  const added = [];
  for (let step = 0; step < 10; step++) {
    /* prefer panes that leave the entrance open; a door would finish the run */
    const got = grow(c, 'right', [PLAIN, 'מראה', 'צורה חופשית']);
    if (!got) break;
    added.push(got);
  }
  check(start + ': the chain keeps growing past the second pane',
        run(c, 'shapeList.length') >= 5, true);
  check('  and every arrangement along the way stays legal', VALID(c), []);
  check('  with a pane for every step taken', run(c, 'shapeList.length'), added.length + 1);
});

/* ── the exact complaint: shape 1 → + → shape 2 → + → shape 3 ───────────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  check('one pane offers a +', run(c, 'canAddAt("right")'), true);

  grow(c, 'right', PLAIN);
  check('two panes, and the second offers one too', run(c, 'canAddAt("right")'), true);

  grow(c, 'right', PLAIN);
  check('three panes', run(c, 'shapeList.length'), 3);
  check('and the third offers one as well', run(c, 'canAddAt("right")'), true);

  grow(c, 'right', PLAIN);
  check('four panes, still going', run(c, 'shapeList.length'), 4);
  check('all of it legal', VALID(c), []);

  /* and a door at the entrance finishes it, on purpose */
  grow(c, 'right', DOOR);
  check('a door closes the run', run(c, 'canAddAt("right")'), false);
  check('and the finished run is legal', VALID(c), []);
}

/* ── the brackets-only fixed puts the door's hinges on the far side ────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, PLAIN) + ')');
  const first = grow(c, 'right', DOOR);
  check('a door lands beside the brackets-only fixed', first, DOOR);
  check('nothing at all between them', run(c, 'lgJunctions(_shapeShower())[1].type'), null);
  check('so the door hangs on its own wall, not on the fixed',
        run(c, 'lgJunctions(_shapeShower())[2].type'), 'hinge-wall');
  check('and the run is legal', VALID(c), []);

  /* the pane prepared for a door takes it the other way, and continues */
  const c2 = screen();
  run(c2, 'shapeAddFromCatalog(' + idOf(c2, CARRIER) + ')');
  grow(c2, 'right', DOOR);
  check('the carrier takes the door onto its own face',
        run(c2, 'lgJunctions(_shapeShower())[1].type'), 'hinge-gg');
  check('and the chain can still continue past it', run(c2, 'canAddAt("right")'), true);
  grow(c2, 'right');
  check('so a third pane goes on', run(c2, 'shapeList.length'), 3);
  check('legally', VALID(c2), []);
}

/* ── nothing in the mechanism counts panes ──────────────────────────────── */
/* Whatever is offered at an end must depend only on what that end IS, not
   on how many panes came before it. Two chains ending the same way must
   offer the same things. */
{
  const a = screen();
  run(a, 'shapeAddFromCatalog(' + idOf(a, CARRIER) + ')');
  grow(a, 'right', DOOR);

  /* the extra pane goes on the OTHER end, so the right end of both chains
     is the same door hinged the same way — only the length differs */
  const b = screen();
  run(b, 'shapeAddFromCatalog(' + idOf(b, CARRIER) + ')');
  grow(b, 'right', DOOR);
  grow(b, 'left');
  grow(b, 'left');

  const offersA = run(a, 'allowedAt("right").map(function(x){return galleryEntries()[x.i].name;})').sort();
  const offersB = run(b, 'allowedAt("right").map(function(x){return galleryEntries()[x.i].name;})').sort();
  check('both chains really do end in the same pane',
        [run(b, 'shapeList[shapeList.length-1].kind'),
         run(b, 'shapeList[shapeList.length-1].hingeSide')],
        [run(a, 'shapeList[shapeList.length-1].kind'),
         run(a, 'shapeList[shapeList.length-1].hingeSide')]);
  check('a longer chain ending in the same pane offers the same things',
        offersB, offersA);
  check('and the count of panes differs, so length is not what decided',
        run(a, 'shapeList.length') !== run(b, 'shapeList.length'), true);
}

/* ── growing does not disturb what is already built ─────────────────────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  run(c, 'Object.assign(getPS("shape",0),{w:640,h:1910,notchW:250,notchH:420,bracketTop:180})');
  const before = JSON.parse(JSON.stringify(run(c, 'getPStates()[0]')));
  const firstId = run(c, 'shapeList[0].id');

  for (let i = 0; i < 6; i++) grow(c, i % 2 ? 'left' : 'right', DOOR);

  const idx = run(c, 'shapeList.findIndex(function(s){return s.id===' + JSON.stringify(firstId) + ';})');
  check('the pane built first is still there', idx > -1, true);
  check('with everything it was given',
        JSON.parse(JSON.stringify(run(c, 'getPStates()[' + idx + ']'))), before);
  check('and the whole run is legal', VALID(c), []);
}

/* ── every pane drawn, none overlapping, however long the run ───────────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  for (let i = 0; i < 6; i++) grow(c, 'right', DOOR);
  const n = run(c, 'shapeList.length');
  const L = run(c, 'lgLayout(_lgShowerOf(_shapePanels(),getPStates()),{canvasW:1600})');
  check('every pane in a long run reaches the drawing', L.shapes.length, n);
  check('each with a real size', L.shapes.every(g => g.w > 0 && g.h > 0), true);
  check('and none of them overlaps its neighbour',
        L.shapes.slice().sort((a, b) => a.x - b.x)
          .every((g, i, arr) => i === 0 || g.x >= arr[i - 1].x + arr[i - 1].w - 0.5), true);
}

/* ── the shape of the fix, in the source ────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('a lone pane leans on one wall, not two',
        /let shapeBoundary=\{right:'wall',left:'open'\}/.test(DEMO), true);
  check('a wall is no longer treated as a barrier', /function sideBlocked/.test(DEMO), false);
  /* A run is built left to right: the first pane sits on the left wall and
     everything follows rightward. So there is ONE +, on the right face of
     the last pane — a + on the left would offer to build back into the
     wall. Which pane carries it is decided by position, never by how many
     panes there are. */
  check('the + sits on the right face of the last pane',
        has('const g=ends[ends.length-1];'), true);
  check('and only when the rules allow something there',
        has("if(!g||!canAddAt('right')){ host.innerHTML=''; return; }"), true);
  check('there is no + on the wall side', /addAt\(&quot;left&quot;\)/.test(DEMO), false);
  check('with no count of panes anywhere in the decision',
        /shapeList\.length\s*[<>=]=?\s*[0-9]/.test(
          DEMO.slice(DEMO.indexOf('function allowedAt'), DEMO.indexOf('function shapeAdd('))), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll chain-growth checks passed.');
