#!/usr/bin/env node
/**
 * Tests monthly billing — שוטף 30.
 *
 * Some clients collect orders through the month and are billed once at the end.
 * Today every collected order asks whether to invoice, which for such a client
 * is the same needless question twenty times.
 *
 * The flag is not a new mechanism. users.isDelivery already does exactly this:
 * a toggle in the user manager, _propagateDeliveryToOrders to reach orders that
 * already exist (keyed on phone, not name — names change), and a slot in
 * lgNormalizeOrder. monthlyBilling follows it — including, now, the OR against
 * the client record that makes the delivery flag reach orders created later.
 *
 * The whitelist slot is the part worth guarding. A field not named in
 * lgNormalizeOrder is dropped on the way to every screen, and that has cost
 * four separate bugs here: chisumArrivedIdxs, itemType, pickedDate and
 * hashavshevetInvoice.
 *
 * Most of what follows runs the real functions rather than matching their
 * source. A regex over file text cannot fail for the reason its name claims:
 * the earlier version of this file asserted things like "/שוטף 30/ appears in
 * admin.html" — true of five unrelated lines — and would have passed with the
 * whole billing screen deleted.
 *
 * Run: node scripts/test-monthly-billing.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = read('admin.html');
const DB    = read('firebase-db.js');
const WD    = read('workday.html');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (src, name) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* Pull the real functions out of the pages and run them. They are pure enough
   for this — the same trick scripts/test-order-pricing.js uses on the invoice
   line builder. Anything missing fails loudly here rather than silently
   turning a later check green. */
function load(src, names, ctx) {
  for (const n of names) {
    const body = bodyOf(src, n);
    if (!body) { console.error('FAIL  could not extract ' + n); failed++; continue; }
    vm.runInContext(body, ctx);
  }
}

/* ── the flag survives to every screen ─────────────────────────────────── */
{
  const norm = bodyOf(DB, 'lgNormalizeOrder');
  check('monthlyBilling is in the whitelist',
        /monthlyBilling: !!o\.monthlyBilling,/.test(norm), true);
  /* finding 3 leans on both of these reaching the screen */
  check('and so do httpOk and simulated on the invoice summary',
        /httpOk:\s+!!o\.hashavshevetInvoice\.httpOk/.test(norm)
        && /simulated:\s+!!o\.hashavshevetInvoice\.simulated/.test(norm), true);
}

/* ── the toggle, following isDelivery exactly ──────────────────────────── */
check('there is a toggle', /async function umToggleMonthly\(/.test(ADMIN), true);
check('it writes the flag on the user',
      /update\(\{ monthlyBilling: newVal, updatedAt: Date\.now\(\) \}\)/.test(ADMIN), true);
/* keyed on phone, because a client's name can change and their phone is the
   identifier every order carries */
check('and propagates by phone, not name',
      /_propagateMonthlyToOrders\(user\.phone, newVal\)/.test(ADMIN), true);
check('the button is on the row', /umToggleMonthly\('\$\{u\.id\}'/.test(ADMIN), true);
/* scoped to the badge in the user row. "שוטף 30" appears five times in
   admin.html — the toggle's own title attribute among them — so a bare search
   for the string passed with the badge deleted. */
{
  const row = bodyOf(ADMIN, '_renderUserList');
  check('and the row carries a badge saying the flag is on',
        /\$\{u\.monthlyBilling\?'<span[^']*📅 שוטף 30<\/span>':''\}/.test(row), true);
}

/* ── propagation reaches orders that already exist ─────────────────────── */
{
  const prop = bodyOf(ADMIN, '_propagateMonthlyToOrders');
  check('propagation exists', prop.length > 0, true);
  check('it matches orders by phone',
        /o\.clientPhone === phone \|\| o\.phone === phone/.test(prop), true);
  check('and only writes where the value differs',
        /if\(!!o\.monthlyBilling !== !!isMonthly\)/.test(prop), true);
}

/* ══ finding 2 ═════════════════════════════════════════════════════════════
 * _propagateMonthlyToOrders runs only when the toggle is flipped. Nothing
 * copies the flag onto an order at creation, so every order opened after a
 * client was marked שוטף 30 carried no flag at all and the delivery dialog
 * asked the invoice question again — the one question this feature exists to
 * remove. The feature worked once, for the orders that already existed, and
 * then stopped.
 *
 * deliveryClient never had this problem because it has two live fallbacks:
 * lgNextStage ORs order.deliveryClient with the client record, and entering a
 * work day writes the flag onto the order. The propagation helper was copied;
 * the OR was not. These run the real functions.
 * ═════════════════════════════════════════════════════════════════════════ */
{
  const ctx = vm.createContext({ _monthlyPhones: new Set(['0522578559']) });
  load(WD, ['_isMonthlyClient', '_orderIsMonthly'], ctx);

  check('an order that carries the flag is monthly',
        ctx._orderIsMonthly({ monthlyBilling: true, phone: '0500000000' }), true);
  /* the regression: created after the client was marked, so no flag on it */
  check('an order with no flag is still monthly when the client record says so',
        ctx._orderIsMonthly({ orderClient: 'המקום לאמבט', clientPhone: '0522578559' }), true);
  check('and clientPhone is honoured as well as phone',
        ctx._orderIsMonthly({ phone: '052-257-8559' }), true);
  check('an ordinary client is not monthly',
        ctx._orderIsMonthly({ orderClient: 'לקוח רגיל', clientPhone: '0501234567' }), false);
  check('and a missing order is not monthly', ctx._orderIsMonthly(null), false);
  /* identification is by phone only — a display name must never decide it */
  check('the name alone never makes a client monthly',
        ctx._isMonthlyClient('המקום לאמבט', ''), false);

  /* the cache the fallback reads has to be filled from the user records */
  const loadFn = bodyOf(WD, '_loadDeliveryClients');
  check('the monthly phone cache is built from the user records',
        /_monthlyPhones = new Set\([\s\S]{0,200}?u\.monthlyBilling && u\.phone/.test(loadFn), true);

  /* and the flag is written back onto the order, so it stops depending on the
     cache — exactly what the deliveryClient sync beside it does */
  check('entering a work day denormalises the flag onto the order',
        /_isMonthlyClient\(o\.orderClient, o\.clientPhone \|\| o\.phone\) && !o\.monthlyBilling[\s\S]{0,220}?updateOrder\(_sid, \{ monthlyBilling: true \}\)/.test(WD), true);
}

/* ── the question that stops being asked ───────────────────────────────── */
/*
 * For a שוטף 30 client the finish-delivery dialog does not ask about an
 * invoice — the order goes straight to collected and waits for the monthly
 * run. For everyone else the dialog is untouched, which is the whole point:
 * this is the only existing behaviour the feature changes.
 */
{
  const fn = bodyOf(WD, 'showClientDeliveryPrompt');
  check('the dialog reads the flag through the fallback, not the order alone',
        /if\(_orderIsMonthly\(firstO\)\)\{/.test(fn), true);
  /* relaxed from a literal "finalizeDelivery(id, false));" — the toast-ordering
     fix below wraps the calls in Promise.all(...map...), which changes the
     closing punctuation but not the intent: finalizeDelivery(id, false) runs,
     then the branch returns without ever reaching the dialog. */
  check('a monthly client skips straight to collected',
        /finalizeDelivery\(id, false\)[\s\S]{0,200}?return;/.test(fn), true);
  /* silence would look like nothing happened. The old check matched "שוטף 30"
     anywhere in the function — which the Hebrew comment above the branch
     satisfies — so deleting the toast left it green. It must be inside a
     showToast call. */
  check('and is told what happened, in a toast and not in a comment',
        /showToast\([^;\n]*שוטף 30/.test(fn), true);
  /* the ordinary path must survive untouched */
  check('everyone else still gets the choice',
        /_cldInv'\)\.onclick/.test(fn), true);
  check('and can still issue from there',
        /_deliveryInvoice\(orderIds\)/.test(fn), true);

  /* finalizeDelivery is async and shows its own toast after its Firebase
     write resolves. showToast only sets textContent — there is no queue —
     so a monthly toast fired synchronously right after a bare forEach is
     always overwritten by finalizeDelivery's generic one. */
  {
    const monthlyBranch = (fn.match(/if\(_orderIsMonthly\(firstO\)\)\{[\s\S]*?\n  \}/) || [''])[0];
    check('the monthly branch exists', monthlyBranch.length > 0, true);
    check('it waits for every finalizeDelivery before toasting',
          /Promise\.all\(orderIds\.map\(id => finalizeDelivery\(id, false\)\)\)/.test(monthlyBranch), true);
    check('the toast is in the continuation, not a bare statement after the forEach',
          /\.then\(\(\) => showToast\(/.test(monthlyBranch), true);
    check('and does not fire synchronously right after a bare forEach',
          !/forEach\(id => finalizeDelivery\(id, false\)\);\s*\n\s*showToast\(/.test(monthlyBranch), true);
  }
}

/* ══ the issuing screen — run, not read ════════════════════════════════════
 * A flow, not a browse. It starts empty and you search for one client — the
 * action is "invoice this client", not "survey everyone".
 * ═════════════════════════════════════════════════════════════════════════ */
const BILL = vm.createContext({ orders: [] });
load(ADMIN, ['_billKey', '_billIsBilled', '_billFilterOrders', '_billOrdersFor',
             '_billGroups', '_billSeedSelection', '_billPruneSelection',
             '_billNameFor', '_invBarSuppressed'], BILL);

const ord = (o) => Object.assign({ stage: 'collected', orderNum: 'L1000', orderClient: 'לקוח',
                                   clientPhone: '0500000001', invoice: null }, o);

/* ── what counts as "not yet billed" ───────────────────────────────────── */
{
  BILL.orders = [
    ord({ id: 'a', orderNum: 'L1001' }),
    ord({ id: 'b', orderNum: 'L1002', stage: 'done' }),
    ord({ id: 'c', orderNum: 'L1003', invoice: { sentAt: 1, httpOk: true,  simulated: false } }),
    ord({ id: 'd', orderNum: 'L1004', invoice: { sentAt: 2, httpOk: false, simulated: false } }),
    ord({ id: 'e', orderNum: 'L1005', invoice: { sentAt: 3, httpOk: true,  simulated: true  } }),
  ];
  const ids = BILL._billFilterOrders().map(o => o.id).sort();

  check('an order that was never invoiced is listed', ids.includes('a'), true);
  check('an order that has not been collected is not listed', ids.includes('b'), false);
  check('an invoice Hashavshevet accepted takes the order off the list',
        ids.includes('c'), false);
  /* finding 3. The API writes hashavshevetInvoice onto every order in the batch
     BEFORE it knows whether Hashavshevet accepted — deliberately, so failures
     are recorded too. Defining "billed" as sentAt alone made a rejected batch
     vanish from the only screen that would ever find it, while its stage
     correctly stayed collected. Nobody would bill it, ever. */
  check('but an invoice Hashavshevet REJECTED leaves it billable',
        ids.includes('d'), true);
  /* a simulated run counts as billed: the whole path ran and it was decided on
     purpose that no document would be created. Offering to raise a real
     invoice on a test order is what marking it fictitious exists to prevent. */
  check('a simulated run counts as billed', ids.includes('e'), false);
  check('exactly two orders remain billable', ids, ['a', 'd']);
}

/* ── finding 4: grouping identifies by phone, displays the name ────────── */
{
  /* two genuinely different clients that share a display name. Grouped by
     name they became one bucket, passed the server's single-client check
     (which dedupes the same string) and billed entirely to whichever
     clientPhone happened to come first. */
  BILL.orders = [
    ord({ id: 'a', orderNum: 'L1001', orderClient: 'זכוכית בע"מ', clientPhone: '0500000001' }),
    ord({ id: 'b', orderNum: 'L1002', orderClient: 'זכוכית בע"מ', clientPhone: '0500000002' }),
  ];
  const { groups } = BILL._billGroups(BILL._billFilterOrders(), '');
  check('two clients sharing a display name are two groups', groups.length, 2);
  check('and each group holds only its own order',
        groups.map(g => g.ords.map(o => o.id)).sort(), [['a'], ['b']]);
  check('the group is keyed by the phone', groups.map(g => g.key).sort(),
        ['0500000001', '0500000002']);
  check('and still shows the name', groups[0].name, 'זכוכית בע"מ');
  /* the phone is normalised the same way the server normalises it */
  BILL.orders = [
    ord({ id: 'a', clientPhone: '052-257-8559' }),
    ord({ id: 'b', clientPhone: '052 257 8559' }),
  ];
  check('the same phone written two ways is one client',
        BILL._billGroups(BILL._billFilterOrders(), '').groups.length, 1);
}

/* ── finding 4, the worse half: the nameless bucket ────────────────────── */
{
  /* every collected unbilled order with no client name fell into a single '—'
     bucket, which passed the server's one-client check as a single empty
     string and billed the lot to whichever phone came first — pre-checked,
     behind one button. */
  BILL.orders = [
    ord({ id: 'a', orderClient: '', clientPhone: '', phone: '' }),
    ord({ id: 'b', orderClient: '', clientPhone: '', phone: '' }),
    ord({ id: 'c', orderClient: 'לקוח אמיתי', clientPhone: '0500000009' }),
  ];
  const { groups, noPhone } = BILL._billGroups(BILL._billFilterOrders(), '');
  check('orders with no phone form no group at all', groups.length, 1);
  check('the only group is the real client', groups[0].key, '0500000009');
  check('and the phoneless ones are handed back separately, not as a bucket',
        noPhone.map(o => o.id), ['a', 'b']);
  /* they must not be reachable as a client either */
  check('nor can they be selected by an empty key',
        BILL._billOrdersFor('').map(o => o.id), []);
}

/* ── the search actually filters ───────────────────────────────────────── */
{
  BILL.orders = [
    ord({ id: 'a', orderClient: 'המקום לאמבט', clientPhone: '0500000001' }),
    ord({ id: 'b', orderClient: 'א.מ.מראות',   clientPhone: '0500000002' }),
    ord({ id: 'c', orderClient: 'א.מ.מראות',   clientPhone: '0500000002' }),
  ];
  const all = BILL._billFilterOrders();
  check('with no query every client is listed', BILL._billGroups(all, '').groups.length, 2);
  check('a query narrows it to the matching client',
        BILL._billGroups(all, 'מראות').groups.map(g => g.name), ['א.מ.מראות']);
  check('a query matching nobody lists nobody',
        BILL._billGroups(all, 'זזזז').groups.length, 0);
  check('the phone is searchable too',
        BILL._billGroups(all, '0500000001').groups.map(g => g.name), ['המקום לאמבט']);
  /* busiest client first — that is the one being invoiced at month end */
  check('the client with the most orders comes first',
        BILL._billGroups(all, '').groups[0].name, 'א.מ.מראות');
}

/* ── only clients with something to bill are listed ────────────────────── */
{
  BILL.orders = [
    ord({ id: 'a', orderClient: 'יש מה לחייב', clientPhone: '0500000001' }),
    ord({ id: 'b', orderClient: 'כבר חויב',    clientPhone: '0500000002',
          invoice: { sentAt: 1, httpOk: true } }),
    ord({ id: 'c', orderClient: 'לא נאסף',     clientPhone: '0500000003', stage: 'delivery' }),
  ];
  check('a client whose orders are all billed drops off the list',
        BILL._billGroups(BILL._billFilterOrders(), '').groups.map(g => g.name),
        ['יש מה לחייב']);
}

/* ══ finding 1: the selection must not re-arm itself ═══════════════════════
 * _renderBillClient re-added every order to invSel on every render and drew
 * each box hardcoded `checked`. Since round 1 that function runs on every live
 * order update (renderAll → renderBillBoard, driven by listenAllOrders), so an
 * admin who unchecked three disputed orders had all three silently back in the
 * selection, boxes redrawn checked, the moment a worker on the floor marked a
 * panel.
 *
 * Seeding belongs in _billPick, once. Rendering may only prune.
 * ═════════════════════════════════════════════════════════════════════════ */
{
  const ords = [ord({ id: 'a' }), ord({ id: 'b' }), ord({ id: 'c' })];

  const sel = BILL._billSeedSelection(ords, new Set());
  check('picking a client selects everything it has', Array.from(sel).sort(), ['a','b','c']);

  /* the admin unchecks one, then a live update redraws the screen */
  sel.delete('b');
  BILL._billPruneSelection(ords, sel);
  check('a re-render does not put a deselected order back',
        Array.from(sel).sort(), ['a','c']);
  BILL._billPruneSelection(ords, sel);
  BILL._billPruneSelection(ords, sel);
  check('and still does not, however many updates land',
        Array.from(sel).sort(), ['a','c']);

  /* an order that leaves the billable list must leave the selection too —
     otherwise it would be sent to the API, which would refuse the batch */
  BILL._billPruneSelection([ord({ id: 'a' })], sel);
  check('an order that left the list is dropped from the selection',
        Array.from(sel), ['a']);
}
{
  const det = bodyOf(ADMIN, '_renderBillClient');
  /* the operator ticking a box is the one and only thing allowed to add */
  check('nothing in the render adds to the selection except a box being ticked',
        (det.match(/invSel\.add\([^)]*\)/g) || []), ['invSel.add(cb.dataset.oid)']);
  check('and in particular the whole list is not re-added on every render',
        /ords\.forEach\(o => invSel\.add\(/.test(det), false);
  check('and draws each box from the selection instead of hardcoding checked',
        /invSel\.has\(String\(o\.id\)\) \? ' checked' : ''/.test(det), true);
  check('so no checkbox is emitted with a literal checked attribute',
        /<input type="checkbox" checked/.test(det), false);
  const pick = bodyOf(ADMIN, '_billPick');
  check('seeding happens in _billPick, once',
        /_billSeedSelection\(ords, invSel\)/.test(pick), true);
  check('and it clears first, so a previous client cannot bleed in',
        /invSel\.clear\(\);\s*\n\s*_billSeedSelection/.test(pick), true);
  check('the render prunes', /_billPruneSelection\(ords, invSel\)/.test(det), true);
}

/* ── finding 1, the worst leg: what actually gets sent ─────────────────── */
/*
 * invSend() re-read Array.from(invSel) at send time rather than the ids the
 * preview was built from. A background update landing while the confirm modal
 * was open meant the admin approved a preview for nine orders and twelve were
 * issued, with nothing on screen changing. hashavshevetInvoice.sentAt does not
 * help — none of them had been billed before.
 */
{
  const prev = bodyOf(ADMIN, 'invPreview');
  const send = bodyOf(ADMIN, 'invSend');
  check('the preview records the ids it was built from',
        /_invPreviewIds = ids;/.test(prev), true);
  check('and the send uses exactly those', /const ids = _invPreviewIds\.map\(String\);/.test(send), true);
  check('rather than re-reading the live selection',
        /Array\.from\(invSel\)/.test(send), false);
  check('a send with nothing previewed issues nothing',
        /if\(!ids\.length\)\{ _invRender\(/.test(send), true);
  /* and the rule the whole flow rests on survives: the stage moves only after
     the document succeeded */
  check('the stage still moves only after the invoice succeeds',
        /if\(res\.ok && data\.ok\)\{[\s\S]{0,260}?updateStage\(id, 'collected'\)/.test(send), true);
  check('and only what was sent leaves the selection',
        /ids\.forEach\(function\(id\)\{ invSel\.delete\(String\(id\)\); \}\);/.test(send), true);
}

/* ── the screen's own shape ────────────────────────────────────────────── */
{
  check('there is a screen', /id="billOv"/.test(ADMIN), true);
  check('it starts with no client chosen', /let _billClient = null;/.test(ADMIN), true);
  check('and is reached from the menu', /openBillBoard\(\)/.test(ADMIN), true);

  /* ── you can get back out of it ──────────────────────────────────────
   * The screen trapped the operator. Its close button was there and
   * clickable, but .mcl is coloured rgba(247,244,239,0.45) — near-white at
   * 45% — because every other overlay puts it on the dark .mhdr. billOv is
   * the only one with a light .ov-head, so the X was white on white: present
   * in the DOM, invisible on screen, and failing the 4.5:1 contrast rule.
   *
   * Its two siblings also close on a backdrop click; billOv had neither that
   * nor an Escape handler, so a reload was the only way out.
   */
  check('the close button is recoloured for this screen\'s light header',
        /#billOv\s+\.mcl\s*\{[^}]*color\s*:/.test(ADMIN), true);
  check('and it is a 44px touch target',
        Number(((ADMIN.match(/#billOv\s+\.mcl\s*\{[^}]*\}/) || [''])[0]
                .match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
  check('clicking the backdrop closes it, as on the pricing and pickup screens',
        /id="billOv"[^>]*onclick="if\(event\.target===this\)closeBillBoard\(\)"/.test(ADMIN), true);
  check('Escape closes it too', /function _billEscape/.test(ADMIN), true);
  check('and Escape only acts while the screen is open',
        /function _billEscape[\s\S]{0,300}?classList\.contains\('open'\)/.test(ADMIN), true);

  const list = bodyOf(ADMIN, '_renderBillClients');
  check('the phoneless orders are shown as a warning, never as a button',
        /bill-nophone/.test(list) && !/data-billkey="' \+ lgEsc\(''\)/.test(list), true);
  /* a value from the data must not be assembled into an inline onclick — the
     codebase already avoids this, see the data-ids buttons in workday.html */
  check('the client key travels in a data attribute',
        /data-billkey="' \+ lgEsc\(g\.key\)/.test(list), true);
  check('and the button is wired from JS, not from an inline handler',
        /querySelectorAll\('button\[data-billkey\]'\)[\s\S]{0,120}?_billPick\(btn\.dataset\.billkey\)/.test(list), true);

  const det = bodyOf(ADMIN, '_renderBillClient');
  check('the sketch carries an id and no src',
        /data-sketch-for="' \+ lgEsc\(String\(o\.id\)\)/.test(det), true);
  /* "no src" is the point of the pattern — a collapsed row must cost no image
     bytes — so check its absence directly rather than only asserting the id */
  check('and the <img> tag itself has no src attribute',
        !/<img[^>]*\ssrc=/.test(det), true);
  check('and is filled only when a row is opened',
        /if\(d\.open\) _hydrateBillSketches\(d\)/.test(det), true);

  /* reuse, not a second copy of the money path. Scoped to this function:
     invPreview() appears twice in admin.html and the other is the kanban
     bar's own button, so the unscoped check passed with the whole billing
     screen deleted. */
  check('issuing goes through the existing preview',
        /onclick="invPreview\(\)"/.test(det), true);
  check('and the screen has no invoice call of its own',
        /hashavshevet-invoice/.test(det), false);

  /* the running total has to be announced, not only drawn */
  check('the total is announced to a screen reader',
        /id="billTotal" aria-live="polite"/.test(det), true);
  /* colour alone must not carry meaning */
  check('a selected row says so in words, not only in colour',
        /נבחרו \$\{/.test(bodyOf(ADMIN, '_billUpdateTotal')), true);
}

/* ══ finding 5 + review round 1: what stacks over what ═════════════════════
 * Every overlay that can be on screen at the same time as the billing panel,
 * pinned as an ordering rather than to any literal number.
 *
 * The round-1 check covered billOv < _invOverlay only. It never considered
 * invBar — the kanban's fixed bottom bar, z-index 400, which draws itself
 * whenever invSel is non-empty. The billing screen fills invSel, so the first
 * live update after picking a client painted that bar across the billing
 * panel, offering a second "הפק חשבונית" and a "נקה בחירה".
 * ═════════════════════════════════════════════════════════════════════════ */
{
  const z = {
    billOv:  Number((ADMIN.match(/#billOv\{[^}]*z-index:(\d+)/) || [])[1]),
    invBar:  Number((bodyOf(ADMIN, 'renderInvBar').match(/z-index:(\d+)/) || [])[1]),
    invOv:   Number((bodyOf(ADMIN, '_invOverlay').match(/z-index:(\d+)/) || [])[1]),
    sketch:  Number((bodyOf(ADMIN, 'previewSketchSrc').match(/z-index:(\d+)/) || [])[1]),
    toast:   Number((bodyOf(ADMIN, 'showToast').match(/z-index:(\d+)/) || [])[1]),
  };
  for (const k of Object.keys(z)) check('the ' + k + ' z-index is found', Number.isFinite(z[k]), true);

  /* the invoice modal opens over the billing screen once "הפק חשבונית" is
     pressed; if billOv ever climbed to or past it, the button that issues the
     invoice would be invisible and unclickable */
  check('the billing overlay sits below the invoice modal', z.billOv < z.invOv, true);
  /* a sketch is previewed full-screen from a billing row */
  check('a full-screen sketch sits above both', z.sketch > z.invOv, true);
  /* the toast reports the result of the modal that is still open */
  check('the toast sits above everything', z.toast > z.sketch, true);
  /* and the reason invBar has to be suppressed rather than reordered */
  check('the kanban invoice bar would otherwise cover the billing panel',
        z.invBar > z.billOv, true);
}
{
  /* so it is not drawn at all while the billing screen is open */
  const doc = open => ({
    getElementById: id => id === 'billOv'
      ? { classList: { contains: c => c === 'open' && open } } : null,
  });
  BILL.document = doc(true);
  check('the bar is suppressed while the billing screen is open',
        BILL._invBarSuppressed(), true);
  BILL.document = doc(false);
  check('and drawn normally once it is closed', BILL._invBarSuppressed(), false);
  BILL.document = { getElementById: () => null };
  check('and a page with no billing screen at all is survivable',
        BILL._invBarSuppressed(), false);

  const bar = bodyOf(ADMIN, 'renderInvBar');
  check('renderInvBar consults it before drawing',
        /if\(!invSel\.size \|\| _invBarSuppressed\(\)\)\{ if\(bar\) bar\.remove\(\); return; \}/.test(bar), true);
  /* and an already-drawn bar is taken down the moment the screen opens */
  check('opening the billing screen removes a bar left on screen',
        /classList\.add\('open'\);\s*\n\s*renderInvBar\(\);/.test(bodyOf(ADMIN, 'openBillBoard')), true);
}

/* ── the screen refreshes while it is open ─────────────────────────────── */
{
  /* invSend() drops the sent ids from invSel and calls renderAll() on success;
     without this, the rows would still show the just-invoiced orders, checked,
     after they have already dropped out of _billFilterOrders */
  const ra = bodyOf(ADMIN, 'renderAll');
  check('renderAll refreshes the billing screen while it is open',
        /billOv'\)\?\.classList\.contains\('open'\)[\s\S]{0,40}renderBillBoard\(\)/.test(ra), true);

  /* the touch target is the whole row, not the bare 20x20 box — same shape
     as the kanban card's pickBox: a <label> wrapping the input, so the
     browser's native label-click toggles the checkbox */
  const det = bodyOf(ADMIN, '_renderBillClient');
  check('the checkbox sits in a label, not a bare box',
        /<label class="bill-check">/.test(det), true);
}

/* ── the search box keeps the caret through a live update ──────────────── */
/*
 * renderAll() reaches _renderBillClients on every live-order update, not only
 * on typing. _renderBillClients rebuilds #billSearch with innerHTML, so an
 * admin typing a client name while the shop is busy elsewhere gets the caret
 * pulled out from under them unless focus and the caret position are captured
 * before the rebuild and restored after.
 *
 * A bare search for ".focus()" would pass on the broken code too — the old
 * oninput handler already called it. These require the capture (activeElement
 * compared against the pre-rebuild input, both selection bounds read) and the
 * restore (focus and setSelectionRange together, gated on hadFocus).
 */
{
  const rbc = bodyOf(ADMIN, '_renderBillClients');
  check('focus is captured against the pre-rebuild input, before innerHTML runs',
        /document\.activeElement === prevInp/.test(rbc), true);
  check('and the caret bounds are captured too, not only whether it had focus',
        /selectionStart/.test(rbc) && /selectionEnd/.test(rbc), true);
  check('both focus and the caret are restored together, only if it had focus',
        /if\(hadFocus\)\{[\s\S]{0,80}inp\.focus\(\)[\s\S]{0,80}inp\.setSelectionRange\(selStart, selEnd\)/.test(rbc), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll monthly-billing checks passed.');
