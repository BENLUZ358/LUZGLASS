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

/* ── leaving, however it is done ──────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  /* the bar used to name the mode it was in. On an iPad that cost 52 pixels
     of height to say something the filled screen already says, so the title
     went and the X became a floating button — see the block further down. */
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
  /* Ben, 2026-09-17: full screen should show only the sketch, the
     numbers he can edit, and the X — the hint's own words were one of
     the "unnecessary things" he pointed at, so it is dropped entirely
     rather than repositioned. fitFullBottom already treats display:none
     as zero height, so hiding it hands that room back to the drawing. */
  check('the hint is dropped entirely in full screen, not just moved',
        /body\.sketch-full \.edit-hint\{display:none;\}/.test(DEMO), true);
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

/* ── the screen is the sketch, and nothing else ───────────────────────── */
/*
 * Ben on an iPad, 2026-09-17: full-screen editing still spent 52 pixels on a
 * bar whose whole content was the words "מצב עריכה" — two words you can read
 * off the screen itself, since the sketch is filling it. On an iPad in
 * portrait that bar is nearly 7% of the height, and height is exactly what
 * was short.
 *
 * So the bar stops being a bar. The X floats over the drawing, translucent,
 * and the canvas starts at the very top.
 */
{
  check('no bar spans the top any more',
        /body\.sketch-full #fullBar\{[^}]*right:0/.test(DEMO), false);
  check('the canvas starts at the top of the screen',
        /body\.sketch-full \.canvas-wrap\{[\s\S]{0,60}top:0/.test(DEMO), true);
  /* the phrase itself stays on the button that ENTERS the mode — what went
     is the copy of it that was costing 52 pixels while you were already in it */
  check('and the title that cost the height is gone',
        /fullBarTitle/.test(DEMO), false);
  check('while the button that opens the mode keeps its label',
        /id="btnEditMode"[^>]*>✎ מצב עריכה/.test(DEMO), true);

  check('the X floats at the top left', /#fullBar\{[\s\S]{0,140}left:8px/.test(DEMO), true);
  check('clear of the notch', /env\(safe-area-inset-top/.test(DEMO), true);
  check('the drawing shows through behind it',
        /#fullBar button\{[\s\S]{0,220}background:rgba\(255,255,255,0\.72\)/.test(DEMO), true);
  check('and it is still a 44px target, small as it looks',
        /#fullBar button\{[\s\S]{0,60}min-width:44px;min-height:44px/.test(DEMO), true);
  check('the label it lost from the screen it keeps for a reader',
        /aria-label="סגור וחזור"/.test(DEMO), true);
}

/* ── and the drawing fits the screen it is given ──────────────────────── */
/*
 * Ben on an iPad, 2026-09-17: the shape ran off the bottom and had to be
 * scrolled to be seen whole — which defeats a sketch, whose job is to be
 * compared against something at a glance.
 *
 * The first attempt asked lgLayout for a narrower canvas, and nothing moved.
 * The engine has a minimum of its own and refuses to go below it, on purpose:
 * "כל פאנל מקבל את הרוחב שהמידות שלו דורשות... שרטט מצייר גדול וגולל; הוא לא
 * מקטין את הסקיצה עד שאי אפשר לקרוא אותה." That rule is right, and it is not
 * the rule to bend.
 *
 * But it governs the RESOLUTION of the drawing, not the size it is shown at.
 * So the canvas keeps its full internal size and is displayed smaller —
 * exactly what DPR does in the other direction, which is why the result is
 * sharper rather than blurrier: more pixels inside than on screen.
 *
 * The clicks survive untouched because _canvasPoint already derives its ratio
 * from the rendered size rather than the requested one, and already handles
 * the two axes separately.
 */
{
  const fnOf = n => {
    const i = DEMO.indexOf('function ' + n + '(');
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };

  /* Two ways to shrink a drawing that is too tall, and they are not equal.
     Asking the engine for a narrower canvas makes it LAY THE DIMENSIONS OUT
     AGAIN at that scale, so the numbers stay their normal size against the
     glass. Shrinking the display shrinks the numbers with everything else.
     The first is always better, so it is tried first — and the engine's
     refusal is what makes the second necessary at all.

     This is exactly why one pane looked worse than two on Ben's iPad: the
     engine only applies its minimum from two panes up, so a single pane was
     drawn large and tall and every bit of the shrinking fell on the display.

     A third call mirrors this in the other direction: in full-screen edit
     mode on a phone, a drawing much shorter than the available height left
     dead space below it, because the display is never stretched past its
     own resolution either (setupCanvas caps its scale at 1). So the engine
     is asked for a WIDER canvas instead, and kept only if it actually grew
     without crossing the height available — same shape of guard as the
     shrink direction, just aimed the other way. */
  const draw = fnOf('drawFromEngine');
  check('the engine is asked to draw smaller before the display is shrunk',
        (draw.match(/lgLayout\(/g) || []).length, 3);
  check('and the second layout is only kept when the engine actually obeyed',
        /if\(L2\.canvas\.h<L\.canvas\.h\) L=L2;/.test(draw), true);
  check('and growing to fill full-screen height accepts any improvement, same as shrinking does',
        /if\(L3\.canvas\.h>L\.canvas\.h\) L=L3;/.test(draw), true);
  check('with a floor on what is asked of it',
        /want>=LG_MIN_ENGINE_W/.test(draw), true);
  check('named once, beside the other', /const LG_MIN_ENGINE_W = \d+;/.test(DEMO), true);

  /* the drawing is centred once it is narrower than its wrapper.
     It never was before — the canvas always filled the width or overflowed it
     — so RTL had nothing to push. The moment the height fit started shrinking
     it, a narrow block element went to the right edge and took the shape with
     it. The shape itself was never off-centre: it fills the canvas. */
  check('a canvas narrower than its wrapper is centred',
        /canvas\{[^}]*margin-inline:auto/.test(DEMO), true);
  check('and it may still be wider and scroll — auto margins collapse there',
        /\.canvas-wrap\{[^}]*overflow-x:auto/.test(DEMO), true);
  check('nothing stretches it back to the wrapper',
        /canvas\{[^}]*width:100%/.test(DEMO), false);

  /* the + sits on the canvas, and the canvas is not always where the wrapper
     starts: the page is dir="rtl", and a narrow block element goes to the
     RIGHT edge while #addBtns spans the wrapper and measures from the left */
  const add = fnOf('renderAddButtons');
  check('the + is placed from the canvas origin, not the wrapper corner',
        /const ox=C\.offsetLeft\|\|0, oy=C\.offsetTop\|\|0;/.test(add), true);
  check('on both axes', /const x=ox\+\(g\.x\+g\.w\)\*k, y=oy\+\(g\.y\+g\.h\/2\)\*k;/.test(add), true);
  check('and it still scales with the rendered width',
        /const k=\(C\.clientWidth\|\|lastL\.canvas\.w\)\/lastL\.canvas\.w;/.test(add), true);

  const setup = fnOf('setupCanvas');
  check('the internal size is still the full drawing',
        /C\.width=cW\*DPR; C\.height=cH\*DPR;/.test(setup), true);
  check('and only the displayed size is reduced',
        /C\.style\.width=\(cW\*k\)\+'px'; C\.style\.height=\(cH\*k\)\+'px';/.test(setup), true);
  check('the fit is taken from both axes',
        /cW>box\.w[\s\S]{0,80}cH\*k>box\.h/.test(setup), true);
  check('there is a floor — below it a dimension cannot be read at all',
        /k<LG_MIN_VIEW_SCALE/.test(setup), true);
  check('and it is named once', /const LG_MIN_VIEW_SCALE = 0\.\d+;/.test(DEMO), true);
  check('a small drawing is never blown up to fill the space',
        /if\(k>1\) k=1;/.test(setup), true);

  /* the engine's own minimum is left exactly as it was */
  const eng = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');
  check("the engine still refuses to shrink below what the dimensions need",
        /if\(need>cW\) cW=need;/.test(eng), true);
  /* we do ask it for less, and we accept the refusal rather than work around
     it — that acceptance is the `L2.canvas.h < L.canvas.h` guard above */
  check('the screen asks for less but never overrides the answer',
        /canvasW:want/.test(DEMO) && /if\(L2\.canvas\.h<L\.canvas\.h\)/.test(DEMO), true);

  const box = fnOf('_availCanvasBox');
  check('full screen measures the wrapper, which is pinned to the window',
        /full \? \(w\.clientHeight\|\|0\)/.test(box), true);
  check('and the normal mode measures what is left of the window below it',
        /window\.innerHeight - r\.top/.test(box), true);
  check('a missing wrapper means no limit, not a zero-sized drawing',
        /if\(!w\) return \{w:0,h:0\}/.test(box), true);

  /* the property that makes the whole approach safe */
  const pt = fnOf('_canvasPoint');
  check('hits are mapped from the rendered size, so shrinking cannot break them',
        /rect\.width\s*\?\s*\(cw \/ rect\.width\)/.test(pt), true);
  check('with each axis on its own ratio',
        /const sy = rect\.height/.test(pt), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll full-screen editing checks passed.');
