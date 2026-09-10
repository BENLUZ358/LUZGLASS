#!/usr/bin/env node
/**
 * A shared hinge must stay one hinge, edited from either pane.
 *
 * The hinge is a single piece of metal passing through two glasses. The
 * door hangs from the head and the fixed stands on the floor, so their
 * bottoms are fifteen millimetres apart — and the same bolt reads 330 on
 * the door and 345 on the fixed. Both numbers are true; they are measured
 * from different edges.
 *
 * The engine listens to the door alone. So editing from the door moved
 * both numbers, and editing from the fixed fell into a hole and did
 * nothing at all. This file exists to keep both directions working.
 *
 * The conversion is deliberately NOT recomputed here or in the editor. The
 * engine writes each number as (that pane's bottom − the hinge's height),
 * so the difference between the two numbers is exactly the difference
 * between the two bottoms — read off the layout. A parallel calculation
 * would drift the day someone changes the engine.
 *
 * Run: node scripts/test-shared-hinge.js
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

/* a door beside a fixed, the arrangement in the photograph */
function bench() {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  vm.runInContext('var lastL=null; var DOOR_H_MM=1985; var selQ="zamak"; var selMM=8; var selG="שקוף"; var selWork=""; var selSupportBar=false, selBlackTrim=false;' +
    'var HANDLE_EDGE_CM=6; var TOWEL_SPACING_CM=40;' +
    'var shapeBoundary={right:"wall",left:"open"};' +
    'let shapeList=[],shapePS={};', ctx);
  vm.runInContext(DEMO.match(/const DIM_FIELDS\s*=\s*\{[\s\S]*?\n\};/)[0], ctx);
  ['mkPS', '_lgShowerOf', '_hingePartner', '_dimWrite'].forEach(n =>
    vm.runInContext(grab(n), ctx));

  /* the panel pair: a door hinged onto the fixed that follows it */
  const panels = [
    { type: 'door',  wallSide: 'right', label: '', hingeSide: 'left',
      handleSide: 'right', hingeOnFixed: 'next' },
    { type: 'fixed', wallSide: 'left',  label: '' },
  ];
  const states = { 0: vm.runInContext('mkPS({type:"door"})', ctx),
                   1: vm.runInContext('mkPS({type:"fixed"})', ctx) };
  ctx.P = panels; ctx.S = states;
  ctx.getPS = (pfx, i) => states[i];

  const relayout = () => vm.runInContext(
    'lastL = lgLayout(_lgShowerOf(P,S),{canvasW:900})', ctx);
  relayout();

  /* the two numbers the engine writes for the shared hinge */
  const numbers = () => {
    const L = ctx.lastL;
    const pick = kind => L.dims.filter(d => d.kind === kind)
      .map(d => ({ idx: d.idx, mm: Number(d.text) }));
    return { top: pick('hinge-top'), bot: pick('hinge-bot') };
  };

  return { ctx, relayout, numbers,
           write: (idx, field, mm) =>
             vm.runInContext(`_dimWrite({pfx:'combo',idx:${idx},field:'${field}'},${mm})`, ctx),
           state: states };
}

console.log('');

/* ── the starting point: one hinge, two true numbers ────────────────────── */
{
  const b = bench();
  const n = b.numbers();
  check('the shared hinge is written on both panes, top and bottom',
        [n.top.length, n.bot.length], [2, 2]);
  const bots = n.bot.map(x => x.mm).sort((a, b2) => a - b2);
  check('and the two bottom numbers differ by the floor gap',
        bots[1] - bots[0], 15);
  const tops = n.top.map(x => x.mm);
  check('while the tops agree, because both hang from the same head',
        tops[0], tops[1]);
}

/* ── editing from the door: worked before, must keep working ────────────── */
{
  const b = bench();
  b.write(0, 'hingeBot', 300);
  b.relayout();
  const bots = b.numbers().bot.map(x => x.mm).sort((a, b2) => a - b2);
  check('editing the door moves its own number', bots[0], 300);
  check('and the fixed follows, fifteen higher', bots[1], 315);
}

/* ── editing from the fixed: the case that did nothing ──────────────────── */
{
  const b = bench();
  b.write(1, 'hingeBot', 400);
  b.relayout();
  const bots = b.numbers().bot.map(x => x.mm).sort((a, b2) => a - b2);
  check('editing the fixed moves the hinge at all', bots.includes(400), true);
  check('to exactly what was typed on the pane it was typed on', bots[1], 400);
  check('and the door follows, fifteen lower', bots[0], 385);
}

/* ── and the top, from either side ──────────────────────────────────────── */
{
  const fromDoor = bench(); fromDoor.write(0, 'hingeTop', 250); fromDoor.relayout();
  const fromFixed = bench(); fromFixed.write(1, 'hingeTop', 250); fromFixed.relayout();
  check('the top edits the same from the door', fromDoor.numbers().top.map(x => x.mm), [250, 250]);
  check('and the same from the fixed', fromFixed.numbers().top.map(x => x.mm), [250, 250]);
}

/* ── a hinge with no partner must not throw ─────────────────────────────── */
/* A door hinged to a wall has no second pane. Writing must still work. */
{
  const b = bench();
  b.ctx.P = [{ type: 'door', wallSide: 'both', label: '', hingeSide: 'left',
               handleSide: 'right' }];
  b.ctx.S = { 0: b.state[0] };
  b.relayout();
  let threw = false;
  try { b.write(0, 'hingeBot', 260); } catch (e) { threw = true; }
  check('a door hinged to a wall still accepts an edit', threw, false);
  check('and the number lands on it', b.state[0].hingeBot, 260);
}

/* ── the conversion is read from the engine, not recomputed ─────────────── */
{
  check('the editor reads the panes out of the last layout',
        DEMO.indexOf('function _hingePartner(') > -1, true);
  check('and the shift comes from their bottoms, not a constant',
        /\(\(other\.y\+other\.h\)-\(me\.y\+me\.h\)\)\/sc/.test(DEMO), true);
  check('no fifteen is hard-coded into the editor',
        /hingeBot[\s\S]{0,400}\b15\b/.test(DEMO.slice(DEMO.indexOf('function _dimWrite'),
                                                      DEMO.indexOf('function _dimWrite') + 1200)), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll shared-hinge checks passed.');
