# Workday Sketch Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "סקיצות" view in workday.html's build tab: one sketch at a time, filtered by glass type, in OptyWay order, with "הוסף סקיצה" that drafts only that glass type's items of the sketch.

**Architecture:** Pure helpers in workday.html (`wd*` functions, Node-testable via vm extraction like the other `scripts/test-workday-*.js`), a renderer that plugs into the existing `renderAvailable()` / `setBuildView()` switch, and the existing draft (`draftItems`, `addGroupToDraft`, `openDraftPreview`, `commitDraftToWork`) untouched. Two small changes in firebase-db.js: `updateStage` stamps `optyAt` when stage becomes `opty`; `lgNormalizeOrder` keeps `optyAt`.

**Tech Stack:** static HTML/JS, Firebase RTDB compat SDK, Node test scripts (`node scripts/test-*.js`).

**Spec:** docs/superpowers/specs/2026-10-19-workday-sketch-board-design.md

## Global Constraints
- OptyWay names map is for board order and board display ONLY — no other page changes a client name.
- Sort: name = optyName ?? orderClient; Latin/digit-first names before Hebrew; then `localeCompare` (sensitivity 'base'); ties by `optyAt || createdAt` ascending.
- Glass match is the existing exact `glassMatches(item, label)` / `lgGlassLabelOf`.
- "הוסף סקיצה" adds every item of the filtered glass in that order that is not in `_wdUnavailIdxs(o)` and not already in `draftItems` — never another glass type, never twice.
- Names stored at `meta/optyNames` as an array of `{client, opty}`; defaults when the node is empty: נאור חזקיה→א.א.פנדה, המקום לאמבט→BathPlace, א.מ.מראות→מאור.
- UI: 44px targets, no emoji icons (lg-icons `data-icon`), one green primary, breakpoints 600/900/1200, draft side panel at min-width 1100px.
- No change to "הורד לעבודה", partial-send logic, stations, or rules.

## Review Focus
1. An order with 8 שקוף + 6 שקוף: after drafting the 8, it must stay on the board under 6 שקוף and leave the 8 שקוף queue.
2. An order whose filtered-glass items are all already in work (itemsSel / wdDoneIdxs) must not appear under that glass.
3. Clients with no OptyWay name and names with dots/spaces sort without throwing; English-first holds for digit-leading names.
4. Orders without `optyAt` (existing backlog) fall back to `createdAt` and never sort as NaN.
5. Board must not load every sketch image up front — only the current one (and the next, prefetched).

---

### Task 1: optyAt stamped on entering OptyWay

**Files:** Modify `firebase-db.js` (`updateStage`, `lgNormalizeOrder`). Test: `scripts/test-opty-at.js`.

- [ ] Step 1: Failing test — extract `updateStage` with a fake `_lgDb` recording `update()` payloads; assert `updateStage('wa_x_1','opty')` payload has numeric `optyAt`, `updateStage('wa_x_1','workday')` payload has no `optyAt`; regex-assert `lgNormalizeOrder` source contains `optyAt:`.
- [ ] Step 2: `node scripts/test-opty-at.js` → FAIL (no optyAt).
- [ ] Step 3: In `updateStage`, build `const patch={stage,status,updatedAt:Date.now()}; if(stage==='opty') patch.optyAt=patch.updatedAt;`. In the normalizer add `optyAt: o.optyAt || 0,` next to `createdAt`.
- [ ] Step 4: test passes; full suite green.
- [ ] Step 5: commit.

### Task 2: board order + availability helpers (pure)

**Files:** Modify `workday.html` (new functions near `getFiltered`). Test: `scripts/test-workday-sketch-board.js`.

**Interfaces — Produces:**
- `wdOptyName(client: string, names: {client,opty}[]) → string` (opty name or client)
- `wdBoardCompare(a, b, names) → number`
- `wdBoardAvail(o, glass) → number[]` item indices of `glass` not in `_wdUnavailIdxs(o)` and not in `draftItems`
- `wdBoardOrders(glass, names) → order[]` — `getFiltered()` minus the glass filter, kept when `wdBoardAvail(o,glass).length`, sorted by `wdBoardCompare`
- `wdBoardGlassTypes() → {label,count}[]` glass types with available pieces among buildable orders, most pieces first
- `wdBoardLeft(o, glass) → string` e.g. "6 שקוף ×2" — other glass types still available (not unavail, not drafted)

- [ ] Step 1: Failing tests with fake orders: BathPlace < א.א.פנדה < מאור using the default map; digit-leading name before Hebrew; same client ordered by optyAt then createdAt fallback; 8+6 order: avail for 8 = the 8 indices; after those indices are in draftItems → order drops from `wdBoardOrders('8 שקוף')` and stays in `wdBoardOrders('6 שקוף')`; itemsSel-taken items excluded; `wdBoardLeft` reports "6 שקוף ×2".
- [ ] Step 2: run → FAIL (missing functions).
- [ ] Step 3: implement; `isLatin = /^[A-Za-z0-9]/`.
- [ ] Step 4: pass; suite green. Step 5: commit.

### Task 3: names map (load, defaults, edit)

**Files:** Modify `workday.html`. Test: extend `scripts/test-workday-sketch-board.js`.

**Produces:** `WD_OPTY_DEFAULTS`, `wdOptyNames` (live array), `wdSaveOptyNames(list) → Promise` writing `meta/optyNames`; listener started where the other listeners start (next to `listenSkuCatalog`).

- [ ] Failing test: defaults contain the three pairs; `wdOptyNamesFrom(null)` → defaults; `wdOptyNamesFrom([{client:'x',opty:'y'}])` → that list (drops rows with empty client/opty).
- [ ] Implement + a small editor (rows client select + opty input + "מחק", "הוסף", "שמור") opened from the board header button "שמות באופטי ווי".
- [ ] pass, suite green, commit.

### Task 4: the board view

**Files:** Modify `workday.html` (button `bvSketches`, `setBuildView`, `renderAvailable`, CSS). Test: extend board test with source checks.

- [ ] Failing source checks: `id="bvSketches"` calls `setBuildView('sketches')`; `renderAvailable` delegates to `renderSketchBoard` when `buildViewMode==='sketches'`; "הוסף סקיצה" calls `wdBoardAddSketch()`; `wdBoardAddSketch` uses `addGroupToDraft(` with `wdBoardAvail(`; board CSS has `min-width:1100px` side draft and `.wdb-btn` min-height 44px; no emoji in `renderSketchBoard`.
- [ ] Implement:
  - state `wdBoardGlass` (default = first of `wdBoardGlassTypes()`), `wdBoardIdx`.
  - glass chips; "סקיצה i מתוך N"; card: opty name, "במערכת: client · sketchName|ללא שם לסקיצה", gold order-number chip, `<img>` filled by `lgSketchIntoImg` (current) + prefetch next via `lgLoadSketch`; tap image → `showSketchPopup(id)`; items list (filtered glass highlighted, others muted, drafted marked "בטיוטה"); `wdBoardLeft` line "נשארות ומחכות: …".
  - actions: הקודם / הוסף סקיצה (green; shows "הסקיצה בטיוטה ✓" when no avail and some drafted) / הבא.
  - draft: ≥1100 side column listing draft grouped by glass → per order "name · num · N זכוכיות" + "הוצא" (removes that order's draft items of that glass) + button "הורד לעבודה" → `openDraftPreview()`; narrower: green "טיוטה · N" → `openDraftPreview()`.
  - empty state when no glass types: "אין סקיצות ממתינות לבדיקה".
- [ ] Verify in browser harness (workday on fake Firebase) at 1180×820 and 375×812: order, add sketch, partial stays, no horizontal scroll.
- [ ] pass, suite green, commit.

### Task 5: partial marker on the ordinary card

**Files:** Modify `workday.html` `orderCardHTML`. Test: extend board test.
- [ ] Failing: an order with `wdPartial` (or some indices in itemsSel/wdDoneIdxs and some left) renders "חלקית — נשאר:" in `orderCardHTML`.
- [ ] Implement using `wdBoardLeft`-style summary of available items (all glass types). pass, suite, commit.

### Finish
Push branch, merge into `test`, give Ben the PR link. Final whole-branch review by a fresh reviewer.
