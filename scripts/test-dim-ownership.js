#!/usr/bin/env node
/**
 * Every dimension belongs to the element that made it, and says so
 * (QA doc 2026-09-25, TESTs 01, 05, 08).
 *
 * TEST 01 — two doors meeting, handle 60 on one and towel 90/550 on the
 *   other. The 60 appeared on the neighbour's glass and the 90 on the first
 *   door's: a short dimension pushed its number "toward the face and
 *   beyond" — and beyond the face is the other door. The 550 shared the 90's
 *   row and read as if measured from the edge.
 *
 * TEST 05/08 — two cutouts and a hole: every number was present but none
 *   said whose it was. Sizes were written on the cutout, positions drifted
 *   away from it.
 *
 * The rules now:
 *   • a short dimension's number goes INTO its own glass, never past the face;
 *   • the towel's hole-to-hole distance gets its own row;
 *   • a dimension whose line sits off the element is tied back to it with
 *     extension lines;
 *   • cutouts and free holes carry a small tag (פ1, ק1) and their size /
 *     diameter goes to a legend under the drawing, with the reference used;
 *   • every such dimension carries `owner`, so ownership is checkable.
 *
 * Run: node scripts/test-dim-ownership.js
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
const layout = (panels, ps, cW) => {
  ctx.PN = panels; ctx.PS = ps;
  return vm.runInContext(`lgLayout(lgFromPanels(PN,PS,{finish:'shahor',quality:'zamak'}),{canvasW:${cW}})`, ctx);
};
const labelX = d => d.x1 + (d.x2 - d.x1) * (d.t == null ? 0.5 : d.t);
const labelY = d => d.y1 + (d.y2 - d.y1) * (d.t == null ? 0.5 : d.t);
const inside = (s, x) => x >= s.x - 0.5 && x <= s.x + s.w + 0.5;

/* ── TEST 01: fixed | door | door | fixed, handle 60 against towel 90/550 ── */
const TWO_DOORS = [
  { type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
  { type: 'door', label: 'דלת', hingeSide: 'right', hingeOnFixed: 'prev' },
  { type: 'door', label: 'דלת', hingeSide: 'left', hingeOnFixed: 'next' },
  { type: 'fixed', wallSide: 'left', label: 'קבוע', carriesDoor: true },
];
for (const cW of [375, 900]) {
  const L = layout(TWO_DOORS, {
    0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985, handleEdge: 6 },
    2: { w: 1000, h: 1985, handleType: 'towel', handleEdge: 9 }, 3: { w: 500, h: 2000 } }, cW);
  const edges = L.dims.filter(d => d.kind === 'handle-edge');
  const byText = t => edges.find(d => d.text === t);
  const s1 = L.shapes[1], s2 = L.shapes[2];
  check(`@${cW} the 60 is written on the door it measures`, inside(s1, labelX(byText('60'))), true);
  check(`@${cW} the 90 is written on the door it measures`, inside(s2, labelX(byText('90'))), true);
  check(`@${cW} and neither is written on the other door`,
        [inside(s2, labelX(byText('60'))) && !inside(s1, labelX(byText('60'))),
         inside(s1, labelX(byText('90'))) && !inside(s2, labelX(byText('90')))], [false, false]);

  const gap = L.dims.find(d => d.kind === 'towel-gap');
  const holes = L.hardware.filter(h => h.role === 'handle' && h.idx === 2).map(h => h.x).sort((a, b) => a - b);
  check(`@${cW} the 550 runs hole to hole, centre to centre`,
        [Math.abs(Math.min(gap.x1, gap.x2) - holes[0]) < 0.6, Math.abs(Math.max(gap.x1, gap.x2) - holes[1]) < 0.6],
        [true, true]);
  check(`@${cW} the 550 has a row of its own, apart from the 90`, Math.abs(gap.y1 - byText('90').y1) > 4, true);
  check(`@${cW} the 550 is written on its door`, inside(s2, labelX(gap)), true);
  check(`@${cW} every handle dimension is tied back to its holes`,
        edges.concat([gap]).every(d => (d.ext || []).length === 2), true);
}

/* ── TEST 08: two cutouts and a hole, on a glass with a sloped floor ── */
const SHAPE = [{ type: 'shape', label: 'צורה' }];
const ST08 = { w: 500, h: 2000, hasSlope: true, slopeH1: 2000, slopeH2: 1950, slopeSideH: 'bottom',
  cutouts: [{ w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 50 },  y: { from: 'bottom', mm: 1200 } },
            { w: 200, h: 100, ref: 'edge', x: { from: 'right', mm: 250 }, y: { from: 'bottom', mm: 1000 } }],
  holes: [{ role: 'hole', dia: 12, x: { from: 'left', mm: 150 }, y: { from: 'bottom', mm: 1600 } }] };
for (const cW of [375, 900]) {
  const L = layout(SHAPE, { 0: ST08 }, cW);
  const s = L.shapes[0];
  check(`@${cW} sizes are no longer written on the cutout`,
        L.dims.filter(d => d.kind === 'cut-w' || d.kind === 'cut-h').length, 0);
  check(`@${cW} each cutout and the free hole carries a tag`,
        (L.tags || []).map(t => t.text).sort(), ['פ1', 'פ2', 'ק1']);
  L.cutouts.forEach((k, i) => {
    const tg = L.tags.find(t => t.text === 'פ' + (i + 1));
    check(`@${cW} tag פ${i + 1} sits on its own cutout`,
          tg.x >= k.x - 12 && tg.x <= k.x + k.w + 12 && tg.y >= k.y - 12 && tg.y <= k.y + k.h + 12, true);
  });
  for (const own of ['cut:1', 'cut:2', 'hole:1']) {
    const ds = L.dims.filter(d => d.owner && d.owner.feat === own);
    check(`@${cW} ${own} owns exactly its two position dimensions`, ds.length, 2);
    check(`@${cW} ${own}: every number is written on its glass`, ds.every(d => inside(s, labelX(d))), true);
  }
  const cy = L.dims.find(d => d.kind === 'cut-y' && d.owner.feat === 'cut:1');
  const k1 = L.cutouts[0];
  const tied = (cy.ext || []).some(e => Math.abs(e.x1 - (k1.x + k1.w)) < 0.6 && Math.abs(e.y1 - (k1.y + k1.h)) < 0.6);
  check(`@${cW} the 1200 is tied back to the cutout's reference corner`,
        Math.abs(cy.x1 - (k1.x + k1.w)) < 0.6 || tied, true);

  const lg = L.legend || [];
  check(`@${cW} the legend has one line per element`, lg.map(l => l.tag), ['פ1', 'פ2', 'ק1']);
  const t1 = (lg[0] || {}).text || '';
  check(`@${cW} cutout 1 reads in full`,
        ['פינוי 1', 'רוחב 200 מ״מ', 'גובה 100 מ״מ', 'מימין 50 מ״מ', 'מלמטה 1200 מ״מ', 'ייחוס: תחילת הפינוי']
          .every(w => t1.includes(w)), true);
  const t3 = (lg[2] || {}).text || '';
  check(`@${cW} the free hole reads with its diameter`,
        ['קדח 1', 'Ø12 מ״מ', 'משמאל 150 מ״מ', 'מלמטה 1600 מ״מ'].every(w => t3.includes(w)), true);
}

/* ── the centre reference is named in the legend ── */
{
  const L = layout(SHAPE, { 0: { w: 500, h: 2000,
    cutouts: [{ w: 100, h: 60, ref: 'center', x: { from: 'left', mm: 250 }, y: { from: 'top', mm: 300 } }] } }, 900);
  check('a centre-referenced cutout says so', (L.legend[0].text || '').includes('ייחוס: מרכז הפינוי'), true);
}

/* ── standard hardware stays quiet: no tag, no legend, no Ø ── */
{
  const L = layout(TWO_DOORS, { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 },
                                2: { w: 800, h: 1985 }, 3: { w: 500, h: 2000, floorBracket: true } }, 900);
  check('hinges, brackets and handles get no tag', (L.tags || []).length, 0);
  check('and no legend', (L.legend || []).length, 0);
}

/* ── several glasses: the legend names whose element it is ── */
{
  const L = layout([{ type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
                    { type: 'door', label: 'דלת', hingeSide: 'right', hingeOnFixed: 'prev' }],
    { 0: { w: 500, h: 2000, cutouts: [{ w: 100, h: 60, ref: 'edge', x: { from: 'left', mm: 100 }, y: { from: 'bottom', mm: 900 } }] },
      1: { w: 800, h: 1985 } }, 900);
  check('with more than one glass, the legend line names the glass', /^קבוע: /.test(L.legend[0].text), true);
  check('a unique name is not numbered ("קבוע א 1" only confused)', /קבוע 1/.test(L.legend[0].text), false);

  const D = layout([{ type: 'fixed', wallSide: 'right', label: 'קבוע', carriesDoor: true },
                    { type: 'door', label: 'דלת', hingeSide: 'right', hingeOnFixed: 'prev' },
                    { type: 'fixed', wallSide: 'left', label: 'קבוע' }],
    { 0: { w: 500, h: 2000 }, 1: { w: 800, h: 1985 },
      2: { w: 500, h: 2000, cutouts: [{ w: 100, h: 60, ref: 'edge', x: { from: 'left', mm: 100 }, y: { from: 'bottom', mm: 900 } }] } }, 900);
  check('two glasses with the same name are told apart by number', /^קבוע 3: /.test(D.legend[0].text), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll dimension-ownership checks passed.');
