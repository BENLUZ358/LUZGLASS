# Exact Glass Cut Templates + DXF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every shower glass in the sketch builder is drawn exactly as it is cut (hinge windows, handle hole, open/closed angles, harmonica holes, slope), and each glass can be downloaded as a DXF at cut size.

**Architecture:** A new pure module `lg-cuts.js` turns the engine's shower (`lgOutline` + `lgJunctions`) into per-glass cut geometry in mm at cut size — one source for the canvas and for DXF. `lg-dxf.js` writes that geometry as DXF R12. `sketch-demo.html` paints it and offers the angle choice and DXF buttons; `admin.html` offers DXF from a saved order.

**Tech Stack:** Plain browser JS + Node (`module.exports` guard, like `lg-layout.js`), node test scripts in `scripts/test-*.js` (no framework), Firebase RTDB unchanged.

**Spec:** `docs/superpowers/specs/2026-11-16-exact-glass-templates-design.md`

## Global Constraints

- One source: canvas and DXF both read `lgCuts(shower)`; no second geometry path.
- Cut size = sketch size **+2 mm in width and +2 mm in height** (shower glass); all template distances are measured on the cut size.
- Measured constants (mm, cut size), from the spec table: hinge window 39×80, 10 from the long edge, 161 from each short end (to the window edge); handle Ø12, centre 61 from the edge, at exactly half height; open angle = notch open to the edge 20×35 (r10), 191 from each end; closed angle = Ø20, centre 26 from the edge, 191 from each end (to the hole edge); harmonica = 2 pairs of Ø18, centres 181 and 221 from each end, 27 from the edge.
- Angle choice per glass: `bracketType` `'normal'` (closed, Ø20, **default**, also for old orders with no value) or `'open'` (notch).
- Prima door: **out of scope** (next phase). Mirrors / units / sliding: drawing unchanged.
- DXF blocked (with on-screen warning) when a cut leaves the glass, overlaps another cut, or is < 5 mm from another cut.
- DXF: R12 ASCII, LINE/ARC/CIRCLE only, mm, origin bottom-left of the cut size, viewed from the front; layers `OUTLINE`, `CUTS`; one file per glass, name `L<order>-<item>_<W>x<H>.dxf` (+`_x<qty>` when qty>1). DXF buttons **admin only**.
- Old orders keep their saved PNG; `LG_BUILDER_VERSION` goes 1 → 2; DXF from a saved order only when `builder.version >= 2`.
- No Firebase rules change. Release to the test site only; main only on Ben's explicit go.
- UI text in plain Hebrew.

## Review Focus

1. Door hung on a taller fixed (door gap 15): the fixed's hinge windows must line up with the door's hinges (measured: fixed 161/171/176 from its end) — a test in Task 3 pins alignment.
2. Mirrored showers (hinge on the left vs right): every cut moves to the other long edge — Task 2 fixtures include both sides; Task 3 tests a mirrored combo.
3. Narrow glass (e.g. 252 wide harmonica) and short glass: no overlap between angle/hinge and harmonica holes — Task 3 test with a 200-wide door must report an issue, a 252-wide harmonica must not.
4. Slope on the wall side: angles keep 191 from the end and sit on the slanted edge — Task 2 sloped fixtures.
5. Old saved order (`builder.version` 1 or missing): admin DXF button hidden, PNG untouched — Task 6 test.

## Files

- Create `lg-cuts.js` — constants `LG_CUT`, hinge contour, `lgCutTemplate`, `lgTemplateOf`, `lgCuts`.
- Create `lg-dxf.js` — `lgDxf`, `lgDxfName`.
- Create `scripts/test-lg-cuts.js`, `scripts/test-lg-dxf.js`, `scripts/test-exact-glass-ui.js`.
- Fixtures (already committed with this plan): `scripts/fixtures/exact-glass/*.dat` (136 OptyWay shapes, 8 per template ± slope) + `index.json` `[{shape, template, slope, w, h}]`; `274378.dat` is the hinge-window contour source (lines 33–41).
- Modify `sketch-demo.html` (paint, angle choice, DXF buttons, load scripts), `lg-layout.js` (`LG_BUILDER_VERSION`), `admin.html` (DXF in the order window).
- Reuse `opty-shape.js` `lgOptyShapeParse` in tests to read fixtures.

---

### Task 1: Constants and the hinge-window contour

**Files:** Create `lg-cuts.js`; Test `scripts/test-lg-cuts.js`

**Interfaces — Produces:**
- `LG_CUT` = `{ allowance:2, hinge:{w:39,h:80,edge:10,end:161}, handle:{dia:12,edge:61}, open:{w:20,l:35,r:10,end:191}, closed:{dia:20,edge:26,end:191}, harm:{dia:18,edge:27,c1:181,c2:221} }` (frozen).
- `LG_HINGE_CONTOUR` — array of segments `[0,x1,y1,x2,y2] | [1,cx,cy,r,a0,a1]` relative to the window's bounding box origin (x from the glass edge side, y from the window bottom), taken verbatim from `274378.dat` lines 33–41 (same segment format as `lgOptyShapeParse`).

- [ ] **Step 1: Failing test** `contour matches 274378.dat`: parse `scripts/fixtures/exact-glass/274378.dat` with `lgOptyShapeParse`; take the first contour, shift by its bbox min; assert every segment equals `LG_HINGE_CONTOUR` within 0.01, and the bbox is 39×80 (±0.5). Test `constants`: `LG_CUT.hinge.end===161 && LG_CUT.allowance===2`.
- [ ] **Step 2:** `node scripts/test-lg-cuts.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `lg-cuts.js` with the browser/Node guard used by `lg-layout.js:2174`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `lg-cuts: קבועים שנמדדו + קונטור חלון הציר`.

### Task 2: `lgCutTemplate` matches the real OptyWay shapes

**Files:** Modify `lg-cuts.js`; Test `scripts/test-lg-cuts.js`

**Interfaces — Produces:**
`lgCutTemplate(key, spec) → { w, h, outline:[[x,y]...], cuts:[Cut] }` where
- `key` ∈ `'door' | 'fixed-open-door' | 'fixed-closed-door' | 'fixed-open' | 'fixed-closed' | 'harm' | 'harm-handle' | 'door-harm' | 'door-harm-handle'`;
- `spec` = `{ w, h /* cut size */, side:'left'|'right' /* long edge of the hinge/angles */, slope?:{ edge:'left'|'right', top:mm, bottom:mm /* inset of the slanted edge at top/bottom */ }, hingeEnd?:{top,bottom} /* overrides of 161 */ }`;
- `Cut` = `{ kind:'hinge'|'handle'|'open'|'closed'|'harm', x, y /* centre, mm from bottom-left */, dia? , contour? /* absolute segments */ }`.
Rules: hinge/angles on `side`; handle on the opposite edge at h/2; harmonica on the edge opposite the hinge for `door-harm*`, on `side` for `harm*`; for `harm-handle` the handle is on the edge opposite the holes. On a slope, edge distances are measured from the slanted line at the cut's height.

- [ ] **Step 1: Failing test** `fixtures`: for each entry of `index.json`, parse the `.dat`, detect `side` and `slope` from the file (side = long edge whose nearest cut is a hinge/angle/harm hole; slope = the full-length contour), call `lgCutTemplate(entry.template, {w, h, side, slope})`, and assert: same number of cuts per kind as the file, and every generated cut centre is within **1.0 mm** of a file cut centre of the same kind. Print a per-template pass count; the test fails on any miss and lists `shape → kind → distance`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Hinge contour = `LG_HINGE_CONTOUR` placed at `edge`/`end`, mirrored for `side:'right'` and for the top window.
- [ ] **Step 4:** Run → all 136 pass. If a template misses on real data, do **not** loosen the tolerance — report the shapes (they become a question for Ben).
- [ ] **Step 5:** Commit `lg-cuts: תבניות — תואמות 136 צורות אמיתיות מאופטי-ווי`.

### Task 3: From the engine's shower to cuts per glass

**Files:** Modify `lg-cuts.js`; Test `scripts/test-lg-cuts.js`

**Interfaces — Consumes:** `lgOutline(shower)` (lg-layout.js:731 — `{idx,kind,mmW,mmH,poly,slope,notch}`), `lgJunctions(shower)` (lg-shapes.js:127), shape fields `kind`, `carriesDoor`, `harmonicaSide`, `hingeSide`, `bracketType`, `hingeTop`, `hingeBot`.
**Produces:**
- `lgTemplateOf(shower, i) → key | null` (null = not a shower glass handled here → drawing unchanged).
- `lgCuts(shower) → [{ idx, key, w, h /* cut size */, outline, cuts:[Cut], issues:[string] }]`.
Mapping (spec "החלטות שלי" #3): door → `door`; door carrying a harmonica leaf → `door-harm` (+`-handle` if it is the free end); harmonica leaf → `harm`, last leaf (free end) → `harm-handle`; fixed with `carriesDoor` → `fixed-<a>-door`; other fixed → `fixed-<a>`; `<a>` = `bracketType==='open' ? 'open' : 'closed'`. Outline = `lgOutline` poly + allowance (offset 1 mm outward per side). A fixed carrying a door gets its hinge windows at the **door's hinge heights** (door bottom is `LG_DOOR_GAP` higher), not at its own 161.
Issues (Hebrew): cut outside the glass `'חיתוך יוצא מהזכוכית'`; overlap or gap < 5 mm `'חיתוכים קרובים מדי'`.

- [ ] **Step 1: Failing tests:** build showers with `lgFromPanels` from the catalogue combos used in `scripts/test-carries-door.js` (fixed + door; door + harmonica; mirrored fixed + door) and assert: keys per glass; cut sizes = sketch +2; `bracketType` missing → `closed` cuts; `'open'` → `open` cuts; fixed hinge-window centres equal the door's hinge-window centres in absolute height (±0.5); a 200-wide door has an issue; a 252-wide harmonica has none; mirrored shower has every cut on the other edge.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement on top of `lgCutTemplate`.
- [ ] **Step 4:** Run → PASS; also `node scripts/test-carries-door.js` and `node scripts/test-catalog.js` still pass.
- [ ] **Step 5:** Commit `lg-cuts: חיתוכים לכל זכוכית מתוך המקלחון`.

### Task 4: DXF writer

**Files:** Create `lg-dxf.js`; Test `scripts/test-lg-dxf.js`

**Interfaces — Produces:** `lgDxf(glassCut) → string` (one entry of `lgCuts`); `lgDxfName(orderNum, itemNo, glassCut, qty) → string`.

- [ ] **Step 1: Failing tests:** for a `door` 802×2152: output starts with `0\nSECTION` and ends with `0\nEOF`; `$INSUNITS` = 4 (mm); entities only `LINE|ARC|CIRCLE`; 4 `LINE` on layer `OUTLINE`; `CIRCLE` radius 6 on `CUTS` at (centre); hinge window = its contour segments on `CUTS`; a tiny reader in the test parses the entities back and their extents equal 0..802 × 0..2152. Name: `lgDxfName('L1290',2,{w:802,h:2152},1)==='L1290-2_802x2152.dxf'`, qty 2 → `'L1290-2_802x2152_x2.dxf'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (degrees for ARC angles, counter-clockwise). **Step 4:** PASS.
- [ ] **Step 5:** Commit `lg-dxf: קובץ DXF לכל זכוכית`.

### Task 5: The builder draws the real cuts + angle choice

**Files:** Modify `sketch-demo.html` (load `lg-cuts.js`; `engPaint` :3671 / `engHardware` :3548 / folded `engPaintFolded` :2980; panel sheet; `mkPS` :958), `lg-layout.js:2164`; Test `scripts/test-exact-glass-ui.js` (vm/jsdom like `scripts/test-hole-builder.js`)

- [ ] **Step 1: Failing tests:** in the builder sandbox, a fixed+door shower: `getPS(...).bracketType` defaults to `'normal'`; the panel sheet has a control labelled `זווית פתוחה` that sets `'open'` and redraws; after `draw()` the paint log (stub ctx) contains, per glass handled by `lgCuts`, the hinge contour and the cut circles at the scale of that glass; mirrors keep the old drawing; `LG_BUILDER_VERSION===2`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: for glasses with a key, `engPaint` draws `lgCuts` geometry mapped into the glass's canvas poly (mm → px by the same scale), replacing the old hinge/bracket/handle/harmonica markers on that glass; dimension lines stay. Bump `LG_BUILDER_VERSION` to 2.
- [ ] **Step 4:** PASS; run every `scripts/test-*.js` that loads `sketch-demo.html` or `lg-layout.js` (`grep -l "sketch-demo.html\|lg-layout" scripts/test-*.js`) — all pass.
- [ ] **Step 5:** Screenshot the builder (built-in browser, local file) with fixed + door and door + harmonica, normal and open angle; attach to the report.
- [ ] **Step 6:** Commit `בונה: הזכוכית מצוירת כמו שהיא נחתכת + בחירת זווית פתוחה`.

### Task 6: DXF buttons (admin only)

**Files:** Modify `sketch-demo.html` (near `dlPNG` :4545; admin via `_sess.role==='admin'` :1775), `admin.html` (order "פרטים" window); load `lg-dxf.js`; Test `scripts/test-exact-glass-ui.js`

- [ ] **Step 1: Failing tests:** admin session → a `DXF` button per glass and `כל ה-DXF` (zip via the zip helper already used in the repo if any; else one download per glass, sequential); customer session → no DXF button; a glass with issues → its button disabled with the issue text; in `admin.html`, an order with `builder.version===2` shows `DXF` per item, built from `builder.shower` with `lgCuts`; version 1 or missing → no button and the PNG is untouched.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full related test scripts.
- [ ] **Step 5:** Open one downloaded DXF in a viewer (or parse with the Task 4 reader) and screenshot next to the builder drawing.
- [ ] **Step 6:** Commit `DXF: הורדה לכל זכוכית — רק למנהל`.

### Task 7: Release to the test site

- [ ] Merge `feat/exact-glass-templates` into `test`, push, wait for the test deploy, open the builder on the test site and repeat the Task 5 screenshots there. Report to Ben in plain Hebrew with the screenshots and one DXF. **No push to main** without Ben's explicit go.
