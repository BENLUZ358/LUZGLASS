#!/usr/bin/env node
/**
 * Tests the build direction.
 *
 * A real shower is built from a wall outwards, in one direction. Someone
 * who starts from the middle discovers the mistake when the glass is
 * already cut. So the direction is declared before the first pane, not
 * inferred afterwards, and the strip says which end the next pane lands on.
 *
 * Run: node scripts/test-build-dir.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEMO = fs.readFileSync(path.join(__dirname, '..', 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* run the real shapeAdd against a stub, so the test cannot drift from source */
function grab(name) {
  const i = DEMO.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
}

function adder(dir) {
  const ctx = vm.createContext({
    mkPS: () => ({}),
    renderShapeUI: () => {},
    draw: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null },
  });
  vm.runInContext('let shapeList=[]; let shapePS={}; let _shapeSeq=0; let buildDir=' +
    JSON.stringify(dir) + ';', ctx);
  vm.runInContext(grab('shapeAdd'), ctx);
  return {
    add: (k, h) => vm.runInContext(`shapeAdd(${JSON.stringify(k)},${JSON.stringify(h||null)})`, ctx),
    order: () => vm.runInContext('shapeList.map(s=>s.label)', ctx),
  };
}

console.log('');

/* Where a pane LANDS is decided by the engine, not by the array. Index
   grows with x, so the end of the array is the RIGHT of the canvas — and
   asserting on array order alone would have hidden the direction being
   backwards, which is exactly what happened. */
function places(dir, kinds) {
  const a = adder(dir);
  kinds.forEach(k => a.add(k));
  const shapes = a.order().map((label, i) => ({ id: 'p' + i, kind: 'fixed', w: 400, h: 2000, label }));
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  ctx.S = shapes;
  const L = vm.runInContext('lgLayout({boundary:{right:"wall",left:"wall"},' +
    'finish:"shahor",quality:"zamak",shapes:S},{canvasW:900})', ctx);
  return L.shapes.slice().sort((p, q) => p.x - q.x).map(p => shapes[p.idx].label);
}

/* ── right to left: the first pane sits rightmost ───────────────────────── */
{
  const a = adder('rtl');
  a.add('fixed'); a.add('door', 'right'); a.add('mirror');
  check('a right-to-left build puts the newest pane leftmost on the canvas',
        places('rtl', ['fixed', 'door', 'mirror']), ['מראה', 'דלת', 'קבוע']);
  check('so the first pane chosen ends up on the right',
        places('rtl', ['fixed', 'door', 'mirror']).slice(-1)[0], 'קבוע');
}

/* ── left to right: the mirror image ────────────────────────────────────── */
{
  check('a left-to-right build puts the newest pane rightmost',
        places('ltr', ['fixed', 'door', 'mirror']), ['קבוע', 'דלת', 'מראה']);
}

/* the two directions really are mirror images of each other */
{
  const k = ['fixed', 'door', 'mirror', 'shape'];
  check('and one arrangement is the reverse of the other',
        places('rtl', k), places('ltr', k).slice().reverse());
}

/* ── it is declared, remembered, and shown ──────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the direction is chosen before building', has('id="bdRtl"') && has('id="bdLtr"'), true);
  check('right-to-left is the default', /buildDir[\s\S]{0,120}==='ltr' \? 'ltr' : 'rtl'/.test(DEMO), true);
  check('the choice is remembered', has("localStorage.setItem('lgBuildDir'"), true);
  check('each control is a 44px target', /\.bd-seg button\{[^}]*min-height:44px/.test(DEMO), true);
  check('the chosen direction is marked', has("'on' : ''"), true);
  check('the strip names the end the next pane lands on', has('הבאה כאן'), true);
  check('and that end follows the direction', has("buildDir==='rtl' ? 'left' : 'right'"), true);
  check('the marking is redrawn with the strip',
        /function renderShapeUI\(\)\{\s*renderBuildDir\(\);/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll build-direction checks passed.');
