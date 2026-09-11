#!/usr/bin/env node
/**
 * How panes of different heights line up.
 *
 * There used to be two reference lines: a door hung from the top of the
 * drawing, a fixed stood on the floor. While every pane was the same
 * height that looked right by accident. The moment a fixed was 1900 and a
 * door 2000, each pane landed somewhere of its own and none of them was
 * where it belonged.
 *
 * The floor is the only reference now, and the rule is:
 *
 *   Normally the TOPS are aligned — a shower reads as one line across the
 *   head, and the difference falls at the bottom as clearance under the
 *   door. That is what lets the door swing.
 *
 *   When the difference between the fixed and the door is more than 20mm,
 *   forcing the tops together would lift the door too far off the floor.
 *   So the door takes a fixed 20mm of floor clearance instead, and its
 *   head lands wherever its height puts it. A fixed taller than the doors
 *   simply carries on upward.
 *
 * And through all of it the shared hinge stays one piece of metal,
 * measured from each pane's own edge.
 *
 * Run: node scripts/test-height-align.js
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

/* lay out a fixed beside a door and report everything in millimetres,
   measured from the floor — the one reference the drawing now uses */
function pair(fixedH, doorH, boundary) {
  ctx.S = [{ id: 'f', kind: 'fixed', w: 500, h: fixedH },
           { id: 'd', kind: 'door', w: 800, h: doorH, hingeSide: 'right' }];
  ctx.B = boundary || { right: 'wall', left: 'open' };
  const L = vm.runInContext('lgLayout({boundary:B,finish:"shahor",quality:"zamak",' +
    'shapes:S},{canvasW:900})', ctx);
  const sc = L.scale;
  const floor = Math.max.apply(null, L.shapes.map(g => g.y + g.h));
  const of = g => ({
    top:    Math.round((floor - g.y) / sc),          /* head above the floor */
    bottom: Math.round((floor - (g.y + g.h)) / sc),  /* clearance under it   */
  });
  const g = k => L.shapes.find(s => s.kind === k);
  return { L, sc, floor, fixed: of(g('fixed')), door: of(g('door')) };
}

console.log('');

/* ── the ordinary case: tops together, the gap underneath ───────────────── */
{
  const r = pair(2000, 1985);
  check('a fixed and a door of the usual heights share one head line',
        r.fixed.top, r.door.top);
  check('the fixed stands on the floor', r.fixed.bottom, 0);
  check('and the door hangs the difference above it', r.door.bottom, 15);
}

/* the rule holds for any difference up to twenty */
[[2000, 2000, 0], [2000, 1990, 10], [2000, 1985, 15], [2000, 1980, 20]].forEach(([f, d, gap]) => {
  const r = pair(f, d);
  check(`fixed ${f} with door ${d}: the tops stay together`, r.fixed.top, r.door.top);
  check(`  and the clearance is the difference itself (${gap}mm)`, r.door.bottom, gap);
});

/* ── past twenty: the tops part, but the clearance never changes ────────── */
/* Ben, 2026-09-11: a door is 15mm off the floor, ALWAYS. The clearance used
   to be 20 in this branch, and then one hinge read 200 on the door and 220
   on the fixed — and correcting that number moved the door's hinge for
   nothing. At 15 the pair comes out 200/215 by itself, at every door
   height, and the hinge is never touched to fix a number. */
{
  /* the case from the photograph */
  const r = pair(1900, 2000);
  check('a door taller than the fixed by more than 20 still sits 15 off the floor',
        r.door.bottom, 15);
  check('the fixed still stands on the floor', r.fixed.bottom, 0);
  check('and the door now rises above the fixed', r.door.top > r.fixed.top, true);
  check('by exactly what its height and clearance give it',
        r.door.top - r.fixed.top, 2000 + 15 - 1900);
}
{
  /* the other direction: the fixed carries on upward */
  const r = pair(2100, 1985);
  check('a fixed taller than the door by more than 20 keeps its own head',
        r.fixed.top, 2100);
  check('the door still sits 15 off the floor', r.door.bottom, 15);
  check('and its head sits below the fixed', r.door.top < r.fixed.top, true);
  check('the fixed is not dragged down to meet it', r.fixed.bottom, 0);
}

/* the boundary between the two rules is sharp and sits at twenty */
{
  check('at exactly 20 the tops are still aligned', pair(2000, 1980).fixed.top,
        pair(2000, 1980).door.top);
  check('at 21 they are not', pair(2000, 1979).fixed.top === pair(2000, 1979).door.top, false);
  check('and the clearance becomes the fixed 15', pair(2000, 1979).door.bottom, 15);
}

/* ── the shared hinge survives all of it ────────────────────────────────── */
[[2000, 1985], [1900, 2000], [2100, 1985], [2000, 1979]].forEach(([f, d]) => {
  const r = pair(f, d);
  const hinges = r.L.hardware.filter(h => h.kind === 'hinge');
  check(`fixed ${f} / door ${d}: still one pair of hinges`, hinges.length, 2);

  /* one piece of metal: it has to be inside both glasses */
  const inside = hinges.every(h =>
    r.L.shapes.every(g => h.y >= g.y - 0.5 && h.y <= g.y + g.h + 0.5));
  check('  and both sit inside both panes', inside, true);

  /* two numbers for one hinge, each measured from its own pane's edge */
  const bot = r.L.dims.filter(x => x.kind === 'hinge-bot');
  check('  the bottom hinge is written on both panes', bot.length, 2);
  const doorIdx = r.L.shapes.find(g => g.kind === 'door').idx;
  const onDoor = Number(bot.find(x => x.idx === doorIdx).text);
  const onFixed = Number(bot.find(x => x.idx !== doorIdx).text);
  check('  and the two numbers differ by the door\'s clearance',
        onFixed - onDoor, r.door.bottom);
});

/* ── nothing that worked before changed ─────────────────────────────────── */
{
  /* a lone door has no fixed to align with, and must be left alone */
  ctx.S = [{ id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }];
  ctx.B = { right: 'wall', left: 'wall' };
  const L = vm.runInContext('lgLayout({boundary:B,finish:"shahor",quality:"zamak",' +
    'shapes:S},{canvasW:900})', ctx);
  check('a door with no fixed beside it fills its own drawing',
        Math.round(L.shapes[0].y - L.origin.y), 0);

  /* two fixed panes of different heights: no door, so no clearance rule */
  ctx.S = [{ id: 'a', kind: 'fixed', w: 500, h: 2000 },
           { id: 'b', kind: 'fixed', w: 500, h: 1800 }];
  const L2 = vm.runInContext('lgLayout({boundary:B,finish:"shahor",quality:"zamak",' +
    'shapes:S},{canvasW:900})', ctx);
  const floor2 = Math.max.apply(null, L2.shapes.map(g => g.y + g.h));
  check('two fixed panes both stand on the floor whatever their heights',
        L2.shapes.map(g => Math.round(floor2 - (g.y + g.h))), [0, 0]);
}

/* ── the numbers are named, not buried ──────────────────────────────────── */
{
  const SRC = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');
  check('the alignment tolerance has a name', /LG_TOP_ALIGN\s*=\s*20/.test(SRC), true);
  check('and so does the floor clearance', /LG_DOOR_GAP\s*=\s*15/.test(SRC), true);
  check('the floor is the only reference left',
        /kind==='door' \? oy :/.test(SRC), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll height-alignment checks passed.');
