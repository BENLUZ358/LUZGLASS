#!/usr/bin/env node
/**
 * The geometry itself is checked, not just the numbers
 * (QA doc 2026-09-25, TEST 09 and what the TEST 08 photographs showed).
 *
 *   • A free hole "850 from the left" on a 500-wide glass was drawn outside
 *     the glass and nobody said a word.
 *   • A cutout 350 from the right, 200 wide, on the same glass stuck out past
 *     the edge; the only message that existed blamed "a slope or a step",
 *     which were not there.
 *   • A step cutout whose tail + rest do not add up to the width (250 + 350
 *     on 500) was silently drawn with a slanted inner wall.
 *
 * The step case must not block the installer — it must ask what they meant:
 * first check whether a slope already on the glass explains it; if not, the
 * sheet asks which slope it is (in the step's width, in its height, or on the
 * glass's own edge) and then needs only the missing number.
 *
 * Run: node scripts/test-geometry-validate.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const showerOf = (panels, ps) => { ctx.PN = panels; ctx.PS = ps;
  return vm.runInContext("lgFromPanels(PN,PS,{finish:'shahor',quality:'zamak'})", ctx); };
const issues = sh => { ctx.SH = sh; return vm.runInContext('lgGeometryIssues(SH)', ctx); };
const errors = sh => { ctx.SH = sh; return vm.runInContext('lgValidate(SH)', ctx); };
const codes = list => list.map(i => i.code);

const SHAPE = [{ type: 'shape', label: 'צורה' }];

/* ── TEST 08 as photographed: hole at 850 and cutout 2 at 350 on a 500 glass ── */
{
  const sh = showerOf(SHAPE, { 0: { w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1950,
    cutouts: [{ w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 50 },  y: { from: 'bottom', mm: 1200 } },
              { w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 350 }, y: { from: 'bottom', mm: 1000 } }],
    holes: [{ role: 'hole', dia: 12, x: { from: 'left', mm: 850 }, y: { from: 'bottom', mm: 1600 } }] } });
  const is = issues(sh);
  check('the hole outside the glass is reported', is.some(i => i.code === 'hole-out' && i.n === 1), true);
  check('cutout 2 sticking out is reported, by its number', is.some(i => i.code === 'cut-out' && i.n === 2), true);
  check('cutout 1, which fits, is not', is.some(i => i.code === 'cut-out' && i.n === 1), false);
  check('the message names the element, and blames no slope',
        is.filter(i => i.code === 'cut-out').every(i => /פינוי 2/.test(i.msg) && !/משופעת|מדרגה/.test(i.msg)), true);
  check('lgValidate carries them, so every screen that shows errors shows these',
        errors(sh).some(e => /קדח 1/.test(e.msg)) && errors(sh).some(e => /פינוי 2/.test(e.msg)), true);
}

/* ── a hole whose edge crosses the glass edge ── */
{
  const sh = showerOf(SHAPE, { 0: { w: 500, h: 2000,
    holes: [{ role: 'hole', dia: 20, x: { from: 'left', mm: 5 }, y: { from: 'bottom', mm: 900 } }] } });
  check('a hole that breaks through the edge is reported', codes(issues(sh)), ['hole-edge']);
}

/* ── a clean glass has nothing to say ── */
{
  const sh = showerOf(SHAPE, { 0: { w: 500, h: 2000,
    cutouts: [{ w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 50 }, y: { from: 'bottom', mm: 1200 } }],
    holes: [{ role: 'hole', dia: 12, x: { from: 'left', mm: 150 }, y: { from: 'bottom', mm: 1600 } }] } });
  check('a glass that fits raises nothing', issues(sh), []);
}

/* ── step cutouts ── */
const ROW = [{ type: 'fixed', wallSide: 'right', label: 'קבוע' }, { type: 'door', label: 'דלת', hingeOnFixed: 'prev' },
             { type: 'fixed', wallSide: 'left', label: 'קבוע' }];
const step = extra => showerOf(ROW, { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 },
  2: Object.assign({ w: 500, h: 2000, notchW: 250, notchH: 500, notchSide: 'right' }, extra) });
{
  check('a straight step that closes the width is fine (250 + 250 = 500)',
        codes(issues(step({ notchRest: 250 }))), []);
  const open = issues(step({ notchRest: 350 }));
  check('a step that does not close (250 + 350 on 500) is flagged', codes(open), ['notch-open']);
  check('with the numbers the installer needs to understand it',
        [open[0].sum, open[0].width], [600, 500]);
  check('as a question, not a wall', /שיפוע/.test(open[0].msg), true);

  // each of the three answers makes it a legal glass
  check('answer: the slope is in the step width — accepted as drawn',
        codes(issues(step({ notchRest: 350, notchFix: 'width' }))), []);
  check('answer: the slope is in the step height — accepted',
        codes(issues(step({ notchRest: 350, notchFix: 'height', notchHIn: 460 }))), []);
  check('answer: the glass edge itself slopes — the slope on the glass closes it',
        codes(issues(step({ notchRest: 350, hasSlopeW: true, slopeW1: 500, slopeW2: 600, slopeSideV: 'right' }))), []);

  // "height" means the step is square in width: the rest follows from the width
  ctx.SH = step({ notchRest: 350, notchFix: 'height', notchHIn: 460 });
  const ol = vm.runInContext('lgOutline(SH)', ctx)[2];
  check('a height-sloped step is square in width: its foot is 250 in from the edge',
        Math.round(ol.cut.foot[0]), 250);
}

/* ── a step that already meets a slope on the glass: nothing to ask ── */
{
  check('a slope already on the glass that closes the step raises no question',
        codes(issues(step({ notchRest: 350, hasSlopeW: true, slopeW1: 500, slopeW2: 600 }))), []);
}

/* ── a polygon that crosses itself is caught ── */
{
  const X = vm.runInContext('_lgPolySelfIntersects', ctx);
  check('a bow-tie crosses itself', X([[0, 0], [10, 10], [10, 0], [0, 10]]), true);
  check('a rectangle does not', X([[0, 0], [10, 0], [10, 10], [0, 10]]), false);
  check('a step polygon does not', X([[0, 0], [500, 0], [500, 1500], [250, 1500], [250, 2000], [0, 2000]]), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll geometry-validation checks passed.');
