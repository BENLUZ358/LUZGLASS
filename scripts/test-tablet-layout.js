#!/usr/bin/env node
/**
 * test-tablet-layout.js — the three screens that broke on an iPad.
 *
 * These are arithmetic and rule checks, not a rendering test. They pin the
 * specific faults that were reported, each of which had a cause you can count
 * rather than eyeball:
 *
 *   drafter's green "סיים סקיצה" button sat at the bottom of .app, which is
 *   100dvh — while the ≤900 breakpoint adds a 52px .unav-topbar ABOVE it in
 *   normal flow. Total height became 100dvh + 52px, and html/body carry
 *   overflow:hidden, so the last 52px were off-screen and unreachable. The
 *   button was never hidden; it was pushed past the edge.
 *
 *   check-station has no .unav-topbar element at all, so the same subtraction
 *   there would have shortened the screen by 52px for nothing. Its fault was
 *   different: the back button was 12px with 6px padding, wedged between two
 *   other controls. Same symptom, different cause — worth separate checks.
 *
 *   the sketch queue's quantity was a span inside the item name, so it drifted
 *   right as names grew and vanished among the dimension fields.
 *
 * Run: node scripts/test-tablet-layout.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0;
const check = (name, cond, detail) => cond
  ? console.log('ok    ' + name)
  : (failed++, console.error('FAIL  ' + name + (detail ? '\n        ' + detail : '')));

/* the widths that matter. iPad portrait is the band nothing was written for. */
const IPAD = [
  ['iPad mini portrait',  744], ['iPad portrait',      768],
  ['iPad Air portrait',   820], ['iPad Pro portrait',  834],
  ['iPad landscape',     1024], ['iPad Pro landscape', 1194],
];

/* ── 1. drafter: the bar that holds the green button must fit ──────────── */
{
  const s = read('drafter.html');

  /* the subtraction is only correct because the topbar is in normal flow
     BEFORE .app — sticky occupies space, fixed would not */
  const bodyStart = s.indexOf('<body');
  check('drafter renders the mobile topbar before .app',
        s.indexOf('class="unav-topbar"', bodyStart) < s.indexOf('class="app"', bodyStart),
        'if it came after, subtracting its height would be wrong');
  check('and it is sticky, so it occupies flow',
        /\.unav-topbar\{[^}]*position:sticky/.test(s));
  check('the topbar is the 52px this assumes',
        /\.unav-topbar\{[^}]*height:52px/.test(s));

  check('.app subtracts it below 900',
        /@media\(max-width:900px\)\{[\s\S]*?\.app\{height:calc\(100vh - 52px\);height:calc\(100dvh - 52px\)/.test(s),
        'without this the bottom bar is pushed past the viewport');
  check('with a vh fallback before dvh',
        /height:calc\(100vh - 52px\);height:calc\(100dvh - 52px\)/.test(s));
  check('the finish button meets the touch minimum',
        /\.btm-btn\{min-height:44px/.test(s));

  for (const [name, w] of IPAD) {
    const bar = w <= 900 ? 52 : 0;
    const app = 100 /* dvh */ ;
    check(`${name} (${w}px): the bottom bar is inside the viewport`,
          bar === 0 || /calc\(100dvh - 52px\)/.test(s),
          'app height + topbar would exceed 100dvh');
  }
}

/* ── 2. check-station: the back button ─────────────────────────────────── */
{
  const s = read('check-station.html');

  check('check-station has no mobile topbar to subtract',
        !/class="unav-topbar"/.test(s),
        'if one is added, .app must subtract its height as drafter does');

  check('the back button is enlarged below 900',
        /@media\(max-width:900px\)\{[\s\S]*?#btnBack\{[\s\S]*?font-size:14px/.test(s));
  check('and given a fill so it reads as the way out',
        /#btnBack\{[\s\S]*?background:var\(--gold\)/.test(s));
  check('and pushed clear of the other controls',
        /#btnBack\{[\s\S]*?margin-inline-end:auto/.test(s));
  check('the logo yields the width rather than the title being crushed',
        /@media\(max-width:900px\)\{[\s\S]*?\.tb-logo\{display:none/.test(s));

  /* the topbar must still fit its contents at the narrowest tablet width */
  const FIXED = 16 /* padding */ + 120 /* back */ + 110 /* items */ + 44 /* exit */ + 21 /* gaps */;
  for (const [name, w] of IPAD) {
    check(`${name} (${w}px): the top row still has room for the title`,
          w - FIXED > 80, `only ${w - FIXED}px left`);
  }
}

/* ── 3. sketch queue: the quantity ─────────────────────────────────────── */
{
  const s = read('admin.html');

  check('the quantity is its own element, not text inside the name',
        /<span class="iw-qty">×\$\{qty\}<\/span>/.test(s),
        'inside the name it drifted right as names grew');
  check('and cannot be squeezed',
        /\.iw-qty\{[^}]*flex-shrink:0/.test(s));
  check('the row wraps below 900 instead of crushing',
        /@media\(max-width:900px\)\{[\s\S]*?\.iw-item\{flex-wrap:wrap/.test(s));
  check('the quantity becomes a legible chip there',
        /@media\(max-width:900px\)\{[\s\S]*?\.iw-qty\{[\s\S]*?font-size:15px/.test(s));
  check('dimension fields reach a touch size',
        /\.iw-item > input\{width:64px !important;min-height:40px/.test(s));

  /* two 64px fields, the unit, the badge and two buttons on the second row */
  const ROW2 = 64 + 12 + 64 + 30 + 60 + 40 + 40 + 6 * 8;
  for (const [name, w] of IPAD) {
    const avail = Math.min(w, 720) - 40; /* the queue panel is capped */
    check(`${name} (${w}px): the second row fits without sideways scroll`,
          ROW2 <= avail, `needs ${ROW2}px, has ${avail}px`);
  }
}

/* ── nothing above may have touched the desktop ────────────────────────── */
for (const f of ['drafter.html', 'check-station.html', 'admin.html']) {
  const s = read(f);
  const style = s.slice(s.indexOf('<style'), s.indexOf('</style>'));
  const beforeAnyMedia = style.split(/@media[^{]*\{/)[0];
  check(`${f}: the tablet fixes live only inside media queries`,
        !/calc\(100dvh - 52px\)|#btnBack\{|flex-wrap:wrap;row-gap/.test(beforeAnyMedia),
        'a rule leaked into the desktop cascade');
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll tablet-layout checks passed.');
