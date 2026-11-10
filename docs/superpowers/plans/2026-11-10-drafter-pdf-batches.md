# משלוחים לשרטט (PDF במייל) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ben presses "שלח לשרטט" and every order sitting at the drafter that wasn't sent yet goes out as one PDF email to Lozzagagot@gmail.com; "השרטט סיים" moves every sent order to `opty` ("בנה יום עבודה").

**Architecture:** Server module `api/_drafter-batch.js` owns the basket, batches, PDF and the "done" move. Admin calls it through new actions on the existing `/api/wa-inbound-drain` route (no new Vercel function). The email reuses the existing email outbox + Gmail Apps Script's `sendTo` path (new email + attachments via `outbox-file`) — **no Gmail script change**. A small browser module `drafter-batch.js` draws the bar in admin when the "אצל שרטט" filter is on.

**Tech Stack:** Node (Vercel), firebase-admin RTDB, pdf-lib + @pdf-lib/fontkit + `api/_heebo.ttf` (already used by `_invoice-merge.js`), vanilla JS in `admin.html`.

**Spec:** `docs/superpowers/specs/2026-11-10-drafter-pdf-batches-design.md`

## Global Constraints
- Basket = orders with `stage === 'drafter' || stage === 'chash'` and no `drafterBatch` (same filter as `drafter.html:262`).
- Recipient is a server constant `LG_DRAFTER_EMAIL = 'lozzagagot@gmail.com'` — never taken from the request body.
- "Done" = exactly what `updateStage(id,'opty')` writes: `{ stage:'opty', status:'מחכה ל-OptyWay', updatedAt:t, optyAt:t }`.
- No Firebase rules change. Batches live under `waMeta/drafterBatches` (server-only writes); the order gets `drafterBatch: <n>` written by the server.
- All UI text in plain Hebrew; touch targets ≥ 44px; works at 375px.
- Never send an order twice; never move an order that left the drafter stage (cancelled / moved by hand / deleted).
- Email subject: `הזמנות לשרטוט — משלוח <n> (<count>)`. Body: `משלוח <n> · <date time> · <count> הזמנות` + one line per order `<orderNum> · <client> · <sketchName>`.

## Review Focus
1. Two clicks on "שלח לשרטט" at once (two tabs) → one batch only; the second gets "אין הזמנות בסל".
2. Order deleted/cancelled after being sent, then "השרטט סיים" → listed as skipped "כבר לא אצל שרטט", not recreated.
3. Order whose sketch image is missing/broken → still in the batch, PDF page says "אין סקיצה", email still goes.
4. Basket empty → button disabled-looking with text "הסל ריק", server returns `{ok:false, code:'empty'}`.
5. Very large batch (PDF > 20MB) → split into several attachments in the same email (`files` > 1), each ≤ 20MB.

---

### Task 1: Basket, batch and done — server core

**Files:**
- Create: `api/_drafter-batch.js`
- Test: `scripts/test-drafter-batch.js` (fake RTDB like the other `scripts/test-*.js`, e.g. copy the fake from `scripts/test-email-outbox.js`)

**Interfaces — Produces:**
- `LG_DRAFTER_EMAIL` (string)
- `lgDrafterBasket(db) -> Promise<Array<{id, orderNum, client, sketchName, stage, createdAt}>>` sorted by client then createdAt.
- `lgDrafterSend(db, {by, now}) -> Promise<{ok:true, n, orderIds} | {ok:false, code:'empty'}>` — allocates `n` with a transaction on `waMeta/drafterBatches/_next` (starts at 1), then claims each basket order with a per-order transaction that sets `drafterBatch=n` only if still in the basket; writes `waMeta/drafterBatches/<n> = {at, by, orderIds, count, doneAt:null}`. If zero orders were claimed → delete the batch record, return `empty`. Then calls Task 3's `lgDrafterEnqueueEmail(db, n)`.
- `lgDrafterDone(db, {by, now}) -> Promise<{ok:true, moved:[{id,orderNum,client,n}], skipped:[{id,orderNum,reason}], batches:[n]}>` — every batch with `doneAt == null`: each order: exists && `drafterBatch===n` && stage in drafter/chash → opty patch (Global Constraints); else skipped with reason `'נמחקה'` / `'כבר לא אצל שרטט'`. Then sets `doneAt, doneBy, moved, skipped` on the batch.
- `lgDrafterStatus(db) -> Promise<{basket:[...], open:[{n, at, count, orders:[{id,orderNum,client}]}]}>`

- [ ] **Step 1: failing tests** in `scripts/test-drafter-batch.js`:
  - basket picks `drafter` and `chash`, skips `opty`/`workday`/`''` and orders with `drafterBatch`.
  - send → `n===1`, orders get `drafterBatch:1`, batch record has `count`; second send with empty basket → `{ok:false, code:'empty'}`.
  - two concurrent `lgDrafterSend` → exactly one batch holds each order (Review Focus 1).
  - order added after send → in basket, not in batch 1.
  - done → batch-1 orders get `stage:'opty', status:'מחכה ל-OptyWay', optyAt` ; deleted order → skipped `'נמחקה'`; order moved to `workday` by hand → skipped `'כבר לא אצל שרטט'` and untouched (Review Focus 2); batch `doneAt` set; second done → `moved:[]`.
  - Task 3 enqueue stubbed via `deps`/module injection so this test doesn't need the outbox.
- [ ] **Step 2:** `node scripts/test-drafter-batch.js` → FAIL (module missing).
- [ ] **Step 3:** implement. ⚠️ RTDB transactions run first with `null` — every handler must return a value on `null` (see header comment in `_email-outbox.js`).
- [ ] **Step 4:** test passes.
- [ ] **Step 5:** commit `drafter: סל לשרטט, משלוח ו"השרטט סיים" בשרת (בן, 10/11)`.

### Task 2: The PDF

**Files:**
- Modify: `api/_invoice-merge.js` — export the existing per-sketch page drawing as `lgAddSketchPage(doc, font, img:{mime,buf}, head:{title, info, idx, total})` and make `lgInvoiceMerge` use it (no visual change — `scripts/test-invoice-merge.js` must stay green).
- Modify: `api/_drafter-batch.js` — `lgDrafterPdf(db, n, opts?) -> Promise<{files:[{name, mime:'application/pdf', buf}]}>`
- Test: `scripts/test-drafter-batch.js` (add)

- [ ] **Step 1: failing tests:** PDF for a batch of 2 orders (one JPG, one PNG sketch from `sketches/<id>`) has 3 pages (cover + 2); cover text contains `משלוח 1` and both order numbers; an order with no sketch → still a page with `אין סקיצה` (Review Focus 3); with `opts.maxBytes` tiny → `files.length > 1`, names `משלוח 1 (1 מתוך 2).pdf` etc. (Review Focus 5). Read page count with pdf-lib `PDFDocument.load(buf).getPageCount()`; text check via `api/_pdf-pages.js` if it extracts text, otherwise assert on the page count + names only.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. Cover page: title `משלוח <n>`, line `<date time Israel> · <count> הזמנות`, then the order list. Sketch page header: title = sketch name (or order number), info = `<orderNum> · <client>`. Default `maxBytes = 20*1024*1024`; split by whole sketch pages, cover only in part 1. Sketch source: same as `_invoice-deliver.js` `_sketch(db,id)` (`sketches/<id>` then `orders/<id>/sketch`) — reuse, don't copy (export it).
- [ ] **Step 4:** `node scripts/test-drafter-batch.js && node scripts/test-invoice-merge.js && node scripts/test-invoice-deliver.js` → all PASS.
- [ ] **Step 5:** commit `drafter: קובץ PDF למשלוח — עמוד שער ועמוד לכל סקיצה`.

### Task 3: Email through the existing outbox

**Files:**
- Modify: `api/_email-outbox.js` (enqueue fields, claim, `lgEmailOutboxFile`)
- Modify: `api/_wa-provider.js` `renderText` — kind `'drafter-batch'`
- Modify: `api/_drafter-batch.js` — `lgDrafterEnqueueEmail(db, n)`
- Test: `scripts/test-email-outbox.js` (add cases), `scripts/test-whatsapp-provider.js` (text)

**Interfaces — Consumes:** `lgDrafterPdf` (Task 2). **Produces:** `lgDrafterEnqueueEmail(db, n) -> {key, queued}`.

Claim item for this kind must pass the Gmail script's own filter (`scripts/gmail-intake.gs:121-127` requires non-empty `thread`, `messageId`, `email`, `text`): use `thread:'drafter'`, `messageId:'drafter-<n>'`, `email: LG_DRAFTER_EMAIL`, `sendTo: LG_DRAFTER_EMAIL`, `subject`, `files: <part count>`. The script then takes its `it.sendTo` branch (`gmail-intake.gs:378`) — new email with attachments.

- [ ] **Step 1: failing tests:**
  - enqueue kind `'drafter-batch'` with `keySuffix:n` → pending record with `drafterBatch:n`, `sendTo` = LG_DRAFTER_EMAIL even if a different address is passed.
  - claim does **not** cancel it for missing customer `messageId` / unlinked address (the two checks at `_email-outbox.js` ~127/~130 are skipped only for this kind), still respects `lgEmailSendGate(sendTo)`; item has `sendTo`, `subject 'הזמנות לשרטוט — משלוח 1 (2)'`, `files` = part count.
  - `lgEmailOutboxFile(db,key,token,0)` returns the PDF (`mime 'application/pdf'`).
  - a customer-kind record with no messageId is still cancelled (regression).
  - `renderText({kind:'drafter-batch', ...})` = the body in Global Constraints.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. Store `drafterBatch` and `fileCount` on the record at enqueue (Task 2 computes parts). `MAX_AGE_MS` (24h) stays — a batch email older than a day expires and shows as failed in the UI (Task 5).
- [ ] **Step 4:** `node scripts/test-email-outbox.js && node scripts/test-whatsapp-provider.js && node scripts/test-drafter-batch.js` → PASS.
- [ ] **Step 5:** commit `drafter: המשלוח יוצא במייל ל-lozzagagot דרך תור המיילים הקיים`.

### Task 4: Admin actions on the drain route

**Files:**
- Modify: `api/wa-inbound-drain.js` `handleAdmin` — actions `drafter-status`, `drafter-send`, `drafter-done` (next to `agent-status`, before the channel-specific ones).
- Test: `scripts/test-agent-drain.js` style — add `scripts/test-drafter-drain.js`.

- [ ] **Step 1: failing tests:** each action calls the Task 1 function with `by: deps.by`, returns `{ok, code:'', ...result}`; `drafter-send` result includes the email outbox state (`emailState: 'pending'`); unknown body fields (e.g. `to`) are ignored.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + `node scripts/test-agent-drain.js` still PASS.
- [ ] **Step 5:** commit `drafter: פעולות שלח לשרטט / השרטט סיים מהאדמין`.

### Task 5: The bar in admin

**Files:**
- Create: `drafter-batch.js` (browser module, pattern like `sq-assign.js`; calls `_lgAuthPost('/api/wa-inbound-drain', …)`)
- Modify: `admin.html` — include the script (cache-bust `?v=20261110`), a container above the order list shown only while the status filter is `'אצל שרטט'` (`setSF`, line ~489), and a tag on each order row at the drafter: `בסל` / `נשלח · משלוח <n>`.
- Test: `scripts/test-drafter-ui.js` (jsdom like `scripts/test-sq-assign.js`)

UI (Hebrew, mobile first):
- Line: `בסל: <N> הזמנות` + button **שלח לשרטט (<N>)** → confirm `לשלוח <N> הזמנות לשרטט במייל?` → result `משלוח <n> נשלח לתור המיילים — יגיע תוך דקה-שתיים`. Empty → text `הסל ריק` and the button does nothing.
- Line per open batch: `משלוח <n> · <time> · <count> · <מצב המייל: בדרך / נשלח / נכשל>`.
- Button **השרטט סיים** → confirm `להעביר את כל מה שנשלח לשרטט (<count>) ל"בנה יום עבודה"?` → result list: `עברו: …` and, if any, `לא הועברו: <orderNum> — <reason>`.
- After each action: refresh status; orders move by themselves via the existing Firebase listener.

- [ ] **Step 1: failing tests:** bar hidden when filter ≠ 'אצל שרטט'; shows basket count from a stubbed `drafter-status`; send click posts `{action:'drafter-send'}` only after confirm; done shows skipped reasons; empty basket text (Review Focus 4).
- [ ] **Step 2:** FAIL. **Step 3:** implement (follow the brand board + `ui-ux-pro-max` per standing rule for ZGAGI/LuzGlass UI; reuse `lg-ui.css` buttons). **Step 4:** PASS + `node scripts/test-sq-mobile.js` still PASS.
- [ ] **Step 5:** commit `drafter: פס "שלח לשרטט" ו"השרטט סיים" בלשונית אצל שרטט`.

### Task 6: Release to test and check

- [ ] Run all touched tests + `node scripts/test-invoice-pdf.js`.
- [ ] Merge the branch into `test`, push; wait until the test site serves `drafter-batch.js`.
- [ ] On the test site (fake/test orders only): put 2 orders at the drafter, open the filter, send → batch 1 created, email record pending (test env blocks the real send unless `EMAIL_ONLY_TO` — that is expected), "השרטט סיים" → both in "בנה יום עבודה". Screenshot for Ben.
- [ ] Do NOT merge to `main` — wait for Ben's go. After main: the first real "שלח לשרטט" = the real email check (Ben looks in Lozzagagot).
