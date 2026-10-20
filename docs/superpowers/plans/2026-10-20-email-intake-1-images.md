# Email Sketch Intake — Part 1 (images, matching, Gmail script) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An email with image attachments sent to Orderluz@gmail.com becomes one queue order per image, matched to the customer by sender address, with a manual-assign button for unmatched ones.

**Architecture:** A Google Apps Script inside the Orderluz Gmail account posts each new email to a new Vercel route `api/email-inbound.js`, attachments uploaded in ≤3MB chunks then a `commit`. The server mirrors `api/_wa-inbound.js` (create-once record, claim, all-or-nothing multi-path write) but processes **inline** in the commit request — the bytes are already here, so there is nothing to download later, and the script simply retries next minute on a non-final answer. Admin retry/close reuse `api/wa-inbound-drain.js` with a `channel:'email'` field (Vercel Hobby allows 12 functions; 10 are used, this adds 1).

**Tech Stack:** Node (Vercel functions), firebase-admin RTDB, plain browser JS in `admin.html`, Google Apps Script. Tests: `node scripts/test-*.js` with `scripts/_fake-db.js`.

**Spec:** `docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md`

**Out of this plan (own plans later):** Part 2 — PDF → pages (starts with the renderer spike, spec §3.3). Part 3 — replies to the customer (spec §3.5). Until Part 2, a PDF attachment makes the whole email `rejected` with reason `PDF עדיין לא נתמך במייל — לטפל ידנית`, exactly like WhatsApp's `PDF_REASON`.

## Global Constraints

- Only Orderluz@gmail.com. Never Lozzagagot (E1).
- Customer = sender address vs `hashavshevetAccounts/<key>.email`, exactly one match; 0 or >1 → unassigned (E2, E3).
- `sketchName` stays `''` (E6).
- All-or-nothing per email: either every attachment becomes an order or none does (D4).
- No email is deleted or moved; script only adds labels `LG/נקלט` / `LG/נכשל`.
- Script ignores emails received before its `START_AT` setting (no backfill).
- Allowlists are project-signed like `GREENAPI_INBOUND_ALLOWED` (`<project_id>:a,b`); empty/wrong project → nobody.
- Every new order field goes through `lgNormalizeOrder` and the client-create blocklist in `database.rules.json`.
- Logs never contain the token, attachment data, or the request body.
- Work on a feature branch off `test`, merge to `test`; never directly to `main` (see `ENVIRONMENTS.md`).
- UI copy is plain Hebrew.

## Review Focus

1. **Same email posted twice** (script timed out after the server finished) → no second set of orders; commit answers `done` with the same `refNum`. Test in Task 3.
2. **Commit arrives before all chunks** (script crashed mid-upload) → `failed` with reason "חסרים חלקים", not a half order; later full upload succeeds. Test in Task 3.
3. **Sender written as `"Name" <A@B.com>` in mixed case**, card email `a@b.com; other@x.co.il` → matched. Test in Task 2.
4. **Inline signature logo** (`image/png`, content-id, tiny) → never uploaded; the script sends attachments only (`getAttachments({includeInlineImages:false})`). Test: script-side unit in Task 5.
5. **Email with no image and no PDF** (text only, or .docx) → recorded `ignored`, labelled `LG/נקלט`, no order, visible in the panel. Test in Task 3.

---

### Task 1: Email field from Hashavshevet

**Files:**
- Modify: `api/hashavshevet-accounts.js` (mapping ~line 94)
- Modify: `firebase-db.js:2381` (`syncHashavshevetAccount` whitelist)
- Modify: `admin.html:1808` (pass `email`)
- Modify: `scripts/seed-test-data.js` (give 2 TEST cards an email, one with two addresses)
- Test: `scripts/test-hashavshevet-accounts-email.js` (new)

**Interfaces:**
- Produces: `lgPickAccountEmail(row: object) -> string` exported from `api/hashavshevet-accounts.js` (as `module.exports.lgPickAccountEmail`); `hashavshevetAccounts/<key>.email: string` (raw, as in Hashavshevet, may hold several addresses).

- [ ] **Step 1: Write the failing test** — load the module, assert:
  - `lgPickAccountEmail({'דואר אלקטרוני':' a@b.com '})` → `'a@b.com'`
  - `lgPickAccountEmail({'E-mail':'x@y.co.il; z@w.com'})` → `'x@y.co.il; z@w.com'`
  - `lgPickAccountEmail({'טלפון':'050'})` → `''`
  - source of `firebase-db.js` `syncHashavshevetAccount` whitelist contains `'email'` (regex on the array literal).
  - `admin.html` call passes `email: acc.email`.
- [ ] **Step 2:** `node scripts/test-hashavshevet-accounts-email.js` → FAIL.
- [ ] **Step 3:** Implement `lgPickAccountEmail`: first column whose header matches `/דואר|מייל|e-?mail/i` with a non-empty value, trimmed. Add `email: lgPickAccountEmail(r)` to each mapped account. Add `'email'` to the whitelist. Pass it from `admin.html`.
- [ ] **Step 4:** test passes; `node scripts/test-order-normalizer.js` still passes.
- [ ] **Step 5:** Commit. In the commit body note: **Ben must add the email column to the "כרטיסי לקוח" report in WizGround and paste the new `HASHAVSHEVET_REPORT_DATA_ACCOUNTS` into Vercel (production)** — the real column name is unknown until then; the regex covers the likely names.

### Task 2: Matching a sender to a card

**Files:**
- Create: `api/_email-recipient.js`
- Test: `scripts/test-email-recipient.js`

**Interfaces:**
- Produces:
  - `lgEmailAddr(raw: string) -> string` — `'"Dana" <Dana@X.com>'` → `'dana@x.com'`; garbage → `''`.
  - `lgClientFromEmail(db, from: string) -> Promise<{matched, via:'email'|'ambiguous'|'none', email, phone, loginPhone, customerId, name, candidates?}>` — same shape as `lgClientFromWaSender` plus `email`.

- [ ] **Step 1: Write the failing tests** (fakeDb with 3 cards: `K1.email='a@b.com; other@x.co.il'`, `K2.email='dup@x.com'`, `K3.email='DUP@x.com'`, and `users/0501111111 {customerId:'K1', businessName:'אלפא'}`):
  - `lgEmailAddr('"Dana" <Dana@X.com>')` → `'dana@x.com'`
  - `from='Someone <OTHER@x.co.il>'` → `{matched:true, via:'email', customerId:'K1', loginPhone:'0501111111', name:'אלפא'}`
  - `from='dup@x.com'` → `{matched:false, via:'ambiguous', candidates:2}`
  - `from='nobody@z.com'` → `{matched:false, via:'none', email:'nobody@z.com'}`
  - card with no `users` login → `loginPhone:''`, `phone` = card phone (normalized with `norm` from `_wa-recipient.js`), `name` = card name.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. Split card emails on `/[;,\s]+/`, compare `lgEmailAddr` of each. Login lookup: same as `lgClientFromWaGroup` (first `users` entry with that `customerId`). Reuse `norm` from `_wa-recipient.js`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Commit.

### Task 3: The intake core

**Files:**
- Create: `api/_email-inbound.js`
- Modify: `api/_env.js` — add `lgEmailInboundAllowed(addr)`
- Test: `scripts/test-email-inbound.js`

**Interfaces:**
- Consumes: `lgClientFromEmail`, `lgEmailAddr` (Task 2); `sniffImage`, `stripJpegMeta` (`api/_wa-image.js`).
- Produces (all exported from `api/_email-inbound.js`):
  - `EM_INBOX = 'emailInbound'`, `EM_PARTS = 'emailParts'`, `EM_MAX_ATTEMPTS = 3`, `EM_PART_MAX_BYTES = 10*1024*1024`, `EM_PDF_REASON`.
  - `lgEmailInboundKey(messageId) -> string` (same sanitizing as `lgWaInboundKey`).
  - `lgEmailPutChunk(db, {messageId, idx, chunk, chunks, data}) -> Promise<{ok, code?}>` — writes `emailParts/<key>/<idx>/<chunk>` = base64 string; rejects `idx>19`, `chunks>10`, non-base64.
  - `lgEmailCommit(db, meta, opts) -> Promise<{state:'done'|'failed'|'rejected'|'dead'|'ignored', refNum?, orderIds?, reason?}>`, where `meta = {messageId, threadId, from, to, subject, date(ms), parts:[{idx, name, mime, size, chunks}]}` and `opts = {now?, by?}`.
  - `lgEmailInboundRetry(db, key, by, now)`, `lgEmailInboundClose(db, key, by, note, now)` — same contract as the WA versions; retry re-runs from staged parts, so `lgEmailCommit` must **not** delete `emailParts/<key>` unless the final state is `done`, `rejected` or `ignored`.
  - `_env.js`: `lgEmailInboundAllowed(addr) -> {allowed, reason}` reading `EMAIL_INBOUND_ALLOWED` (`<project>:a@b.com,c@d.com`, or `<project>:*` for everyone).

**Commit behaviour (the decisions):**
- Record `emailInbound/<key>` create-once `{messageId, threadId, from, subject, receivedAt, parts:[meta], state:'received', attempts:0, createdAt, updatedAt}`. If it already exists and is final (`done/rejected/ignored/closed/dead`) → return that state unchanged (Review Focus 1).
- Claim exactly like `lgWaInboundClaim` (TTL 2 min, 3 attempts → `dead`); no 24h age rule (the bytes are ours).
- `parts` empty, or no part is image/pdf → `ignored`, reason `אין קובץ סקיצה במייל`.
- Any part `application/pdf` → `rejected` with `EM_PDF_REASON = 'PDF עדיין לא נתמך במייל — לטפל ידנית'` (replaced in Part 2).
- Any other non-image part alongside images → ignore that part; record its name in `skipped:[names]`.
- Missing chunk → transient `failed`, reason `חסרים חלקים מהקובץ` (Review Focus 2).
- Part > `EM_PART_MAX_BYTES` or not a real image by `sniffImage` → `rejected`.
- One `refNum` per email via `meta/orderCounter` (same formula as `_refNum` in `_wa-inbound.js`, stored on the record before writing). Orders `em_<key>_<n>` for n = 1..images, in `idx` order.
- Order fields: as the WA order in `_wa-inbound.js:393-417` but `source:'email'`, `emailMessageId`, `emailThreadId`, `emailFrom` (= `lgEmailAddr(from)`), `emailReceivedAt`, `emailPage:n`, `emailPages:total`, `emailUnassigned:true` when not matched, `sketchName:''`. Unmatched name: `'לא מזוהה · ' + email`. `phone/clientPhone` = `loginPhone || phone || ''`.
- One multi-path update: all orders, all `sketches/em_<key>_<n>` (data URL), record `state:'done', orderIds, refNum, clientMatch, doneAt`, and `emailParts/<key>: null`. `_stillMine` check before it, as in WA.

- [ ] **Step 1: Write the failing tests** (fakeDb; tiny synthetic JPEG/PNG buffers like `test-wa-inbound.js`):
  - two images, matched sender → 2 orders `em_K_1`, `em_K_2`, same `refNum`, `source:'email'`, `emailPages:2`, sketches present, `emailParts/K` gone, record `done`.
  - commit again → `{state:'done'}` and still exactly 2 orders, counter unchanged.
  - commit with chunk 2 of 2 missing → `failed`, zero orders; put the chunk, commit → `done`.
  - PDF + image → `rejected`, zero orders.
  - only `.docx` → `ignored`, zero orders.
  - unknown sender → order has `emailUnassigned:true`, `orderClient:'לא מזוהה · nobody@z.com'`.
  - third failing attempt → `dead`.
  - `lgEmailInboundAllowed`: `luz-glass-test:ben@x.com` with project `luz-glass-test` → allowed for `Ben@X.com`, not for `a@b.com`; `lussglass:*` under `lussglass` → allowed for anyone; `lussglass:*` under `luz-glass-test` → not allowed.
- [ ] **Step 2:** `node scripts/test-email-inbound.js` → FAIL.
- [ ] **Step 3:** Implement. Copy structure from `_wa-inbound.js`; do not import its private helpers by reaching in — move `_stillMine`, `_audit`, `_dropNulls`, `_refNum` into a new `api/_inbox-common.js` taking the inbox path as a parameter, and make `_wa-inbound.js` use it too.
- [ ] **Step 4:** `node scripts/test-email-inbound.js` and `node scripts/test-wa-inbound.js` and `node scripts/test-wa-inbound-panel.js` → all PASS (the refactor must not change WA behaviour).
- [ ] **Step 5:** Commit.

### Task 4: The route, rules and normalizer

**Files:**
- Create: `api/email-inbound.js`
- Create: `api/_hook-token.js` (move `_bare`/`_tokenOk` out of `api/wa-inbound.js`; `lgHookTokenOk(header, secret) -> boolean`)
- Modify: `api/wa-inbound.js` (use `_hook-token.js`)
- Modify: `api/wa-inbound-drain.js` (`channel:'email'` routes `retry`/`close`/`drain` to the email functions)
- Modify: `vercel.json` (`api/email-inbound.js` maxDuration 60)
- Modify: `firebase-db.js` `lgNormalizeOrder` (~line 1012) — add the 7 `email*` fields
- Modify: `database.rules.json` — `emailInbound` and `emailParts`: admin read (`emailParts` no read), `.write:false`, `emailInbound` `.indexOn:["createdAt","state"]`; client-create blocklist gains `emailUnassigned`, `emailMessageId`, `emailThreadId`
- Test: `scripts/test-email-inbound-route.js`; extend `scripts/test-order-normalizer.js` and `scripts/test-rules-order-fields.js`

**Interfaces:**
- Consumes: Task 3 exports, `lgEmailInboundAllowed`.
- Produces: `POST /api/email-inbound`, `Authorization: Bearer <EMAIL_INBOUND_TOKEN>`, body one of:
  - `{op:'part', messageId, idx, chunk, chunks, data}` → `200 {ok:true}`
  - `{op:'commit', ...meta}` → `200 {ok:true, state, refNum?, reason?}`; `200 {ok:true, state:'ignored', reason:'sender'}` when the sender is not allowed (nothing recorded)
  - wrong token → 401; `to` not containing `EMAIL_INBOUND_ADDRESS` → 403; record write error → 500.
- `handleEmailInbound(req, deps)` exported for tests (same pattern as `handleInbound`).

- [ ] **Step 1: Write the failing tests:** 401 on bad token (incl. token with U+200F inside the header still accepted, as WA); 403 on wrong `to`; sender not allowed → `ignored`, no record; part+commit happy path → `done`; normalizer keeps the 7 fields and defaults them (`''`/`0`/`false`); rules test: client create with `emailUnassigned` refused; `ls api | grep -v ^_ | wc -l` ≤ 12 asserted in the route test.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** run all of: `test-email-inbound-route`, `test-email-inbound`, `test-wa-inbound`, `test-order-normalizer`, `test-rules-order-fields`, `test-env-isolation`, `test-csp` → PASS.
- [ ] **Step 5:** Commit. Deploy rules to TEST with `node scripts/deploy-rules-test.js`.

### Task 5: The Gmail script

**Files:**
- Create: `scripts/gmail-intake.gs` (Apps Script source, kept in the repo)
- Create: `scripts/gmail-intake-core.js` (the pure parts, shared verbatim into the `.gs` by a header comment `// ── core start/end ──` so Node can test them)
- Create: `docs/gmail-intake-setup.md` (plain-Hebrew install steps for Ben)
- Test: `scripts/test-gmail-intake-core.js`

**Interfaces:**
- Consumes: the route contract from Task 4.
- Script settings (Apps Script "Script properties"): `ENDPOINT`, `TOKEN`, `START_AT` (ISO), `ALLOWED_SENDERS` (comma list; empty = everyone), `CHUNK_BYTES` (default 3000000).
- Core functions (pure): `emPlanChunks(sizeBytes, chunkBytes) -> number`, `emShouldTake(msg:{id, from, date}, cfg, handled:{[id]:ts}) -> boolean`, `emLabelFor(state) -> 'LG/נקלט'|'LG/נכשל'|null` (`done/ignored/closed`→נקלט, `rejected/dead`→נכשל, `failed/received` → null = retry next run).

- [ ] **Step 1: Write the failing tests** for the core: chunk count for 0, 1, exactly 3000000, 3000001 bytes; `emShouldTake` false when date < START_AT, when id is in `handled`, true for a new message in an already-labelled thread, when ALLOWED_SENDERS set and sender not in it (case-insensitive, `"Name" <a@b>` form); `emLabelFor` table above.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement core, then the `.gs` wrapper: time trigger every 1 minute; `GmailApp.search('in:inbox newer_than:3d')`, walk `thread.getMessages()` (Gmail labels whole threads, and a customer may send new sketches as a reply in an old thread — so "done" is tracked per **message**, not by label). Handled message ids live in Script Properties (`handled` JSON `{id: ts}`, pruned after 4 days); labels are only for people looking at the inbox. Max 10 new messages per run, stop at 4.5 minutes. Per message: `getAttachments({includeInlineImages:false, includeAttachments:true})`, upload chunks (`UrlFetchApp`, `muteHttpExceptions:true`), commit, then on a final state add the id to `handled` and label the thread per `emLabelFor`. A lost `handled` entry is harmless: re-posting returns `done` (server is per message).
- [ ] **Step 4:** core tests PASS. Write `docs/gmail-intake-setup.md`: open script.google.com logged in as Orderluz → paste → set properties → run once → approve → add trigger. Every step one line, no English except button names Google shows.
- [ ] **Step 5:** Commit.

### Task 6: Queue: email badge, failures panel, "שייך ללקוח"

**Files:**
- Modify: `admin.html:3504` — tag `מייל` (`sq-tag-email`) for `source==='email'`
- Modify: `wa-inbound-panel.js` — also listen to `emailInbound`, rows show sender email instead of phone, actions post `channel:'email'`; heading becomes "קליטות WhatsApp ומייל"
- Create: `sq-assign.js` — "שייך ללקוח" for any queue order with `waUnassigned` or `emailUnassigned`
- Modify: `admin.html` — include `sq-assign.js`, button in the sketch view when unassigned
- Test: extend `scripts/test-wa-inbound-panel.js`; create `scripts/test-sq-assign.js`

**Interfaces:**
- Produces: `lgAssignOrderToAccount(orderId: string, acc:{key, name}, loginPhone: string) -> Promise<void>` in `sq-assign.js`: `updateOrder(orderId, {customerId: acc.key, orderClient: acc.name, client: acc.name, businessName: acc.name, waUnassigned:false, emailUnassigned:false, ...(loginPhone ? {phone: loginPhone, clientPhone: loginPhone} : {})})`. Never writes the email onto the card (spec 3.4).
- Pure helper `sqAssignSearch(accounts: object, q: string) -> [{key,name}]` (name or key contains q, max 20, sorted by name).

- [ ] **Step 1: Write the failing tests:** panel row for an `emailInbound` record `rejected` shows the sender address and the reason and posts `{channel:'email', action:'retry', key}`; `sqAssignSearch` finds by part of name and by key; `lgAssignOrderToAccount` writes exactly the fields above (spy on `updateOrder`); tag text `מייל` present for `source:'email'`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. The picker is a search box + list inside the existing sketch modal; 44px buttons like the check-station screen.
- [ ] **Step 4:** tests PASS; run `node scripts/test-admin-ui.js` and `node scripts/test-dom-ids.js` → PASS. Verify in the browser preview against TEST with a seeded `email` order (mobile width too, per [[mobile-ui-audit]] harness).
- [ ] **Step 5:** Commit.

### Task 7: TEST end-to-end with the real mailbox

- [ ] **Step 1:** Vercel TEST env: `EMAIL_INBOUND_TOKEN` (new random), `EMAIL_INBOUND_ADDRESS=orderluz@gmail.com`, `EMAIL_INBOUND_ALLOWED=luz-glass-test:<Ben's addresses>`. Ben gives the addresses.
- [ ] **Step 2:** Merge the branch into `test`; wait for the deploy.
- [ ] **Step 3:** Ben installs the script per `docs/gmail-intake-setup.md` with `ENDPOINT=https://luzglass-test.vercel.app/api/email-inbound`, `ALLOWED_SENDERS` = his addresses, `START_AT` = now.
- [ ] **Step 4:** Ben sends from his address: (a) one photo, (b) three photos, (c) a PDF, (d) text only, (e) the same mail forwarded again. Expected: (a) 1 order, (b) 3 orders same number, (c) red row "PDF עדיין לא נתמך", (d) panel row "אין קובץ סקיצה", (e) nothing new. Each within ~2 minutes; customer emails in the box untouched (no label).
- [ ] **Step 5:** Record results in the spec under a new "§7 תוצאות בדיקה" section and commit.

Production switch is **not** in this plan: it waits for Part 2 (PDF), since most real sketches are PDFs.
