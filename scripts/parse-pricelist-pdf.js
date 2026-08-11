#!/usr/bin/env node
/**
 * parse-pricelist-pdf.js — reads the price-list report exported from
 * Hashavshevet as PDF and turns it into { priceList: { SKU: price } }.
 *
 * The report is "~תנועות מחירון ללקוח מחירים עדכניים לתאריך~", grouped by
 * מספר מחירון, one row per item per discount code.
 *
 * Why a PDF: the live route needs Hrep, which exists only on the main station.
 * A PDF can be exported from any machine, so this gets real prices in today.
 * It is a snapshot — re-export when prices change, or wire the report through
 * the API later. The output shape is identical either way, so nothing
 * downstream needs to know which route produced it.
 *
 * Two things make the text harder than it looks, and both cost an attempt:
 *
 *   The strings are glyph ids, not characters. The ToUnicode CMaps translate
 *   them — and there are TWO, one per embedded font subset, reusing the same
 *   ids for different characters. Merging them decodes one font and garbles
 *   the other, which is what hid the group headers the first time.
 *
 *   Hebrew is stored in visual order, so it comes out reversed.
 *
 * Usage:
 *   node scripts/parse-pricelist-pdf.js מחירונים.pdf
 *   node scripts/parse-pricelist-pdf.js מחירונים.pdf --list 6
 *   node scripts/parse-pricelist-pdf.js מחירונים.pdf --json
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const file   = process.argv[2] || 'מחירונים.pdf';
const asJson = process.argv.includes('--json');
const only   = (() => { const i = process.argv.indexOf('--list'); return i > -1 ? String(process.argv[i + 1]) : null; })();

const buf = fs.readFileSync(path.isAbsolute(file) ? file : path.join(process.cwd(), file));
const raw = buf.toString('latin1');

/* ── one character map per embedded font ───────────────────────────────── */
function readCMaps(src) {
  const byFont = {};
  let i = 0;
  while (true) {
    const c = src.indexOf('begincmap', i);
    if (c < 0) break;
    const end  = src.indexOf('endcmap', c);
    const name = (src.slice(c, c + 400).match(/\/CMapName\s*\/(\w+)/) || [])[1];
    const map  = {};
    for (const m of src.slice(c, end).matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,})>/g)) {
      map[m[1].toUpperCase()] = String.fromCharCode(parseInt(m[2].slice(0, 4), 16));
    }
    if (name) byFont[name] = map;
    i = end + 7;
  }
  return byFont;
}
const CMAPS = readCMaps(raw);
if (!Object.keys(CMAPS).length) {
  console.error('לא נמצא מיפוי תווים ב-PDF.');
  process.exit(1);
}
/* fonts are declared in order, so /F1 is the first CMap and /F2 the second */
const FONT_NAMES = Object.keys(CMAPS);
const fontFor = res => CMAPS[FONT_NAMES[Math.max(0, parseInt(String(res).replace(/\D/g, ''), 10) - 1)]] || CMAPS[FONT_NAMES[0]];

const HEB = /[֐-׿]/;
function decode(hex, map) {
  const out = (hex.match(/.{4}/g) || []).map(h => map[h.toUpperCase()] || '').join('');
  /* PDF holds RTL text in visual order */
  return HEB.test(out) ? [...out].reverse().join('') : out;
}

/* ── every drawn string, grouped into rows by baseline ─────────────────── */
function contentStreams() {
  const out = [];
  let i = 0;
  while (true) {
    const st = raw.indexOf('stream', i);
    if (st < 0) break;
    let p = st + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = raw.indexOf('endstream', p);
    if (e < 0) break;
    try {
      const t = zlib.inflateSync(buf.slice(p, e)).toString('latin1');
      if (/Tj/.test(t)) out.push(t);
    } catch (_) { /* not deflate */ }
    i = e + 9;
  }
  return out;
}

function rowsOf(stream) {
  const rows = {};
  let x = 0, y = 0, map = CMAPS[FONT_NAMES[0]];
  const re = /\/(F\d+)\s+[\d.]+\s+Tf|([\d.]+)\s+([\d.]+)\s+Td|<([0-9A-Fa-f]+)>\s*Tj/g;
  let m;
  while ((m = re.exec(stream))) {
    if (m[1]) { map = fontFor(m[1]); continue; }
    if (m[2] !== undefined) { x = parseFloat(m[2]); y = parseFloat(m[3]); continue; }
    const text = decode(m[4], map);
    if (!text.trim()) continue;
    (rows[y] = rows[y] || []).push({ x, text: text.trim() });
  }
  return Object.entries(rows)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, cells]) => cells.sort((a, b) => b.x - a.x));   // right to left
}

/* ── walk the report ───────────────────────────────────────────────────── */
const lists = {};
let current = null, pendingNumber = null;

for (const stream of contentStreams()) {
  for (const cells of rowsOf(stream)) {
    const texts = cells.map(c => c.text);
    const line  = texts.join(' ').replace(/\s+/g, ' ').trim();

    if (/מספר\s*מחירון/.test(line)) {
      pendingNumber = (texts.find(t => /^\d+$/.test(t)) || null);
      continue;
    }
    if (/שם\s*מחירון/.test(line)) {
      const name = texts.filter(t => !/שם\s*מחירון/.test(t)).join(' ').trim();
      if (pendingNumber) {
        current = pendingNumber;
        lists[current] = lists[current] || { name: name || current, prices: {}, rows: 0 };
        if (name) lists[current].name = name;
      }
      continue;
    }
    if (!current) continue;

    const sku = texts[0];
    if (!sku || !/^[0-9A-Z]{2,20}$/i.test(sku)) continue;

    /* Numbers are taken from everything AFTER the item key. A numeric SKU such
       as "0006" otherwise parses as the number 6 and becomes its own price —
       which is exactly what the first run produced.

       Column order right-to-left is: מפתח פריט · שם פריט · מחיר ללקוח ·
       מחיר מחירון · מטבע · אחוז הנחה · אחוז עמלה · קוד הנחה · תאריך.
       The first positive number is therefore מחיר ללקוח; the zero discount
       percentages are skipped by the > 0 test, and the discount code sits
       after both prices so it is never reached. */
    const nums = texts.slice(1).filter(t => /^\d+(\.\d+)?$/.test(t)).map(Number);

    /* מחיר ללקוח and מחיר מחירון are adjacent and equal on every row in this
       report, so a repeated positive number is the price. Taking merely the
       first positive number is not safe: when an item name wraps onto a second
       line the price cells land on a different baseline, the row is left with
       only its discount code, and "10ACCM ₪12" gets recorded for a ₪400 panel.

       A row without that pair is skipped and counted. For money, missing a
       price is recoverable and inventing one is not. */
    let price = null;
    for (let k = 0; k + 1 < nums.length; k++) {
      if (nums[k] > 0 && nums[k] === nums[k + 1]) { price = nums[k]; break; }
    }
    if (price === null) { lists[current].unread = (lists[current].unread || 0) + 1; continue; }

    const S = sku.toUpperCase();
    lists[current].rows++;
    if (lists[current].prices[S] === undefined) lists[current].prices[S] = price;
    else if (lists[current].prices[S] !== price) {
      (lists[current].conflicts = lists[current].conflicts || []).push(`${S}: ${lists[current].prices[S]} מול ${price}`);
    }
  }
}

/* ── usable as a module, so the importer parses the same way ───────────── */
module.exports = { lists, parse: () => lists };
if (require.main !== module) return;

/* ── output ────────────────────────────────────────────────────────────── */
if (asJson) { console.log(JSON.stringify(lists, null, 2)); process.exit(0); }

const nums = Object.keys(lists).sort((a, b) => Number(a) - Number(b));
if (!nums.length) { console.error('לא זוהו מחירונים בקובץ.'); process.exit(1); }

console.log(`\n${nums.length} מחירונים · ${path.basename(file)}\n`);
for (const n of nums) {
  const L = lists[n];
  console.log(`  ${String(n).padStart(3)}  ${String(L.name).padEnd(26)} ${String(Object.keys(L.prices).length).padStart(4)} מק"טים`
              + (L.conflicts ? `   ⚠ ${L.conflicts.length} סתירות` : "")
              + (L.unread ? `   · ${L.unread} שורות לא נקראו` : ""));
}

if (only) {
  const L = lists[only];
  if (!L) { console.log(`\nמחירון ${only} לא נמצא.`); }
  else {
    console.log(`\n── מחירון ${only} · ${L.name} ──`);
    Object.entries(L.prices).sort().forEach(([k, v]) => console.log(`   ${k.padEnd(12)} ₪${v}`));
    if (L.conflicts) { console.log('\n   סתירות:'); L.conflicts.forEach(c => console.log('     ' + c)); }
  }
}
console.log('');
