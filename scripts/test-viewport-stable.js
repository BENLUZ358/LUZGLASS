#!/usr/bin/env node
/**
 * Scrolling is not resizing (QA doc 2026-09-25, TEST 06).
 *
 * On an iPhone, plain scrolling changed the size of the sketch. The same
 * 500×2000 shape was drawn 200×574, then 287×824, then 343×986 — one page,
 * three scroll positions, nothing edited.
 *
 * The room the canvas may fill was measured as
 *     window.innerHeight − wrapper.getBoundingClientRect().top
 * and BOTH terms move while scrolling: rect.top is relative to the viewport,
 * so it shrinks as the page goes up; innerHeight grows when Safari hides its
 * toolbar, and Safari announces that with a `resize` event, which redrew.
 * On a desktop there is no toolbar, but any redraw after scrolling — an
 * edit, a tap on a dimension — landed on the same moving number.
 *
 * The rule now: the room is measured from where the wrapper sits in the
 * DOCUMENT, against a viewport height that only a real change updates —
 * a new width (rotation, window resize) or, where there is no touch
 * toolbar at all, a real height change. Toolbars and the on-screen
 * keyboard change height only, and are ignored on touch devices.
 *
 * Run: node scripts/test-viewport-stable.js
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

const fnOf = n => {
  const i = DEMO.indexOf('function ' + n + '(');
  if (i < 0) return '';
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
};

const NEEDED = ['_isCoarsePointer', '_stableViewportH', '_availCanvasBox', '_onViewportResize'];
NEEDED.forEach(n => check('the page defines ' + n, fnOf(n).length > 0, true));
if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }

// A page whose canvas wrapper sits DOC_TOP pixels down the document.
function makePage({ coarse, w, h, docTop, full }) {
  const win = { innerWidth: w, innerHeight: h, scrollY: 0,
                matchMedia: q => ({ matches: /coarse/.test(q) ? coarse : false }) };
  const wrap = { clientWidth: w - 32, clientHeight: 600,
                 getBoundingClientRect: () => ({ top: docTop - win.scrollY }) };
  const doc = { getElementById: id => id === 'canvasWrap' ? wrap : null,
                body: { classList: { contains: c => c === 'sketch-full' ? !!full : false } } };
  const ctx = vm.createContext({ window: win, document: doc, Math, console,
                                 draws: 0, fitFullBottom() {}, draw() { ctx.draws++; } });
  // the functions refer to window.* and to bare let-bindings; declare those
  vm.runInContext(
    DEMO.match(/let _stableVH[^\n]*\n/)[0] +
    NEEDED.map(fnOf).join('\n'), ctx);
  return { win, ctx, box: () => vm.runInContext('_availCanvasBox()', ctx),
           resize: () => vm.runInContext('_onViewportResize()', ctx) };
}

/* ── iPhone ── */
{
  const P = makePage({ coarse: true, w: 375, h: 700, docTop: 238 });
  const top = P.box().h;
  check('at the top of the page nothing changes from before: innerHeight − top − 12',
        top, 700 - 238 - 12);

  P.win.scrollY = 300;
  check('scrolling does not change the room', P.box().h, top);

  // Safari hides its toolbar while scrolling and says so with `resize`
  P.win.innerHeight = 780; P.resize();
  check('the toolbar hiding does not redraw', P.ctx.draws, 0);
  check('and does not change the room either', P.box().h, top);

  // the on-screen keyboard opening while a dimension is edited
  P.win.innerHeight = 400; P.resize();
  check('the keyboard opening does not redraw', P.ctx.draws, 0);
  check('nor shrink the sketch under the editor', P.box().h, top);

  // rotation is a real change: the width moves
  P.win.scrollY = 0; P.win.innerWidth = 812; P.win.innerHeight = 340; P.resize();
  check('rotating redraws', P.ctx.draws, 1);
  check('and fits the new screen', P.box().h, Math.max(0, 340 - 238 - 12));
}

/* ── iPad: same Safari, same toolbar ── */
{
  const P = makePage({ coarse: true, w: 768, h: 950, docTop: 238 });
  const top = P.box().h;
  P.win.scrollY = 700; P.win.innerHeight = 1024; P.resize();
  check('iPad: scroll + toolbar leave the room alone', P.box().h, top);
  check('iPad: and nothing is redrawn', P.ctx.draws, 0);
}

/* ── desktop: no toolbar, but redraws after scrolling moved the canvas ── */
{
  const P = makePage({ coarse: false, w: 1280, h: 800, docTop: 238 });
  const top = P.box().h;
  P.win.scrollY = 700;
  check('desktop: a redraw after scrolling sees the same room', P.box().h, top);
  // a real window resize on a desktop is a real change
  P.win.innerHeight = 600; P.resize();
  check('desktop: resizing the window redraws', P.ctx.draws, 1);
  check('desktop: and fits the smaller window', P.box().h, 600 - 238 - 12);
}

/* ── full screen is untouched: the wrapper is pinned to the window ── */
{
  const P = makePage({ coarse: true, w: 375, h: 700, docTop: 0, full: true });
  check('full screen still measures the pinned wrapper', P.box().h, 600);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll viewport-stability checks passed.');
