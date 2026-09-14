#!/usr/bin/env node
/**
 * The glass chosen on screen has to be the glass the order records.
 *
 * When the glass chooser moved to Hashavshevet's items, `selG` stopped
 * holding an id ('shafu') and started holding a NAME ('שקוף'). Three
 * places still looked it up by id, so `GL.find(...)` returned undefined —
 * and one of those three builds the order. Pressing "סיים הזמנה" threw on
 * `g.name`, which means the order could not be placed at all.
 *
 * One resolver now, matched by name. And a type the old price list has
 * never heard of returns price `null`, not 0: a total computed from zero
 * looks exactly like a real total, and nobody downstream can tell.
 *
 * Run: node scripts/test-order-glass.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const GL = eval(DEMO.match(/const GL=\[[\s\S]*?\];/)[0].replace('const GL=', ''));
const glassOf = selG => GL.filter(x => x.name === selG)[0] || { id: null, name: selG, price: null };

console.log('');

/* ── the lookup ───────────────────────────────────────────────────────── */
{
  check('the chooser holds a name, not an id', /let selMM=8, selG='שקוף'/.test(DEMO), true);
  check('and nothing looks it up by id any more',
        /GL\.find\(x=>x\.id===selG\)/.test(DEMO), false);
  check('there is one resolver', (DEMO.match(/function glassOf\(\)/g) || []).length, 1);
  check('and all three callers use it',
        (DEMO.match(/const g=glassOf\(\)/g) || []).length, 3);

  check('a known type resolves', glassOf('שקוף').price, 200);
  check('and keeps its name', glassOf('שקוף').name, 'שקוף');
}

/* ── a type the old price list never had ──────────────────────────────── */
{
  const g = glassOf('חלבי');
  check('an unknown type still resolves to something', !!g, true);
  check('so nothing throws where the order is built', g.name, 'חלבי');
  check('but its price is null, not zero', g.price, null);
  check('which is not the same as free', g.price === 0, false);
}

/* ── and a missing price is said, not swallowed ───────────────────────── */
{
  check('the order total is left empty when there is no price',
        /const total=g\.price!=null\s*\r?\n?\s*\? Math\.round/.test(DEMO), true);
  check('the panel says so instead of showing a number',
        /אין מחיר לסוג הזה במחירון/.test(DEMO), true);
  check('and the thickness shown is the one that was chosen',
        /זכוכית: \$\{selMM\}מ״מ \$\{g\.name\}/.test(DEMO), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-glass checks passed.');
