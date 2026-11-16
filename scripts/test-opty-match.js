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
check('פלג ↔ פלג מקלחונים',
  auto(M.lgOptyMatch([P('9', 'פלג', 'אילן', 600, 1900)], [{ id: 'o6', orderClient: 'פלג מקלחונים', sketchName: 'אילן', items: [{ w: 600, h: 1900 }] }])), [['9', 'o6', 0]]);
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
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
