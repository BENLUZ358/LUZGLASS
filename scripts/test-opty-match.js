#!/usr/bin/env node
/**
 * opty-match.js — חיבור מספר צורה מאופטי-ווי לפריט אצלנו (בן, 16/11).
 * Run: node scripts/test-opty-match.js
 */
const M = require('../opty-match.js');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const P = (shape, client, name, w, h, qty = 1) => ({ shape, client, name, w, h, qty, job: 'M00291' });
const auto = r => r.auto.map(a => [a.shape, a.orderId, a.idx]);

const bath = { id: 'o1', orderClient: 'המקום לאמבט', sketchName: 'איציק', items: [{ w: 502, h: 1902 }, { w: 499, h: 1887 }, { w: 499, h: 1887 }] };
check('sure match → automatic (pair BathPlace ↔ המקום לאמבט)', auto(M.lgOptyMatch([P('274328', 'BathPlace', 'איציק', 502, 1902)], [bath])), [['274328', 'o1', 0]]);
check('rotated size and 222.1 vs 222', auto(M.lgOptyMatch([P('9', 'BathPlace', 'איציק', 1902, 502.1)], [bath])), [['9', 'o1', 0]]);
check('quantity 2 → both identical rows', auto(M.lgOptyMatch([P('274329', 'BathPlace', 'איציק', 499, 1887, 2)], [bath])), [['274329', 'o1', 1], ['274329', 'o1', 2]]);
check('two shapes, two identical rows → one each, never the same row twice',
  auto(M.lgOptyMatch([P('A', 'BathPlace', 'איציק', 499, 1887), P('B', 'BathPlace', 'איציק', 499, 1887)], [bath])), [['A', 'o1', 1], ['B', 'o1', 2]]);
{
  const r = M.lgOptyMatch([P('A', 'BathPlace', 'איציק', 499, 1887)], [bath]);
  check('one shape, two identical rows → for review with both rows', [r.auto.length, r.review.length, r.review[0].cands.length], [0, 1, 2]);
}
{
  const r = M.lgOptyMatch([P('A', 'BathPlace', '', 502, 1902)], [bath]);
  check('empty sketch name in OptyWay → always review', [r.auto.length, r.review.length], [0, 1]);
}
{
  const done = { ...bath, items: [{ w: 502, h: 1902, optyShape: '274328' }] };
  const r = M.lgOptyMatch([P('274328', 'BathPlace', 'איציק', 502, 1902)], [done]);
  check('shape already on an item → "already", nothing written', [r.auto.length, r.already.length], [0, 1]);
  const r2 = M.lgOptyMatch([P('999', 'BathPlace', 'איציק', 502, 1902)], [done]);
  check('item that already has another shape is never overwritten', [r2.auto.length, r2.notFound.length], [0, 1]);
}
check('client cut at 12 letters matches a pair whose OptyWay name starts with it',
  auto(M.lgOptyMatch([P('5', 'אומנות הזכוכ', '513', 500, 600)], [{ id: 'o2', orderClient: 'אומנות הזכוכית', sketchName: '513', items: [{ w: 500, h: 600 }] }],
    [{ ours: 'אומנות הזכוכית', opty: 'אומנות הזכוכית' }])), [['5', 'o2', 0]]);
{
  const r = M.lgOptyMatch([P('5', 'ד"ר', '56891', 500, 600)], [{ id: 'o5', orderClient: 'ד"ר', sketchName: '56891', items: [{ w: 500, h: 600 }] }]);
  check('same name but not in the pairs → not found (Ben: only the names he gave)', [r.auto.length, r.notFound.length], [0, 1]);
}
check('our full card name starts with the pair (פלג מקלחונים בע"מ, טום גלאס 25701384)',
  auto(M.lgOptyMatch([P('10', 'טום גלס', 'נדב', 92, 1502)], [{ id: 'o7', orderClient: 'טום גלאס  25701384', sketchName: 'נדב', items: [{ w: 92, h: 1502 }] }])), [['10', 'o7', 0]]);
check('פלג ↔ פלג מקלחונים',
  auto(M.lgOptyMatch([P('9', 'פלג', 'אילן', 600, 1900)], [{ id: 'o6', orderClient: 'פלג מקלחונים בע"מ', sketchName: 'אילן', items: [{ w: 600, h: 1900 }] }])), [['9', 'o6', 0]]);
check('Avivi: OptyWay keeps the last digits of the PO number',
  auto(M.lgOptyMatch([P('6', 'אביבי', '16095', 400, 800)], [{ id: 'o3', orderClient: 'יצחק אביבי', sketchName: 'PO4372716095', items: [{ w: 400, h: 800 }] }], [{ ours: 'יצחק אביבי', opty: 'אביבי' }])), [['6', 'o3', 0]]);
check('dots and spaces ignored (א.מ מראות = א.מ.מראות)',
  auto(M.lgOptyMatch([P('7', 'מאור', 'דני', 300, 300)], [{ id: 'o4', orderClient: 'א.מ מראות', sketchName: 'דני ', items: [{ w: 300, h: 300 }] }])), [['7', 'o4', 0]]);
{
  const r = M.lgOptyMatch([P('8', 'לקוח זר', 'x', 300, 300)], [bath]);
  check('unknown client → not found', [r.auto.length, r.review.length, r.notFound.length], [0, 0, 1]);
}
{
  const two = [{ id: 'a', orderClient: 'המקום לאמבט', sketchName: 'איציק', items: [{ w: 502, h: 1902 }] },
               { id: 'b', orderClient: 'המקום לאמבט', sketchName: 'איציק', items: [{ w: 502, h: 1902 }] }];
  const r = M.lgOptyMatch([P('1', 'BathPlace', 'איציק', 502, 1902)], two);
  check('same name in two different orders → review', [r.auto.length, r.review.length], [0, 1]);
}
check('pieces: only rows with a shape, from the date on',
  M.lgOptyPieces([{ SAGOMA: '1', DATACONS: '2026-11-15', QTAPZ: 2 }, { SAGOMA: '', DATACONS: '2026-11-15' }, { SAGOMA: '3', DATACONS: '2026-11-10' }], '2026-11-13').map(p => [p.shape, p.qty]), [['1', 2]]);
check('real data 16/11: OptyWay adds 2 mm and our sketch name is longer (מאיה ↔ מאיה פיין)',
  auto(M.lgOptyMatch([P('274253', 'א.א.פנדה', 'מאיה', 332, 1887), P('274251', 'א.א.פנדה', 'מאיה', 302, 1902)],
    [{ id: 'L1234', orderClient: 'נאור חזקיה', sketchName: 'מאיה פיין', items: [{ w: 300, h: 1900 }, { w: 330, h: 1885 }] }])), [['274253', 'L1234', 1], ['274251', 'L1234', 0]]);
check('זבולון 2 ↔ זבולון 1/2/3 (size picks the item)',
  auto(M.lgOptyMatch([P('274264', 'א.א.פנדה', 'זבולון 2', 412, 1887)],
    [{ id: 'L1232', orderClient: 'נאור חזקיה', sketchName: 'זבולון 1/2/3', items: [{ w: 680, h: 1885 }, { w: 410, h: 1885 }] }])), [['274264', 'L1232', 1]]);
{
  const r = M.lgOptyMatch([P('274282', 'פלג', 'ערן', 739.1, 2122)], [{ id: 'L1245', orderClient: 'פלג מקלחונים בע"מ', sketchName: 'ערן טבריה', items: [{ w: 717, h: 2120 }, { w: 1025, h: 2120 }] }]);
  check('name matches but size far off (drafter changed it) → review with all items of that order', [r.auto.length, r.review.length, r.review[0] && r.review[0].cands.length], [0, 1, 2]);
}
check('a short number is not a name prefix (2741 never matches 27410)',
  M.lgOptyMatch([P('1', 'מאור', '274', 500, 2000)], [{ id: 'x', orderClient: 'א.מ.מראות', sketchName: '2741', items: [{ w: 500, h: 2000 }] }]).auto.length, 0);
check('אריאל 2 never goes to אריאל 1 automatically',
  M.lgOptyMatch([P('274133', 'BathPlace', 'אריאל 2', 402, 1902)], [{ id: 'L1250', orderClient: 'המקום לאמבט', sketchName: 'אריאל 1', items: [{ w: 400, h: 1900 }] }]).auto.length, 0);
check('חווה 2 ↔ חווה סוגרים1/2',
  auto(M.lgOptyMatch([P('274417', 'א.א.פנדה', 'חווה 2', 492, 1902)], [{ id: 'L1273', orderClient: 'נאור חזקיה', sketchName: 'חווה סוגרים1/2', items: [{ w: 490, h: 1900 }] }])), [['274417', 'L1273', 0]]);
//  צורות שלא חוברו אבל ידוע לאיזו הזמנה הן שייכות → נשמרות על ההזמנה, לחיבור בחיסום (בן, 16/11)
{
  const two = [{ id: 'L1232', orderClient: 'נאור חזקיה', sketchName: 'זבולון 1/2/3', items: [{ w: 680, h: 1885 }, { w: 680, h: 1885 }, { w: 675, h: 1885 }] }];
  const r = M.lgOptyMatch([P('274256', 'א.א.פנדה', 'זבולון 1', 682, 1887)], two);
  const pend = M.lgOptyPendingByOrder(r.review);
  check('one OptyWay piece, two same-size items in one order → kept on that order',
    [Object.keys(pend), pend.L1232 && pend.L1232['274256'] && [pend.L1232['274256'].w, pend.L1232['274256'].h, pend.L1232['274256'].job]], [['L1232'], [682, 1887, 'M00291']]);
  const r2 = M.lgOptyMatch([P('274300', 'א.א.פנדה', '', 500, 2000)], [{ id: 'A', orderClient: 'נאור חזקיה', sketchName: 'x', items: [{ w: 500, h: 2000 }] }, { id: 'B', orderClient: 'נאור חזקיה', sketchName: 'y', items: [{ w: 500, h: 2000 }] }]);
  check('candidates in two different orders → not kept (unknown order)', M.lgOptyPendingByOrder(r2.review), {});
  check('nothing to review → empty', M.lgOptyPendingByOrder([]), {});
  const r3 = M.lgOptyMatch([P('274147', 'אור המראות', '1126', 690, 2014)], [{ id: 'L1255', orderClient: 'אור המראות', sketchName: '1106', items: [{ w: 688, h: 2012 }, { w: 688, h: 2012 }] }]);
  check('only size matches (1126 ≠ 1106) → stays for review, not kept on that order', [r3.review.length, M.lgOptyPendingByOrder(r3.review)], [1, {}]);
}
check('our order number written in OptyWay (L1281) = name match',
  auto(M.lgOptyMatch([P('274390', 'מאור', 'L1281', 1154, 744)], [{ id: 'o81', orderNum: 'L1281', orderClient: 'א.מ.מראות', sketchName: 'מראה1', items: [{ w: 1152, h: 742 }] }])), [['274390', 'o81', 0]]);
{
}
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
