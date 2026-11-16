#!/usr/bin/env node
/**
 * DXF per glass in the admin order window (Task 6, 16/11).
 *
 * An order saved by the builder with builder.version >= 2 gets a DXF button
 * per item, built from builder.shower with lgCuts. Version 1, no builder, or
 * an item whose size no longer matches the glass → no button, and the PNG
 * sketch is untouched. A glass with issues → disabled, issue text shown.
 *
 * Run: node scripts/test-exact-glass-admin.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const grab = n => {
  const i = A.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0, j = A.indexOf('{', i);
  for (; j < A.length; j++) { if (A[j] === '{') d++; else if (A[j] === '}') { d--; if (!d) break; } }
  return A.slice(i, j + 1);
};

for (const f of ['lg-shapes.js', 'lg-layout.js', 'lg-cuts.js', 'lg-dxf.js'])
  check('admin.html loads ' + f, A.includes('<script src="' + f), true);

const FD = {
  panels: [{ type: 'fixed', wallSide: 'left', carriesDoor: true }, { type: 'door', hingeSide: 'left', hingeOnFixed: 'prev' }],
  ps: { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } },
};
function setup(orderOf) {
  const saved = [], toasts = [];
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js', 'lg-cuts.js', 'lg-dxf.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  ctx.document = { createElement: () => ({ click() { saved.push(this); }, remove() {} }), body: {} };
  ctx.Blob = function (parts) { this.text = parts.join(''); };
  ctx.URL = { createObjectURL: b => { saved.push({ blob: b }); return 'blob:x'; }, revokeObjectURL() {} };
  ctx.setTimeout = f => f();
  ctx.showToast = m => toasts.push(m);
  vm.runInContext('function lgEsc(s){ return String(s).replace(/"/g,"&quot;"); }\n' +
    'function lgDimsText(w,h){ return w+"x"+h; }\nfunction _modFillGeos(){}\nvar eid="7", orders=[], _modDxfMemo=null;', ctx);
  vm.runInContext(['_modDxfCuts', '_modDxfMatch', '_modDxfBtn', '_modDxfReady', 'modDxf', '_modItemsHtml'].map(grab).join('\n'), ctx);
  const order = orderOf(ctx);
  ctx.orders = [order];
  return { ctx, order, saved, toasts };
}
// the shower the way the builder saves it
const showerOf = () => {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
  const g = n => { const i = DEMO.indexOf('function ' + n + '('); let d = 0, j = DEMO.indexOf('{', i);
    for (; j < DEMO.length; j++) { if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; } }
    return DEMO.slice(i, j + 1); };
  vm.runInContext('var selQ="zamak", selMM=8, selG=null, selWork="", selSupportBar=false, selBlackTrim=false, DOOR_H_MM=1985, HANDLE_EDGE_CM=6, TOWEL_SPACING_CM=40;\n' + g('mkPS') + '\n' + g('_lgShowerOf'), ctx);
  ctx.P = FD.panels; ctx.S = FD.ps;
  return JSON.parse(vm.runInContext('JSON.stringify(_lgShowerOf(P,S))', ctx));
};
const SHOWER = showerOf();
const itemsOf = ctx => vm.runInContext('lgSketchItems', ctx)(SHOWER);
const mk = (version, extra) => ctx => Object.assign({
  id: '7', orderNum: 'L1290', items: itemsOf(ctx),
  builder: version == null ? undefined : { version, shower: SHOWER },
}, extra || {});

/* version 2: a DXF button per item */
{
  const { ctx, order, saved } = setup(mk(2));
  const html = vm.runInContext('_modItemsHtml', ctx)(order.items);
  check('v2: a DXF button per item', (html.match(/modDxf\(\d\)/g) || []).length, 2);
  vm.runInContext('modDxf(1)', ctx);
  check('v2: one file, named order-itemNo_WxH', saved.filter(x => x.download).map(x => x.download.replace(/\d+x\d+/, 'WxH')), ['L1290-2_WxH.dxf']);
  check('v2: content starts with a DXF section', saved.some(x => x.blob && x.blob.text.startsWith('0\nSECTION')), true);
  vm.runInContext('modDxf(-1)', ctx);
  check('v2: all → one file per glass', saved.filter(x => x.download).length, 3);
}
/* version 1 / missing: nothing */
for (const [label, v] of [['version 1', 1], ['no builder', null]]) {
  const { ctx, order } = setup(mk(v));
  const html = vm.runInContext('_modItemsHtml', ctx)(order.items);
  check(label + ': no DXF button', /mit-dxf/.test(html), false);
}
/* edited item (size no longer the glass) → no button for that item */
{
  const { ctx, order } = setup(ctx => { const o = mk(2)(ctx); o.items[0].w = 123; return o; });
  const html = vm.runInContext('_modItemsHtml', ctx)(order.items);
  check('edited item: no button on it, the other keeps one', (html.match(/class="mit-dxf"/g) || []).length, 1);
}
/* edited item + "all" → only matching items get a file */
{
  const { ctx, saved } = setup(ctx => { const o = mk(2)(ctx); o.items[0].w = 123; return o; });
  vm.runInContext('modDxf(-1)', ctx);
  check('edited item: "all" gives one file, not two', saved.filter(x => x.download).length, 1);
}
/* match is by paneId and exact size */
{
  let r = setup(ctx => { const o = mk(2)(ctx); delete o.items[0].paneId; return o; });
  check('no paneId: no button on that item', (vm.runInContext('_modItemsHtml', r.ctx)(r.order.items).match(/class="mit-dxf"/g) || []).length, 1);
  r = setup(ctx => { const o = mk(2)(ctx); o.items[0].paneId = 'other'; return o; });
  check('paneId of another glass: no button', (vm.runInContext('_modItemsHtml', r.ctx)(r.order.items).match(/class="mit-dxf"/g) || []).length, 1);
  r = setup(ctx => { const o = mk(2)(ctx); o.items[0].w += 1; return o; });
  check('1 mm off: no button (exact match only)', (vm.runInContext('_modItemsHtml', r.ctx)(r.order.items).match(/class="mit-dxf"/g) || []).length, 1);
  //  two same-size glasses, items swapped → each DXF must come from its own glass
  r = setup(ctx => { const o = mk(2)(ctx); o.items.reverse(); return o; });
  const h = vm.runInContext('_modItemsHtml', r.ctx)(r.order.items);
  check('reordered items: no cross-matched button', (h.match(/class="mit-dxf"/g) || []).length, 0);
}
/* a glass with issues → disabled, with the text; no download by any route */
{
  const bad = JSON.parse(JSON.stringify(SHOWER));
  bad.shapes[0].bracketType = 'open'; bad.shapes[0].bracketInset = 40;
  const { ctx, order, saved } = setup(ctx => ({ id: '7', orderNum: 'L1', items: itemsOf(ctx), builder: { version: 2, shower: bad } }));
  const cuts = vm.runInContext('lgCuts', ctx)(bad);
  check('issues: the test shower really blocks glass 1', cuts[0].issues.length > 0, true);
  const html = vm.runInContext('_modItemsHtml', ctx)(order.items);
  check('issues: disabled button with "לבדוק ביד: …"', /<button[^>]*class="mit-dxf" disabled title="לבדוק ביד: [^"]+"/.test(html), true);
  vm.runInContext('modDxf(0)', ctx);
  check('issues: modDxf on the blocked glass downloads nothing', saved.filter(x => x.download).length, 0);
  vm.runInContext('modDxf(-1)', ctx);
  check('issues: "all" skips the blocked glass', saved.filter(x => x.download).length, 1);
}
/* the file name uses the order number the admin list shows (orderNum) */
{
  const { ctx, saved } = setup(mk(2, { orderNum: '2026-0042' }));
  vm.runInContext('modDxf(1)', ctx);
  check('file name starts with the displayed orderNum', /^2026-0042-2_/.test((saved.find(x => x.download) || {}).download), true);
}
/* new script tags carry a cache-buster like their neighbours */
check('admin.html: lg-*.js script tags have ?v=', ['lg-shapes.js', 'lg-layout.js', 'lg-cuts.js', 'lg-dxf.js']
  .every(f => new RegExp('<script src="' + f.replace('.', '\\.') + '\\?v=\\d+"></script>').test(A)), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll admin DXF checks passed.');
