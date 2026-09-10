#!/usr/bin/env node
/**
 * One picking list, both tabs, glass and hardware together.
 *
 * The shape tab showed hardware only, and the combination tab showed
 * nothing at all. Glass is most of the price, so a list without it says
 * almost nothing — and two renderers would have been two truths about one
 * order, which is the thing this project keeps fighting.
 *
 * It is built on lgOrderLines, which already merges the two into lines
 * carrying a CATALOGUE KEY — the combination a SKU will be derived from.
 * The engine knows types, never part numbers: a part number inside the
 * engine would tie it to one customer's catalogue, and a contractor with
 * different hardware would need the engine changed. The mapping arrives
 * from outside, from Hashavshevet's price list.
 *
 * Run: node scripts/test-bom-view.js
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

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
vm.runInContext('function _shEsc(s){return String(s);}', ctx);
vm.runInContext(DEMO.match(/const LG_HW_HE=\{[\s\S]*?\};/)[0], ctx);
vm.runInContext(grab('renderBom'), ctx);

/* a shower with two glass thicknesses, so grouping has something to do */
function bom(states) {
  ctx.P = [
    { type: 'fixed', wallSide: 'right', carriesDoor: true },
    { type: 'door', wallSide: 'none', hingeSide: 'right', handleSide: 'left', hingeOnFixed: 'prev' },
    { type: 'fixed', wallSide: 'left' },
  ];
  ctx.S = states;
  ctx.SH = vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', ctx);
  ctx.EL = { style: {}, innerHTML: '' };
  vm.runInContext('renderBom(EL,SH)', ctx);
  return { html: ctx.EL.innerHTML, shown: ctx.EL.style.display,
           lines: vm.runInContext('lgOrderLines(SH)', ctx),
           totals: vm.runInContext('lgGlassTotals(SH)', ctx) };
}
const MIXED = { 0: { w: 500, h: 2000, thickness: 8 },
                1: { w: 800, h: 1985, thickness: 8 },
                2: { w: 500, h: 2000, thickness: 10 } };

console.log('');

/* ── glass is there, and it is what the engine counted ──────────────────── */
{
  const r = bom(MIXED);
  check('the list is shown', r.shown, 'block');
  check('glass has its own heading', r.html.indexOf('זכוכית') > -1, true);
  check('and hardware its own', r.html.indexOf('פרזול') > -1, true);

  /* every line the engine produced is on the screen */
  const glass = r.lines.filter(l => l.key.kind === 'glass');
  check('both thicknesses are grouped separately', glass.length, 2);
  glass.forEach(l => {
    check(`  ${l.key.thickness}mm shows its area`, r.html.indexOf(l.qty + ' מ"ר') > -1, true);
    check('  and its thickness', r.html.indexOf(l.key.thickness + ' מ"מ') > -1, true);
  });

  const hw = r.lines.filter(l => l.key.kind === 'hardware');
  check('every piece of hardware is listed', hw.length > 0, true);
  hw.forEach(l => {
    const he = vm.runInContext('LG_HW_HE[' + JSON.stringify(l.key.type) + ']', ctx);
    check(`  ${l.key.type} is named in Hebrew`, r.html.indexOf(he) > -1, true);
  });
}

/* ── the cut sizes are what the cutter receives ─────────────────────────── */
{
  const r = bom(MIXED);
  const cuts = vm.runInContext('lgGlass(SH).map(function(g){return g.cutW+"×"+g.cutH;})', ctx);
  cuts.forEach(c => check('the cut size ' + c + ' appears', r.html.indexOf(c) > -1, true));
}

/* ── the totals come from the engine, not re-added on screen ────────────── */
{
  const r = bom(MIXED);
  check('the total area is the engine\'s', r.html.indexOf(r.totals.m2 + ' מ"ר') > -1, true);
  check('and so is the weight', r.html.indexOf(r.totals.kg + ' ק"ג') > -1, true);
  check('and the hole count', r.html.indexOf(r.totals.holes + ' קדחים') > -1, true);
  check('and the number of panes', r.html.indexOf(r.totals.panes + ' לוחות') > -1, true);
}

/* ── glass with no thickness chosen says so rather than lying ───────────── */
{
  const r = bom({ 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 }, 2: { w: 500, h: 2000 } });
  check('an unchosen thickness is named, not left blank',
        r.html.indexOf('עובי לא נבחר') > -1, true);
  check('and the area is still counted',
        r.lines.some(l => l.key.kind === 'glass' && l.qty > 0), true);
}

/* ── an empty shower shows nothing at all ───────────────────────────────── */
{
  ctx.SH = { boundary: { right: 'wall', left: 'open' }, finish: 'shahor',
             quality: 'zamak', shapes: [] };
  ctx.EL = { style: {}, innerHTML: '' };
  vm.runInContext('renderBom(EL,SH)', ctx);
  check('an empty canvas has no list', ctx.EL.style.display, 'none');
  check('and leaves nothing behind', ctx.EL.innerHTML, '');
}

/* ── one renderer, both tabs ────────────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;
  check('the shape tab uses it', has('renderBom(bomEl, sh);'), true);
  check('the combination tab uses the same one',
        has('renderBom(el, _lgShowerOf(getPanels(), getPStates()));'), true);
  check('there is only one renderer', (DEMO.match(/function renderBom\(/g) || []).length, 1);
  check('and the screen adds nothing up itself — the engine does',
        /function renderBom[\s\S]{0,1600}lgGlassTotals\(shower\)/.test(DEMO), true);

  /* the screen must not invent part numbers either */
  check('no part numbers are hard-coded on the screen',
        /sku\s*:\s*['"][A-Z0-9]/.test(DEMO), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll picking-list checks passed.');
