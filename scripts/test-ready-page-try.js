#!/usr/bin/env node
//  "מוכן" מהדף (בן, 19/11): הבקשה שורדת מעבר מסך (keepalive), כל ניסיון נרשם
//  על ההזמנה (readyTry), ורשת הביטחון בשרת מחכה דקה ולא 3.
//  Run: node scripts/test-ready-page-try.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
const FD = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const RN = fs.readFileSync(path.join(ROOT, 'api', '_ready-net.js'), 'utf8');
let fail = 0;
const check = (n, ok) => ok ? console.log('ok    ' + n) : (fail++, console.error('FAIL  ' + n));
check('_lgAuthPost passes keepalive when asked', /async function _lgAuthPost\(url, payload, opts\)/.test(FD) && /keepalive: !!\(opts && opts\.keepalive\)/.test(FD));
check('ready dispatch from the page uses keepalive', /kind:'ready', orderIds: group, dryRun:false \}, \{ keepalive: true \}/.test(WD));
check('recorder writes readyTry on the order', /function _wdReadyTry\(/.test(WD) && /updateOrder\(String\(id\), \{ readyTry: rec \}\)/.test(WD));
check('every outcome is recorded', ['sending', 'queued', 'exception'].every(s => WD.includes("'" + s + "'")) && /'error ' \+ res\.status/.test(WD));
check('finish-day records scheduled before the timer', /_wdReadyTry\(_waReady, 'scheduled', 'finish-day'\); setTimeout/.test(WD));
check('check-finish records scheduled', /_wdReadyTry\(_waPending, 'scheduled', 'check-finish'\)/.test(WD));
check('workday loads the new firebase-db', /firebase-db\.js\?v=20261119c/.test(WD));
check('safety net waits 1 minute', /const MIN_AGE_MS = 1 \* MIN;/.test(RN));
// the net still respects the minimum: 30s old is not due, 61s is
const N = require(path.join(ROOT, 'api', '_ready-net.js'));
const NOW = Date.UTC(2026, 10, 19, 10, 0, 0);
const o = at => ({ stage: 'done', readyAt: at, orderClient: 'X' });
check('net: 30s old not picked', N.lgReadyNetPick({ a: o(NOW - 30e3) }, NOW).length === 0);
check('net: 61s old picked', N.lgReadyNetPick({ a: o(NOW - 61e3) }, NOW).length === 1);
console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
