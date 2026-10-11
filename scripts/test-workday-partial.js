#!/usr/bin/env node
/**
 * יום עבודה על חלק מהזמנה — פריטים שלא בוצעו לא מתקדמים.
 *
 * ─── הבאג ─────────────────────────────────────────────────────────────
 *
 * הבחירה ביום העבודה היא לפי פריט ("+ הוסף"), אבל "סיים יום עבודה" קידם
 * את ההזמנה כולה דרך lgNextStage, שמסתכל על *כל* הפריטים:
 *   • נשארו פריטי ליטוש שלא ירדו → ההזמנה "הושלמה" (done), הלקוח קיבל
 *     "מוכן לאיסוף" על זכוכית שאיש לא חתך, והפריטים נעלמו מהרשימה.
 *   • נשאר פריט חיסום שלא ירד → ההזמנה קפצה ישר ל-chisum, עוקפת את תחנת
 *     הבדיקה ובלי מספר דוח (חוק 1 ב-FLOW.md).
 * ובכיוון ההפוך: הזמנה שרק החיסום שלה ירד יצאה מהמפעל ל"מוכן" עם ליטוש
 * שמעולם לא נחתך.
 *
 * ─── מה נבדק ──────────────────────────────────────────────────────────
 *
 * הפונקציות האמיתיות מ-workday.html ו-firebase-db.js רצות מול מאגר הזמנות
 * בזיכרון: הוספה לטיוטה, "הורד לעבודה", "סיים יום עבודה", מסירה לתחנת
 * הבדיקה, ו"סיום בדיקה" בחזרה מהמפעל. לא מחפשים מחרוזות — מריצים.
 *
 *   node scripts/test-workday-partial.js
 *   LG_ROOT=<תיקייה עם גרסה ישנה> node scripts/test-workday-partial.js
 *     — מריץ את אותם תרחישים על קוד אחר (הוכחה שהבדיקה תופסת את הבאג).
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = process.env.LG_ROOT || path.join(__dirname, '..');
const WD   = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
const DB   = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
const INV  = fs.readFileSync(path.join(ROOT, 'invoices.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

// פונקציה ברמה העליונה: מ-"function NAME(" ועד "\n}" הראשון בעמודה 0
const grab = (src, name, optional) => {
  const m = src.match(new RegExp('(?:^|\\n)((?:async )?function ' + name.replace('$', '\\$') + '\\([\\s\\S]*?\\n\\})'));
  if (!m && !optional) throw new Error('missing function ' + name);
  return m ? m[1] : '';
};

const DB_FNS = ['lgStageToStatus', '_lgItemHasGraphic', '_lgItemHasChalavi', '_lgItemIsTriplex',
  '_lgItemIsLaminatedTriplex', '_lgItemHasSurfaceWork', 'lgArrivedIdxs', '_lgItemIsMirror',
  'lgSplitFactoryItems', 'lgNextStage'];
const DB_OPT = ['lgWorkdayLeft', 'lgIdxsObj'];          // קיימות רק אחרי התיקון
const WD_FNS = ['isMirrorOrder', 'classifyOrder', 'getActiveItemsForOrder', 'saveOrderToStorage',
  'markStageDone', 'markStageWorkday', 'addSingleItem', '_getFinishDayGroups', 'handleWorkdayStart', 'confirmFinish',
  '_ordersUnderCheck', 'confirmResetChisum', 'clearDraft'];
const WD_OPT = ['_todayPolishIdxs', '_finishPlan', '_waitsForPolish', '_wdBuildable', '_wdUnavailIdxs'];

const STAGE_MAP = (DB.match(/const LG_STAGE_TO_STATUS = \{[\s\S]*?\n\};/) || [''])[0];

// עולם חדש לכל תרחיש: הזמנות, workDay, ורישום של כל מה שיצא החוצה
function world(orders, opts = {}) {
  const log = { wa: [], toasts: [], renders: 0, advanced: [] };
  const deliveryPhones = new Set(opts.deliveryPhones || []);
  const ctx = {
    console, Promise, Object, Array, Set, Map, JSON, Number, String, Math, Date,
    allOrders: orders,
    workDay: { date: '', selected: [], inWork: [], inChisum: [], itemsSel: {} },
    draftItems: [],
    _wdGlobalPrices: {}, _wdClientPrices: {},
    LG_TRACK: { chisum: { echo: {} }, triplex: { echo: {}, idxsOf: o => [] } },
    // הפיירבייס בזיכרון: כתיבה מתמזגת מיד; null מוחק
    updateOrder(id, patch) {
      const o = orders.find(x => String(x.id) === String(id));
      if (o) Object.entries(patch).forEach(([k, v]) => { if (v === null) delete o[k]; else o[k] = v; });
      return Promise.resolve();
    },
    markStageValue(id, stage) { const o = orders.find(x => String(x.id) === String(id)); if (o) { o.stage = stage; log.advanced.push([String(id), stage]); } },
    lgLockAndAdvance(id, o, g, c, stage) { const x = orders.find(y => String(y.id) === String(id)); x.stage = stage; log.advanced.push([String(id), stage]); return Promise.resolve({}); },
    _lgWarnUnpriced() {},
    _isDeliveryClient: (name, phone) => deliveryPhones.has(phone),
    _isMonthlyClient: () => false,
    saveWorkDay() {}, setTab() {}, closeFinish() {}, _showChisumBanner() {},
    renderAll() { log.renders++; }, updateDraftBadge() {}, closeDraftPreview() {},
    showToast(m) { log.toasts.push(m); },
    _waSendReadyGrouped(ids) { log.wa.push(...ids); },
    setTimeout(fn) { if (fn.name === '' && /_waSendReadyGrouped/.test(String(fn))) fn(); },
    confirm: () => true,
    document: { querySelectorAll: () => [], getElementById: () => ({ style: {}, classList: { add() {}, remove() {} } }) },
    // מצב המפעל — נשלט על ידי התרחיש
    _factory: {},
    _factoryDoneState(o) { const d = ctx._factory[String(o.id)] || 'none';
      return { done: d === 'all', marked: d === 'all' || d === 'some' ? 1 : 0, chisumMissing: d === 'all' ? 0 : 1, chisumTotal: 1, triplexMissing: 0 }; },
    _chisumIdxsOf: o => (o.items || []).map((it, i) => it.chisum ? i : -1).filter(i => i >= 0),
    _closeArrived() { return Promise.resolve(); },
  };
  vm.createContext(ctx);
  vm.runInContext(STAGE_MAP, ctx);
  [...DB_FNS.map(n => grab(DB, n)), ...DB_OPT.map(n => grab(DB, n, true)),
   ...WD_FNS.map(n => grab(WD, n)), ...WD_OPT.map(n => grab(WD, n, true))]
    .forEach(src => src && vm.runInContext(src, ctx));
  vm.runInContext('let _confirmingFinish = false; let _confirmingResetChisum = false;', ctx);
  return { ctx, log, o: id => orders.find(x => String(x.id) === String(id)) };
}

const P  = (w = 500) => ({ name: '8 שקוף מלוטש', w, h: 1000 });              // ליטוש
const CH = (w = 600) => ({ name: '8 שקוף מחוסם', w, h: 1900, chisum: true }); // חיסום
const order = (id, items, extra = {}) => ({ id: String(id), orderNum: 'L' + id, orderClient: 'לקוח', phone: '050' + id, stage: 'opty', items, ...extra });

// "+ הוסף" על פריטים ו"הורד לעבודה" — כמו commitDraftToWork
const startDay = (w, picks) => { picks.forEach(([id, idx]) => w.ctx.addSingleItem(id, idx)); w.ctx.handleWorkdayStart(); };
// תחנת הבדיקה שולחת למפעל (sendAllToFactory): stage=chisum, יוצאת מהתחנה
const sendToFactory = (w, id) => { w.o(id).stage = 'chisum'; w.o(id).chisumArrived = true;
  w.ctx.workDay.inChisum = w.ctx.workDay.inChisum.filter(x => String(x) !== String(id)); };
const finish = w => { w.ctx.confirmFinish(); vm.runInContext('_confirmingFinish = false', w.ctx); };
const reset  = w => { w.ctx.confirmResetChisum(); vm.runInContext('_confirmingResetChisum = false', w.ctx); };
// ב"בנה יום עבודה"? ואילו פריטים אפשר עוד להוסיף
const buildable = (w, id) => w.ctx._wdBuildable ? w.ctx._wdBuildable(w.o(id)) : null;
const addable   = (w, id) => w.ctx._wdUnavailIdxs
  ? w.o(id).items.map((_, i) => i).filter(i => !w.ctx._wdUnavailIdxs(w.o(id)).has(i)) : null;

/* ── 1. הזמנה מלאה, ליטוש בלבד — ההתנהגות הרגילה לא השתנתה ──────────── */
{
  const w = world([order(1, [P(), P(), P()])]);
  startDay(w, [[1, 0], [1, 1], [1, 2]]);
  check('full polish order: in work after start', w.o(1).stage, 'workday');
  finish(w);
  check('full polish order: done after finish', w.o(1).stage, 'done');
  check('full polish order: customer gets one "ready" message', w.log.wa, ['1']);
  check('full polish order: advanced exactly once', w.log.advanced.filter(a => a[1] === 'done').length, 1);
}

/* ── 2. חלק מהזמנת ליטוש — נשארת, והשאר חוזר לרשימה ──────────────────── */
{
  const w = world([order(2, [P(), P(), P()])]);
  startDay(w, [[2, 0], [2, 1]]);
  finish(w);
  check('partial polish: order does NOT advance', w.o(2).stage, 'workday');
  check('partial polish: no "ready" message', w.log.wa, []);
  check('partial polish: marked partial', !!w.o(2).wdPartial, true);
  check('partial polish: what was cut is recorded', w.ctx.lgArrivedIdxs(w.o(2).wdDoneIdxs), [0, 1]);
  check('partial polish: back on the build list', buildable(w, 2), true);
  check('partial polish: only the uncut item can be added', addable(w, 2), [2]);
  check('partial polish: today\'s selection cleared', w.ctx.workDay.itemsSel['2'], undefined);
  check('partial polish: the toast says so', /חלקיות/.test(w.log.toasts.at(-1)), true);

  // למחרת: מוסיפים את מה שנשאר
  startDay(w, [[2, 2]]);
  check('partial polish, day 2: no longer partial', !!w.o(2).wdPartial, false);
  finish(w);
  check('partial polish, day 2: now done', w.o(2).stage, 'done');
  check('partial polish, day 2: message sent once, now', w.log.wa, ['2']);
}

/* ── 3. ⚠️ הבאג הקשה: ליטוש ירד, חיסום לא — לא עוקפים את תחנת הבדיקה ── */
{
  const w = world([order(3, [P(), CH()])]);
  startDay(w, [[3, 0]]);
  check('polish-only part: chisum item not sent to the check station', w.ctx.workDay.inChisum, []);
  finish(w);
  check('polish-only part: order does NOT jump to chisum', w.o(3).stage, 'workday');
  check('polish-only part: no message', w.log.wa, []);
  check('polish-only part: the chisum item is still addable', addable(w, 3), [1]);

  startDay(w, [[3, 1]]);
  check('chisum added later: goes to the check station', w.ctx.workDay.inChisum, ['3']);
  check('chisum added later: stage is still workday (station sends it)', w.o(3).stage, 'workday');
  check('chisum added later: everything handed over', w.ctx.lgArrivedIdxs(w.o(3).wdDoneIdxs), [0, 1]);
  check('chisum added later: not partial', !!w.o(3).wdPartial, false);
  sendToFactory(w, 3);
  w.ctx._factory['3'] = 'all';
  reset(w);
  check('chisum back from factory: order done', w.o(3).stage, 'done');
  check('chisum back from factory: message sent once', w.log.wa, ['3']);
}

/* ── 4. הזמנה מעורבת מלאה — הזרימה הרגילה עובדת כמו קודם ─────────────── */
{
  const w = world([order(4, [P(), CH()])]);
  startDay(w, [[4, 0], [4, 1]]);
  check('full mixed: chisum to the check station', w.ctx.workDay.inChisum, ['4']);
  check('full mixed: polish in active work', w.ctx.workDay.inWork, ['4']);
  finish(w);
  check('full mixed: waits for chisum (stage unchanged)', w.o(4).stage, 'workday');
  check('full mixed: not partial', !!w.o(4).wdPartial, false);
  check('full mixed: no message yet', w.log.wa, []);
  sendToFactory(w, 4);
  w.ctx._factory['4'] = 'all';
  reset(w);
  check('full mixed: done after factory return', w.o(4).stage, 'done');
  check('full mixed: one message', w.log.wa, ['4']);
}

/* ── 5. רק החיסום ירד, הליטוש נשאר — החזרה מהמפעל מחכה לליטוש ────────── */
{
  const w = world([order(5, [P(), CH()])]);
  startDay(w, [[5, 1]]);
  check('chisum-only part: to the check station', w.ctx.workDay.inChisum, ['5']);
  check('chisum-only part: not in active work', w.ctx.workDay.inWork, []);
  check('chisum-only part: partial, polish waits', !!w.o(5).wdPartial, true);
  check('chisum-only part: on the build list while at the station', buildable(w, 5), true);
  check('chisum-only part: only the polish item is addable', addable(w, 5), [0]);
  sendToFactory(w, 5);
  w.ctx._factory['5'] = 'all';
  reset(w);
  check('factory back, polish not cut: does NOT go to done', w.o(5).stage, 'chisum');
  check('factory back, polish not cut: no message', w.log.wa, []);
  check('factory back, polish not cut: toast explains', /ממתינות לליטוש/.test(w.log.toasts.at(-1)), true);

  startDay(w, [[5, 0]]);
  check('polish added at chisum stage: stage NOT pulled back', w.o(5).stage, 'chisum');
  check('polish added at chisum stage: in active work', w.ctx.workDay.inWork, ['5']);
  finish(w);
  check('polish finished: still waits for "סיום בדיקה"', w.o(5).stage, 'chisum');
  check('polish finished: toast points to the chisum tab', /סיום בדיקה/.test(w.log.toasts.at(-1)), true);
  reset(w);
  check('then "סיום בדיקה": done', w.o(5).stage, 'done');
  check('then "סיום בדיקה": one message', w.log.wa, ['5']);
}

/* ── 6. הזמנה ישנה, בלי מעקב — לא נעצרת בחזרה מהמפעל ──────────────────── */
{
  const w = world([order(6, [P(), CH()], { stage: 'chisum', chisumArrived: true })]);
  w.ctx._factory['6'] = 'all';
  reset(w);
  check('legacy order (no wdDoneIdxs): advances as before', w.o(6).stage, 'done');
}

/* ── 7. לקוח הובלות וגרפיקה — השלב הבא נשמר ───────────────────────────── */
{
  const w = world([order(7, [P()], { phone: 'D7' }), order(8, [P(), { ...P(), graphic: true }])], { deliveryPhones: ['D7'] });
  startDay(w, [[7, 0], [8, 0], [8, 1]]);
  finish(w);
  check('delivery client: goes to delivery', w.o(7).stage, 'delivery');
  check('graphic order: goes to graphic', w.o(8).stage, 'graphic');
  check('neither gets a "ready" message', w.log.wa, []);
}

/* ── 8. לחיצה כפולה על "שלח הודעות" — אין כפילויות ─────────────────────── */
{
  const w = world([order(9, [P()])]);
  startDay(w, [[9, 0]]);
  w.ctx.confirmFinish(); w.ctx.confirmFinish();   // בלי לשחרר את המנעול
  check('double click: one advance', w.log.advanced.filter(a => a[0] === '9' && a[1] === 'done').length, 1);
  check('double click: one message', w.log.wa, ['9']);
}

/* ── 9. כמה הזמנות ביום אחד — כל אחת לפי מה שבאמת ירד ──────────────────── */
{
  const w = world([order(10, [P(), P()]), order(11, [P(), P()]), order(12, [P(), CH()])]);
  startDay(w, [[10, 0], [10, 1], [11, 0], [12, 0], [12, 1]]);
  finish(w);
  check('mixed day: full order done', w.o(10).stage, 'done');
  check('mixed day: partial order stays', w.o(11).stage, 'workday');
  check('mixed day: mixed order waits for chisum', w.o(12).stage, 'workday');
  check('mixed day: only the full order is messaged', w.log.wa, ['10']);
}

/* ── 10. "נקה טיוטה" מחזיר את הפריטים לרשימה ───────────────────────────── */
{
  const w = world([order(13, [P()])]);
  w.ctx.draftItems.push({ orderId: '13', itemIdx: 0 });
  const before = w.log.renders;
  w.ctx.clearDraft();
  check('clear draft empties it', w.ctx.draftItems.length, 0);
  check('clear draft re-renders the list', w.log.renders > before, true);
}

/* ── 10ב. המנרמל לא מוחק את הזיכרון ─────────────────────────────────────
   _lgNormalizeOrder היא רשימה לבנה. שדה שלא כתוב בה חוזר undefined בכל
   טעינה — והזמנה חלקית הייתה "נשכחת" ומתקדמת כולה ביום הבא. */
{
  check('the normaliser keeps wdDoneIdxs', /\n\s+wdDoneIdxs:\s+o\.wdDoneIdxs/.test(DB), true);
  check('the normaliser keeps wdPartial',  /\n\s+wdPartial:\s+!!o\.wdPartial/.test(DB), true);
}

/* ── 11. תחנת החשבוניות — המידה בהודעה לא מתהפכת ──────────────────────── */
{
  const save = (INV.match(/async function saveEdit\(\)[\s\S]*?\n\}/) || [''])[0];
  check('invoice toast formats the new size with lgDimsText', /lgDimsText\(w, h\)/.test(save), true);
  check('invoice toast no longer concatenates the raw size', /'המידה תוקנה ל-' \+ r\.to/.test(save), false);
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(grab(DB, 'lgDimsText'), ctx);
  const to = String('585×1885').replace(/^(\d+)×(\d+)$/, (_, w, h) => ctx.lgDimsText(w, h));
  check('the formatted size is isolated (LRI…PDI), width first', [to.charCodeAt(0), to.slice(1, -1), to.charCodeAt(to.length - 1)], [0x2066, '585×1885', 0x2069]);
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
