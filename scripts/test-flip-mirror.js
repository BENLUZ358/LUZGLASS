#!/usr/bin/env node
/**
 * A flip must be a true mirror — the same shape, reflected.
 *
 * Not "some left/right fields swapped". Every side-bearing part has to
 * travel together: the wall brackets, the hinges, the step notch, the
 * handle. Anything that stays behind is not a reflection, it is a
 * different shape that happens to resemble one.
 *
 * The bug this file was written for: the hinges VANISHED on flip. The
 * flip mirrored the glass but not the CONTEXT it was drawn in — the
 * preview always put the wall on the canvas-left. So the brackets, which
 * are derived from the wall, never moved; and the hinges, which did move,
 * landed on the face the wall bracket already held, where the rule "one
 * piece of metal per junction" quite correctly dropped them. The hinge
 * was not lost to a bug. It was dropped by a correct rule applied in an
 * unmirrored context.
 *
 * So this file does not check fields. It renders the shape through the
 * real engine, both ways, and compares what is actually drawn.
 *
 * Run: node scripts/test-flip-mirror.js
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

/* the real thumbnail path, minus the canvas: same conversion, same engine */
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
vm.runInContext('var selQ="zamak"; var DOOR_H_MM=1985; var HANDLE_EDGE_CM=6;' +
  'var TOWEL_SPACING_CM=40; var NOTCH_DEF={notchW:200,notchH:500};' +
  'let shapeBoundary={right:"wall",left:"open"}; let shapeList=[],shapePS={};', ctx);
['mkPS', '_shapePanels', '_lgShowerOf', 'hingeHolesFromEngine'].forEach(n =>
  vm.runInContext(grab(n), ctx));
vm.runInContext(DEMO.match(/const THUMB_BOUNDARY=\{[^}]*\};/)[0], ctx);
vm.runInContext(grab('shapeThumb')
  .replace(/const box=cv[\s\S]*$/, '  return L;\n}')
  .replace('function shapeThumb(cv, entry){', 'function thumbLayout(entry){'), ctx);

const run = e => vm.runInContext(e, ctx);
const seeds = run('lgCatalogSeeds()');

/* Describe what is drawn, in coordinates relative to the glass. A mirror
   is x -> width - x, so the mirrored description of one orientation must
   equal the plain description of the other. */
function describe(L) {
  const g = L.shapes[0];
  const rel = x => Math.round((x - g.x) * 1000 / g.w) / 1000;
  return {
    corners: g.poly.map(p => [rel(p[0]), Math.round((p[1] - g.y) * 1000 / g.h) / 1000]),
    parts: L.hardware.map(h => h.kind + ':' + rel(h.x) + ',' +
      Math.round((h.y - g.y) * 1000 / g.h) / 1000).sort(),
  };
}
function mirrored(d) {
  const flipX = v => Math.round((1 - v) * 1000) / 1000;
  return {
    corners: d.corners.map(p => [flipX(p[0]), p[1]]).sort(),
    parts: d.parts.map(s => {
      const m = s.match(/^(\w+):([-\d.]+),([-\d.]+)$/);
      return m[1] + ':' + flipX(Number(m[2])) + ',' + m[3];
    }).sort(),
  };
}
const sortCorners = d => ({ corners: d.corners.slice().sort(), parts: d.parts });

console.log('');

/* ── every shape mirrors completely ─────────────────────────────────────── */
seeds.forEach(e => {
  ctx.E = e;
  const plain   = describe(run('thumbLayout(E)'));
  const flipped = describe(run('thumbLayout(lgFlipEntry(E))'));

  check(e.name + ': the outline is the mirror of the outline',
        sortCorners(flipped).corners, mirrored(plain).corners);
  check(e.name + ': every part is the mirror of every part',
        flipped.parts, mirrored(plain).parts);
  check(e.name + ': nothing is lost on the way',
        flipped.parts.length, plain.parts.length);
});

/* ── the hinge in particular, because it is what vanished ───────────────── */
{
  const carrier = seeds.find(e => e.add.hingesFor);
  ctx.E = carrier;
  const plain   = run('thumbLayout(E)');
  const flipped = run('thumbLayout(lgFlipEntry(E))');
  const hinges = L => L.hardware.filter(h => h.kind === 'hinge');

  check('a fixed that carries a door shows its hinges', hinges(plain).length, 2);
  check('and still shows them after a flip', hinges(flipped).length, 2);

  /* on the opposite face, not the same one */
  const side = L => {
    const g = L.shapes[0], mid = g.x + g.w / 2;
    return hinges(L).every(h => h.x < mid) ? 'left'
         : hinges(L).every(h => h.x > mid) ? 'right' : 'mixed';
  };
  check('the hinges sit on one face before', side(plain) !== 'mixed', true);
  check('and on the other face after', side(flipped), side(plain) === 'left' ? 'right' : 'left');

  /* the brackets moved too — that was the half of the mirror that was missing */
  const brSide = L => {
    const g = L.shapes[0], mid = g.x + g.w / 2;
    return L.hardware.filter(h => h.kind === 'bracket').every(h => h.x < mid) ? 'left' : 'right';
  };
  check('and the wall brackets crossed with them', brSide(flipped) !== brSide(plain), true);
}

/* ── the step notch travels with the rest ───────────────────────────────── */
{
  const notched = seeds.find(e => e.add.notch);
  ctx.E = notched;
  const plain   = run('thumbLayout(E)');
  const flipped = run('thumbLayout(lgFlipEntry(E))');
  check('the notch is cut on one side', plain.shapes[0].notch.side, 'left');
  check('and on the other after a flip', flipped.shapes[0].notch.side, 'right');
  check('the outline really changes shape, not just a label',
        JSON.stringify(plain.shapes[0].poly) !== JSON.stringify(flipped.shapes[0].poly), true);
  check('with the same number of corners either way',
        flipped.shapes[0].poly.length, plain.shapes[0].poly.length);
}

/* ── flip twice is the original, exactly ────────────────────────────────── */
seeds.forEach(e => {
  ctx.E = e;
  const once  = describe(run('thumbLayout(E)'));
  const twice = describe(run('thumbLayout(lgFlipEntry(lgFlipEntry(E)))'));
  check(e.name + ': flipping twice returns exactly the original', twice, once);
});

/* ── the canvas gets what the preview showed ────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  /* Without a +, there is no context to obey, so what was shown is what is
     taken. With a +, the canvas decides — see test-context-orientation.js. */
  check('picking a card with no context takes the orientation on show',
        has('const e = side ? _legalVariant(e0,side) : galleryShown(i);'), true);
  check('and the context is mirrored with the glass, not left behind',
        has('const bound = entry.flipped'), true);
  check('the declared hinges are measured in that same context',
        has('hingeHolesFromEngine(a.hingesFor,entry.flipped)'), true);
  check('the preview context does not leak from the live canvas',
        has('const THUMB_BOUNDARY='), true);

  /* the rules engine was not touched */
  const SHAPES = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');
  /* "mirror" in the rules engine is a KIND of glass, not a flip. What must
     not appear there is flipping logic. */
  check('no flip logic leaked into the rules engine',
        /lgFlip|_lgOther|flipped/.test(SHAPES), false);
  check('and the engine still knows a mirror as a kind of glass',
        /mirror: 1/.test(SHAPES), true);
}

/* ── the gallery opens from the +, filtered, and closes on choosing ─────── */
/* It used to sit under the canvas the whole time, and a stale filter could
   leave shapes hidden with no way to bring them back. It is a sheet now:
   opened by a +, filtered to that side, closed the moment something is
   chosen — so there is no stale state to get stuck in. */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the + opens the gallery', /function addAt\(side\)\{[\s\S]{0,200}gallerySheet/.test(DEMO), true);
  check('filtered to the side it was pressed on',
        /function addAt\(side\)\{[\s\S]{0,120}renderShapeGallery\(\)/.test(DEMO), true);
  check('and choosing closes it', has('closeGallery();'), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll flip-mirror checks passed.');
