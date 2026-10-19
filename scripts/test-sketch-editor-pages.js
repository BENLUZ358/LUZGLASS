#!/usr/bin/env node
/**
 * The three pages use the ONE sketch editor (lg-sketch-editor.js), and each still saves where
 * it saves today (spec §4.4):
 *   sketch queue  (admin.html)         → lgReplaceSketch + __base/__layer, editable tomorrow
 *   check station (check-station.html) → checkEdits/<id>, temporary inspection marks
 *   drafter       (drafter.html)       → _editedSketch, private to the station
 *
 * Run: node scripts/test-sketch-editor-pages.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ADMIN = read('admin.html'), DB = read('firebase-db.js'), ED = read('lg-sketch-editor.js');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('(async\\s+)?function ' + name + '\\('));
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

/* ═══ the sketch queue ═══════════════════════════════════════════════ */
check('admin loads the shared editor', /<script src="lg-sketch-editor\.js[^"]*"><\/script>/.test(ADMIN), true);
check('the old queue editor is gone',
      [/etResizeCanvas/, /id="sqEdCanvas"/, /function setupEditorEvents/, /fillText\(txt/].map(re => re.test(ADMIN)), [false, false, false, false]);
check('sqOpenEditor opens the shared editor', /lgSketchEditor\.open\(/.test(bodyOf(ADMIN, 'sqOpenEditor')), true);
check('and asks for the saved layer', /lgLoadSketchLayer\(/.test(bodyOf(ADMIN, 'sqOpenEditor')), true);

/* which picture to edit on: the layer only when the sketch is still the one the editor saved */
{
  const c = vm.createContext({ Math, JSON, String, Object });
  vm.runInContext(ED, c);
  vm.runInContext(bodyOf(ADMIN, 'sqEditorSource'), c);
  const merged = 'data:image/jpeg;base64,' + 'M'.repeat(3000);
  const layer = { v: 1, w: 10, h: 10, sig: c.lgSketchSig(merged), texts: [{ id: 1, txt: '1503' }], strokes: [] };
  const fresh = JSON.parse(JSON.stringify(c.sqEditorSource(merged, { base: 'data:orig', layer })));
  check('the sketch is still ours → edit on the original with the movable layer', fresh, { base: 'data:orig', layer, writeBase: false });
  const other = 'data:image/jpeg;base64,' + 'N'.repeat(3100);
  check('stale layer is ignored → edit on the current sketch, and its base is renewed on save',
        JSON.parse(JSON.stringify(c.sqEditorSource(other, { base: 'data:orig', layer }))), { base: other, layer: null, writeBase: true });
  check('never edited → current sketch, base written on first save',
        JSON.parse(JSON.stringify(c.sqEditorSource(merged, null))), { base: merged, layer: null, writeBase: true });
  check('a layer without its base is not used',
        JSON.parse(JSON.stringify(c.sqEditorSource(merged, { base: null, layer }))), { base: merged, layer: null, writeBase: true });
}

/* saving: one atomic write — the merged sketch, the layer, and (first time) the original */
{
  const save = bodyOf(ADMIN, 'sqSaveEdit');
  check('sqSaveEdit saves through lgReplaceSketch with the layer', /lgReplaceSketch\(_sqOrder\(sqCurrent\), newSrc, \{/.test(save), true);
  const rep = bodyOf(DB, 'lgReplaceSketch');
  check('lgReplaceSketch writes the layer in the same update', /\['sketches\/' \+ id \+ '__layer'\]/.test(rep), true);
  check('and the original only when asked', /extra\.base[\s\S]{0,80}\['sketches\/' \+ id \+ '__base'\]/.test(rep), true);
  check('lgLoadSketchLayer lives in firebase-db.js', /async function lgLoadSketchLayer\(/.test(DB), true);
}

/* ═══ the check station: temporary inspection marks, saved where they always were ═══ */
{
  const CS = read('check-station.html');
  check('the station loads the shared editor', /<script src="lg-sketch-editor\.js[^"]*"><\/script>/.test(CS), true);
  check('its old editor is gone',
        [/function edStart\(/, /function edResize\(/, /fillText\(txt/, /id="edCvs"/].map(re => re.test(CS)), [false, false, false, false]);
  const open = bodyOf(CS, 'openEditor');
  check('openEditor opens the shared editor', /lgSketchEditor\.open\(/.test(open), true);
  check('with no layer — the marks are temporary', /layer:\s*null/.test(open), true);
  check('keeping its 1400 cap', /maxW:\s*1400/.test(open), true);
  const save = bodyOf(CS, 'edSave');
  check('it still saves to checkEdits/<id>', /ref\('checkEdits\/'\+savedId\)\.set\(newSrc\)/.test(save), true);
  check('and never into the customer\'s sketch', /lgReplaceSketch\(/.test(CS), false);
}

/* ═══ the drafter: private marks, saved where they always were ═══ */
{
  const DR = read('drafter.html');
  check('the drafter loads the shared editor', /<script src="lg-sketch-editor\.js[^"]*"><\/script>/.test(DR), true);
  check('its old editor is gone',
        [/function edStart\(/, /fillText\(txt/, /id="edCvs"/].map(re => re.test(DR)), [false, false, false]);
  check('openEditor opens the shared editor', /lgSketchEditor\.open\(/.test(bodyOf(DR, 'openEditor')), true);
  check('it keeps PNG', /mime:\s*'image\/png'/.test(bodyOf(DR, 'openEditor')), true);
  const save = bodyOf(DR, 'edSave');
  check('it still saves to _editedSketch', /updateOrder\(curOrder\.id,\{_editedSketch:newSrc\}\)/.test(save), true);
  check('and never into the customer\'s sketch', /lgReplaceSketch\(/.test(DR), false);
}

/* a sketch with no size of its own (the drafter's generated SVG) still opens */
check('the editor works on at least 1200 wide, whatever size the image reports',
      /WORK_MIN_W = 1200/.test(ED) && /Math\.max\(nat, WORK_MIN_W\)/.test(ED), true);

/* lgReplaceSketch / lgLoadSketchLayer against a fake database */
(async () => {
  const data = {};
  const db = { ref: p => ({
    update: async u => { Object.keys(u).forEach(k => { data[k] = u[k]; }); },
    once: async () => ({ val: () => (p in data ? data[p] : null) }),
    get: async () => ({ val: () => (p in data ? data[p] : null) }),
  }) };
  const c = vm.createContext({ Math, JSON, String, Object, Date, Map, console, _lgDb: db, _lgSketchCache: new Map() });
  vm.runInContext([bodyOf(DB, '_lgInlineSketch'), bodyOf(DB, 'lgReplaceSketch'), bodyOf(DB, 'lgLoadSketchLayer')].join('\n'), c);
  const order = { id: 'o1', hasSketch: true };
  const layer = { v: 1, w: 10, h: 10, sig: 's', texts: [], strokes: [] };
  await c.lgReplaceSketch(order, 'data:merged', { layer, base: 'data:orig' });
  check('the merged sketch, the layer and the original land together',
        [data['sketches/o1'], JSON.parse(data['sketches/o1__layer']).sig, data['sketches/o1__base']], ['data:merged', 's', 'data:orig']);
  await c.lgReplaceSketch(order, 'data:merged2', { layer });
  check('a later save keeps the original', data['sketches/o1__base'], 'data:orig');
  const back = await c.lgLoadSketchLayer('o1');
  check('lgLoadSketchLayer returns the original and the parsed layer', [back.base, back.layer.sig], ['data:orig', 's']);
  data['sketches/o1__layer'] = '{not json';
  check('a damaged layer is no layer, never a crash', (await c.lgLoadSketchLayer('o1')).layer, null);
  await c.lgReplaceSketch({ id: 'o2' }, 'data:x');
  check('without extra, lgReplaceSketch writes exactly what it wrote before',
        Object.keys(data).filter(k => k.includes('o2')).sort(), ['orders/o2/hasSketch', 'orders/o2/updatedAt', 'sketches/o2']);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll sketch editor page checks passed.');
})();
