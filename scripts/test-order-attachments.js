#!/usr/bin/env node
/**
 * צרופות להזמנה (בן, 10/11) — "גרפיקה חלבי" / "שרטוט פרזול" על הזמנה אחת.
 * אפיון: docs/superpowers/specs/2026-11-10-order-attachments-design.md
 * הפונקציות הטהורות של order-attachments.js, ב-Node (כמו test-sq-assign.js).
 * Run: node scripts/test-order-attachments.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'order-attachments.js'), 'utf8'), ctx);
const A = vm.runInContext('({ LG_ATT_KINDS, lgAttList, lgAttCanMerge, lgAttMergePlan, lgAttSplitPlan, lgAttFindByMsg, lgAttCandidates, lgAttSlides, lgAttPressMoved, lgAttSwipeDir, lgAttStep, lgAttInvoiced, lgAttBadge })', ctx);
const J = x => JSON.parse(JSON.stringify(x));

const NOW = 1762790000000;
const src = { id: 'wa_1', customerId: '9117', orderClient: 'נאור', waMessageId: 'M1', waSender: '972500000001', stage: '',
  sketchName: 'גרפיקה', createdAt: NOW - 5000, sketchSeenAt: 0, hasSketch: true };
const dst = { id: 'wa_0', customerId: '9117', orderClient: 'נאור', waMessageId: 'M0', stage: 'workday', sketchName: 'מקלחון רון',
  createdAt: NOW - 9000, hasSketch: true, items: [{ code: '8CM' }] };

check('kinds', J(A.LG_ATT_KINDS), { graphic: 'גרפיקה חלבי', hardware: 'שרטוט פרזול' });

// ── מותר לאחד? ──
check('same customer, target in any stage', A.lgAttCanMerge(src, dst).ok, true);
check('different customer', A.lgAttCanMerge(src, { ...dst, customerId: '14201' }).ok, false);
check('different customer says why', typeof A.lgAttCanMerge(src, { ...dst, customerId: '14201' }).why, 'string');
check('unlinked: same sender ok', A.lgAttCanMerge({ ...src, customerId: '' }, { ...dst, customerId: '', waSender: '972500000001' }).ok, true);
check('unlinked: other sender no', A.lgAttCanMerge({ ...src, customerId: '' }, { ...dst, customerId: '', waSender: '972599999999' }).ok, false);
check('unlinked email: same sender ok', A.lgAttCanMerge({ ...src, customerId: '', waSender: '', emailFrom: 'A <a@x.com>' },
  { ...dst, customerId: '', emailFrom: 'a@x.com' }).ok, true);
check('source with items no', A.lgAttCanMerge({ ...src, items: [{ code: 'x' }] }, dst).ok, false);
check('source sent to HS no', A.lgAttCanMerge({ ...src, hashavshevet: { sentAt: 1 } }, dst).ok, false);
check('source not in queue no', A.lgAttCanMerge({ ...src, stage: 'drafter' }, dst).ok, false);
check('same order no', A.lgAttCanMerge(src, src).ok, false);

// ── תכנית האיחוד ──
const plan = A.lgAttMergePlan(src, dst, 'graphic', 'data:image/png;base64,AAA', { layer: null, base: null }, NOW, 'ben');
check('merge: first slot is 1', plan.k, 1);
check('merge: paths', Object.keys(plan.upd).sort(), [
  'orders/wa_0/attachments/1', 'orders/wa_0/updatedAt', 'orders/wa_1',
  'sketches/wa_0__att1', 'sketches/wa_1', 'sketches/wa_1__base', 'sketches/wa_1__layer']);
check('merge: image moved', plan.upd['sketches/wa_0__att1'], 'data:image/png;base64,AAA');
check('merge: source removed', [plan.upd['orders/wa_1'], plan.upd['sketches/wa_1']], [null, null]);
check('merge: meta', [plan.upd['orders/wa_0/attachments/1'].kind, plan.upd['orders/wa_0/attachments/1'].at, plan.upd['orders/wa_0/attachments/1'].by],
  ['graphic', NOW, 'ben']);
check('merge: full copy of the source kept', J(plan.upd['orders/wa_0/attachments/1'].from.order), J(src));
check('merge: next slot after existing', A.lgAttMergePlan(src, { ...dst, attachments: { 1: { kind: 'hardware' }, 3: { kind: 'graphic' } } },
  'hardware', 'x', {}, NOW, 'ben').k, 4);
check('merge: bad kind throws', (() => { try { A.lgAttMergePlan(src, dst, 'evil', 'x', {}, NOW, 'b'); return 'no'; } catch (e) { return 'threw'; } })(), 'threw');

// ── הפרדה מחזירה בדיוק ──
const dst2 = { ...dst, attachments: { 1: plan.upd['orders/wa_0/attachments/1'] } };
const sp = A.lgAttSplitPlan(dst2, 1, 'data:image/png;base64,AAA');
check('split: paths', Object.keys(sp).sort(), ['orders/wa_0/attachments/1', 'orders/wa_0/updatedAt', 'orders/wa_1', 'sketches/wa_0__att1', 'sketches/wa_1']);
check('split: original record restored exactly', J(sp['orders/wa_1']), J(src));
check('split: image back', sp['sketches/wa_1'], 'data:image/png;base64,AAA');
check('split: attachment removed', [sp['orders/wa_0/attachments/1'], sp['sketches/wa_0__att1']], [null, null]);
const withLayer = { ...dst, attachments: { 2: { kind: 'graphic', from: { order: src, layer: '{"v":1}', base: 'data:b' } } } };
const sp2 = A.lgAttSplitPlan(withLayer, 2, 'img');
check('split: editor layer restored', [sp2['sketches/wa_1__layer'], sp2['sketches/wa_1__base']], ['{"v":1}', 'data:b']);
check('split: unknown slot throws', (() => { try { A.lgAttSplitPlan(dst, 9, 'x'); return 'no'; } catch (e) { return 'threw'; } })(), 'threw');

// ── רשימה ושקופיות ──
const withAtt = { ...dst, attachments: { 3: { kind: 'hardware', at: 3 }, 1: { kind: 'graphic', at: 1 } } };
check('list sorted with labels', J(A.lgAttList(withAtt)), [{ k: 1, kind: 'graphic', label: 'גרפיקה חלבי', at: 1 }, { k: 3, kind: 'hardware', label: 'שרטוט פרזול', at: 3 }]);
check('list empty', J(A.lgAttList(dst)), []);
check('slides', J(A.lgAttSlides(withAtt)), [{ label: 'סקיצה', key: 'wa_0' }, { label: 'גרפיקה חלבי', key: 'wa_0__att1', k: 1 }, { label: 'שרטוט פרזול', key: 'wa_0__att3', k: 3 }]);

// ── חיפוש לפי הודעה ──
const orders = [dst, { ...dst, id: 'X', waMessageId: 'Z', attachments: { 2: { kind: 'graphic', from: { order: { id: 'gone', waMessageId: 'M7' } } } } }];
check('find attachment by WA message', J(A.lgAttFindByMsg(orders, 'M7')), { orderId: 'X', k: 2 });
check('find none', A.lgAttFindByMsg(orders, 'M0'), null);

// ── למי אפשר לחבר ──
const pool = [src, dst, { ...dst, id: 'o2', createdAt: NOW - 1 }, { ...dst, id: 'o3', customerId: '1' }, { ...dst, id: 'o4', stage: 'collected', createdAt: NOW - 2 }];
check('candidates: same customer, newest first, not itself', A.lgAttCandidates(src, pool).map(o => o.id), ['o2', 'o4', 'wa_0']);


// ── לחיצה ארוכה, החלקה, דפדוף (Task 2-3) ──
check('press: still finger keeps the long-press', A.lgAttPressMoved(3, -4), false);
check('press: exactly 10px still counts as still', A.lgAttPressMoved(6, 8), false);
check('press: moved more than 10px cancels', A.lgAttPressMoved(8, 8), true);
check('swipe: short move is a tap', A.lgAttSwipeDir(20, 0), 0);
check('swipe: vertical scroll is not a swipe', A.lgAttSwipeDir(60, 80), 0);
check('swipe: finger to the right = next (RTL)', A.lgAttSwipeDir(60, 5), 1);
check('swipe: finger to the left = previous', A.lgAttSwipeDir(-60, 5), -1);
check('step: next', A.lgAttStep(0, 1, 3), 1);
check('step: stops at the last', A.lgAttStep(2, 1, 3), 2);
check('step: stops at the first', A.lgAttStep(0, -1, 3), 0);
check('step: empty', A.lgAttStep(0, 1, 0), 0);
check('invoiced: doc number', A.lgAttInvoiced({ invoiceDone: { docNumber: '67346' } }), true);
check('invoiced: partial pieces (raw)', A.lgAttInvoiced({ invoiceDone: { pieces: { 0: '1' } } }), true);
check('invoiced: partial pieces (normalized)', A.lgAttInvoiced({ invoicePieces: { 2: '1' } }), true);
check('invoiced: not yet', A.lgAttInvoiced({ stage: 'done' }), false);
check('badge: none', A.lgAttBadge(dst), '');
check('badge: count', A.lgAttBadge(withAtt), '📎 2');

// ── חיבור בדפים (בדיקת מקור) ──
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MOD = read('order-attachments.js');
check('module: DOM part only in the browser', /if \(typeof window !== 'undefined'\)/.test(MOD), true);
['lgAttMerge', 'lgAttSplit', 'lgAttPickKind', 'lgAttConnectMenu', 'lgAttFlipper', 'lgAttWireList'].forEach(n =>
  check('module: exposes ' + n, new RegExp('window\\.' + n + '\\s*=').test(MOD), true));
check('module: merge is one atomic write', /_lgDb\.ref\(\)\.update\(/.test(MOD), true);
check('module: invoiced warning text', MOD.includes('החשבונית כבר נשלחה בלי התמונה הזו'), true);
const PAGES = { 'admin.html': 2, 'drafter.html': 1, 'workday.html': 2, 'check-station.html': 1, 'invoices.html': 1 };
for (const [f, n] of Object.entries(PAGES)) {
  const h = read(f);
  check(f + ': loads order-attachments.js after firebase-db.js',
    h.indexOf('src="order-attachments.js') > h.indexOf('src="firebase-db.js'), true);
  check(f + ': flipper wired (' + n + '+)', (h.match(/lgAttFlipper\(/g) || []).length >= n, true);
}
check('wa-inbound-panel: flipper in the viewer', /lgAttFlipper\(/.test(read('wa-inbound-panel.js')), true);
const ADM = read('admin.html');
check('admin: queue rows carry their id', /data-sq-id="\$\{lgEsc\(String\(item\.id\)\)\}"/.test(ADM), true);
check('admin: queue wired for long-press / drag', /lgAttWireList\(/.test(ADM), true);
check('admin: queue row shows the attachment count', /lgAttBadge\(/.test(ADM), true);
check('admin: queue detail has split', /onSplit/.test(ADM), true);
check('admin: sqItems keep attachments', /attachments:\s+o\.attachments \|\| null/.test(ADM), true);

// ⚠️ הזמנה שעוברת דרך lgNormalizeOrder ונשמרת שוב — לא מאבדת את הצרופות
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
check('lgNormalizeOrder keeps attachments', /attachments:\s+o\.attachments\s+\|\| null/.test(SRC), true);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nAll order-attachments checks passed.');
