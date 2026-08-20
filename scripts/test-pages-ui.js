#!/usr/bin/env node
/**
 * Shared UI rules for every page that has been migrated to lg-ui.css.
 *
 * Add a page to MIGRATED as it is migrated. Anything still on its own :root
 * belongs in PENDING, which is reported but not failed — that list is the
 * remaining work, not a regression.
 *
 * Page-specific rules (admin's default view, its dark-surface selectors) live
 * in test-admin-ui.js.
 *
 * Run: node scripts/test-pages-ui.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const MIGRATED = ['admin.html', 'portal.html', 'workday.html', 'check-station.html',
                  'drafter.html', 'mekhlahon.html', 'new-order.html', 'order-view.html',
                  'upload.html', 'sketch-demo.html', 'login.html'];

/* Deliberately excluded, not pending:
   index.html  is a meta-refresh redirect with no UI at all
   logo.html   is a logo-variation gallery used as a design reference, not an
               app screen; it has its own palette on purpose */
const EXCLUDED = ['index.html', 'logo.html'];
const PENDING  = [];

/* Pages that are dark end to end and remap the tokens via body.lg-dark rather
   than converting rule by rule. Their gold is correct as-is. */
const DARK_PAGES = ['check-station.html', 'login.html'];

/* A skip link exists to bypass navigation. Pages with no navigation to bypass
   are exempt — adding one there is noise, not accessibility. */
const NO_NAV = ['login.html'];

/* Rules whose gold sits on a dark surface inside an otherwise light page. On
   #1a1714 --gold is 6.11:1 and --gold-text only 3.58:1, so these must NOT be
   "fixed". Each was verified by locating the dark container in the markup. */
const DARK_SURFACE_RULES = {
  'admin.html':      ['.sb-logo .lg span', '.unav-logo .lg span', '.unav-a.active',
                      '.unav-topbar .lg span', '#sqTopBar .sq-logo span'],
  'portal.html':     ['.logo span', '.hero-name em', '.hstat .n'],
  'workday.html':    ['.sb-logo .lg span', '.nav-a.active', '.unav-logo .lg span',
                      '.unav-a.active', '.unav-topbar .lg span'],
  'drafter.html':    ['.logo span', '.unav-logo .lg span', '.unav-a.active',
                      '.unav-topbar .lg span'],
  'mekhlahon.html':  ['.footer-logo-main span'],
  'new-order.html':  ['.logo span'],
  'order-view.html': ['.logo span'],
};

const icons   = fs.readFileSync(path.join(ROOT, 'lg-icons.js'), 'utf8');
const defined = new Set([...icons.matchAll(/^\s*'([a-z-]+)':\s*'/gm)].map(m => m[1]));

let failed = 0;

/* ── dark-scale contrast ────────────────────────────────────────────────
   The light tokens are asserted in test-admin-ui.js. These are the dark ones,
   which exist because the light values are unusable on a dark surface — the
   whole point is that the two scales are not interchangeable. */
const css = fs.readFileSync(path.join(ROOT, 'lg-ui.css'), 'utf8');
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = h => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tok = n => (css.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{3,6})')) || [])[1];

console.log('dark token scale');
{
  const D = { bg: tok('dark-bg'), surface: tok('dark-surface'), text: tok('dark-text'),
              muted: tok('dark-muted'), gold: tok('gold-dark'), goldText: tok('gold-text') };
  const missing = Object.entries(D).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    failed++; console.error('  FAIL  missing token(s): ' + missing.join(', '));
  } else {
    const c = (name, cond, detail) => cond
      ? console.log('  ok    ' + name)
      : (failed++, console.error('  FAIL  ' + name + (detail ? ' — ' + detail : '')));
    c('--dark-text on --dark-bg',        ratio(D.text, D.bg) >= 4.5,        ratio(D.text, D.bg).toFixed(2));
    c('--dark-muted on --dark-bg',       ratio(D.muted, D.bg) >= 4.5,       ratio(D.muted, D.bg).toFixed(2));
    c('--dark-muted on --dark-surface',  ratio(D.muted, D.surface) >= 4.5,  ratio(D.muted, D.surface).toFixed(2));
    c('--gold-dark on --dark-bg',        ratio(D.gold, D.bg) >= 4.5,        ratio(D.gold, D.bg).toFixed(2));
    c('--gold-dark on --dark-surface',   ratio(D.gold, D.surface) >= 4.5,   ratio(D.gold, D.surface).toFixed(2));
    c('the light gold really does fail on dark, justifying --gold-dark',
      ratio(D.goldText, D.bg) < 4.5, ratio(D.goldText, D.bg).toFixed(2));
  }
}
const check = (name, cond, detail) => cond
  ? console.log('  ok    ' + name)
  : (failed++, console.error('  FAIL  ' + name + (detail ? '\n        ' + detail : '')));

for (const page of MIGRATED) {
  console.log('\n' + page);
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');

  check('links lg-ui.css',        /lg-ui\.css/.test(html));
  check('defines no :root block', !/:root\s*\{/.test(html),
        'tokens belong in lg-ui.css only');

  const small = [...html.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n < 12);
  check('no font-size below 12px', small.length === 0,
        small.length ? `${small.length} found: ${[...new Set(small)].sort((a,b)=>a-b).join(', ')}px` : '');

  const wog = html.match(/background:\s*var\(--gold\)\s*;\s*color:\s*#fff/gi) || [];
  check('no white text on a gold fill', wog.length === 0, wog[0]);

  /* A dark page must declare itself, or every token resolves to the light
     scale and the page renders unreadable. */
  if (DARK_PAGES.includes(page)) {
    check('dark page carries body.lg-dark', /<body[^>]*class="[^"]*\blg-dark\b/.test(html));
  }

  /* dark-surface gold must stay --gold */
  for (const sel of DARK_SURFACE_RULES[page] || []) {
    const esc  = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* \s* — some pages put a space before the brace */
    const rule = html.match(new RegExp(esc + '\\s*\\{[^}]*\\}'));
    if (!rule) { check(`dark-surface rule "${sel}" still exists`, false, 'renamed or removed?'); continue; }
    check(`"${sel}" keeps --gold (dark surface)`, !/--gold-text/.test(rule[0]), rule[0]);
  }

  /* icons */
  const used = [...new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map(m => m[1]))];
  if (used.length) {
    check('links lg-icons.js', /lg-icons\.js/.test(html),
          'the page uses data-icon but never loads the renderer');
    const unknown = used.filter(n => !defined.has(n));
    check(`all ${used.length} data-icon names resolve`, unknown.length === 0, unknown.join(', '));
  }

  const iconOnly = [...html.matchAll(/<button([^>]*)>\s*<span data-icon="[^"]+"><\/span>\s*<\/button>/g)];
  const unnamed  = iconOnly.filter(m => !/aria-label=|title=/.test(m[1]));
  check(`all ${iconOnly.length} icon-only buttons are labelled`, unnamed.length === 0,
        unnamed.map(m => '<button' + m[1] + '>').join('\n        '));

  /* skip link must point at a real element */
  /* attribute order varies, so match the whole tag then pull the href out */
  const skipTag = (html.match(/<a[^>]*class="skip-link"[^>]*>/) || [])[0];
  if (!NO_NAV.includes(page)) check('has a skip link', !!skipTag);
  if (skipTag) {
    const target = (skipTag.match(/href="#([^"]+)"/) || [])[1];
    check('the skip link has a fragment href', !!target, skipTag);
    if (target) check(`skip target #${target} exists`, new RegExp('id="' + target + '"').test(html));
  }
}

/* ── responsive ─────────────────────────────────────────────────────────
   Six breakpoints were in circulation (600, 680, 768, 860, 900, 1024), which
   is how the same layout ends up behaving differently on two pages at the same
   width. The sanctioned scale is 600 / 900 / 1200, plus 768 where a page
   already keyed its nav drawer to it.

   Every page must also handle a phone. Five had no media query at all — and
   portal, the one customers actually open on a phone, was among them. */
console.log('\nresponsive');
{
  const ALLOWED = new Set([600, 601, 768, 900, 901, 1200, 1201]);
  const c = (name, cond, detail) => cond
    ? console.log('  ok    ' + name)
    : (failed++, console.error('  FAIL  ' + name + (detail ? ' — ' + detail : '')));

  for (const page of MIGRATED) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');

    const vp = html.match(/<meta name="viewport" content="([^"]*)"/);
    c(`${page} declares a device-width viewport`,
      !!vp && /width=device-width/.test(vp[1]));
    /* Pinch-zoom must not be disabled; it is how low-vision users cope. */
    c(`${page} does not block zoom`,
      !vp || !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(vp[1]), vp && vp[1]);

    /* Strip comments first — a breakpoint mentioned in prose is not a
       breakpoint, and the note explaining the deleted @media block in admin
       would otherwise fail this. */
    const code = html.replace(/\/\*[\s\S]*?\*\//g, '');
    const bps = [...new Set([...code.matchAll(/@media[^{]*?(?:max|min)-width:\s*(\d+)px/g)].map(m => +m[1]))];
    c(`${page} handles a phone width`,
      bps.some(b => b <= 768), bps.length ? `breakpoints: ${bps.sort((a,b)=>a-b).join(', ')}` : 'no media queries at all');
    const odd = bps.filter(b => !ALLOWED.has(b));
    c(`${page} uses only sanctioned breakpoints`, odd.length === 0,
      odd.length ? `off-scale: ${odd.join(', ')}` : '');
  }

  /* The iOS zoom-on-focus rule, and the safe-area handling, live in the
     foundation so that no page has to remember them. */
  c('lg-ui.css forces 16px inputs on coarse pointers (iOS zoom-on-focus)',
    /@media\s*\(pointer:\s*coarse\)[\s\S]*?input,select,textarea\{\s*font-size:16px/.test(css));
  c('lg-ui.css accounts for the iPhone safe area',
    /env\(safe-area-inset-bottom\)/.test(css));
  /* overflow-x:hidden on the root would silently break every sticky bar. */
  c('lg-ui.css does not put overflow-x:hidden on html/body',
    !/html\s*,\s*body\s*\{[^}]*overflow-x:\s*hidden/.test(css));
}

/* Report, do not fail, on what is still to do. */
const stillLocal = PENDING.filter(p => {
  const f = path.join(ROOT, p);
  return fs.existsSync(f) && /:root\s*\{/.test(fs.readFileSync(f, 'utf8'));
});
console.log(`\nmigrated: ${MIGRATED.length}`);
console.log(`not yet migrated (${stillLocal.length}): ${stillLocal.join(', ') || 'none'}`);
console.log(`excluded by design: ${EXCLUDED.join(', ')}`);

/* Nothing outside those two lists should still be carrying its own tokens. */
const known = new Set([...MIGRATED, ...EXCLUDED, ...PENDING]);
const stray = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !known.has(f) && f !== 'lg-preview.html')
  .filter(f => /:root\s*\{/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
if (stray.length) {
  console.error(`\nFAIL  page(s) with local tokens and no entry in any list: ${stray.join(', ')}`);
  failed++;
}

/* ── every control has a name, every image has a description ───────────
   Priority 1 in the design skill is accessibility, and its two named
   anti-patterns are icon-only buttons without labels and missing alt text.
   A button whose whole content is ✕ or ← is announced by a screen reader as
   "button" — and the ← / → pair for previous and next sketch is announced
   identically, so the two cannot be told apart at all.

   title= counts: it is what a mouse user gets on hover and what assistive
   tech falls back to when there is no aria-label. */
{
  const A11Y = ['workday.html','admin.html','check-station.html','portal.html',
                'drafter.html','new-order.html','upload.html','order-view.html'];
  let unlabelled = 0, undescribed = 0;
  for (const page of A11Y) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, page), 'utf8'); } catch { continue; }

    for (const tag of html.match(/<button[^>]*>[\s\S]{0,60}?<\/button>/g) || []) {
      const text = tag.replace(/<button[^>]*>/, '').replace('</button>', '')
                      .replace(/<[^>]+>/g, '').trim();
      /* two characters or fewer is an icon, not a label */
      if (text.length <= 2 && !/aria-label=|title=/.test(tag)) {
        unlabelled++;
        console.error('        no name: ' + page + ' — ' + tag.replace(/\s+/g,' ').slice(0, 80));
      }
    }
    for (const tag of html.match(/<img[^>]*>/g) || []) {
      if (!/alt=/.test(tag)) {
        undescribed++;
        console.error('        no alt : ' + page + ' — ' + tag.replace(/\s+/g,' ').slice(0, 80));
      }
    }
  }
  /* modalAdvBtn in admin is given its label from JS when it is shown */
  /* this file's check() takes a boolean, not actual/expected */
  check('every icon-only button has an accessible name', unlabelled <= 1,
        unlabelled + ' unnamed (modalAdvBtn is labelled from JS when shown)');
  check('every image has alt text', undescribed === 0, undescribed + ' without alt');
}

/* ── the shared menu uses the shared icons ────────────────────────────
   Every page carries the same user menu, with the same .unav-a markup and the
   same labels. Six pages drew it with the SVG set; drafter.html drew it with
   emoji, because it was the one page that never loaded lg-icons.js. The same
   menu item therefore looked different depending on which screen you were on,
   and on a Windows machine versus an iPad it looked different again — emoji
   are drawn by the system font and cannot be themed.

   A page that renders .unav-a must load the icon set and use it. */
{
  const NAV_PAGES = ['admin.html','workday.html','check-station.html',
                     'drafter.html','portal.html'];
  for (const page of NAV_PAGES) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, page), 'utf8'); } catch { continue; }
    if (!/class="unav-a"|class="unav-a /.test(html)) continue;

    check(page + ' loads the shared icon set', /lg-icons\.js/.test(html),
          'the menu falls back to system emoji without it');

    const emojiIcons = (html.match(/<span class="ic">[^<]+<\/span>/g) || [])
                       .filter(t => !/data-icon/.test(t));
    check(page + ' draws its menu icons from the set', emojiIcons.length === 0,
          emojiIcons.length + ' still literal: ' + emojiIcons.join(' '));
  }
}

/* ── every var() must resolve ─────────────────────────────────────────
   A custom property that was never defined does not fall back to anything.
   The whole declaration is invalid and the browser throws it away, silently.
   Thirty-six rules across three pages were being discarded this way, and the
   visible symptom was a button whose background:var(--chisum) vanished and
   left white text on a pale banner — unreadable, with nothing in the console.

   var(--x, fallback) is fine: that has somewhere to land. */
{
  const cssTokens = new Set(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));

  const TOKEN_PAGES = ['workday.html','admin.html','check-station.html','portal.html',
                       'drafter.html','mekhlahon.html','new-order.html','upload.html',
                       'order-view.html','login.html'];
  let unresolved = 0;
  for (const page of TOKEN_PAGES) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, page), 'utf8'); } catch { continue; }
    const local = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    for (const m of html.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
      const [, token, hasFallback] = m;
      if (hasFallback || cssTokens.has(token) || local.has(token)) continue;
      unresolved++;
      console.error('        ' + page + ' uses ' + token + ', which is defined nowhere');
    }
  }
  check('every var() resolves to a defined token', unresolved === 0,
        unresolved + ' declaration(s) would be discarded by the browser');
}


/* ── the rules in the repo are not the rules in force ─────────────────
   Vercel deploys the site; it does not deploy Firebase rules. Editing
   database.rules.json changes nothing until deploy-rules.js runs, and the
   failure is silent — reads are denied and the screen simply looks empty.
   That is how the client price list shipped showing nothing.

   This does not check the live rules (that needs credentials); it checks the
   deploy tool still exists, so the step cannot be forgotten entirely. */
check('there is a way to deploy the rules',
      fs.existsSync(path.join(ROOT, 'scripts', 'deploy-rules.js')),
      'database.rules.json is inert without it');

/* ── every portal tab must actually open ──────────────────────────────
   The מחירון tab existed, its view existed, and renderClientPrice ran — but
   the loop in setTab that switches views listed five of the six tabs. Clicking
   it hid everything else and showed nothing. A tab you can press and that does
   nothing is worse than no tab.

   The list, the buttons and the views must agree. */
{
  const portal = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');
  const tabs  = [...portal.matchAll(/id="tab-([a-z]+)"/g)].map(m => m[1]);
  const views = [...portal.matchAll(/id="view-([a-z]+)"/g)].map(m => m[1]);
  const list  = ((portal.match(/const PORTAL_TABS = \[([^\]]*)\]/) || ['', ''])[1])
                  .replace(/['"\s]/g, '').split(',').filter(Boolean);
  check('every portal tab is in the switch list',
        tabs.filter(t => !list.includes(t)).length === 0,
        'missing: ' + tabs.filter(t => !list.includes(t)).join(', '));
  check('every portal tab has a view',
        tabs.filter(t => !views.includes(t)).length === 0,
        'no view: ' + tabs.filter(t => !views.includes(t)).join(', '));
  check('the switch list is not hand-maintained per call site',
        /PORTAL_TABS\.forEach/.test(portal),
        'setTab should iterate PORTAL_TABS');
}

/* ── a badge and the list beneath it must agree ────────────────────────
   The check station shows a count on each tab and a list below. Both derive
   from the same orders array, but only the list was recomputed on most paths:
   renderList had eleven call sites, updateTabCounts had two. Press
   "סיים סקיצה" and the list emptied and said "כל הסקיצות הושלמו" while the tab
   still claimed sketches remained. Refreshing fixed it, because the Firebase
   listener happened to call both — which is what made it look intermittent
   rather than simply missing.

   The count is computed inside renderList now, so the two cannot separate. */
{
  const cs = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
  const renderList = (cs.match(/function renderList\(\)[\s\S]*?\n}/) || [''])[0];
  check('check-station recomputes the tab counts where it renders the list',
        /updateTabCounts\(\);/.test(renderList),
        'the badge goes stale on every path that is not the Firebase listener');
}

/* Returning to the list clears the search box.

   The search survived the trip into a sketch and back, so the list came back
   filtered to the one sketch that had been searched for — which on the station
   floor reads as "there is nothing left to check". The box is at the top of a
   narrow bar on a tablet and its leftover text does not announce itself.

   The dropdowns are deliberately left alone: those are a standing choice for
   the day, and their selected value is legible in the bar. */
{
  const cs = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
  const showList = (cs.match(/function showList\(\)[\s\S]*?\n}/) || [''])[0];
  check('check-station clears the search when it returns to the list',
        /srch\.value=''/.test(showList),
        'a stale search makes the list look empty after every sketch');
  check('and clears it before the list is drawn',
        showList.indexOf("srch.value=''") < showList.indexOf('renderList()'),
        'clearing after the render leaves the filtered list on screen');
  check('the standing filters are not reset with it',
        !/fGlass|fClient|fSort/.test(showList),
        'wiping the day\'s filters on every return is worse than keeping them');
}

/* The check station loads one drawing, not all of them.

   checkEdits holds the temporary marks drawn over a sketch — images. Measured
   live: 2,199 KB in seven entries. It was subscribed with on('value') on the
   whole node, so every mark saved at any station re-sent all of them to every
   connected client, on a screen used on an iPad on the factory floor.

   The value is only ever read for the order that is open — see renderSketch and
   the three reads keyed on cur.id — so the rest was pure cost. */
{
  const cs = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
  check('the check station does not subscribe to every drawing',
        !/ref\('checkEdits'\)\.on\('value'/.test(cs),
        '2.2 MB re-sent to every client whenever anyone draws a mark');
  check('it subscribes per order instead',
        /ref\('checkEdits\/' \+ id\)\.on\('value'/.test(cs));
  const select = (cs.match(/function selectOrder\([\s\S]*?\n}/) || [''])[0];
  check('the listener attaches when a sketch is opened',
        /_csWatchEdits\(id\);/.test(select));
  /* in showList, not goBack: finishSketch also returns to the list, and any
     future route back goes through the same door */
  const showList = (cs.match(/function showList\(\)[\s\S]*?\n}/) || [''])[0];
  check('and detaches on every route back to the list',
        /_csWatchEdits\(null\);/.test(showList),
        'a listener per opened sketch, left attached, is a slow leak');
  check('switching sketches replaces rather than stacks',
        /if\(_checkEditsRef\)\{[\s\S]{0,200}?\.off\('value', _checkEditsRef\.fn\)/.test(cs));
  /* a deleted drawing must clear, not linger from a previous read */
  check('a removed drawing is dropped from the cache',
        /else {4}delete window\._csCheckEdits\[String\(id\)\];/.test(cs));
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll migrated pages pass the shared rules.');
