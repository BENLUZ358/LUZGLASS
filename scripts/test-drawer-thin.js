#!/usr/bin/env node
/**
 * Holds the drawer to being a drawer.
 *
 * This file replaces test-shapes-drawer.js and test-dim-lanes.js, which
 * between them held 166 checks — 102 of them regexes over the drawer's
 * source. They asked whether `drawSinglePanel` existed and whether
 * `_dimPlace` was called. Both are now deleted, and the geometry they were
 * guarding lives in lg-layout.js where test-layout.js can measure it: do
 * these two labels overlap, is this number beside the thing it measures.
 *
 * String-matching tests are why every drawing bug in this project used to
 * pass every test. What is worth checking here is not a name but a
 * boundary: the drawer must not start computing again.
 *
 * Run: node scripts/test-drawer-thin.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

console.log('');

/* ── the engine is loaded, and before anything uses it ──────────────────── */
{
  const iShapes = DEMO.indexOf('lg-shapes.js');
  const iLayout = DEMO.indexOf('lg-layout.js');
  check('the rules engine is loaded', iShapes > -1, true);
  check('and so is the layout engine', iLayout > -1, true);
  check('both before the drawing code',
        iLayout < DEMO.indexOf('function draw('), true);
}

/* ── both modes go through the engine ───────────────────────────────────── */
{
  check('the combination mode asks the engine for its layout',
        /function drawComboMode[\s\S]{0,200}drawFromEngine/.test(DEMO), true);
  check('and the item mode does too',
        /function drawItemMode\b[\s\S]{0,400}lgLayout/.test(DEMO), true);
  check('the conversion is the engine\'s, not a second copy here',
        /function _lgShowerOf[\s\S]{0,300}lgFromPanels/.test(DEMO), true);
}

/* ── and the geometry has not crept back ────────────────────────────────── */
/* These names were the drawer's own positioning logic. Every one of them
   now has an owner in lg-layout.js. If one reappears here, two engines are
   computing the same drawing again — which is exactly the split that let a
   dimension land on the hinge it described. */
{
  const GONE = ['drawSinglePanel', '_dimPlace', '_dimLanesReset', '_heightDims',
                '_hwX', '_assemblyX', '_bracketHeights', '_leaderTo',
                '_lanesForWidth', '_marginFor', 'getPanelShape'];
  const back = GONE.filter(n => new RegExp('function\\s+' + n + '\\s*\\(').test(DEMO));
  check('no positioning function has come back to the drawer', back, []);
}

/* ── what the drawer still owns, and should ─────────────────────────────── */
/* Drawing, hit targets and editing stay here — they need a canvas and a
   pointer, and neither belongs in a pure module. */
{
  check('the drawer still paints', /function engPaint\s*\(/.test(DEMO), true);
  check('and still draws a dimension', /function engDim\s*\(/.test(DEMO), true);
  check('and still records touch targets', /dimHits\.push/.test(DEMO), true);
  check('with a 44px target, as the design rules require',
        /Math\.max\([^)]*,\s*44\)|,\s*44\)/.test(DEMO), true);
  check('and editing still writes back to the panel state',
        /function _dimWrite\s*\(/.test(DEMO), true);
}

/* ── every dimension the engine emits can be edited ─────────────────────── */
/* A number the fitter cannot correct is worse than no number: it looks
   authoritative and cannot be fixed on the spot. */
{
  const m = DEMO.match(/const ENG_FIELD=\{([\s\S]*?)\};/);
  check('the drawer maps dimension kinds to editable fields', !!m, true);
  if (m) {
    const kinds = [...m[1].matchAll(/'([a-z-]+)'\s*:/g)].map(x => x[1]);
    ['width', 'height', 'hinge-top', 'hinge-bot', 'bracket-top', 'bracket-bot',
     'handle-edge', 'handle-dist', 'notch-w', 'notch-h'].forEach(k =>
      check(`  ${k} can be edited`, kinds.includes(k), true));
  }
}

/* ── and every editable field has a label to open with ──────────────────── */
{
  const f = DEMO.match(/const DIM_FIELDS=\{([\s\S]*?)\n\};/);
  check('the edit fields are declared', !!f, true);
  if (f) {
    const named = [...f[1].matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map(x => x[1]);
    const m = DEMO.match(/const ENG_FIELD=\{([\s\S]*?)\};/);
    const used = m ? [...m[1].matchAll(/:\s*'([a-zA-Z]+)'/g)].map(x => x[1]) : [];
    const missing = used.filter(x => !named.includes(x));
    check('and nothing the engine emits opens an editor with no title', missing, []);
  }
}

/* ── a number on the drawing must open when tapped ──────────────────────── */
/* This is the check that was missing, and it cost a broken edit mode on the
   live site. Everything upstream was right — the engine emitted the
   dimension, the drawer registered the touch target, the click handler found
   it — and then _dimRead returned undefined for a field with no default, and
   openDimEditor returned without a sound. A number you can see and cannot
   touch, with nothing to show why. */
{
  const i = DEMO.indexOf('function _dimRead(t)');
  const read = i > -1 ? DEMO.slice(i, DEMO.indexOf('function _dimWrite', i)) : '';
  check('the value reader is found', read.length > 0, true);
  if (read) {
    const m = DEMO.match(/const ENG_FIELD=\{([\s\S]*?)\};/);
    const fields = m ? [...m[1].matchAll(/:\s*'([a-zA-Z]+)'/g)].map(x => x[1]) : [];
    /* Some fields are always on the panel state (w, h) and some only exist
       once they have been entered — a notch dimension is only drawn when
       there IS a notch. The rest are drawn from a default the engine knows,
       and those are the ones the reader has to know too. */
    const ALWAYS = ['w', 'h', 'notchW', 'notchH'];
    const missing = fields.filter(f => !ALWAYS.includes(f) && !read.includes("'" + f + "'"));
    check('every dimension drawn from a default can be read back', missing, []);
    check('and the reader refuses to return undefined',
          /if\(v==null\)\s*return null/.test(read), true);
  }
}

/* ── and the panel state is always there to read from ───────────────────── */
{
  const get = DEMO.match(/function getPS\(pfx,i\)\{([\s\S]*?)\n\}/);
  check('the state lookup is found', !!get, true);
  if (get) check('a shape with no state yet gets one rather than null',
                 /mkPS\(/.test(get[1]), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drawer checks passed.');
