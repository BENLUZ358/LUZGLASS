# Manual Order With Notify Phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ben opens an order by hand from the sketch queue (sketch + Hashavshevet card incl. 99 + private name + phone). Only "ready" and the invoice original go to that phone. Per order, the original can be printed instead of sent.

**Architecture:** The order is a normal `orders/<id>` record with `source:'manual'`. The trusted phone and the send/print choice live server-side in `waMeta/manualOrders/<orderId>`. Only a new admin action in `api/wa-inbound-drain.js` writes there, so no rules deploy is needed. The recipient resolver, the Hashavshevet order, invoice delivery and the invoice watcher each branch on `source==='manual'` plus that record.

**Tech Stack:** Static HTML/JS + Firebase RTDB (browser), Vercel Node functions (`api/`), local Node tool `tools/invoice-watcher`. Tests: plain Node scripts `scripts/test-*.js`, `vm` for browser files.

**Spec:** `docs/superpowers/specs/2026-11-13-manual-order-phone-design.md`

## Global Constraints

- `source: 'manual'` marks these orders. Trusted record: `waMeta/manualOrders/<orderId> = { phone, original: 'send'|'paper', customerId, privateName, at, by }`.
- The phone must be an Israeli mobile, normalized local: `/^05\d{8}$/` after stripping non-digits and a leading `972` → `0`.
- Default `original` is `'send'`.
- Allowed WhatsApp kinds for a manual order: `ready` and `invoice` only. Any other kind gets an empty phone and source `'manual-kind-blocked'`.
- Never fall back to the card phone (`resolvePhone`) for a manual order. If there is no record → phone `''`, source `'manual-missing'`.
- `waMeta/invoiceToPrivate` never applies to a manual order. The "arrives tomorrow" line is never added to a manual order's invoice.
- `order.phone` / `clientPhone` stay **empty** on manual orders.
- Card 99: the private name is required. It goes into `orderClient`/`client` and `privateName`. `priceClient` = card name. Hashavshevet `itemname` gets the private name. When the 50-char `LG_LINE_TEXT_MAX` bites, trim the sketch name, never the private name.
- `isTest` manual orders send nothing (existing skips stay).
- All user-facing text is in plain Hebrew.

## Review Focus

1. **A manual order whose waMeta write failed** (network) must show red in the queue with a retry, and must never send to anyone. → Task 6 test `sqManualStatus` returns `'missing'`; Task 2 test "no record → phone ''".
2. **Two card-99 customers with the same name and different phones** marked ready together. They must not be merged into one message. → Task 6: workday grouping key includes the manual phone (test on `wdReadyGroupKey`).
3. **An invoice covering a manual order plus a WhatsApp group order of the same card.** The manual choice governs. → Task 4 test.
4. **A watcher still on the old version** gets `printOriginal:true`. The old watcher ignores it, and the original is neither sent nor printed. → Task 5 adds the watcher change. The release note in Task 7 says server and watcher ship together.
5. **A manual order's phone also belongs to an existing portal user.** Nothing routes through `users/`. → Task 3 test: the account key comes from `order.customerId`, not from a user, and `order.phone` is empty.

---

### Task 1: Server record + admin action

**Files:**
- Create: `api/_manual-order.js`
- Modify: `api/wa-inbound-drain.js` (new action block before the final `bad-action` return, ~line 492)
- Test: `scripts/test-manual-order.js` (new; this test file grows across Tasks 1–4)

**Interfaces:**
- Produces (`api/_manual-order.js`):
  - `lgManualPhone(raw: string) -> string` (normalized `05XXXXXXXX` or `''`)
  - `async lgManualOrderRec(db, orderId: string) -> {phone, original, customerId, privateName} | null`. Returns null for a bad id, a missing record or a record without a phone.
  - `LG_MANUAL_KINDS = ['ready','invoice']`
- Produces (admin action, POST `/api/wa-inbound-drain`): `{action:'manual-order-set', orderId, phone, original, privateName?}` → `{ok, code, message}`.
  - Codes: `bad-order` (missing, or `source!=='manual'`), `bad-phone`, `bad-original`, `unknown-customer` (`order.customerId` not in `hashavshevetAccounts`), `need-name` (customerId `'99'` and empty privateName).
  - Writes the record with `customerId` copied from the order, `at`, `by`.

- [ ] **Step 1: Write failing tests** in `scripts/test-manual-order.js`. Use a minimal in-memory db (copy the `ref().once/set/transaction` fake pattern from `scripts/test-invoice-deliver.js`). Call `require('../api/wa-inbound-drain').handleAdmin(body, {db, by:'0500000000', now:1})`. Asserts:
  - `lgManualPhone('054-800-0775') === '0548000775'`, `lgManualPhone('+972548000775') === '0548000775'`, `lgManualPhone('03-1234567') === ''`
  - set on a manual order with key `'99'`, privateName `'יוסי כהן'`, original `'send'` → ok. `waMeta/manualOrders/<id>.phone === '0548000775'`.
  - same with privateName `''` → code `need-name`
  - order with `source:'whatsapp'` → `bad-order`; `original:'x'` → `bad-original`; phone `'123'` → `bad-phone`
  - `lgManualOrderRec` returns null for an id with `/` or `.`
- [ ] **Step 2: Run** `node scripts/test-manual-order.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `api/_manual-order.js` and the action block. Validate `orderId` with the same `_keyOk` used by the other actions.
- [ ] **Step 4: Run** `node scripts/test-manual-order.js`. Expected: all ok.
- [ ] **Step 5: Commit** `הזמנה ידנית: רשומת טלפון בצד השרת + פעולת אדמין`

### Task 2: Recipient for manual orders

**Files:**
- Modify: `api/_wa-recipient.js` (`resolveRecipientWa`, ~line 222)
- Test: `scripts/test-manual-order.js`

**Interfaces:**
- Consumes: `lgManualOrderRec`, `LG_MANUAL_KINDS` (Task 1)
- Produces: `resolveRecipientWa(db, order, kind)` for `order.source==='manual'` returns `{phone, source:'manual-phone'|'manual-missing'|'manual-kind-blocked', accountKey: order.customerId, linked: true|false, channel:'whatsapp'}`. It returns before `_resolveWa` and before the invoice-private branch. `linked` is true only for `'manual-phone'`.

- [ ] **Step 1: Failing tests.** Assert:
  - kind `ready` with a record → `{phone:'0548000775', source:'manual-phone', accountKey:'99', linked:true}`
  - kind `invoice` with `waMeta/invoiceToPrivate/99` also set → still the manual phone
  - kind `received` → phone `''`, source `manual-kind-blocked`
  - no record, and the card `99` has a phone in `hashavshevetAccounts` → phone `''`, source `manual-missing`
  - `resolveRecipient` (the outer one) gives the same result
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the branch at the top of `resolveRecipientWa`. Use the record id `order.id`.
- [ ] **Step 4: Run** the new test plus `node scripts/test-ready-net.js`, `node scripts/test-ready-net-server.js`, `node scripts/test-invoice-deliver.js`. Expected: all pass.
- [ ] **Step 5: Commit** `הזמנה ידנית: מוכן וחשבונית לטלפון שבן רשם, שום דבר אחר`

### Task 3: Hashavshevet order for manual orders + price key

**Files:**
- Modify: `api/hashavshevet-order.js`:
  - accountKey block ~331
  - `buildLines` ~164 and itemname ~251
  - export `buildLines` / `pickAccountKey` for tests if not already reachable (`test-pricelists-edit.js` already reaches `buildLines`; reuse its loading method)
- Modify: `firebase-db.js` — the 7 client-price lookups at 1631, 1742, 2888, 2933, 3055, 3056 use the new helper
- Test: `scripts/test-manual-order.js`; rerun `scripts/test-hashavshevet-order.js`, `scripts/test-pricelists-edit.js`

**Interfaces:**
- Produces:
  - `lgPriceClientName(order) -> string` = `order.priceClient || order.orderClient || ''`. It lives in `firebase-db.js` (browser) and has a twin in `api/hashavshevet-order.js` (Node). Add the same "if one changes, change the other" comment as `clientPricesByName`.
  - `async pickAccountKey(db, order) -> string|null`. If `source==='manual'` and `lgManualOrderRec(db, order.id)` is non-null and `hashavshevetAccounts/<order.customerId>` exists → `order.customerId`. Otherwise, today's logic unchanged.
  - `buildLines`: when `order.source==='manual' && order.privateName`, `itemname` = `glass + ' ' + [sketchName] + ' ' + privateName`, trimmed by shortening the sketch name first. It is sent even without a sketchName.

- [ ] **Step 1: Failing tests:**
  - `pickAccountKey` on a manual order with customerId `'99'` and a record → `'99'`, even when `users/0548000775` exists with customerId `'14201'` and `order.phone` is `''`.
  - Without a record → `null` (the existing 422 path).
  - `buildLines` on a manual 99 order with `priceClient:'מזדמן'`, `orderClient:'יוסי כהן'`, `prices.clients['99']` mapped to `'מזדמן'` → line price from the 99 list.
  - `itemname` contains `'יוסי כהן'`, and length ≤ 50 even with a 45-char sketch name.
  - The manual order without a sketchName still gets an itemname.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test, `test-hashavshevet-order.js` and `test-pricelists-edit.js`. Expected: pass.
- [ ] **Step 5: Commit** `הזמנה ידנית: מפתח כרטיס מההזמנה, מחירון לפי כרטיס, שם פרטי בשורה`

### Task 4: Invoice delivery + upload flag

**Files:**
- Modify: `api/_invoice-deliver.js`:
  - `lgInvoiceDeliver` ~203
  - `lgIsDeliveryInvoice` call → false when any order is manual
- Modify: `api/_invoice-upload.js` (~183–190): add `printOriginal` to the 200 body of both the `byOrders` path and the `settled`/reprint path
- Test: `scripts/test-manual-order.js`; rerun `scripts/test-invoice-deliver.js`, `scripts/test-invoice-pdf.js`, `scripts/test-invoice-partial.js`

**Interfaces:**
- Produces:
  - `async lgManualInvoiceMode(db, orders) -> 'send'|'paper'|null`. Null if no manual order. `'paper'` if any manual order's record says paper or the record is missing. Otherwise `'send'`.
  - `lgInvoiceDeliver`:
    - mode `'paper'` → `mark({state:'paper'})`, returns `{state:'paper'}`, nothing queued
    - mode `'send'` → enqueue WhatsApp to `resolveRecipientWa(db, manualOrder, 'invoice')`, with `deliveryTomorrow:false`
    - mode null → today's behavior
  - Upload 200 body: `printOriginal: true` when the mode for the matched orders is `'paper'`.

- [ ] **Step 1: Failing tests:**
  - manual send → `waOutbox` entry `to:'0548000775'`, `kind:'invoice'`, `deliveryTomorrow:false`
  - manual paper → `delivery.state==='paper'`, `waOutbox` empty
  - manual send + a WhatsApp group order of the same card on one invoice → sent only to `0548000775`
  - manual without a record → paper
  - `handleUpload` byOrders path for a paper manual order → body `printOriginal===true`; for a send order → field absent or false
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all four invoice test scripts. Expected: pass.
- [ ] **Step 5: Commit** `הזמנה ידנית: חשבונית — לנייד או מקור על נייר`

### Task 5: Watcher prints the original when told

**Files:**
- Modify: `tools/invoice-watcher/watcher.js` (~285–305, after filing)
- Test: `scripts/test-invoice-pdf.js` (add next to "a matched pair files BOTH…", ~354)

**Interfaces:**
- Consumes: `r.body.printOriginal` (Task 4)
- Produces: on a 200 with `printOriginal:true` and not a reprint, it prints `dest.original` via `cfg.printFn || printWithGs` to `cfg.printCopyTo`, as well as the copy. Use the same failure handling (`notePrint`).

- [ ] **Step 1: Failing test:**
  - With a stub `printFn` recording calls and `printOriginal:true` → two prints, original first.
  - Without the flag → one print (the copy).
  - With the flag and `reprint:true` → zero prints of the original.
- [ ] **Step 2: Run** `node scripts/test-invoice-pdf.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `כלי החשבוניות: מדפיס מקור כשהשרת מבקש (הזמנה ידנית)`

### Task 6: Admin UI — new order button, form, status line; workday grouping

**Files:**
- Create: `sq-new-order.js`. Pure functions on top, DOM below, same layout as `sq-assign.js`.
- Modify: `admin.html`:
  - button in `#sqListPanel` header (~3490)
  - modal markup and CSS
  - status line under `#sqAssignWrap` (~3535)
  - "ידנית" tag in the list item (`buildSQItems` ~3975 and its renderer)
  - `<script src="sq-new-order.js">` next to `sq-assign.js`
- Modify: `workday.html` (~2955 ready grouping) to use `wdReadyGroupKey`
- Test: `scripts/test-sq-new-order.js` (vm, like `scripts/test-sq-assign.js`); browser check with `scripts/_fake-db.js`

**Interfaces:**
- Consumes:
  - `sqAssignSearch` (sq-assign.js)
  - `lgNextOrderNum`, `saveOrder`, `lgSaveSketch` (firebase-db.js)
  - `_lgAuthPost` → `manual-order-set` (Task 1)
  - `lgManualPhone` logic: duplicate the 3-line normalizer in the browser file with a twin comment
- Produces:
  - `sqNewOrderValidate(f) -> {ok, errors: {field: message}}`. `f = {image, sketchName, acc:{key,name}, privateName, phone, original}`. Required: image, acc, phone (valid), privateName when `acc.key==='99'`.
  - `sqNewOrderRecord(f, orderNum) -> object` for `saveOrder`:
    - `{source:'manual', stage:'', orderNum, customerId, orderClient, client, businessName, priceClient: acc.name, privateName, sketchName, manualNotify:{phone, original}, sketch: image}`
    - **no** `phone`
    - `orderClient` = privateName when the key is 99, else `acc.name`
  - `sqManualStatus(order, saved: boolean) -> 'ok'|'missing'`. `saved` = whether the last `manual-order-set` succeeded for that order. The browser cannot read waMeta, so the page keeps a per-order flag `manualNotifySaved` on the order, written after the action returns ok.
  - `wdReadyGroupKey(o) -> string` = `o.orderClient + '|' + (o.source==='manual' && o.manualNotify ? o.manualNotify.phone : '')`
- Flow on save: validate → `lgNextOrderNum` → `saveOrder` → `manual-order-set` → `updateOrder(id,{manualNotifySaved:true})`. On an action failure: keep the order and show a red line "הטלפון לא נשמר — נסה שוב" with a retry button. The same action is used for the edit pencil on the status line "📱 עדכונים ל-05X-XXXXXXX · מקור: לנייד/הדפסה".
- Quick button "מזדמן (99)" selects `hashavshevetAccountsMap['99']`. If the card is missing, show "כרטיס 99 לא נמצא — סנכרן לקוחות".
- Design: consult `ui-ux-pro-max`; colors/fonts from the existing page tokens.

- [ ] **Step 1: Failing tests** in `scripts/test-sq-new-order.js`:
  - validate: missing phone → `errors.phone`; key 99 without name → `errors.privateName`; full valid → ok
  - record: 99 → `orderClient==='יוסי כהן'`, `priceClient===<card name>`, no `phone` key; card 14201 → `orderClient===<card name>`
  - default `original` is `'send'`
  - `wdReadyGroupKey` differs for the same name with different phones, and equals `orderClient+'|'` for a non-manual order
  - a static check that `admin.html` loads `sq-new-order.js` and has `id="sqBtnNewOrder"`
- [ ] **Step 2: Run** `node scripts/test-sq-new-order.js` → FAIL.
- [ ] **Step 3: Implement** the pure functions, then the DOM part, the admin.html markup and the workday grouping.
- [ ] **Step 4: Run** the new test, `node scripts/test-sq-assign.js` and `node scripts/test-sq-mobile.js`. Expected: pass.
- [ ] **Step 5: Browser check.** Fake-db harness: open admin, press "+ הזמנה חדשה", fill card 99 + name + phone, save. Expected: the order appears in the queue with the private name and a "ידנית" tag, plus the status line. Phone width 375px: the modal fits with no horizontal scroll. Screenshot.
- [ ] **Step 6: Commit** `תור סקיצות: הזמנה חדשה ידנית עם טלפון לעדכונים`

### Task 7: Full run + release note

- [ ] **Step 1:** Run every `scripts/test-*.js` touched above, plus `test-chash-flow.js`, `test-wa-inbound-panel.js` and `test-whatsapp-provider.js`. Expected: all pass.
- [ ] **Step 2:** Write the release note for Ben in plain Hebrew:
  - the server and the invoice tool must be updated together
  - the tool is updated in `C:\LuzGlass\invoice-watcher` on DESKTOP-F4LG4AV, then restarted
  - first real check: one card-99 order sent, and one set to print
- [ ] **Step 3:** Commit, then open a PR into `test` (not `main`).
