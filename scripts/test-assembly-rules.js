#!/usr/bin/env node
/**
 * Sweeps every arrangement the builder can produce and holds the engine to
 * the assembly rules.
 *
 * The rules were agreed one at a time over many rounds, each from a real
 * shower that went wrong. They are only worth anything if they hold for
 * EVERY arrangement rather than for the handful anyone thought to try — so
 * this generates all of them up to five panes and checks each.
 *
 * Run: node scripts/test-assembly-rules.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, JSON, Object, Array, String, Number, Set });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
const { lgValidate, lgJunctions, lgLayout, lgBOM } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── generate every arrangement up to five panes ────────────────────────── */
/* 'shape' is the free form and 'mirror' hangs on its own — neither is part
   of the shower assembly, and neither carries hardware. They were treated
   as fixed panels until now, which is why a free shape arrived on screen
   wearing wall brackets nobody asked for. */
const KINDS = ['fixed', 'door', 'shape'];
const BOUNDS = [
  { right: 'wall',  left: 'wall'  },
  { right: 'wall',  left: 'open'  },
  { right: 'open',  left: 'wall'  },
  { right: 'open',  left: 'open'  },
];

function* arrangements(maxLen) {
  for (let n = 1; n <= maxLen; n++) {
    const total = Math.pow(KINDS.length, n);
    for (let mask = 0; mask < total; mask++) {
      const kinds = [];
      let m = mask;
      for (let i = 0; i < n; i++) { kinds.push(KINDS[m % KINDS.length]); m = Math.floor(m / KINDS.length); }
      /* a door also has a hinge side, and both are worth trying */
      const doors = kinds.filter(k => k === 'door').length;
      for (let h = 0; h < Math.pow(2, doors); h++) {
        let d = 0;
        const shapes = kinds.map((k, i) => {
          if (k !== 'door') return { id: 's' + i, kind: k, w: 500, h: 2000 };
          const side = ((h >> d++) & 1) ? 'left' : 'right';
          return { id: 's' + i, kind: 'door', w: 800, h: 1985, hingeSide: side };
        });
        for (const b of BOUNDS) yield { shapes, boundary: b };
      }
    }
  }
}

const ALL = [];
for (const a of arrangements(5)) ALL.push(a);
console.log('');
console.log(`סורק ${ALL.length} צירופים\n`);

const shower = a => ({ boundary: a.boundary, finish: 'shahor', quality: 'zamak', shapes: a.shapes });
const label = a => a.shapes.map(s => s.kind === 'door' ? ('ד' + (s.hingeSide === 'right' ? '→' : '←'))
                                   : s.kind === 'fixed' ? 'ק' : 'ח').join('')
                 + ' [' + a.boundary.right[0] + a.boundary.left[0] + ']';

/* ── free glass carries nothing and holds nothing ───────────────────────── */
/* A free shape and a mirror are not part of the assembly. Until now every
   kind that was not a door counted as a fixed panel, so a free shape got
   wall brackets and a door was allowed to hang on it. */
{
  const FREE = ['shape', 'mirror'];
  const hw = [], held = [];
  FREE.forEach(kind => {
    [{ right: 'wall', left: 'wall' }, { right: 'open', left: 'open' }].forEach(b => {
      const sh = { boundary: b, finish: 'shahor', quality: 'zamak',
                   shapes: [{ id: 'f', kind, w: 500, h: 2000 }] };
      const L = lgLayout(sh, { canvasW: 900 }), bom = lgBOM(sh);
      if (L.hardware.length) hw.push(kind + ' על הציור');
      if (bom.length) hw.push(kind + ' בליקוט');
      /* and it is never asked to lean on anything */
      if (lgValidate(sh).length) held.push(kind + ': ' + lgValidate(sh)[0].msg);
    });
  });
  check('free glass takes no hardware at all', hw, []);
  check('and is never told it must lean on something', held, []);

  /* a door may not hang on it either — there is nothing to screw into */
  const onFree = lgValidate({
    boundary: { right: 'open', left: 'wall' }, finish: '', quality: '',
    shapes: [{ id: 'f', kind: 'shape', w: 500, h: 2000 },
             { id: 'd', kind: 'door', w: 800, h: 1985, hingeSide: 'right' }] });
  check('a door hanging on free glass is refused',
        onFree.some(e => e.at === 'd' && /חופשית/.test(e.msg)), true);
}

/* ── rule 1: a door must hang on something ──────────────────────────────── */
/* Stated first and never revised: a door needs a fixed panel or a wall on
   the side it hangs from. */
{
  const wrong = [];
  ALL.forEach(a => {
    const sh = shower(a), errs = lgValidate(sh);
    a.shapes.forEach((s, i) => {
      if (s.kind !== 'door') return;
      /* the neighbour on the hinge side, in engine terms: 'right' faces the
         previous shape in the array */
      const n = s.hingeSide === 'right'
        ? (i === 0 ? (a.boundary.right === 'wall' ? 'wall' : null) : a.shapes[i - 1])
        : (i === a.shapes.length - 1 ? (a.boundary.left === 'wall' ? 'wall' : null) : a.shapes[i + 1]);
      const FREE = { shape: 1, mirror: 1, panel: 1 };
      const unsupported = !!(!n || (n !== 'wall' && (n.kind === 'door' || FREE[n.kind])));
      const flagged = errs.some(e => e.at === s.id && /להיתלות|על דלת/.test(e.msg));
      if (unsupported !== flagged) wrong.push(label(a) + ' · ' + s.id);
    });
  });
  check('a door with nothing to hang on is always caught', wrong, []);
}

/* ── rule 2: a fixed panel must lean on something ───────────────────────── */
/* Added after the sketch review: a fixed pane between two doors carries
   both their hinges and has nothing of its own to screw into. */
{
  const wrong = [];
  ALL.forEach(a => {
    const errs = lgValidate(shower(a));
    a.shapes.forEach((s, i) => {
      const FREE = { shape: 1, mirror: 1, panel: 1 };
      if (s.kind !== 'fixed') return;
      const l = i === 0 ? (a.boundary.right === 'wall' ? 'wall' : null) : a.shapes[i - 1];
      const r = i === a.shapes.length - 1 ? (a.boundary.left === 'wall' ? 'wall' : null) : a.shapes[i + 1];
      const held = [l, r].some(n => n === 'wall' || (n && n.kind === 'fixed'));
      const flagged = errs.some(e => e.at === s.id && /להישען/.test(e.msg));
      if ((!held) !== flagged) wrong.push(label(a) + ' · ' + s.id);
    });
  });
  check('a fixed panel leaning on nothing is always caught', wrong, []);
}

/* ── rule 3: what passes validation must also draw and pick ─────────────── */
/* A legal arrangement that throws, or that produces no hardware where a
   joint exists, is a rule the engine states but does not keep. */
{
  const broken = [], noHw = [];
  ALL.filter(a => lgValidate(shower(a)).length === 0).forEach(a => {
    const sh = shower(a);
    let L, bom;
    try { L = lgLayout(sh, { canvasW: 900 }); bom = lgBOM(sh); }
    catch (e) { broken.push(label(a) + ': ' + e.message); return; }

    const js = lgJunctions(sh);
    const joints = js.filter(j => j.type).length;
    const symbols = L.hardware.filter(h => h.kind === 'bracket' || h.kind === 'hinge').length;
    if (joints > 0 && symbols === 0) noHw.push(label(a));
    /* every pane is drawn */
    if (L.shapes.length !== a.shapes.length) broken.push(label(a) + ': panes lost');
  });
  check('every legal arrangement draws without throwing', broken, []);
  check('and every joint puts hardware on the glass', noHw, []);
}

/* ── rule 4: hardware is counted once, at the joint ─────────────────────── */
/* The drawing and the picking list must agree. They did not, once: a hinge
   was drawn twice because the door and the fixed each drew their own. */
{
  const wrong = [];
  ALL.filter(a => lgValidate(shower(a)).length === 0).forEach(a => {
    const sh = shower(a);
    const L = lgLayout(sh, { canvasW: 900 }), bom = lgBOM(sh);
    const symbols = L.hardware.filter(h => h.kind === 'bracket' || h.kind === 'hinge').length;
    const parts = bom.filter(l => /bracket|hinge/.test(l.type) && l.type !== 'bracket-floor')
                     .reduce((n, l) => n + l.qty, 0);
    if (symbols !== parts) wrong.push(`${label(a)}: ${symbols} על הציור, ${parts} בליקוט`);
  });
  check('the drawing and the picking list count the same hardware', wrong, []);
}

/* ── rule 5: a hinge sits on the face the two panes share ───────────────── */
/* The convention is inverted between drawer and engine, and it has already
   put hinges on the handle side once. */
{
  const wrong = [];
  ALL.filter(a => a.shapes.length > 1 && lgValidate(shower(a)).length === 0).forEach(a => {
    const L = lgLayout(shower(a), { canvasW: 900 });
    const js = lgJunctions(shower(a));
    L.hardware.filter(h => h.kind === 'hinge').forEach(h => {
      const j = h.junction;
      const x = j <= 0 ? L.shapes[0].x
              : j >= L.shapes.length ? L.shapes[L.shapes.length - 1].x + L.shapes[L.shapes.length - 1].w
              : L.shapes[j].x;
      /* within the bracket inset — the hinge itself has none */
      if (Math.abs(h.x - x) > 1) wrong.push(`${label(a)}: ציר ב-${h.x.toFixed(0)} במקום ${x.toFixed(0)}`);
    });
  });
  check('every hinge sits exactly on its joint', wrong, []);
}

/* ── rule 6: one handle per door, never on the hinge side ───────────────── */
{
  const wrong = [];
  ALL.filter(a => lgValidate(shower(a)).length === 0).forEach(a => {
    const L = lgLayout(shower(a), { canvasW: 900 });
    const doors = L.shapes.filter(s => s.kind === 'door');
    const holes = L.hardware.filter(h => h.kind === 'hole');
    if (doors.length !== holes.length) { wrong.push(label(a) + ': ' + holes.length + ' חורים ל-' + doors.length + ' דלתות'); return; }
    holes.forEach(hole => {
      const hinges = L.hardware.filter(h => h.kind === 'hinge' && h.idx === hole.idx);
      hinges.forEach(hg => {
        const s = L.shapes[hole.idx];
        if (!s) return;
        /* the hole must be on the far side of the pane from the hinge */
        const hingeAtLeft = Math.abs(hg.x - s.x) < Math.abs(hg.x - (s.x + s.w));
        const holeAtLeft  = Math.abs(hole.x - s.x) < Math.abs(hole.x - (s.x + s.w));
        if (hingeAtLeft === holeAtLeft) wrong.push(label(a) + ': ידית בצד הציר');
      });
    });
  });
  check('every door has one hole, opposite its hinges', wrong, []);
}

/* ── rule 7: a notch only on a fixed, only on the wall side ─────────────── */
{
  const wrong = [];
  ALL.filter(a => a.shapes.length >= 2).forEach(a => {
    a.shapes.forEach((s, i) => {
      if (s.kind !== 'fixed') return;
      const withNotch = {
        boundary: a.boundary, finish: 'shahor', quality: 'zamak',
        shapes: a.shapes.map((x, k) => k === i ? Object.assign({}, x, { notchW: 200, notchH: 500 }) : x),
      };
      const errs = lgValidate(withNotch);
      const l = i === 0 ? (a.boundary.right === 'wall' ? 'wall' : null) : a.shapes[i - 1];
      const r = i === a.shapes.length - 1 ? (a.boundary.left === 'wall' ? 'wall' : null) : a.shapes[i + 1];
      const touchesWall = l === 'wall' || r === 'wall';
      const flagged = errs.some(e => e.at === s.id && /פינוי/.test(e.msg));
      /* a pane touching no wall must be flagged; one touching a wall must not */
      if (!touchesWall && !flagged) wrong.push(label(a) + ' · ' + s.id + ': פינוי בלי קיר לא נפסל');
    });
  });
  check('a notch away from any wall is always caught', wrong, []);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll assembly rules hold.');
