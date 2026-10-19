#!/usr/bin/env node
/**
 * The sketch editor's model (lg-sketch-editor.js → lgSketchModel), run in Node with no DOM.
 *
 * Ben, 19/10/2026: "I put the text in the middle of the glass and it came out above it";
 * "every touch writes the text again, I can't scroll or zoom"; he wants text he can drag,
 * then lock. Spec: docs/superpowers/specs/2026-10-19-sketch-editor-design.md.
 *
 * Everything here is in SKETCH pixels: a text placed on the middle pane stays on the middle
 * pane at any zoom, after a rotation, after the keyboard opens.
 *
 * Run: node scripts/test-sketch-editor-model.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lg-sketch-editor.js'), 'utf8'), ctx);
const make = opts => ctx.lgSketchModel(opts);
const measure = t => t.txt.length * t.size * 0.6;
const r2 = v => Math.round(v * 100) / 100;

/* a recording 2D context — enough to see what is drawn where */
function recorder() {
  const calls = [];
  const c = { calls, globalAlpha: 1 };
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'drawImage', 'setLineDash',
   'strokeRect', 'translate', 'scale', 'strokeText', 'fillText'].forEach(n => {
    c[n] = (...a) => calls.push([n, ...a, { textAlign: c.textAlign, textBaseline: c.textBaseline }]);
  });
  c.measureText = s => ({ width: String(s).length * 10 });
  return c;
}

/* ── texts are placed, centred, dragged, locked ─────────────────────────── */
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768);
  const t = m.addText({ x: 500, y: 400 });
  check('a new text sits exactly where it was put', [t.x, t.y], [500, 400]);
  check('and is selected, unlocked and empty', [m.sel === t.id, t.locked, t.txt], [true, false, '']);
  m.setText(t.id, '1503');

  const rc = recorder(); m.draw(rc, null, measure);
  const f = rc.calls.find(c => c[0] === 'fillText' && c[1] === '1503');
  check('centre anchoring: drawn at its own point', [f && f[2], f && f[3]], [500, 400]);
  check('centre anchoring: centred both ways', [f && f[4].textAlign, f && f[4].textBaseline], ['center', 'middle']);
  check('with a light halo under it, so it reads over the lines', rc.calls.some(c => c[0] === 'strokeText' && c[1] === '1503'), true);

  const s = m.toScreen(500, 400);
  m.pointerDown(1, s.x, s.y, measure); m.pointerMove(1, s.x + 30, s.y + 20); m.pointerUp(1);
  /* positions are kept to 0.1 sketch px (a smaller layer); a tenth of a pixel is invisible */
  check('drag: moved by the finger, in sketch pixels', [near(t.x, 500 + 30 / m.view.s, 0.06), near(t.y, 400 + 20 / m.view.s, 0.06)], [true, true]);
  m.undo();
  check('undo puts it back', [t.x, t.y], [500, 400]);

  m.toggleLock(t.id);
  const v0 = { ...m.view };
  m.pointerDown(1, s.x, s.y, measure); m.pointerMove(1, s.x + 30, s.y + 20); m.pointerUp(1);
  check('locked text does not move', [t.x, t.y], [500, 400]);
  check('the drag pans the sketch instead', [r2(m.view.x - v0.x), r2(m.view.y - v0.y)], [30, 20]);
}

/* ── a touch on the sketch never makes text ─────────────────────────────── */
for (const tool of ['move', 'pen', 'marker', 'erase']) {
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768); m.tool = tool;
  m.pointerDown(1, 300, 300, measure); m.pointerUp(1);
  check('tap on empty sketch never creates text (' + tool + ')', m.texts.length, 0);
}

/* ── strokes ────────────────────────────────────────────────────────────── */
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768); m.tool = 'pen';
  m.pointerDown(1, 200, 200, measure); m.pointerMove(1, 260, 240); m.pointerUp(1);
  check('pen stroke: one line', m.strokes.length, 1);
  const p0 = m.toSketch(200, 200);
  check('in sketch coordinates', [near(m.strokes[0].pts[0][0], p0.x, 0.06), near(m.strokes[0].pts[0][1], p0.y, 0.06)], [true, true]);
  check('pen width scales with the image', m.strokes[0].w, m.defaultStrokeW('pen'));
  m.undo();
  check('undo removes it', m.strokes.length, 0);

  m.tool = 'marker';
  m.pointerDown(1, 200, 200, measure); m.pointerMove(1, 400, 200); m.pointerUp(1);
  const rc = recorder(); m.draw(rc, null, measure);
  check('the marker is a wide, see-through stroke', [m.strokes[0].kind, m.strokes[0].w > m.defaultStrokeW('pen')], ['marker', true]);
}
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768); m.tool = 'pen';
  m.pointerDown(1, 200, 200, measure); m.pointerMove(1, 210, 205);
  m.pointerDown(2, 400, 300, measure);
  check('second finger cancels stroke', m.strokes.length, 0);
  const s0 = m.view.s;
  m.pointerMove(1, 150, 150); m.pointerMove(2, 480, 360); m.pointerUp(1); m.pointerUp(2);
  check('and the two fingers zoom', m.view.s > s0, true);
  check('and nothing is drawn by the pinch', m.strokes.length, 0);
}
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768);
  const before = m.toSketch(512, 300);
  m.zoomAt(2.5, 512, 300);
  const after = m.toSketch(512, 300);
  check('pinch keeps the midpoint under the fingers', [near(before.x, after.x), near(before.y, after.y)], [true, true]);
}
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768); m.tool = 'pen';
  m.pointerDown(1, 100, 100, measure); m.pointerMove(1, 150, 100); m.pointerUp(1);
  m.pointerDown(1, 100, 400, measure); m.pointerMove(1, 150, 400); m.pointerUp(1);
  const keep = m.strokes[0];
  m.tool = 'erase'; m.pointerDown(1, 120, 400, measure); m.pointerUp(1);
  check('erase removes a whole stroke', [m.strokes.length, m.strokes[0] === keep], [1, true]);
  m.undo();
  check('undo puts it back at the same place in the order', m.strokes.length === 2 && m.strokes[0] === keep, true);
}

/* ── text lifecycle ─────────────────────────────────────────────────────── */
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768);
  const t = m.addText({ x: 10, y: 10 }); m.setText(t.id, '   ');
  m.commitText(t.id);
  check('empty text is dropped on commit', [m.texts.length, m.sel], [0, null]);
}

/* ── rotation / keyboard: nothing moves on the sketch ───────────────────── */
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768);
  const t = m.addText({ x: 700, y: 500 }); m.setText(t.id, '60');
  m.tool = 'pen'; m.pointerDown(1, 300, 300, measure); m.pointerMove(1, 320, 310); m.pointerUp(1);
  const snap = JSON.stringify([m.texts, m.strokes]);
  m.fit(768, 1024); m.fit(1024, 500);
  check('resize keeps objects in sketch coords', JSON.stringify([m.texts, m.strokes]), snap);
}

/* ── sizes follow the photo, not the screen ─────────────────────────────── */
check('defaults scale with image width (small photo)', make({ w: 300, h: 200 }).defaultTextSize(), 18);
check('defaults scale with image width (large photo)', make({ w: 4000, h: 3000 }).defaultTextSize(), 140);

/* ── the layer: tomorrow's editing ──────────────────────────────────────── */
{
  const m = make({ w: 1400, h: 1000 }); m.fit(1024, 768);
  const t = m.addText({ x: 700, y: 500 }); m.setText(t.id, '1503'); m.toggleLock(t.id);
  m.tool = 'marker'; m.pointerDown(1, 300, 300, measure); m.pointerMove(1, 360, 300); m.pointerUp(1);
  const layer = JSON.parse(JSON.stringify(m.toLayer('abc')));
  check('layer carries version, size and signature', [layer.v, layer.w, layer.h, layer.sig], [1, 1400, 1000, 'abc']);
  const back = make({ w: 1400, h: 1000, layer });
  check('layer round-trip: texts', JSON.stringify(back.texts), JSON.stringify(m.texts));
  check('layer round-trip: strokes', JSON.stringify(back.strokes), JSON.stringify(m.strokes));
  const t2 = back.addText({ x: 1, y: 1 });
  check('new ids after a restore never collide', back.texts.filter(x => x.id === t2.id).length, 1);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch editor model checks passed.');
