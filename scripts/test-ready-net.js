#!/usr/bin/env node
/**
 * רשת הביטחון של "מוכן לאיסוף" (בן, 9/11): lgReadyUnsentIds + החיבור ביום העבודה.
 * דוח חיסום 50 (9/11) — הדף לא שלח, ואיש לא ידע. Run: node scripts/test-ready-net.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');
const WD  = fs.readFileSync(path.join(__dirname, '..', 'workday.html'), 'utf8');
const m = SRC.match(/const LG_READY_NET_MIN_MS[\s\S]*?\nfunction lgReadyUnsentIds[\s\S]*?\n}/);
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
};
check('helper found', !!m, true);
const ctx = {}; vm.createContext(ctx); vm.runInContext(m[0] + '\nthis.f = lgReadyUnsentIds;', ctx);
const NOW = 1_800_000_000_000, MIN = 60_000;
const o = (id, x) => ({ id, stage: 'done', readyAt: NOW - 10 * MIN, ...x });
check('done 10 min ago, no message → sent', ctx.f([o('a')], NOW), ['a']);
check('just now (< 3 min) → the normal send still has time', ctx.f([o('a', { readyAt: NOW - MIN })], NOW), []);
check('older than a day → never', ctx.f([o('a', { readyAt: NOW - 25 * 60 * MIN })], NOW), []);
check('no readyAt (old orders) → never', ctx.f([o('a', { readyAt: undefined })], NOW), []);
check('already sent on WhatsApp', ctx.f([o('a', { whatsapp: { sentAt: 1 } })], NOW), []);
check('already sent by email', ctx.f([o('a', { emailNotices: { ready: 1 } })], NOW), []);
check('test order', ctx.f([o('a', { isTest: true })], NOW), []);
check('not done (collected / delivery)', ctx.f([o('a', { stage: 'collected' }), o('b', { stage: 'delivery' })], NOW), []);
check('ids are strings', ctx.f([o(7)], NOW), ['7']);
check('lgLockAndAdvance stamps readyAt on done', /if\(nextStage === 'done'\) update\.readyAt = update\.updatedAt;/.test(SRC), true);
check('workday runs the net on load', /lgReadyUnsentIds\(allOrders, Date\.now\(\)\)/.test(WD) && /_waSendReadyGrouped\(_readyLost\)/.test(WD), true);
check('chisum finish waits for the writes, not a fixed delay', /Promise\.allSettled\(_advWrites\)\.then\(\(\) => _waSendReadyGrouped\(_waPending\)\)/.test(WD), true);
check('workday loads the new firebase-db', /firebase-db\.js\?v=20261113/.test(WD), true);
console.log(fail ? '\n' + fail + ' failed' : '\nall passed');
process.exit(fail ? 1 : 0);
