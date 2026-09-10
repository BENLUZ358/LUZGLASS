#!/usr/bin/env node
/**
 * Editing opens full screen, and closing puts everything back.
 *
 * The change is presentation and nothing else. No element moves in the
 * DOM, no listener is re-registered, and no function gains a second path:
 * a class goes on <body>, the wrapper fills the screen, and draw() runs
 * because the canvas takes its width from the wrapper.
 *
 * What this file holds down is the SEPARATION. Entering must change only
 * the size; leaving must restore exactly what was there before — the same
 * panes, the same states, the same drawing. And the rules of shapes, the
 * `+`, flipping, dimensions and alignment must not notice any of it.
 *
 * One real trap, and it is why the CSS exists: `.canvas-wrap` is
 * `overflow-y: hidden`. Normally its height follows the canvas and the
 * PAGE scrolls. Pinned to the viewport it would clip a 2000mm pane, so
 * full screen switches it to auto — inside the full-screen class only.
 *
 * Run: node scripts/test-full-edit.js
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

/* just enough browser for the two mode functions to run for real */
function screen() {
  const cls = new Set();
  const props = {};
  /* the three bottom controls, with heights a real browser would report */
  const BARS = { editBar:  { h: 56, shown: () => true },
                 pickBar:  { h: 52, shown: c => c.pickMode },
                 editHint: { h: 40, shown: c => c.editMode } };
  const nodes = {};
  const el = id => nodes[id] || (nodes[id] = {
    id, style: { display: '', setProperty(){} }, textContent: '',
    classList: { toggle(){}, contains(){ return false; }, add(){}, remove(){} },
    setAttribute(){}, querySelector(){ return null; },
    get offsetHeight(){ return BARS[id] ? BARS[id].h : 0; },
  });
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set,
    document: {
      body: { classList: { toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); },
                           contains: c => cls.has(c) },
              style: { setProperty: (k, v) => { props[k] = v; } } },
      getElementById: el,
    },
    /* display follows the same rules the page's own code applies */
    getComputedStyle: e => ({
      display: BARS[e.id] && !BARS[e.id].shown({
        editMode: vm.runInContext('editMode', ctx),
        pickMode: vm.runInContext('pickMode', ctx),
      }) ? 'none' : 'block',
    }),
  });
  vm.runInContext('let editMode=false, pickMode=false, pickIdx=0;' +
    'let DREW=0; function draw(){ DREW++; }' +
    'function closeDimEditor(){} function renderPickBar(){}' +
    'function pickOrder(){ return [{id:"a"},{id:"b"}]; }' +
    'var C={classList:{toggle:function(){}}};', ctx);
  ['fitFullBottom', 'syncFullEdit', 'exitFullEdit', 'setEditMode', 'setPickMode'].forEach(n =>
    vm.runInContext(grab(n), ctx));
  return { ctx, cls, props, run: e => vm.runInContext(e, ctx) };
}

console.log('');

/* ── entering and leaving, each on its own ─────────────────────────────── */
{
  const s = screen();
  check('nothing is full screen to begin with', s.cls.has('sketch-full'), false);

  s.run('setEditMode(true)');
  check('edit mode opens full screen', s.cls.has('sketch-full'), true);
  check('and the drawing is rebuilt for the new width', s.run('DREW') > 0, true);

  s.run('setEditMode(false)');
  check('leaving edit mode puts it back', s.cls.has('sketch-full'), false);
  check('the bottom space is released too', s.props['--full-bottom'], '0px');
}
{
  const s = screen();
  s.run('setPickMode(true)');
  check('advanced edit opens full screen too', s.cls.has('sketch-full'), true);
  s.run('setPickMode(false)');
  check('and closing it puts that back as well', s.cls.has('sketch-full'), false);
}

/* ── the X leaves whatever is open ──────────────────────────────────────── */
{
  const s = screen();
  s.run('setEditMode(true)');
  s.run('exitFullEdit()');
  check('the X closes plain editing', [s.run('editMode'), s.cls.has('sketch-full')], [false, false]);

  s.run('setPickMode(true)');
  s.run('exitFullEdit()');
  check('and advanced editing', [s.run('pickMode'), s.cls.has('sketch-full')], [false, false]);

  /* both at once: one press must not leave the other stranded full screen */
  s.run('setEditMode(true); setPickMode(true);');
  check('both modes together are still one full screen', s.cls.has('sketch-full'), true);
  s.run('exitFullEdit()');
  check('and the X leaves both', [s.run('editMode'), s.run('pickMode')], [false, false]);
  check('so nothing stays pinned to the screen', s.cls.has('sketch-full'), false);
}

/* ── one mode closing must not drag the other out of full screen ────────── */
{
  const s = screen();
  s.run('setEditMode(true); setPickMode(true);');
  s.run('setPickMode(false)');
  check('closing advanced edit leaves plain editing full screen',
        [s.run('editMode'), s.cls.has('sketch-full')], [true, true]);
  s.run('setEditMode(false)');
  check('and only the last one out turns it off', s.cls.has('sketch-full'), false);
}

/* ── the space kept for the controls is measured, not guessed ──────── */
/* editBar 56, pickBar 52, editHint 40 in this harness. A guessed constant
   would have to be right for every mode, font size and screen width at
   once; when it is wrong the drawing is quietly cut off behind them. */
{
  const s = screen();

  s.run('setEditMode(true)');
  check('plain editing keeps room for the bar and its hint',
        s.props['--full-bottom'], '96px');            // 56 + 40
  check('and the hint is told to sit above the bar',
        s.props['--full-bar-h'], '56px');
  check('with nothing reserved for a pick bar that is not there',
        s.props['--full-pick-h'], '0px');

  s.run('setPickMode(true)');
  check('opening advanced edit makes room for its bar too',
        s.props['--full-bottom'], '148px');           // 56 + 52 + 40
  check('and the hint now clears both',
        [s.props['--full-bar-h'], s.props['--full-pick-h']], ['56px', '52px']);

  s.run('setPickMode(false)');
  check('closing it gives the room back',
        s.props['--full-bottom'], '96px');

  s.run('setEditMode(false)');
  check('and leaving releases all of it',
        s.props['--full-bottom'], '0px');
}

{
  /* advanced edit on its own: no hint, so no room for one */
  const s = screen();
  s.run('setPickMode(true)');
  check('advanced edit alone reserves only the two bars',
        s.props['--full-bottom'], '108px');           // 56 + 52
}

{
  /* out of full screen the measurement must not leave anything behind */
  const s = screen();
  s.run('setEditMode(true)');
  s.run('exitFullEdit()');
  check('the ordinary view reserves nothing', s.props['--full-bottom'], '0px');
}

/* ── the bar names the mode it is in ────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the title follows the mode',
        has("t.textContent = pickMode ? 'עריכה מתקדמת' : 'מצב עריכה'"), true);
  check('the X is a 44px target',
        /#fullBar button\{[^}]*min-height:44px/.test(DEMO), true);
  check('and Escape leaves the same way the X does',
        /Escape[\s\S]{0,200}exitFullEdit\(\)/.test(DEMO), true);
  check('with the dimension editor closing first, being the top layer',
        /dimEditor[\s\S]{0,80}closeDimEditor\(\); return;/.test(DEMO), true);
}

/* ── the trap: a tall drawing must not be clipped ───────────────────────── */
{
  check('the wrapper clips vertically in the ordinary view',
        /\.canvas-wrap\{[^}]*overflow-y:hidden/.test(DEMO), true);
  check('but scrolls vertically when it fills the screen',
        /body\.sketch-full \.canvas-wrap\{[^}]*overflow-y:auto/.test(DEMO), true);
  check('and it is pinned rather than flowing',
        /body\.sketch-full \.canvas-wrap\{[^}]*position:fixed/.test(DEMO), true);
  check('leaving room at the bottom for the controls',
        /body\.sketch-full \.canvas-wrap\{[^}]*bottom:var\(--full-bottom/.test(DEMO), true);
  check('and each control sits on the height of the one below it',
        /body\.sketch-full \.pick-bar\{bottom:var\(--full-bar-h/.test(DEMO), true);
  check('the hint above both of them',
        /body\.sketch-full \.edit-hint\{bottom:calc\(var\(--full-bar-h[^)]*\) \+ var\(--full-pick-h/.test(DEMO), true);

  /* the bug this replaced: #pickBar is in the DOM even when hidden, so a
     sibling combinator matched always and swallowed the hint in plain
     edit mode — the one mode whose whole instruction lives in it */
  check('no sibling rule hides the hint whenever pickBar merely exists',
        /\.pick-bar ~ \.edit-hint/.test(DEMO), false);
}

/* ── presentation only: no logic moved ──────────────────────────────────── */
{
  const body = n => {
    const i = DEMO.indexOf('function ' + n + '(');
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const full = body('syncFullEdit');

  /* the full-screen switch must not touch shapes, rules or dimensions */
  check('full screen does not touch the shape list', /shapeList/.test(full), false);
  check('nor the rules engine', /lgValidate|_legalVariant|allowedAt/.test(full), false);
  check('nor dimensions', /dimHits|_dimWrite|lgLayout/.test(full), false);
  check('it only sets a class and redraws',
        /classList\.toggle\('sketch-full'[\s\S]*draw\(\);/.test(full), true);

  /* the exit has no behaviour of its own — it calls the same functions the
     buttons call, so the two can never drift apart */
  const exit = body('exitFullEdit');
  check('the X reuses the buttons\' own functions',
        /setPickMode\(false\)[\s\S]*setEditMode\(false\)/.test(exit), true);
  check('and adds nothing else', /sketch-full|classList/.test(exit), false);

  /* nothing was moved in the markup */
  check('the canvas still lives in its wrapper',
        /<div class="canvas-wrap" id="canvasWrap">\s*<canvas id="sk">/.test(DEMO), true);
  check('and the full-screen bar is the only thing added',
        (DEMO.match(/id="fullBar"/g) || []).length, 1);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll full-screen editing checks passed.');
