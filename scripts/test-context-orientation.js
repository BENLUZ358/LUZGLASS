#!/usr/bin/env node
/**
 * The canvas decides the orientation. Not the card, not a toggle.
 *
 * A fixed against the left wall with no hinge preparation can take a door
 * beside it — but only a door hinged AWAY from it, onto its own wall. The
 * reversed door has nowhere to hang, so it is not an option at all: not
 * offered, not reachable by flipping, not creatable.
 *
 * That is one rule applied everywhere, and it is the rule that was already
 * in lg-shapes.js. What this file guards is that Gallery, Flip, Add and
 * Canvas all read it from the same place:
 *
 *   canvas → existing panes → rules engine → legal orientation → what is shown
 *
 * and never the other way round — pick an orientation, then try to make it
 * fit. Before this, the hand of a door was corrected by the engine while
 * every other side-bearing field came from a display toggle that knew
 * nothing about the canvas. Two sources for one orientation, and the
 * contradictions came from the gap between them.
 *
 * Run: node scripts/test-context-orientation.js
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
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set, Map });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var selQ="zamak"; var selMM=8; var selG="שקוף"; var selWork=""; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'let shapeBoundary=' + JSON.stringify(boundary || SRC_BOUNDARY) + ';' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null,panelState={},items=[];' +
    'var curCombo={panels:[]}; let TOAST=null; function shapeToast(m){TOAST=m;}' +
    'var document={getElementById:function(){return null;}};var setTimeout=function(){};var document={getElementById:function(){return null;}};var setTimeout=function(){};function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', 'getPS', 'getPStates', '_shapePanels', '_lgShowerOf', '_shapeShower',
   'galleryEntries', 'entryCanFlip', 'galleryShown', 'galleryFlip',
   '_tryArrangement', '_arrangementErrors', '_variantsOf', '_stateFromAdd', '_fits', '_bothFit',
   '_legalVariant', 'allowedAt', '_whyNot', 'canAddAt',
   'hingeHolesFromEngine', 'addAt', 'closeGallery', 'shapeAdd', 'shapeAddFromCatalog',
   'shapeRemove'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (c, e) => vm.runInContext(e, c);
const idOf = (c, n) => run(c, 'galleryEntries().findIndex(function(e){return e.name===' + JSON.stringify(n) + ';})');
const PLAIN = 'קבוע · זוויות בלבד', CARRIER = 'קבוע נושא דלת', DOOR = 'דלת';
const JUNCTIONS = 'lgJunctions(_shapeShower()).map(function(j){return j.type;})';

console.log('');

/* ── the example, in full ───────────────────────────────────────────────── */
/* left-hand fixed on the wall, no hinges. Only one door fits beside it. */
{
  const c = screen();
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, PLAIN) + ');');
  const di = idOf(c, DOOR);

  const offer = run(c, 'allowedAt("right").filter(function(x){return x.i===' + di + ';})');
  check('a door is offered beside it', offer.length, 1);
  check('and only in the orientation that hangs away from the fixed',
        offer[0].ent.add.hingeSide, 'left');
  check('which is the flipped face of the card', offer[0].ent.flipped, true);
  check('so no flip is offered — there is nothing else it could be',
        run(c, '_bothFit(galleryEntries()[' + di + '],"right")'), false);

  /* and the impossible orientation really is impossible */
  check('the other orientation does not fit',
        run(c, '_fits(galleryEntries()[' + di + '],"right")'), false);

  run(c, 'addAt("right"); shapeAddFromCatalog(' + di + '); addSide=null;');
  check('the door that lands is the one that was shown',
        run(c, 'shapeList[1].hingeSide'), 'left');
  check('nothing sits between it and the fixed',
        run(c, JUNCTIONS), ['bracket-wall', null, 'hinge-wall']);
  check('and the arrangement is clean', run(c, 'lgValidate(_shapeShower())'), []);
}

/* ── the pane prepared for a door takes it the other way ────────────────── */
{
  const c = screen();
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, CARRIER) + ');');
  const di = idOf(c, DOOR);

  const offer = run(c, 'allowedAt("right").filter(function(x){return x.i===' + di + ';})');
  check('a door is offered beside the carrier too', offer.length, 1);
  check('hinged onto it, as the card reads', offer[0].ent.add.hingeSide, 'right');
  check('and here both orientations are possible, so a flip is offered',
        run(c, '_bothFit(galleryEntries()[' + di + '],"right")'), true);

  run(c, 'addAt("right"); shapeAddFromCatalog(' + di + '); addSide=null;');
  check('the joint between them is a glass-to-glass hinge',
        run(c, JUNCTIONS), ['bracket-wall', 'hinge-gg', null]);
}

/* ── a user's flip is a preference, not an override ─────────────────────── */
{
  const c = screen();
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, PLAIN) + ');');
  const di = idOf(c, DOOR);

  /* the user flips the card the wrong way for this canvas */
  run(c, 'flipped[galleryEntries()[' + di + '].id]=true');
  const a = run(c, 'allowedAt("right").filter(function(x){return x.i===' + di + ';})');
  check('a preference the canvas allows is honoured', a[0].ent.add.hingeSide, 'left');

  /* and the other way round: a preference the canvas forbids is overruled */
  run(c, 'flipped[galleryEntries()[' + di + '].id]=false');
  const b = run(c, 'allowedAt("right").filter(function(x){return x.i===' + di + ';})');
  check('a preference the canvas forbids is overruled', b[0].ent.add.hingeSide, 'left');

  run(c, 'addAt("right"); shapeAddFromCatalog(' + di + '); addSide=null;');
  check('and what lands is what the canvas allowed, not what was preferred',
        run(c, 'shapeList[1].hingeSide'), 'left');
  check('with no complaint', run(c, 'lgValidate(_shapeShower())'), []);
}

/* ── one rule, everywhere: offered ⇔ addable ⇔ valid ────────────────────── */
/* Gallery, Flip, Add and Canvas must never disagree. This walks every card
   against every arrangement the seeds can build and demands they line up. */
{
  const base = [PLAIN, CARRIER, DOOR, 'מראה', 'קבוע משופע', 'קבוע עם מדרגה'];
  const mismatches = [];
  base.forEach(first => {
    ['right', 'left'].forEach(side => {
      const c = screen();
      run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, first) + ');');
      const names = run(c, 'galleryEntries().map(function(e){return e.name;})');
      const offered = new Map(run(c, 'allowedAt(' + JSON.stringify(side) + ')').map(x => [x.i, x.ent]));

      names.forEach((n, i) => {
        const c2 = screen();
        run(c2, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c2, first) + ');');
        const before = run(c2, 'shapeList.length');
        run(c2, 'addAt(' + JSON.stringify(side) + '); shapeAddFromCatalog(' + i + '); addSide=null;');
        const added = run(c2, 'shapeList.length') > before;
        const clean = added && run(c2, 'lgValidate(_shapeShower())').length === 0;

        /* offered means addable */
        if (offered.has(i) !== added)
          mismatches.push(`${first}+${n}@${side}: offered=${offered.has(i)} added=${added}`);
        /* and everything added is valid */
        if (added && !clean)
          mismatches.push(`${first}+${n}@${side}: added but invalid`);
        /* and it landed in the orientation that was shown */
        if (added && offered.has(i)) {
          const want = offered.get(i).add.hingeSide;
          /* a pane added on the left lands at the START of the array */
          const at = side === 'left' ? 0 : run(c2, 'shapeList.length') - 1;
          const got = run(c2, 'shapeList[' + at + '].hingeSide');
          if ((want || null) !== (got || null))
            mismatches.push(`${first}+${n}@${side}: shown ${want} but added ${got}`);
        }
      });
    });
  });
  check('gallery, add and canvas agree on every combination', mismatches, []);
}

/* ── a refusal never damages what is already there ──────────────────────── */
{
  const c = screen();
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, PLAIN) + ');');
  run(c, 'Object.assign(getPS("shape",0),{w:640,h:1910,notchW:250,notchH:420})');
  /* track the pane BY ID: adding on the left shifts every index */
  const id = run(c, 'shapeList[0].id');
  const at = () => run(c, 'shapeList.findIndex(function(s){return s.id===' + JSON.stringify(id) + ';})');
  const before = JSON.parse(JSON.stringify(run(c, 'getPStates()[' + at() + ']')));
  const wasPane = JSON.parse(JSON.stringify(run(c, 'shapeList[' + at() + ']')));

  /* try to add everything, legal or not, on both sides */
  run(c, 'galleryEntries().forEach(function(e,i){' +
         '  ["left","right"].forEach(function(sd){ addAt(sd);' +
         '    try{ shapeAddFromCatalog(i); }catch(err){} closeGallery(); });' +
         '});');
  check('the pane is still there after all of it', at() > -1, true);
  check('untouched by any of it',
        JSON.parse(JSON.stringify(run(c, 'getPStates()[' + at() + ']'))), before);
  check('and it is still the same pane it was',
        JSON.parse(JSON.stringify(run(c, 'shapeList[' + at() + ']'))), wasPane);
  check('whatever was added is valid', run(c, 'lgValidate(_shapeShower())'), []);
}

/* ── one source, in the source ──────────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the legal orientation is decided in one function',
        has('function _legalVariant('), true);
  check('the gallery shows what that function returned',
        has('const shown = okEnt ? okEnt.get(i) : galleryShown(i);'), true);
  check('the thumbnail draws that same orientation',
        has('shapeThumb(cv, okEnt ? okEnt.get(i) : galleryShown(i))'), true);
  check('and adding takes the whole variant, not just its hinge',
        has('const e = side ? _legalVariant(e0,side) : galleryShown(i);'), true);
  check('flip is offered only where both orientations fit',
        has('entryCanFlip(e) && (!addSide || _bothFit(e,addSide))'), true);
  check('and every question goes through the one chain',
        has('return lgValidate(_lgShowerOf(_shapePanels(list),pss));'), true);

  /* nothing blocks an end any more: a wall is what the next pane leans on,
     and the only gate left is the rules engine itself */
  check('no end is treated as a barrier', /function sideBlocked/.test(DEMO), false);
  check('and the probe carries everything the rules read',
        DEMO.indexOf("_tryArrangement(list, {'__probe': _stateFromAdd(a)})") > -1, true);

  /* no second opinion anywhere: the screen may NAME hardware for display,
     but it must not decide which hardware a junction produces */
  check('the screen keeps no junction table of its own',
        /_LG_JUNCTION|_lgPairKey|_lgEdge/.test(DEMO), false);
  check('and no flip logic leaked into the rules engine',
        /lgFlip|_legalVariant|flipped/.test(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8')), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll context-orientation checks passed.');
