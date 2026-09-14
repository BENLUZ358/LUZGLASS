#!/usr/bin/env node
/**
 * Three handles, and the two ways a towel rail is set out.
 *
 * `handleType` and `towelSpacing` have sat in mkPS since the beginning and
 * the ENGINE NEVER READ THEM — no mention of either in lg-layout. Choosing
 * "מגבת" changed nothing: every door got one hole. Another dead control,
 * like the recess before it.
 *
 * Ben's rules, 2026-09-14:
 *
 *   KNOB          one hole, at the chosen distance from the handle face.
 *
 *   TOWEL         two holes, 55cm apart. The first sits at the SAME
 *                 distance from the face as a knob would; the second 55cm
 *                 further in. Change the face distance from 6 to 8 and
 *                 BOTH move — the 55 is what is being held.
 *
 *   TOWEL CENTRED two holes, each at that distance from ITS OWN face.
 *                 "זו השיטה, לא כמה בין החורים" — the spacing is whatever
 *                 the glass width leaves, and so it is never dimensioned:
 *                 a line on it would be describing a result, not a choice.
 *
 * Run: node scripts/test-towel-handle.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
const ENG  = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

/* a door hinged on the fixed to its left, so its handle face is the RIGHT one */
function door(st, w) {
  ctx.P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
           { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' }];
  ctx.S = { 0: { w: 500, h: 2000 }, 1: Object.assign({ w: w || 800, h: 1985 }, st) };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  const L = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  const g = L.shapes.find(x => x.idx === 1), sc = L.scale;
  const holes = L.hardware.filter(h => h.role === 'handle' && h.idx === 1);
  return {
    n: holes.length,
    /* distance of each hole from the RIGHT face — the handle face */
    fromHandleFace: holes.map(h => Math.round((g.x + g.w - h.x) / sc)).sort((a, b) => a - b),
    fromLeftFace:   holes.map(h => Math.round((h.x - g.x) / sc)).sort((a, b) => a - b),
    heights: holes.map(h => Math.round((g.y + g.h - h.y) / sc)),
    dim: k => L.dims.filter(d => d.idx === 1 && d.kind === k).map(d => d.text).sort(),
    bom: () => vm.runInContext('lgBOM(SH)', ctx).filter(l => l.type === 'handle'),
  };
}

console.log('');

/* ── the engine used to ignore the choice entirely ────────────────────── */
{
  check('the engine now reads the handle type', /st\.handleType==='towel'/.test(ENG), true);
  check('and the spacing beside it', /Number\(st\.towelSpacing\)>0/.test(ENG), true);
  check('with 55cm named once', /const LG_TOWEL_MM=550;/.test(ENG), true);
}

/* ── one knob ─────────────────────────────────────────────────────────── */
{
  const d = door({});
  check('a knob is one hole', d.n, 1);
  check('six centimetres in from the handle face', d.fromHandleFace, [60]);
  check('and it says so', d.dim('handle-edge'), ['60']);
  check('with no spacing to speak of', d.dim('towel-gap'), []);
}

/* ── a towel rail ─────────────────────────────────────────────────────── */
{
  const d = door({ handleType: 'towel' });
  check('a towel rail is two holes', d.n, 2);
  check('the first where the knob would have been, the second 55 further',
        d.fromHandleFace, [60, 610]);
  check('both at the same height', d.heights[0], d.heights[1]);
  check('the face distance is dimensioned', d.dim('handle-edge'), ['60']);
  check('and so is the 55 — it is the decision', d.dim('towel-gap'), ['550']);

  /* the rule Ben spelled out: move the first, the second follows */
  const e = door({ handleType: 'towel', handleEdge: 8 });
  check('at 8cm from the face both holes move',  e.fromHandleFace, [80, 630]);
  check('and the 55 between them is untouched', e.dim('towel-gap'), ['550']);

  /* and the spacing itself can still be overridden */
  const g = door({ handleType: 'towel', towelSpacing: 40 });
  check('a spacing typed by hand is obeyed', g.fromHandleFace, [60, 460]);
  check('and dimensioned as what it is', g.dim('towel-gap'), ['400']);
}

/* ── a centred towel rail ─────────────────────────────────────────────── */
{
  const d = door({ handleType: 'towel-center' });
  check('centred is two holes as well', d.n, 2);
  check('each six centimetres from its OWN face',
        [d.fromLeftFace[0], d.fromHandleFace[0]], [60, 60]);
  check('so on an 800 door they land 60 and 740 from the handle face',
        d.fromHandleFace, [60, 740]);
  check('two face distances are written, one per face',
        d.dim('handle-edge'), ['60', '60']);
  check('and the gap between them is NOT dimensioned — it is a result',
        d.dim('towel-gap'), []);

  const e = door({ handleType: 'towel-center', handleEdge: 8 });
  check('at 8cm it is 8 from both faces', [e.fromLeftFace[0], e.fromHandleFace[0]], [80, 80]);

  /* the spacing genuinely follows the glass */
  const wide = door({ handleType: 'towel-center' }, 1000);
  check('a wider door spreads them further apart',
        wide.fromHandleFace[1] - wide.fromHandleFace[0],
        1000 - 120);
  check('while a plain towel rail keeps its 55 whatever the width',
        door({ handleType: 'towel' }, 1000).fromHandleFace, [60, 610]);
}

/* ── the rules already in place still hold ────────────────────────────── */
{
  /* the metre ceiling applies to the pair, which is at one height */
  const tall = door({ handleType: 'towel', h: 2400 });
  check('a towel rail on a tall door still stops at a metre',
        tall.heights[0], 1000);

  /* two doors that meet still line up, towel rails and all */
  ctx.P = [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
           { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' },
           { type: 'door', hingeOnFixed: 'next', handleSide: 'right' },
           { type: 'fixed', wallSide: 'left', carriesDoor: true }];
  ctx.S = { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985, handleType: 'towel' },
            2: { w: 800, h: 1900 }, 3: { w: 500, h: 2000 } };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  const L = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  const hy = i => L.hardware.filter(h => h.role === 'handle' && h.idx === i).map(h => Math.round(h.y));
  check('a towel rail and a knob facing it share one height',
        [...new Set(hy(1).concat(hy(2)))].length, 1);
  check('and the towel rail is still two holes', hy(1).length, 2);
}

/* ── the picking list tells them apart ────────────────────────────────── */
{
  check('a knob is a knob', door({}).bom(), [{ type: 'handle', variant: 'knob',
    finish: 'shahor', quality: 'zamak', qty: 1 }]);
  check('a towel rail is a towel rail', door({ handleType: 'towel' }).bom()[0].variant, 'towel');
  check('and a centred one is the same part, just placed differently',
        door({ handleType: 'towel-center' }).bom()[0].variant, 'towel');
  check('one handle per door, not one per hole', door({ handleType: 'towel' }).bom()[0].qty, 1);
  check('the list names the variant beside the part',
        /LG_HW_VAR\[l\.key\.variant\]/.test(DEMO), true);
}

/* ── the sheet can actually choose it ─────────────────────────────────── */
{
  check('a door gets a handle group',
        /s\.kind==='door'[\s\S]{0,200}<h4>ידית<\/h4>/.test(DEMO), true);
  check('with all three types offered',
        /\['knob','כפתור'\],\['towel','מגבת'\],\s*\['towel-center','מרכוז מגבת'\]/.test(DEMO), true);
  check('the spacing field appears only for a plain towel rail',
        /ps\.handleType==='towel'\s*\?\s*_shNum\('towelSpacing'/.test(DEMO), true);
  check('and the centred one explains that the gap is a result',
        /המרחק ביניהם יוצא מרוחב הזכוכית/.test(DEMO), true);

  /* the trap under it: these two fields are stored in CENTIMETRES while
     the sheet talks millimetres. 6cm written as 60cm is a door with the
     handle a third of the way across it. */
  check('the sheet converts for the fields that are kept in centimetres',
        /sheetSet\(field, f\.cm \? r\.mm\/10 : r\.mm\)/.test(DEMO), true);
  check('and the spacing is declared as one of them',
        /towelSpacing: \{label:[^}]*cm:true\}/.test(DEMO), true);
  check('as the face distance always was',
        /handleEdge: \{label:[^}]*cm:true\}/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll towel-handle checks passed.');
