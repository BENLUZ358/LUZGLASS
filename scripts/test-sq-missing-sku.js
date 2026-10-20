#!/usr/bin/env node
/**
 * תור הסקיצות — שורה בלי מק"ט מהודעת טקסט (בן, 20/10/2026 — אגן ברזל).
 * כותרת שלא מתאימה לאף מק"ט → הפריט נכנס עם skuMissing. בן בוחר מק"ט ישירות על השורה
 * (חמשת המק"טים הקבועים של אגן ראשונים), ו"שלח לחשבשבת" חסום עד שאין שורה כזו —
 * היום שורה בלי מק"ט נשמטת מהמסמך בשקט (buildLines → skipped).
 * Run: node scripts/test-sq-missing-sku.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const HS = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-order.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); failed++; return ''; }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

/* the picker on the row */
{
  const ir = bodyOf(ADMIN, 'iwRender');
  check('a row with skuMissing shows a SKU picker', /skuMissing[\s\S]{0,400}iwSetGroupSku\(/.test(ir), true);
  const list = (ADMIN.match(/const LG_WA_FIXED_SKUS = \[[^\]]*\]/) || [''])[0];
  check('Agan\'s fixed SKUs are offered first', ['5MIRM', '5MIRAM', '5MIRBM', '8MM', '6TSH', '6TSM'].every(s => list.includes("'" + s + "'")), true);
}
{
  const ctx = vm.createContext({
    sqCurrentItems: [{ name: 'זכוכית חלבית', w: 300, h: 300, skuMissing: true, quantityGroupId: 'g' }, { name: 'זכוכית חלבית', w: 300, h: 300, skuMissing: true, quantityGroupId: 'g' }, { sku: '5MIRM', name: 'x' }],
    iwResolve: c => c === '5MIRAM' ? { glass: 'מראה אפורה', mm: 5, proc: 'litush', label: "5 מ''מ מראה אפורה מלוטש", sku: '5MIRAM', _fromCatalog: true } : null,
    iwSave: () => { ctx.saved = (ctx.saved || 0) + 1; }, iwRender: () => {}, showToast: () => {},
  });
  vm.runInContext(bodyOf(ADMIN, 'iwSetGroupSku'), ctx);
  ctx.iwSetGroupSku([0, 1], '5MIRAM');
  const a = ctx.sqCurrentItems[0];
  check('choosing a SKU fills the whole group: sku, name, glass, mm, processing', [a.sku, a.name, a.glass, a.mm, a.litush, a.chisum, a.skuMissing], ['5MIRAM', "5 מ''מ מראה אפורה מלוטש", 'מראה אפורה', 5, true, false, undefined]);
  check('…both pieces of the group, sizes kept', [ctx.sqCurrentItems[1].sku, ctx.sqCurrentItems[1].w], ['5MIRAM', 300]);
  check('…other rows untouched, and saved once', [ctx.sqCurrentItems[2].sku, ctx.saved], ['5MIRM', 1]);

  /* 6TSH (3+3 cut) has no processing in the catalog, so iwResolve gives nothing — still pickable */
  vm.runInContext(`skuCatalogMap = { '6TSH': { code: '6TSH', name: 'טריפלקס 3+3 שקוף חתוך', glass: 'שקוף', mm: 6, triplex: true } };
    sqCurrentItems.push({ name: 'x', w: 100, h: 100, skuMissing: true });`, ctx);
  ctx.iwSetGroupSku([3], '6TSH');
  const t = ctx.sqCurrentItems[3];
  check('a cut-only catalog SKU (no processing) can be picked', [t.sku, t.name, t.chisum, t.litush, t.skuMissing], ['6TSH', 'טריפלקס 3+3 שקוף חתוך', false, false, undefined]);
}

/* final review: a SKU from the old IW_CODES list (no _fromCatalog) must still be written —
   otherwise the mark is cleared, both guards pass, and Hashavshevet skips the row silently */
{
  const ctx = vm.createContext({
    sqCurrentItems: [{ name: 'x', w: 100, h: 100, skuMissing: true }],
    iwResolve: c => c === '5MIRM' ? { glass: 'מראה', mm: 5, proc: 'litush', label: '5 מ"מ מראה מלוטש' } : null,
    skuCatalogMap: {}, iwSave: () => {}, iwRender: () => {}, showToast: () => {},
  });
  vm.runInContext(bodyOf(ADMIN, 'iwSetGroupSku'), ctx);
  ctx.iwSetGroupSku([0], '5MIRM');
  check('a SKU picked from the old list is still written on the row', [ctx.sqCurrentItems[0].sku, ctx.sqCurrentItems[0].skuMissing], ['5MIRM', undefined]);
}
check('the inbound panel names a text message', /kind === 'text'[^\n]*הודעת טקסט/.test(fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8')), true);

/* the send guard — in the dashboard, before anything moves, and on the server */
{
  const send = bodyOf(ADMIN, 'sqSendHashavshevet');
  const guard = send.search(/skuMissing/), stage = send.search(/updateStage\(/);
  check('"שלח לחשבשבת" checks for rows without SKU before it moves the order', guard > 0 && guard < stage, true);
  check('the server refuses an order with a row without SKU (never skips it silently)',
        /skuMissing[\s\S]{0,300}status\(422\)[\s\S]{0,200}missing-sku/.test(HS), true);
}

/* "duplicate?" */
check('the normalizer keeps waDuplicateOf and waText', /waDuplicateOf:/.test(bodyOf(DB, 'lgNormalizeOrder')) && /waText:/.test(bodyOf(DB, 'lgNormalizeOrder')), true);
check('the queue card shows "כפולה?"', /waDuplicateOf[\s\S]{0,200}כפולה\?/.test(bodyOf(ADMIN, 'sqRender')), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll missing-SKU checks passed.');
