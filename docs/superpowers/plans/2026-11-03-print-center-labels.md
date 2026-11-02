# Print Center + Tempering Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the iPad tempering tab, print a 70×70 label per arrived glass on the TSC TE210 via the office PC, with a print control panel (history, status, reprint).

**Architecture:** Browser draws each label on a 560×560 canvas and packs it to 1-bit rows; a job (text + bitmaps) goes through a new API under `waMeta/printJobs` (no rules change); the office invoice tool polls the API, sends TSPL over TCP 9100 to `10.0.0.253`, reports back. `prints.html` lists jobs and reprints by redrawing from stored text.

**Tech Stack:** plain HTML/JS pages + `firebase-db.js`, Vercel function via rewrite into `api/wa-inbound.js`, firebase-admin RTDB, Node tool `tools/invoice-watcher/watcher.js`, `@napi-rs/canvas` for node tests.

**Spec:** `docs/superpowers/specs/2026-11-03-print-center-labels-design.md`

## Global Constraints
- No change to `database.rules.json`; all print data under `waMeta/` written only by the server.
- Vercel 12-function limit: new route = rewrite `/api/print` → `/api/wa-inbound?print=1`.
- Tool auth = `INVOICE_UPLOAD_TOKEN` (Bearer), same as invoice upload; admin auth = `verifyUser` role `admin`.
- Label: 70×70 mm, 203 dpi → bitmap 560×560, 70 bytes per row. TSPL: `SIZE 70 mm,70 mm`, `GAP 3 mm,0 mm`, `CLS`, `BITMAP 0,0,70,560,0,<bytes>`, `PRINT 1,1`.
- Never auto-reprint after sending started; stuck `printing` past 2 min lease → state `unknown`. Connection refused before sending → back to `queued`, max 3 attempts → `failed`.
- Jobs older than 90 days are deleted when a new job is created.
- Hebrew UI text, plain words.

## Review Focus
1. Partial marks: a group "2/3 הגיעו" must give exactly 2 labels; nothing for unmarked glass.
2. Tool restarts mid-print → job must end `unknown`, never print twice by itself.
3. Office PC off for hours → jobs stay `queued`, all print once when it returns, in creation order.
4. Very long client / sketch names → text shrinks to fit, never cut off silently.
5. Big batch (60 labels) → payload under Vercel's 4.5 MB body limit (60 × ~52 KB base64 ≈ 3.1 MB — refuse above 70 labels per job with a clear message).

---

### Task 1: Print jobs API

**Files:**
- Create: `api/_print-jobs.js` (core, testable), `api/_print-route.js` (Vercel handler)
- Modify: `api/wa-inbound.js` (dispatch `req.query.print === '1'`), `vercel.json` (rewrite)
- Test: `scripts/test-print-jobs.js`

**Interfaces — Produces:**
- `handlePrint(req, deps)` → `{status, body}`; deps `{db, now, verify(req)→{ok,role,phone,name}, env}`.
- Admin actions (POST JSON `{action}`): `create {kind:'labels', printer:'labels', client, orderIds[], labels:[{title,dims,sketch,orderNum}], bitmaps:[base64]}` → `{ok, id}`; `list {from?}` → `{ok, items, agent:{lastSeenAt}}`; `get {id}` → `{ok, job}` (no bitmaps).
- Tool actions (Bearer token): `agent-claim` → `{ok, job:{id, printer, bitmaps[]}|null}` (sets `printing`, `leaseUntil=now+120000`, `attempts+1`; first marks expired `printing` as `unknown`; always writes `waMeta/printAgent/lastSeenAt`); `agent-done {id, ok, retryable?, error?}` → state `printed` / `queued` (retryable && attempts<3) / `failed`; deletes `waMeta/printJobBlobs/<id>` on final state.
- Job record `waMeta/printJobs/<id>`: `{kind, printer, client, orderIds, labels, count, state, createdAt, createdBy, attempts, leaseUntil, printedAt, error}`.

- [ ] Write failing tests: create→list shows `queued` with count; create rejects >70 labels / empty / non-admin (403); claim returns oldest queued with bitmaps and sets `printing`; second claim while leased returns null; done ok → `printed` and blob deleted; done retryable ×3 → `failed`; expired lease → `unknown` (never re-claimed); bad token → 401; lastSeenAt written on empty claim; create deletes jobs older than 90 days.
- [ ] Run `node scripts/test-print-jobs.js` — expect failures (module missing).
- [ ] Implement with transactions on the job node for claim (fake-db transaction semantics: first call with null → return null).
- [ ] Run test — PASS. Run `node scripts/test-whatsapp-provider.js` (reads api dir) — PASS.
- [ ] Commit.

### Task 2: Label model + drawing (shared)

**Files:**
- Create: `print-labels.js` (browser global + `module.exports` when in node)
- Test: `scripts/test-print-labels.js`

**Interfaces — Produces:**
- `lgLabelsForClient(orders, markedOf)` → `[{title, dims, sketch, orderNum, orderId, idx}]` — `markedOf(order)` returns the Set of arrived idxs; one label per marked item in `_pendingIdxsOf` order; `title=orderClient`, `dims=lgDimsText(w,h)` text without bidi marks for drawing (`w + ' × ' + h`), `sketch=sketchName||''`, `orderNum`.
- `lgLabelDraw(ctx, label, W=560)` — white background; title top (bold, ≤ 64px, shrink to fit width-40), dims centre (bold, ≤ 120px, shrink), sketch below (≤ 64px, shrink), orderNum bottom-left 28px; `ctx.direction='rtl'` for Hebrew lines.
- `lgLabelPack(imageData, W=560)` → base64 of 70×560 bytes; pixel luminance < 128 → black → bit **0**, else 1 (TSPL BITMAP: 0 prints).

- [ ] Failing tests: 3-item group with 2 marked → 2 labels; unmarked → none; pack of an all-white canvas → all 0xFF bytes, all-black → 0x00, length 39200 bytes; long sketch name draws without throwing and measured width ≤ 520 (register Heebo from `api/_heebo.ttf` via `@napi-rs/canvas` GlobalFonts).
- [ ] Implement; tests PASS; commit.

### Task 3: Labels window in work-day

**Files:**
- Modify: `workday.html` — load `print-labels.js`; button `🏷 מדבקות` next to `✓ סמן הכל` in the client row (~2541) for both tracks; modal.
- Test: `scripts/test-workday-labels.js` (static checks + run `lgLabelsForClient` against the row's data).

**Interfaces — Consumes:** Task 1 `create`, Task 2 functions. Modal: grid of label previews (each a `<canvas>` 560 drawn, CSS-scaled ~140px) with editable inputs (title, dims, sketch), "הסר" per label, "+ עותק", footer "הדפס N מדבקות". After create: poll `get` every 3 s up to 2 min, show `בתור` / `הודפס ✓` / `נכשל: …` / `לא ידוע — בדוק את המדפסת`; link "לוח הדפסות".
- [ ] Failing static test: button exists in the client row template and calls `openLabelsModal(reportId, clientName, track)`; modal builds labels only from `_markedIdxSet`.
- [ ] Implement; tests PASS; commit.

### Task 4: Print control panel

**Files:**
- Create: `prints.html`
- Modify: side nav (`unav-nav`) in admin.html, workday.html, invoices.html — link `🖨 הדפסות`.
- Test: `scripts/test-prints-page.js` (static: requires admin, calls `list`, reprint uses `create` with redrawn bitmaps, nav links present).

Behaviour: list newest first (time, who, client, count, printer, state chip); agent line "המחשב במשרד: מחובר לפני X" (stale > 2 min → red "לא מחובר"); open a job → previews from stored text, editable, checkbox per label, "הדפס שוב (N)" → new job; filter by client text and days (7/30/90).
- [ ] Failing static test; implement; PASS; commit.

### Task 5: Office tool prints labels

**Files:**
- Modify: `tools/invoice-watcher/watcher.js` (+ `README.md`)
- Test: `scripts/test-print-agent.js`

**Interfaces — Produces:** `tsplForBitmap(b64)` → Buffer (constraints above); `printLoop(cfg, deps)` — every `cfg.labelPollMs||3000`: POST `{action:'agent-claim'}` to `cfg.printUrl || origin(cfg.url)+'/api/print'`; for each bitmap open TCP to `cfg.labelPrinter.host:port` (default 9100), write all labels in one connection, close; report `agent-done` (`retryable:true` only for connect errors `ECONNREFUSED/EHOSTUNREACH/ETIMEDOUT` before any byte written). Runs alongside `loop` (not inside it) when `cfg.labelPrinter` is set.
- [ ] Failing tests with a local `net.createServer` fake printer: bytes start with `SIZE 70 mm,70 mm`, contain one `PRINT 1,1` per label, BITMAP payload 39200 bytes; refused port → done `retryable:true`; claim null → no connection.
- [ ] Implement; PASS; commit.
- [ ] Install on the office PC: copy watcher.js to `C:\LuzGlass\invoice-watcher` (backup first), add `"labelPrinter": {"host":"10.0.0.253","port":9100}` to config.json, restart via the shortcut.

### Task 6: Verify and ship to test
- [ ] Full suite `for f in scripts/test-*.js` — only the 5 known pre-existing failures.
- [ ] Fresh reviewer on the branch diff; fix Critical/Important with tests.
- [ ] Merge to `test`, push, check `luzglass-test.vercel.app/prints.html` loads and `/api/print` answers 401 without auth.
- [ ] With Ben: one test print from the test site (tool pointed at test via `printUrl`), calibrate DIRECTION/offset; then main on Ben's go.
