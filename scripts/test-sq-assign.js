#!/usr/bin/env node
/**
 * "שייך ללקוח" בתור הסקיצות (20/10, אפיון מייל §3.4).
 *
 * הזמנה שהגיעה ממייל או מוואטסאפ ולא זוהה לה לקוח (emailUnassigned /
 * waUnassigned) נכנסת לתור על "לא מזוהה". עד היום לא היה מסך לשייך אותה —
 * הסימון רק ישב שם. כאן נבדק:
 *   • החיפוש — חלק מהשם או מפתח, עד 20, לפי שם.
 *   • השיוך כותב בדיוק את השדות שבחוזה — ולא את כתובת המייל על הכרטיס.
 *   • טלפון הכניסה של הלקוח — לפי users.customerId, כמו lgClientFromWaGroup.
 *   • תג "מייל" בתור.
 *
 * Run: node scripts/test-sq-assign.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const plain = v => JSON.parse(JSON.stringify(v));

(async () => {
  const calls = [];
  const ctx = vm.createContext({
    console,
    updateOrder: async (id, fields) => { calls.push([id, fields]); },
  });
  const SRC = fs.readFileSync(path.join(ROOT, 'sq-assign.js'), 'utf8');
  vm.runInContext(SRC, ctx);

  // ─── חיפוש ─────────────────────────────────────────────────────────
  const accounts = {
    '14201': { key: '14201', name: 'המקום לאמבט' },
    '509':   { key: '509',   name: 'אגן ברזל' },
    '9117':  { key: '9117',  name: 'זכוכית הצפון' },
    '14209': { key: '14209', name: 'בית האמבט החדש' },
    'bad':   null,
  };
  check('A1 finds by part of the name', plain(ctx.sqAssignSearch(accounts, 'אמבט')),
        [{ key: '14209', name: 'בית האמבט החדש' }, { key: '14201', name: 'המקום לאמבט' }]);
  check('A1 finds by key', plain(ctx.sqAssignSearch(accounts, '509')), [{ key: '509', name: 'אגן ברזל' }]);
  check('A1 part of a key finds every card with it, sorted by name', plain(ctx.sqAssignSearch(accounts, '142')).map(a => a.key), ['14209', '14201']);
  check('A1 nothing found → empty list', plain(ctx.sqAssignSearch(accounts, 'אין כזה')), []);
  check('A1 spaces around the query are ignored', plain(ctx.sqAssignSearch(accounts, '  אגן ')).map(a => a.key), ['509']);
  const many = {};
  for (let i = 0; i < 30; i++) many['k' + i] = { key: 'k' + i, name: 'לקוח ' + String(i).padStart(2, '0') };
  check('A2 at most 20 results', ctx.sqAssignSearch(many, 'לקוח').length, 20);
  check('A2 an empty query lists cards too (up to 20)', ctx.sqAssignSearch(many, '').length, 20);
  check('A2 no accounts loaded → empty, no crash', plain(ctx.sqAssignSearch(null, 'x')), []);

  // ─── טלפון הכניסה ──────────────────────────────────────────────────
  const users = [
    { phone: '0501234567', customerId: '14201', role: 'client' },
    { phone: '0520000000', customerId: '', role: 'admin' },
  ];
  check('B1 the login phone is the user whose customerId is the card', ctx.sqAssignLoginPhone(users, '14201'), '0501234567');
  check('B1 no such user → empty', ctx.sqAssignLoginPhone(users, '509'), '');
  check('B1 users as an object keyed by phone works too',
        ctx.sqAssignLoginPhone({ '0541111111': { customerId: '509' } }, '509'), '0541111111');

  // ─── מתי מציגים את הכפתור ──────────────────────────────────────────
  check('C1 shown for an unassigned email order', ctx.sqAssignNeeded({ emailUnassigned: true }), true);
  check('C1 shown for an unassigned WhatsApp order', ctx.sqAssignNeeded({ waUnassigned: true }), true);
  check('C1 not shown for an ordinary order', ctx.sqAssignNeeded({ source: 'email', customerId: '14201' }), false);

  // ─── השיוך ─────────────────────────────────────────────────────────
  await ctx.lgAssignOrderToAccount('em_k_1', { key: '14201', name: 'המקום לאמבט' }, '0501234567');
  check('D1 assigning writes exactly the agreed fields', plain(calls[0]), ['em_k_1', {
    customerId: '14201', orderClient: 'המקום לאמבט', client: 'המקום לאמבט', businessName: 'המקום לאמבט',
    waUnassigned: false, emailUnassigned: false, phone: '0501234567', clientPhone: '0501234567',
  }]);
  await ctx.lgAssignOrderToAccount('wa_x_1', { key: '509', name: 'אגן ברזל' }, '');
  check('D2 without a login phone the phone fields are left alone', plain(calls[1]), ['wa_x_1', {
    customerId: '509', orderClient: 'אגן ברזל', client: 'אגן ברזל', businessName: 'אגן ברזל',
    waUnassigned: false, emailUnassigned: false,
  }]);
  check('D3 the sender\'s email is never written (spec 3.4)', calls.some(c => /email(From|Address)|"email"/.test(JSON.stringify(c[1]))), false);
  let threw = '';
  try { await ctx.lgAssignOrderToAccount('x', { key: '', name: '' }, ''); } catch (e) { threw = e.message; }
  check('D4 no card → refused, nothing written', [!!threw, calls.length], [true, 2]);

  // ─── admin.html ────────────────────────────────────────────────────
  const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('E1 admin.html loads sq-assign.js', /<script src="sq-assign\.js"><\/script>/.test(A), true);
  const tagLine = (A.match(/<span class="sq-tag \$\{[^\n]*sq-tag-upload[^\n]*/) || [''])[0];
  check('E2 the queue tag says "מייל" for source:\'email\'', /source==='email'\?'sq-tag-email'/.test(tagLine) && /source==='email'\?'מייל'/.test(tagLine), true);
  check('E2 with its own colour', /\.sq-tag-email\{background:[^}]+;color:[^}]+;\}/.test(A), true);
  check('E3 the queue items carry the unassigned marks',
        /waUnassigned:\s*!!o\.waUnassigned/.test(A) && /emailUnassigned:\s*!!o\.emailUnassigned/.test(A), true);
  check('E3 the sketch view has a place for the assign button', /id="sqAssignWrap"/.test(A), true);
  check('E3 and the detail view fills it', /sqAssignShow\(/.test(A), true);
  check('E4 the source filter has email', /<option value="email">מייל<\/option>/.test(A), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll assign-to-customer checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
