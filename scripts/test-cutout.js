#!/usr/bin/env node
/**
 * Saving a shape at all, and the free cut-out.
 *
 * TWO BUGS FIRST. `lgCatalogValidate` requires an id, and BOTH callers ran
 * it before the id existed — the screen built `{name, add}` and validated,
 * and `lgSaveShape` validated on the line above the one that creates the id.
 * So every save failed with "לצורה אין מזהה" and nothing could ever reach
 * the library. The id is now made first, in both places.
 *
 * And the star is gone. A ☆ does not say what it does; "שמור צורה" does,
 * and the toast reports the code the system just assigned.
 *
 * THE FREE CUT-OUT. A rectangle cut anywhere out of the glass. It is NOT
 * the corner notch — that one has its own rules and changes the outline.
 * This is an interior cut, so it leaves the polygon, the area and the cut
 * sizes alone, and carries its own four numbers instead.
 *
 * The part that cannot be guessed: "20 from the bottom" can mean to the
 * START of the cut-out or to its CENTRE, and the two put the rectangle in
 * different places with identical numbers. So the reference travels with
 * the cut-out and the validator refuses one without it.
 *
 * Run: node scripts/test-cutout.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
const DB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const cat  = require(path.join(ROOT, 'lg-catalog.js'));

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

console.log('');

/* ── the save that never worked ───────────────────────────────────────── */
{
  /* the validator's own demand */
  check('an entry with no id is refused',
        cat.lgCatalogValidate({ name: 'x', add: { kind: 'fixed' } })
           .some(m => /מזהה/.test(m)), true);

  /* so the id has to exist before either caller validates */
  const save = DEMO.slice(DEMO.indexOf('function shapeSaveOpen('),
                          DEMO.indexOf('async function shapeSaveTo('));
  const idAt = save.indexOf('lgShapeId(name)');
  const okAt = save.indexOf('lgCatalogValidate(entry)');
  check('the screen makes the id before it validates', idAt > -1 && idAt < okAt, true);

  const dbIdAt = DB.indexOf('const id = entry.id || lgShapeId(entry.name)');
  const dbOkAt = DB.indexOf('const errs = lgCatalogValidate(');
  check('and so does lgSaveShape', dbIdAt > -1 && dbIdAt < dbOkAt, true);
  check('which validates the record it is actually about to write',
        /lgCatalogValidate\(Object\.assign\(\{\}, entry, \{ id: id \}\)\)/.test(DB), true);

  /* what the whole round trip now produces */
  const entry = { id: 'sh_m1k2q9_x', name: 'קבוע עם פינוי',
                  add: { kind: 'fixed',
                         cutouts: [{ w: 200, h: 100, ref: 'edge',
                                     x: { from: 'left', mm: 300 },
                                     y: { from: 'bottom', mm: 400 } }] } };
  check('a real entry passes', cat.lgCatalogValidate(entry), []);
  check('and it has a code to be called by', cat.lgShapeCode(entry), 'FX-1K2Q9');
}

/* ── the button says what it does ─────────────────────────────────────── */
{
  check('the star is gone', /title="שמור בספרייה">☆/.test(DEMO), false);
  check('a named button took its place', /class="strip-save"[\s\S]{0,120}שמור צורה/.test(DEMO), true);
  check('and the toast reports the code it just made',
        /shapeToast\('נשמר: '\+entry\.name\+' · '\+shapeCodeOf\(rec\)/.test(DEMO), true);
  check('saying which library it went to',
        /ספריית המפעל[\s\S]{0,40}הגלריה שלי/.test(DEMO), true);
}

/* ── where the cut-out lands ──────────────────────────────────────────── */
const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));

function place(cut, pane) {
  ctx.P = [{ type: 'fixed', wallSide: 'both' }];
  ctx.S = { 0: Object.assign({ w: 900, h: 2000 }, pane || {}, { cutouts: [cut] }) };
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  const L = vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  const g = L.shapes[0], sc = L.scale, k = (L.cutouts || [])[0];
  if (!k) return null;
  return { left: Math.round((k.x - g.x) / sc),
           bottom: Math.round((g.y + g.h - (k.y + k.h)) / sc),
           w: Math.round(k.w / sc), h: Math.round(k.h / sc), L: L };
}
const CUT = (over) => Object.assign({ w: 200, h: 100, ref: 'edge',
  x: { from: 'left', mm: 300 }, y: { from: 'bottom', mm: 400 } }, over || {});

{
  const e = place(CUT());
  check('measured to the start: the near edges sit on the numbers',
        [e.left, e.bottom], [300, 400]);
  check('and it is the size that was asked for', [e.w, e.h], [200, 100]);

  /* the same two numbers, the other convention, a different rectangle */
  const c = place(CUT({ ref: 'center' }));
  check('measured to the centre: the rectangle moves by half of itself',
        [c.left, c.bottom], [300 - 100, 400 - 50]);
  check('which is exactly why the reference has to be saved',
        c.left !== e.left && c.bottom !== e.bottom, true);

  check('from the right face it counts the other way',
        place(CUT({ x: { from: 'right', mm: 300 } })).left, 900 - 300 - 200);
  check('and from the top, downward',
        place(CUT({ y: { from: 'top', mm: 400 } })).bottom, 2000 - 400 - 100);

  /* both conventions, from the far corner */
  check('centre-from-the-far-corner lands where it should',
        [place(CUT({ ref: 'center', x: { from: 'right', mm: 300 },
                     y: { from: 'top', mm: 400 } })).left,
         place(CUT({ ref: 'center', x: { from: 'right', mm: 300 },
                     y: { from: 'top', mm: 400 } })).bottom],
        [900 - 300 - 100, 2000 - 400 - 50]);
}

/* ── a broken one is dropped, not drawn at the corner ─────────────────── */
{
  check('no width, no rectangle', place(CUT({ w: 0 })), null);
  check('no height either', place(CUT({ h: 0 })), null);
  check('and a missing distance', place(CUT({ y: null })), null);
}

/* ── it does not touch the glass the engine already knew ──────────────── */
/* An interior cut must not move the outline, the area, or the cut sizes —
   that is the whole reason it is not built like the corner notch. */
{
  const bare = (() => {
    ctx.P = [{ type: 'fixed', wallSide: 'both' }];
    ctx.S = { 0: { w: 900, h: 2000 } };
    ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
    return vm.runInContext('lgLayout(SH,{canvasW:900})', ctx);
  })();
  const cut = place(CUT()).L;
  check('the outline is untouched',
        JSON.stringify(cut.shapes[0].poly), JSON.stringify(bare.shapes[0].poly));
  check('the hardware is untouched',
        cut.hardware.length, bare.hardware.length);

  ctx.SH = bare && (ctx.SH = ctx.SH);
  const glassOf = L => { ctx.X = L; return null; };
  /* the picking list is computed from the shower, so compare there */
  ctx.P = [{ type: 'fixed', wallSide: 'both' }];
  ctx.S = { 0: { w: 900, h: 2000 } };
  const a = vm.runInContext('lgGlassTotals(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}))', ctx);
  ctx.S = { 0: { w: 900, h: 2000, cutouts: [CUT()] } };
  const b = vm.runInContext('lgGlassTotals(lgFromPanels(P,S,{finish:"shahor",quality:"zamak"}))', ctx);
  check('and so are the area and the cut sizes — glass is priced by the box',
        [a.m2, a.panes], [b.m2, b.panes]);
}

/* ── it carries its own numbers onto the drawing ──────────────────────── */
{
  const L = place(CUT()).L;
  const at = k => L.dims.filter(d => d.kind === k).map(d => d.text);
  check('the width is written', at('cut-w'), ['200']);
  check('the height too', at('cut-h'), ['100']);
  check('and both distances', [at('cut-x'), at('cut-y')], [['300'], ['400']]);
  check('none of them opens an editor — a cut-out is edited in the sheet',
        L.dims.filter(d => /^cut-/.test(d.kind)).every(d => !d.field), true);

  /* a distance of zero has nothing to measure */
  const flush = place(CUT({ x: { from: 'left', mm: 0 } })).L;
  check('a cut-out flush with the face gets no distance line',
        flush.dims.filter(d => d.kind === 'cut-x').length, 0);
  check('but still says how wide it is',
        flush.dims.filter(d => d.kind === 'cut-w').length, 1);
}

/* ── the drawing shows it as absence of glass ─────────────────────────── */
{
  check('the painter draws it', /\(L\.cutouts\|\|\[\]\)\.forEach/.test(DEMO), true);
  check('filled over the glass tint, so it reads as a hole',
        /cx\.fillStyle='#ffffff';\s*cx\.fillRect\(k\.x,k\.y,k\.w,k\.h\)/.test(DEMO), true);
  check('and outlined like a cut edge',
        /cx\.strokeRect\(k\.x,k\.y,k\.w,k\.h\)/.test(DEMO), true);
  check('before the hardware, because it is part of the cutting',
        DEMO.indexOf('(L.cutouts||[]).forEach') < DEMO.indexOf('L.hardware.forEach(h=>engHardware'), true);
}

/* ── the round trip ───────────────────────────────────────────────────── */
{
  const st = vm.createContext({ Math, JSON, Object, Array, String, Number, console,
    LG_CAT_NUMS: cat.LG_CAT_NUMS });
  vm.runInContext('var NOTCH_DEF={notchW:200,notchH:500};' +
                  'function mkPS(){ return {slopeH1:2000,slopeH2:1800}; }' +
                  'function hingeHolesFromEngine(){ return [{role:"hinge"}]; }', st);
  vm.runInContext(grab('_stateFromAdd'), st);
  const cut = CUT({ ref: 'center' });
  st.A = { kind: 'fixed', cutouts: [cut] };
  const back = vm.runInContext('_stateFromAdd(A)', st);
  check('a saved cut-out comes back exactly', back.cutouts[0], cut);

  /* and as a COPY — one library entry feeds every pane made from it */
  const one = vm.runInContext('_stateFromAdd(A)', st);
  const two = vm.runInContext('_stateFromAdd(A)', st);
  one.cutouts[0].x.mm = 999;
  check('two panes from one entry do not share the cut-out', two.cutouts[0].x.mm, 300);
  check('and the entry itself is untouched', cut.x.mm, 300);

  const save = DEMO.slice(DEMO.indexOf('function shapeSaveOpen('),
                          DEMO.indexOf('async function shapeSaveTo('));
  check('the save writes the reference point with it', /ref:c\.ref==='center'/.test(save), true);
  check('and drops a cut-out with no size rather than saving a bad one',
        /Number\(c\.w\)>0&&Number\(c\.h\)>0/.test(save), true);
}

/* ── the editor ───────────────────────────────────────────────────────── */
{
  check('there is a button to add one', /onclick="cutAdd\(\)">\+ פינוי חופשי/.test(DEMO), true);
  check('beside the holes, in the same group',
        /קדחים ופינויים על הצורה/.test(DEMO), true);
  check('the reference is a choice on the row, not a hidden default',
        /תחילת הפינוי[\s\S]{0,60}אמצע הפינוי/.test(DEMO), true);
  check('typing a number does not rebuild the sheet under the cursor',
        /function cutNum[\s\S]{0,700}renderShapeUI\(\); draw\(\);/.test(DEMO), true);
  check('and the last one out takes the empty list with it',
        /function cutDel[\s\S]{0,260}delete ps\.cutouts/.test(DEMO), true);

  /* the corner notch is a different feature and stays where it was */
  check('the corner notch is untouched', /פינוי מדרגה/.test(DEMO), true);
  check('and it still has its own four fields',
        /_shNum\('notchW'[\s\S]{0,400}_shNum\('notchRest'/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll cut-out and save checks passed.');
