# WhatsApp Sender Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private WhatsApp number is authorised by linking it to a Hashavshevet card in the admin "קליטות" panel. Once linked it works end to end (intake and outgoing messages), with no Vercel env edits.

**Architecture:** This mirrors the existing group link. `waGroups` / `waMeta/groupsSeen` get siblings `waSenders` / `waMeta/sendersSeen`. Inbound: a sender is allowed if it is on the env list OR linked. Outbound: `resolveRecipient` returns `linked:true` for a linked group or linked sender chat, and `lgGreenApiGate` accepts `ctx.linked` as an alternative to the env account list. All the environment locks stay as they are. Admin writes go through the existing `/api/wa-inbound-drain` (no new function: the Hobby limit is 12).

**Tech Stack:** Vanilla JS, Vercel Node CommonJS, Firebase RTDB Admin, `scripts/_fake-db.js` (it already calls transactions with null first).

**Spec:** `docs/superpowers/specs/2026-10-26-wa-link-senders-design.md`

## Global Constraints
- No new `api/*.js` route file. Source function count stays ≤ 12.
- Env lists (`GREENAPI_INBOUND_ALLOWED`, `GREENAPI_ALLOWED_ACCOUNTS`) keep working unchanged. A link is an additional way in, never a replacement.
- `lgGreenApiEnvReady` (provider, credentials, project-signed account list) still has to pass before a link counts. `GREENAPI_ONLY_TO` still overrides everything.
- An unknown sender stores only `{phone, count, lastAt}`. No message content, no image, no caption.
- Only `/api/wa-inbound-drain` (admin-verified) writes `waSenders` and the `ignored`/`unlinked` marks. The browser only reads.
- Every RTDB transaction must handle a null first call (return a value, never `undefined` on null).
- UI copy: plain Hebrew; touch targets 44px; follows the group card pattern.

## Review Focus
- **Phone formats:** `97237436564@c.us`, `037436564` and `03-7436564` all map to the same key `037436564`. Task 1 tests a landline and a mobile in both forms.
- **A customer on the old env list who is never linked still works the old way** for intake, routing and gate. Tasks 1 and 2 each test this.
- **TEST: a linked real customer is still blocked** by `GREENAPI_ONLY_TO`, and also by a list signed for a different project. Task 2 tests this.
- **An explicit link beats a portal user or card match on the same phone** that points to a different customer. Task 1 tests this.
- **An ignored number** keeps counting but is hidden by default, is never auto-linked and is not allowed in. Tasks 3 and 4 test this.

---

### Task 1: Inbound — linked sender is allowed, unknown sender is recorded

**Files:**
- Modify: `api/_wa-recipient.js` (new key helper and link lookup; `lgClientFromWaSender` checks the link first)
- Modify: `api/wa-inbound.js` (private-sender gate, around line 68)
- Modify: `api/_wa-inbound.js` (around line 266: set `order.waChat`)
- Test: `scripts/test-wa-senders.js` (new)

**Interfaces:**
- Produces:
  - `lgWaSenderKey(phoneOrChatId) -> string`. Digits of the local form (`waChatToLocal` for `…@c.us`, otherwise strip non-digits, `972…` → `0…`); `''` if empty.
  - `async lgWaSenderLink(db, phone) -> null | {customerId, customerName, phone}`. Reads `waSenders/<key>`.
  - DB `waSenders/<key>` = `{phone, customerId, customerName, linkedAt, linkedBy, audit:{<t>_link|<t>_unlink:{at,by,action,customerId,from}}}`
  - DB `waMeta/sendersSeen/<key>` = `{phone, count, lastAt, ignored?:{at,by}, unlinked?:{at,by,customerId}}`
  - Private orders from a linked sender get `order.waChat = <local phone>`. They also get `customerId`, `orderClient`, `clientPhone` from the link (portal login phone of that customer if one exists, else the card phone, else the sender).
  - `lgClientFromWaSender` returns `via:'link'` when linked.

- [ ] **Step 1: Write the failing tests** in `scripts/test-wa-senders.js`, using `fakeDb` and `handleInbound` with env `GREENAPI_INBOUND_ALLOWED='luz-glass-test:0505887576'` plus the token/instance env used in `scripts/test-wa-inbound.js`:
  - `key: landline and mobile forms` → `lgWaSenderKey('97237436564@c.us') === '037436564'`, `lgWaSenderKey('03-7436564') === '037436564'`, `lgWaSenderKey('972501234567') === '0501234567'`.
  - `unknown sender: ignored, recorded, no waInbound` → status 200, `body.ignored === 'sender'`, `waMeta/sendersSeen/037436564` equals `{phone:'037436564', count:1, lastAt:<now>}`, and `waInbound` is empty. A second message → `count:2`.
  - `unknown sender: no content stored` → the sendersSeen record's keys are exactly `['count','lastAt','phone']`.
  - `linked sender: recorded and processed` → `waSenders/037436564={customerId:'3150',customerName:'אגן ברזל',phone:'037436564'}`. Image message → `recorded:true`. After `lgWaInboundProcess` the order has `customerId:'3150'`, `waChat:'037436564'`, and no `waUnassigned`.
  - `env-listed sender unchanged` → 0505887576 is still recorded, and its order has no `waChat`.
  - `link beats portal user` → `users/037436564={customerId:'999'}` and the link to 3150 → `lgClientFromWaSender(...).customerId === '3150'`, `via === 'link'`.
  - `ignored sender stays out` → sendersSeen has `ignored`, there is no link, the message is ignored and `count` still increments.
- [ ] **Step 2: Run** `node scripts/test-wa-senders.js`. Expected: FAIL (`lgWaSenderKey is not a function`).
- [ ] **Step 3: Implement** the helpers in `_wa-recipient.js` and export them. In `wa-inbound.js`, the private branch is allowed if `lgWaInboundAllowed(sender).allowed || await lgWaSenderLink(db, sender)`. Otherwise transaction `waMeta/sendersSeen/<key>` (`cur => ({...(cur||{}), phone, count:((cur&&cur.count)||0)+1, lastAt})`) and return `{ignored:'sender'}`. If the lookup throws, return 500, same as the group lookup. In `_wa-inbound.js` set `order.waChat` when `who.via === 'link'`.
- [ ] **Step 4: Run** `node scripts/test-wa-senders.js && node scripts/test-wa-inbound.js && node scripts/test-wa-groups.js && node scripts/test-wa-text-inbound.js`. Expected: all pass.
- [ ] **Step 5: Commit** `wa-senders: מספר פרטי מקושר נקלט; מספר לא מוכר נרשם בקליטות בלי תוכן`

### Task 2: Outbound — replies go back to the linked chat and the link opens the gate

**Files:**
- Modify: `api/_wa-recipient.js` (`resolveRecipient`)
- Modify: `api/_env.js` (`lgGreenApiGate`)
- Modify: `api/whatsapp-dispatch.js:155`, `api/whatsapp-drain.js:186` (pass `linked`)
- Test: `scripts/test-wa-senders.js` (extend)

**Interfaces:**
- Consumes: `lgWaSenderLink`, `order.waChat` (Task 1).
- Produces:
  - `resolveRecipient(db, order, kind) -> {phone, source, accountKey, linked}`.
    - Linked group: `linked:true`.
    - `order.waChat` with a link whose `customerId === String(order.customerId)`: `{phone: order.waChat, source:'wa-sender', accountKey: customerId, linked:true}`.
    - `order.waChat` with no link or a different link: fall back to `resolvePhone` with `linked:false`.
    - Everything else: as today, with `linked:false`.
  - `lgGreenApiGate(ctx)`: after env-ready and a non-empty key, a key not in `env.keys` is still allowed when `ctx.linked === true`. `GREENAPI_ONLY_TO` is checked after that, unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `reply to linked sender` → an order `{customerId:'3150', waChat:'037436564'}` with a link → `{phone:'037436564', source:'wa-sender', accountKey:'3150', linked:true}`.
  - `unlinked sender falls back` → no link → `source` comes from `resolvePhone` and `linked:false`.
  - `gate: linked key not in env list allowed` → env `GREENAPI_ALLOWED_ACCOUNTS='<pid>:14201'`, `{accountKey:'3150', phone:'037436564', linked:true}` → allowed. The same input without `linked` → refused with the reason `הלקוח 3150 אינו ברשימת המורשים לשליחה`.
  - `gate: ONLY_TO still wins` → `GREENAPI_ONLY_TO='0500000000'`, linked → refused.
  - `gate: list signed for another project` → `'lussglass:14201'` in a TEST project, linked → refused.
  - `env-listed portal order unchanged` → an order with no waChat or waGroup, customer 14201 → same result as `resolvePhone`, `linked:false`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `linked: !!target.linked` in both `provider.gate(...)` calls. `whatsapp-send.js` keeps using `resolvePhone` (manual send, unchanged).
- [ ] **Step 4: Run** `node scripts/test-wa-senders.js && node scripts/test-whatsapp-provider.js && node scripts/test-whatsapp-send.js && node scripts/test-wa-groups.js && node scripts/test-env-isolation.js`. Expected: all pass.
- [ ] **Step 5: Commit** `wa-senders: הודעות להזמנה ממספר מקושר חוזרות אליו; קישור פותח את השער (נעילות הסביבה נשארות)`

### Task 3: Admin actions — link, unlink, ignore, unignore a sender

**Files:**
- Modify: `api/wa-inbound-drain.js` (next to `link-group`, around line 100)
- Modify: `database.rules.json` (add `waSenders`, same rule as `waGroups`)
- Test: `scripts/test-wa-senders.js` (extend)

**Interfaces:**
- Produces: POST `/api/wa-inbound-drain` `{channel:'whatsapp', action:'link-sender'|'unlink-sender'|'ignore-sender'|'unignore-sender', key, customerId?}` → `{ok, code, message}`. Codes:
  - `unknown-sender`: the key is not in sendersSeen.
  - `unknown-customer`
  - `not-linked`

- [ ] **Step 1: Write the failing tests** (call the same exported core that the `link-group` tests in `scripts/test-wa-groups.js` call):
  - `link-sender writes waSenders with audit` → `customerName` comes from `hashavshevetAccounts/3150.name`, and `ignored` is cleared.
  - `link-sender refuses unseen key` → code `unknown-sender`.
  - `link-sender refuses unknown card` → code `unknown-customer`.
  - `relink keeps audit history` → two links to different cards leave 2 audit entries, the latest customerId wins.
  - `unlink-sender` → `waSenders/<key>` is removed, and `sendersSeen/<key>/unlinked.customerId` is the old card.
  - `ignore/unignore` → sets or clears `sendersSeen/<key>/ignored = {at,by}`. Refused while the key is linked: code `linked`, message `המספר מקושר — נתק קודם`.
  - `rules: waSenders admin-read only` → read `database.rules.json` and assert that `waSenders['.read']` equals `waGroups['.read']` and that `.write === false`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror `link-group`. The link transaction returns an object even when `cur` is null.
- [ ] **Step 4: Run** `node scripts/test-wa-senders.js && node scripts/test-wa-groups.js`. Expected: PASS.
- [ ] **Step 5: Commit** `wa-senders: קישור / ניתוק / התעלמות ממספר פרטי — endpoint אדמיני וחוקים`

### Task 4: Panel — "מספרים פרטיים" box in קליטות

**Files:**
- Modify: `wa-inbound-panel.js` (next to `renderGroups`; reuse `accountMatches`/`renderAccList`)
- Test: `scripts/test-wa-inbound-panel.js` (extend)

**Interfaces:**
- Consumes: Task 3 actions; RTDB `waMeta/sendersSeen`, `waSenders` (admin read).
- Produces: a box `#waInSenders` above `#waInList`, titled `מספרים פרטיים`. Each row shows:
  - A chip: `מקושר` or `מספר חדש`.
  - The number, formatted, `dir="ltr"`.
  - The time of the last message.
  - Unlinked: `N הודעות נשלחו מהמספר ולא נקלטו. קשר אותו ללקוח, וההודעות הבאות ייכנסו לתור.` + customer picker + `קשר ללקוח` + `התעלם`.
  - Linked: `לקוח: <b>name</b> — כל הודעה ממנו נכנסת לתור, וההודעות על ההזמנות חוזרות אליו.` + `נתק`.
  - Ignored rows are hidden unless "הצג הכל" is on; there they show `מוסתר` + `בטל התעלמות`.
  - The badge's attention count includes unlinked senders that are not ignored.

- [ ] **Step 1: Write the failing tests** (the vm harness already used in `test-wa-inbound-panel.js`):
  - `senders box renders new number with link button`.
  - `linked number shows customer and נתק`.
  - `ignored number hidden by default, shown with showAll`.
  - `badge counts unlinked non-ignored senders`.
  - `link click posts link-sender with chosen acc key`.
  - `typing in picker survives live refresh` (same guard as groups).
- [ ] **Step 2: Run** `node scripts/test-wa-inbound-panel.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add listeners on `waMeta/sendersSeen` and `waSenders` next to the group listeners (line ~433). Use `confirm('לנתק את המספר? הודעות חדשות ממנו לא ייכנסו לתור.')` for unlink.
- [ ] **Step 4: Run** `node scripts/test-wa-inbound-panel.js`. Expected: PASS. Then open admin.html in the fake-Firebase harness (`scratchpad/fake-firebase.js`, see the mobile UI audit memory) at 393px width and check that the box renders without horizontal scroll. Screenshot.
- [ ] **Step 5: Commit** `wa-senders: קליטות — תיבת מספרים פרטיים עם קישור/ניתוק/התעלם`

### Task 5: Ship to TEST, then production on Ben's OK

- [ ] **Step 1:** Run every `scripts/test-*.js`. The only accepted failures are ones that also fail on `origin/main` (the playwright-only scripts). List them.
- [ ] **Step 2:** Run `LG_TEST_DB=… node scripts/deploy-rules-test.js --check`, then deploy the rules to TEST. Merge the branch into `test` and push. Wait for the Vercel status to be success.
- [ ] **Step 3: Live TEST check.** Send a WhatsApp message from a number not on the TEST list. The number should appear in TEST קליטות. Link it. The next message should create an order. Confirm that an outgoing message to it is blocked by `GREENAPI_ONLY_TO` unless that number is the TEST one.
- [ ] **Step 4:** Show Ben the current production `waGroups` links (a read the user approves) and the prod rules diff. On his explicit OK:
  - Deploy the rules to production.
  - Open a PR to main. Ben merges it.
- [ ] **Step 5:** Ben links Agan Barzel (3150) and כתר מקלחונים (1333) from production קליטות. Update the `whatsapp-notifications-live` memory.
