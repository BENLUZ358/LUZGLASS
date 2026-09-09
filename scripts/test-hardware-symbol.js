#!/usr/bin/env node
/**
 * A hinge must not look like a bracket.
 *
 * Both are fastened through a 20mm hole, so once the bracket became a hole
 * the two were the same circle in two shades of the same brown — and on a
 * phone that is no difference at all. Someone reading the sketch could not
 * tell whether a pane carried hinges or wall brackets.
 *
 * The hole stays exact, because it is what gets cut and a customer
 * ordering one replacement pane has nothing else to go on. The BODY is
 * what separates them: a hinge grips two glasses and straddles the face,
 * a bracket is screwed into one and reaches inward only. The handle stays
 * a bare hole, as decided.
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
  const boxes = [], circles = [];
  const cx = { save(){}, restore(){}, beginPath(){}, fill(){}, stroke(){},
    roundRect: (x, y, w, h) => boxes.push({ x, y, w, h }),
    rect:      (x, y, w, h) => boxes.push({ x, y, w, h }),
    arc:       (x, y, r)    => circles.push({ x, y, r }) };
  const ctx = vm.createContext({ Math, cx });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  vm.runInContext([grab('engBody'), grab('engHardware')].join('\n'), ctx);
  ctx.h = hw;
  vm.runInContext('engHardware(h,' + sc + ')', ctx);
  return { boxes, circles };
}

console.log('');

/* full scale, so the 3px minimum radius never masks the real diameter */
const SC = 1;
const EDGE = 400;

/* ── the hinge straddles the face ───────────────────────────────────────── */
{
  const r = draw({ kind: 'hinge', dia: 20, x: EDGE, y: 300, edgeX: EDGE, into: 1 }, SC);
  check('a hinge is drawn with a body', r.boxes.length, 1);
  const b = r.boxes[0];
  check('and the body crosses the face rather than stopping at it',
        [b.x < EDGE, b.x + b.w > EDGE], [true, true]);
  check('with the face at its centre', Math.round(b.x + b.w / 2), EDGE);
  check('the hole is still drawn at full diameter', r.circles[0].r, 20 * SC / 2);
}

/* ── the bracket reaches into its own glass only ────────────────────────── */
{
  const right = draw({ kind: 'bracket', dia: 20, x: EDGE + 2.5, y: 300, edgeX: EDGE, into: 1 }, SC);
  const b = right.boxes[0];
  check('a bracket is drawn with a body too', right.boxes.length, 1);
  check('but it starts at the face and reaches inward', [b.x, b.x + b.w > EDGE], [EDGE, true]);

  const left = draw({ kind: 'bracket', dia: 20, x: EDGE - 2.5, y: 300, edgeX: EDGE, into: -1 }, SC);
  const l = left.boxes[0];
  check('and a bracket on the other face reaches the other way',
        [l.x < EDGE, Math.round(l.x + l.w)], [true, EDGE]);
}

/* ── a hinge is not the same size as a bracket ──────────────────────────── */
{
  const hin = draw({ kind: 'hinge',   dia: 20, x: EDGE, y: 300, edgeX: EDGE, into: 1 }, SC).boxes[0];
  const bra = draw({ kind: 'bracket', dia: 20, x: EDGE, y: 300, edgeX: EDGE, into: 1 }, SC).boxes[0];
  check('the two bodies are different heights, so they read apart at a glance',
        hin.h !== bra.h, true);
  check('and the hinge is the taller of the two', hin.h > bra.h, true);
}

/* ── the handle stays a bare hole ───────────────────────────────────────── */
{
  const r = draw({ kind: 'hole', dia: 12, x: 700, y: 900 }, SC);
  check('the handle carries no body — a plain hole, as asked', r.boxes.length, 0);
  check('and it is the smaller hole', r.circles[0].r, 12 * SC / 2);
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
  check('and every hinge knows which way its glass lies',
        L.hardware.filter(h => h.kind === 'hinge').every(h => h.into === 1 || h.into === -1), true);
  check('brackets still exist alongside them', kinds.bracket > 0, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hardware-symbol checks passed.');
