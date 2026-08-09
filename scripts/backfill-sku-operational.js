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
 * With --redo-auto it also corrects rows the OLD parser guessed wrong, but
 * only where opAuto is true — that flag means "derived, never verified by a
 * person". A row without it was set by hand and is never touched, in either
 * mode.
 *
 *   node scripts/backfill-sku-operational.js                     dry run
 *   node scripts/backfill-sku-operational.js --apply             fill empties
 *   node scripts/backfill-sku-operational.js --redo-auto --apply also correct
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ROOT  = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const REDO  = process.argv.includes('--redo-auto');

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

/* Rows the new parser would change but where the right answer is a judgement
   nobody has made yet. Left exactly as they are rather than guessed at.

   8MCH/8MCM/8MCMH  "8 מ''מ מאסטר ליין קליר" names two types. Is it מאסטר ליין
                    in a clear tint, or קליר from the מאסטר ליין line?
   8TBS             "טריפלקס 8 ברונזה + 8 שקוף" is genuinely both sheets, so
                    picking either one is arbitrary. */
const SKIP_REDO = new Set(['8MCH', '8MCM', '8MCMH', '8TBS']);
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
  const fixed   = [];
  for (const [code, row] of Object.entries(sku)) {
    if (REMOVE.includes(code)) continue;
    const guess = parse(row.name || '');
    const fill  = {};
    const redo  = {};
    FIELDS.forEach(f => {
      if (isEmpty(row[f])) {
        if (guess[f] !== undefined) fill[f] = guess[f];
      } else if (REDO && row.opAuto === true && !SKIP_REDO.has(code) &&
                 guess[f] !== undefined && String(row[f]) !== String(guess[f])) {
        redo[f] = { from: row[f], to: guess[f] };
      }
    });
    if (Object.keys(fill).length) {
      Object.entries(fill).forEach(([k, v]) => { updates[`skuCatalog/${code}/${k}`] = v; });
      updates[`skuCatalog/${code}/opAuto`] = true;   // derived, not verified
      changed.push({ code, name: row.name, fill });
    }
    if (Object.keys(redo).length) {
      Object.entries(redo).forEach(([k, v]) => { updates[`skuCatalog/${code}/${k}`] = v.to; });
      fixed.push({ code, name: row.name, redo });
    }
  }

  console.log(`skuCatalog rows: ${Object.keys(sku).length}`);
  console.log(`rows gaining a value: ${changed.length}\n`);
  changed.forEach(c => {
    const f = Object.entries(c.fill).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  ${String(c.code).padEnd(10)} ${String(c.name).padEnd(34)} ${f}`);
  });

  if (REDO) {
    console.log(`\nauto-guessed rows the new parser disagrees with: ${fixed.length}`);
    console.log('(rows edited by hand are excluded — opAuto must be true)\n');
    fixed.forEach(c => {
      const f = Object.entries(c.redo).map(([k, v]) => `${k}: "${v.from}" -> "${v.to}"`).join('  ');
      console.log(`  ${String(c.code).padEnd(10)} ${String(c.name).padEnd(34)} ${f}`);
    });
  }

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
  console.log(`\napplied: ${changed.length} filled, ${fixed.length} corrected, ${REMOVE.length - blocked.length} removed`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
