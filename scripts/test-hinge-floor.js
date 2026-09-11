#!/usr/bin/env node
/**
 * Where the bottom hinge goes, and where the floor bracket goes.
 *
 * Four rules Ben gave on 2026-09-11, and one bug behind all of them.
 *
 * THE BUG. Hardware was placed and measured against the pane's BOUNDING
 * BOX. A face cut by a slope ends higher than the box does, so a hinge
 * drawn "200 from the bottom" was really 150 from the glass — and the
 * drawing said 200. Whoever drills from the drawing misses by the slope.
 * Everything here measures from the FACE the hole is drilled into.
 *
 * THE CEILING. The bottom hinge never reads more than 215 above the
 * floor. An ordinary shower reaches 215 by itself — 200 up from a door
 * that hangs 15 above the floor — so the ceiling only catches the
 * exceptions: a bigger floor gap, or a sloped face pushing it up.
 *
 * THE FLOOR UNDER THE CEILING. The same hinge passes through the pane
 * opposite, and it must clear that glass by the same 200. Without this,
 * "215 above the floor" would put the hole 15mm from the edge of a fixed
 * whose hinge face is cut 200 up — a hole in thin air.
 *
 * AND AN EXPLICIT NUMBER BEATS BOTH. Someone who typed a dimension meant
 * it; that is also what makes the shared-hinge editor work at all.
 *
 * THE FLOOR BRACKET. It was counted in the picking list and never drawn,
 * so ticking the box changed nothing on screen. It is the same declared
 * hole the catalogue uses — 2.5cm up, 5cm in from the face that is not
 * leaning on a wall.
 *
 * Run: node scripts/test-hinge-floor.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ENG = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

/* fixed on the left carrying a door on the right — the everyday pair */
function lay(fixed, door, opts) {
  ctx.P = (opts && opts.panels) || [
    { type: 'fixed', wallSide: 'right', carriesDoor: true },
    { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' }];
  ctx.S = { 0: fixed, 1: door };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  return vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
}
/* what the drawing actually says, per pane */
const label = (L, kind, idx) => L.dims.filter(d => d.kind === kind && d.idx === idx).map(d => d.text);
/* and the truth: height of the lowest hinge above the assembly floor */
function aboveFloor(L) {
  const floor = Math.max(...L.shapes.map(s => s.y + s.h));
  const hinges = L.hardware.filter(h => h.kind === 'hinge');
  const low = hinges.reduce((a, b) => (a.y > b.y ? a : b));
  return Math.round((floor - low.y) / L.scale);
}

console.log('');

/* ── the everyday pair is unchanged ───────────────────────────────────── */
{
  const L = lay({ w: 500, h: 2000 }, { w: 800, h: 1985 });
  check('an ordinary shower still reads 215 on the fixed, 200 on the door',
        [label(L, 'hinge-bot', 0), label(L, 'hinge-bot', 1)], [['215'], ['200']]);
  check('and the tops agree, both hanging from the same head',
        [label(L, 'hinge-top', 0), label(L, 'hinge-top', 1)], [['200'], ['200']]);
  check('215 above the floor, which is what the fixed is measuring',
        aboveFloor(L), 215);
}

/* ── the ceiling, where the old number was 220 ────────────────────────── */
{
  /* More than 20mm apart, so the heads do not line up. The floor clearance
     is 15 all the same — Ben, 2026-09-11 — and that is what keeps the pair
     at 200/215 without anyone touching the door's hinge. It used to be 20
     here, which read 220 on the fixed; correcting THAT number by lowering
     the hinge moved the door's own 200 to 195 for nothing. */
  const L = lay({ w: 500, h: 2000 }, { w: 800, h: 1900 });
  check('a shorter door still reads 215 on the fixed', label(L, 'hinge-bot', 0), ['215']);
  check('and the door keeps its own 200 — untouched', label(L, 'hinge-bot', 1), ['200']);
  check('because it hangs 15 off the floor, like every door',
        Math.round((Math.max(...L.shapes.map(s => s.y + s.h)) -
                    (L.shapes[1].y + L.shapes[1].h)) / L.scale), 15);
  check('and the hinge is 215 above the floor', aboveFloor(L), 215);
  check('the clearance is named once', /LG_TOP_ALIGN=20, LG_DOOR_GAP=15;/.test(ENG), true);
  check('and so is the ceiling', /const LG_HINGE_FLOOR_MAX=215;/.test(ENG), true);
}

/* ── a slope on the face the hinge is drilled into ────────────────────── */
{
  /* the door's hinge face is its LEFT one; cut that face at the floor */
  const L = lay({ w: 500, h: 2000 },
                { w: 800, h: 1985, hasSlope: true, slopeH1: 1935, slopeH2: 1985,
                  slopeSideH: 'bottom' });
  check('the hinge stays 215 above the floor', aboveFloor(L), 215);
  check('and the fixed still reads 215', label(L, 'hinge-bot', 0), ['215']);
  check('but the door now reads the truth about its own sloped face',
        label(L, 'hinge-bot', 1), ['150']);

  /* the same face cut at the TOP moves the top hinge down with it */
  const T = lay({ w: 500, h: 2000 },
                { w: 800, h: 1985, hasSlope: true, slopeH1: 1935, slopeH2: 1985,
                  slopeSideH: 'top' });
  check('a head cut by a slope carries the top hinge down',
        label(T, 'hinge-top', 1), ['200']);
  check('while the fixed, whose head is untouched, reads further',
        label(T, 'hinge-top', 0), ['250']);
}

/* ── the floor under the ceiling ──────────────────────────────────────── */
{
  /* now the FIXED is the sloped one, and the door hangs on its short face:
     the glass there stops 200 above the floor, so 215 is not available */
  const L = lay({ w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1800,
                  slopeSideH: 'bottom' },
                { w: 800, h: 1985 });
  check('the hinge clears the glass it is drilled into',
        label(L, 'hinge-bot', 0), ['200']);
  check('so it rises above the ceiling rather than sit in thin air',
        aboveFloor(L) > 215, true);
  check('and the door reads its own distance to that same hinge',
        label(L, 'hinge-bot', 1), ['385']);
}

/* ── a number someone typed beats both ────────────────────────────────── */
{
  const L = lay({ w: 500, h: 2000 }, { w: 800, h: 1985, hingeBot: 400 });
  check('an explicit hingeBot is honoured, ceiling or not',
        label(L, 'hinge-bot', 1), ['400']);
  check('and the fixed follows it, fifteen higher',
        label(L, 'hinge-bot', 0), ['415']);
  check('the guard is on the field, not on the value',
        /src\.hingeBot==null/.test(ENG), true);
}

/* ── the floor bracket is drawn, not only counted ─────────────────────── */
{
  const L = lay({ w: 900, h: 2000, floorBracket: true }, { w: 800, h: 1985 });
  const fb = L.hardware.filter(h => h.role === 'bracket-floor');
  check('ticking the box puts a hole on the glass', fb.length, 1);
  check('it is a 20mm bracket hole', fb[0] && fb[0].dia, 20);

  const g = L.shapes[0], sc = L.scale;
  check('2.5cm up from the floor', Math.round((g.y + g.h - fb[0].y) / sc), 25);
  check('and 5cm in from a face',
        Math.min(Math.round((fb[0].x - g.x) / sc),
                 Math.round((g.x + g.w - fb[0].x) / sc)), 50);
  check('the picking list still counts exactly one',
        (ctx.SH = L && ctx.SH, vm.runInContext('lgBOM(SH)', ctx)
          .filter(l => l.type === 'bracket-floor').map(l => l.qty)), [1]);

  /* the wall is at the start of the run, so the hole goes to the other face */
  check('it sits on the face that is not leaning on a wall',
        Math.round((g.x + g.w - fb[0].x) / sc), 50);

  const off = lay({ w: 900, h: 2000 }, { w: 800, h: 1985 });
  check('and no hole at all when the box is clear',
        off.hardware.filter(h => h.role === 'bracket-floor').length, 0);

  check('both numbers are named once, and the screen reads the same pair',
        [/const LG_FLOOR_BRACKET_BOT=25, LG_FLOOR_BRACKET_SIDE=50;/.test(ENG),
         /LG_HOLE_POS_DEF=\{'bracket-floor':\{side:50,bot:25\}/.test(DEMO)],
        [true, true]);
}

/* ── a door cannot be bolted to the floor ─────────────────────────────── */
{
  check('the sheet offers the floor bracket to a fixed only',
        /s\.kind!=='fixed'[\s\S]{0,400}floorBracket/.test(DEMO), true);
  check('and says why on a door', /זווית רצפה היא של קבוע — דלת זזה/.test(DEMO), true);
}

/* ── in the notch, every dimension edits itself ───────────────────────── */
{
  const L = lay({ w: 900, h: 2000, notchW: 200, notchH: 500, notchSide: 'left',
                  notchHIn: 480, notchRest: 700 },
                { w: 800, h: 1985 });
  const field = txt => (L.dims.find(d => d.text === String(txt)) || {}).field;
  check('the notch width edits the notch width', field(200), 'notchW');
  check('the width left beside it edits that, not the whole pane', field(700), 'notchRest');
  check('the outer notch height edits the outer one', field(500), 'notchH');
  check('and the inner height the inner one', field(480), 'notchHIn');
  check('none of them falls back to the pane width',
        L.dims.filter(d => d.zone === 'bottom' && d.field === 'w').length, 0);

  /* and the editor knows what to put in the box for the two new ones */
  check('the editor has a label for the width left over',
        /notchRest:\s*\{label:/.test(DEMO), true);
  check('and for the inner height', /notchHIn:\s*\{label:/.test(DEMO), true);
  check('with a default each, so the window opens on a number',
        [/t\.field==='notchRest'\)\s*v=/.test(DEMO),
         /t\.field==='notchHIn'\)\s*v=/.test(DEMO)], [true, true]);
}

/* ── two doors that meet are a pair ──────────────────────────────────── */
/* Handle facing handle is grabbed with two hands, so both must come out at
   the SAME height. "half the door" for each one separately put them at two
   heights the moment the doors differed — which a slope does on its own. */
{
  const PAIR = [
    { type: 'fixed', wallSide: 'right', carriesDoor: true },
    { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' },
    { type: 'door', hingeOnFixed: 'next', handleSide: 'right' },
    { type: 'fixed', wallSide: 'left', carriesDoor: true }];
  const run = (d1, d2) => {
    ctx.P = PAIR;
    ctx.S = { 0: { w: 500, h: 2000 }, 1: d1, 2: d2, 3: { w: 500, h: 2000 } };
    ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
    return vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  };
  const handleY = (L, idx) => {
    const h = L.hardware.find(x => x.role === 'handle' && x.idx === idx);
    const floor = Math.max(...L.shapes.map(s => s.y + s.h));
    return Math.round((floor - h.y) / L.scale);
  };

  const same = run({ w: 800, h: 1985 }, { w: 800, h: 1985 });
  check('two identical doors put their handles at one height',
        handleY(same, 1), handleY(same, 2));

  /* the case from the photograph: one door cut by a slope */
  const cut = run({ w: 800, h: 1935, hasSlope: true, slopeH1: 1935, slopeH2: 1885,
                    slopeSideH: 'bottom' },
                  { w: 800, h: 1985 });
  check('and so do two doors of different heights',
        handleY(cut, 1), handleY(cut, 2));
  check('which is what the sloped one used to break',
        handleY(cut, 1) === handleY(cut, 2), true);

  /* each pane still reports the distance to ITS OWN edge at that face —
     the same height, two honest numbers */
  const dist = idx => cut.dims.filter(d => d.kind === 'handle-dist' && d.idx === idx)
                              .map(d => Number(d.text))[0];
  check('and each door measures it from its own handle face',
        dist(1) !== dist(2), true);

  /* a typed number wins, and drags its partner to stay opposite */
  const typed = run({ w: 800, h: 1985, handleDist: 1100 }, { w: 800, h: 1985 });
  check('a typed handle height is honoured', dist2(typed, 1), 1100);
  check('and the door opposite follows it', handleY(typed, 1), handleY(typed, 2));

  function dist2(L, idx) {
    return L.dims.filter(d => d.kind === 'handle-dist' && d.idx === idx)
                 .map(d => Number(d.text))[0];
  }

  /* a lone door is unaffected — there is nothing to face */
  ctx.P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
           { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' }];
  ctx.S = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 } };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  const solo = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  check('a single door still sits at half its own height',
        dist2(solo, 1), 993);
}

/* ── a handle never climbs past a metre ───────────────────────────────── */
/* Ben, 2026-09-11: the default is the middle of the glass, and on an
   ordinary door that is right. On a tall one the middle comes out too high
   to open comfortably, so the default stops at 1000mm off the floor. It is
   a ceiling on the DEFAULT only — a typed height is a decision. */
{
  const at = h => {
    const L = lay({ w: 500, h: Math.max(2000, h + 15) }, { w: 800, h: h });
    return Number(L.dims.filter(d => d.kind === 'handle-dist' && d.idx === 1)[0].text);
  };
  check('a short door still takes half its height', at(1200), 600);
  check('and an ordinary one', at(1985), 993);
  check('exactly 2000 lands on the metre', at(2000), 1000);
  check('a taller door stops there', at(2400), 1000);
  check('however tall it gets', at(3000), 1000);
  check('the metre is named once', /const LG_HANDLE_MAX_MM=1000;/.test(ENG), true);
  check('and the editor opens on the same number, not on half the door',
        /handleDist'\)\s*v=Math\.min\(Math\.round\(\(ps\.h\|\|2000\)\/2\),1000\)/.test(DEMO), true);

  /* a typed height is obeyed, above the metre or below it */
  const typed = lay({ w: 500, h: 2500 }, { w: 800, h: 2400, handleDist: 1400 });
  check('a typed handle height is not capped',
        typed.dims.filter(d => d.kind === 'handle-dist' && d.idx === 1).map(d => d.text),
        ['1400']);
}

{
  /* and the ceiling survives the pair rule: two doors that meet align to
     one height, and that height may not push either past the metre */
  const PAIR = [
    { type: 'fixed', wallSide: 'right', carriesDoor: true },
    { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' },
    { type: 'door', hingeOnFixed: 'next', handleSide: 'right' },
    { type: 'fixed', wallSide: 'left', carriesDoor: true }];
  ctx.P = PAIR;
  ctx.S = { 0: { w: 500, h: 2500 }, 1: { w: 800, h: 2400 },
            2: { w: 800, h: 2200 }, 3: { w: 500, h: 2500 } };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  const L = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  const d = i => Number(L.dims.filter(x => x.kind === 'handle-dist' && x.idx === i)[0].text);
  check('two tall doors still meet at one height', d(1), d(2));
  check('and neither of them passes the metre', [d(1) <= 1000, d(2) <= 1000], [true, true]);
}

/* ── the hole carries its two numbers onto the drawing ────────────────── */
/* through the SAME two functions every other dimension uses — hwAdd for the
   vertical one, shortH for the distance to the face. Nothing new was built
   for them; only the name differs, so a click does not open the wrong
   editor. A hole with no numbers cannot be drilled. */
{
  const L = lay({ w: 900, h: 2000, floorBracket: true }, { w: 800, h: 1985 });
  const at = k => L.dims.filter(d => d.kind === k).map(d => d.text);
  check('the hole says how far up it is', at('hole-dist'), ['25']);
  check('and how far in from the face', at('hole-edge'), ['50']);
  check('they are drawn at the same size as every other hardware dimension',
        L.dims.filter(d => /^hole-/.test(d.kind))
              .every(d => d.size === L.dims.filter(x => x.kind === 'handle-edge')[0].size),
        true);
  check('and neither opens an editor, because a declared hole is edited in the sheet',
        L.dims.filter(d => /^hole-/.test(d.kind)).every(d => !d.field), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hinge and floor-bracket checks passed.');
