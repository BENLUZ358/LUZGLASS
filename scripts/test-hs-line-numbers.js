#!/usr/bin/env node
/**
 * The measurement on each Hashavshevet order line, and the number that ties it
 * back to our item.
 *
 * Every line carries SM_Extratext1 = "3) 550x1885": the line number and the
 * width × height in mm. The multiplication factors cannot be written through
 * the API (two probe rounds, seven fields, nothing), but the text lands — and
 * the text is what the invoice station compares against the sketch.
 *
 * THE PROPERTY THIS FILE GUARDS: the number is the LINE's, not the item's.
 * buildLines skips items with no SKU, no dimensions or no price. Counting by
 * item position would then drift from Hashavshevet's numbering without a
 * sound — our item 4 would be their line 3 — and every correction made by
 * number would land on the wrong glass. None of the eleven live orders skips
 * anything today, which is exactly why it needs a test rather than a look.
 *
 * Run: node scripts/test-hs-line-numbers.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'hashavshevet-order.js'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = {};
vm.createContext(ctx);
for (const re of [/function areaM2[\s\S]*?\n}/, /const LG_LINE_TEXT_MAX = \d+;/, /function lineText[\s\S]*?\n}/,
                  /function buildLines[\s\S]*?\n  return \{ lines, preview, skipped, hsLines \};\n}/]) {
  const m = SRC.match(re);
  if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); }
  vm.runInContext(m[0].replace(/^const /, 'var '), ctx);
}

const PRICES = { '8SMH': 190, '8HMH': 210 };
const build = items => ctx.buildLines({ orderClient: 'x', items }, '14201', '1064', '31', '1', PRICES, {});

/* ── the text itself ───────────────────────────────────────────────────── */
{
  const { lines } = build([{ sku: '8SMH', w: 550, h: 1885 }]);
  check('number, then width x height', lines[0].SM_Extratext1, '1) 550x1885');
  check('fractions of a mm are rounded, not printed', ctx.lineText(2, 549.6, 1885.2), '2) 550x1885');
  check('a line-number in the hundreds still fits', ctx.lineText(999, 99999, 99999).length <= 50, true);
  check('and nothing ever passes 50 characters', ctx.lineText('9'.repeat(60), 1, 1).length, 50);
  /* the signature is computed over the string actually sent, so an extra key
     is only safe at the end — after Agent */
  check('it is the last key on the line', Object.keys(lines[0]).slice(-2), ['Agent', 'SM_Extratext1']);
}

/* ── the numbering survives a skip ─────────────────────────────────────── */
{
  const items = [
    { sku: '8SMH', w: 550,  h: 1885 },
    { sku: '8SMH', w: 800,  h: 550  },
    { sku: '',     w: 600,  h: 2000 },   // no SKU — skipped
    { sku: '8HMH', w: 1250, h: 655  },
    { sku: 'NOPRICE', w: 500, h: 500 },  // no price — skipped
    { sku: '8SMH', w: 700,  h: 1900 },
  ];
  const { lines, skipped, hsLines, preview } = build(items);

  check('four lines, two skipped', [lines.length, skipped.length], [4, 2]);
  check('the lines are numbered 1..4 with no gap',
        lines.map(l => l.SM_Extratext1),
        ['1) 550x1885', '2) 800x550', '3) 1250x655', '4) 700x1900']);
  /* the heart of it: item index 3 is line 3, not line 4 */
  check('each item maps to the line that carries it', hsLines,
        { 0: 1, 1: 2, 2: null, 3: 3, 4: null, 5: 4 });
  check('a skipped item is cleared, not left with a stale number',
        [hsLines[2], hsLines[4]], [null, null]);
  check('the preview shows the same numbers the document gets',
        preview.map(p => p.hsLine), [1, 2, 3, 4]);

  /* the other direction: from a line in Hashavshevet back to our item */
  const back = n => Object.keys(hsLines).find(k => hsLines[k] === n);
  check('and the number parsed off a line leads back to the item',
        items[back(Number(/^(\d+)\)/.exec(lines[2].SM_Extratext1)[1]))].w, 1250);
}

/* ── items stored as a keyed object, as Firebase sometimes returns them ─ */
{
  const { hsLines } = build({ a1: { sku: '8SMH', w: 500, h: 500 }, b2: { sku: '8SMH', w: 0, h: 0 } });
  check('keys are Firebase keys, so the write-back hits the right child', hsLines, { a1: 1, b2: null });
}

/* ── write-back happens only once a document exists ────────────────────── */
{
  const writeAt = SRC.indexOf("'/hsLine'");
  const notOk   = SRC.indexOf('if (!wgRes.ok)');
  check('the numbers are written back', writeAt > -1, true);
  check('only after a rejected send has already returned', notOk > -1 && writeAt > notOk, true);
}

/* ── כמות · a group of identical pieces ────────────────────────────────────
   5 units of the same size are 5 items here and 5 LINES in Hashavshevet, each
   carrying the area of ONE piece. That is what makes the total m² right, and
   what lets a single piece be cancelled with "בטל יתרה לאספקה" later. The
   "(2/5)" says so on the line, so five identical rows do not read as a slip. */
{
  const g = 'grp_1';
  const { lines, preview } = build([
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 5, groupIndex: 1 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 5, groupIndex: 2 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 5, groupIndex: 3 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 5, groupIndex: 4 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 5, groupIndex: 5 },
    { sku: '8HMH', w: 900, h: 2000 },
  ]);
  check('five units are five lines, not one', lines.length, 6);
  check('each line carries the area of a single piece — the sum is the quantity',
        lines.slice(0, 5).map(l => l.Quantity), ['1.037', '1.037', '1.037', '1.037', '1.037']);
  check('and the line says which of the five it is',
        lines.slice(0, 5).map(l => l.SM_Extratext1),
        ['1) 550x1885 (1/5)', '2) 550x1885 (2/5)', '3) 550x1885 (3/5)',
         '4) 550x1885 (4/5)', '5) 550x1885 (5/5)']);
  check('a piece that stands alone gets no count — it would be noise',
        lines[5].SM_Extratext1, '6) 900x2000');
  check('the preview the office sees says the same', preview[1].text, '2) 550x1885 (2/5)');
}

/* a skipped piece must not be counted: the document would promise glass that
   is not on it. The count is of the lines sent, never of originalQuantity. */
{
  const g = 'grp_2';
  const { lines, skipped } = build([
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 3, groupIndex: 1 },
    { sku: '',     w: 550, h: 1885, quantityGroupId: g, originalQuantity: 3, groupIndex: 2 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g, originalQuantity: 3, groupIndex: 3 },
  ]);
  check('one of the three was skipped', skipped.length, 1);
  check('so the lines say 2, not 3 — originalQuantity is never trusted',
        lines.map(l => l.SM_Extratext1), ['1) 550x1885 (1/2)', '2) 550x1885 (2/2)']);
}

/* two different groups in one order do not bleed into each other */
{
  const { lines } = build([
    { sku: '8SMH', w: 500, h: 500, quantityGroupId: 'a' },
    { sku: '8HMH', w: 600, h: 600, quantityGroupId: 'b' },
    { sku: '8SMH', w: 500, h: 500, quantityGroupId: 'a' },
    { sku: '8HMH', w: 600, h: 600, quantityGroupId: 'b' },
  ]);
  check('each group counts itself only',
        lines.map(l => l.SM_Extratext1),
        ['1) 500x500 (1/2)', '2) 600x600 (1/2)', '3) 500x500 (2/2)', '4) 600x600 (2/2)']);
}

/* a piece split out of its group by a measurement correction (lgEditInvoiceItem
   drops quantityGroupId) is one piece again, and the rest still count together */
{
  const g = 'grp_3';
  const { lines } = build([
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g },
    { sku: '8SMH', w: 500, h: 1885 },
    { sku: '8SMH', w: 550, h: 1885, quantityGroupId: g },
  ]);
  check('the corrected piece stands alone, the other two stay a pair',
        lines.map(l => l.SM_Extratext1),
        ['1) 550x1885 (1/2)', '2) 500x1885', '3) 550x1885 (2/2)']);
}

/* ── the probe is gone ─────────────────────────────────────────────────── */
check('no probe flag left in the handler', /probe/i.test(SRC), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll line-number checks passed.');
