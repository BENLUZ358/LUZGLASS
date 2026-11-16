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
  check('viewer shows shape number and work order', /צורה 274328 · אופטימיזציה M00291/.test(ov.textContent), true);
  check('viewer draws the shape', !!ov.querySelector('#lgOptyViewGeo svg'), true);
  check('viewer: numbered drawing + measurement list (net: hole Ø12, 250 from the left, 950 from the bottom)',
    [ov.querySelectorAll('.lg-opty-tag').length, [...ov.querySelectorAll('.lg-opty-feats li')].map(li => li.textContent)], [1, ['1חור Ø12 · 250 משמאל · 950 מלמטה']]);   // נטו: 1 מ"מ ליטוש פחות (בן, 16/11)
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
  //  🏷 ליד כל פריט בחיסום (בן, 16/11): עם צורה → מדבקה עם צורה; קבוצה → מדבקה לכל יחידה
  const fnSrc = n => { const i = WD.indexOf('function ' + n + '('); let d = 0, j = WD.indexOf('{', i); for (; j < WD.length; j++) { if (WD[j] === '{') d++; else if (WD[j] === '}' && !--d) break; } return (WD.slice(i - 6, i) === 'async ' ? 'async ' : '') + WD.slice(i, j + 1); };
  const lw = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' }).window, got = [];
  lw.allOrders = [order]; lw.lgPrintOrderLabels = (o, idxs, opts) => got.push([o.id, idxs, !!(opts && opts.withShape)]);
  lw.eval(fnSrc('wdLabelBtn') + ';' + fnSrc('wdItemLabel'));
  lw.document.body.innerHTML = lw.wdLabelBtn(order, [0]) + lw.wdLabelBtn(order, [1]);
  [...lw.document.querySelectorAll('.wd-item-lbl')].forEach(b => b.click());
  check('chisum: a label button by every item — with shape for 274328, plain for the other', [lw.document.querySelectorAll('.wd-item-lbl').length, got], [2, [['o1', [0], true], ['o1', [1], false]]]);
  {   //  "שבר" על כל מדבקה מהחיסום (בן, 16/11) — לא בטריפלקס
    const seen = []; lw.lgPrintOrderLabels = (o, idxs, opts) => seen.push(!!(opts && opts.broken));
    lw.document.body.innerHTML = lw.wdLabelBtn(order, [1], 'chisum') + lw.wdLabelBtn(order, [1], 'triplex');
    [...lw.document.querySelectorAll('.wd-item-lbl')].forEach(b => b.click());
    check('chisum label → "שבר"; triplex → not', seen, [true, false]);
    check('both row kinds pass the track', (WD.match(/\$\{wdLabelBtn\(o, [^)]*, tk\)\}/g) || []).length, 2);
    check('labels window marks "שבר" only on the chisum track', /if\(g\.track === 'chisum'\) labels\.forEach\(l => \{ l\.broken = true; \}\)/.test(WD), true);
  }
  check('chisum: button in the single row and in the ×N group row', (WD.match(/\$\{wdLabelBtn\(o, /g) || []).length, 2);
  //  חיסום: מספר אופטימיזציה ליד הפריט + צורות של ההזמנה שלא חוברו, וחיבור לפריט (בן, 16/11)
  {
    const pw = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' }).window, writes = [], toasts = [];
    pw.lgEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    pw.lgDimsText = (w, h) => w + '×' + h; pw.lgJsStr = s => String(s); pw.showToast = m => toasts.push(m);
    const raw = { a: { name: 'שקוף 8', w: 680, h: 1885 }, b: { name: 'שקוף 8', w: 680, h: 1885 }, c: { name: 'שקוף 8', w: 410, h: 1885, optyShape: '274264', optyJob: 'M00290' } };
    pw.firebase = { database: () => ({ ref: p => ({ once: async () => ({ val: () => (p === 'orders/L1232/items' ? raw : null) }), update: async u => writes.push(u) }) }) };
    const addScript = code => { const sc = pw.document.createElement('script'); sc.textContent = code; pw.document.head.appendChild(sc); };   // כמו בדפדפן: קבצים חולקים const
    addScript(fs.readFileSync(path.join(ROOT, 'opty-shape.js'), 'utf8'));
    const wdSrc = ['wdJobTag', '_wdPendOpen', 'wdPendingStrip', 'wdLinkPending', 'wdUnlinkShape'].map(fnSrc).join(';');
    addScript('let wdOptyPending = {};' + wdSrc + ';window.setPend = v => { wdOptyPending = v; };');
    const o = { id: 'L1232', orderNum: 'L1232', orderClient: 'נאור חזקיה', sketchName: 'זבולון 1/2/3', items: Object.values(raw) };
    check('chisum: optimisation number beside an item that has one', [/אופטימיזציה M00290/.test(pw.wdJobTag(o, 2)), pw.wdJobTag(o, 0)], [true, '']);
    check('no unlinked shapes → no strip', pw.wdPendingStrip(o), '');
    pw.setPend({ L1232: { '274256': { shape: '274256', job: 'M00291', w: 682, h: 1887, qty: 1 }, '274264': { shape: '274264', job: 'M00290', w: 412, h: 1887, qty: 1 } } });
    pw.document.body.innerHTML = pw.wdPendingStrip(o);
    const opts = [...pw.document.querySelectorAll('#wdPend_L1232_274256 option')].map(x => x.textContent.trim());
    check('strip: only the shape not yet on an item; items without a shape offered, size match marked ✓',
      [pw.document.querySelectorAll('.wd-opty-pend').length, /אופטימיזציה M00291/.test(pw.document.body.textContent), opts], [1, true, ['✓ 1 · שקוף 8 · 680×1885', '✓ 2 · שקוף 8 · 680×1885']]);
    pw.document.querySelector('.wd-opty-pend button').click();
    check('📐 in the strip opens the shape window', /צורה 274256/.test((pw.document.getElementById('lgOptyView') || {}).textContent || ''), true);
    pw.document.getElementById('lgOptyView').remove();
    pw.document.getElementById('wdPend_L1232_274256').value = '1';
    await pw.wdLinkPending('L1232', '274256');
    check('"חבר" writes the shape + optimisation number on the chosen item (object key b) and clears the pending entry',
      writes[0] && [writes[0]['orders/L1232/items/b/optyShape'], writes[0]['orders/L1232/items/b/optyJob'], writes[0]['meta/optyPending/L1232/274256'], 'orders/L1232/items/a/optyShape' in writes[0]], ['274256', 'M00291', null, false]);
    raw.a.optyShape = '1'; pw.setPend({ L1232: { '274256': { shape: '274256', job: 'M00291', w: 682, h: 1887, qty: 2 } } }); pw.document.getElementById('wdPend_L1232_274256').value = '0';
    await pw.wdLinkPending('L1232', '274256');
    check('an item that already has a shape is never overwritten', [writes.length, toasts.pop()], [1, 'לפריט הזה כבר יש צורה']);
    //  בן 16/11 — L1232: צורה 677 מול פריטים 680/675 → הקרוב (675) ראשון ונבחר; אחרי "חבר" הפריט יורד
    //  מיד מהבחירה של שאר הצורות; "נתק" מחזיר את הצורה לפס עם המידה מהציור
    {
      const raw2 = { a: { name: 'שקוף 8', w: 680, h: 1885 }, b: { name: 'שקוף 8', w: 675, h: 1885 } };
      const o2 = { id: 'L9', orderNum: 'L9', items: [raw2.a, raw2.b] };
      const w2 = [];
      let renders = 0;
      pw.allOrders = [o2]; pw.renderChisumTab = () => { renders++; }; pw.confirm = () => true;
      pw.firebase = { database: () => ({ ref: p => ({ once: async () => ({ val: () => (p === 'orders/L9/items' ? raw2 : p === 'meta/optyGeo/274259' ? { w: 677, h: 1887 } : null) }), update: async u => { w2.push(u); } }) }) };
      pw.setPend({ L9: { '274258': { shape: '274258', job: 'M00271', w: 702, h: 1887, qty: 1 }, '274259': { shape: '274259', job: 'M00271', w: 677, h: 1887, qty: 1 } } });
      pw.document.body.innerHTML = pw.wdPendingStrip(o2);
      const first = sh => pw.document.getElementById('wdPend_L9_' + sh).value;
      check('closest size is first and preselected (677 → item 2 = 675, not item 1 = 680)', first('274259'), '1');
      await pw.wdLinkPending('L9', '274259');
      check('after "חבר": item marked locally, shape gone from pending, screen redrawn', [o2.items[1].optyShape, renders, w2[0]['meta/optyPending/L9/274259']], ['274259', 1, null]);
      pw.document.body.innerHTML = pw.wdPendingStrip(o2);
      check('the other shape now offers only the free item', [...pw.document.querySelectorAll('#wdPend_L9_274258 option')].map(x => x.value), ['0']);
      check('linked item shows "נתק"', /wdUnlinkShape\('L9',1\)/.test(pw.wdJobTag(o2, 1)), true);
      raw2.b.optyShape = '274259'; raw2.b.optyJob = 'M00271';
      await pw.wdUnlinkShape('L9', 1);
      const u = w2[1] || {};
      check('"נתק" clears the item and puts the shape back with the drawing size',
        [u['orders/L9/items/b/optyShape'], u['orders/L9/items/b/optyJob'], u['meta/optyPending/L9/274259'] && [u['meta/optyPending/L9/274259'].w, u['meta/optyPending/L9/274259'].h, u['meta/optyPending/L9/274259'].qty, u['meta/optyPending/L9/274259'].job], o2.items[1].optyShape],
        [null, null, [677, 1887, 1, 'M00271'], undefined]);
    }
    check('chisum rows show the optimisation number (single + group)', (WD.match(/\$\{wdJobTag\(o, it\.globalIdx\)\}/g) || []).length, 2);
  }
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})();
