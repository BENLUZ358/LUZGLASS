#!/usr/bin/env node
/**
 * Every pane keeps its own numbers, however narrow it is.
 *
 * Shrink one door of a fixed|door|door|fixed run and three things went
 * wrong at once:
 *
 *   ITS HEIGHT VANISHED. Middle panes of equal height shared a single
 *   measurement — one number instead of two identical ones. The saving was
 *   real; the cost was that the second door had nothing to read and
 *   nothing to touch, so it could never be given a height of its own.
 *
 *   THE HANDLE'S DISTANCE LEFT THE DOOR. On a narrow pane the label did
 *   not fit, so the allocator pushed it past the face — where it reads as
 *   the neighbour's.
 *
 *   THE TOPS STOPPED LINING UP. A door was aligned against the TALLEST
 *   fixed in the run. A sloped fixed of 2000/2010 at the far end dragged a
 *   1985 door into the >20mm exception, its head came out five millimetres
 *   above the fixed beside it, and the shared hinge read 195 on one pane
 *   and 200 on the other. A door lines up with the pane it hangs on.
 *
 * All three are the same principle: a measurement belongs to the glass it
 * describes, and a door belongs to the pane that carries it.
 *
 * Run: node scripts/test-narrow-pane.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

/* the arrangement from the photograph: two doors meeting in the middle */
const PANELS = [
  { type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
  { type: 'door',  wallSide: 'none',  label: 'דלת',  hingeSide: 'right', handleSide: 'left',  hingeOnFixed: 'prev' },
  { type: 'door',  wallSide: 'none',  label: 'דלת',  hingeSide: 'left',  handleSide: 'right', hingeOnFixed: 'next' },
  { type: 'fixed', wallSide: 'left',  label: 'קבוע', carriesDoor: true },
];
function run(states) {
  ctx.P = PANELS; ctx.S = states;
  return vm.runInContext('lgLayout(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}),' +
    '{canvasW:900})', ctx);
}
const plain = (w2, h2) => ({ 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 },
                             2: { w: w2, h: h2 || 1985 }, 3: { w: 500, h: 2000 } });
const sloped = w2 => ({ 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 },
                        2: { w: w2, h: 1985 },
                        3: { w: 500, h: 2000, hasSlope: true, slopeH1: 2000,
                             slopeH2: 2010, slopeSideH: 'bottom' } });
const heightsOf = L => L.dims.filter(d => d.field === 'h' || /slopeH/.test(d.field || ''));

console.log('');

/* ── every pane has a height, and it can be reached ─────────────────────── */
{
  const L = run(plain(250));
  const per = {};
  heightsOf(L).forEach(d => { per[d.idx] = (per[d.idx] || 0) + 1; });
  check('all four panes carry a height', Object.keys(per).map(Number).sort(), [0, 1, 2, 3]);
  check('and the two equal doors each carry their own',
        [per[1], per[2]], [1, 1]);
  check('each with a field to edit',
        heightsOf(L).every(d => d.field), true);
}

/* ── nothing a pane owns leaves that pane ───────────────────────────────── */
[800, 400, 250, 150, 100, 60].forEach(w => {
  const L = run(plain(w));
  const stray = L.dims.filter(d => {
    const g = L.shapes.find(s => s.idx === d.idx);
    if (!g) return false;
    /* the overall height of an END pane is written outside on purpose */
    if (d.kind === 'height' && (d.idx === 0 || d.idx === 3)) return false;
    const lo = Math.min(d.x1, d.x2), hi = Math.max(d.x1, d.x2);
    return lo < g.x - 2 || hi > g.x + g.w + 2;
  }).map(d => d.kind);
  check(`a door of ${w}mm keeps all of its numbers on its own glass`, stray, []);
});

/* ── and the handle's own distance, specifically ─────────────────────────── */
[250, 150, 100].forEach(w => {
  const L = run(plain(w));
  const g = L.shapes.find(s => s.idx === 2);
  const hd = L.dims.filter(d => d.idx === 2 && /handle/.test(d.kind));
  check(`at ${w}mm the handle still has its measurements`, hd.length > 0, true);
  check('  and they sit on the door',
        hd.every(d => Math.min(d.x1, d.x2) >= g.x - 2 &&
                      Math.max(d.x1, d.x2) <= g.x + g.w + 2), true);
  const hole = L.hardware.find(h => h.idx === 2 && h.kind === 'hole');
  check('  with the hole itself inside the glass',
        !!hole && hole.x >= g.x && hole.x <= g.x + g.w, true);
});

/* ── a door lines up with the pane it hangs on ──────────────────────────── */
{
  const L = run(sloped(250));
  const sc = L.scale;
  const top = i => Math.round(L.shapes.find(s => s.idx === i).y / sc);

  check('the fixed and the door beside it share a head line', top(1), top(0));
  check('and so does the second door', top(2), top(0));

  /* which is what makes the shared hinge read the same on both panes */
  const at = i => L.dims.filter(d => d.kind === 'hinge-top' && d.idx === i).map(d => d.text);
  check('the shared hinge reads the same number on the fixed and the door',
        at(0), at(1));
  check('and 200 on both, as the rule has always said', at(0), ['200']);
}

/* ── the tallest pane no longer drags everything into the exception ─────── */
{
  /* without the sloped pane the answer must be identical — proof that the
     far end's height is not what decides */
  const a = run(plain(250));
  const b = run(sloped(250));
  const rel = L => {
    const sc = L.scale, head = Math.min.apply(null, L.shapes.map(g => g.y));
    return [0, 1, 2].map(i => Math.round((L.shapes.find(s => s.idx === i).y - head) / sc));
  };
  check('a taller pane at the far end does not move the door beside the fixed',
        rel(b)[1] - rel(b)[0], rel(a)[1] - rel(a)[0]);
  check('nor the second door', rel(b)[2] - rel(b)[0], rel(a)[2] - rel(a)[0]);
}

/* ── the exception still fires when it should ───────────────────────────── */
{
  /* the door itself is far from the fixed it hangs on */
  const L = run(plain(250, 1900));       /* 2000 vs 1900 → more than 20 */
  const sc = L.scale;
  const floor = Math.max.apply(null, L.shapes.map(g => g.y + g.h));
  const gap = i => Math.round((floor - (L.shapes.find(s => s.idx === i).y +
                                        L.shapes.find(s => s.idx === i).h)) / sc);
  check('a door more than 20mm shorter takes its 20mm off the floor', gap(2), 20);
  check('while the one within 20mm keeps the difference as clearance', gap(1), 15);
  check('and the fixed panes stand on the floor', [gap(0), gap(3)], [0, 0]);
}

/* ── the run is still legal throughout ──────────────────────────────────── */
{
  [800, 250, 150].forEach(w => {
    ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})',
      Object.assign(ctx, (ctx.P = PANELS, ctx.S = plain(w), ctx)));
    check(`a ${w}mm door leaves the run legal`,
          vm.runInContext('lgValidate(SH)', ctx), []);
  });
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll narrow-pane checks passed.');
