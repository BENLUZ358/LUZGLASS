#!/usr/bin/env node
/**
 * The sketch editor's screen and merge (lg-sketch-editor.js → lgSketchEditor, lgSketchMerge,
 * lgSketchSig). The merge and the signature run here against a fake canvas; the screen is
 * checked for the things Ben asked for that a source read can prove (iPad: the keyboard
 * closes on demand, fingers zoom, buttons big enough), and is exercised in the browser.
 *
 * Run: node scripts/test-sketch-editor-ui.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'lg-sketch-editor.js'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
vm.runInContext(SRC, ctx);

/* ── the signature: is the sketch still the one the editor saved? ── */
{
  const a = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
  const b = a.slice(0, 97 * 10) + 'B' + a.slice(97 * 10 + 1);   // index 970 is sampled
  check('lgSketchSig is stable', ctx.lgSketchSig(a), ctx.lgSketchSig(a));
  check('lgSketchSig changes when a sampled character changes', ctx.lgSketchSig(a) !== ctx.lgSketchSig(b), true);
  check('lgSketchSig carries the length', ctx.lgSketchSig(a).startsWith(a.length + ':'), true);
  check('a different length is a different sketch', ctx.lgSketchSig(a) !== ctx.lgSketchSig(a + 'A'), true);
  check('nothing has no signature', ctx.lgSketchSig(''), '');
}

/* ── the merge: what gets saved is what was on the screen ── */
function fakeCanvasFactory(sizes) {
  return (W, H) => {
    const calls = [];
    const c2d = { calls };
    ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'drawImage', 'strokeText', 'fillText', 'fillRect'].forEach(n => {
      c2d[n] = (...a) => calls.push([n, ...a]);
    });
    c2d.scale = (x, y) => calls.push(['scale', x, y]);
    c2d.setLineDash = () => {};
    const canvas = {
      width: W, height: H, ctx: c2d, getContext: () => c2d,
      // a JPEG gets smaller as quality drops; a PNG has one size
      toDataURL: (mime, q) => 'data:' + mime + ';base64,' + 'x'.repeat(mime === 'image/png' ? sizes.png : Math.round(sizes.jpeg * (q || 1))),
    };
    fakeCanvasFactory.last = canvas;
    return canvas;
  };
}
{
  const m = ctx.lgSketchModel({ w: 600, h: 400 });
  const t = m.addText({ x: 300, y: 200 }); m.setText(t.id, '1503');
  const img = { naturalWidth: 600, naturalHeight: 400 };
  const out = ctx.lgSketchMerge(img, m, { mime: 'image/jpeg', minW: 1200, maxB64: 1e9 }, fakeCanvasFactory({ jpeg: 1000 }));
  const cv = fakeCanvasFactory.last;
  check('a 600px sketch is saved at least 1200 wide', [cv.width, cv.height], [1200, 800]);
  check('everything is scaled from sketch pixels', cv.ctx.calls.find(c => c[0] === 'scale'), ['scale', 2, 2]);
  const f = cv.ctx.calls.find(c => c[0] === 'fillText');
  check('the text lands where it sat on the sketch', [f[1], f[2], f[3]], ['1503', 300, 200]);
  check('the photo goes under it', cv.ctx.calls[1] && cv.ctx.calls.some(c => c[0] === 'drawImage'), true);
  check('no selection frame is burned into the saved image', cv.ctx.calls.some(c => c[0] === 'fillText' && /🔒|✥/.test(c[1])), false);
  check('a JPEG comes back', out.startsWith('data:image/jpeg'), true);
}
{
  const m = ctx.lgSketchModel({ w: 3000, h: 2000 });
  ctx.lgSketchMerge({ naturalWidth: 3000, naturalHeight: 2000 }, m, { mime: 'image/jpeg', minW: 1200, maxW: 1400, maxB64: 1e9 }, fakeCanvasFactory({ jpeg: 10 }));
  check('the check station keeps its 1400 cap', fakeCanvasFactory.last.width, 1400);
}
{
  const m = ctx.lgSketchModel({ w: 1000, h: 1000 });
  const out = ctx.lgSketchMerge({ naturalWidth: 1000, naturalHeight: 1000 }, m, { mime: 'image/jpeg', minW: 1200, maxB64: 6000 }, fakeCanvasFactory({ jpeg: 10000 }));
  check('quality steps down until it fits', out.length <= 6000, true);
  const png = ctx.lgSketchMerge({ naturalWidth: 1000, naturalHeight: 1000 }, m, { mime: 'image/png' }, fakeCanvasFactory({ png: 42 }));
  check('the drafter keeps PNG', png.startsWith('data:image/png'), true);
}

/* ── the screen (source) ── */
check('only the drawing surface takes over touch', /\.lg-se-stage\s*\{[^}]*touch-action:\s*none/.test(SRC), true);
check('the text field closes the keyboard from the key itself', /enterkeyhint="done"/.test(SRC), true);
check('and has a "סיום" button', /סיום/.test(SRC), true);
check('buttons are at least 56px tall', /\.lg-se-btn\s*\{[^}]*min-height:\s*56px/.test(SRC), true);
check('it re-measures when the keyboard opens or the iPad turns',
      /visualViewport/.test(SRC) && /ResizeObserver/.test(SRC), true);
check('pointercancel ends a gesture like pointerup', /pointercancel/.test(SRC), true);
check('a new text appears only from "＋ כתב"', /＋ כתב/.test(SRC), true);
check('the wheel zooms on a computer', /'wheel'/.test(SRC), true);
check('the editor is opened through one function', /lgSketchEditor\s*=\s*\{\s*open/.test(SRC.replace(/\s+/g, ' ')), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch editor UI checks passed.');
