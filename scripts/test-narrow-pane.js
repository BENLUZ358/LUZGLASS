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

  /* The second door hangs on the SLOPED pane, which is 2010 tall. That is
     25mm more than the door — past the tolerance — so the rule says do not
     force the heads together. The clearance it falls back to is the same
     15mm every door gets; only the head line parts. */
  const sc2 = L.scale;
  const floorY = Math.max.apply(null, L.shapes.map(g => g.y + g.h));
  const clearance = i => { const g = L.shapes.find(s => s.idx === i);
                           return Math.round((floorY - (g.y + g.h)) / sc2); };
  check('the door on the sloped pane is past the tolerance, but the clearance is still 15',
        clearance(2), 15);
  check('while the one on the plain fixed keeps the difference as clearance',
        clearance(1), 15);

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
  /* the second door DOES move, because that pane is the one it hangs on —
     which is the whole point: a door lines up with its own neighbour */
  check('while the door that hangs on it follows it, as it should',
        rel(b)[2] !== rel(a)[2], true);
}

/* ── the exception still fires when it should ───────────────────────────── */
{
  /* the door itself is far from the fixed it hangs on */
  const L = run(plain(250, 1900));       /* 2000 vs 1900 → more than 20 */
  const sc = L.scale;
  const floor = Math.max.apply(null, L.shapes.map(g => g.y + g.h));
  const gap = i => Math.round((floor - (L.shapes.find(s => s.idx === i).y +
                                        L.shapes.find(s => s.idx === i).h)) / sc);
  check('a door more than 20mm shorter still sits 15 off the floor', gap(2), 15);
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

/* ── no pane ever comes out with no hardware of its own ─────────────────── */
/* Add a fixed beside a fixed and the new one arrived bare: its far end was
   open, so no bracket there, and the shared bracket is hosted on its
   neighbour. Nothing held it and nothing could be built. Glass at the end
   of a RUN meets a wall. A single pane is the exception — no inner
   neighbour, so its declared side stands and it keeps its two brackets. */
{
  const shower = (panels, states) => {
    ctx.P = panels; ctx.S = states;
    return vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  };
  const layout = () => vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  const load = sh => { ctx.SH = sh; return layout(); };

  const two = load(shower(
    [{ type: 'fixed', wallSide: 'right' }, { type: 'fixed', wallSide: 'none' }],
    { 0: { w: 500, h: 2000 }, 1: { w: 500, h: 2000 } }));
  const perPane = L => L.shapes.map(g => L.hardware.filter(h => h.idx === g.idx).length);
  check('a fixed added beside a fixed is not left bare',
        perPane(two).every(n => n > 0), true);
  check('the run is held at both ends and joined in the middle',
        vm.runInContext('lgJunctions(SH).map(function(j){return j.type;})', ctx),
        ['bracket-wall', 'bracket-gg', 'bracket-wall']);

  const one = load(shower([{ type: 'fixed', wallSide: 'right' }],
                          { 0: { w: 500, h: 2000 } }));
  check('while a single pane still takes two brackets, not four',
        one.hardware.filter(h => h.kind === 'bracket').length, 2);

  /* every run, whatever it is made of, leaves no pane empty */
  const KINDS = [
    { type: 'fixed', wallSide: 'right', carriesDoor: true },
    { type: 'door', hingeSide: 'right', handleSide: 'left', hingeOnFixed: 'prev' },
    { type: 'fixed', wallSide: 'none', carriesDoor: true },
    { type: 'fixed', wallSide: 'none' },
  ];
  for (let n = 2; n <= 4; n++) {
    const panels = KINDS.slice(0, n);
    const st = {}; panels.forEach((p, i) => { st[i] = { w: p.type === 'door' ? 800 : 500, h: p.type === 'door' ? 1985 : 2000 }; });
    const L = load(shower(panels, st));
    check(`a run of ${n} leaves no pane without hardware`,
          perPane(L).filter(x => x === 0).length, 0);
  }
}

/* ── a slope at the BOTTOM leaves the head level ────────────────────────── */
/* A pane of 2000/1800 sloped at the bottom is 2000 tall right across its
   head — the two numbers differ underneath. Reading it as 1800 put a 1985
   door 185mm away, deep into the exception, and the shared hinge came out
   195 on one pane and 200 on the other. */
{
  const P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true, hasSlope: true },
             { type: 'door', hingeSide: 'right', handleSide: 'left', hingeOnFixed: 'prev' }];
  const S = { 0: { w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1800,
                   slopeSideH: 'bottom' },
              1: { w: 800, h: 1985 } };
  ctx.P = P; ctx.S = S;
  const L = vm.runInContext('lgLayout(lgFromPanels(P,S,{finish:"shahor",' +
    'quality:"zamak"}),{canvasW:900})', ctx);
  const at = (k, i) => L.dims.filter(d => d.kind === k && d.idx === i).map(d => d.text);
  check('the heads line up under a bottom slope',
        Math.round(L.shapes[0].y), Math.round(L.shapes[1].y));
  check('the top hinge reads 200 on both panes', [at('hinge-top', 0), at('hinge-top', 1)],
        [['200'], ['200']]);
  /* The fixed is cut 2000/1800 and the DOOR HANGS ON ITS SHORT FACE: the
     glass there stops 200mm above the floor. So the bottom hinge cannot be
     215 above the floor — that would be 15mm from the edge of the fixed, a
     hole in thin air. It sits 200 above the edge that actually exists, and
     the door, whose own bottom is 15 above the floor, reads 385.

     This used to read 215/200 only because the label was measured from the
     pane's bounding box rather than from the face the hinge is drilled
     into. The box said "floor"; the glass said 200mm up. */
  check('the bottom hinge clears the sloped face it is drilled into',
        [at('hinge-bot', 0), at('hinge-bot', 1)], [['200'], ['385']]);

  /* a slope at the TOP does lower that face, and then it counts */
  const S2 = { 0: { w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1800,
                    slopeSideH: 'top' }, 1: { w: 800, h: 1985 } };
  ctx.S = S2;
  const L2 = vm.runInContext('lgLayout(lgFromPanels(P,S,{finish:"shahor",' +
    'quality:"zamak"}),{canvasW:900})', ctx);
  check('a slope at the top is a different shape from one at the bottom',
        JSON.stringify(L2.shapes[0].poly) !== JSON.stringify(L.shapes[0].poly), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll narrow-pane checks passed.');
