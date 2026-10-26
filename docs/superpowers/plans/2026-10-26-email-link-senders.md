# Email Sender Linking + Email Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email works like WhatsApp. An unknown sender appears in קליטות and is linked to a card from there; after that their sketches are taken in, and the customer gets "הסקיצות טופלו / מוכן לאיסוף / יצא להובלה" as replies in their email thread.

**Architecture:**
- Links and the record of seen senders live under `waMeta`, which is already admin-read and write:false, so no rules change is needed.
- Inbound: `/api/email-inbound` commit admits a sender if they are env-listed OR linked. Otherwise it notes the sender and drops the uploaded parts, which is today's not-allowed path.
- Outbound: `resolveRecipient` returns `{channel:'email', thread, email, linked:true}` for an email order whose sender is still linked to the order's card. `whatsapp-dispatch` splits an all-email batch into one message per thread, refuses mixed channels, and puts each message in `waMeta/emailOutbox`.
- The Gmail Apps Script, which already runs every minute, claims each message through `/api/email-inbound` (`op:'outbox-claim'`), replies in the thread, and confirms (`op:'outbox-done'`). Before confirming it records locally that the message was sent, so a lost confirmation never causes a second send.

**Tech Stack:** Vanilla JS, Vercel Node CommonJS, Firebase RTDB Admin, Google Apps Script, `scripts/_fake-db.js` (transactions called with null first).

**Spec:** `docs/superpowers/specs/2026-10-26-email-link-senders-design.md`

## Global Constraints
- No new `api/*.js` route. No change to `database.rules.json`. New data goes under `waMeta/`.
- Address key: `lgEmailAddr(x)`, then `.` → `,` (the key must be RTDB-safe). Decode with `,` → `.`.
- The env list `EMAIL_INBOUND_ALLOWED` keeps working for intake only. It never authorises outgoing email on its own.
- Email send lock: on project `lussglass` → allowed for linked threads. Any other project → allowed only when `EMAIL_ONLY_TO` (a comma-separated list of addresses) contains the recipient. Unset means TEST sends nothing.
- Message text = `renderText` from `api/_wa-provider.js`, the same wording as WhatsApp.
- The first email from an unlinked sender is NOT kept (no parts, no record). This mirrors WhatsApp.
- Script: the core stays pure in `scripts/gmail-intake-core.js` and is copied byte-for-byte between the core markers in `gmail-intake.gs`. The existing test enforces that.
- Plain Hebrew in the UI and in the install doc. Touch targets 44px.

## Review Focus
- **No email ever goes to an unlinked sender**, or from TEST to a real address (there is no `EMAIL_ONLY_TO` on TEST). Task 3 tests this.
- **A lost "done" confirmation, or two script runs at once, never sends twice.** The lease plus the script's local "sent" mark handle this. Tasks 3 and 4 test this.
- **Ben's current intake (an env-listed address, not linked) is unchanged.** Its orders keep today's WhatsApp notice behaviour. Tasks 1 and 3 test this.
- **A display-name trick** (`"boss@client.com" <evil@x.com>`) keys and links the real address only. Task 1 tests this.
- **A mixed batch** (email + WhatsApp orders, or email orders from different cards) is refused with a reason. Several threads of one linked sender become one message per thread. Task 3 tests this.

---

### Task 1: Inbound — linked email sender admitted, unknown sender noted

**Files:**
- Modify: `api/_email-recipient.js` (add the key and link helpers; `lgClientFromEmail` checks the link first)
- Modify: `api/email-inbound.js` (the commit gate, around line 84)
- Test: `scripts/test-email-senders.js` (new; use the request and env shape of `scripts/test-email-inbound.js`)

**Interfaces:**
- Produces:
  - `lgEmailKey(raw) -> string`: `''` if not an address.
  - `async lgEmailSenderLink(db, raw) -> null | {customerId, customerName, email}`: reads `waMeta/emailSenders/<key>`.
  - DB `waMeta/emailSenders/<key>` = `{email, customerId, customerName, linkedAt, linkedBy, audit}`.
  - DB `waMeta/emailSendersSeen/<key>` = `{email, count, lastAt, ignored?, unlinked?}`.
  - `lgClientFromEmail` returns `via:'link'` when the sender is linked: name from the link, `loginPhone` from the card's portal user.

- [ ] **Step 1: Write the failing tests:**
  - `key`: `lgEmailKey('"Dana" <Dana@Client.co.il>') === 'dana@client,co,il'`. A display-name trick keys the last `<...>` address.
  - `unknown sender noted, parts dropped, nothing recorded`: commit from `x@y.com` returns 200 `state:'not-allowed'`. Then `emailSendersSeen` holds the address with `count:1`, `emailParts` for that key is gone, and `emailInbound` is empty. A second mail gives `count:2`. Only the keys `count`, `email` and `lastAt` are stored.
  - `ignored sender stays out but counts`.
  - `linked sender recorded on the linked card`: the commit is recorded, and after processing the order has `customerId` = the link and `emailUnassigned` undefined.
  - `env-listed sender unchanged`: `EMAIL_INBOUND_ALLOWED` has the address and there is no link. It is recorded as today, and no sendersSeen entry is made.
  - `link beats card-email match`.
- [ ] **Step 2: Run** `node scripts/test-email-senders.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The sendersSeen transaction returns an object on null. Notes are written only when the sender is not linked and not env-listed.
- [ ] **Step 4: Run** `node scripts/test-email-senders.js && node scripts/test-email-inbound.js`. Expected: test-email-senders PASS. test-email-inbound fails on base today (pre-existing); confirm its failure output is unchanged against base.
- [ ] **Step 5: Commit** `email-senders: כתובת מקושרת נקלטת; כתובת זרה נרשמת בקליטות בלי תוכן`

### Task 2: Admin link/unlink/ignore + "כתובות מייל" box

**Files:**
- Modify: `api/wa-inbound-drain.js` (actions for `chName === 'email'`)
- Modify: `wa-inbound-panel.js` (pure `lgWaInEmailRows(seen, linked, showAll)`, `lgWaInEmailHtml(row)`, `lgWaInEmailsAttention(seen, linked)`; box `#waInEmails`; listeners on `waMeta/emailSendersSeen` and `waMeta/emailSenders`; clicks `button[data-eact]` in `[data-ekey]`; the picker selector extended with `[data-ekey]`)
- Modify: `admin.html` (CSS for `#waInEmails`, the same as `#waInSenders`)
- Test: `scripts/test-email-senders.js`, `scripts/test-wa-inbound-panel.js`

**Interfaces:**
- Produces: POST `{channel:'email', action:'link-sender'|'unlink-sender'|'ignore-sender'|'unignore-sender', key, customerId?}`. The behaviour and codes are identical to the WhatsApp versions: `bad-key`, `unknown-sender`, `unknown-customer`, `not-linked`, `linked`. A key is valid if `lgEmailKey(decoded) === key`.

- [ ] **Step 1: Write the failing tests:**
  - The WhatsApp 5a–5h equivalents for email.
  - Panel: rows show the decoded address `dir="ltr"`. A new address offers link and ignore, a linked one shows the customer and unlink, and an ignored one is hidden by default. Names and addresses are escaped. The panel listens to both `waMeta` paths and never writes them.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the copy text from the WhatsApp box with "מייל" in place of "הודעה". Title: `כתובות מייל`.
- [ ] **Step 4: Run** both test files. Expected: PASS. Then check at 375px in the browser harness: link → POST, the row turns `מקושר`, no overflow, 44px buttons.
- [ ] **Step 5: Commit** `email-senders: קליטות — תיבת כתובות מייל (קשר/נתק/התעלם)`

### Task 3: Outbound — email notices queued from dispatch, served to the script

**Files:**
- Create: `api/_email-outbox.js`
- Modify: `api/_wa-recipient.js` (`resolveRecipient`: email branch)
- Modify: `api/_env.js` (`lgEmailSendGate(email)`)
- Modify: `api/whatsapp-dispatch.js` (email split, mixed refusal, enqueue)
- Modify: `api/email-inbound.js` (`op:'outbox-claim'` and `op:'outbox-done'`, routed before the messageId check; same token)
- Test: `scripts/test-email-outbox.js` (new)

**Interfaces:**
- Produces:
  - `resolveRecipient(db, order, kind)`: when `order.source === 'email' && order.emailThreadId && order.emailMessageId` and `lgEmailSenderLink(db, order.emailFrom)` matches `order.customerId` → `{channel:'email', phone:'', email, thread: order.emailThreadId, source:'email-sender', accountKey: customerId, linked:true}`. Otherwise the existing result, plus `channel:'whatsapp'`.
  - `lgEmailSendGate(email) -> {allowed, reason}`, following the Global Constraints rule.
  - `_email-outbox.js`:
    - `lgEmailEnqueue(db, {kind, thread, email, clientName, orderNums, sketchNames, orderIds, queuedBy}) -> {key, queued}`. The key is `sha1(kind|thread|sorted ids)`, create-once. Stored at `waMeta/emailOutbox/<key>` with `state:'pending'`.
    - `lgEmailClaim(db, limit, now) -> [{key, thread, text, leaseToken}]`. Lease 5 min, max 5 items. `text = renderText(...)`.
    - `lgEmailComplete(db, key, leaseToken, ok, now) -> {ok}`. On success: `state:'sent'`, stamp each order `emailNotices/<kind> = {sentAt, key}`. On `ok:false`: up to 3 attempts, then `failed`.
  - dispatch:
    - If all targets have `channel==='email'`: same `accountKey` required (else 409); group by `thread`; gate each email; enqueue one item per thread. Response `{ok, queued, channel:'email', messages:[{thread, orderNums, queued, reason}]}`.
    - Mixed channels → 409 `{error:'בקבוצה יש הזמנות מהמייל ומוואטסאפ — לא נשלחה הודעה'}`.
    - All WhatsApp → unchanged.
    - `dryRun` → preview with the same shape and no enqueue.
  - email-inbound:
    - `{op:'outbox-claim'}` → `{ok, items}`.
    - `{op:'outbox-done', key, leaseToken, ok}` → `{ok}`. A stale lease → `{ok:false, code:'stale'}`, 200.

- [ ] **Step 1: Write the failing tests:**
  - `linked email order → email channel`
  - `unlinked / env-only email order → whatsapp channel as before`
  - `relinked to another card → whatsapp channel`
  - `gate: lussglass allowed; TEST without EMAIL_ONLY_TO refused; TEST with it only for that address`
  - `dispatch: two threads of one sender → 2 queue items, 1 per thread`
  - `dispatch: mixed email+whatsapp → 409`
  - `dispatch: double click → same keys, queued:false the second time`
  - `claim leases, second claim within lease returns nothing`
  - `done stamps orders and marks sent`
  - `stale lease done refused`
  - `expired lease is reclaimable`
  - `outbox ops need the token` (401 without it)
- [ ] **Step 2: Run** `node scripts/test-email-outbox.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Transactions return a value on null.
- [ ] **Step 4: Run** `node scripts/test-email-outbox.js && node scripts/test-whatsapp-provider.js && node scripts/test-wa-groups.js && node scripts/test-wa-senders.js && node scripts/test-whatsapp-send.js`. Expected: PASS. The WhatsApp exact-object asserts may need `channel:'whatsapp'` added: ledger a ruling if so.
- [ ] **Step 5: Commit** `email-notices: הודעות ללקוח מקושר במייל — תור, נעילת סביבה, פיצול לפי שרשרת`

### Task 4: Apps Script sends the queued replies

**Files:**
- Modify: `scripts/gmail-intake-core.js` + `scripts/gmail-intake.gs` (same core block)
- Modify: `docs/gmail-intake-setup.md` (Hebrew: paste the new version, empty `ALLOWED_SENDERS`, how to check it works)
- Test: `scripts/test-gmail-intake-core.js` (extend)

**Interfaces:**
- Produces:
  - core `emOutboxPlan(items, sentMap) -> [{key, thread, text, leaseToken, skipSend:boolean}]`: `skipSend` when `sentMap['s_'+key]` exists, meaning it was already sent and only the ack is missing.
  - runtime `emOutbox(cfg)`, called at the end of `emRun` inside the lock. It does POST claim; for each item: if not `skipSend`, `GmailApp.getThreadById(thread).reply(text)`, then set the script property `s_<key>=now`; then POST done with `ok:true`.
    - A thread that is not found → done with `ok:false`.
    - Prune `s_` properties older than 4 days, like `h_`.
  - `ALLOWED_SENDERS` keeps working when set (empty = everyone). The doc tells Ben to empty it.

- [ ] **Step 1: Write the failing core tests:**
  - `emOutboxPlan` marks an already-sent key `skipSend`.
  - It passes the others through.
  - The core copy in `.gs` equals the core file (the existing check).
- [ ] **Step 2: Run** `node scripts/test-gmail-intake-core.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the core and runtime. Copy the core block into the `.gs` file.
- [ ] **Step 4: Run** `node scripts/test-gmail-intake-core.js`. Expected: PASS.
- [ ] **Step 5: Commit** `gmail-script: שליחת הודעות ללקוח בשרשרת המייל; הוראות התקנה`

### Task 5: Ship
- [ ] Run the full suite. The only accepted failures are the 6 that fail on base today.
- [ ] Final whole-branch review. Then merge into `test`, push, and verify the panel asset on luzglass-test. No rules deploy is needed: assert that `git diff origin/main -- database.rules.json` is empty.
- [ ] Production, with Ben:
  - Ben merges the PR.
  - Ben pastes the new script and empties `ALLOWED_SENDERS` (following the doc).
  - Ben links ONLY his own address, then emails a sketch, marks it handled, and checks that he gets the reply in the thread.
  - Only then does he link real customers.
