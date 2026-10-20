#!/usr/bin/env node
/**
 * סקריפט Gmail — החלקים הטהורים (scripts/gmail-intake-core.js).
 *   A. emPlanChunks — גבולות 0 / 1 / בדיוק חתיכה / חתיכה ובייט.
 *   B. emShouldTake — START_AT, handled, שרשור ישן, רשימת שולחים.
 *   C. emLabelFor — טבלת המצבים, כולל כשל HTTP.
 *   D. ההעתק ב-.gs זהה בייט-לבייט למקור.
 * Run: node scripts/test-gmail-intake-core.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('FAIL', name, JSON.stringify(actual), '!=', JSON.stringify(expected)); }
  else console.log('ok  ', name);
};

const corePath = path.join(__dirname, 'gmail-intake-core.js');
const gsPath = path.join(__dirname, 'gmail-intake.gs');
const core = fs.readFileSync(corePath, 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(core + '\nthis.f={emPlanChunks,emAddr,emShouldTake,emLabelFor,emDecide,emGiveUp};', ctx);
const { emPlanChunks, emAddr, emShouldTake, emLabelFor, emDecide, emGiveUp } = ctx.f;

// A
check('chunks 0', emPlanChunks(0, 3000000), 1);
check('chunks 1', emPlanChunks(1, 3000000), 1);
check('chunks exact', emPlanChunks(3000000, 3000000), 1);
check('chunks +1', emPlanChunks(3000001, 3000000), 2);
check('chunks default size', emPlanChunks(6000001), 3);

// B
const cfg = { START_AT: '2026-10-20T00:00:00Z', ALLOWED_SENDERS: '' };
const t = Date.parse('2026-10-21T00:00:00Z');
check('new message', emShouldTake({ id: 'a', from: 'x@y.com', date: t }, cfg, {}), true);
check('before START_AT', emShouldTake({ id: 'a', from: 'x@y.com', date: Date.parse('2026-10-19T00:00:00Z') }, cfg, {}), false);
check('already handled', emShouldTake({ id: 'a', from: 'x@y.com', date: t }, cfg, { a: 1 }), false);
check('other id in handled (old thread reply)', emShouldTake({ id: 'b', from: 'x@y.com', date: t }, cfg, { a: 1 }), true);
const al = { START_AT: '', ALLOWED_SENDERS: 'Cust@Mail.com, other@x.com' };
check('allowed, name form', emShouldTake({ id: 'a', from: '"Dan" <cust@mail.COM>', date: t }, al, {}), true);
check('allowed, bare', emShouldTake({ id: 'a', from: 'OTHER@x.com', date: t }, al, {}), true);
check('not allowed', emShouldTake({ id: 'a', from: 'evil@x.com', date: t }, al, {}), false);
// ⚠️ אותו כלל כמו lgEmailAddr בשרת ו-_waInAddr בפאנל: הקבוצה **האחרונה** ב-<...>
const spoof = '"boss@client.com <boss@client.com>" <attacker@evil.com>';
check('addr takes the last <...> (display-name spoof)', emAddr(spoof), 'attacker@evil.com');
check('addr bare', emAddr(' Bob@Y.IO '), 'bob@y.io');
check('spoofed display name is not on the list', emShouldTake({ id: 'a', from: spoof, date: t }, { ALLOWED_SENDERS: 'boss@client.com' }, {}), false);
check('empty list = everyone', emShouldTake({ id: 'a', from: 'evil@x.com', date: t }, { ALLOWED_SENDERS: '' }, {}), true);

// C
check('done', emLabelFor('done'), 'LG/נקלט');
check('ignored', emLabelFor('ignored'), 'LG/נקלט');
check('closed', emLabelFor('closed'), 'LG/נקלט');
check('rejected', emLabelFor('rejected'), 'LG/נכשל');
check('dead', emLabelFor('dead'), 'LG/נכשל');
check('http-final', emLabelFor('http-final'), 'LG/נכשל');
check('not-allowed has no label', emLabelFor('not-allowed'), null);
for (const s of ['failed', 'received', 'processing', 'missing', undefined]) check('retry ' + s, emLabelFor(s), null);

check('own mail skipped', emShouldTake({ id: 'a', from: '"LG" <Orderluz@gmail.com>', date: t }, { ME: 'orderluz@gmail.com' }, {}), false);
check('other mail with ME set', emShouldTake({ id: 'a', from: 'x@y.com', date: t }, { ME: 'orderluz@gmail.com' }, {}), true);

// C2 emDecide
check('decide 200 done', emDecide(200, { state: 'done' }), { label: 'LG/נקלט', handled: true });
check('decide 200 ignored', emDecide(200, { state: 'ignored' }), { label: 'LG/נקלט', handled: true });
check('decide 200 rejected', emDecide(200, { state: 'rejected' }), { label: 'LG/נכשל', handled: true });
check('decide 200 failed', emDecide(200, { state: 'failed' }), { label: null, handled: false });
check('decide 200 no body', emDecide(200, null), { label: null, handled: false });
// ⚠️ שולח שהשרת לא מכיר: מסומן "טופל" ובלי תווית — מייל של לקוח אמיתי לא נוגעים בו (§3.6)
check('decide 200 not-allowed', emDecide(200, { state: 'not-allowed' }), { label: null, handled: true });
check('decide 400', emDecide(400, null), { label: 'LG/נכשל', handled: true });
// ⚠️ 401/403 = הגדרות (טוקן, כתובת), לא המייל — לא סופי, ועוצרים את כל הריצה
for (const c of [401, 403]) check('decide ' + c, emDecide(c, null), { label: null, handled: false, stop: true });
check('decide 500', emDecide(500, null), { label: null, handled: false });
check('decide network 0', emDecide(0, null), { label: null, handled: false });

// C3 emGiveUp
check('giveup 19 young', emGiveUp(19, 1000), false);
check('giveup 20', emGiveUp(20, 1000), true);
check('giveup old', emGiveUp(1, 61 * 3600 * 1000), true);
check('giveup 60h exactly', emGiveUp(1, 60 * 3600 * 1000), false);

// D
const gs = fs.existsSync(gsPath) ? fs.readFileSync(gsPath, 'utf8') : '';
const S = '// ── core start ──', E = '// ── core end ──';
const i = gs.indexOf(S), j = gs.indexOf(E);
check('gs has core block', i >= 0 && j > i, true);
check('gs core identical to source', gs.slice(i, j + E.length) + '\n', core);

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
