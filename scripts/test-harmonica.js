#!/usr/bin/env node
/**
 * מקלחון אקורדיון — the folding hinge.
 *
 * A harmonica hinge is a KIND of hinge, not a new piece of hardware: the
 * same symbol, the same 200/200 placement, the same one-line-per-junction
 * count. What differs is what it may connect to — so it is an edge label
 * in the same table every other junction is decided by, not an `if` spread
 * through the drawer and the screen.
 *
 * Ben's rules, 2026-09-14/15:
 *
 *   · a harmonica reaches GLASS, never a wall — with one exception: an
 *     accordion where the same door folds on BOTH faces. Rare, real, and
 *     therefore an explicit exception rather than a hole in the rule.
 *   · a door may hang on a door, but ONLY through a harmonica. That is the
 *     single crack opened in one of the oldest rules here, and both panes
 *     must agree it is a harmonica — one junction is one piece of metal.
 *   · two doors joined by a harmonica must be the SAME height. There is no
 *     fixed-versus-door clearance here; these are two doors.
 *   · at most two folding doors: everything hangs off the wall hinges and
 *     they are weight-limited. A limit of hardware, not of drawing.
 *   · a slope is allowed only in the accordion that hangs from the wall by
 *     a hinge — not in the one sitting on a fixed pane.
 *   · a door hinged on BOTH faces has no free side, so its handle moves to
 *     the folding side, where a hand goes to fold it.
 *
 * Run: node scripts/test-harmonica.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

/* a shower straight from shapes — the engine's own vocabulary, so the rules
   are tested where they live and not through the screen's conventions */
function shower(shapes, boundary) {
  return { boundary: boundary || { right: 'wall', left: 'wall' },
           finish: 'shahor', quality: 'zamak', shapes: shapes };
}
const fixed = (id, over) => Object.assign({ id, kind: 'fixed', w: 500, h: 2000 }, over || {});
const door  = (id, over) => Object.assign({ id, kind: 'door',  w: 700, h: 1985 }, over || {});

const run = sh => { ctx.SH = sh; return {
  errors: vm.runInContext('lgValidate(SH)', ctx).map(e => e.msg),
  bom:    vm.runInContext('lgBOM(SH)', ctx),
  js:     vm.runInContext('lgJunctions(SH)', ctx),
}; };
const hw = (r, type) => { const l = r.bom.find(x => x.type === type); return l || null; };

console.log('');

/* ── configuration א · a fixed carrying a folding door ────────────────── */
/* wall → 2 brackets → fixed → 2 harmonicas → door */
{
  const r = run(shower([
    fixed('f', { carriesDoor: true }),
    door('d', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));

  check('a fixed carrying a folding door is legal', r.errors, []);
  check('the wall gives two brackets', hw(r, 'bracket-wall').qty, 2);
  check('and the fold gives two harmonica hinges',
        [hw(r, 'hinge-gg').qty, hw(r, 'hinge-gg').variant], [2, 'harmonica']);
  check('with one handle', hw(r, 'handle').qty, 1);
  check('and no ordinary hinge anywhere',
        r.bom.filter(l => l.type.indexOf('hinge') === 0 && l.variant !== 'harmonica').length, 0);

  /* one junction is one piece of metal — two cut-outs, one hinge */
  check('the fold is one junction, not two',
        r.js.filter(j => j.variant === 'harmonica').length, 1);
}

/* ── configuration ב · the full accordion ─────────────────────────────── */
/* wall → E400 → door A → harmonica → door B */
{
  const A = door('a', { hingeSide: 'right', harmonicaSide: 'left' });
  const B = door('b', { hingeSide: 'right', harmonicaSide: 'right' });
  const r = run(shower([A, B], { right: 'wall', left: 'open' }));

  check('a full accordion is legal', r.errors, []);
  check('the wall hinge is an ordinary one', hw(r, 'hinge-wall').variant, 'regular');
  check('and the fold between the doors is a harmonica',
        [hw(r, 'hinge-gg').variant, hw(r, 'hinge-gg').qty], ['harmonica', 2]);
  check('two doors, two handles', hw(r, 'handle').qty, 2);

  /* the crack in the old rule, and only there */
  check('a door on a door with NO harmonica is still refused',
        run(shower([door('a', { hingeSide: 'right' }),
                    door('b', { hingeSide: 'right' })],
                   { right: 'wall', left: 'open' })).errors.length > 0, true);
  check('and the message says what makes it legal',
        /אלא אם הציר ביניהן הוא הרמוניקה/.test(SRC), true);

  /* both panes must agree — one junction cannot be two kinds of hinge */
  check('one side alone saying harmonica is refused',
        run(shower([door('a', { hingeSide: 'right', harmonicaSide: 'left' }),
                    door('b', { hingeSide: 'right' })],
                   { right: 'wall', left: 'open' })).errors.length > 0, true);
}

/* ── a lone folding door, mid-build ──────────────────────────────────── */
/* The whole point of "+ one shape at a time" is that the first door of an
   accordion sits alone for a moment before its partner is added. Its fold
   face has nothing next to it yet — not glass, not a wall — and that is
   not an error, just unfinished. Only once a neighbour actually exists
   does the fold face get judged. */
{
  const midAlone = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'left' }),
  ], { right: 'wall', left: 'open' }));
  check('a lone folding door waiting for its partner is not an error',
        midAlone.errors, []);
}

/* ── the harmonica and the wall ───────────────────────────────────────── */
{
  const touching = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));
  check('a harmonica against a wall is refused',
        touching.errors.some(m => /לא מתחבר לקיר/.test(m)), true);

  /* the one exception: the door folds on BOTH faces */
  const rare = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'both' }),
    door('b', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));
  check('unless the same door folds on both faces — the rare accordion',
        rare.errors, []);
  check('and then the wall hinge itself is a harmonica',
        hw(rare, 'hinge-wall').variant, 'harmonica');

  /* and it is an exception, not a hole */
  const free = run(shower([
    { id: 'm', kind: 'mirror', w: 400, h: 1200 },
    door('a', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));
  check('a harmonica onto free glass is refused',
        free.errors.some(m => /זכוכית חופשית/.test(m)), true);

  const solo = run(shower([
    fixed('f', { carriesDoor: false }),
    door('a', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));
  check('and onto a brackets-only fixed too',
        solo.errors.some(m => /זוויות בלבד/.test(m)), true);
}

/* ── the same height ──────────────────────────────────────────────────── */
{
  const same = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'left', h: 1985 }),
    door('b', { hingeSide: 'right', harmonicaSide: 'right', h: 1985 }),
  ], { right: 'wall', left: 'open' }));
  check('two folding doors of one height are fine', same.errors, []);

  const off = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'left', h: 1985 }),
    door('b', { hingeSide: 'right', harmonicaSide: 'right', h: 1900 }),
  ], { right: 'wall', left: 'open' }));
  check('but two different heights are refused — they fold onto each other',
        off.errors.some(m => /אותו גובה/.test(m)), true);

  /* and the old fixed-versus-door clearance does NOT apply here */
  check('there is no clearance rule between two folding doors',
        off.errors.some(m => /קבוע/.test(m)), false);
}

/* ── at most two folding doors ────────────────────────────────────────── */
{
  const three = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'left' }),
    door('b', { hingeSide: 'right', harmonicaSide: 'both' }),
    door('c', { hingeSide: 'right', harmonicaSide: 'right' }),
  ], { right: 'wall', left: 'open' }));
  check('three folding doors are refused',
        three.errors.some(m => /עד שתי דלתות/.test(m)), true);
  check('and the reason is written down, not just the limit',
        /מוגבלים במשקל/.test(SRC), true);
}

/* ── the slope ────────────────────────────────────────────────────────── */
{
  const onWall = run(shower([
    door('a', { hingeSide: 'right', harmonicaSide: 'left',
                slopeH1: 2000, slopeH2: 1900, h: 2000 }),
    door('b', { hingeSide: 'right', harmonicaSide: 'right', h: 2000 }),
  ], { right: 'wall', left: 'open' }));
  check('a slope is allowed in the accordion that hangs from the wall',
        onWall.errors.filter(m => /שיפוע/.test(m)), []);

  const onFixed = run(shower([
    fixed('f', { carriesDoor: true }),
    door('d', { hingeSide: 'right', harmonicaSide: 'right',
                slopeH1: 2000, slopeH2: 1900, h: 2000 }),
  ], { right: 'wall', left: 'open' }));
  check('but not in the one sitting on a fixed pane',
        onFixed.errors.some(m => /שיפוע/.test(m)), true);
}

/* ── the handle side ──────────────────────────────────────────────────── */
{
  const lay = shapes => {
    ctx.SH = shower(shapes, { right: 'wall', left: 'open' });
    const L = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
    return idx => {
      const g = L.shapes.find(s => s.idx === idx);
      const h = L.hardware.find(x => x.role === 'handle' && x.idx === idx);
      /* which face of its own glass the handle sits on */
      return h ? (h.x - g.x < g.w / 2 ? 'left' : 'right') : null;
    };
  };

  /* ordinary: the handle is opposite the hinge */
  const plain = lay([fixed('f', { carriesDoor: true }),
                     door('d', { hingeSide: 'right', harmonicaSide: 'right' })]);
  check('a door folding on one side keeps its handle on the other',
        plain(1), 'right');

  /* hinged on both faces: E400 to the wall, harmonica to the next door */
  const both = lay([door('a', { hingeSide: 'right', harmonicaSide: 'left' }),
                    door('b', { hingeSide: 'right', harmonicaSide: 'right' })]);
  check('a door hinged on both faces puts its handle on the folding side',
        both(0), 'right');
  check('while the door beyond it keeps the ordinary rule', both(1), 'right');
}

/* ── nothing here reaches outside the rules engine ────────────────────── */
{
  const LAY  = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');
  const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

  check('the edge label is decided in one function',
        (SRC.match(/function _lgEdge\(/g) || []).length, 1);
  check('and the harmonica is a row in the same table, not an if',
        /'fixed\|hinge-h':/.test(SRC) && /'hinge-h\|hinge-h':/.test(SRC), true);
  check('the variant travels on the junction, so the list and the drawing agree',
        /variant: rule\.variant \|\| null/.test(SRC), true);
  check('the picking list reads it from there',
        /add\(j\.type, j\.variant \|\|/.test(SRC), true);

  /* The drawer carries the field and places the handle — both are drawing,
     not rule. What it must NOT hold is any opinion about what a harmonica
     may connect to, or how many are allowed. Those live in one file.
     One more read was added for the auto-boundary guess at an empty
     canvas: a door's OWN declared side (its hinge, or 'both' when it
     folds on both faces) is what may stand for a wall — not "any door
     edge," which used to wrongly claim the fold face too. That is a
     read of what the card already declared, same as wallSide already
     was — not a new opinion about what a harmonica may reach.

     A fourth read was added later, for a different reason: a door can
     carry E400 on one face and harmonica on the other, and the two used
     to share one hingeTop/hingeBot pair — editing one moved both. Which
     pair a junction reads (hingeTop/Bot or harmonicaHingeTop/Bot) is
     still just "which number to show," decided from the door's own
     hingeSide vs harmonicaSide — not a new opinion about what may
     connect. Four more matches: the guard itself plus the three
     comparisons that make it up. */
  check('the drawer holds no junction rule for it',
        /hinge-h/.test(LAY), false);
  check('nor any of the refusals',
        /לא מתחבר לקיר|עד שתי דלתות|חייבות להיות באותו גובה/.test(LAY), false);
  check('all it does is carry the side through, guess the boundary, and place the handle',
        (LAY.match(/harmonicaSide/g) || []).length, 11);
  /* the screen carries the side and paints a colour — neither is a rule.
     What it must never hold is the decision itself. */
  check('the screen holds no junction rule either', /hinge-h/.test(DEMO), false);
  check('nor any of the refusals',
        /לא מתחבר לקיר|עד שתי דלתות|חייבות להיות באותו גובה/.test(DEMO), false);
  check('it only carries the side and picks a colour',
        /LG_HINGE_COLOR\[h\.variant\]/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll harmonica checks passed.');
