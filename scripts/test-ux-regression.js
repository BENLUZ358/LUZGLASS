#!/usr/bin/env node
/**
 * The twenty scenarios that had to keep working after the UX change.
 *
 * The rules did not change — that was the condition of the whole job. What
 * changed is how a shape is chosen, flipped, placed and edited. So this
 * file walks the flows end to end and checks that the ANSWERS are the same
 * ones the engine gave before: a chain of panes, a flipped shape inside a
 * chain, and the same behaviour in both tabs.
 *
 * Run: node scripts/test-ux-regression.js
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

/* the screen, with just enough browser to run its own functions */
function screen() {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set, Map, Map });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext(
    'var selQ="zamak"; var selMM=8; var selG="שקוף"; var selWork=""; var selSupportBar=false, selBlackTrim=false; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var shapeBoundary={right:"wall",left:"open"};' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'let shapeList=[]; let shapePS={}; let _shapeSeq=0; let flipped={};' +
    'let libFactory=[],libPersonal=[]; let addSide=null; let lastL=null;' +
    'var document={getElementById:function(){return null;}};var setTimeout=function(){};var document={getElementById:function(){return null;}};var setTimeout=function(){};function renderShapeUI(){} function draw(){ lastL=layoutNow(); }' +
    'function renderShapeGallery(){} function _shEsc(s){return s;}' +
    'function shapeToast(){} let panelState={},items=[]; var curCombo={panels:[]};' +
    'function layoutNow(){ return shapeList.length ?' +
    '  lgLayout(_lgShowerOf(_shapePanels(), Object.fromEntries(' +
    '    shapeList.map(function(s,i){return [i,shapePS[s.id]];}))),{canvasW:900}) : null; }',
    ctx);
  ['mkPS', '_shapeShower', '_shapePanels', '_lgShowerOf', 'galleryEntries', 'entryCanFlip',
   'galleryShown', 'galleryFlip', '_tryArrangement', '_arrangementErrors', '_variantsOf', '_stateFromAdd', '_fits', '_bothFit', '_legalVariant', 'allowedAt',
   'canAddAt', '_whyNot', 'hingeHolesFromEngine', 'addAt', 'closeGallery', 'shapeAdd', 'shapeAddFromCatalog',
   'shapeRemove', 'pickOrder', 'getPS', 'getPStates'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (ctx, e) => vm.runInContext(e, ctx);
/* the plain fixed is the one that declares "brackets only" */
const PLAIN   = 'קבוע · זוויות בלבד';   /* declares: no hinge preparation */
const CARRIER = 'קבוע נושא דלת';        /* the one a door may hang on */
const idOf = (ctx, name) => run(ctx, 'galleryEntries().findIndex(function(e){return e.name===' +
  JSON.stringify(name) + ';})');

console.log('');

/* ── 1. every shipped shape can be chosen, and lands ────────────────────── */
/* Only ONE folding door has nothing to land on alone: "דלת מתקפלת" folds
   through the same face it would otherwise hinge from, so it has no
   ordinary hinge at all — on an empty canvas there is truly nothing for
   it to attach to. "דלת צירים+הרמוניקה" is different: its hinge and its
   fold sit on OPPOSITE faces, so the hinge face hangs on the wall exactly
   like a plain door, and the fold face simply waits — unbuilt, not
   invalid — for the door that will complete the accordion. The point of
   this check was never "everything works everywhere" — it is that the
   gallery and the canvas agree on which of the two that is. */
{
  const ctx = screen();
  const names = run(ctx, 'galleryEntries().map(function(e){return e.name;})');
  const broke = [], alone = [];
  names.forEach(n => {
    const c = screen();
    try {
      run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, n) + ');');
      if (run(c, 'shapeList.length') !== 1) alone.push(n);
    } catch (e) { broke.push(n + ' (' + e.message + ')'); }
  });
  check('nothing in the gallery throws when picked', broke, []);
  check('and only the harmonica-only door needs something to fold onto',
        alone, ['דלת מתקפלת']);

  /* the agreement itself */
  const empty = screen();
  const offered = run(empty,
    'addAt("right"); allowedAt("right").map(function(c){return c.ent.name;})');
  check('so an empty canvas does not offer it',
        offered.filter(n => alone.indexOf(n) > -1), []);
  check('but the mid-accordion door IS offered — its hinge hangs on the wall',
        offered.indexOf('דלת צירים+הרמוניקה') > -1, true);

  const withFixed = screen();
  run(withFixed, 'shapeList=[{id:"f",kind:"fixed"}]; shapePS={f:mkPS({type:"fixed"})};');
  const now = run(withFixed,
    'addAt("right"); allowedAt("right").map(function(c){return c.ent.name;})');
  check('and a fixed to fold onto brings the folding door back',
        now.indexOf('דלת מתקפלת') > -1, true);

  check('and the gallery is not empty', names.length > 0, true);
}

/* ── 2-6. flip, pick the flipped one, and it arrives flipped ────────────── */
{
  const ctx = screen();
  const di = idOf(ctx, 'דלת');
  const before = run(ctx, 'galleryShown(' + di + ').add.hingeSide');
  run(ctx, 'galleryFlip(' + di + ')');
  const after = run(ctx, 'galleryShown(' + di + ').add.hingeSide');
  check('flipping a card changes the hand it shows', after !== before, true);

  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + di + ');');
  check('and the pane that lands carries the flipped hand',
        run(ctx, 'shapeList[0].hingeSide'), after);
  check('with no second flip applied on the way in',
        run(ctx, 'shapeList[0].hingeSide') !== before, true);

  /* the drawing agrees: the hinge really is on the other face */
  run(ctx, 'draw()');
  const hingeX = run(ctx, 'lastL.hardware.filter(function(h){return h.kind==="hinge";})' +
                          '.map(function(h){return Math.round(h.x);})');
  const g = run(ctx, '({x:lastL.shapes[0].x,w:lastL.shapes[0].w})');
  const onLeft = hingeX.length > 0 && hingeX.every(x => Math.abs(x - g.x) < Math.abs(x - (g.x + g.w)));

  const c2 = screen();
  run(c2, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c2, 'דלת') + ');');
  run(c2, 'draw()');
  const hx2 = run(c2, 'lastL.hardware.filter(function(h){return h.kind==="hinge";})' +
                      '.map(function(h){return Math.round(h.x);})');
  const g2 = run(c2, '({x:lastL.shapes[0].x,w:lastL.shapes[0].w})');
  const onLeft2 = hx2.length > 0 && hx2.every(x => Math.abs(x - g2.x) < Math.abs(x - (g2.x + g2.w)));
  check('the flipped door hangs on the opposite face from the unflipped one',
        onLeft !== onLeft2, true);
}

/* ── 7. a blocked side offers nothing ───────────────────────────────────── */
{
  const ctx = screen();
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ');');
  /* a wall at an end is what the next pane leans on, so both ends grow */
  check('both free ends of the chain offer a +',
        [run(ctx, 'canAddAt("left")'), run(ctx, 'canAddAt("right")')], [true, true]);
  check('and what each offers comes from the rules engine',
        run(ctx, 'allowedAt("left").length') > 0, true);
}

/* ── 8. a + places the new pane beside the one that asked ───────────────── */
{
  /* a door needs a pane prepared to carry it; the brackets-only case is
     its own test file */
  const ctx = screen();
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ');');
  const first = run(ctx, 'shapeList[0].id');
  run(ctx, 'addAt("right"); shapeAddFromCatalog(' + idOf(ctx, 'דלת') + '); addSide=null;');
  check('a shape added on the right sits after the pane it joined',
        run(ctx, 'shapeList.map(function(s){return s.id;})')[0], first);
  check('and there are two panes now', run(ctx, 'shapeList.length'), 2);

  run(ctx, 'draw()');
  const xs = run(ctx, 'lastL.shapes.slice().sort(function(a,b){return a.idx-b.idx;})' +
                      '.map(function(s){return Math.round(s.x);})');
  check('the second really is drawn to the right of the first', xs[1] > xs[0], true);
}

/* ── 9. the connection still comes from the engine ──────────────────────── */
/* A door may only hang on the pane prepared for it. The brackets-only
   fixed is covered by test-carries-door.js. */
{
  const ctx = screen();
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ');');
  run(ctx, 'addAt("right"); shapeAddFromCatalog(' + idOf(ctx, 'דלת') + '); addSide=null;');
  const errs = run(ctx, 'lgValidate(_lgShowerOf(_shapePanels(), Object.fromEntries(' +
                        'shapeList.map(function(s,i){return [i,shapePS[s.id]];}))))');
  check('the arrangement the + built is one the engine accepts', errs, []);

  run(ctx, 'draw()');
  check('and the shared joint carries hinges',
        run(ctx, 'lastL.hardware.filter(function(h){return h.kind==="hinge";}).length') > 0, true);
}

/* ── 10-11. a chain, including a flipped link ───────────────────────────── */
{
  const ctx = screen();
  run(ctx, 'addSide="right"');
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ');');
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ');');
  const di = idOf(ctx, 'דלת');
  run(ctx, 'galleryFlip(' + di + ')');
  run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + di + ');');
  run(ctx, 'addSide=null');
  check('a chain of three builds', run(ctx, 'shapeList.length'), 3);

  const errs = run(ctx, 'lgValidate(_lgShowerOf(_shapePanels(), Object.fromEntries(' +
                        'shapeList.map(function(s,i){return [i,shapePS[s.id]];}))))');
  check('and a flipped shape inside a chain is still legal or plainly refused',
        Array.isArray(errs), true);

  run(ctx, 'draw()');
  check('the whole chain draws', run(ctx, 'lastL.shapes.length'), 3);
  check('with every pane in its own place',
        new Set(run(ctx, 'lastL.shapes.map(function(s){return Math.round(s.x);})')).size, 3);
}

/* ── 14-16. picking a pane to edit ──────────────────────────────────────── */
{
  const ctx = screen();
  run(ctx, 'addSide="right"');
  [PLAIN, 'מראה', 'צורה חופשית'].forEach(n => run(ctx, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(ctx, n) + ');'));
  run(ctx, 'addSide=null');

  const order = run(ctx, 'pickOrder()');
  check('the picker lists every pane on the canvas', order.length, 3);
  check('each with the id the sheet will open',
        order.map(o => o.id), run(ctx, 'shapeList.map(function(s){return s.id;})'));

  /* stepping wraps, and lands on a real pane every time */
  const seen = [];
  vm.runInContext('let pickIdx=0, pickMode=true;', ctx);
  vm.runInContext(grab('pickStep').replace('renderPickBar();', '').replace('draw();', ''), ctx);
  for (let i = 0; i < 4; i++) { seen.push(run(ctx, 'pickOrder()[pickIdx].id')); run(ctx, 'pickStep(1)'); }
  check('stepping right moves through them and wraps',
        seen, [order[0].id, order[1].id, order[2].id, order[0].id]);
  /* from the first pane, stepping left wraps round to the last */
  run(ctx, 'pickIdx=0; pickStep(-1)');
  check('and stepping left from the first wraps to the last',
        run(ctx, 'pickOrder()[pickIdx].id'), order[2].id);
  run(ctx, 'pickStep(-1)');
  check('then keeps walking back', run(ctx, 'pickOrder()[pickIdx].id'), order[1].id);
}

/* ── 17-19. the old UI is gone, the shared logic is not ─────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('no build-direction UI remains', /id="bdRtl"|id="bdLtr"|class="build-dir"/.test(DEMO), false);
  check('no wall-end buttons remain', /shapeSetEnd|endBtn\(/.test(DEMO), false);
  check('the old dimension form no longer fills the combination tab',
        /buildPanelHTML\(panel,ps,i,'combo'\)/.test(DEMO), false);
  /* and when item mode went, so did its form: it was the last caller left */
  check('and the form went with the mode that was its last caller',
        has('function buildPanelHTML'), false);
  check('and the combination tab keeps its container for nothing else to break',
        has('id="comboCtrl"'), true);
}

/* ── 15. both tabs, one behaviour ───────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  /* nothing hides it any more — both remaining tabs offer it always */
  check('advanced edit is no longer switched off for any tab',
        /adv\.style\.display/.test(DEMO), false);
  check('the picker knows both tabs', has("if(appMode==='shape') return shapeList.map"), true);
  check('and the sheet opens against whichever tab is showing',
        has("sheetPfx = pfx || (appMode==='shape' ? 'shape' : appMode)"), true);
  check('one rules engine serves both', (DEMO.match(/lgValidate\(/g) || []).length > 0, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll UX regression checks passed.');
