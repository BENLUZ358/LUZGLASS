#!/usr/bin/env node
/**
 * אין כפתורי איפוס במערכת החיה (בן, 06/10).
 *
 * "אפס יום" (יום עבודה) ו"אפס הכל" (תפריט צדדי) נבנו בהתחלה לבדיקות.
 * לחיצה אחת מחקה workdayStatus / readyStatus / inspectionStatus /
 * temperingStatus מכל ההזמנות שביום, ואת סימוני תחנת הבדיקה — ו-unavResetAll
 * נפל, אם לא מצא את resetDay, ל-localStorage.clear(). בפרודקשן זה כפתור
 * שאין ממנו חזרה, ליד כפתורי עבודה רגילים.
 *
 * Run: node scripts/test-no-reset.js
 */
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
for (const p of pages) {
  const t = fs.readFileSync(path.join(ROOT, p), 'utf8');
  check(`${p}: no "reset day" / "reset all" button`, /אפס יום|אפס הכל/.test(t), false);
  check(`${p}: no reset function left to wire up again`, /function (resetDay|unavResetAll|resetAllOrders)\b/.test(t), false);
  check(`${p}: nothing wipes the browser's saved state`, /localStorage\.clear\(\)/.test(t), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nNo reset buttons anywhere.');
