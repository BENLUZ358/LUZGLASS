#!/usr/bin/env node
/**
 * import-pricelists.js — fills prices/clients from the Hashavshevet price-list
 * export, for the clients that are mapped to a price list.
 *
 * Two pieces have to meet:
 *
 *   the export      price list number → SKU → price   (parse-pricelist-pdf.js)
 *   the mapping     client            → price list number
 *
 * The mapping is not in the export. Hashavshevet keeps it on the customer card
 * (הנחות ועמלות → מחירון), and pulling it would mean a second report. With
 * 37 price lists and few active clients it is cheaper to hold the mapping
 * ourselves, in prices/clientPriceList, and edit it from the admin screen. The
 * cost of that choice is that it goes stale silently, so audit-data reports any
 * client with orders and no mapping.
 *
 * Writes, in the shape firebase-db.js already reads (_buildClientP):
 *   prices/clients/<clientKey>/<SKU> = price
 *   prices/clientKeys/<clientKey>    = client name
 *   prices/clientPriceList/<clientKey> = { list, listName, client }
 *
 * Usage:
 *   node scripts/import-pricelists.js                        dry run, shows everything
 *   node scripts/import-pricelists.js --map 509=6            add or change a mapping
 *   node scripts/import-pricelists.js --apply                write it
 *   node scripts/import-pricelists.js --file מחירונים.pdf     a different export
 */

const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ROOT  = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const FILE  = (() => { const i = process.argv.indexOf('--file'); return i > -1 ? process.argv[i + 1] : 'מחירונים.pdf'; })();

/* --map 509=6  ·  repeatable */
const newMappings = {};
process.argv.forEach((a, i) => {
  if (a !== '--map') return;
  const m = String(process.argv[i + 1] || '').match(/^(.+?)=(\d+)$/);
  if (m) newMappings[m[1].trim()] = m[2];
});

/* the parser prints its summary when run directly; require it quietly */
process.argv = [process.argv[0], process.argv[1], FILE];
const { lists } = require('./parse-pricelist-pdf.js');

initializeApp({
  credential: cert(require(path.join(ROOT, 'scripts', 'serviceAccountKey.json'))),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app',
});
const db = getDatabase();

(async () => {
  const [priceSnap, accSnap, ordSnap] = await Promise.all([
    db.ref('prices').once('value'),
    db.ref('hashavshevetAccounts').once('value'),
    db.ref('orders').once('value'),
  ]);
  const prices   = priceSnap.val() || {};
  const accounts = accSnap.val()   || {};
  const orders   = Object.values(ordSnap.val() || {});

  const mapping = Object.assign({}, prices.clientPriceList || {});
  for (const [key, list] of Object.entries(newMappings)) {
    const acc = accounts[key];
    mapping[key] = {
      list,
      listName: (lists[list] && lists[list].name) || list,
      client:   (acc && acc.name) || (mapping[key] && mapping[key].client) || key,
    };
  }

  console.log(`\n═══ ייבוא מחירונים ═══`);
  console.log(`קובץ: ${FILE} · ${Object.keys(lists).length} מחירונים`);
  console.log(`מיפויים: ${Object.keys(mapping).length}\n`);

  if (!Object.keys(mapping).length) {
    console.log('אין אף מיפוי לקוח→מחירון.');
    console.log('הוסף אחד:  node scripts/import-pricelists.js --map <מפתח חשבון>=<מספר מחירון>\n');
    process.exit(0);
  }

  const updates = {};
  for (const [key, m] of Object.entries(mapping)) {
    const L = lists[String(m.list)];
    if (!L) {
      console.log(`  ⚠  ${String(key).padEnd(8)} ${String(m.client).padEnd(20)} מחירון ${m.list} לא נמצא בקובץ`);
      continue;
    }
    const count = Object.keys(L.prices).length;
    console.log(`  ✓  ${String(key).padEnd(8)} ${String(m.client).padEnd(20)} מחירון ${String(m.list).padEnd(3)} ${String(L.name).padEnd(22)} ${count} מחירים`
                + (L.unread ? `   · ${L.unread} שורות לא נקראו` : ''));

    updates[`prices/clients/${key}`]         = L.prices;
    updates[`prices/clientKeys/${key}`]      = m.client;
    updates[`prices/clientPriceList/${key}`] = m;
  }

  /* what actually changes for real orders */
  const affected = orders.filter(o => Object.values(mapping).some(m => m.client === o.orderClient));
  if (affected.length) {
    console.log(`\nהזמנות של לקוחות ממופים: ${affected.length}`);
    const locked = affected.filter(o => o.pricesLockedAt).length;
    if (locked) console.log(`  מתוכן ${locked} כבר ננעלו — המחיר שלהן לא ישתנה, כפי שנועד`);
  }

  if (!APPLY) {
    console.log(`\nיבש. שום דבר לא נכתב.`);
    console.log(`להרצה אמיתית:  node scripts/import-pricelists.js --apply\n`);
    process.exit(0);
  }

  await db.ref().update(updates);
  console.log(`\nנכתבו ${Object.keys(updates).length} צמתים.\n`);
  process.exit(0);
})().catch(e => { console.error('import failed:', e.message); process.exit(1); });
