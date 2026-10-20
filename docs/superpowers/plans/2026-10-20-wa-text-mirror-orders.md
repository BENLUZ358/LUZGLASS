# WhatsApp Text Mirror Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A text WhatsApp message from an approved private-chat sender, containing an order number (PHR#26037) and size lines, becomes an order in the sketch queue with items pre-filled (SKU from the heading, mm sizes, quantity), sketchName = the order number, and a picture of the message as its sketch.

**Architecture:** One pure parser module `api/_wa-text-order.js` (Node-testable, no I/O): `lgWaTextParse(text) → {orderRef, groups:[{heading, sku|null, lines:[{w,h,qty}]}]}` and `lgWaTextSvg(text) → data:image/svg+xml`. `api/_wa-inbound.js` learns a third kind `'text'` in `lgWaInboundParse` and a text branch in `lgWaInboundProcess` (same claim / all-or-nothing update as images). The queue (admin.html) gets an in-place SKU picker for rows without SKU and blocks "שלח לחשבשבת" while any row lacks one.

**Tech Stack:** Vercel Node functions, Firebase RTDB (firebase-admin), static admin.html, Node test scripts.

**Spec:** docs/superpowers/specs/2026-10-20-wa-text-mirror-orders-design.md

## Global Constraints
- Read only three things: the order number `/[A-Z]{2,4}#\d+/`, size lines, and each size group's heading. Everything else is not read and produces no warning.
- Size line: `<num>/<num> ס"מ` then optional `—`/`-`, then `כמות: <int>`; decimals allowed; cm × 10 = mm, rounded to 1 mm; order as written (w = first, h = second).
- Heading → SKU, first match wins: "מאסטר ליין"→8MM · "3+3"+"חתוך"→6TSH · "3+3"+"מלוטש"→6TSM · "מראה"+"ברונזה"→5MIRBM · "מראה"+("שחורה"|"אפורה")→5MIRAM · "מראה"→5MIRM · else → no SKU.
- A text message is an order only if it has an order number AND at least one size line; otherwise ignored exactly as today (`not a sketch`).
- Private chat from an approved sender only (existing `lgWaInboundAllowed` / `lgClientFromWaSender`); groups unchanged; image flow unchanged.
- Nothing is sent to Hashavshevet automatically. "שלח לחשבשבת" is blocked while any item has no SKU.
- Quantity N → N items (one per piece), matching how the queue and Hashavshevet lines count pieces today (`api/hashavshevet-order.js` line text "(k/N)").
- Same order number already on an open order of the same client → new order gets `waDuplicateOf: <orderNum>` and a queue badge "כפולה?"; nothing replaced.

## Review Focus
1. GREEN API text payloads: `textMessage` (`textMessageData.textMessage`) and `extendedTextMessage` (`extendedTextMessageData.text`, used for forwarded/long text) — both must parse; a quoted/forwarded message must not create two orders.
2. Hebrew punctuation variants: `ס"מ` with `"` vs `״`, `—` vs `-` vs none, `כמות:` with/without space, RTL marks (U+200F/U+200E) inside the line.
3. The SVG sketch must open in the check station, the drafter and the shared editor (lgSketchMerge draws it to canvas) on iPad Safari.
4. An item without SKU must never reach Hashavshevet silently (today `buildLines` skips it into `skipped`).
5. A message from Maor's linked group or any other approved sender that happens to contain "#123" but no size line must stay ignored.

---

### Task 1: the parser (pure)
**Files:** Create `api/_wa-text-order.js`; Test `scripts/test-wa-text-order.js`.
**Produces:** `lgWaTextParse(text: string) → { orderRef: string|null, groups: [{heading: string, sku: string|null, lines: [{w:number,h:number,qty:number}]}] }`, `lgWaTextIsOrder(text) → boolean`, `LG_WA_TEXT_SKU_RULES`.
- [ ] Step 1: failing tests with Ben's three real messages verbatim (PHR#26034, PHR#26037, AGN#00001 from the 20/10 photos): orderRef; group headings → 5MIRM / 5MIRAM / 8MM; `110/41.5` → {w:1100,h:415}; `179.6/49.6 ס"מ כמות: 10` (no dash) → qty 10; unknown heading → sku null; `״` and RTL marks; "מתי מוכן?" and "#123 בלי מידות" → not an order.
- [ ] Step 2: `node scripts/test-wa-text-order.js` → FAIL (module missing).
- [ ] Step 3: implement. Normalise (strip U+200E/U+200F, `״`→`"`), split lines, size regex `^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*ס"מ\s*[—–-]?\s*כמות:\s*(\d+)`, heading = last non-size, non-empty line before a size block.
- [ ] Step 4: PASS; full suite green. Step 5: commit.

### Task 2: the message picture (pure)
**Files:** `api/_wa-text-order.js`; test in `scripts/test-wa-text-order.js`.
**Produces:** `lgWaTextSvg(text, meta:{client, when}) → 'data:image/svg+xml;utf8,…'`.
- [ ] Failing tests: returns an svg data URL; every non-empty line appears escaped (`<`, `&`); `direction="rtl"`/`text-anchor="end"`; height grows with line count; width fixed 1200.
- [ ] Implement (white background, Arial/Heebo fallback, 44px lines, client + time header). PASS, suite, commit.

### Task 3: inbound — record and process text
**Files:** Modify `api/_wa-inbound.js` (`lgWaInboundParse`, `lgWaInboundProcess`); Test `scripts/test-wa-text-inbound.js` (fake db like the existing wa-inbound tests).
**Consumes:** Task 1–2. 
- [ ] Failing tests: text payload (both shapes) with order → `action:'record'`, `kind:'text'`, `text` stored (≤4000 chars); non-order text → ignore `not a sketch`; group text → ignored (scope); process: one order `wa_<key>_1` with `sketchName:'PHR#26037'`, items `{sku, name (catalog label or heading), w, h, quantity:1, chisum:false, source:'wa-text'}` × qty, `waText:true`, `sketches/<id>` = svg; all in ONE update with `state:'done'`; webhook retry with same idMessage → no second order; duplicate orderRef for same client → `waDuplicateOf`.
- [ ] Implement: kind `'text'` only when `lgWaTextIsOrder`; process branch skips download; item `name`/`glass`/`mm`/`proc` resolved from `skuCatalog/<SKU>` when present (read once).
- [ ] PASS, suite, commit.

### Task 4: queue — SKU picker and send guard
**Files:** Modify `admin.html` (queue item rows `iwRender`, `sqSendHashavshevet`), `api/hashavshevet-order.js` (server guard); Tests `scripts/test-sq-missing-sku.js`.
- [ ] Failing tests: a row with no SKU renders a picker listing 5MIRM, 5MIRAM, 5MIRBM, 8MM, 6TSH, 6TSM first (then the existing sku-picker search); choosing sets `sku`+label on that item only; `sqSendHashavshevet` refuses with "יש שורות בלי מק"ט" while any item lacks sku; server returns 400 `missing-sku` (never silently skips); badge "כפולה?" when `waDuplicateOf`.
- [ ] Implement; verify in admin harness on fake Firebase (phone + iPad widths). PASS, suite, commit.

### Task 5: end-to-end on TEST
- [ ] Seed the 3 sample messages through the inbound handler against the TEST database (luz-glass-test) from an approved test sender; check queue → editor → check station show the picture; send-to-Hashavshevet blocked on TEST by env (expected).
- [ ] Final whole-branch review (fresh reviewer), fix Critical/Important with tests, push, merge to `test`, PR link to Ben. Agan Barzel is connected only when Ben decides (after the Maor pilot).
