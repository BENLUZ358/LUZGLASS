#!/usr/bin/env node
/**
 * מינימום חיוב במ"ר ללקוח (בן, 28/10/2026): אביבי — חתיכה מלוטשת לפחות 0.20 מ"ר,
 * מחוסמת לפחות 0.30, לכל חתיכה (2 חתיכות קטנות מלוטשות = 0.40). נשלח כך
 * לחשבשבת (Quantity), והמחיר על המסך מחושב באותו כלל.
 *
 * Run: node scripts/test-min-area.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'hashavshevet-order.js'), 'utf8').replace(/\r\n/g, '\n');
const DB  = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = {};
vm.createContext(ctx);
for (const re of [/function areaM2[\s\S]*?\n}/, /const LG_MIN_AREA = \{[\s\S]*?\n\};/, /function billAreaM2[\s\S]*?\n}/,
                  /const LG_LINE_TEXT_MAX = \d+;/, /const LG_HS_SEND_ITEMNAME = (?:true|false);/, /function lineText[\s\S]*?\n}/,
                  /function buildLines[\s\S]*?\n  return \{ lines, preview, skipped, hsLines, unpriced \};\n}/]) {
  const m = SRC.match(re);
  if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); }
  vm.runInContext(m[0].replace(/^const /, 'var '), ctx);
}
const bctx = {};
vm.createContext(bctx);
for (const re of [/function lgCalcAreaM2[\s\S]*?\n}/, /const LG_MIN_AREA = \{[\s\S]*?\n\};/, /function lgBillAreaM2[\s\S]*?\n}/,
                  /function lgCalcOrderTotal[\s\S]*?\n}/]) {
  const m = DB.match(re);
  if (!m) { console.error('FAIL  could not find in firebase-db ' + re); process.exit(1); }
  vm.runInContext(m[0].replace(/^const /, 'var '), bctx);
}
bctx.lgFindPriceItem = () => null;

// אותה טבלה בשני הצדדים — אחרת המסך והמסמך אומרים שני מספרים
check('the server and browser tables are identical',
      JSON.stringify(ctx.LG_MIN_AREA), JSON.stringify(bctx.LG_MIN_AREA));

// אביבי = כרטיס 450 בחשבשבת (בן, 28/10)
check('Avivi (450) has the rule on the server', ctx.LG_MIN_AREA['450'], { litush: 0.2, chisum: 0.3 });
check('Avivi (450) has the rule on the screen', bctx.LG_MIN_AREA['450'], { litush: 0.2, chisum: 0.3 });

// כלל לדוגמה על כרטיס בדיקה — כמו של אביבי
ctx.LG_MIN_AREA.T1 = bctx.LG_MIN_AREA.T1 = { litush: 0.2, chisum: 0.3 };
const LIT = { sku: '8CM', w: 300, h: 200, litush: true, chisum: false };   // 0.06 מ"ר
const CHI = { sku: '8CMH', w: 300, h: 200, litush: false, chisum: true };
const BIG = { sku: '8CM', w: 1000, h: 500, litush: true, chisum: false };  // 0.5 מ"ר
const lines = items => ctx.buildLines({ orderNum: 'L1', items }, 'T1', '1', '31', '1', { '8CM': 100, '8CMH': 120 }, {}).lines;

check('a small polished piece is billed 0.20', lines([LIT])[0].Quantity, '0.200');
check('a small tempered piece is billed 0.30', lines([CHI])[0].Quantity, '0.300');
check('two small polished pieces → 0.40 together', lines([LIT, LIT]).map(l => Number(l.Quantity)).reduce((a, b) => a + b), 0.4);
check('a big piece keeps its real area', lines([BIG])[0].Quantity, '0.500');
check('another customer pays the real area', ctx.buildLines({ orderNum: 'L1', items: [LIT] }, '999', '1', '31', '1', { '8CM': 100 }, {}).lines[0].Quantity, '0.060');
check('a piece with no size is still skipped', ctx.buildLines({ orderNum: 'L1', items: [{ sku: '8CM', w: 0, h: 0, litush: true }] }, 'T1', '1', '31', '1', { '8CM': 100 }, {}).skipped.length, 1);

// המחיר על המסך — אותו כלל, לפי customerId של ההזמנה
check('screen total uses the minimum', bctx.lgCalcOrderTotal({ customerId: 'T1', items: [LIT, CHI] }, { '8CM': 100, '8CMH': 120 }, {}), Math.round(0.2 * 100 + 0.3 * 120));
check('Avivi order (450) on the screen uses the minimum', bctx.lgCalcOrderTotal({ customerId: '450', items: [LIT] }, { '8CM': 100 }, {}), 20);
check('screen total for another customer is the real area', bctx.lgCalcOrderTotal({ customerId: '999', items: [LIT] }, { '8CM': 100 }, {}), 6);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll min-area checks passed.');
