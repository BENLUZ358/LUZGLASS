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

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-review-tab checks passed.');
