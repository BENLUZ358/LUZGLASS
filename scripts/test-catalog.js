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
  const ALLOWED_ADD   = ['kind', 'hingeSide', 'slope'];
  const strayEntry = seeds.flatMap(e => Object.keys(e).filter(k => !ALLOWED_ENTRY.includes(k)));
  const strayAdd   = seeds.flatMap(e => Object.keys(e.add).filter(k => !ALLOWED_ADD.includes(k)));
  check('an entry carries only a name and what to add', strayEntry, []);
  check('and never says where hardware goes or how much of it', strayAdd, []);
}

/* ── the seeds are exactly what the screen already offered ──────────────── */
/* The gallery replaced text chips. It must not have quietly replaced the
   shapes too. */
{
  const kinds = seeds.map(e => [e.add.kind, e.add.hingeSide || '', e.add.slope ? 'slope' : ''].join('|'));
  check('the catalogue offers the six the chips offered', kinds, [
    'fixed||', 'fixed||slope', 'door|right|', 'door|left|', 'mirror||', 'shape||',
  ]);
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
  check('every card is a 44px target', /\.shape-card\{[^}]*min-height:44px/.test(DEMO), true);
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

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll catalogue checks passed.');
