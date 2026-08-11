#!/usr/bin/env node
/**
 * audit-data.js — reads the live database and reports contradictions.
 *
 * READ ONLY. It never writes, never deletes, never advances a stage. Run it as
 * often as you like; the worst it can do is print.
 *
 * Why this exists: the sixteen test suites check contracts — how a SKU name is
 * parsed, which panels belong on which report, how an arrival map decodes.
 * They run against invented inputs. Nothing has ever looked at the real data to
 * ask whether it actually holds together, and that is where a whole class of
 * problem lives: an order that can never leave its stage, an arrival mark
 * pointing past the end of its items array, a panel nobody can price.
 *
 * Each finding says what is wrong, which order or SKU, and what it means on
 * screen — so it can be judged rather than just counted.
 *
 * Usage:
 *   node scripts/audit-data.js              full report
 *   node scripts/audit-data.js --summary    counts only
 *   node scripts/audit-data.js --max 5      at most 5 examples per finding
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ROOT     = path.join(__dirname, '..');
const SUMMARY  = process.argv.includes('--summary');
const MAX      = (() => {
  const i = process.argv.indexOf('--max');
  return i > -1 ? Math.max(1, parseInt(process.argv[i + 1]) || 10) : 10;
})();

/* ── reuse the real helpers, so the audit and the app agree ─────────────── */
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const parts = [
  /function _lgItemHasGraphic[\s\S]*?\n}/,
  /function _lgItemHasChalavi[\s\S]*?\n}/,
  /function _lgItemIsTriplex[\s\S]*?\n}/,
  /function _lgItemIsLaminatedTriplex[\s\S]*?\n}/,
  /function _lgItemHasSurfaceWork[\s\S]*?\n}/,
  /function _lgItemIsMirror[\s\S]*?\n}/,
  /function lgSplitFactoryItems[\s\S]*?\n}/,
  /function lgArrivedIdxs[\s\S]*?\n}/,
].map(re => (SRC.match(re) || [null])[0]);
if (parts.some(p => !p)) {
  console.error('could not extract the shared helpers from firebase-db.js');
  process.exit(1);
}
const H = { console };
vm.createContext(H);
vm.runInContext(parts.join('\n'), H);

/* ── findings ───────────────────────────────────────────────────────────── */
const findings = [];
const add = (severity, title, meaning) => {
  const f = { severity, title, meaning, hits: [] };
  findings.push(f);
  return h => f.hits.push(h);
};

const app = initializeApp({
  credential: cert(require(path.join(ROOT, 'scripts', 'serviceAccountKey.json'))),
  databaseURL: 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app',
});
const db = getDatabase(app);

(async () => {
  const [ordSnap, skuSnap, priceSnap, userSnap, accSnap] = await Promise.all([
    db.ref('orders').once('value'),
    db.ref('skuCatalog').once('value'),
    db.ref('prices').once('value'),
    db.ref('users').once('value'),
    db.ref('hashavshevetAccounts').once('value'),
  ]);

  const orders   = Object.values(ordSnap.val()   || {});
  const catalog  = skuSnap.val()   || {};
  const prices   = priceSnap.val() || {};
  const users    = Object.values(userSnap.val() || {});
  const accounts = accSnap.val()   || {};

  const globalPrices = prices.global || {};
  const norm  = p => String(p || '').replace(/[-\s]/g, '');
  const items = o => Array.isArray(o.items) ? o.items
                   : (o.items && typeof o.items === 'object') ? Object.values(o.items) : [];
  const label = o => `${o.id} · ${o.orderClient || '—'}${o.orderNum ? ' · ' + o.orderNum : ''}`;

  const customerIdByPhone = {};
  users.forEach(u => { if (u && u.phone && u.customerId) customerIdByPhone[norm(u.phone)] = u.customerId; });

  /* ── 1. arrival marks that point past the end of the items array ────────
     chisumArrivedIdxs stores POSITIONS. If an item is ever removed from the
     middle, every mark after it lands on a different panel — silently. This
     is the check that would catch it having happened. */
  const stray = add('critical',
    'סימון הגעה שמצביע מעבר לסוף רשימת הפריטים',
    'האינדקסים זזו. הסימונים על המסך מצביעים על פאנלים אחרים ממה שסומן.');

  /* ── 2. arrival marks on a panel that is not on that report ────────────
     A chisum mark on a mirror, or on a laminated triplex panel, means the two
     tracks got crossed somewhere. */
  const wrongTrack = add('critical',
    'סימון הגעה על פאנל שאינו בדוח הזה',
    'סימון חיסום על מראה או על טריפלקס — שני המסלולים התערבבו.');

  /* ── 3. orders that can never leave the chisum stage ───────────────────── */
  const stuck = add('critical',
    'הזמנה בחיסום בלי אף פאנל שנוסע למפעל',
    'אין מה לסמן ואין מה שיסיים אותה. היא תישאר שם לנצח.');

  /* ── 4. sent to the factory with nothing identifying the report ────────── */
  const noReport = add('high',
    'הזמנה שנשלחה לחיסום בלי מזהה דוח',
    'היא לא תופיע תחת אף דוח במסך, אז אי אפשר לסמן שהגיעה.');

  const triplexNoReport = add('high',
    'פאנלי טריפלקס במפעל בלי מזהה דוח טריפלקס',
    'טאב הטריפלקס מסנן לפי המזהה — הם לא יופיעו בו.');

  /* ── 5. nobody to message, no account to bill ──────────────────────────── */
  const noPhone = add('high',
    'הזמנה בלי טלפון לקוח',
    'אי אפשר לשלוח הודעה ואי אפשר למצוא מפתח חשבון בחשבשבת.');

  const noAccount = add('medium',
    'ללקוח אין מפתח חשבון בחשבשבת',
    'ההזמנה תיעצר עם "אין מפתח חשבון" כשינסו לפתוח אותה שם.');

  const noCardPhone = add('medium',
    'לכרטיס הלקוח בחשבשבת אין טלפון',
    'ההודעה תצא למספר שהועתק להזמנה, ולא למספר המתוחזק בכרטיס.');

  /* The client→price-list mapping is held here rather than pulled, so it goes
     stale in silence: a new client, or one moved to another list in
     Hashavshevet, keeps being priced from the general list with nothing to
     say so. This is the check that makes the manual mapping safe to live with. */
  const noPriceList = add('medium',
    'לקוח עם הזמנות שאין לו מחירון משויך',
    'ההזמנות שלו מתומחרות לפי המחירון הכללי, גם אם בחשבשבת יש לו מחירון משלו.');

  /* ── 6. panels that cannot be priced or filtered ───────────────────────── */
  const noSku = add('high',
    'פריט בלי מק"ט',
    'אי אפשר לתמחר אותו ואי אפשר לסנן אותו לפי סוג זכוכית.');

  const unknownSku = add('high',
    'פריט עם מק"ט שאינו בקטלוג',
    'לא יימצא לו מחיר, ותווית סוג הזכוכית תישאר ריקה.');

  /* An unpriced SKU nobody has ever ordered is noise. One that already appears
     in a real order is a bill waiting to come out wrong — so they are separate
     findings, and only the second one is urgent. */
  const unpricedUsed = add('high',
    'מק"ט שכבר הוזמן בפועל ואין לו מחיר',
    'הזמנה שתינעל עם הפריט הזה תינעל על 0 ותצטרך תיקון ידני.');
  const unpricedIdle = add('info',
    'מק"ט בלי מחיר שעדיין לא הוזמן',
    'לא דחוף. יהפוך לדחוף ברגע שמישהו יזמין אותו.');

  const noGlassType = add('medium',
    'מק"ט בלי סוג זכוכית או בלי עובי',
    'הוא לא יופיע באף אפשרות בסינון סוג הזכוכית.');

  /* ── 7. money already locked at nothing ────────────────────────────────── */
  const zeroLocked = add('critical',
    'הזמנה שננעלה על סכום 0 למרות שיש בה פריטים',
    'המחיר הוקפא לפני שהיה מחירון. הסכום הזה כבר לא יתעדכן מעצמו.');

  /* ── 8. two orders wearing the same number ─────────────────────────────── */
  const dupNum = add('high',
    'אותו מספר הזמנה על יותר מהזמנה אחת',
    'האסמכתא לחשבשבת נגזרת ממנו — שתי הזמנות ייפתחו על אותו מסמך.');

  /* ── 9. test data that reached the real flow ───────────────────────────── */
  const testLate = add('info',
    'הזמנה פיקטיבית שהתקדמה בתהליך',
    'תקין לבדיקות. רק שתדע כמה מהן יושבות במערכת.');

  /* ── walk the orders ────────────────────────────────────────────────────── */
  const byNum = {};
  for (const o of orders) {
    if (!o || !o.id) continue;
    const its   = items(o);
    const stage = o.stage || '';
    const split = H.lgSplitFactoryItems(its);
    const chIdx = new Set(split.chisum.map(e => e.idx));
    const txIdx = new Set(split.triplex.map(e => e.idx));

    if (o.orderNum) (byNum[o.orderNum] = byNum[o.orderNum] || []).push(o.id);

    for (const [field, valid, track] of [
      ['chisumArrivedIdxs',  chIdx, 'חיסום'],
      ['chisumClosedIdxs',   chIdx, 'חיסום'],
      ['triplexArrivedIdxs', txIdx, 'טריפלקס'],
      ['triplexClosedIdxs',  txIdx, 'טריפלקס'],
    ]) {
      if (o[field] === undefined || o[field] === null) continue;
      for (const i of H.lgArrivedIdxs(o[field])) {
        if (i >= its.length) stray(`${label(o)} — ${field}[${i}] אבל יש ${its.length} פריטים`);
        else if (!valid.has(i)) wrongTrack(`${label(o)} — ${field} מסמן פריט ${i} שאינו בדוח ${track}`);
      }
    }

    if (stage === 'chisum') {
      if (!split.chisum.length && !split.triplex.length) stuck(label(o));
      if (split.chisum.length && !o.chisumReportId)      noReport(label(o));
      if (split.triplex.length && !o.triplexReportId)    triplexNoReport(`${label(o)} — ${split.triplex.length} פאנלים`);
    }

    const phone = norm(o.clientPhone || o.phone);
    if (!phone) noPhone(label(o));
    else {
      const key = o.customerId || customerIdByPhone[phone];
      if (!key) noAccount(`${label(o)} — טלפון ${phone}`);
      else if (accounts[key] && !accounts[key].phone) noCardPhone(`${label(o)} — חשבון ${key}`);
    }

    its.forEach((it, i) => {
      if (!it) return;
      const sku = String(it.sku || '').toUpperCase();
      if (!sku) { if (!it.glass && !it.mm) noSku(`${label(o)} — פריט ${i} "${it.name || ''}"`); }
      else if (!catalog[sku] && !catalog[String(it.sku)]) unknownSku(`${label(o)} — פריט ${i} מק"ט ${sku}`);
    });

    if (o.totalFinal === 0 && its.length) zeroLocked(`${label(o)} — ${its.length} פריטים`);
    if (o.isTest && stage && stage !== '') testLate(`${label(o)} — שלב ${stage}`);
  }

  Object.entries(byNum).forEach(([num, ids]) => {
    if (ids.length > 1) dupNum(`${num} → ${ids.join(', ')}`);
  });

  /* ── clients with orders but no price list ─────────────────────────────── */
  {
    const mapped = prices.clientPriceList || {};
    const byName = new Set(Object.values(mapped).map(m => m && m.client));
    const seen   = new Set();
    for (const o of orders) {
      const name = o.orderClient;
      if (!name || o.isTest || seen.has(name)) continue;
      seen.add(name);
      if (!byName.has(name)) noPriceList(`${name} — ${orders.filter(x => x.orderClient === name).length} הזמנות`);
    }
  }

  /* ── walk the catalogue ─────────────────────────────────────────────────── */
  /* which SKUs have actually been ordered — that is what separates a price
     gap that matters today from one that matters if someone orders it */
  const ordered = new Set();
  orders.forEach(o => items(o).forEach(it => {
    if (it && it.sku) ordered.add(String(it.sku).toUpperCase());
  }));

  let priced = 0;
  const skus = Object.values(catalog);
  for (const e of skus) {
    if (!e || !e.code) continue;
    if (e.active === false) continue;
    const code = String(e.code).toUpperCase();
    if (globalPrices[e.code] != null || globalPrices[code] != null) priced++;
    else if (ordered.has(code)) unpricedUsed(`${e.code} — ${e.name || ''}`);
    else unpricedIdle(`${e.code} — ${e.name || ''}`);
    if (!e.glass || !e.mm) noGlassType(`${e.code} — ${e.name || ''}`);
  }

  /* ── report ─────────────────────────────────────────────────────────────── */
  const RANK  = { critical: 0, high: 1, medium: 2, info: 3 };
  const BADGE = { critical: 'קריטי ', high: 'גבוה  ', medium: 'בינוני', info: 'מידע  ' };

  console.log('\n═══ בדיקת שלמות נתונים — לוז גלאס ═══');
  const usedTotal  = [...ordered].filter(c => catalog[c]).length;
  const usedPriced = [...ordered].filter(c => globalPrices[c] != null).length;
  console.log(`${orders.length} הזמנות · ${skus.length} מק"טים · ${priced} מתומחרים`
              + ` (${skus.length ? Math.round(priced / skus.length * 100) : 0}%)`);
  console.log(`מתוך ${usedTotal} מק"טים שכבר הוזמנו בפועל — ${usedPriced} מתומחרים`
              + ` (${usedTotal ? Math.round(usedPriced / usedTotal * 100) : 100}%)`);
  console.log(`${users.length} משתמשים · ${Object.keys(accounts).length} כרטיסי לקוח\n`);

  const real = findings.filter(f => f.hits.length).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  if (!real.length) { console.log('לא נמצאו סתירות.\n'); process.exit(0); }

  for (const f of real) {
    console.log(`[${BADGE[f.severity]}] ${f.hits.length.toString().padStart(4)}  ${f.title}`);
    console.log(`                 ${f.meaning}`);
    if (!SUMMARY) {
      f.hits.slice(0, MAX).forEach(h => console.log('                   · ' + h));
      if (f.hits.length > MAX) console.log(`                   … ועוד ${f.hits.length - MAX}`);
    }
    console.log('');
  }

  const worst = real[0].severity;
  console.log(`נמצאו ${real.reduce((s, f) => s + f.hits.length, 0)} ממצאים ב-${real.length} קטגוריות.`);
  console.log(worst === 'critical'
    ? 'יש ממצאים קריטיים — כדאי לטפל בהם לפני עבודה שוטפת.\n'
    : 'אין ממצאים קריטיים.\n');
  process.exit(0);
})().catch(e => { console.error('audit failed:', e.message); process.exit(1); });
