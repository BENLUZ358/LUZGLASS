#!/usr/bin/env node
/**
 * Tests lgSplitFactoryItems — which items travel to the factory, and to which
 * of the two processes.
 *
 * The report is a physical sheet that goes to the factory, where tempering and
 * triplex lamination are different jobs. One combined sheet leaves them unable
 * to tell which glass is for which. On top of that, tempering comes back the
 * next day and lamination after several unpredictable days, so a shared report
 * number would let "I received the report" mark triplex as back while it is
 * still out.
 *
 * What must never travel:
 *   mirrors — cut here, ready after the work day
 *   triplex that is not tempered — same
 *
 * Run: node scripts/test-factory-split.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'firebase-db.js'), 'utf8');

const parts = [
  SRC.match(/function _lgItemHasGraphic[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasChalavi[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsLaminatedTriplex[\s\S]*?\n}/),
  SRC.match(/function _lgItemHasSurfaceWork[\s\S]*?\n}/),
  SRC.match(/function _lgItemIsMirror[\s\S]*?\n}/),
  SRC.match(/function lgSplitFactoryItems[\s\S]*?\n}/),
];
if (parts.some(p => !p)) {
  console.error('FAIL  could not extract the split helpers from firebase-db.js');
  process.exit(1);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parts.map(p => p[0]).join('\n'), ctx);
const { lgSplitFactoryItems, _lgItemIsMirror } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const counts = items => {
  const s = lgSplitFactoryItems(items);
  return [s.chisum.length, s.triplex.length];
};

/* ── mirrors ───────────────────────────────────────────────────────────── */
check('mirror by glass', _lgItemIsMirror({ glass: 'מראה' }), true);
check('grey mirror is still a mirror', _lgItemIsMirror({ glass: 'מראה אפורה' }), true);
check('bronze mirror is still a mirror', _lgItemIsMirror({ glass: 'מראה ברונזה' }), true);
check('legacy mirror by name', _lgItemIsMirror({ name: "5 מ''מ מראה חתוך" }), true);
check('plain grey glass is not a mirror', _lgItemIsMirror({ glass: 'אפור' }), false);

/* ── the split ─────────────────────────────────────────────────────────── */
check('nothing to send', counts([{ name: "6 מ''מ שקוף מלוטש" }]), [0, 0]);
check('ordinary tempered glass → chisum', counts([{ chisum: true, glass: 'שקוף' }]), [1, 0]);
check('tempered triplex → triplex', counts([{ chisum: true, triplex: true }]), [0, 1]);

/* a tempered mirror still does not travel — it is cut and silvered here */
check('tempered mirror does not travel',
      counts([{ chisum: true, glass: 'מראה' }]), [0, 0]);
check('tempered grey mirror does not travel',
      counts([{ chisum: true, glass: 'מראה אפורה' }]), [0, 0]);

/* regular triplex is not tempered, so it never reaches the split */
check('untempered triplex does not travel',
      counts([{ chisum: false, triplex: true }]), [0, 0]);

/* ── the case the whole thing exists for ──────────────────────────────── */
check('one order with both → one item to each report',
      counts([
        { chisum: true, glass: 'שקוף' },
        { chisum: true, triplex: true },
        { chisum: true, glass: 'מראה' },        // stays here
        { chisum: false, glass: 'קליר' },       // not tempered
      ]), [1, 1]);

check('several of each are counted separately',
      counts([
        { chisum: true, glass: 'שקוף' },
        { chisum: true, glass: 'קליר' },
        { chisum: true, triplex: true },
        { chisum: true, triplex: true },
        { chisum: true, triplex: true },
      ]), [2, 3]);

/* ── indices come back so the caller can mark arrival per item ─────────── */
{
  const s = lgSplitFactoryItems([
    { chisum: true, glass: 'שקוף' },
    { chisum: true, triplex: true },
  ]);
  check('chisum entry keeps its original index', s.chisum[0].idx, 0);
  check('triplex entry keeps its original index', s.triplex[0].idx, 1);
}

/* ── legacy items, name only ───────────────────────────────────────────── */
check('legacy tempered triplex by name → triplex',
      counts([{ chisum: true, name: '8+8 טריפלקס שקוף מחוסם' }]), [0, 1]);
check('empty and missing input are safe', [counts([]), counts(null)], [[0, 0], [0, 0]]);

/* ── the chisum screen must enumerate through the splitter ─────────────
   workday.html counted panels with items.filter(it => it.chisum), which is a
   different set from what actually travels on the chisum report: it also
   swept up mirrors, which are cut in-house and never leave, and laminated
   triplex, which goes to the same factory on a SEPARATE report and is ticked
   back through triplexArrived rather than chisumArrivedIdxs.

   So those panels were counted in the chisum badge and again in the triplex
   badge, and nothing the worker could do would clear them from the first —
   the chisum badge could never reach zero on such an order. */
{
  const order = { items: [
    { chisum: true, glass: 'שקוף' },                 // 0 — on the chisum report
    { chisum: true, glass: 'מראה' },                  // 1 — never leaves the building
    { chisum: true, triplex: true, glass: 'שקוף' },   // 2 — on the triplex report
    { graphic: true, glass: 'שקוף' },                 // 3 — not a factory panel at all
  ]};
  const split = lgSplitFactoryItems(order.items);
  check('only the real chisum panel is on the chisum report',
        split.chisum.map(e => e.idx), [0]);
  check('the laminated triplex panel is on the triplex report',
        split.triplex.map(e => e.idx), [2]);

  const naive = order.items.filter(it => it.chisum).length;
  check('the old count really did inflate this order from 1 to 3', naive, 3);
  check('and really did count the triplex panel on both reports',
        naive - split.chisum.length, split.triplex.length + 1);   // +1 for the mirror
}

const fs2      = require('fs');
const workday  = fs2.readFileSync(require('path').join(__dirname, '..', 'workday.html'), 'utf8');
check('workday exposes one definition of what is on the chisum report',
      /function _chisumIdxsOf\(/.test(workday), true);
check('and it delegates to the chisum track',
      /function _chisumIdxsOf\(order\)\{ return LG_TRACK\.chisum\.idxsOf\(order\); \}/.test(workday), true);
/* ── one engine, two tracks ────────────────────────────────────────────
   Chisum and triplex are the same job for us: a report comes back and every
   panel on it gets ticked off. They were two separate implementations, and
   the run of bugs on this screen came from exactly that — two places meant to
   count the same thing counting it differently. Everything that differs
   between the tracks now lives in LG_TRACK and nowhere else. */
const TRACKS = (workday.match(/const LG_TRACK = \{[\s\S]*?\n\};/) || [''])[0];
check('workday declares both tracks in one place',
      /chisum:[\s\S]*triplex:/.test(TRACKS), true);
for (const field of ['idxsField', 'flagField', 'reportId', 'idxsOf']) {
  check(`both tracks declare ${field}`, (TRACKS.match(new RegExp(field + ':', 'g')) || []).length, 2);
}
check('both resolve their panels through lgSplitFactoryItems',
      (TRACKS.match(/lgSplitFactoryItems\(/g) || []).length, 2);

{
  /* A writer that ignored its track would mark the chisum field from the
     triplex screen — the two would silently share one set of ticks. */
  for (const fn of ['toggleArrived', 'markAllClientArrived', 'setGroupArrivedCount', '_persistArrivedIdxs']) {
    const body = (workday.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
    check(`${fn} takes a track`, /^function \w+\([^)]*\btrack\b/.test(body), true);
    check(`${fn} names no field literally`, /chisumArrivedIdxs/.test(body), false);
  }
}

/* the triplex tab must render the marking cards, not just a summary — it
   showed a report card with no way to tick anything on it */
check('the triplex tab reuses the chisum client cards',
      /_chisumClientCardHtml\(cn, ords, reportId, 'triplex'\)/.test(workday), true);

/* and the "ראה עוד" summary belongs only to a report still at the factory.
   Once the marking cards are there it repeats the same client, the same count
   and a second sketch button underneath them — it read as a duplicate, empty
   copy of the report. */
check('the triplex summary is hidden once the report is back',
      /\$\{arrived \? '' : `<details/.test(workday), true);

/* and an order may not leave the stage with triplex still outstanding */
check('completion waits for the triplex panels too',
      /done: chMissing === 0 && txMissing === 0/.test(workday), true);
/* the dialog and the action must agree — they computed "done" separately, so
   the dialog announced a sketch complete and confirming did nothing */
check('the dialog and the confirm share one predicate',
      (workday.match(/_factoryDoneState\(o\)/g) || []).length >= 2, true);
/* and confirming must actually close the arrived panels, not re-save them */
check('confirming closes what arrived',
      /_closeArrived\(sid, st\.chisumArrived,\s*'chisum'\)/.test(workday), true);
check('for both tracks',
      /_closeArrived\(sid, st\.triplexArrived, 'triplex'\)/.test(workday), true);
check('closed panels drop off the list',
      /function _pendingIdxsOf\(order, track\)/.test(workday), true);

/* ── the report card must describe the report, not the orders ──────────
   The card and its header counted (o.items||[]).length — every panel in the
   orders, including ones that never travel. The same line then showed the
   arrival progress, which counts only what did travel, so it read
   "40 פריטים · 23/32 הגיעו": two numbers over two different sets, side by
   side, with nothing to say so. The printed report holds 32. */
check('the report card counts what is still open on the report',
      /const totalItems = orders\.reduce\(\(s, o\) => s \+ _pendingIdxsOf\(o, 'chisum'\)\.length, 0\)/.test(workday), true);
check('and no longer counts every item in the orders',
      /const totalItems = orders\.reduce\(\(s, o\) => s \+ \(o\.items\|\|\[\]\)\.length, 0\)/.test(workday), false);

/* Both badges count the panels on a report that has come back and is being
   ticked now. A report still at the factory has nothing to mark on it, and
   counting it left the badge showing work nobody could do. */
check('one badge builder serves both tabs',
      /_factoryBadge\('chisum',\s*'cnt-chisum'\)/.test(workday)
      && /_factoryBadge\('triplex',\s*'cnt-triplex'\)/.test(workday), true);
check('it skips reports still at the factory',
      /if\(!o\[T\.flagField\]\) return;/.test(workday), true);
check('and counts the panels still open on it',
      /total \+= _pendingIdxsOf\(o, track\)\.length;/.test(workday), true);

/* the waiting card's per-client breakdown must use the same definition as the
   header directly above it — it read "דוח 22 — 3 פריטים" over "28 פריטים" */
check('the waiting breakdown counts the report, not every item in the orders',
      /byClient\[n\] = \(byClient\[n\]\|\|0\)\+_pendingIdxsOf\(o,'chisum'\)\.length/.test(workday), true);

/* ── run the engine for real ───────────────────────────────────────────
   The checks above read the source. This one executes it: one order holding
   both a chisum panel and a laminated triplex panel, ticked on both screens,
   proving the two tracks keep separate books. If they shared one, marking a
   panel as back from tempering would also mark the triplex that is still out. */
{
  const vm2  = require('vm');
  const grab = (re) => (workday.match(re) || [''])[0];
  const src  = [
    grab(/const LG_TRACK = \{[\s\S]*?\n\};/),
    grab(/const _tr = [^\n]*\n/),
    grab(/function _markedIdxSet\([\s\S]*?\n}/),
    grab(/function _closedIdxSet\([\s\S]*?\n}/),
    grab(/function _pendingIdxsOf\([\s\S]*?\n}/),
  ].join('\n');

  /* the engine needs the same helpers the page gets from firebase-db.js */
  const deps = parts.map(p => p[0])
    .concat([(SRC.match(/function lgArrivedIdxs[\s\S]*?\n}/) || [''])[0]])
    .join('\n');

  const ctx = { console, allOrders: [] };
  vm2.createContext(ctx);
  /* const bindings do not attach to the context object, so hand them over */
  vm2.runInContext(deps + '\n' + src + '\nglobalThis.LG_TRACK = LG_TRACK;', ctx);

  const order = {
    id: 'L1044',
    items: [
      { chisum: true, glass: 'שקוף' },                 // 0 — chisum report
      { chisum: true, triplex: true, glass: 'שקוף' },   // 1 — triplex report
      { chisum: true, glass: 'מראה' },                  // 2 — never leaves
    ],
    chisumArrivedIdxs:  { 0: true },
    triplexArrivedIdxs: null,
  };
  ctx.allOrders = [order];

  check('the chisum track sees only its own panel',
        ctx.LG_TRACK.chisum.idxsOf(order), [0]);
  check('the triplex track sees only its own panel',
        ctx.LG_TRACK.triplex.idxsOf(order), [1]);
  check('the mirror is on neither report',
        ctx.LG_TRACK.chisum.idxsOf(order).concat(ctx.LG_TRACK.triplex.idxsOf(order)).includes(2), false);

  check('a chisum tick is visible on the chisum screen',
        [...ctx._markedIdxSet('L1044', 'chisum')], [0]);
  check('and does NOT appear on the triplex screen',
        [...ctx._markedIdxSet('L1044', 'triplex')], []);

  /* now the triplex comes back too */
  order.triplexArrivedIdxs = { 1: true };
  check('the triplex tick lands in its own field',
        [...ctx._markedIdxSet('L1044', 'triplex')], [1]);
  check('and the chisum screen is unchanged',
        [...ctx._markedIdxSet('L1044', 'chisum')], [0]);

  /* the session echo is per track as well */
  ctx.LG_TRACK.triplex.echo['L1044'] = [1];
  check('the triplex echo does not bleed into chisum',
        [...ctx._markedIdxSet('L1044', 'chisum')], [0]);

  /* an unknown track falls back to chisum rather than throwing */
  check('an unknown track degrades to chisum',
        [...ctx._markedIdxSet('L1044', 'nonsense')], [0]);

  /* ── the round the user reported ──────────────────────────────────────
     Tick some panels, confirm the check, and the ticked ones must leave the
     list so only the missing remain. Confirming used to re-save the same
     marks — nothing left the list, and pressing it again did nothing at all. */
  const many = {
    id: 'L1039',
    items: Array.from({ length: 8 }, () => ({ chisum: true, glass: 'שקוף' })),
    chisumArrivedIdxs: { 0: true, 1: true, 2: true, 3: true, 4: true },
    chisumClosedIdxs: null,
  };
  ctx.allOrders = [many];

  check('all eight panels are open before the check',
        ctx._pendingIdxsOf(many, 'chisum').length, 8);
  check('five are ticked', [...ctx._markedIdxSet('L1039', 'chisum')].length, 5);

  /* confirming closes the five that arrived */
  many.chisumClosedIdxs = { 0: true, 1: true, 2: true, 3: true, 4: true };
  check('after confirming, only the missing three are still listed',
        ctx._pendingIdxsOf(many, 'chisum'), [5, 6, 7]);
  check('and the closed ones do not come back',
        ctx._pendingIdxsOf(many, 'chisum').some(i => i < 5), false);

  /* the remaining three arrive on a later day */
  many.chisumArrivedIdxs = { 5: true, 6: true, 7: true };
  const stillOpen = ctx._pendingIdxsOf(many, 'chisum');
  const marked    = ctx._markedIdxSet('L1039', 'chisum');
  check('the second round sees three open panels, all ticked',
        [stillOpen.length, stillOpen.every(i => marked.has(i))], [3, true]);

  many.chisumClosedIdxs = { 0:true,1:true,2:true,3:true,4:true,5:true,6:true,7:true };
  check('once everything is closed the order has nothing left open',
        ctx._pendingIdxsOf(many, 'chisum'), []);

  /* ── the report that could not be finished ────────────────────────────
     Closing every panel leaves nothing pending, and both the dialog and the
     confirm skipped an order on exactly that condition — before ever asking
     whether it was done. The card sat there saying "כל הפריטים סומנו" with
     nothing able to advance it, and the report stayed on screen for good.

     "Has this order any factory panels at all" and "has it any still open"
     are different questions. The skip must ask the first. */
  check('a fully closed order still has factory panels',
        ctx.LG_TRACK.chisum.idxsOf(many).length, 8);
  check('while nothing is left open', ctx._pendingIdxsOf(many, 'chisum').length, 0);

  const guard = (workday.match(/const everHadFactoryItems[^\n]*\n[^\n]*/) || [''])[0];
  check('the confirm skips on the full total, not the open one',
        /_chisumIdxsOf\(o\)\.length \|\| LG_TRACK\.triplex\.idxsOf\(o\)\.length/.test(guard), true);
  check('and no longer skips on what is still pending',
        /if\(!st\.chisumTotal && !st\.triplexTotal\) return;/.test(workday), false);
  check('the dialog uses the same condition',
        /if\(!_chisumIdxsOf\(o\)\.length && !LG_TRACK\.triplex\.idxsOf\(o\)\.length\) return;/.test(workday), true);
}

/* ── triplex can be finished from its own tab ──────────────────────────
   Panels could be ticked off on the triplex tab and then nothing moved them
   on: the only finish button lived on the chisum tab. The dialog behind it
   already weighs both tracks and only advances an order when both are back,
   so the tab gets the same button pointed at the same dialog rather than a
   second flow that could disagree with the first. */
check('the triplex tab has a finish button',
      /id="triplexArrivedBar"/.test(workday), true);
check('and it opens the same dialog as chisum',
      /triplexArrivedBar[\s\S]{0,700}?onclick="resetChisumList\(\)"/.test(workday), true);
check('the bar appears only while something is open to mark',
      /_pendingIdxsOf\(o, 'triplex'\)\.length/.test(workday), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll factory split checks passed.');
