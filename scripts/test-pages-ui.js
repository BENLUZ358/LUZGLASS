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

const MIGRATED = ['admin.html', 'portal.html'];
const PENDING  = ['workday.html', 'check-station.html', 'drafter.html', 'mekhlahon.html',
                  'new-order.html', 'order-view.html', 'sketch-demo.html', 'upload.html',
                  'login.html', 'logo.html', 'index.html'];

/* Rules whose gold sits on a dark surface, per page. On #1a1714 --gold is
   6.11:1 and --gold-text only 3.58:1, so these must NOT be "fixed". */
const DARK_SURFACE_RULES = {
  'admin.html':  ['.sb-logo .lg span', '.unav-logo .lg span', '.unav-a.active',
                  '.unav-topbar .lg span', '#sqTopBar .sq-logo span'],
  'portal.html': ['.logo span', '.hero-name em', '.hstat .n'],
};

const icons   = fs.readFileSync(path.join(ROOT, 'lg-icons.js'), 'utf8');
const defined = new Set([...icons.matchAll(/^\s*'([a-z-]+)':\s*'/gm)].map(m => m[1]));

let failed = 0;
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

  /* dark-surface gold must stay --gold */
  for (const sel of DARK_SURFACE_RULES[page] || []) {
    const esc  = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = html.match(new RegExp(esc + '\\{[^}]*\\}'));
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
  check('has a skip link', !!skipTag);
  if (skipTag) {
    const target = (skipTag.match(/href="#([^"]+)"/) || [])[1];
    check('the skip link has a fragment href', !!target, skipTag);
    if (target) check(`skip target #${target} exists`, new RegExp('id="' + target + '"').test(html));
  }
}

/* Report, do not fail, on what is still to do. */
const stillLocal = PENDING.filter(p => {
  const f = path.join(ROOT, p);
  return fs.existsSync(f) && /:root\s*\{/.test(fs.readFileSync(f, 'utf8'));
});
console.log(`\nnot yet migrated (${stillLocal.length}): ${stillLocal.join(', ') || 'none'}`);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll migrated pages pass the shared rules.');
