#!/usr/bin/env node
/**
 * Re-derives the operational fields on skuCatalog rows that never got them,
 * using the corrected parser in firebase-db.js.
 *
 * Safety: a field is only written when it is currently absent or empty. An
 * existing value is never touched, so anything edited by hand in admin stays
 * exactly as it is. That is the same rule syncSkuCatalogFromHashavshevet
 * follows, just applied to rows that already exist.
 *
 * Also removes the two labour lines (שכר חיסום) from the catalogue, after
 * checking that no order references them.
 *
 *   node scripts/backfill-sku-operational.js          dry run, writes nothing
 *   node scripts/backfill-sku-operational.js --apply  writes
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ROOT  = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

/* the parser, taken from the shipped file rather than duplicated */
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const parts = [
  SRC.match(/const LG_GLASS_TYPES_BY_LENGTH\s*=\s*\[[\s\S]*?\];/),
  SRC.match(/const LG_GLASS_DEFAULT_BASE\s*=\s*'[^']*';/),
  SRC.match(/const LG_IMPLIES_BASE_GLASS\s*=\s*\[[^\]]*\];/),
  SRC.match(/function lgGuessOperationalFromName[\s\S]*?\n}/),
];
if (parts.some(p => !p)) { console.error('could not extract the parser'); process.exit(1); }
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);
const parse = ctx.lgGuessOperationalFromName;

const FIELDS = ['glass', 'mm', 'proc', 'graphic', 'chalavi', 'triplex'];
const REMOVE = ['12', '50006'];          // שכר חיסום — labour, not glass
const isEmpty = v => v === undefined || v === null || v === '';

const app = initializeApp({
  credential: cert(require(path.join(ROOT, 'scripts', 'serviceAccountKey.json'))),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app',
});

(async () => {
  const db  = getDatabase(app);
  const sku = (await db.ref('skuCatalog').once('value')).val() || {};

  /* ── never delete a SKU an order still points at ── */
  const orders = (await db.ref('orders').once('value')).val() || {};
  const used = new Set();
  Object.values(orders).forEach(o => {
    const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
    items.forEach(it => { if (it && it.sku) used.add(String(it.sku).toUpperCase()); });
  });

  const updates = {};
  const changed = [];
  for (const [code, row] of Object.entries(sku)) {
    if (REMOVE.includes(code)) continue;
    const guess = parse(row.name || '');
    const fill  = {};
    FIELDS.forEach(f => {
      if (isEmpty(row[f]) && guess[f] !== undefined) fill[f] = guess[f];
    });
    if (!Object.keys(fill).length) continue;
    Object.entries(fill).forEach(([k, v]) => { updates[`skuCatalog/${code}/${k}`] = v; });
    updates[`skuCatalog/${code}/opAuto`] = true;   // flag as derived, not verified
    changed.push({ code, name: row.name, fill });
  }

  console.log(`skuCatalog rows: ${Object.keys(sku).length}`);
  console.log(`rows gaining a value: ${changed.length}\n`);
  changed.forEach(c => {
    const f = Object.entries(c.fill).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  ${String(c.code).padEnd(10)} ${String(c.name).padEnd(34)} ${f}`);
  });

  console.log('\nlabour rows to remove:');
  const blocked = [];
  REMOVE.forEach(code => {
    if (!sku[code]) { console.log(`  ${code}  not present`); return; }
    if (used.has(code.toUpperCase())) {
      blocked.push(code);
      console.log(`  ${code}  KEPT — an order still references it`);
    } else {
      console.log(`  ${code}  ${sku[code].name}  -> remove`);
      updates[`skuCatalog/${code}`] = null;
    }
  });

  if (!APPLY) {
    console.log('\ndry run — nothing written. re-run with --apply');
    process.exit(0);
  }
  if (!Object.keys(updates).length) { console.log('\nnothing to do'); process.exit(0); }

  await db.ref().update(updates);
  console.log(`\napplied: ${changed.length} row(s) filled, ${REMOVE.length - blocked.length} removed`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
