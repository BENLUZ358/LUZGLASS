#!/usr/bin/env node
/**
 * Tests the shape catalogue.
 *
 * The catalogue does NOT define shapes. It gives a name and an id to what
 * the screen already knows how to build — the same kind, hinge side and
 * slope flag shapeAdd has always taken. The glass, the hardware and the
 * dimensions all come from lg-shapes.js and lg-layout.js.
 *
 * That is the whole point of this file. The first version described every
 * shape again in its own words — how many brackets, on which face, at what
 * distance — and it immediately produced doors whose handle and hinge sat
 * on the same side, and fixed panes with four brackets for no reason. Two
 * sources of truth for one fact always drift apart. This file exists to
 * keep there being one.
 *
 * Run: node scripts/test-catalog.js
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

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const run = (expr, vars) => {
  Object.keys(vars || {}).forEach(k => { ctx[k] = vars[k]; });
  return vm.runInContext(expr, ctx);
};
const seeds = run('lgCatalogSeeds()');

console.log('');

/* ── every shipped shape survives its own validator ─────────────────────── */
{
  const bad = seeds.filter(e => run('lgCatalogValidate(E)', { E: e }).length);
  check('every seed passes validation', bad.map(e => e.id), []);
  check('and there are no duplicate ids', seeds.length, new Set(seeds.map(e => e.id)).size);
  check('each seed names itself in Hebrew', seeds.every(e => e.name && e.name.trim()), true);
}

/* ── the catalogue describes nothing the engine already knows ───────────── */
/* If an entry ever grows a field that says where a bracket goes, or how
   many, the catalogue has started describing shapes again — and the drift
   that produced handles on the hinge side is back. */
{
  const ALLOWED_ENTRY = ['id', 'name', 'origin', 'add'];
  const ALLOWED_ADD   = ['kind', 'hingeSide', 'slope', 'notch', 'hingesFor',
                         'notchSide', 'slopeSideV', 'holes'];
  const strayEntry = seeds.flatMap(e => Object.keys(e).filter(k => !ALLOWED_ENTRY.includes(k)));
  const strayAdd   = seeds.flatMap(e => Object.keys(e.add).filter(k => !ALLOWED_ADD.includes(k)));
  check('an entry carries only a name and what to add', strayEntry, []);
  check('and never says where hardware goes or how much of it', strayAdd, []);
  /* hingesFor names WHICH SIDE THE DOOR IS ON — a fact about the assembly.
     Where the hinges then land is measured from the engine, never written
     here. An entry that spelled out a position would be the old mistake. */
  check('a side is named, never a hole position',
        seeds.every(e => !e.add.hingesFor ||
                    e.add.hingesFor === 'left' || e.add.hingesFor === 'right'), true);
}

/* ── the seeds are exactly what the screen already offered ──────────────── */
/* The gallery replaced text chips. It must not have quietly replaced the
   shapes too. */
{
  const kinds = seeds.map(e => [e.add.kind, e.add.hingeSide || '', e.add.slope ? 'slope' : ''].join('|'));
  check('and adds the step notch we already built', seeds.some(e => e.add.notch), true);
  check('the catalogue keeps every kind the chips offered',
        [...new Set(kinds.map(k => k.split('|')[0]))].sort(),
        ['door', 'fixed', 'mirror', 'shape']);
  /* One door. The other hand is a flip of this definition, not a second
     row — two rows were two definitions of one thing. */
  check('there is exactly one door',
        kinds.filter(k => k.startsWith('door')).length, 1);
  check('and flipping it gives the other hand',
        run('lgFlipAdd(E).hingeSide', { E: seeds.find(e => e.add.kind === 'door').add }),
        seeds.find(e => e.add.kind === 'door').add.hingeSide === 'right' ? 'left' : 'right');
  check('and the sloped fixed', kinds.includes('fixed||slope'), true);
}

/* ── the picture is painted by the drawer, not described again ──────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the thumbnail runs the engine, not a second geometry',
        has('lgLayout(_lgShowerOf(_shapePanels()'), true);
  check('through the same panel conversion the canvas uses',
        has('_shapePanels()') && has('_lgShowerOf('), true);
  check('and is painted by engPaint itself', has("engPaint({...L, dims:[]},'thumb'"), true);
  check('the drawing context is swappable, so there is one painter',
        /let cx=C\.getContext/.test(DEMO), true);
  check('and it is put back afterwards', has('cx=saveCx'), true);
  check('touch targets are not polluted by a thumbnail', has('dimHits=saveHits'), true);

  /* the gallery must not have kept a hand-written list of chips */
  check('the gallery is generated from the catalogue',
        has('id="shapeGallery"') && has('renderShapeGallery'), true);
  check('and no hand-written chip survives', /class="shape-chip"/.test(DEMO), false);
  check('picking a card is a 44px target', /\.sc-pick\{[^}]*min-height:44px/.test(DEMO), true);
  check('and flipping it is too', /\.sc-flip\{[^}]*min-height:44px/.test(DEMO), true);
  check('the catalogue is loaded by the page', has('src="lg-catalog.js"'), true);
}

/* ── the engine still decides the hardware ──────────────────────────────── */
/* A door's handle and its hinge are derived from the SAME rule, so they
   cannot land on the same face. This is what broke when the catalogue
   wrote the hinge side by hand. */
{
  const doorFor = hingeSide => {
    /* the same inversion _shapePanels applies, kept in one place there */
    const s = { id: 'd', kind: 'door', w: 800, h: 1985, hingeSide };
    return run('lgLayout({boundary:{right:"wall",left:"wall"},finish:"shahor",' +
               'quality:"zamak",shapes:[S]},{canvasW:400})', { S: s });
  };
  ['left', 'right'].forEach(side => {
    const L = doorFor(side);
    const g = L.shapes[0];
    const handle = L.hardware.find(h => h.role === 'handle');
    const hinge  = L.hardware.find(h => h.kind === 'hinge');
    if (!handle || !hinge) { failed++; console.error('FAIL  door(' + side + ') lost its hardware'); return; }
    const mid = g.x + g.w / 2;
    const sameSide = (handle.x < mid) === (hinge.x < mid);
    check('a door hinged ' + side + ' puts its handle on the other face', sameSide, false);
  });
}

/* ── a flag is a shortcut to state the screen already has ───────────────── */
/* The notch is not a new definition. The property sheet has written
   {notchW:200, notchH:500} since it was built, and the gallery must use
   THOSE numbers — two constants with one meaning always drift. */
{
  check('the notch default lives in one place',
        (DEMO.match(/notchW:\s*200/g) || []).length, 1);
  check('the property sheet reads it',
        DEMO.indexOf('notch') > -1 && DEMO.indexOf(',this.checked,NOTCH_DEF)') > -1, true);
  check('and so does the gallery', DEMO.indexOf('Object.assign({},NOTCH_DEF)') > -1, true);
  check('the thumbnail uses it too', DEMO.indexOf('Object.assign(st,NOTCH_DEF)') > -1, true);

  /* an unrecognised flag must be refused, not silently ignored — otherwise
     the shape opens without what the picture promised */
  check('an unknown flag is refused',
        run('lgCatalogValidate(E)', { E: { id: 'x', name: 'x', add: { kind: 'fixed', magic: true } } }).length > 0, true);
}

/* ── the card keeps hardware legible at card size ───────────────────────── */
/* The painter floors a hole at 3px so it never vanishes. The card then
   shrank the whole drawing fourfold, which shrank the floor with it — and
   the brackets disappeared while the hinge, drawn at a fixed pixel size,
   survived. The floor travels with the scale now. */
{
  check('the painter takes a legibility floor', /function engHardware\(h,sc,min\)/.test(DEMO), true);
  check('the canvas keeps the floor it always had', /const floor = min \|\| 3/.test(DEMO), true);
  check('and the card raises it by the amount it shrinks',
        DEMO.indexOf('{hwMin:3/k}') > -1, true);
  check('the hinge scales with the same floor, not a fixed pixel size',
        /const w=24\*mul, hh=16\*mul/.test(DEMO), true);
}

/* ── a fixed that carries a door ────────────────────────────────────────── */
/* The hinges on such a pane are not written down anywhere. The screen
   builds the assembly for a moment — the fixed with a door leaning on it —
   and asks the engine WHERE IT PUT THE HINGES. The side is measured, not
   chosen, which is why it cannot contradict the engine. Writing it by hand
   is what produced doors whose handle and hinge sat on the same face. */
{
  const grab = n => {
    const i = DEMO.indexOf('function ' + n + '(');
    if (i < 0) throw new Error('missing ' + n);
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const c = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c));
  vm.runInContext('let shapeList=[],shapePS={};var selQ="zamak";' +
    'var shapeBoundary={right:"wall",left:"open"};var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6;var TOWEL_SPACING_CM=40;', c);
  ['mkPS', '_shapePanels', '_lgShowerOf', 'hingeHolesFromEngine'].forEach(n =>
    vm.runInContext(grab(n), c));

  const holesFor = side => vm.runInContext('hingeHolesFromEngine(' + JSON.stringify(side) + ')', c);

  ['right', 'left'].forEach(side => {
    const h = holesFor(side);
    check('a door on the ' + side + ' gives the fixed two hinges', h.length, 2);
    check('both on the face the door leans against',
          h.every(x => x.x.from === side && x.x.mm === 0), true);
  });

  /* The bottom hinge is 215 from the fixed and 200 from the door: the door
     hangs from the head and the fixed stands on the floor, so the same
     piece of metal is a different number on each pane. That rule was
     settled long before this gallery, and the engine still holds it. */
  {
    const ys = holesFor('right').map(x => x.y.mm).sort((a, b) => a - b);
    check('the bottom hinge sits 215 up the fixed, not 200', ys[0], 215);
    check('and the top one 200 down from its head', 2000 - ys[1], 200);
  }

  /* and the two sides are mirror images */
  check('the two directions mirror each other',
        holesFor('right').map(x => x.y.mm), holesFor('left').map(x => x.y.mm));

  /* the holes really reach the drawing — lgFromPanels used to drop them */
  {
    const P = [{ type: 'fixed', wallSide: 'right', label: '' }];
    const S = { 0: { w: 500, h: 2000, holes: holesFor('right') } };
    const L = vm.runInContext('lgLayout(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}),{canvasW:400})',
      Object.assign(c, (c.P = P, c.S = S, c)));
    const declared = L.hardware.filter(x => x.source === 'declared');
    check('a carried hinge survives the trip from the screen to the drawing',
          declared.length, 2);
    check('and is drawn as a hinge', declared.every(x => x.kind === 'hinge'), true);
  }

  /* a malformed hole must be dropped, not drawn at zero */
  {
    const P = [{ type: 'fixed', wallSide: 'right', label: '' }];
    const S = { 0: { w: 500, h: 2000, holes: [{ role: 'hinge' }, null, { role: 'hinge', x: {}, y: {} }] } };
    c.P = P; c.S = S;
    const L = vm.runInContext('lgLayout(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}),{canvasW:400})', c);
    check('a hole with no position is dropped rather than drawn at the corner',
          L.hardware.filter(x => x.source === 'declared').length, 0);
  }
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll catalogue checks passed.');
