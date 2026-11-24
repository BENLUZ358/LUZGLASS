#!/usr/bin/env node
/**
 * opty-hub.js — חיפוש אחד: הזמנות שלנו + אופטימיזציות, מצב אחד לכל זכוכית, "לא אצלנו" (בן, 19/11).
 * Run: node scripts/test-opty-hub.js
 */
const H = require('../opty-hub.js');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

const T = '2026-11-19', ms = iso => Date.parse(iso + 'T09:00:00Z');
// אופטימיזציה M00320 (18/11, 8 שקוף): שתי זכוכיות מחוברות ואחת של לקוח שלא קיים אצלנו
const jobs = {
  M00320: { job: 'M00320', day: '2026-11-18', mat: '08S', sheets: [{ count: 1, pieces: [
    { order: 1, pos: 1, shape: '274122', w: 852, h: 1902 },
    { order: 2, pos: 2, shape: '274124', w: 602, h: 1902 },
    { order: 3, pos: 3, shape: '', w: 402, h: 1002 },
  ] }], pieces: { 1: { client: 'אביעד נחום', name: 'אמבט', w: 852, h: 1902 }, 2: { client: 'אביעד נחום', name: 'אמבט', w: 602, h: 1902 },
    3: { client: 'זכוכית הצפון', name: 'כהן', w: 402, h: 1002, note: 'ללא חיסום/ללא' } } },
  M00321: { job: 'M00321', day: '2026-11-20', mat: '05MIR', sheets: [{ count: 2, pieces: [{ order: 1, pos: 1, shape: '274200', w: 500, h: 700 }] }],
    pieces: { 1: { client: 'מאור', name: 'מראה', w: 500, h: 700 } } },
};
const orders = [
  { id: 'a', orderNum: 'L1235', orderClient: 'אביעד נחום', sketchName: 'אמבט', stage: 'workday', createdAt: ms('2026-11-16'), items: [
    { name: 'שקוף 8', w: 850, h: 1900, optyJob: 'M00320', optyShape: '274122', optyCut: { at: '2026-11-18', job: 'M00320' } },
    { name: 'שקוף 8', w: 600, h: 1900, optyJob: 'M00320', optyShape: '274124', optyCut: { at: '2026-11-18', job: 'M00320' } },
  ] },
  { id: 'b', orderNum: 'L1240', orderClient: 'טום גלאס', sketchName: 'רחוב הגפן', stage: 'done', createdAt: ms('2026-11-10'), items: { k1: { name: 'שקוף 6', w: 700, h: 1800 } } },
  { id: 'c', orderNum: 'L1250', orderClient: 'פלג מקלחונים', sketchName: 'דירה 4', stage: 'drafter', createdAt: ms('2026-11-19'), items: [{ name: 'שקוף 8', w: 850, h: 2000 }] },
];
const run = (q, f, extra) => H.lgHubSearch(Object.assign({ orders, jobs, todayIso: T, q, f }, extra || {}));
const ids = r => r.orders.map(x => x.o.id);

// ── מידה ──
check('parse: 850x1900 + words', H.lgHubParse('850x1900 אביעד'), { pairs: [[850, 1900]], words: ['אביעד'] });
check('parse: 850×1900 and 850*1900 and 1900/850', ['850×1900', '850*1900', '1900/850'].map(q => H.lgHubParse(q).pairs), [[[850, 1900]], [[850, 1900]], [[1900, 850]]]);
check('size 850x1900 → order a, item 0 highlighted', (r => [ids(r), r.orders[0].items.map(i => i.hit)])(run('850x1900')), [['a'], [true, false]]);
check('size reversed + ±3 tolerance', ids(run('1902x848')), ['a']);
check('size matches OptyWay piece with grinding (+2)', run('400x1000').loose.map(p => p.client), ['זכוכית הצפון']);
check('single number = one side of the glass', ids(run('1800')), ['b']);

// ── שם הזמנה / סקיצה / לקוח / צורה / M00 ──
check('order number', ids(run('L1240')), ['b']);
check('sketch name + client (two words, both must match)', ids(run('דירה פלג')), ['c']);
check('shape number → our order (not loose, it is linked)', [ids(run('274124')), run('274124').loose.length], [['a'], 0]);
check('job number → our order + the loose piece on the same job', (r => [ids(r), r.loose.map(p => p.pos)])(run('M00320')), [['a'], [3]]);
check('quotes ignored: ד"ר = דר', H.lgHubParse('ד"ר').words, ['דר']);

// ── מצב אחד לזכוכית ──
check('cut yesterday in OptyWay → ✂ נחתך 18/11', run('L1235').orders[0].items[0].st, { label: '✂ נחתך 18/11', tone: 'cut', src: 'opty' });
check('our stage wins from chisum on: done → מוכן לאיסוף', run('L1240').orders[0].items[0].st, { src: 'ours', label: 'מוכן לאיסוף', tone: 'ready' });
check('early stage, no OptyWay → אצל שרטט (before cut)', run('L1250').orders[0].items[0].st, { label: 'אצל שרטט', tone: 'wait', src: 'ours' });
check('linked but no cut stamp → באופטימיזציה', H.lgHubItemState({ stage: 'opty' }, { optyJob: 'M00330' }, T), { label: 'באופטימיזציה M00330', tone: 'plan', src: 'opty' });
check('cut stamp for tomorrow → לחיתוך', H.lgHubItemState({ stage: 'workday' }, { optyCut: { at: '2026-11-20', job: 'M00321' } }, T).tone, 'plan');
check('undone cut stamp is ignored', H.lgHubItemState({ stage: 'workday' }, { optyJob: 'M00320', optyCut: { at: '2026-11-18', undone: true } }, T).label, 'באופטימיזציה M00320');

// ── "לא אצלנו" ──
const loose = run('', { state: 'loose' });
check('loose: only unlinked pieces, no orders', [loose.orders.length, loose.loose.map(p => p.job + '#' + p.pos)], [0, ['M00321#1', 'M00320#3']]);
check('loose: state from the job day (+ chisum by note/glass type)', loose.loose.map(p => p.st.label), ['מתוכנן ל-20/11', 'נחתך · מוכן']);
check('loose: 8mm cut yesterday without a note → goes to chisum', H.lgHubPieceState(jobs.M00320, 1, T, { chisum: true }), { label: "בחיסום · חוזר ביום א' 22/11 בבוקר", tone: 'cut', src: 'opty' });
check('loose: identical sheets (count 2) counted once', loose.loose.filter(p => p.job === 'M00321').length, 1);
check('loose: waiting-to-link shape is flagged', run('', { state: 'loose' }, { waiting: new Set(['274200']) }).loose[0].waiting, true);
check('loose: linked by position (no shape) is not loose', H.lgHubSearch({ jobs, todayIso: T, f: { state: 'loose' },
  orders: [{ id: 'x', stage: 'workday', items: [{ optyJob: 'M00320', optyPos: 3 }] }] }).loose.map(p => p.job + '#' + p.pos), ['M00321#1', 'M00320#1', 'M00320#2']);
check('group loose by client', H.lgHubGroupLoose(loose.loose).map(g => g.client + ':' + g.list.length), ['מאור:1', 'זכוכית הצפון:1']);

// ── סינון ──
check('filter state cut → only order a, no loose (the cut loose one is ready)', (r => [ids(r), r.loose.length])(run('', { state: 'cut' })), [['a'], 0]);
check('filter state ready → b + the ready loose glass', (r => [ids(r), r.loose.map(p => p.pos)])(run('', { state: 'ready' })), [['b'], [3]]);
check('filter state wait → no loose glass', run('', { state: 'wait' }).loose.length, 0);
check('filter glass type 05MIR → loose mirror only', (r => [ids(r), r.loose.map(p => p.mat)])(run('', { mat: '05MIR' })), [[], ['05MIR']]);
check('filter glass type 08S → order a (by its job)', ids(run('', { mat: '08S' })), ['a']);
check('date range: created 10/11 only', ids(run('', { from: '2026-11-09', to: '2026-11-11' })), ['b']);
check('date range: order counts by its cut day too', ids(run('', { from: '2026-11-18', to: '2026-11-18' })), ['a']);
check('newest order first', ids(run('')), ['c', 'a', 'b']);
check('nothing found', (r => [r.orders.length, r.loose.length])(run('לא קיים בכלל')), [0, 0]);

// ── מתי נחתך + איפה עכשיו (בן, 24/11) ── T = יום ה' 19/11
const a1 = orders[0].items[0];
check('cut line: cut on 18/11', H.lgHubCutLine(a1, jobs.M00320, T), { label: "✂ נחתך ד' 18/11", cut: true });
check('cut line stays when order is in chisum', H.lgHubCutLine(a1, jobs.M00320, T).label, "✂ נחתך ד' 18/11");
check('now: in chisum', H.lgHubNow(Object.assign({}, orders[0], { stage: 'chisum' }), a1, T), { label: 'בחיסום / תחנת בדיקה', tone: 'cut' });
check('now: cut, before chisum', H.lgHubNow(orders[0], a1, T), { label: 'נחתך · לפני חיסום', tone: 'cut' });
check('cut line: tomorrow', H.lgHubCutLine({ optyJob: 'M00321', optyCut: { at: '2026-11-20' } }, jobs.M00321, T).label, '⏳ לחיתוך מחר 20/11');
check('cut line: today', H.lgHubCutLine({ optyCut: { at: T } }, null, T).label, '⏳ לחיתוך היום');
check('cut line: later day', H.lgHubCutLine({ optyCut: { at: '2026-11-22' } }, null, T).label, "⏳ לחיתוך א' 22/11");
check('cut line: undone mark is not cut', H.lgHubCutLine({ optyJob: 'M00321', optyCut: { at: '2026-11-18', undone: true } }, jobs.M00321, T), { label: '⏳ לחיתוך מחר 20/11', cut: false });
check('cut line: in job, no cut info → by job day', H.lgHubCutLine({ optyJob: 'M00321' }, jobs.M00321, T).label, '⏳ לחיתוך מחר 20/11');
check('cut line: in job, job not loaded', H.lgHubCutLine({ optyJob: 'M00999' }, null, T), { label: 'באופטימיזציה M00999', cut: false });
check('cut line: not in optimisation', H.lgHubCutLine(orders[2].items[0], null, T), { label: 'עוד לא באופטימיזציה', cut: false });
check('now: at drafter', H.lgHubNow(orders[2], orders[2].items[0], T), { label: 'אצל שרטט', tone: 'wait' });
check('now: order in chisum but this glass is cut tomorrow', H.lgHubNow({ stage: 'chisum' }, { optyJob: 'M00321', optyCut: { at: '2026-11-20' } }, T), { label: 'מתוכנן לחיתוך', tone: 'plan' });
check('now: order ready wins even if a cut date is ahead', H.lgHubNow({ stage: 'done' }, { optyCut: { at: '2026-11-20' } }, T).label, 'מוכן לאיסוף');
check('now: planned', H.lgHubNow({ stage: 'workday' }, { optyJob: 'M00321' }, T), { label: 'מתוכנן לחיתוך', tone: 'plan' });

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
