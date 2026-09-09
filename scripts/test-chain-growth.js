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
 * A shower run spans wall to wall, and glass goes into that span. A wall at
 * an end is not a barrier — it is what the next pane leans on. So the ends
 * are walls, and the only question left is the one the rules engine
 * answers.
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

/* add whatever the engine allows on that side, preferring `want` */
function grow(c, side, want) {
  const cand = run(c, 'allowedAt(' + JSON.stringify(side) + ')');
  if (!cand.length) return null;
  const names = NAMES(c);
  const pick = (want && cand.find(x => names[x.i] === want)) || cand[0];
  const before = run(c, 'shapeList.length');
  run(c, 'addSide=' + JSON.stringify(side) + '; shapeAddFromCatalog(' + pick.i + '); addSide=null;');
  return run(c, 'shapeList.length') > before ? names[pick.i] : null;
}

console.log('');

/* ── the chain keeps going, from any start, in both directions ──────────── */
[PLAIN, CARRIER, DOOR, 'מראה', 'קבוע משופע'].forEach(start => {
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, start) + ')');
  const added = [];
  for (let step = 0; step < 8; step++) {
    const side = step % 2 ? 'left' : 'right';
    const got = grow(c, side, DOOR);      /* prefer a door, to press the rules */
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

  grow(c, 'right', DOOR);
  check('two panes, and the second offers one too', run(c, 'canAddAt("right")'), true);

  grow(c, 'right');
  check('three panes', run(c, 'shapeList.length'), 3);
  check('and the third offers one as well', run(c, 'canAddAt("right")'), true);

  grow(c, 'right');
  check('four panes, still going', run(c, 'shapeList.length'), 4);
  check('all of it legal', VALID(c), []);
}

/* ── the door beside a brackets-only fixed no longer ends the chain ─────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, PLAIN) + ')');
  const first = grow(c, 'right', DOOR);
  check('a door lands beside the brackets-only fixed', first, DOOR);
  check('hinged away from it, as the rule says',
        run(c, 'lgJunctions(_shapeShower())[1].type'), null);
  check('and the chain can still continue past it', run(c, 'canAddAt("right")'), true);
  grow(c, 'right');
  check('so a third pane goes on', run(c, 'shapeList.length'), 3);
  check('legally', VALID(c), []);
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
  check('the run spans wall to wall', /let shapeBoundary=\{right:'wall',left:'wall'\}/.test(DEMO), true);
  check('a wall is no longer treated as a barrier', /function sideBlocked/.test(DEMO), false);
  check('the + is drawn on both free ends of the chain',
        has("[['left',ends[0],'x'],['right',ends[ends.length-1],'r']]"), true);
  check('and it asks the same function every pane asks',
        has('if(!g||!canAddAt(side)) return;'), true);
  check('with no count of panes anywhere in the decision',
        /shapeList\.length\s*[<>=]=?\s*[0-9]/.test(
          DEMO.slice(DEMO.indexOf('function allowedAt'), DEMO.indexOf('function shapeAdd('))), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll chain-growth checks passed.');
