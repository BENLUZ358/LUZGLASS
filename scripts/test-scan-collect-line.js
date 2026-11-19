#!/usr/bin/env node
/** "נאסף בסריקה" בניהול + הסרה בהחזרה (בן, 19/11). Run: node scripts/test-scan-collect-line.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
const AD = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const m = SRC.match(/function lgScanCollectLine\(o\) \{[\s\S]*?\n\}/);
const ctx = {}; vm.createContext(ctx); vm.runInContext(m[0] + '\nthis.f = lgScanCollectLine;', ctx);
const at = new Date(2026, 10, 19, 9, 5).getTime();
check('L1 no record → empty', [ctx.f({}), ctx.f(null), ctx.f({ scanCollect: {} })], ['', '', '']);
check('L2 time + name', ctx.f({ scanCollect: { at, name: 'משה' } }), '📱 נאסף בסריקה 19/11 09:05 (משה)');
check('L3 early flagged', ctx.f({ scanCollect: { at, early: true } }), '📱 נאסף בסריקה 19/11 09:05 · ⚠ לפני מוכן');
check('U1 leaving collected clears the scan record', /if \(stage !== 'collected'\) patch\.scanCollect = null;/.test(SRC), true);
check('A1 admin modal + card show it', [/lgScanCollectLine\(o\)/.test(AD), /📱 נאסף בסריקה\$\{/.test(AD)], [true, true]);
check('A2 admin loads the new firebase-db', /firebase-db\.js\?v=20261119[s-z]/.test(AD), true);
console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
