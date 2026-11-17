#!/usr/bin/env node
/** לשונית אביבי — עטיפה ומוכן (בן 17/11). Run: node scripts/test-avivi-wrap.js */
const A = require('../avivi-wrap.js');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };

const items = [{ w: 600, h: 800 }, { w: 1200, h: 450 }];
const av = (x) => ({ id: 'a', customerId: '450', orderClient: 'יצחק אביבי', sketchName: 'PO26H016504', stage: 'delivery', items, ...x });

// מי אביבי
check('card 450 → avivi', A.lgAvIsAvivi({ customerId: 450 }), true);
check('name only → avivi', A.lgAvIsAvivi({ orderClient: 'אביבי בע"מ' }), true);
check('peleg → not avivi', A.lgAvIsAvivi({ customerId: '07', orderClient: 'פלג' }), false);

// עטיפה
check('nothing wrapped', A.lgAvWrappedIdxs(av()), []);
check('one wrapped', A.lgAvWrappedIdxs(av({ avWrap: { 1: 123 } })), [1]);
check('index of a deleted item is ignored', A.lgAvWrappedIdxs(av({ avWrap: { 0: 1, 5: 1 } })), [0]);
check('array form from firebase', A.lgAvWrappedIdxs(av({ avWrap: [111, null] })), [0]);
check('partly wrapped → not ready', A.lgAvIsReady(av({ avWrap: { 0: 1 } })), false);
check('all wrapped → ready', A.lgAvIsReady(av({ avWrap: { 0: 1, 1: 2 } })), true);
check('no items → never ready', A.lgAvIsReady(av({ items: [], avWrap: { 0: 1 } })), false);

// חלוקה
const orders = [
  av({ id: '1' }),
  av({ id: '2', avWrap: { 0: 1, 1: 1 } }),
  av({ id: '3', stage: 'workday' }),
  av({ id: '4', stage: 'chisum' }),
  av({ id: '5', stage: 'collected', avWrap: { 0: 1, 1: 1 } }),
  av({ id: '6', stage: 'done' }),
  { id: '7', customerId: '07', orderClient: 'פלג', stage: 'delivery', items },
];
const s = A.lgAvSplit(orders);
check('split notReady', s.notReady.map(o => o.id), ['1']);
check('split ready', s.ready.map(o => o.id), ['2']);
check('split inWork', s.inWork.map(o => o.id), ['3', '4']);

// מצב וסדר
check('state none', A.lgAvState(av()), 'none');
check('state partial', A.lgAvState(av({ avWrap: { 0: 1 } })), 'partial');
check('state ready', A.lgAvState(av({ avWrap: { 0: 1, 1: 1 } })), 'ready');
check('sort: partial, none, ready', A.lgAvSort([av({ id: 'r', avWrap: { 0: 1, 1: 1 } }), av({ id: 'n' }), av({ id: 'p', avWrap: { 1: 1 } })]).map(o => o.id), ['p', 'n', 'r']);

// חיפוש
const o = av();
check('empty query → hit, no items marked', A.lgAvMatch(o, ''), { hit: true, idxs: [] });
check('PO suffix 16504', A.lgAvMatch(o, '16504'), { hit: true, idxs: [] });
check('PO suffix 504', A.lgAvMatch(o, '504'), { hit: true, idxs: [] });
check('full PO text', A.lgAvMatch(o, 'po26h016504'), { hit: true, idxs: [] });
check('wrong PO', A.lgAvMatch(o, '16505'), { hit: false, idxs: [] });
check('dims 600*800', A.lgAvMatch(o, '600*800'), { hit: true, idxs: [0] });
check('dims reversed 800x600', A.lgAvMatch(o, '800x600'), { hit: true, idxs: [0] });
check('dims with ×', A.lgAvMatch(o, '450×1200'), { hit: true, idxs: [1] });
check('dims with space', A.lgAvMatch(o, '600 800'), { hit: true, idxs: [0] });
check('dims not here', A.lgAvMatch(o, '600*900'), { hit: false, idxs: [] });
check('single side 1200', A.lgAvMatch(o, '1200'), { hit: true, idxs: [1] });
check('single number 16 (too short for PO) → no', A.lgAvMatch(o, '16'), { hit: false, idxs: [] });

// הסימון חייב לעבור את הנרמול של ההזמנות (באג 17/11: נשמר אבל לא הוצג — בן באייפון)
{
  const vm = require('vm'), fs = require('fs'), path = require('path');
  //  firebase-db.js כולו, עם firebase מדומה — כדי לבדוק את הנרמול האמיתי ולא עותק שלו
  const fake = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : fake()), apply: () => fake() });
  const ctx = { console, firebase: fake(), window: {}, location: { host: 'x' }, document: fake(), sessionStorage: fake(), localStorage: fake() };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8') + '\nthis.N = lgNormalizeOrder;', ctx);
  const n = ctx.N({ id: 'x', stage: 'delivery', items: [{ w: 1, h: 1 }, { w: 2, h: 2 }], avWrap: [111, 222] });
  check('normalized order keeps avWrap (array form from Firebase)', A.lgAvWrappedIdxs(n), [0, 1]);
  check('normalized order with no marks → none', A.lgAvWrappedIdxs(ctx.N({ id: 'y', stage: 'delivery', items: [{ w: 1, h: 1 }] })), []);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
