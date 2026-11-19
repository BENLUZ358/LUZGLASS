#!/usr/bin/env node
/** שבר חוזר לתחנת הבדיקה (בן 19/11). Run: node scripts/test-broken-redo.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };
const pick = re => { const m = SRC.match(re); if (!m) { fail++; console.log('FAIL missing ' + re); return ''; } return m[0]; };

/* ── Task 1 ── */
const ctx = { console }; vm.createContext(ctx);
vm.runInContext([pick(/function _lgBrokenEntries[\s\S]*?\n}/), pick(/function lgBrokenRedoQueue[\s\S]*?\n}/),
                 pick(/function lgBrokenRedoLabel[\s\S]*?\n}/), pick(/function lgBrokenHolds[\s\S]*?\n}/)].join('\n'), ctx);
const Q = b => ctx.lgBrokenRedoQueue([{ id: 'A', brokenChisum: b }]).map(x => ({ id: x.order.id, idx: x.idx, checked: x.checked }));
check('queue: sent to check, not checked', Q({ 2: { at: 1, redoAt: 1 } }), [{ id: 'A', idx: 2, checked: false }]);
check('queue: checked', Q({ 0: { at: 1, redoAt: 1, redoCheckedAt: 2 } }), [{ id: 'A', idx: 0, checked: true }]);
check('queue: already in a report → out', Q({ 0: { redoAt: 1, redoReportId: 'chisum_1' } }), []);
check('queue: returned → out', Q({ 0: { redoAt: 1, returnedAt: 3 } }), []);
check('queue: plain broken (not sent) → out', Q({ 0: { at: 1 } }), []);
check('queue: array shape', Q([null, { redoAt: 1 }]), [{ id: 'A', idx: 1, checked: false }]);
check('queue: no orders', ctx.lgBrokenRedoQueue(null).length, 0);

check('label none', ctx.lgBrokenRedoLabel({ at: 1 }), '');
check('label at station', ctx.lgBrokenRedoLabel({ redoAt: 1 }), 'בתחנת הבדיקה');
check('label checked', ctx.lgBrokenRedoLabel({ redoAt: 1, redoCheckedAt: 2 }), 'נבדק — יוצא בדוח הבא');
check('label in report', ctx.lgBrokenRedoLabel({ redoAt: 1, redoReportId: 'x', redoReportNum: '62' }), 'בדוח 62');

const H = x => ctx.lgBrokenHolds({ openIdxs: [2], factoryIdxs: [0, 1, 2], isDelivery: true, partialInvoice: false, ...x });
check('holds: delivery, 1 of 3 broken → continues', H({}), false);
check('holds: delivery, the only glass broken → waits', H({ factoryIdxs: [2] }), true);
check('holds: pickup customer → waits', H({ isDelivery: false }), true);
check('holds: partial-invoice customer → waits', H({ partialInvoice: true }), true);
check('holds: no open break → never', H({ openIdxs: [], isDelivery: false }), false);

/* ── Task 2: workday ── */
const WD = fs.readFileSync(path.join(ROOT, 'workday.html'), 'utf8');
const fn = name => (WD.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}\\r?\\n')) || [''])[0];
const conf = fn('confirmResetChisum');
check('confirm skips orders held by a break', /if\(_brokenHoldsOf\(o\)\)\{[^}]*return;/.test(conf), true);
check('hold check comes before any advance', conf.indexOf('_brokenHoldsOf(o)') > 0 && conf.indexOf('_brokenHoldsOf(o)') < conf.indexOf('lgLockAndAdvance'), true);
const ret = fn('markBrokenReturned');
check('"חזר" on an order still in chisum sends no message', /stage[^\n]*=== 'chisum'/.test(ret) && ret.indexOf("=== 'chisum'") < ret.indexOf('whatsapp-dispatch'), true);
check('manual break writes redoAt + manual', /function wdMarkBroken[\s\S]*?manual: true[\s\S]*?redoAt/.test(WD), true);
check('manual break closes the glass from the report', /function wdMarkBroken[\s\S]*?_closeArrived\(/.test(WD), true);
check('broken box offers "לבדיקה"', /wdSendBrokenToCheck\(/.test(fn('_renderBrokenChisumBox')), true);
check('broken box shows the redo state', /lgBrokenRedoLabel\(/.test(fn('_renderBrokenChisumBox')), true);

/* ── Task 3: check station ── */
const CS = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
const csFn = name => (CS.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}\\r?\\n')) || [''])[0];
const send = csFn('sendAllToFactory');
check('send collects checked redo pieces', /lgBrokenRedoQueue\([^)]*\)\.filter\(x ?=> ?x\.checked\)/.test(send), true);
check('send does not stop when only redo pieces wait', /if\(!doneOrds\.length && !redo\.length\)/.test(send), true);
check('send stamps redoReportNum', /redoReportNum/.test(send), true);
check('report prints "שבר"', /💥 שבר/.test(csFn('_csReportSection')), true);
check('list draws the redo section', /csRedoSectionHtml\(\)/.test(csFn('renderList')), true);

/* ── Task 4: clean card ── */
const card = fn('_chisumClientCardHtml');
check('card no longer shows the label button inline', /wdLabelBtn\(/.test(card), false);
check('card offers break through the menu', /wdItemMenuBtn\(/.test(card), true);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
