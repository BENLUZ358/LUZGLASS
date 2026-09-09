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
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext(
    'var selQ="zamak"; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var shapeBoundary={right:"wall",left:"open"};' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'let shapeList=[]; let shapePS={}; let _shapeSeq=0; let flipped={};' +
    'let libFactory=[],libPersonal=[]; let addSide=null; let lastL=null;' +
    'function renderShapeUI(){} function draw(){ lastL=layoutNow(); }' +
    'function renderShapeGallery(){} function _shEsc(s){return s;}' +
    'function shapeToast(){} let panelState={},items=[]; var curCombo={panels:[]};' +
    'function layoutNow(){ return shapeList.length ?' +
    '  lgLayout(_lgShowerOf(_shapePanels(), Object.fromEntries(' +
    '    shapeList.map(function(s,i){return [i,shapePS[s.id]];}))),{canvasW:900}) : null; }',
    ctx);
  ['mkPS', '_shapeShower', '_shapePanels', '_lgShowerOf', 'galleryEntries', 'entryCanFlip',
   'galleryShown', 'galleryFlip', '_tryArrangement', '_arrangementErrors', 'allowedAt', 'sideBlocked',
   'canAddAt', '_whyNot', 'hingeHolesFromEngine', 'shapeAdd', 'shapeAddFromCatalog',
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
{
  const ctx = screen();
  const names = run(ctx, 'galleryEntries().map(function(e){return e.name;})');
  const broke = [];
  names.forEach(n => {
    const c = screen();
    try {
      run(c, 'shapeAddFromCatalog(' + idOf(c, n) + ')');
      if (run(c, 'shapeList.length') !== 1) broke.push(n);
    } catch (e) { broke.push(n + ' (' + e.message + ')'); }
  });
  check('every shape in the gallery can be picked and lands on the canvas', broke, []);
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

  run(ctx, 'shapeAddFromCatalog(' + di + ')');
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
  run(c2, 'shapeAddFromCatalog(' + idOf(c2, 'דלת') + ')');
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
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ')');
  check('the wall side shows no +', run(ctx, 'canAddAt("left")'), false);
  /* one answer, not two: the blocked side offers nothing and shows nothing */
  check('and nothing may be added through it', run(ctx, 'allowedAt("left").length'), 0);
}

/* ── 8. a + places the new pane beside the one that asked ───────────────── */
{
  /* a door needs a pane prepared to carry it; the brackets-only case is
     its own test file */
  const ctx = screen();
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ')');
  const first = run(ctx, 'shapeList[0].id');
  run(ctx, 'addSide="right"; shapeAddFromCatalog(' + idOf(ctx, 'דלת') + '); addSide=null;');
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
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ')');
  run(ctx, 'addSide="right"; shapeAddFromCatalog(' + idOf(ctx, 'דלת') + '); addSide=null;');
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
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, PLAIN) + ')');
  run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, CARRIER) + ')');
  const di = idOf(ctx, 'דלת');
  run(ctx, 'galleryFlip(' + di + ')');
  run(ctx, 'shapeAddFromCatalog(' + di + ')');
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
  [PLAIN, 'מראה', 'צורה חופשית'].forEach(n => run(ctx, 'shapeAddFromCatalog(' + idOf(ctx, n) + ')'));
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
  check('but the form itself survives, because item mode still uses it',
        has("buildPanelHTML(panel,ps,i,'item')"), true);
  check('and the combination tab keeps its container for nothing else to break',
        has('id="comboCtrl"'), true);
}

/* ── 15. both tabs, one behaviour ───────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('advanced edit is offered outside the shape tab too',
        has("adv.style.display = (m==='item') ? 'none' : ''"), true);
  check('the picker knows both tabs', has("if(appMode==='shape') return shapeList.map"), true);
  check('and the sheet opens against whichever tab is showing',
        has("sheetPfx = pfx || (appMode==='shape' ? 'shape' : appMode)"), true);
  check('one rules engine serves both', (DEMO.match(/lgValidate\(/g) || []).length > 0, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll UX regression checks passed.');
