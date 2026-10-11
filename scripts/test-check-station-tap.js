#!/usr/bin/env node
/**
 * תחנת הבדיקה — נגיעה במרכז זכוכית בסקיצה המצוירת מסמנת אותה.
 *
 * buildSVG מצייר לכל זכוכית מלבן לחיץ (rect[data-idx], onclick + touchend), ומעליו
 * את השם, המידה ותווית "🔥 חיסום". הטקסטים היו קולטים את הלחיצה — נגיעה במרכז
 * הזכוכית, המקום הטבעי ביותר, לא סימנה כלום; רק השוליים הריקים עבדו.
 * נמצא בהקלטת סרטון ההדרכה (12/10) ואומת בדפדפן: לפני התיקון 0/2 בלחיצה ובנגיעה,
 * אחריו 2/2 (tools/training-video/verify-check-tap.mjs).
 *
 * Run: node scripts/test-check-station-tap.js
 */
const fs = require('fs');
const path = require('path');
const CS = fs.readFileSync(path.join(__dirname, '..', 'check-station.html'), 'utf8');

let failed = 0;
const check = (name, ok) => ok ? console.log('ok    ' + name) : (failed++, console.error('FAIL  ' + name));

check('decorations inside the drawn sketch let taps through',
      /#skWrap svg text,\s*#skWrap svg rect:not\(\[data-idx\]\)\s*\{\s*pointer-events:\s*none;?\s*\}/.test(CS));
const svg = (CS.match(/function buildSVG\([\s\S]*?\n\}/) || [''])[0];
check('buildSVG still puts the click on the glass rect', /data-idx="'\+origIdx\+'" onclick="checkItem\('\+origIdx\+'\)"/.test(svg));
check('and the touch handler is on the same rects', /querySelectorAll\('rect\[data-idx\]'\)[\s\S]{0,200}touchend/.test(CS));
// nothing clickable is a <text> — otherwise the rule above would disable it
check('no clickable text in the sketch', !/<text[^>]*onclick/.test(svg));

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
