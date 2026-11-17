#!/usr/bin/env node
//  צפי "מוכן" להזמנה (בן, 17/11) — order-eta.js
const path = require('path');
const E = require(path.join(__dirname, '..', 'order-eta.js'));
let failed = 0;
const check = (name, got, exp) => {
  const a = JSON.stringify(got), b = JSON.stringify(exp);
  if (a === b) console.log('ok    ' + name); else { failed++; console.error('FAIL  ' + name + '\n        expected ' + b + ', got ' + a); }
};
const cut = (at, x) => Object.assign({ w: 800, h: 2000, optyCut: { at, job: 'M1' } }, x || {});
const T = '2026-11-17';   // שלישי

check('chisum cut Sunday → back Tuesday (2 work days)', E.lgItemEta(cut('2026-11-15', { chisum: true }), 'workday', '2026-11-16').date, '2026-11-17');
check('chisum cut Wednesday → back Sunday (no Fri/Sat)', E.lgItemEta(cut('2026-11-18', { chisum: true }), 'workday', '2026-11-19').date, '2026-11-22');
check('in tempering label', E.lgItemEta(cut('2026-11-16', { chisum: true }), 'chisum', T).label, 'בחיסום · חוזר מחר בבוקר');
check('cut today, chisum → goes out tomorrow', E.lgItemEta(cut(T, { chisum: true }), 'workday', T).label, 'נחתך 17/11 · יוצא לחיסום מחר');
check('no chisum → ready on the cut day', E.lgItemEta(cut('2026-11-16'), 'workday', T), { date: '2026-11-16', label: 'נחתך 16/11 · מוכן', warn: '' });
check('graphic / triplex → no date', [E.lgItemEta(cut('2026-11-16', { graphic: true }), 'workday', T).date, E.lgItemEta(cut('2026-11-16', { triplex: true }), 'workday', T).date], [null, null]);
check('not linked to OptyWay → no date', E.lgItemEta({ w: 1, h: 1 }, 'chash', T), { date: null, label: 'עוד לא באופטימיזציה', warn: '' });
check('note says chisum, order says no → warn + the later date', (r => [r.date, !!r.warn])(E.lgItemEta(cut('2026-11-16'), 'workday', T, 'חיסום/חור')), ['2026-11-18', true]);
check('note "/גרפיקה" → no date', E.lgItemEta(cut('2026-11-16', { chisum: true }), 'workday', T, 'חיסום/חור/גרפיקה').date, null);

const o = { stage: 'workday', items: [cut('2026-11-16', { chisum: true }), cut('2026-11-17')] };
check('order: the last glass decides', E.lgOrderEta(o, T).label, 'צפי מוכן: מחר');
check('order ready in the system → final', E.lgOrderEta(Object.assign({}, o, { stage: 'done' }), T).final, true);
check('order with one glass not cut yet → no full date', E.lgOrderEta({ stage: 'workday', items: [cut('2026-11-16'), { w: 1, h: 1 }] }, T).date, null);
check('date passed but not ready → late', E.lgOrderEta({ stage: 'workday', items: [cut('2026-11-10')] }, T).late, true);

check('portal: only a real future date', E.lgPortalEta(o, T), 'צפי מוכן: מחר');
check('portal: partial → nothing', E.lgPortalEta({ stage: 'workday', items: [cut('2026-11-16'), { w: 1, h: 1 }] }, T), '');
check('portal: late → nothing (no false promise)', E.lgPortalEta({ stage: 'workday', items: [cut('2026-11-10')] }, T), '');
check('portal: ready → nothing (the status says it)', E.lgPortalEta(Object.assign({}, o, { stage: 'done' }), T), '');
check('undone cut is ignored', E.lgItemEta({ optyCut: { at: '2026-11-16', undone: true } }, 'workday', T).date, null);

process.exit(failed ? 1 : 0);
