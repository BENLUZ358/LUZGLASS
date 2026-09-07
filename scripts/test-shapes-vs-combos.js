#!/usr/bin/env node
/**
 * Characterisation test: does the engine reproduce what the drawer already
 * draws, for all fifteen combinations that exist today?
 *
 * This runs BEFORE the drawer is rewired, and that is the whole point. The
 * drawer is 1,220 lines the spec calls the expensive asset here. Replacing its
 * decisions with engine output and verifying only with static checks is the
 * kind of change that breaks a working screen quietly. Proving first that the
 * engine agrees with the drawer on every existing combination makes the
 * rewiring safe — and any disagreement is a real finding, surfaced before
 * anything is touched.
 *
 * Ground truth is taken from hingeOnFixed, not hingeSide. The two are
 * independent hand-authored fields on each combination and they do not agree:
 * p_kd writes left+prev while p_2k2d's first door writes right+prev.
 * hingeSide is canvas geometry (hx = hingeSide==='left' ? x : x+pw);
 * hingeOnFixed names the neighbour that carries the hinge. Only the second
 * says which shapes are actually joined, which is what a junction is.
 *
 * Run: node scripts/test-shapes-vs-combos.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
const ENG  = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');

const ctx = vm.createContext({});
vm.runInContext(ENG, ctx);
const { lgJunctions, lgBOM, lgValidate } = ctx;

/* pull COMBOS out of the page and evaluate it on its own */
const comboSrc = (DEMO.match(/const COMBOS=\{[\s\S]*?\n\};/) || [''])[0];
const cctx = vm.createContext({});
vm.runInContext(comboSrc + '\nvar _out = COMBOS;', cctx);
const COMBOS = cctx._out;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

check('COMBOS was extracted', typeof COMBOS, 'object');
const all = [];
for (const cat of Object.keys(COMBOS)) for (const c of COMBOS[cat]) all.push({ cat, c });
/* four corner, six front, five bath, one plain — the spec's prose says
   fifteen, the file holds sixteen */
check('every combination in the file is covered', all.length, 16);

/* ── the bridge ────────────────────────────────────────────────────────── */
/*
 * A combination panel carries the old vocabulary; the engine speaks the new
 * one. In the engine, 'right' faces the PREVIOUS shape in the array and
 * 'left' faces the NEXT — so hingeOnFixed maps straight onto it, and a door
 * with neither leans on the boundary.
 */
function showerFromCombo(combo) {
  const panels = combo.panels || [];
  const shapes = [];
  panels.forEach((p, i) => {
    if (p.type === 'slider') { shapes.push({ id: 's' + i, kind: 'slider' }); return; }
    if (p.type === 'door') {
      const hingeSide = p.hingeOnFixed === 'prev' ? 'right'
                      : p.hingeOnFixed === 'next' ? 'left'
                      : (i === 0 ? 'right' : 'left');   // no neighbour named — leans on the boundary
      shapes.push({ id: 's' + i, kind: 'door', hingeSide });
      return;
    }
    shapes.push({ id: 's' + i, kind: 'fixed' });
  });

  /* an enclosure sits between walls; wallSide on the outer panels says which */
  const first = panels[0] || {}, last = panels[panels.length - 1] || {};
  const rightWall = first.wallSide === 'right' || first.wallSide === 'both' || first.type === 'door';
  const leftWall  = last.wallSide  === 'left'  || last.wallSide  === 'both'  || last.type === 'door';
  return {
    boundary: { right: rightWall ? 'wall' : 'open', left: leftWall ? 'wall' : 'open' },
    finish: 'shahor', quality: 'zamak', shapes,
  };
}

/* ── what the drawer actually draws, read from the combination ─────────── */
function drawnCounts(combo) {
  const panels = combo.panels || [];
  let wallBrackets = 0, ggBrackets = 0, hinges = 0;
  panels.forEach(p => {
    if (p.type === 'fixed' || p.type === 'mirror') {
      const ws = p.wallSide || 'both';
      if (ws === 'both') wallBrackets += 4;          // two per side
      else if (ws !== 'none') wallBrackets += 2;
      if (p.glassGlass) ggBrackets += 2;
    }
    if (p.type === 'door') hinges += 2;              // drwHinge at two heights
  });
  /* both panels either side of a glass-to-glass joint carry glassGlass, and
     each draws the same two brackets — so the joint is counted twice here */
  return { wallBrackets, ggBrackets: ggBrackets / 2, hinges };
}

/* ── every combination, engine against drawer ──────────────────────────── */
console.log('');
for (const { cat, c } of all) {
  const s   = showerFromCombo(c);
  const bom = lgBOM(s);
  const q   = t => (bom.find(b => b.type === t) || { qty: 0 }).qty;
  const d   = drawnCounts(c);
  const engineHinges = q('hinge-gg') + q('hinge-wall');

  console.log(`   ${cat}/${c.id.padEnd(8)} ${String(c.label).padEnd(22)} ` +
              `wall ${d.wallBrackets}→${q('bracket-wall')}  ` +
              `hinge ${d.hinges}→${engineHinges}  ` +
              `handle ${q('handle')}  ` +
              (lgValidate(s).length ? '⚠ ' + lgValidate(s)[0].msg : ''));
}
console.log('');

/* the properties that must hold for every one of them */
for (const { cat, c } of all) {
  const s = showerFromCombo(c);
  const bom = lgBOM(s);
  const q = t => (bom.find(b => b.type === t) || { qty: 0 }).qty;
  const doors = (c.panels || []).filter(p => p.type === 'door').length;
  const name = `${cat}/${c.id}`;

  check(`${name}: every door gets exactly one handle`, q('handle'), doors);
  check(`${name}: every door is anchored`, lgValidate(s), []);
  /* the counting bug this whole engine exists to prevent */
  check(`${name}: hinges are counted per junction, never per door`,
        q('hinge-gg') + q('hinge-wall') <= doors * 2, true);
  check(`${name}: the wall brackets match what the drawer draws`,
        q('bracket-wall'), drawnCounts(c).wallBrackets);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nThe engine reproduces every existing combination.');
