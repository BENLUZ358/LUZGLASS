#!/usr/bin/env node
/**
 * Tests the review sub-stage in the sketch queue.
 *
 * A sketch arriving from a client used to land straight in the full working
 * screen. Someone reviews sketches before production — checks the dimensions
 * are there, writes on them where something needs emphasis — and that step had
 * nowhere to live, so there was no way to tell what had been reviewed.
 *
 * The split is a SUB-STAGE, not a stage. stage stays '' on both sides, the
 * queue is still built from stage, and nothing downstream changes. That is the
 * property most worth pinning: a bug here would push orders out of the queue
 * and into the drafter or Hashavshevet route nobody chose.
 *
 * Run: node scripts/test-sketch-review-tabs.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the split itself ──────────────────────────────────────────────────── */
{
  const fn = (ADMIN.match(/function sqSeenSplit[\s\S]*?\n}/) || [''])[0];
  check('the split function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);

  const items = [
    { id: 'a' },
    { id: 'b', sketchSeenAt: 0 },
    { id: 'c', sketchSeenAt: 1756500000000 },
  ];
  check('a sketch nobody reviewed is unseen',
        ctx.sqSeenSplit(items, 'unseen').map(i => i.id), ['a', 'b']);
  check('and one that was reviewed is seen',
        ctx.sqSeenSplit(items, 'seen').map(i => i.id), ['c']);
  check('every sketch lands in exactly one tab',
        ctx.sqSeenSplit(items, 'unseen').length + ctx.sqSeenSplit(items, 'seen').length,
        items.length);
  check('an empty queue does not throw', ctx.sqSeenSplit([], 'unseen'), []);
}

/* ── it is a sub-stage, not a stage ────────────────────────────────────── */
/*
 * The one property that must not break. If marking a sketch seen wrote stage,
 * the order would leave the queue entirely — buildSQItems keeps only orders
 * with no stage — and the drafter, check-station and Hashavshevet routes would
 * all see a stage nobody chose.
 */
{
  const fn = (ADMIN.match(/function sqMarkSeen[\s\S]*?\n}/) || [''])[0];
  check('the mark function is found', fn.length > 0, true);
  check('marking seen writes sketchSeenAt', /sketchSeenAt:\s*now/.test(fn), true);
  check('it never calls updateStage', /updateStage\s*\(/.test(fn), false);
  check('and never assigns to sqStageMap', /sqStageMap\s*\[[^\]]*\]\s*=/.test(fn), false);
  check('the only field it writes to the order is sketchSeenAt',
        (fn.match(/updateOrder\([^)]*\{([^}]*)\}/) || ['', ''])[1].trim(),
        'sketchSeenAt: now');
}

/* the queue is still built from stage alone — the split did not move it */
check('the queue still admits orders by stage only',
      /if \(o\.stage && o\.stage !== ''\) return;/.test(ADMIN), true);
check('and buildSQItems does not filter on sketchSeenAt',
      /function buildSQItems[\s\S]*?\n}/.exec(ADMIN)[0].includes('sqSeenSplit'), false);

/* ── the review view hides the working screen, and only there ──────────── */
check('the detail panel carries a review mode class',
      /sq-review/.test(ADMIN), true);
check('the items editor is hidden in review mode',
      /\.sq-review\s+#sqItemsWrap[\s\S]{0,200}display\s*:\s*none/.test(ADMIN), true);
check('so are the Hashavshevet and OptyWay actions',
      /\.sq-review\s+#sqBtnChash[\s\S]{0,200}display\s*:\s*none/.test(ADMIN), true);
check('the sketch itself is never hidden',
      /\.sq-review\s+#sqImgWrap[\s\S]{0,80}display\s*:\s*none/.test(ADMIN), false);
check('and neither are the notes — they are written at this step',
      /\.sq-review\s+#sqNotesWrap[\s\S]{0,80}display\s*:\s*none/.test(ADMIN), false);
check('the mode is applied from the active tab, not guessed per order',
      /classList\.toggle\('sq-review',\s*sqSeenTab === 'unseen'\)/.test(ADMIN), true);

/* ── accessibility and touch ───────────────────────────────────────────── */
check('the tabs are a tablist', /role="tablist"/.test(ADMIN), true);
check('each tab reports whether it is selected', /aria-selected/.test(ADMIN), true);
{
  const css = (ADMIN.match(/\.sq-seen-tab\s*\{[^}]*\}/) || [''])[0];
  check('the tab rule is found', css.length > 0, true);
  const px = (css.match(/min-height:\s*(\d+)px/) || [])[1];
  check('a tab is at least a 44px touch target', Number(px) >= 44, true);
}
{
  const css = (ADMIN.match(/#sqBtnSeen\s*\{[^}]*\}/) || [''])[0];
  check('the "handled" button rule is found', css.length > 0, true);
  const px = (css.match(/min-height:\s*(\d+)px/) || [])[1];
  check('and it is at least 44px too', Number(px) >= 44, true);
}
check('motion is dropped for anyone who asked for that',
      /prefers-reduced-motion[\s\S]{0,200}\.sq-seen-tab/.test(ADMIN), true);

/* ── the edit has to survive the render ────────────────────────────────── */
/*
 * sqSaveEdit persisted only `if(sqCurrent.id.startsWith('ord_'))`. Every order
 * a client uploads through the portal is keyed sub_<ms> — saveSubmission names
 * them — so the guard was false for exactly the orders whose sketches get
 * annotated. The merged image was written to the in-memory object and nothing
 * else, and the next render read it back from Firebase unchanged: you drew on
 * the sketch, pressed "סקיצה טופלה", and the work was gone.
 *
 * workday.html already knew both prefixes exist (markStageValue). This screen
 * did not.
 */
{
  const fn = (ADMIN.match(/function sqSaveEdit[\s\S]*?\n}/) || [''])[0];
  check('the save function is found', fn.length > 0, true);
  /* strip comments: the fix documents the guard it removed by quoting it, and
     a check that reads comments would fail on its own explanation */
  const code = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('saving no longer depends on the id prefix',
        /startsWith\(['"]ord_['"]\)/.test(code), false);
  check('the order is updated', /updateOrder\(/.test(fn), true);
  check('and the sketch node is written too', /lgSaveSketch\(/.test(fn), true);
  /* the list keeps its own copy; without this the thumbnail stays stale and
     the next sqShowDetail re-reads the pre-edit image from it */
  check('the queue list gets the new image as well',
        /sqItems\.find[\s\S]{0,160}?\.sketch\s*=\s*newSrc/.test(fn), true);
  /* a failed write must not look like a success */
  check('a failed save is surfaced, not swallowed',
        /catch\s*\(/.test(fn), true);
}

/* ── the edit has to survive the whole chain ───────────────────────────── */
/*
 * Every screen reads a sketch through lgSketchIntoImg → lgLoadSketch, so an
 * annotation only travels if BOTH copies move: orders/<id>/sketch, which the
 * default 'old' source returns inline, and sketches/<id>, which the 'new'
 * source prefers.
 *
 * lgGetSketch memoises into _lgSketchCache and lgSaveSketch did not touch it.
 * Under the 'new' source that cache outlives the edit: lgSketchIntoImg paints
 * the fresh inline image, then lgLoadSketch answers from the stale cache and
 * overwrites it — the annotation appears and then vanishes by itself.
 */
{
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const save = (FB.match(/async function lgSaveSketch[\s\S]*?\n}/) || [''])[0];
  check('lgSaveSketch is found', save.length > 0, true);
  check('a saved sketch refreshes the read cache',
        /_lgSketchCache\.(set|delete)\(/.test(save), true);

  const load = (FB.match(/async function lgLoadSketch[\s\S]*?\n}/) || [''])[0];
  check('the default source returns the inline copy the editor wrote',
        /lgSketchSource\(\) === 'old' && inline/.test(load), true);
  check('and sketchSeenAt did not disturb the sketch fields',
        /sketch:\s*o\.sketch\s*\|\|\s*null/.test(FB), true);
}

/* ── what the client is told ───────────────────────────────────────────── */
/*
 * A label on the step that already exists, not an eighth step. The stepper's
 * index arithmetic (hasGraphic, rawStep, stepIdx) is delicate and unrelated to
 * this change; adding a step would move every order's position in it.
 */
{
  const PORTAL = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');
  const fn = (PORTAL.match(/function _firstStepLabel[\s\S]*?\n}/) || [''])[0];
  check('the label function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  check('an unreviewed order still says it was received',
        ctx._firstStepLabel({}), 'התקבלה');
  check('and a reviewed one says it was seen',
        ctx._firstStepLabel({ sketchSeenAt: 1756500000000 }), 'נראה');
  check('a missing order does not throw', ctx._firstStepLabel(null), 'התקבלה');
  check('the step list itself is unchanged',
        /const STEPS=\["התקבלה","בתור","בייצור","חיסום","גרפיקה","מוכן","נאסף"\]/.test(PORTAL), true);
  /* the count is what the index arithmetic depends on */
  const withG    = (PORTAL.match(/const orderSteps=[\s\S]{0,200}?;/) || [''])[0];
  check('and both step lists still have their original length',
        /STEPS\.slice\(1\)/.test(withG) && /"בתור","בייצור","חיסום","מוכן","נאסף"/.test(withG), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-review-tab checks passed.');
