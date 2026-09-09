#!/usr/bin/env node
/**
 * No action on one pane may disturb another.
 *
 * The complaint was that details vanished: add a door beside a fixed and
 * something else quietly changed. Chasing the one case would have missed
 * the shape of the fault, so this file goes after the shape itself.
 *
 * Three faults it holds down, all of one family:
 *
 *   ONE STORE. getPS created a pane's state and kept it; getPStates
 *   created one and threw it away. A pane whose state was missing got
 *   fresh defaults on every draw, and the two functions handed out
 *   DIFFERENT objects for the same pane — so what was written through one
 *   was invisible through the other. That is exactly how a detail
 *   disappears because of an action somewhere else.
 *
 *   NO SHARED ARRAYS. A catalogue entry serves every pane made from it.
 *   Handing its holes array straight to a pane's state meant editing one
 *   pane's hole edited it in all of them.
 *
 *   NO BROKEN PANES. When no legal hand exists, the door used to be
 *   created anyway with the hand printed on the card — and then no
 *   junction produced anything, so it stood there with no hinges at all
 *   and looked as though its shape had been lost. Refusing, and saying
 *   why, is the honest answer.
 *
 * Run: node scripts/test-state-integrity.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

/* the ends come from the source, so a test can never drift from it */
const SRC_BOUNDARY = JSON.parse((DEMO.match(/let shapeBoundary=\{([^}]*)\};/)[1])
  .replace(/(\w+):/g, '"$1":').replace(/'/g, '"').replace(/^/, '{').replace(/$/, '}'));

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
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set, Map, Map });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var selQ="zamak"; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'const THUMB_BOUNDARY={right:"wall",left:"open"};' +
    'let shapeBoundary=' + JSON.stringify(boundary || SRC_BOUNDARY) + ';' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null,panelState={},items=[];' +
    'var curCombo={panels:[]};' +
    'let TOAST=null; function shapeToast(m){TOAST=m;}' +
    'function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', '_shapeShower', 'getPS', 'getPStates', '_shapePanels', '_lgShowerOf', 'galleryEntries',
   'entryCanFlip', 'galleryShown', 'galleryFlip', '_tryArrangement', '_arrangementErrors', '_variantsOf', '_stateFromAdd', '_fits', '_bothFit', '_legalVariant', 'allowedAt', '_whyNot',
   'canAddAt', 'hingeHolesFromEngine', 'shapeAdd', 'shapeAddFromCatalog',
   'shapeRemove', 'shapeFlipHinge'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (c, e) => vm.runInContext(e, c);
const idOf = (c, n) => run(c, 'galleryEntries().findIndex(function(e){return e.name===' + JSON.stringify(n) + ';})');
const PLAIN = 'קבוע · זוויות בלבד', CARRIER = 'קבוע נושא דלת';

/* the whole state of a pane, as the drawing would read it */
const snap = (c, i) => JSON.parse(JSON.stringify(run(c, 'getPStates()[' + i + ']')));

console.log('');

/* ── one store, not two ─────────────────────────────────────────────────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, PLAIN) + ')');
  check('both readers hand back the very same object',
        run(c, 'getPS("shape",0)===getPStates()[0]'), true);

  run(c, 'getPS("shape",0).w=777');
  check('a change written through one is seen through the other',
        run(c, 'getPStates()[0].w'), 777);

  /* and a pane whose state went missing is rebuilt ONCE and kept */
  run(c, 'delete shapePS[shapeList[0].id]');
  run(c, 'getPStates()[0].h=1234');
  check('a rebuilt state is stored, not thrown away',
        run(c, 'getPS("shape",0).h'), 1234);
  check('and it is still the same object both ways',
        run(c, 'getPS("shape",0)===getPStates()[0]'), true);
}

/* ── adding a pane leaves every other pane untouched ────────────────────── */
{
  const c = screen();
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  /* give it a full set of edits, the kind a customer makes */
  run(c, 'Object.assign(getPS("shape",0),{w:640,h:1910,hasSlope:true,' +
         'slopeH1:1910,slopeH2:1750,notchW:250,notchH:420,notchSide:"left",' +
         'bracketTop:180,bracketInset:30,thickness:10})');
  const before = snap(c, 0);

  run(c, 'addSide="right"; shapeAddFromCatalog(' + idOf(c, 'דלת') + '); addSide=null;');
  check('adding a door beside it changes nothing about it', snap(c, 0), before);
  check('and the door really was added', run(c, 'shapeList.length'), 2);

  /* the door arrives whole */
  const door = snap(c, 1);
  check('the door arrives with its own size', [door.w, door.h], [800, 1985]);
  check('and its own hinge side', run(c, 'shapeList[1].hingeSide') != null, true);

  /* every later action leaves pane 0 alone too */
  /* Ordered so each action is one the engine actually allows. A refused
     add is its own case, below. */
  const acts = [
    ["editing the door's width",  'getPS("shape",1).w=900'],
    ["flipping the door's hinge", 'shapeFlipHinge(shapeList[1].id)'],
    ['flipping a gallery card',   'galleryFlip(' + idOf(c, 'דלת') + ')'],
    ['reading the layout',        'lgLayout(_lgShowerOf(_shapePanels(),getPStates()),{canvasW:900})'],
    /* a refused add must be as harmless as an accepted one */
    ['an add the rules refuse',   'addSide="right"; shapeAddFromCatalog(' + idOf(c, PLAIN) + '); addSide=null;'],
    ['removing the last pane',    'shapeRemove(shapeList[shapeList.length-1].id)'],
  ];

  acts.forEach(([what, code]) => {
    run(c, code);
    check(what + ' leaves the first pane exactly as it was', snap(c, 0), before);
  });
}

/* ── two panes from one card do not share anything ──────────────────────── */
{
  const c = screen();
  run(c, 'addSide="right"');
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  run(c, 'shapeAddFromCatalog(' + idOf(c, CARRIER) + ')');
  run(c, 'addSide=null');
  check('two panes from the same card are two panes', run(c, 'shapeList.length'), 2);
  check('with different ids', run(c, 'shapeList[0].id!==shapeList[1].id'), true);
  check('and separate state objects', run(c, 'getPS("shape",0)!==getPS("shape",1)'), true);

  /* the holes array in particular — it comes from a shared catalogue entry */
  const both = run(c, '[getPS("shape",0).holes, getPS("shape",1).holes]');
  if (both[0] && both[1]) {
    check('their holes are separate arrays too',
          run(c, 'getPS("shape",0).holes!==getPS("shape",1).holes'), true);
    run(c, 'getPS("shape",0).holes[0].dia=99');
    check('so moving one pane\'s hole does not move the other\'s',
          run(c, 'getPS("shape",1).holes[0].dia'), 20);
  }

  /* editing one pane's size leaves the other's alone */
  const before1 = snap(c, 1);
  run(c, 'getPS("shape",0).h=1750');
  check('and a height typed into one stays in one', snap(c, 1), before1);
}

/* ── an impossible pane is refused, not created broken ──────────────────── */
/* A fixed at an open end has nothing to lean on. It must be refused with a
   reason, and refusing must leave everything else untouched. (A door is
   NOT this case — a door at an end brings its own wall.) */
{
  const c = screen({ right: 'wall', left: 'open' });
  run(c, 'shapeAddFromCatalog(' + idOf(c, PLAIN) + ')');
  run(c, 'addSide="right"; shapeAddFromCatalog(' + idOf(c, 'דלת') + '); addSide=null;');
  const before0 = snap(c, 0), before1 = snap(c, 1);
  const n = run(c, 'shapeList.length');

  /* now the door is last, and a fixed after it would float */
  run(c, 'addSide="right"; shapeAddFromCatalog(' + idOf(c, PLAIN) + '); addSide=null;');
  check('a pane with nothing to lean on is not created', run(c, 'shapeList.length'), n);
  check('the first pane is untouched', snap(c, 0), before0);
  check('and so is the second', snap(c, 1), before1);
  /* the reason is whatever lgValidate actually said — not a sentence the
     screen made up. Which of its rules fired depends on the arrangement,
     so what matters is that the words came from the engine. */
  const said = String(run(c, 'TOAST'));
  const vocab = run(c, 'lgValidate({boundary:shapeBoundary,finish:"shahor",quality:"zamak",' +
    'shapes:[{id:"a",kind:"fixed",carriesDoor:false},{id:"b",kind:"door",hingeSide:"right"},' +
    '{id:"c",kind:"fixed",carriesDoor:false}]}).map(function(e){return e.msg;})');
  check('a reason is given at all', said.length > 20, true);
  check('and it is one the rules engine wrote',
        vocab.some(m => said.indexOf(m) > -1), true);

  /* the door beside a brackets-only fixed IS created, hinged away */
  const c2 = screen({ right: 'wall', left: 'open' });
  run(c2, 'shapeAddFromCatalog(' + idOf(c2, PLAIN) + ')');
  run(c2, 'addSide="right"; shapeAddFromCatalog(' + idOf(c2, 'דלת') + '); addSide=null;');
  check('a door beside a brackets-only fixed is created', run(c2, 'shapeList.length'), 2);
  check('with no complaint', run(c2, 'lgValidate(_shapeShower())'), []);
  check('and nothing between them, so it hangs on its own wall',
        run(c2, 'lgJunctions(_shapeShower())[1].type'), null);
}

/* ── every pane always reaches the drawing whole ────────────────────────── */
{
  const c = screen();
  run(c, 'addSide="right"');
  [PLAIN, 'מראה', CARRIER, 'דלת'].forEach(n =>
    run(c, 'shapeAddFromCatalog(' + idOf(c, n) + ')'));
  run(c, 'addSide=null');
  const n = run(c, 'shapeList.length');
  check('a chain of four builds', n, 4);

  const L = run(c, 'lgLayout(_lgShowerOf(_shapePanels(),getPStates()),{canvasW:1200})');
  check('and every one of them is drawn', L.shapes.length, n);
  check('each with a real outline',
        L.shapes.every(g => g.poly && g.poly.length >= 4), true);
  check('and a real size', L.shapes.every(g => g.w > 0 && g.h > 0), true);
  check('nothing overlaps anything else',
        L.shapes.slice().sort((a, b) => a.x - b.x)
          .every((g, i, arr) => i === 0 || g.x >= arr[i - 1].x + arr[i - 1].w - 0.5), true);

  /* the declaration survives the whole chain */
  check('the brackets-only pane still declares itself at the end',
        run(c, '_shapePanels()[0].carriesDoor'), false);
}

/* ── the shape of the fix, in the source ────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('there is one path to a pane\'s state',
        has('return Object.fromEntries(shapeList.map(function(s,i){return [i,getPS(\'shape\',i)];}))') ||
        has("shapeList.map((s,i)=>[i,getPS('shape',i)])"), true);
  check('no reader builds a throwaway default',
        /shapePS\[s\.id\]\|\|mkPS/.test(DEMO), false);
  check('combination panes are stored the same way',
        has('if(!panelState[i]) panelState[i]=mkPS('), true);
  check('holes are copied out of the catalogue, not borrowed',
        has('extra.holes=a.holes.map('), true);
  check('and an illegal add stops before it creates anything',
        has("if(!e){ shapeToast('אי אפשר לחבר כאן: '+_whyNot(e0,side),true); return; }"), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll state-integrity checks passed.');
