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

  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8') + '\n' +
                  fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8'), ctx);
  ctx.cx = stubCx();
  ctx.dimHits = [];
  vm.runInContext(engField + '\n' + grab('engDim') + '\n' + grab('engHardware') +
                  '\n' + grab('engPaint'), ctx);

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
  vm.runInContext(DEMO.match(/const ENG_FIELD=\{[\s\S]*?\};/)[0] + '\n' +
                  g('engDim') + '\n' + g('engHardware') + '\n' + g('engPaint'), ctx);

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

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll hit-target checks passed.');
