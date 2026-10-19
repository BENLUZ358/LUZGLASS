# Sketch Editor (one editor, iPad-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three copy-pasted sketch editors (sketch queue, check station, drafter) with one shared editor where text is a movable, lockable object, two fingers always zoom/pan, the keyboard closes on demand, and queue edits stay editable after saving.

**Architecture:** `lg-sketch-editor.js` holds a pure model (`lgSketchModel`, no DOM — testable in Node with `vm`) and a thin UI (`lgSketchEditor.open`) that builds a full-screen overlay, maps Pointer Events onto the model, and renders everything in sketch coordinates. Each page keeps its own save target via an `onSave` callback; only the queue persists `__base`/`__layer` for re-editing.

**Tech Stack:** Plain browser JS (no build), Canvas 2D, Pointer Events, Firebase RTDB via `firebase-db.js`; tests are Node scripts in `scripts/test-*.js` (106 existing, run each with `node`).

**Spec:** `docs/superpowers/specs/2026-10-19-sketch-editor-design.md`

## Global Constraints

- Hebrew/RTL UI, Heebo, gold `#b8922a`; touch targets ≥ 56px.
- Objects live in sketch (natural image) pixels; texts anchored at centre (`textAlign:'center'`, `textBaseline:'middle'`).
- Two fingers = zoom/pan in every mode; a touch on the sketch never creates text; new text only from "＋ כתב".
- Each page saves where it saves today: queue → `lgReplaceSketch`; check station → `checkEdits/<id>`; drafter → `_editedSketch`. Output sizing per page as today (queue `max(natural,1200)` JPEG ≤ 6.5MB base64; station width cap 1400 JPEG; drafter PNG).
- Queue re-edit: `sketches/<id>__base` + `sketches/<id>__layer` (JSON string `{v:1,w,h,sig,texts,strokes}`); layer used only when `sig` matches the current sketch.
- No rules change, no new dependency. Every new order field (none planned) would need `lgNormalizeOrder`.

## Review Focus

- A very small or very large sketch image (300px wide / 4000px wide): text default size and stroke width must scale with the image, not be fixed pixels → test in Task 1 (`defaults scale with image width`).
- Rotating the iPad / opening the keyboard mid-edit: nothing already placed moves relative to the sketch → test in Task 1 (`resize keeps objects in sketch coords`) + browser check in Task 3.
- An empty text on "סיום" or on tapping away: removed, not left as an invisible object → Task 1 (`empty text is dropped on commit`).
- Opening a queue sketch whose image was replaced after the last edit (customer re-sent): opens on the current image with no layer, never on the stale base → Task 4 (`stale layer is ignored`).
- A two-finger gesture that starts as a one-finger stroke: the half stroke is discarded, no dot left → Task 1 (`second finger cancels stroke`).

---

### Task 1: The model (`lgSketchModel`)

**Files:**
- Create: `lg-sketch-editor.js` (model section only)
- Test: `scripts/test-sketch-editor-model.js`

**Interfaces:**
- Produces (global, also `module.exports` when `module` exists):
  - `lgSketchModel(opts:{w:number,h:number,layer?:object}) -> M` where `M` has:
    - `view:{s,x,y}`, `texts:Array<{id,x,y,txt,size,color,locked}>`, `strokes:Array<{kind:'pen'|'marker',color,w,pts:number[][]}>`, `sel:number|null`, `tool:'move'|'pen'|'marker'|'erase'`
    - `fit(screenW,screenH)`, `toSketch(sx,sy)->{x,y}`, `toScreen(x,y)->{x,y}`, `zoomAt(factor,sx,sy)`, `panBy(dx,dy)`
    - `addText(atSketch:{x,y}) -> text` (selected, unlocked, empty, size = `defaultTextSize()`), `setText(id,txt)`, `commitText(id)` (drops empty), `removeText(id)`, `toggleLock(id)`, `lockAll()`, `textBox(t, measure:(t)=>number) -> {x,y,w,h}`, `hitText(x,y,measure) -> text|null`, `hitLockHandle(t,x,y,measure) -> boolean`
    - `pointerDown(id,sx,sy,measure)`, `pointerMove(id,sx,sy)`, `pointerUp(id)` — the gesture state machine (spec §4.3); returns nothing, mutates the model
    - `undo() -> boolean`, `defaultTextSize() -> number` (= `round(w*0.035)`, min 18), `defaultStrokeW(kind) -> number` (pen `max(3, w*0.004)`, marker `max(14, w*0.022)`)
    - `toLayer(sig:string) -> {v:1,w,h,sig,texts,strokes}`, and `lgSketchModel({w,h,layer})` restores it
    - `draw(ctx, baseImage|null, measure)` — draws base (if given), strokes (marker `globalAlpha .35`, `lineCap:'butt'`), texts (centre-anchored, light halo `strokeText` then `fillText`), selection frame + handle when `sel`; all in sketch coords (caller sets the transform)

- [ ] **Step 1: Write the failing tests** in `scripts/test-sketch-editor-model.js` (load the file with `vm`, fixed `measure = t => t.txt.length * t.size * 0.6`), checks:
  - `addText` at `{x:500,y:400}` → text at exactly `(500,400)`, `sel` is its id, `locked:false`.
  - `centre anchoring`: `draw` on a recording fake ctx sets `textAlign 'center'` and `textBaseline 'middle'` and calls `fillText(txt, 500, 400)`.
  - `drag`: `pointerDown(1, screen of (500,400))` → `pointerMove(1, +30,+20 screen)` → `pointerUp` moves text by `(30/s, 20/s)` sketch px; undo restores `(500,400)`.
  - `locked text does not move`: after `toggleLock`, same drag leaves it at `(500,400)` and pans the view instead.
  - `tap on empty sketch never creates text` in every tool (`texts.length` unchanged).
  - `pen stroke`: tool `pen`, down/move/up → one stroke with ≥2 points in sketch coords; `undo` removes it.
  - `second finger cancels stroke`: tool `pen`, finger 1 down+move, finger 2 down → `strokes.length === 0`; then both move apart → `view.s` grows.
  - `pinch keeps the midpoint under the fingers`: the sketch point under the midpoint before and after `zoomAt` is the same (±0.01).
  - `erase removes a whole stroke` touched within its width; undo puts it back at the same index.
  - `empty text is dropped on commit`.
  - `resize keeps objects in sketch coords`: `fit(1024,768)` then `fit(768,1024)` → texts/strokes unchanged.
  - `defaults scale with image width`: `w:300` → text size 18; `w:4000` → 140.
  - `layer round-trip`: `toLayer('abc')` → `JSON.stringify` → new model with `layer` → identical texts/strokes, `sig 'abc'`.
- [ ] **Step 2: Run** `node scripts/test-sketch-editor-model.js` → FAIL (file missing).
- [ ] **Step 3: Implement** the model in `lg-sketch-editor.js` per the Interfaces block (reference behaviour: `scratchpad/sketch-editor-proto.html`, now in sketch-pixel units).
- [ ] **Step 4: Run** the test → `All sketch editor model checks passed.`; run all `scripts/test-*.js` → 0 failed.
- [ ] **Step 5: Commit** `feat(sketch-editor): the model — movable texts, strokes, zoom, undo, layer`.

### Task 2: The UI (`lgSketchEditor.open`) and merge

**Files:**
- Modify: `lg-sketch-editor.js` (UI + merge section)
- Test: `scripts/test-sketch-editor-ui.js`

**Interfaces:**
- Consumes: `lgSketchModel` (Task 1).
- Produces:
  - `lgSketchEditor.open({title, baseSrc, layer, output:{mime:'image/jpeg'|'image/png', minW?:number, maxW?:number, maxB64?:number}, onSave:async({mergedSrc, layer, baseSrc})=>void, onClose?:()=>void}) -> {close()}`
  - `lgSketchMerge(img, model, output) -> string` (dataURL; draws base then `model.draw` at output scale; JPEG quality steps 0.92→0.3 until `length ≤ maxB64`)
  - `lgSketchSig(dataUrl) -> string` (`length + ':' + FNV-1a of every 97th char`, hex)
- [ ] **Step 1: Failing tests** in `scripts/test-sketch-editor-ui.js` (source checks + run `lgSketchSig`/`lgSketchMerge` against a fake canvas factory):
  - `lgSketchSig` stable for same input, differs for one changed char at a sampled position, includes length.
  - `lgSketchMerge` with `output {mime:'image/jpeg', minW:1200}` and a 600px image → canvas width 1200; texts drawn at `x*2` (fake ctx records `fillText` at doubled coords via `scale(2,2)`).
  - the overlay root has `touch-action:none` only on the drawing surface; the text sheet has a "סיום" button and an input with `enterkeyhint="done"`; buttons min 56px (CSS string check).
  - `open` registers `visualViewport` resize and a `ResizeObserver` (source check), and `pointercancel` is handled like `pointerup`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** overlay DOM (injected once, `lg-se-` class prefix, CSS injected in a `<style id="lgSeCss">`), rail: ＋ כתב · הזזה · עט · מרקר · מחק קו · בטל · התאם · נעל הכל · ביטול · שמור; colours red/blue/black; A−/A+; double-tap a text edits it; Escape closes the sheet, then the editor (with "לצאת בלי לשמור?" in-page confirm if dirty).
- [ ] **Step 4: Run** → pass; full suite 0 failed.
- [ ] **Step 5: Commit** `feat(sketch-editor): the iPad editor UI and merge`.

### Task 3: Queue (admin.html) uses it, with re-edit

**Files:**
- Modify: `admin.html` (`sqOpenEditor`, `sqSaveEdit`, `sqCloseEditor`, `et*` functions, `#sqEditor` markup, resize listener ~L4499), `<script src="lg-sketch-editor.js">`
- Modify: `firebase-db.js` — add `lgLoadSketchLayer(orderId) -> Promise<{base:string|null, layer:object|null}>` and `lgSaveSketchLayer(orderId, {base?:string, layer:object}) -> Promise` (writes `sketches/<id>__base` only when `base` given, `sketches/<id>__layer` = `JSON.stringify(layer)`)
- Test: `scripts/test-sketch-editor-pages.js` (queue part)

**Interfaces:**
- Consumes: `lgSketchEditor.open`, `lgSketchSig`, `lgReplaceSketch` (existing), `lgLoadSketch` (existing).
- [ ] **Step 1: Failing tests:** admin has no `etCanvas`/`etResizeCanvas`/`fillText(txt` left; `sqOpenEditor` calls `lgSketchEditor.open`; `onSave` calls `lgReplaceSketch(order, mergedSrc)` and `lgSaveSketchLayer`; the open logic (extracted `sqEditorSource(current, saved)`): `layer.sig === lgSketchSig(current)` → `{base: saved.base, layer}`; otherwise `{base: current, layer:null}` and the next save writes `base`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; output `{mime:'image/jpeg', minW:1200, maxB64:6.5*1024*1024}`.
- [ ] **Step 4: Run** → pass; full suite. **Browser check** (fake-Firebase harness or TEST site): iPad 1024×768 and 768×1024 — add text, drag onto the middle pane, lock, pinch, rotate, save, reopen → text still movable at the same spot.
- [ ] **Step 5: Commit** `feat(queue): the shared sketch editor, editable after saving`.

### Task 4: Check station and drafter use it

**Files:**
- Modify: `check-station.html` (`ed*`, `edSave` ~L1343-1400, editor markup ~L377-399) — `onSave` writes `checkEdits/<id>` exactly as `edSave` does today, output `{mime:'image/jpeg', minW:1200, maxW:1400, maxB64:6_500_000}`, `layer:null`.
- Modify: `drafter.html` (`ed*`, `edSave` ~L556-596, markup ~L232-252) — `onSave` sets `_editedSketch` exactly as today, output `{mime:'image/png'}`, base = `_editedSketch || sketch || generated SVG`.
- Test: `scripts/test-sketch-editor-pages.js` (station + drafter parts)
- [ ] **Step 1: Failing tests:** neither page has `function edStart`/`fillText(txt`; each calls `lgSketchEditor.open`; station `onSave` writes `checkEdits/`; drafter `onSave` writes `_editedSketch`; `stale layer is ignored` (queue, from Task 3's `sqEditorSource` with a mismatched sig) stays green.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full suite → 0 failed; browser check of both pages at iPad width.
- [ ] **Step 5: Commit** `feat(station, drafter): the shared sketch editor`; merge to `test`; PR link to Ben.
