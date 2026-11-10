#!/usr/bin/env node
/**
 * צרופות להזמנה — העזר בצד השרת (api/_order-attachments.js): lgAttOf, lgAttFindByMsg.
 * Run: node scripts/test-order-attachments-server.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

let A = {};
try { A = require(path.join(ROOT, 'api', '_order-attachments.js')); }
catch (e) { console.error('FAIL  load _order-attachments: ' + e.message); failed++; }

const PNG = 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from('jpg-bytes').toString('base64');

(async () => {
  check('kinds = same labels as the browser', A.LG_ATT_KINDS, { graphic: 'גרפיקה חלבי', hardware: 'שרטוט פרזול' });
  const B = require('fs').readFileSync(path.join(ROOT, 'order-attachments.js'), 'utf8').match(/const LG_ATT_KINDS = (\{[^}]*\});/);
  check('kinds = the copy in order-attachments.js', B && eval('(' + B[1] + ')'), A.LG_ATT_KINDS);
  const db = fakeDb({
    orders: { o1: { orderNum: 'L1', attachments: {
      10: { kind: 'hardware', at: 2, from: { order: { waMessageId: 'W10' } } },
      2: { kind: 'graphic', at: 1, from: { order: { waMessageId: 'W2' } } },
      5: { kind: 'weird', at: 1 } } },
      o2: { orderNum: 'L2' } },
    sketches: { o1__att2: PNG, o1__att10: JPG },
  });
  const l = await A.lgAttOf(db, 'o1');
  check('lgAttOf: sorted by k (numeric), unknown kinds skipped, labels',
    l.map(x => [x.k, x.kind, x.label]), [[2, 'graphic', 'גרפיקה חלבי'], [10, 'hardware', 'שרטוט פרזול']]);
  check('lgAttOf: images decoded', l.map(x => [x.img.mime, x.img.buf.toString()]), [['image/png', 'png-bytes'], ['image/jpeg', 'jpg-bytes']]);
  delete db._data.sketches.o1__att10;
  check('lgAttOf: missing image → img null', (await A.lgAttOf(db, 'o1'))[1].img, null);
  check('lgAttOf: no attachments → []', await A.lgAttOf(db, 'o2'), []);
  check('lgAttOf: no order → []', await A.lgAttOf(db, 'nope'), []);

  const orders = [{ id: 'a', waMessageId: 'M1' }, { id: 'b', attachments: { 3: { kind: 'graphic', from: { order: { waMessageId: 'M9' } } } } }];
  check('find: attachment message → {orderId, k}', A.lgAttFindByMsg(orders, 'M9'), { orderId: 'b', k: 3 });
  check('find: the order itself is not an attachment', A.lgAttFindByMsg(orders, 'M1'), null);
  check('find: empty id → null', A.lgAttFindByMsg(orders, ''), null);
  check('find: object map works too', A.lgAttFindByMsg({ b: { attachments: orders[1].attachments } }, 'M9'), { orderId: 'b', k: 3 });

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
