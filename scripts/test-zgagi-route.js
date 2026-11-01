#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — api/_zgagi-route.js: מפתח, op, וחיבור ל-Vercel.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { fakeDb } = require('./_fake-db');
const { lgZgagiHandle } = require('../api/_zgagi-route');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const KEY = 'k'.repeat(40);
const env = { ZGAGI_LINK_TOKEN: KEY };
const req = (body, auth, method) => ({ method: method || 'POST', headers: auth === undefined ? { authorization: 'Bearer ' + KEY } : (auth ? { authorization: auth } : {}), body });
const WORLD = { hashavshevetAccounts: { 14201: { key: '14201', name: 'א.מ מראות' } }, skuCatalog: {} };
const ITEM = { biz: 'b', order: 'o', orderNo: '1', customerNo: '14201', rev: 1,
  item: { itemId: 'i', type: 'measure', qty: 1, measure: { glassType: 'שקוף', thickness: 8, processing: 'chisum', w: 1, h: 1 } } };

(async () => {
  let touched = 0;
  const spy = { ref() { touched++; throw new Error('no db'); } };
  for (const [name, r, e] of [['בלי מפתח', req({ op: 'stages' }, null), env], ['מפתח שגוי', req({ op: 'stages' }, 'Bearer nope'), env],
    ['env ריק', req({ op: 'stages' }), {}]]) {
    const out = await lgZgagiHandle(r, { db: spy, env: e });
    check('א. ' + name + ' → 401', out.status, 401);
  }
  check('א. ובלי לגעת במסד', touched, 0);
  check('א. GET → 405', (await lgZgagiHandle(req({ op: 'stages' }, undefined, 'GET'), { db: spy, env })).status, 405);
  check('א. op לא מוכר → 400', (await lgZgagiHandle(req({ op: 'drop' }), { db: spy, env })).status, 400);

  const db = fakeDb(WORLD);
  let out = await lgZgagiHandle(req(Object.assign({ op: 'receive' }, ITEM)), { db, env, now: 5 });
  check('ב. receive', [out.status, out.body.items.i.state], [200, 'created']);
  out = await lgZgagiHandle(req(JSON.stringify(Object.assign({ op: 'stages' }, { biz: 'b', order: 'o', items: ['i'] }))), { db, env });
  check('ב. stages (גוף כמחרוזת)', [out.status, out.body.items.i.stage], [200, '']);
  out = await lgZgagiHandle(req(Object.assign({ op: 'receive' }, ITEM, { customerNo: '1' })), { db, env });
  check('ב. לקוח לא קיים → 422', out.status, 422);
  db._data.orders.zg_b_o_i.stage = 'workday';
  out = await lgZgagiHandle(req({ op: 'cancel', biz: 'b', order: 'o', itemId: 'i' }), { db, env });
  check('ב. ביטול בייצור → 409', [out.status, out.body.stage], [409, 'workday']);

  // ── ג. Vercel ──
  const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  check('ג. rewrite', VJ.rewrites.some(r => r.source === '/api/zgagi' && r.destination === '/api/wa-inbound?zgagi=1'), true);
  const WA = fs.readFileSync(path.join(ROOT, 'api', 'wa-inbound.js'), 'utf8');
  check('ג. wa-inbound מנתב ל-_zgagi-route', /req\.query\.zgagi === '1'\) return require\('\.\/_zgagi-route'\)/.test(WA), true);
  const routes = fs.readdirSync(path.join(ROOT, 'api')).filter(f => !f.startsWith('_'));
  check('ג. עדיין ≤ 12 פונקציות — ' + routes.length, routes.length <= 12, true);

  if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
  console.log('\nכל הבדיקות עברו');
})().catch(e => { console.error(e); process.exit(1); });
