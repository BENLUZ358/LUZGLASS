#!/usr/bin/env node
/**
 * טאבי גרפיקה / הובלות ביום עבודה — הזמנה בלי סקיצה אומרת זאת (בן, 06/10).
 *
 * הזמנה בלי סקיצה פשוט לא הציגה כלום במקום התמונה, וזה נראה כמו תקלה
 * ("אני לא רואה את הסקיצה בהובלות" — L9011, שבאמת אין לה סקיצה).
 *
 * Run: node scripts/test-stage-sketch.js
 */
const fs   = require('fs');
const path = require('path');
const W = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const fn = (W.match(/function _stageTabHTML\([\s\S]*?\n}/) || [''])[0];
check('the stage card renderer is found', fn.length > 0, true);
check('an order with a sketch still gets the lazy image', /lgHasSketch\(o\)\s*\?\s*`<img class="stv-sk" data-sketch-for/.test(fn), true);
check('an order without one says so', /<div class="stv-nosk">אין סקיצה להזמנה<\/div>/.test(fn), true);
check('and the message has a style', /\.stv-nosk\{/.test(W), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll stage-sketch checks passed.');
