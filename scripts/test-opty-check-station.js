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
check('a visible 📐 strip under the client name, filled when the sketch opens',
  [CS.includes('<div id="shOpty" class="sh-opty" hidden></div>'), CS.replace(/\r/g, '').includes('function renderSketch(){\n  csRenderOptyStrip();')], [true, true]);
check('the 📐 button does not tick the item (stopPropagation) and opens the shape',
  /class="si-shape"[^>]*onclick="event\.stopPropagation\(\);csOpenShape\(\$\{origIdx\}\)"/.test(CS), true);

(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' });
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
  check('viewer: numbered drawing + measurement list (hole Ø12, 251 from the left, 951 from the bottom)',
    [ov.querySelectorAll('.lg-opty-tag').length, [...ov.querySelectorAll('.lg-opty-feats li')].map(li => li.textContent)], [1, ['1חור Ø12 · 251 משמאל · 951 מלמטה']]);
  ov.querySelector('#lgOptyLbl').click(); ov.querySelector('#lgOptyLblSh').click();
  check('label buttons: plain, then with the drawing', calls, [['o1', [0], false], ['o1', [0], true]]);
  w.lgOptyShapeView(order, 1);
  const ov2 = w.document.getElementById('lgOptyView');
  check('item without a shape: says so, no "with shape" button', [/עוד אין מספר צורה/.test(ov2.textContent), !!ov2.querySelector('#lgOptyLblSh')], [true, false]);
  ov2.querySelector('[data-ov-close]').click();
  check('closes', w.document.getElementById('lgOptyView'), null);
  //  📐 בכל שלב — אותו כפתור ביום העבודה, בתחנת החשבוניות ובתחנת הבדיקה
  w.document.body.innerHTML = w.lgOptyChip(order, 0) + '|' + w.lgOptyChip(order, 1);
  check('chip only for an item with a shape', [w.document.querySelectorAll('.lg-opty-chip').length, /📐 274328/.test(w.document.body.textContent)], [1, true]);
  w.document.querySelector('.lg-opty-chip').click();
  check('chip opens the shape window', /צורה 274328/.test((w.document.getElementById('lgOptyView') || {}).textContent || ''), true);
  const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8'), INV = fs.readFileSync(path.join(ROOT, 'invoices.html'), 'utf8');
  check('workday: shape button in build list, work table, work cards, order items, today list, chisum (single + group)', (WD.match(/lgOptyChip\(/g) || []).length, 7);
  check('workday + invoices load the shape and label scripts', [WD, INV].map(h => /opty-shape\.js/.test(h) && /order-labels\.js/.test(h)), [true, true]);
  check('invoice station: shape button by each item size', INV.includes('<div class="item-dim">${w} × ${h} ${lgOptyChip(o, i)}</div>'), true);
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})();
