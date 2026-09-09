#!/usr/bin/env node
/**
 * Runs the drawer against a stub canvas and asks whether the touch targets
 * actually get created.
 *
 * Every other test in this project reads the source or the engine. Neither
 * could answer the question that mattered: edit mode was broken on the live
 * site while every check was green, because nothing ever RAN the painting
 * code. A canvas is not needed to answer "did dimHits fill up" — only an
 * object that accepts the same calls.
 *
 * Run: node scripts/test-hit-targets.js
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

console.log('');

/* ── a canvas that records nothing but accepts everything ───────────────── */
const stubCx = () => {
  const c = {};
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke',
   'fill', 'arc', 'rect', 'roundRect', 'translate', 'rotate', 'scale',
   'setTransform', 'clearRect', 'fillRect', 'fillText', 'setLineDash',
   'createLinearGradient'].forEach(k => { c[k] = () => k === 'createLinearGradient'
     ? { addColorStop() {} } : undefined; });
  c.createLinearGradient = () => ({ addColorStop() {} });
  c.measureText = t => ({ width: String(t).length * 6 });
  return c;
};

/* ── pull the painting functions out and run them for real ──────────────── */
function paint(shower, canvasW) {
  const grab = name => {
    const i = DEMO.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('missing ' + name);
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++;
      else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const engField = DEMO.match(/const ENG_FIELD=\{[\s\S]*?\};/)[0];
  /* the painter names the kind on the glass, so the helper travels with it */
  const kindHe = [DEMO.match(/const KIND_HE=\{[\s\S]*?\};/)[0],
                  (DEMO.match(/function kindName\(k\)\{[^}]*\}/) || [''])[0]].join('\n');

  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8') + '\n' +
                  fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  ctx.cx = stubCx();
  ctx.dimHits = [];
  vm.runInContext([engField, kindHe, grab('engDim'), grab('engHardware'),
                   grab('engPaint')].join('\n'), ctx);

  const L = ctx.lgLayout(shower, { canvasW });
  ctx.L = L;
  vm.runInContext("engPaint(L,'combo',0,null)", ctx);
  return { L, hits: ctx.dimHits };
}

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, h, e) => Object.assign({ id, kind: 'fixed', w: 500, h: h || 2000 }, e || {});
const door = (id, hs, h) => ({ id, kind: 'door', w: 800, h: h || 1985, hingeSide: hs || 'right' });

/* ── the check that was missing ─────────────────────────────────────────── */
{
  const { L, hits } = paint(shower([fixed('a'), door('b', 'right')],
                                   { right: 'wall', left: 'open' }), 900);

  check('painting produces touch targets at all', hits.length > 0, true);

  /* every editable dimension the engine drew has one */
  const EDITABLE = /^(width|height|hinge-|bracket-|handle-|notch-)/;
  const drawn = L.dims.filter(d => EDITABLE.test(d.kind) && d.kind !== 'total');
  check('one target per editable dimension', hits.length, drawn.length);

  check('each target names a field and a pane',
        hits.every(h => h.t && h.t.field && h.t.idx != null && h.t.pfx), true);

  /* 44px is the design floor for a touch target */
  check('and each is at least 44px in both directions',
        hits.every(h => h.w >= 44 && h.h >= 44), true);
}

/* ── the target has to sit where the number is ──────────────────────────── */
/* A target 200px from its number is the same as no target: the fitter taps
   the number and nothing happens. */
{
  const { L, hits } = paint(shower([fixed('a'), door('b', 'right')],
                                   { right: 'wall', left: 'open' }), 900);
  const stray = [];
  L.dims.forEach(d => {
    const t = d.t == null ? 0.5 : d.t;
    const mx = d.x1 + (d.x2 - d.x1) * t, my = d.y1 + (d.y2 - d.y1) * t;
    const near = hits.some(h => mx >= h.x - 1 && mx <= h.x + h.w + 1 &&
                                my >= h.y - 1 && my <= h.y + h.h + 1);
    if (/^(width|height|hinge-|bracket-|handle-|notch-)/.test(d.kind) && d.kind !== 'total' && !near)
      stray.push(d.kind + ':' + d.text);
  });
  check('every number has a target under it', stray, []);
}

/* ── and stacked items keep their targets ───────────────────────────────── */
/* Item mode paints each pane with a vertical offset. The targets are
   recorded before the offset is applied and corrected afterwards — get that
   backwards and every target in every pane but the first is wrong. */
{
  const g = name => {
    const i = DEMO.indexOf('function ' + name + '(');
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8') + '\n' +
                  fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  ctx.cx = stubCx();
  ctx.dimHits = [];
  vm.runInContext([DEMO.match(/const ENG_FIELD=\{[\s\S]*?\};/)[0],
                   DEMO.match(/const KIND_HE=\{[\s\S]*?\};/)[0],
                   (DEMO.match(/function kindName\(k\)\{[^}]*\}/) || [''])[0],
                   g('engDim'), g('engHardware'), g('engPaint')].join('\n'), ctx);

  ctx.L1 = ctx.lgLayout(shower([fixed('a')]), { canvasW: 700 });
  ctx.L2 = ctx.lgLayout(shower([door('b', 'right')]), { canvasW: 700 });
  vm.runInContext("engPaint(L1,'item',0,function(){return 0;});", ctx);
  const first = ctx.dimHits.length;
  vm.runInContext("engPaint(L2,'item',400,function(){return 1;});", ctx);

  const second = ctx.dimHits.slice(first);
  check('the second item gets targets too', second.length > 0, true);
  check('shifted down by its offset', second.every(h => h.y >= 400 - 44), true);
  check('and every one of them points at the second pane',
        second.every(h => h.t.idx === 1), true);
}

/* ── tapping a number must open THAT number ─────────────────────────────── */
/* The sharpest check in this file, and the one that names the bug outright:
   walk every dimension, take the point where its label is drawn, and ask
   which target the click handler would find there. It has to be that
   dimension's own target — never a neighbour's.
   This is what "tapping 2600 edits the 800" looks like from inside. */
{
  const cases = [
    ['fixed + door',     shower([fixed('a'), door('b', 'right')], { right: 'wall', left: 'open' })],
    ['fixed door fixed', shower([fixed('a'), door('b', 'right'), fixed('c')])],
    ['two doors',        shower([fixed('a'), door('b', 'right'), door('c', 'left'), fixed('d')])],
    ['a sloped fixed',   shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1750 }), door('b', 'right')], { right: 'wall', left: 'open' })],
    ['a notched fixed',  shower([fixed('a', 2000, { notchW: 200, notchH: 500 }), door('b', 'right')], { right: 'wall', left: 'open' })],
  ];
  /* the engine names the field for anything with more than one of its
     kind on the same pane; the map is only the fallback */
  const FIELD = { 'width': 'w', 'height': 'h', 'hinge-top': 'hingeTop',
    'hinge-bot': 'hingeBot', 'bracket-top': 'bracketTop', 'bracket-bot': 'bracketBot',
    'bracket-inset': 'bracketInset', 'handle-edge': 'handleEdge',
    'handle-dist': 'handleDist', 'notch-w': 'notchW', 'notch-h': 'notchH' };

  cases.forEach(([name, sh]) => {
    [375, 900].forEach(cw => {
      const { L, hits } = paint(sh, cw);
      const wrong = [];
      L.dims.forEach(d => {
        const field = d.field || FIELD[d.kind];
        if (!field || d.idx == null) return;      // the overall width has no editor
        const t = d.t == null ? 0.5 : d.t;
        const mx = d.x1 + (d.x2 - d.x1) * t, my = d.y1 + (d.y2 - d.y1) * t;
        /* the click handler takes the FIRST target containing the point */
        const found = hits.find(h => mx >= h.x && mx <= h.x + h.w &&
                                     my >= h.y && my <= h.y + h.h);
        if (!found) wrong.push(`${d.kind}:${d.text} has no target`);
        else if (found.t.field !== field || found.t.idx !== d.idx)
          wrong.push(`${d.kind}:${d.text} opens ${found.t.field} of pane ${found.t.idx}`);
      });
      check(`${name} @${cw}: every number opens its own editor`, wrong, []);
    });
  });
}

/* ── two dimensions of one kind are two different fields ────────────────── */
/* A sloped pane carries two heights. Both are kind 'height', and a map from
   kind to field gave both the same one — so tapping the 1800 opened the
   overall height showing 2000, and changing it moved the wrong number.
   The engine knows which face each belongs to, so the engine names it. */
{
  const sloped = shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1800 }),
                         door('b', 'right')], { right: 'wall', left: 'open' });
  const { L } = paint(sloped, 900);
  const hs = L.dims.filter(d => d.kind === 'height' && d.idx === 0);
  check('a sloped pane states both its heights', hs.length, 2);
  check('and each names its own field',
        hs.map(d => d.field).sort(), ['slopeH1', 'slopeH2']);
  check('the 2000 belongs to the left face',
        hs.find(d => d.text === '2000').field, 'slopeH1');
  check('and the 1800 to the right one',
        hs.find(d => d.text === '1800').field, 'slopeH2');

  /* the same for a width slope */
  const wide = shower([fixed('a', 2000, { slopeW1: 500, slopeW2: 455 }),
                       door('b', 'right')], { right: 'wall', left: 'open' });
  const ws = paint(wide, 900).L.dims.filter(d => d.kind === 'width' && d.idx === 0);
  check('a width slope names its two widths apart',
        ws.map(d => d.field).sort(), ['slopeW1', 'slopeW2']);

  /* and a plain pane still edits its own height */
  const plain = paint(shower([fixed('a'), door('b', 'right')],
                             { right: 'wall', left: 'open' }), 900).L;
  check('a plain pane edits the height itself',
        plain.dims.filter(d => d.kind === 'height').every(d => d.field === 'h'), true);
}

/* ── the editor opens on the number that was tapped ─────────────────────── */
/* A dimension the engine computed does not always sit in the panel state.
   A bracket that follows the hinges, a height derived from a neighbour — the
   drawing says 700 and the state holds nothing, so reading the state alone
   opened the editor on the 200mm default while 700 was printed on the glass.
   The target carries the number that was drawn. */
{
  const { hits } = paint(shower([fixed('a', 2500), fixed('b', 2000)],
                                { right: 'wall', left: 'wall' }), 900);
  check('every target carries the value it shows',
        hits.every(h => h.t.shown != null), true);

  const { L, hits: h2 } = paint(shower([fixed('a', 2000, { slopeH1: 2000, slopeH2: 1800 }),
                                        door('b', 'right')], { right: 'wall', left: 'open' }), 900);
  const byField = f => h2.find(h => h.t.field === f);
  check('the left face target shows 2000', byField('slopeH1').t.shown, 2000);
  check('and the right face target shows 1800', byField('slopeH2').t.shown, 1800);

  /* the numbers on the drawing and the numbers in the targets are the same
     set — nothing is offered for editing that is not written down */
  const drawn = L.dims.filter(d => d.field || /^(width|height|hinge-|bracket-|handle-|notch-)/.test(d.kind))
                      .filter(d => d.idx != null).map(d => Number(d.text)).sort();
  const offered = h2.map(h => h.t.shown).sort();
  check('and they agree with what is drawn', offered, drawn);
}

/* ── the click has to land where the finger did ─────────────────────────── */
/* This is the one that was missing, and it cost two rounds of guessing.
   A canvas wider than the screen is displayed narrower than it is, and the
   click coordinates have to be scaled back. One ratio for both axes assumes
   the canvas is stretched equally in each — and it is not: the width is
   squeezed and the height is left alone.
   Seen from outside it looked like this: tapping the overall width opened
   the WIDTH editor of the panel below it, and nothing else responded at all.
   The one dimension with no editor was the only one that seemed to work. */
{
  const grab = name => {
    const i = DEMO.indexOf('function ' + name + '(');
    let d = 0, j = i;
    for (; j < DEMO.length; j++) {
      if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
    }
    return DEMO.slice(i, j + 1);
  };
  const ctx = vm.createContext({ Math, window: { devicePixelRatio: 3 } });
  ctx.C = { width: 723 * 3, height: 1200 * 3 };
  vm.runInContext(grab('_canvasPoint'), ctx);

  /* displayed at 410 wide but full height: the width is squeezed 1.76×,
     the height is not squeezed at all */
  const rect = { left: 0, top: 0, width: 410, height: 1200 };
  const p = vm.runInContext(
    '_canvasPoint(205,600,' + JSON.stringify(rect) + ',723)', ctx);

  check('a squeezed width is scaled back', Math.round(p.x), Math.round(205 * 723 / 410));
  check('and an unsqueezed height is left where it is', Math.round(p.y), 600);

  /* and when nothing is stretched, both are identity */
  const same = { left: 0, top: 0, width: 723, height: 1200 };
  const q = vm.runInContext('_canvasPoint(100,200,' + JSON.stringify(same) + ',723)', ctx);
  check('an untouched canvas maps one to one', [Math.round(q.x), Math.round(q.y)], [100, 200]);

  /* the offset of the element is honoured in both axes */
  const off = { left: 40, top: 90, width: 723, height: 1200 };
  const r = vm.runInContext('_canvasPoint(140,290,' + JSON.stringify(off) + ',723)', ctx);
  check('and the element offset is subtracted', [Math.round(r.x), Math.round(r.y)], [100, 200]);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hit-target checks passed.');
