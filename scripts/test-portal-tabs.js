#!/usr/bin/env node
/**
 * Tests that every order in the client portal sits in exactly one tab.
 *
 * The three predicates were already right and already mutually exclusive. The
 * markup was not: #secHistory — the collected orders — lived inside
 * #view-orders alongside #secActive. So the "הזמנות" tab showed a badge of 0
 * and a page full of collected orders underneath it, which is what a client
 * reads as "the system does not know where my order is".
 *
 * Three tabs, one home each:
 *   הזמנות פעילות  _isInProgress   still being worked on
 *   מוכן           _isReady        finished, not yet picked up
 *   נאספו          _isCollected    gone
 *
 * Run: node scripts/test-portal-tabs.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.join(__dirname, '..');
const PORTAL = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the predicates still partition the orders ─────────────────────────── */
{
  /* the three sit together; _isCollected and _isInProgress are one-liners, so
     a per-function `\n}` regex overshoots and swallows its neighbours */
  const src = (PORTAL.match(
    /function _isCollected[\s\S]*?function _isInProgress\([^)]*\)\{[^\n]*\}/) || [''])[0];
  check('all three predicates are found',
        ['_isCollected', '_isReady', '_isInProgress'].every(n => src.includes('function ' + n)), true);
  check('and nothing beyond them was captured',
        (src.match(/^function /gm) || []).length, 3);

  const ctx = vm.createContext({ LG_READY_STAGES: ['done', 'delivery'] });
  vm.runInContext(src, ctx);

  const ORDERS = [
    { id: 'a', stage: 'workday' },                    // in progress
    { id: 'b', stage: 'chisum' },                     // in progress
    { id: 'c', stage: 'done' },                       // ready
    { id: 'd', stage: 'delivery' },                   // ready
    { id: 'e', stage: 'collected' },                  // collected
    { id: 'f', status: 'נאסף' },                      // collected, old shape
    { id: 'g', status: 'מוכן לאיסוף' },               // ready, old shape
  ];
  const where = o =>
    [ctx._isInProgress(o) && 'active', ctx._isReady(o) && 'ready', ctx._isCollected(o) && 'collected']
      .filter(Boolean);

  ORDERS.forEach(o => check(`order ${o.id} has exactly one home`, where(o).length, 1));
  check('and they are the homes expected',
        ORDERS.map(o => where(o)[0]),
        ['active', 'active', 'ready', 'ready', 'collected', 'collected', 'ready']);
  /* a collected order must never also count as ready — that was the overlap
     that let one order appear in two places at once */
  check('collected always wins over ready',
        ctx._isReady({ stage: 'collected', status: 'מוכן לאיסוף' }), false);
}

/* ── each predicate renders into its own tab's container ───────────────── */
check('there is a collected tab', /id="tab-collected"/.test(PORTAL), true);
check('and a view to go with it', /id="view-collected"/.test(PORTAL), true);
check('and setTab knows about it',
      /const PORTAL_TABS = \[[^\]]*'collected'/.test(PORTAL), true);
check('the orders tab is renamed to say it holds active work',
      /id="tab-orders"[^>]*>[^<]*הזמנות פעילות/.test(PORTAL), true);

/* the actual defect: collected orders were rendered inside the orders view */
{
  const view = (PORTAL.match(/<div id="view-orders"[\s\S]*?\n  <div id="view-ready"/) || [''])[0];
  check('the orders view is found', view.length > 0, true);
  check('the active section is in the orders view', /id="secActive"/.test(view), true);
  check('and the history section is NOT', /id="secHistory"/.test(view), false);
  check('the search box stays in the orders view', /id="ordSearch"/.test(view), true);
}
{
  const view = (PORTAL.match(/<div id="view-collected"[\s\S]*?\n  <div id="view-/) || [''])[0];
  check('the collected view is found', view.length > 0, true);
  check('and it holds the history section', /id="secHistory"/.test(view), true);
}

/* ── the counts ────────────────────────────────────────────────────────── */
check('the collected tab carries a badge', /id="badge-collected"/.test(PORTAL), true);
check('and renderStats fills it',
      /badge-collected[\s\S]{0,80}textContent/.test(PORTAL), true);
check('the orders badge still counts only active work',
      /badge-orders"\)\.textContent\s*=\s*active/.test(PORTAL), true);

/* ── search must not be broken by the move ─────────────────────────────── */
/*
 * Search lives in the orders view and hid secActive and secHistory together.
 * Now that secHistory sits in the collected view, hiding it from here reaches
 * across views: search for something, switch to נאספו, and the tab is blank
 * with no way to tell why. Search may only touch what is in its own view.
 */
check('search still looks at every order, not just the open tab',
      /const found = ORDERS\.filter\(hit\)/.test(PORTAL), true);
{
  const fn = (PORTAL.match(/function renderOrders[\s\S]*?\n}/) || [''])[0];
  check('renderOrders is found', fn.length > 0, true);
  check('searching never hides the collected view\'s section',
        /secHistory\s*(\.style)?[^;]*=\s*[^;]*'none'/.test(fn), false);
  check('and the collected list is still filled on every render',
        /historyOrders"\)\.innerHTML/.test(fn), true);
  check('what it does hide is null-guarded',
        /secActive\s*&&|if\s*\(\s*secActive\s*\)|secActive\?\./.test(fn), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll portal-tab checks passed.');
