#!/usr/bin/env node
/**
 * Placing a hole, and saving the shape that carries it.
 *
 * This is the mechanism that lets the library grow without touching code:
 * put a hole on the glass by diameter and distance from two faces, save
 * the shape, and it appears in the customers' gallery.
 *
 * The line it must not cross is the one that killed the first catalogue:
 * a shape may DECLARE only what no meeting produces. A floor bracket and
 * a free hole are decisions — nothing derives them. A hinge and a wall
 * bracket are derived from what the glass meets, and writing them by hand
 * is a second source of truth for one fact. LG_CAT_OWN_ROLES is that line,
 * and both the screen and the save check read it — not a copy of it.
 *
 * It also fixes a bug that was already there: saving a door-carrying fixed
 * failed, because the hinge holes the engine had computed into its state
 * were being offered to the catalogue as declarations, and the validator
 * rejected them. The intent travels as `hingesFor`; the holes are recomputed.
 *
 * Run: node scripts/test-hole-builder.js
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

/* ── the line: what a shape may declare ───────────────────────────────── */
{
  const cat = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-catalog.js'), 'utf8'), cat);

  check('a shape owns a floor bracket and a free hole, nothing else',
        Object.keys(cat.LG_CAT_OWN_ROLES).sort(), ['bracket-floor', 'hole']);

  const entry = holes => ({ id: 'x', name: 'צורה', add: { kind: 'fixed', holes } });
  const errs = h => (cat.E = entry(h), vm.runInContext('lgCatalogValidate(E)', cat));

  check('a declared floor bracket passes',
        errs([{ role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } }]), []);
  check('a declared hinge does not — it is derived, not decided',
        errs([{ role: 'hinge', dia: 20, x: { from: 'right', mm: 60 }, y: { from: 'bottom', mm: 215 } }]).length > 0, true);
  check('nor a wall bracket',
        errs([{ role: 'bracket-wall', dia: 20, x: { from: 'left', mm: 25 }, y: { from: 'top', mm: 100 } }]).length > 0, true);
  check('a hole with no diameter is refused',
        errs([{ role: 'hole', x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 900 } }]).length > 0, true);
  check('and one with no distance from a face',
        errs([{ role: 'hole', dia: 12, x: { from: 'left' }, y: { from: 'bottom', mm: 900 } }]).length > 0, true);
}

/* ── the engine draws what was declared ───────────────────────────────── */
{
  const eng = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), eng));

  const lay = holes => {
    eng.P = [{ type: 'fixed', wallSide: 'right' }];
    eng.S = { 0: { w: 900, h: 2000, holes } };
    eng.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', eng);
    return vm.runInContext('lgLayout(SH,{canvasW:600})', eng);
  };

  const L = lay([{ role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } }]);
  const dec = L.hardware.filter(h => h.source === 'declared');
  check('the declared hole reaches the drawing', dec.length, 1);
  check('with the role it was given', dec[0] && dec[0].role, 'bracket-floor');
  check('and the diameter it was given', dec[0] && dec[0].dia, 20);

  /* the distance is measured from the FACE, not from the bounding box —
     which is why a slope carries the hole along with it */
  const g = L.shapes[0], sc = L.scale;
  check('it sits 60mm in from the left face',
        Math.round((dec[0].x - g.x) / sc), 60);
  check('and 50mm up from the floor',
        Math.round((g.y + g.h - dec[0].y) / sc), 50);

  const sloped = (() => {
    eng.P = [{ type: 'fixed', wallSide: 'right' }];
    eng.S = { 0: { w: 900, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1800,
                   slopeSideH: 'top',
                   holes: [{ role: 'hole', dia: 12, x: { from: 'right', mm: 100 }, y: { from: 'top', mm: 100 } }] } };
    eng.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', eng);
    return vm.runInContext('lgLayout(SH,{canvasW:600})', eng);
  })();
  check('a hole on a sloped pane still lands on the glass',
        sloped.hardware.filter(h => h.source === 'declared').length, 1);

  /* an unusable hole must not be drawn at 0,0 — it must not be drawn */
  const junk = lay([{ role: 'bracket-floor', dia: 20 }, null,
                    { role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } }]);
  check('a broken hole is dropped rather than drawn at zero',
        junk.hardware.filter(h => h.source === 'declared').length, 1);
}

/* ── the editor writes exactly the shape the engine reads ─────────────── */
function sheet(ps, role, kind) {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console,
    LG_CAT_OWN_ROLES: { 'bracket-floor': 20, 'hole': 12 },
    _sess: { role: role || 'admin' } });
  vm.runInContext(
    'var sheetPfx="shape", PS=' + JSON.stringify(ps) + ';' +
    'var KIND=' + JSON.stringify(kind || 'fixed') + ';' +
    'function _sheetIdx(){ return 0; }' +
    'function _sheetMeta(){ return {kind:KIND, label:"x"}; }' +
    'function getPS(){ return PS; }' +
    'function _dimParse(v){ var n=Number(v); return isFinite(n)?{ok:true,mm:n}:{ok:false}; }' +
    'function _dimToUnit(mm){ return mm; }' +
    'function _dimUnitLabel(){ return "מ\\"מ"; }' +
    'function _shEsc(s){ return String(s); }' +
    'var PAINT=0; function renderShapeSheet(){PAINT++;} function renderShapeUI(){} function draw(){}', ctx);
  vm.runInContext(DEMO.match(/const LG_HOLE_HE=\{[^}]*\};/)[0], ctx);
  vm.runInContext(DEMO.match(/const LG_HOLE_POS_DEF=\{[^}]*\}[^;]*;/)[0], ctx);
  ['_holeRolesFor', '_holeList', '_holeRedraw', 'holeAdd', 'holeDel', 'holeSet',
   'holeNum', '_shHole', '_shHoles'].forEach(n => vm.runInContext(grab(n), ctx));
  return { run: e => vm.runInContext(e, ctx), ps: () => ctx.PS };
}

{
  const s = sheet({ w: 900, h: 2000 });
  s.run('holeAdd("bracket-floor")');
  const h = s.ps().holes[0];
  check('a new hole has the engine\'s exact shape',
        Object.keys(h).sort(), ['dia', 'role', 'x', 'y']);
  check('the two faces are named the way the engine names them',
        [Object.keys(h.x).sort(), Object.keys(h.y).sort()], [['from', 'mm'], ['from', 'mm']]);
  check('a floor bracket starts at the diameter the catalogue gives it', h.dia, 20);
  /* Ben's rule, 2026-09-11: a floor bracket sits 2.5cm up and 5cm in */
  check('and at the position the rule gives it — 25 up, 50 in',
        [h.y.mm, h.x.mm], [25, 50]);
  check('and it is a real 20mm hole, not a guess',
        h.dia, vm.runInContext('LG_CAT_OWN_ROLES["bracket-floor"]',
          vm.createContext({ LG_CAT_OWN_ROLES: { 'bracket-floor': 20, 'hole': 12 } })));

  s.run('holeAdd("hole")');
  check('a free hole starts at 12', s.ps().holes[1].dia, 12);
  check('an unknown role adds nothing',
        (s.run('holeAdd("hinge")'), s.ps().holes.length), 2);
}

{
  const s = sheet({ w: 900, h: 2000 });
  s.run('holeAdd("bracket-floor")');
  s.run('holeNum(0,"x",{value:"120",style:{}})');
  s.run('holeNum(0,"y",{value:"80",style:{}})');
  s.run('holeSet(0,"x.from","right")');
  s.run('holeSet(0,"y.from","top")');
  check('the position is what was typed',
        s.ps().holes[0], { role: 'bracket-floor', dia: 20,
                           x: { from: 'right', mm: 120 }, y: { from: 'top', mm: 80 } });

  /* a face can only be one of two things, whatever arrives */
  s.run('holeSet(0,"x.from","sideways")');
  check('an unknown face falls back rather than sticking', s.ps().holes[0].x.from, 'left');

  s.run('holeNum(0,"dia",{value:"0",style:{}})');
  check('a zero diameter is refused — the catalogue would reject it later',
        s.ps().holes[0].dia, 20);
  /* text that is not a number marks the field and changes nothing */
  s.run('BAD={value:"abc",style:{}}; holeNum(0,"x",BAD);');
  check('nonsense leaves the number alone', s.ps().holes[0].x.mm, 120);
  check('and says so on the field', s.run('BAD.style.borderColor'), '#c0392b');
}

{
  /* typing must not repaint the sheet — that would steal the focus from
     the field mid-keystroke, which is how a number editor becomes unusable */
  const s = sheet({ w: 900, h: 2000 });
  s.run('holeAdd("bracket-floor")');
  const before = s.run('PAINT');
  s.run('holeNum(0,"x",{value:"150",style:{}})');
  check('typing a distance does not rebuild the sheet under the cursor',
        s.run('PAINT'), before);
}

{
  /* changing the role carries the catalogue diameter, unless it was set by hand */
  const a = sheet({ w: 900, h: 2000 });
  a.run('holeAdd("bracket-floor")');
  a.run('holeSet(0,"role","hole")');
  check('an untouched diameter follows the new role', a.ps().holes[0].dia, 12);

  const b = sheet({ w: 900, h: 2000 });
  b.run('holeAdd("bracket-floor")');
  b.run('holeNum(0,"dia",{value:"16",style:{}})');
  b.run('holeSet(0,"role","hole")');
  check('a diameter someone typed is left alone', b.ps().holes[0].dia, 16);
}

{
  const s = sheet({ w: 900, h: 2000 });
  s.run('holeAdd("bracket-floor")'); s.run('holeAdd("hole")');
  s.run('holeDel(0)');
  check('deleting removes that one', s.ps().holes.length, 1);
  check('and leaves the other', s.ps().holes[0].role, 'hole');
  s.run('holeDel(0)');
  check('the last one out takes the empty list with it',
        Object.prototype.hasOwnProperty.call(s.ps(), 'holes'), false);
}

/* ── the group is an admin tool ───────────────────────────────────────── */
{
  const admin = sheet({ w: 900, h: 2000 }, 'admin');
  check('an admin sees the hole editor',
        admin.run('_shHoles(PS,"fixed")').indexOf('holeAdd') > -1, true);

  const client = sheet({ w: 900, h: 2000 }, 'client');
  check('a customer does not — a mis-placed hole is glass that cannot be fixed',
        client.run('_shHoles(PS,"fixed")'), '');
}

{
  /* derived holes are listed as derived, never as editable rows */
  const mixed = sheet({ w: 900, h: 2000, holes: [
    { role: 'hinge', dia: 20, x: { from: 'right', mm: 60 }, y: { from: 'bottom', mm: 215 } },
    { role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } },
  ] }, 'admin');
  const html = mixed.run('_shHoles(PS,"fixed")');
  check('only the owned hole gets a delete button',
        (html.match(/holeDel\(/g) || []).length, 1);
  check('and it is the one at index 1, not renumbered',
        html.indexOf('holeDel(1)') > -1, true);
  check('the derived one is explained instead of hidden',
        /המנוע גזר מהמפגש/.test(html), true);
}

/* ── a door cannot be bolted to the floor ─────────────────────────────── */
/* the toggle in the hardware group already knew this; the hole builder was
   the second way in, and it offered the floor bracket to anything */
{
  const door = sheet({ w: 800, h: 1985 }, 'admin', 'door');
  check('a door is not offered a floor bracket',
        door.run('_shHoles(PS,"door")').indexOf('bracket-floor') > -1, false);
  check('but it is still offered a free hole',
        door.run('_shHoles(PS,"door")').indexOf('&quot;hole&quot;') > -1, true);
  door.run('holeAdd("bracket-floor")');
  check('and adding one directly is refused too — without touching the state',
        Object.prototype.hasOwnProperty.call(door.ps(), 'holes'), false);
  door.run('holeAdd("hole")');
  check('while a free hole goes on as usual', door.ps().holes.length, 1);

  const fixed = sheet({ w: 900, h: 2000 }, 'admin', 'fixed');
  check('a fixed is offered both',
        fixed.run('_shHoles(PS,"fixed")').indexOf('bracket-floor') > -1, true);
}

/* ── saving: only what the shape owns, only what can be restored ──────── */
{
  const save = DEMO.slice(DEMO.indexOf('function shapeSaveOpen('),
                          DEMO.indexOf('async function shapeSaveTo('));

  check('the hinge holes are filtered out of what is saved',
        /LG_CAT_OWN_ROLES\[h\.role\]/.test(save), true);
  check('and the intent is saved in their place',
        /add\.hingesFor=ps\.hingesFor/.test(save), true);
  check('the declaration "brackets only" is saved too',
        /add\.carriesDoor=s\.carriesDoor/.test(save), true);
  check('the state carries the intent so the save can find it',
        /extra\.hingesFor=a\.hingesFor/.test(DEMO), true);

  /* the round trip that matters: a door-carrying fixed used to fail to
     save at all, because its computed hinge holes were offered as
     declarations and the validator rejected them */
  const cat = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-catalog.js'), 'utf8'), cat);
  const ok = add => (cat.E = { id: 'x', name: 'צורה', add }, vm.runInContext('lgCatalogValidate(E)', cat));

  check('a door-carrying fixed now saves',
        ok({ kind: 'fixed', carriesDoor: true, hingesFor: 'right' }), []);
  check('a brackets-only fixed saves its declaration',
        ok({ kind: 'fixed', carriesDoor: false }), []);
  check('a fixed with a floor bracket saves the hole itself',
        ok({ kind: 'fixed', holes: [{ role: 'bracket-floor', dia: 20,
             x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } }] }), []);
  check('a notch saves the side it is on',
        ok({ kind: 'fixed', notch: true, notchSide: 'left' }), []);

  /* every flag the save can write must be one the catalogue knows, or the
     entry validates on this screen and is thrown away on the next load */
  const written = (save.match(/add\.(\w+)\s*=/g) || []).map(m => m.slice(4, -1).trim());
  const known = Object.keys(cat.LG_CAT_FLAGS).concat(['kind', 'hingeSide']);
  check('the save writes no flag the catalogue would refuse',
        written.filter(f => known.indexOf(f) < 0), []);
}

{
  /* and it comes back: what was saved rebuilds the same holes */
  const cat = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-catalog.js'), 'utf8'), cat);
  const holes = [{ role: 'bracket-floor', dia: 20, x: { from: 'left', mm: 60 }, y: { from: 'bottom', mm: 50 } }];

  const st = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext('var NOTCH_DEF={notchW:200,notchH:500};' +
                  'function mkPS(){ return {slopeH1:2000,slopeH2:1800}; }' +
                  'function hingeHolesFromEngine(){ return [{role:"hinge"}]; }', st);
  vm.runInContext(grab('_stateFromAdd'), st);
  st.A = { kind: 'fixed', holes };
  const back = vm.runInContext('_stateFromAdd(A)', st);
  check('a saved hole rebuilds exactly as it was saved', back.holes, holes);

  /* and it is a COPY: one library entry feeds every pane made from it, so
     a shared array would let editing one pane's hole move it in all of them */
  st.A = { kind: 'fixed', holes };
  const one = vm.runInContext('_stateFromAdd(A)', st);
  const two = vm.runInContext('_stateFromAdd(A)', st);
  one.holes[0].x.mm = 999;
  check('two panes from one entry do not share the hole', two.holes[0].x.mm, 60);
  check('and the entry itself is untouched', holes[0].x.mm, 60);

  /* flipping a saved shape mirrors the hole, and twice returns it */
  cat.A = { kind: 'fixed', holes: JSON.parse(JSON.stringify(holes)) };
  const f1 = vm.runInContext('lgFlipAdd(A)', cat);
  check('flipping moves the hole to the other face', f1.holes[0].x.from, 'right');
  check('but not its height', f1.holes[0].y.from, 'bottom');
  cat.F1 = f1;
  check('and flipping back returns the original',
        vm.runInContext('lgFlipAdd(F1)', cat).holes, holes);
}

/* ── one source for the allowed roles ─────────────────────────────────── */
{
  check('the screen reads the catalogue list rather than keeping its own',
        /Object\.keys\(\(typeof LG_CAT_OWN_ROLES/.test(DEMO), true);
  check('and no second list of roles is written on the screen',
        /LG_HOLE_HE=\{'bracket-floor':[^}]*'hole':[^}]*\}/.test(DEMO), true);
  check('the Hebrew names cover exactly the allowed roles',
        (DEMO.match(/const LG_HOLE_HE=\{([^}]*)\}/)[1].match(/'/g) || []).length / 2, 4);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hole-builder checks passed.');
