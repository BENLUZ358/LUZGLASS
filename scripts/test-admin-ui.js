#!/usr/bin/env node
/**
 * UI regression checks for admin.html.
 *
 * These encode decisions that are easy to undo by accident — especially the
 * gold split, which is counter-intuitive: --gold-text is the accessible choice
 * on light surfaces and the WRONG choice on dark ones, where plain --gold wins.
 *
 * Run: node scripts/test-admin-ui.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'lg-ui.css'), 'utf8');

let failed = 0;
const fail = (name, detail) => { failed++; console.error('FAIL  ' + name + (detail ? '\n      ' + detail : '')); };
const pass = (name) => console.log('ok    ' + name);
const check = (name, cond, detail) => cond ? pass(name) : fail(name, detail);

/* ── contrast maths, so the thresholds are checked and not just asserted ── */
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = h => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const token = name => (css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,6})')) || [])[1];

/* ── 1. tokens actually meet the ratios their comments claim ───────────── */
const T = {
  gold:      token('gold'),
  goldText:  token('gold-text'),
  onGold:    token('on-gold'),
  muted:     token('muted'),
  mutedDark: token('muted-dark'),
  text:      token('text'),
  bg:        token('bg'),
  surface:   token('surface'),
};
for (const [k, v] of Object.entries(T)) if (!v) fail(`token --${k} is missing from lg-ui.css`);

if (!failed) {
  check('--muted reaches 4.5:1 on --bg',        ratio(T.muted, T.bg) >= 4.5,        ratio(T.muted, T.bg).toFixed(2));
  check('--gold-text reaches 4.5:1 on --bg',    ratio(T.goldText, T.bg) >= 4.5,     ratio(T.goldText, T.bg).toFixed(2));
  check('--on-gold reaches 4.5:1 on --gold',    ratio(T.onGold, T.gold) >= 4.5,     ratio(T.onGold, T.gold).toFixed(2));
  check('--gold reaches 4.5:1 on --text (dark)',ratio(T.gold, T.text) >= 4.5,       ratio(T.gold, T.text).toFixed(2));
  check('--muted-dark reaches 4.5:1 on --text', ratio(T.mutedDark, T.text) >= 4.5,  ratio(T.mutedDark, T.text).toFixed(2));

  /* The counter-intuitive half: prove --gold-text would FAIL on dark, so the
     split is justified and nobody "simplifies" it back into one token. */
  check('--gold-text genuinely fails on dark, justifying the two-token split',
        ratio(T.goldText, T.text) < 4.5,
        'if this ever passes, the split can be collapsed');
}

/* ── 2. admin.html must not reintroduce its own tokens ─────────────────── */
check('admin.html defines no :root block', !/:root\s*\{/.test(html),
      'tokens belong in lg-ui.css only');
check('admin.html links lg-ui.css',  /lg-ui\.css/.test(html));
check('admin.html links lg-icons.js', /lg-icons\.js/.test(html));

/* ── 3. type floor ─────────────────────────────────────────────────────── */
const small = [...html.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n < 12);
check('no font-size below 12px', small.length === 0,
      small.length ? `found ${small.length}: ${[...new Set(small)].sort().join(', ')}px` : '');

/* ── 4. no white text on a gold fill (was 2.92:1) ──────────────────────── */
const whiteOnGold = html.match(/background:\s*(?:var\(--gold\)|#b8922a)\s*;\s*color:\s*#fff\b/gi) || [];
check('no white text on a gold background', whiteOnGold.length === 0,
      whiteOnGold.length ? whiteOnGold[0] : '');

/* ── 5. gold-as-text on the dark surfaces must stay --gold ─────────────── */
const DARK_SELECTORS = [
  '.sb-logo .lg span', '.sb-bot a:hover', '.unav-logo .lg span',
  '.unav-a.active', '.unav-topbar .lg span', '#sqTopBar .sq-logo span',
];
for (const sel of DARK_SELECTORS) {
  const rule = html.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}'));
  if (!rule) { fail(`dark-surface selector "${sel}" not found — did it get renamed?`); continue; }
  check(`"${sel}" uses --gold, not --gold-text (dark surface)`,
        !/--gold-text/.test(rule[0]), rule[0]);
}

/* ── 6. the deleted broken @media must not come back ───────────────────── */
check('the orphaned "/* replaced */" CSS block is gone',
      !/\/\*\s*replaced\s*\*\//.test(html),
      'that block applied mobile rules at every width and forced .stats to 2 columns');

/* ── 7. every <style> block still balances ─────────────────────────────── */
const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
blocks.forEach((b, i) => {
  const clean = b.replace(/\/\*[\s\S]*?\*\//g, '');
  const o = (clean.match(/\{/g) || []).length, c = (clean.match(/\}/g) || []).length;
  check(`<style> block ${i + 1} has balanced braces`, o === c, `${o} open / ${c} close`);
});

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll admin UI checks passed.');
