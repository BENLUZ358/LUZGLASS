#!/usr/bin/env node
/**
 * A hinge must not look like a bracket.
 *
 * Once the bracket became a hole, the two were the same circle in two
 * shades of the same brown — and on a phone that is no difference at all.
 * Someone reading the sketch could not tell whether a pane carried hinges
 * or wall brackets.
 *
 * The split is the one that was asked for, and nothing more: a BRACKET is
 * a bare hole, because a hole is all the cutter needs, exactly like the
 * handle. A HINGE keeps the symbol it always had — a solid body sitting on
 * the face, because it grips two glasses rather than being drilled into
 * one.
 *
 * Run: node scripts/test-hardware-symbol.js
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

function grab(name) {
  const i = DEMO.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
}

/* a canvas that only remembers the shapes asked of it */
function draw(hw, sc) {
  const boxes = [], circles = [], fills = [];
  const cx = { save(){}, restore(){}, beginPath(){}, stroke(){},
    get fillStyle(){ return this._f; }, set fillStyle(v){ this._f = v; },
    fill() { fills.push(this._f); },
    roundRect: (x, y, w, h) => boxes.push({ x, y, w, h }),
    rect:      (x, y, w, h) => boxes.push({ x, y, w, h }),
    arc:       (x, y, r)    => circles.push({ x, y, r }) };
  const ctx = vm.createContext({ Math, cx });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  vm.runInContext(grab('engHardware'), ctx);
  ctx.h = hw;
  vm.runInContext('engHardware(h,' + sc + ')', ctx);
  return { boxes, circles, fills };
}

console.log('');

const SC = 1;   /* full scale, so the 3px floor never masks the diameter */

/* ── the hinge keeps its solid symbol ───────────────────────────────────── */
{
  const r = draw({ kind: 'hinge', dia: 20, x: 400, y: 300, edgeX: 400, into: 1 }, SC);
  check('a hinge is drawn as a body, not a hole', [r.boxes.length, r.circles.length], [1, 0]);
  check('and the body sits on the face it grips',
        [r.boxes[0].x + r.boxes[0].w / 2, r.boxes[0].y + r.boxes[0].h / 2], [400, 300]);
  check('filled solid, so it reads as metal', r.fills, ['#2b2620']);
}

/* ── the bracket is a bare hole, as asked ───────────────────────────────── */
{
  const r = draw({ kind: 'bracket', dia: 20, x: 400, y: 300, edgeX: 400, into: 1 }, SC);
  check('a bracket carries no body — a hole and nothing more',
        [r.boxes.length, r.circles.length], [0, 1]);
  check('at its true diameter', r.circles[0].r, 20 * SC / 2);
}

/* ── the handle is the same idea, smaller ───────────────────────────────── */
{
  const r = draw({ kind: 'hole', dia: 12, x: 700, y: 900 }, SC);
  check('the handle is a bare hole too', [r.boxes.length, r.circles.length], [0, 1]);
  check('and the smaller of the two', r.circles[0].r, 12 * SC / 2);
}

/* ── the engine still names the two apart ───────────────────────────────── */
{
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8') + '\n' +
                  fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  ctx.shower = {
    boundary: { right: 'wall', left: 'wall' }, finish: 'shahor', quality: 'zamak',
    shapes: [{ id: 'a', kind: 'fixed', w: 500, h: 2000 },
             { id: 'b', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }],
  };
  const L = vm.runInContext('lgLayout(shower,{canvasW:900})', ctx);
  const kinds = {};
  L.hardware.forEach(h => { kinds[h.kind] = (kinds[h.kind] || 0) + 1; });

  /* the door is hinged on its right, which is where the fixed sits */
  check('a door hinged toward the fixed puts hinges on that junction',
        kinds.hinge > 0, true);
  check('brackets still exist alongside them', kinds.bracket > 0, true);
  check('and the two are never the same kind',
        L.hardware.every(h => h.kind !== 'hinge' || !h.role || /hinge/.test(h.role)), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hardware-symbol checks passed.');
