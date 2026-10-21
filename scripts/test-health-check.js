#!/usr/bin/env node
/**
 * "בדיקת תקינות" בלוח הניהול (בן, 20/10/2026): "איך מוודאים שהעבודה היום עבדה חלק ולא
 * יצרה דברים שקטים שנראה בהמשך כבאגים?" — בדיקה שרק קוראת ומחזירה רשימה בעברית.
 * כל בדיקה כאן נולדה מתקלה אמיתית: 16 הזמנות בתחנה בשלב opty, רשומות ord_ ריקות,
 * L1088 שלא נשלחה לחשבשבת, "דוח ישן" ריק.
 *
 * Run: node scripts/test-health-check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ Object, Array, String, Number, Set, Date, JSON, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lg-health.js'), 'utf8'), ctx);
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 9, 20, 15, 0);
const it = (sku, extra) => Object.assign({ sku, w: 600, h: 1500, chisum: true }, extra || {});
const ord = (id, o) => Object.assign({ id, orderNum: 'L' + id.slice(-4), orderClient: 'א.מ.מראות', stage: 'chisum', hasSketch: true,
  items: [it('8SMH')], chisumReportId: 'r40', chisumReportNum: '40', hashavshevet: { httpOk: true } }, o);

const healthy = {
  orders: { a1001: ord('a1001'), a1002: ord('a1002', { stage: '', items: [] }) },
  workday: { inChisum: {}, inWork: {}, checkState: {} },
  waInbound: { m1: { state: 'done', createdAt: NOW - 3600e3 } },
  waOutbox: { x1: { state: 'sent', createdAt: NOW - 3600e3 } },
  prices: { '8SMH': 190 },
};
{
  const r = ctx.lgHealthCheck(healthy, NOW);
  check('a healthy system has no problems', r.problems.length, 0);
  check('…and says what it checked', r.ok.length > 5, true);
  check('the summary counts orders by stage, in Hebrew', /נשלח לחיסום: 1/.test(r.summary) && /תור סקיצות: 1/.test(r.summary), true);
}

const titles = r => r.problems.map(p => p.sev + ' | ' + p.title);
const find = (r, re) => r.problems.find(p => re.test(p.title));
{
  const sick = JSON.parse(JSON.stringify(healthy));
  // the 19/10 bug: in the check station, stage still opty; and the stray record it left
  sick.orders.a2000 = ord('a2000', { stage: 'opty', chisumReportId: null, chisumReportNum: null, hashavshevet: null });
  sick.workday.inChisum = { 0: 'a2000', 1: 'gone_1' };
  sick.orders.ord_wa_x_1 = { stage: 'workday', status: 'ירד לביצוע', updatedAt: 1 };
  // check marks left for an order that is not in the station
  sick.workday.checkState = { a1001: [true] };
  // L1088: at the factory, never sent to Hashavshevet, its SKU has no general price
  sick.orders.a1088 = ord('a1088', { items: [it('1010SMH')], chisumReportId: null, triplexReportId: 't41', hashavshevet: null });
  // at the factory with no report at all; two orders with one number; an item with no size
  sick.orders.a3000 = ord('a3000', { chisumReportId: null, chisumReportNum: null });
  sick.orders.a3001 = ord('a3001', { orderNum: 'L1001', items: [it('8SMH', { w: 0 })] });
  // WhatsApp stuck in and failed out
  sick.waInbound.m2 = { state: 'dead', refNum: 'L1050', reason: 'no client', createdAt: NOW - 7200e3 };
  sick.waOutbox.x2 = { state: 'failed', kind: 'ready', error: '401', createdAt: NOW - 7200e3 };
  const r = ctx.lgHealthCheck(sick, NOW);
  const t = titles(r);
  check('in the station but stage is not "ירד לביצוע" — named', /L2000/.test((find(r, /בתחנת הבדיקה אבל/) || {}).items), true);
  check('a station entry whose order is gone is a high problem', !!t.find(x => /^high \| .*תחנת הבדיקה.*לא קיימת/.test(x)), true);
  check('empty records are a low problem with the count', (find(r, /רשומות ריקות/) || {}).sev, 'low');
  check('check marks for an order not in the station', /L1001/.test((find(r, /סימוני בדיקה/) || {}).items), true);
  check('at the factory and not sent to Hashavshevet', /L1088/.test((find(r, /לא נשלחה לחשבשבת/) || {}).items), true);
  check('an SKU with no general price is named', /1010SMH/.test((find(r, /אין לו מחיר כללי/) || {}).items), true);
  check('at the factory with no report at all', /L3000/.test((find(r, /בלי דוח/) || {}).items), true);
  check('a triplex-only order is NOT "with no report"', /L1088/.test((find(r, /בלי דוח/) || {}).items), false);
  check('duplicate order numbers', /L1001/.test((find(r, /כפול/) || {}).items), true);
  check('an item with no size', /L1001/.test((find(r, /בלי מידות/) || {}).items), true);
  check('WhatsApp inbound stuck', /L1050/.test((find(r, /וואטסאפ נכנס/) || {}).items), true);
  check('WhatsApp outbound failed', /401/.test((find(r, /וואטסאפ יוצא/) || {}).items), true);
  check('problems are ordered high → mid → low', r.problems.map(p => p.sev).join(',') === r.problems.map(p => p.sev).sort((a, b) => ['high', 'mid', 'low'].indexOf(a) - ['high', 'mid', 'low'].indexOf(b)).join(','), true);
}
{
  const r = ctx.lgHealthCheck({ orders: null, workday: null, waInbound: null, waOutbox: null, prices: null }, NOW);
  check('an empty database does not crash', r.problems.length, 0);
}

/* the dashboard button */
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
check('admin loads lg-health.js', /<script src="lg-health\.js[^"]*"><\/script>/.test(ADMIN), true);
check('a "בדיקת תקינות" button in the top bar', /onclick="lgRunHealthCheck\(\)"[^>]*>[\s\S]{0,80}בדיקת תקינות/.test(ADMIN), true);
check('the run only reads (once), never writes', (() => {
  const i = ADMIN.indexOf('async function lgRunHealthCheck('); const body = ADMIN.slice(i, ADMIN.slice(i).search(/\r?\n\}\r?\n/) + i);
  // ov.remove() is the window closing — only database writes count
  return i > 0 && /once\('value'\)/.test(body) && !/ref\([^)]*\)\s*\.(set|update|remove|push|transaction)\(/.test(body) && !/\bupdateOrder|updateStage|save[A-Z]/.test(body);
})(), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll health-check checks passed.');
