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
vm.runInContext(core + '\nthis.f={emPlanChunks,emAddr,emShouldTake,emLabelFor,emDecide,emGiveUp,emOutboxPlan,emBudgetOk,emOutboxClaim,emSentToPrune};', ctx);
const { emPlanChunks, emAddr, emShouldTake, emLabelFor, emDecide, emGiveUp, emOutboxPlan, emBudgetOk, emOutboxClaim, emSentToPrune } = ctx.f;

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

// E emOutboxPlan — ⚠️ exactly-once: מפתח שכבר סומן s_<key> לא נשלח שוב, רק מאשרים
const items = [
  { key: 'k1', thread: 't1', text: 'a', leaseToken: 'L1' },
  { key: 'k2', thread: 't2', text: 'b', leaseToken: 'L2' }
];
const act = p => emOutboxPlan(items, p).map(x => [x.key, x.action]);
check('plan: s_ -> ack', act({ s_k1: 1 }), [['k1', 'ack'], ['k2', 'send']]);
check('plan: s_ and u_ -> ack', act({ s_k1: 1, u_k1: 1 }), [['k1', 'ack'], ['k2', 'send']]);
check('plan: u_ without s_ -> fail (never send)', act({ u_k2: 1 }), [['k1', 'send'], ['k2', 'fail']]);
check('plan: neither -> send', act({}), [['k1', 'send'], ['k2', 'send']]);
check('plan: item fields preserved', emOutboxPlan(items, {})[0], { key: 'k1', thread: 't1', text: 'a', leaseToken: 'L1', action: 'send' });
check('plan: other keys do not match', act({ s_k9: 1, u_k9: 1 }), [['k1', 'send'], ['k2', 'send']]);
check('plan: empty thread/text dropped', emOutboxPlan([{ key: 'a', thread: '', text: 'x', leaseToken: 'L' }, { key: 'b', thread: 't', text: '', leaseToken: 'L' }], {}), []);
check('plan: null inputs', emOutboxPlan(null, null), []);
check('plan: malformed items dropped', emOutboxPlan([{ key: 'k', thread: 't' }, null, { key: 'k3', thread: 't3', text: 'x', leaseToken: 'L' }], {}).map(x => x.key), ['k3']);

// E2 emOutboxClaim — מה עושים עם תשובת claim
check('claim 200 items', emOutboxClaim(200, { ok: true, items: items }), { stop: false, items: items });
check('claim 200 no items', emOutboxClaim(200, { ok: true, items: [] }), { stop: false, items: [] });
check('claim 200 ok:false', emOutboxClaim(200, { ok: false }), { stop: false, items: [] });
for (const c of [401, 403]) check('claim ' + c + ' stops', emOutboxClaim(c, null), { stop: true, items: [] });
check('claim 500', emOutboxClaim(500, null), { stop: false, items: [] });
check('claim network 0', emOutboxClaim(0, null), { stop: false, items: [] });

// E3 emSentToPrune
const now = 10 * 24 * 3600 * 1000, day = 24 * 3600 * 1000;
check('prune old s_/u_ only', emSentToPrune({ s_a: String(now - 5 * day), s_b: String(now - 1 * day), h_x: '1', s_c: 'junk', u_d: String(now - 5 * day), u_e: String(now - day) }, now, 4 * day).sort(), ['s_a', 's_c', 'u_d']);

// E4 emBudgetOk
const M = 270000;
check('budget intake early', emBudgetOk('intake', 100000, M), true);
check('budget intake stops 60s early', emBudgetOk('intake', M - 59000, M), false);
check('budget claim ok', emBudgetOk('outbox-claim', M - 31000, M), true);
check('budget claim stops 30s early', emBudgetOk('outbox-claim', M - 29000, M), false);
check('budget item until the end', emBudgetOk('outbox-item', M - 1, M), true);
check('budget item over', emBudgetOk('outbox-item', M + 1, M), false);

// D
const gs = fs.existsSync(gsPath) ? fs.readFileSync(gsPath, 'utf8') : '';
const S = '// ── core start ──', E = '// ── core end ──';
const i = gs.indexOf(S), j = gs.indexOf(E);
check('gs has core block', i >= 0 && j > i, true);
//  ⚠️ סופי שורה מנורמלים: ב-Windows git (autocrlf) כותב CRLF, ולכן ה-'\n' שאחרי
//  סמן הסוף שונה בין checkouts. התוכן הוא מה שחייב להיות זהה.
const lf = t => t.replace(/\r\n/g, '\n');
check('gs core identical to source', lf(gs.slice(i, j + E.length)) + '\n', lf(core).replace(/\n*$/, '\n'));

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
