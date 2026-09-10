#!/usr/bin/env node
/**
 * There is one way in, and it goes through the rules.
 *
 * The rules were never wrong and the `+` was never wrong. What was wrong is
 * that the `+` was not the only way in. Clicking a card in the gallery
 * without pressing `+` left addSide null, and one line decided everything:
 *
 *     const e = side ? _legalVariant(e0,side) : galleryShown(i);
 *
 * With no side there was no check at all — the whole Shape→Shape chain
 * (_legalVariant → _variantsOf → _fits → _tryArrangement → lgValidate) was
 * skipped, and the glass went onto the end of the array blind. That is how
 * a door came to hang on a door.
 *
 * The check now lives in shapeAdd, which every caller passes through, and
 * a direct click enters at the right-hand end exactly as a `+` would. This
 * file sweeps every way in and demands that none of them can build what
 * the rules forbid — not the gallery, not the `+`, not the hinge flip.
 *
 * Run: node scripts/test-one-gate.js
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
  const bnd = (DEMO.match(/let shapeBoundary=(\{[^}]*\});/) || [, '{right:"wall",left:"open"}'])[1];
  vm.runInContext('var selQ="zamak"; var selMM=8; var selG="שקוף"; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'const THUMB_BOUNDARY={right:"wall",left:"open"};' +
    'let shapeBoundary=' + bnd + ';' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null,panelState={},items=[];var curCombo={panels:[]};' +
    'let TOAST=null; function shapeToast(m){TOAST=m;}' +
    'var document={getElementById:function(){return null;}};var setTimeout=function(){};var document={getElementById:function(){return null;}};var setTimeout=function(){};function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', 'getPS', 'getPStates', '_shapePanels', '_lgShowerOf', '_shapeShower',
   'galleryEntries', 'entryCanFlip', 'galleryShown', 'galleryFlip', '_tryArrangement',
   '_arrangementErrors', '_variantsOf', '_stateFromAdd', '_fits', '_bothFit',
   '_legalVariant', 'allowedAt', '_whyNot', 'canAddAt', 'hingeHolesFromEngine',
   'addAt', 'closeGallery', 'shapeAdd', 'shapeAddFromCatalog', 'shapeRemove',
   'shapeFlipHinge'].forEach(n => vm.runInContext(grab(n), ctx));
  return ctx;
}
const run = (c, e) => vm.runInContext(e, c);
const NAMES = c => run(c, 'galleryEntries().map(function(e){return e.name;})');
const ERRS = c => run(c, 'lgValidate(_shapeShower()).map(function(e){return e.msg;})');
const idOf = (c, n) => NAMES(c).indexOf(n);

console.log('');

const CARDS = NAMES(screen());

/* Every way a person can put glass on the canvas. Each is swept over every
   pair of shapes, in both orientations. */
const WAYS = [
  ['pressing +', (c, i) => run(c, 'addAt("right"); shapeAddFromCatalog(' + i + '); addSide=null;')],
  ['clicking a card', (c, i) => run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + i + ');')],
  ['clicking, then flipping a hinge', (c, i) => {
    run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + i + ');');
    run(c, 'shapeList.forEach(function(s){ if(s.kind==="door") shapeFlipHinge(s.id); })');
  }],
  ['calling shapeAdd straight', (c, i) => {
    const a = run(c, 'galleryEntries()[' + i + '].add');
    run(c, 'shapeAdd(' + JSON.stringify(a.kind) + ',' + JSON.stringify(a.hingeSide || null) +
           ',' + (a.slope ? 'true' : 'false') + ',_stateFromAdd(galleryEntries()[' + i + '].add))');
  }],
];

WAYS.forEach(([label, act]) => {
  const built = [];
  const illegal = [];
  CARDS.forEach((a, ai) => CARDS.forEach((b, bi) => [false, true].forEach(flip => {
    const c = screen();
    run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + ai + ');');
    if (flip) run(c, 'galleryFlip(' + bi + ')');
    const before = run(c, 'shapeList.length');
    act(c, bi);
    if (run(c, 'shapeList.length') <= before) return;   /* refused — fine */
    built.push(1);
    const e = ERRS(c);
    if (e.length) illegal.push(a + ' + ' + b + (flip ? ' [flipped]' : '') + ' → ' + e[0]);
  })));
  check(label + ': nothing illegal can be built', illegal, []);
  check('  and it still builds what is legal', built.length > 0, true);
});

/* ── chains, not just pairs ─────────────────────────────────────────────── */
{
  const illegal = [];
  let built = 0;
  CARDS.forEach((a, ai) => CARDS.forEach((b, bi) => CARDS.forEach((d, ci) => {
    const c = screen();
    [ai, bi, ci].forEach(i => run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + i + ');'));
    if (run(c, 'shapeList.length') < 2) return;
    built++;
    const e = ERRS(c);
    if (e.length) illegal.push([a, b, d].join(' → ') + ' : ' + e[0]);
  })));
  check('a chain built by clicking cards is never illegal', illegal.slice(0, 5), []);
  check('  and plenty of chains do get built', built > 100, true);
}

/* ── the case from the photograph, exactly ──────────────────────────────── */
{
  const c = screen();
  const di = idOf(c, 'דלת');
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + di + ');');
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + di + ');');     /* a plain click, no + */

  check('a second door added by clicking is allowed in', run(c, 'shapeList.length'), 2);
  check('but only in the orientation that works',
        run(c, 'shapeList.map(function(s){return s.hingeSide;})'), ['right', 'left']);
  check('so the two meet handle to handle, which the rules permit',
        run(c, 'lgJunctions(_shapeShower()).map(function(j){return j.type;})'),
        ['hinge-wall', null, 'hinge-wall']);
  check('and nothing is wrong with it', ERRS(c), []);

  /* the arrangement in the photograph is the one that is now unreachable */
  const c2 = screen();
  run(c2, 'shapeList=[{id:"a",kind:"door",hingeSide:"right"},' +
          '{id:"b",kind:"door",hingeSide:"right"}]');
  check('while door-on-door is still what the engine calls it',
        ERRS(c2), ['דלת לא יכולה להיתלות על דלת']);
}

/* ── the gate redirects where it can, and refuses where it cannot ──────── */
{
  /* Free glass cannot CARRY a door — but a door beside it, hinged the other
     way onto its own wall, is fine. The gate finds that orientation rather
     than refusing outright. */
  const c = screen();
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, 'מראה') + ');');
  run(c, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c, 'דלת') + ');');
  check('a door beside free glass is allowed in', run(c, 'shapeList.length'), 2);
  check('hinged away from it, onto its own wall',
        run(c, 'lgJunctions(_shapeShower()).map(function(j){return j.type;})'),
        [null, null, 'hinge-wall']);
  check('so nothing hangs on the free glass', ERRS(c), []);

  /* and hanging it ON the free glass is still what the engine forbids */
  const c2 = screen();
  run(c2, 'shapeList=[{id:"a",kind:"mirror"},{id:"b",kind:"door",hingeSide:"right"}]');
  check('while a door hung on free glass is still refused',
        ERRS(c2), ['דלת לא יכולה להיתלות על זכוכית חופשית — נדרש קבוע או קיר']);

  /* a step with no legal orientation at all leaves the canvas untouched */
  const c3 = screen();
  run(c3, 'addSide="right"');
  ['קבוע · זוויות בלבד', 'מראה', 'קבוע נושא דלת'].forEach(n =>
    run(c3, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c3, n) + ');'));
  run(c3, 'addSide=null');
  const before = JSON.parse(JSON.stringify(run(c3, 'shapeList')));
  run(c3, 'addAt(\"right\"); shapeAddFromCatalog(' + idOf(c3, 'דלת') + ');');
  check('a step with no legal orientation is refused',
        JSON.parse(JSON.stringify(run(c3, 'shapeList'))), before);
  check('and the reason comes from the engine, in its own words',
        String(run(c3, 'TOAST')).indexOf('להישען') > -1, true);
  check('what stayed on the canvas is legal', ERRS(c3), []);
}

/* ── the gate is where every caller passes ──────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  const body = n => {
    const i = DEMO.indexOf('function ' + n + '(');
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  check('shapeAdd checks before it commits',
        /_arrangementErrors\(cand/.test(body('shapeAdd')), true);
  check('and refuses instead of building', /return false;/.test(body('shapeAdd')), true);
  check('flipping a hinge checks too',
        /_arrangementErrors\(cand/.test(body('shapeFlipHinge')), true);
  /* there is no click-to-add any more: the gallery opens from a + and the
     side it was pressed on is what makes the question answerable */
  check('there is no adding without a side',
        has('const side=addSide;') && has('if(!side) return;'), true);
  check('and the gallery is only reachable from a +',
        /function addAt\(side\)\{[\s\S]{0,200}gallerySheet/.test(DEMO), true);
  check('and no caller reaches the canvas around it',
        /shapeList\.(push|unshift)\(/.test(
          DEMO.replace(body('shapeAdd'), '')), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll one-gate checks passed.');
