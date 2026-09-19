#!/usr/bin/env node
/**
 * Every declared hole measures from the glass, not the box around it.
 *
 * Ben's report (2026-09-19): the harmonica hinge's bottom hole, 20cm up
 * from the edge, was landing 20cm up from a general baseline instead —
 * wrong the moment the pane was sloped, because its own bottom corner
 * sits higher than that baseline. He asked for the systemic fix, not a
 * patch to this one spot: this bug had already been solved correctly once
 * (the real hinge/bracket junction code has always measured from the
 * true polygon edge), then re-broken by every other place that needed
 * the same conversion and reimplemented it against the bounding box
 * instead — lg-layout.js's declared-hole block, and sketch-demo.html's
 * hingeHolesFromEngine / harmonicaHolesFromEngine, which round-trip a
 * real engine position back into "so many mm from an edge".
 *
 * A second, subtler form of the same mistake lived in those two
 * round-trip helpers: both declared holes were always expressed "from
 * bottom", including the TOP hinge. That number is only correct if the
 * real pane later turns out exactly as tall as the flat probe that
 * computed it — never true once the pane is sloped. The top hinge must
 * be declared from the top, because that is the edge it stays a fixed
 * distance from regardless of how tall the pane ends up.
 *
 * lg-layout.js now exports three small primitives — _lgFaceEdge,
 * _lgYFromFace, _lgMMFromFace, _lgNearestFaceRef — and every place that
 * converts between "mm from an edge" and a real position, in both
 * directions, goes through them. This file is what keeps it that way.
 *
 * Run: node scripts/test-face-edge.js
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

console.log('');

/* ── the primitives themselves ───────────────────────────────────────── */
{
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);

  /* a pane sloped on the bottom: flat top, the right corner higher than
     the left — same shape lgFromPanels builds for slopeSideH:'bottom' */
  const poly = [[0, 0], [800, 0], [800, 200], [0, 400]];
  ctx.poly = poly;

  const left = vm.runInContext('_lgFaceEdge(poly,"left")', ctx);
  const right = vm.runInContext('_lgFaceEdge(poly,"right")', ctx);
  check('the left face edge is the left pair of corners', left, [[0, 0], [0, 400]]);
  check('the right face edge is the right pair, not the bounding box', right, [[800, 0], [800, 200]]);

  ctx.right = right; ctx.sc = 1;
  check('200mm from the right edge\'s own bottom lands at its real corner minus 200',
        vm.runInContext('_lgYFromFace(right,"bottom",200,sc)', ctx), 0);
  check('and 50mm from its top lands 50 down from its real top corner',
        vm.runInContext('_lgYFromFace(right,"top",50,sc)', ctx), 50);
  check('the round trip returns the same mm it was given',
        vm.runInContext('_lgMMFromFace(right,"bottom",50,sc)', ctx), 150);

  /* the point at y=190 sits 10mm above this edge's own bottom (200) and
     190mm below its own top (0) — nearer the bottom, so it must be
     declared from the bottom, never from a baseline neither corner is at */
  check('the nearer-edge picker names the bottom when a point sits near it',
        vm.runInContext('_lgNearestFaceRef(right,190,sc)', ctx), { from: 'bottom', mm: 10 });
  check('and the top when a point sits near that instead',
        vm.runInContext('_lgNearestFaceRef(right,10,sc)', ctx), { from: 'top', mm: 10 });
}

/* ── a declared hole on a sloped pane measures from its own short edge ── */
{
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);

  /* a fixed pane, sloped on the bottom: left edge full height, right edge
     200mm shorter — the exact shape a customer's basin slope produces */
  const P = [{ type: 'fixed', wallSide: 'right', label: '' }];
  const S = { 0: { w: 800, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1800,
                    holes: [{ role: 'bracket-floor', dia: 20,
                              x: { from: 'right', mm: 50 }, y: { from: 'bottom', mm: 200 } }] } };
  ctx.P = P; ctx.S = S;
  const L = vm.runInContext(
    'lgLayout(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}),{canvasW:800})', ctx);

  const g = L.shapes[0], sc = L.scale;
  const rightTop = g.poly[1][1], rightBot = g.poly[2][1];
  check('the sloped right edge really is shorter than the left',
        Math.round((rightBot - rightTop) / sc), 1800);

  const hole = L.hardware.find(h => h.source === 'declared');
  check('the declared hole reaches the drawing', !!hole, true);
  check('and sits 200mm up from the right edge\'s OWN bottom corner, not the general floor',
        Math.round((rightBot - hole.y) / sc), 200);
  check('which is well short of the taller left edge\'s floor line',
        Math.round((g.y + g.h - hole.y) / sc) === 200, false);
}

/* ── the round trip: a real engine position declared back correctly ────── */
{
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set, Map });
  ['lg-shapes.js', 'lg-layout.js', 'lg-catalog.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var selQ="zamak"; var selMM=8; var selG="שקוף"; var selWork=""; var selSupportBar=false, selBlackTrim=false; var appMode="shape"; var DOOR_H_MM=1985;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var NOTCH_DEF={notchW:200,notchH:500};' +
    'const THUMB_BOUNDARY={right:"wall",left:"open"};' +
    'let shapeBoundary={right:"wall",left:"open"};' +
    'let shapeList=[],shapePS={},_shapeSeq=0,flipped={},libFactory=[],libPersonal=[];' +
    'let addSide=null,lastL=null,panelState={},items=[];' +
    'var curCombo={panels:[]};' +
    'let TOAST=null; function shapeToast(m){TOAST=m;}' +
    'var document={getElementById:function(){return null;}};var setTimeout=function(){};' +
    'function renderShapeUI(){} function renderShapeGallery(){} function draw(){}', ctx);
  ['mkPS', 'harmonicaHolesFromEngine', 'hingeHolesFromEngine', '_shapeShower', 'getPS',
   'getPStates', '_shapePanels', '_lgShowerOf', 'galleryEntries', 'entryCanFlip',
   'galleryShown', 'galleryFlip', '_tryArrangement', '_arrangementErrors', '_variantsOf',
   '_stateFromAdd', '_fits', '_bothFit', '_legalVariant', 'allowedAt', '_whyNot', 'canAddAt',
   'addAt', 'closeGallery', 'shapeAdd', 'shapeAddFromCatalog', 'shapeRemove', 'shapeFlipHinge']
    .forEach(n => vm.runInContext(grab(n), ctx));
  const run = e => vm.runInContext(e, ctx);

  const idx = run('galleryEntries().findIndex(function(e){' +
    'return e.name==="דלת צירים+הרמוניקה עם שיפוע";})');
  run('addSide="right"; addAt("right"); shapeAddFromCatalog(' + idx + ');');

  const holes = run('shapePS.sh1.holes');
  const top = holes.find(h => h.y.from === 'top'), bot = holes.find(h => h.y.from === 'bottom');
  /* each hinge is declared from the edge it is actually anchored to — not
     both "from bottom" against a flat 1985mm probe that this sloped door
     never actually is */
  check('the harmonica\'s top hinge is declared from the top, at 200',
        top && [top.y.from, top.y.mm], ['top', 200]);
  check('and the bottom one from the bottom, also at 200',
        bot && [bot.y.from, bot.y.mm], ['bottom', 200]);
  /* the real hinge junction sits ON the seam (inset 0) — that is the
     pivot, not where the holes are drilled. A declared hole that copied
     that distance verbatim landed the hinge right against the edge, with
     no visible gap at all (Ben, 2026-09-19). The 36mm belongs to the
     drilled hole itself, the same constant the real symbol is drawn
     with — never a distance read off the engine's own hinge position. */
  check('and both sit the fixed 3.6cm drilling inset from the seam, not the ~0 the hinge itself sits at',
        [top && top.x.mm, bot && bot.x.mm], [36, 36]);

  const L = run('lgLayout(_lgShowerOf(_shapePanels(),{0:shapePS.sh1}),{canvasW:900})');
  const g = L.shapes[0], sc = L.scale;
  const rightTop = g.poly[1][1], rightBot = g.poly[2][1];
  check('the door really is sloped on the harmonica side',
        Math.round((rightBot - rightTop) / sc) < 1985, true);

  const dh = L.hardware.filter(h => h.variant === 'harmonica' && h.source === 'declared');
  const mmFromTop = y => Math.round((y - rightTop) / sc);
  const mmFromBot = y => Math.round((rightBot - y) / sc);
  const nearTop = dh.find(h => mmFromTop(h.y) < mmFromBot(h.y));
  const nearBot = dh.find(h => h !== nearTop);
  check('drawn on the real sloped door, the top hole still sits 200 from its own top corner',
        nearTop && mmFromTop(nearTop.y), 200);
  check('and the bottom hole 200 from its own bottom corner',
        nearBot && mmFromBot(nearBot.y), 200);
  const right = g.x + g.w;
  check('and both are drawn 36mm in from the seam, not sitting on it',
        dh.map(h => Math.round((right - h.x) / sc)).sort((a, b) => a - b), [36, 36]);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll face-edge checks passed.');
