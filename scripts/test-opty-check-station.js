#!/usr/bin/env node
/**
 * תחנת הבדיקה — "📐" ליד פריט עם מספר צורה פותח את הצורה מאופטי-ווי: ציור, מספר,
 * פקודה, ומדבקה רגילה / עם צורה (בן, 16/11). Run: node scripts/test-opty-check-station.js
 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const CS = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
check('check station loads the shape, label and print scripts',
  ['opty-shape.js', 'print-labels.js', 'order-labels.js'].map(f => new RegExp(`<script src="${f.replace('.', '\.')}`).test(CS)), [true, true, true]);
check('the 📐 button does not tick the item (stopPropagation) and opens the shape',
  /class="si-shape"[^>]*onclick="event\.stopPropagation\(\);csOpenShape\(\$\{origIdx\}\)"/.test(CS), true);

(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w._lgDb = { ref: p => ({ once: async () => ({ val: () => (p === 'meta/optyGeo/274328' ? { w: 502, h: 1902, c: [[[1, 251, 951, 6, 0, 6.2832]]] } : null) }) }) };
  w.lgPrintOrderLabels = (o, idxs, opts) => calls.push([o.id, idxs, !!(opts && opts.withShape)]);
  w.eval(fs.readFileSync(path.join(ROOT, 'opty-shape.js'), 'utf8'));
  const order = { id: 'o1', orderClient: 'המקום לאמבט', sketchName: 'איציק', items: [{ name: 'שקוף 8', w: 500, h: 1900, optyShape: '274328', optyJob: 'M00291' }, { name: 'שקוף 8', w: 400, h: 1900 }] };
  w.lgOptyShapeView(order, 0);
  await new Promise(r => setTimeout(r, 20));
  const ov = w.document.getElementById('lgOptyView');
  check('viewer shows shape number and work order', /צורה 274328 · פקודה M00291/.test(ov.textContent), true);
  check('viewer draws the shape', !!ov.querySelector('#lgOptyViewGeo svg'), true);
  ov.querySelector('#lgOptyLbl').click(); ov.querySelector('#lgOptyLblSh').click();
  check('label buttons: plain, then with the drawing', calls, [['o1', [0], false], ['o1', [0], true]]);
  w.lgOptyShapeView(order, 1);
  const ov2 = w.document.getElementById('lgOptyView');
  check('item without a shape: says so, no "with shape" button', [/עוד אין מספר צורה/.test(ov2.textContent), !!ov2.querySelector('#lgOptyLblSh')], [true, false]);
  ov2.querySelector('[data-ov-close]').click();
  check('closes', w.document.getElementById('lgOptyView'), null);
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})();
