#!/usr/bin/env node
/**
 * "My gallery", the code on every shape, and a save that comes back whole.
 *
 * Three things Ben asked for on 2026-09-11, and they are one idea:
 *
 *   WHERE IT LIVES. The personal library is keyed by phone — and the phone
 *   IS the customer card (`users/<phone>` is the record, `id: phone` is
 *   written there in so many words). Nothing is stored on a device. So the
 *   shapes a customer builds follow the customer, not the browser.
 *
 *   WHERE IT SHOWS. The factory's shapes stay where they always were; what
 *   the customer built gets its own gallery behind a button. One list still
 *   backs both — splitting the ARRAY would have split the indices, and the
 *   card would have added a different shape from the one it pictured.
 *
 *   WHAT IDENTIFIES IT. A name is what a person calls a shape, and two
 *   people will call two different shapes the same thing. A code cannot
 *   collide, and it is what the order and the factory floor refer to.
 *
 * And underneath: a saved shape must come back as the shape that was saved.
 * A notch of 30x60 that returned as 20x50 was a different shape wearing the
 * same name. The width and height stay out — those are the job's, and they
 * change on every order.
 *
 * Run: node scripts/test-my-gallery.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
const DB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');

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

const cat = require(path.join(ROOT, 'lg-catalog.js'));

console.log('');

/* ── the code ─────────────────────────────────────────────────────────── */
{
  const seeds = cat.lgCatalogSeeds();
  const codes = seeds.map(cat.lgShapeCode);
  check('every shipped shape has a code', codes.filter(Boolean).length, seeds.length);
  check('and no two share one', new Set(codes).size, seeds.length);
  check('the code says what kind of glass it is',
        seeds.map(e => cat.lgShapeCode(e).slice(0, 2)),
        ['FX', 'FX', 'FX', 'FX', 'DR', 'MR', 'SH']);

  /* a saved shape gets one too, derived from its own id — not from a
     counter in the cloud, which would need a lock and would hand two
     shapes saved in the same second the same number */
  const mine = { id: 'sh_m1k2q9_abc', name: 'שלי', add: { kind: 'fixed' } };
  check('a saved shape gets a code as well', cat.lgShapeCode(mine), 'FX-1K2Q9');
  check('and the same shape always gets the same one',
        cat.lgShapeCode(mine), cat.lgShapeCode(mine));
  check('a door saved by a customer is marked as a door',
        cat.lgShapeCode({ id: 'sh_zzz9_x', add: { kind: 'door' } }).slice(0, 2), 'DR');

  /* the name is NOT what identifies it */
  const a = { id: 'sh_aaa11_x', name: 'קבוע', add: { kind: 'fixed' } };
  const b = { id: 'sh_bbb22_x', name: 'קבוע', add: { kind: 'fixed' } };
  check('two shapes with one name still have two codes',
        cat.lgShapeCode(a) !== cat.lgShapeCode(b), true);

  check('the screen asks the catalogue for it, rather than building its own',
        /function shapeCodeOf[\s\S]{0,160}lgShapeCode\(e\)/.test(DEMO), true);
  check('and shows it on the card', /class="sc-code"/.test(DEMO), true);
}

/* ── the two galleries ────────────────────────────────────────────────── */
{
  check('one list still backs both views',
        (DEMO.match(/function galleryEntries\(/g) || []).length, 1);
  check('and the split is a filter on the drawing, not a second array',
        /const inView = e => galleryView==='mine'/.test(DEMO), true);
  check('what the customer built is what "mine" means',
        /function galleryIsMine\(e\)\{ return !!e && e\.origin==='personal'; \}/.test(DEMO), true);

  /* the factory's own saved shapes belong with the shipped ones: from the
     customer's side both are "what the factory offers" */
  const ctx = vm.createContext({});
  vm.runInContext('var galleryView="factory";' + grab('galleryIsMine'), ctx);
  const isMine = e => vm.runInContext('galleryIsMine(E)', Object.assign(ctx, { E: e }));
  check('a shipped shape is not mine', isMine({ origin: 'seed' }), false);
  check('a factory shape is not mine either', isMine({ origin: 'factory' }), false);
  check('one the customer saved is', isMine({ origin: 'personal' }), true);

  check('both tabs are 44px targets',
        /\.gal-tabs button\{[^}]*min-height:44px/.test(DEMO), true);
  check('and "my gallery" is offered even when it is empty, with an explanation',
        /עדיין לא שמרת צורות/.test(DEMO), true);
  check('while "nothing fits here" says that instead',
        /אף צורה משלך לא מתחברת במקום הזה/.test(DEMO), true);
}

/* ── where the personal library lives ─────────────────────────────────── */
{
  check('the customer card IS the phone', /id:\s*phone,\s*\/\/ phone = document id/.test(DB), true);
  check('and the personal library hangs off the same key',
        /LG_SHAPE_LIB \+ '\/personal\/' \+ p/.test(DB), true);
  check('the factory library is one shared node',
        /if \(scope === 'factory'\) return LG_SHAPE_LIB \+ '\/factory'/.test(DB), true);
  check('a personal save without a customer refuses rather than inventing one',
        /ספרייה אישית דורשת טלפון/.test(DB), true);
}

/* ── the round trip ───────────────────────────────────────────────────── */
/* save → catalogue entry → _stateFromAdd → the same state back */
{
  const st = vm.createContext({ Math, JSON, Object, Array, String, Number, console,
    LG_CAT_NUMS: cat.LG_CAT_NUMS });
  vm.runInContext('var NOTCH_DEF={notchW:200,notchH:500};' +
                  'function mkPS(){ return {slopeH1:2000,slopeH2:1800}; }' +
                  'function hingeHolesFromEngine(){ return [{role:"hinge"}]; }', st);
  vm.runInContext(grab('_stateFromAdd'), st);
  const back = add => (st.A = add, vm.runInContext('_stateFromAdd(A)', st));

  const notch = { kind: 'fixed', notch: true, notchSide: 'left',
                  notchW: 300, notchH: 600, notchHIn: 580, notchRest: 700 };
  const r1 = back(notch);
  check('a notch comes back at the size it was saved',
        [r1.notchW, r1.notchH, r1.notchHIn, r1.notchRest], [300, 600, 580, 700]);
  check('and not at the defaults it used to fall back to',
        r1.notchW === 200 && r1.notchH === 500, false);
  check('on the side it was saved on', r1.notchSide, 'left');

  const slope = { kind: 'fixed', slope: true, slopeH1: 2100, slopeH2: 1950,
                  slopeSideH: 'bottom' };
  const r2 = back(slope);
  check('a slope comes back at its own two heights',
        [r2.slopeH1, r2.slopeH2], [2100, 1950]);
  check('cut on the face it was saved on', r2.slopeSideH, 'bottom');

  const wide = { kind: 'fixed', slopeW1: 900, slopeW2: 840, slopeSideV: 'left' };
  const r3 = back(wide);
  check('a width slope comes back too', [r3.slopeW1, r3.slopeW2], [900, 840]);
  check('and switches itself on, or the engine would ignore the numbers',
        r3.hasSlopeW, true);

  /* the line that must not move */
  check('but the width and height are NOT restored — they are the order\'s',
        [back({ kind: 'fixed', notch: true, notchW: 300, notchH: 600 }).w,
         back({ kind: 'fixed' }).h], [undefined, undefined]);
}

/* ── what the save writes ─────────────────────────────────────────────── */
{
  const save = DEMO.slice(DEMO.indexOf('function shapeSaveOpen('),
                          DEMO.indexOf('async function shapeSaveTo('));
  check('the notch numbers are written', /'notchW','notchH','notchHIn','notchRest'/.test(save), true);
  check('the slope heights too', /'slopeH1','slopeH2'/.test(save), true);
  check('and the widths', /'slopeW1','slopeW2'/.test(save), true);
  check('each only when its own switch is on',
        /if\(add\.notch\)[\s\S]{0,140}if\(add\.slope\)[\s\S]{0,140}if\(ps\.hasSlopeW\)/.test(save), true);
  check('no width or height is ever written',
        /add\.(w|h)\s*=/.test(save), false);

  /* every flag the save writes must be one the catalogue accepts, or the
     entry validates on this screen and is thrown away on the next load */
  const written = (save.match(/add\.(\w+)\s*=/g) || [])
    .map(m => m.slice(4).replace(/\s*=$/, '').trim());
  const known = Object.keys(cat.LG_CAT_FLAGS || {}).concat(['kind', 'hingeSide']);
  check('the save writes no flag the catalogue would refuse',
        written.filter(f => known.indexOf(f) < 0), []);
  cat.LG_CAT_NUMS.forEach(k =>
    check(`  ${k} is a flag the catalogue knows`, known.indexOf(k) > -1, true));
}

/* ── a saved shape survives its own validator ─────────────────────────── */
{
  const ok = add => cat.lgCatalogValidate({ id: 'x', name: 'y', add });
  check('a notch with its numbers is valid',
        ok({ kind: 'fixed', notch: true, notchW: 300, notchH: 600 }), []);
  check('a slope with two different heights is valid',
        ok({ kind: 'fixed', slope: true, slopeH1: 2100, slopeH2: 1950 }), []);
  check('two equal heights are refused — that is not a slope',
        ok({ kind: 'fixed', slope: true, slopeH1: 2000, slopeH2: 2000 }).length > 0, true);
  check('one height alone is refused',
        ok({ kind: 'fixed', slope: true, slopeH1: 2000 }).length > 0, true);
  check('a notch width with no height is refused',
        ok({ kind: 'fixed', notch: true, notchW: 300 }).length > 0, true);
  check('zero is refused — it looks valid and returns a different shape',
        ok({ kind: 'fixed', notch: true, notchW: 0, notchH: 600 }).length > 0, true);

  /* flipping a saved slope swaps the real numbers, and twice returns it */
  const f1 = cat.lgFlipAdd({ kind: 'fixed', slope: true, slopeH1: 2100, slopeH2: 1950 });
  check('flipping a saved slope swaps its two heights',
        [f1.slopeH1, f1.slopeH2], [1950, 2100]);
  check('and drops the old flag, which would have flipped it twice',
        'slopeFlip' in f1, false);
  check('flipping back returns exactly the original',
        cat.lgFlipAdd(f1), { kind: 'fixed', slope: true, slopeH1: 2100, slopeH2: 1950 });
  /* a shipped shape has no numbers, so it still uses the flag */
  check('a shipped sloped shape still flips by flag',
        cat.lgFlipAdd({ kind: 'fixed', slope: true }).slopeFlip, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll gallery, code and round-trip checks passed.');
