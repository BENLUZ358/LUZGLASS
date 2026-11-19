# Scan to mark collected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The customer's driver scans the QR on a glass label and taps "הזמנה נאספה". The whole order moves to collected, and the scan is recorded.

**Architecture:** A new public POST action `collect` in `api/_glass-qr.js`, protected by the signed code. `g.html` gets a button. Admin shows the record.

**Tech Stack:** Vercel node functions, firebase-admin RTDB, vanilla HTML/JS.

**Spec:** docs/superpowers/specs/2026-11-19-scan-collect-design.md

## Global Constraints
- No login is needed for collect. The signed code (`lgGlassParse` + `lgGlassFind`) is the only gate.
- The public responses never contain prices, phone or notes.
- The record is `orders/<id>/scanCollect = {at, glassNo, name?, early?}`. `name` is trimmed and cut to 40 characters.
- Plain Hebrew copy.

## Review Focus
- Stage `delivery` (our own truck): refuse with `code:'delivery'`. Admin already blocks delivery→collected, and allowing it would skip the delivery-finish message. This is my call.
- Double tap or second scan: answer `already`, write nothing, keep the first `at`.
- A test order (`isTest`) is collected the same way. No special case.
- A forged or changed signature on POST → 404, nothing written.
- GET exposes `stage` and `scanCollect` only. Still no phone or prices (V2 test stays green).

---

### Task 1: Server action `collect`
**Files:** Modify `api/_glass-qr.js`. Test: `scripts/test-glass-qr.js`, new section C.
**Produces:**
- `lgScanCollectPlan(o, now, glassNo, name) -> {kind:'already'|'delivery'|'ok', patch?, at?}`
- POST body `{action:'collect', c, name}`. The response is `{ok:true, at, early}`, or `{ok:false, code:'already', at}` / `{code:'delivery'}` with status 409.

- [ ] **Step 1: Write the tests.**
  - C1: a POST with no auth on order o1 (stage done) gives 200. The DB then has stage collected, status נאסף and scanCollect.glassNo 2.
  - C2: a second POST gives 409 already, and the `at` is unchanged.
  - C3: an order in stage chisum gives `early:true`.
  - C4: an order in stage delivery gives 409 delivery, and the stage is unchanged.
  - C5: a wrong signature gives 404.
  - C6: a 60-character name is stored as 40.
  - C7: GET after collect includes `stage:'collected'` and `scanCollect.at`.
  - V2: leak check still passes.
- [ ] **Step 2: Run** `node scripts/test-glass-qr.js`. Expected: the C tests fail.
- [ ] **Step 3: Implement.**
  - Handle `action==='collect'` before the admin check.
  - Write with `db.ref('orders/'+id).update(patch)`, where the patch is `{stage, status, updatedAt, scanCollect}`.
- [ ] **Step 4: Run.** Expected: all pass.
- [ ] **Step 5: Commit.**

### Task 2: g.html button
**Files:** Modify `g.html`.
- [ ] **Step 1: Add the button.**
  - When `stage !== 'collected'` and `stage !== 'delivery'`, show the green button "✓ הזמנה נאספה" and the optional "שם הנהג" field, above goBtn.
  - Confirm with `confirm('לסמן את כל ההזמנה (N זכוכיות) כנאספה?')`.
  - POST `/api/glass` with `{action:'collect', c:CODE, name}`.
  - Success → "✓ נרשם שנאסף · HH:MM". `already` → "כבר נאסף ב־HH:MM (D/M)".
- [ ] **Step 2: Check it.** Render it in a headless browser against a stubbed fetch, and take a screenshot.
- [ ] **Step 3: Commit.**

### Task 3: Admin shows the scan
**Files:** Modify `admin.html` (order modal and board card).
- [ ] **Step 1: Add the line.**
  - Add `lgScanCollectLine(o)` to firebase-db.js. It returns `''` or "📱 נאסף בסריקה HH:MM (שם)", with "⚠ לפני מוכן" when `early` is set.
  - Show it in the order modal and on the board card.
- [ ] **Step 2: Clear the record on undo.** Any stage change away from collected clears `scanCollect`, in `updateStage`.
- [ ] **Step 3: Test it.** Add a test for `lgScanCollectLine`, then commit.
