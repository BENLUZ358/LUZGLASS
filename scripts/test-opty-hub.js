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
check('loose: quantity from OptyWay (Ben 25/11)', loose.loose.map(p => p.qty).every(q => q >= 1), true);
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

check('not ours: cut day line', H.lgHubDayLine('2026-11-18', true, T), { label: "✂ נחתך ד' 18/11", cut: true });
check('not ours: planned tomorrow', H.lgHubDayLine('2026-11-20', false, T).label, '⏳ לחיתוך מחר 20/11');
check('not ours: no day', H.lgHubDayLine('', false, T).label, '');

// ── סינון חדש (בן 27/11, המועצה) ──
const mats2 = { '08S': { he: '8 שקוף' }, '05MIR': { he: '5 מראה' }, '08C': { he: '8 אקסטרה קליר' }, '10AC': { he: '10mm חלבי' } };
check('glass: ours mm+glass', H.lgHubGlass({ mm: 8, glass: 'קליר' }), '8 קליר');
check('glass: triplex from the name', H.lgHubGlass({ mm: 16, glass: 'שקוף', glassFullName: "8+8 טריפלקס שקוף מחוסם" }), '8+8 שקוף');
check('glass: only the full name', H.lgHubGlass({ name: "8 מ''מ קליר מחוסם" }), '8 קליר');
check('glass: OptyWay extra clear = our קליר; חלבי = אסיד; 10mm cleaned', ['08C', '10AC', '08S'].map(c => H.lgHubMatGlass(c, mats2)), ['8 קליר', '10 אסיד', '8 שקוף']);
const orders2 = orders.map(o => Object.assign({}, o, { items: Array.isArray(o.items) ? o.items.map(it => Object.assign({ mm: Number((it.name.match(/\d+/) || [])[0]), glass: 'שקוף' }, it)) : o.items }));
orders2[1] = Object.assign({}, orders2[1], { items: { k1: { name: 'שקוף 6', mm: 6, glass: 'שקוף', w: 700, h: 1800 } } });
const run2 = (q, f, extra) => H.lgHubSearch(Object.assign({ orders: orders2, jobs, todayIso: T, q, f, mats: mats2 }, extra || {}));
check('glass filter: ours by item glass, also orders not yet in OptyWay', ids(run2('', { glass: ['8 שקוף'] })).sort(), ['a', 'c']);
check('glass filter: loose by OptyWay material', run2('', { glass: ['5 מראה'] }).loose.map(p => p.client), ['מאור']);
check('client filter (several)', ids(run2('', { clients: ['טום גלאס', 'פלג מקלחונים'] })).sort(), ['b', 'c']);
check('client filter on loose uses the paired name', run2('', { clients: ['מאור קבוע'] }, { clientOf: n => n === 'מאור' ? 'מאור קבוע' : n }).loose.length, 1);
check('size range: width 800–900 → a (850) and c (850)', ids(run2('', { wMin: 800, wMax: 900 })).sort(), ['a', 'c']);
check('size range marks only the matching glass', run2('', { wMin: 800, wMax: 900 }).orders.find(x => x.o.id === 'a').items.map(r => r.match), [true, false]);
check('date by cut day: order a cut 18/11 is in 18/11', ids(run2('', { from: '2026-11-18', to: '2026-11-18' })), ['a']);
check('date by order: order a was ordered 16/11, not 18/11', ids(run2('', { by: 'order', from: '2026-11-18', to: '2026-11-18' })), []);
check('date by cut: not in OptyWay yet → its order day', ids(run2('', { from: '2026-11-19', to: '2026-11-19' })), ['c']);
check('state counts in one pass', (r => [r.stateCounts.cut, r.stateCounts.wait])(run2('', {})), [1, 1]);
check('sort old → new', ids(run2('', { sort: 'old' })), ['b', 'a', 'c']);
check('totals: units and m²', (r => [r.counts.units, r.counts.m2])(run2('L1235', {})), [2, 2.76]);
const fc = H.lgHubFacets({ orders: orders2, jobs, todayIso: T, q: '', mats: mats2, f: { glass: ['8 שקוף'] } });
check('facets: glass counts ignore the glass filter itself', fc.glass.map(x => x.key + ':' + x.n), ['8 שקוף:4', '5 מראה:1', '6 שקוף:1']);
check('facets: clients counted with the glass filter on', fc.clients.map(x => x.key).sort(), ['אביעד נחום', 'זכוכית הצפון', 'פלג מקלחונים'].sort());
check('glass "אחר": the option in the list finds the glass with no known type (סקירה)', ids(run2('', { glass: ['אחר'] })).length > 0 || run2('', { glass: ['אחר'] }).loose.length > 0,
  H.lgHubFacets({ orders: orders2, jobs, todayIso: T, q: '', mats: mats2, f: {} }).glass.some(x => x.key === 'אחר'));
const tbl = H.lgHubSizeTable(run2('אביעד', {}));
check('sizes table: per client, sizes merged', tbl.map(g => [g.client, g.units, g.rows.map(r => r.w + 'x' + r.h + ' ' + r.glass + ' ×' + r.qty)]),
  [['אביעד נחום', 2, ['850x1900 8 שקוף ×1', '600x1900 8 שקוף ×1']]]);
const tbl2 = H.lgHubSizeTable({ allOrders: [{ o: { orderClient: 'אביבי', sketchName: 's1' }, items: [{ it: { w: 600, h: 800, qty: 2 }, glass: '8 שקוף', st: { tone: 'cut', label: 'נחתך' }, match: true }] },
  { o: { orderClient: 'אביבי', sketchName: 's2' }, items: [{ it: { w: 600, h: 800, quantity: 3 }, glass: '8 שקוף', st: { tone: 'cut', label: 'נחתך' }, match: true }] }], allLoose: [] });
check('sizes table: same size twice → one row, quantities added, both sketches', [tbl2[0].rows.length, tbl2[0].rows[0].qty, tbl2[0].rows[0].refs], [1, 5, ['s1', 's2']]);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
