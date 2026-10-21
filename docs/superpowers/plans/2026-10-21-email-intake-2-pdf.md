# Email Sketch Intake — Part 2 (PDF → pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PDF attached to an email to ordersluz@gmail.com becomes one queue order per page (a JPEG sketch per page), instead of being rejected.

**Architecture:** A new shared server module `api/_pdf-pages.js` renders a PDF buffer to JPEG pages with `pdfjs-dist` (legacy build, dynamic `import()`) on `@napi-rs/canvas`. `api/_email-inbound.js` expands each PDF part, in attachment order, into page files that flow through the existing order/sketch path (numbers `-1..n`, per-sketch writes, all-or-nothing). WhatsApp is untouched; the module is written so it can be reused there later.

**Tech Stack:** Node 24 on Vercel, `pdfjs-dist@4.10.38`, `@napi-rs/canvas@0.1.65`, firebase-admin RTDB. Tests: `node scripts/test-*.js` with `scripts/_fake-db.js`; these tests need `npm ci` in the worktree.

**Spec:** `docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md` (§3.3 incl. spike results, D4)

## Global Constraints

- Each PDF page = one sketch/order; images and PDF pages share one order number per email with `-1..n` (E4, §3.2).
- All-or-nothing per email: one page that fails to render → no order from that email (D4).
- Render: width 1600px, JPEG quality 80, white background, max 30 pages per PDF (spike decision).
- Max 40 sketches per email in total (images + pages); more → whole email `rejected` with a plain-Hebrew reason.
- Every sketch is written in its own write (16MB RTDB per-write limit, Ruling R4 of part 1); orders + record state stay one atomic update.
- Hebrew reasons shown to Ben are plain Hebrew, no English terms.
- Never log file bytes, the token, or request bodies.
- Branch `feat/email-pdf` off `main` (main currently contains everything on test plus PRs #15/#16).

## Review Focus

1. **Password-protected PDF** → `rejected`, reason "ה-PDF מוגן בסיסמה — לבקש מהלקוח לשלוח בלי סיסמה", no orders. Test in Task 1 (mapped from pdfjs `PasswordException` by name).
2. **Corrupt / truncated PDF bytes** → `rejected`, reason "קובץ ה-PDF פגום ולא נפתח". Test in Task 1 (fixture: first 2KB of the synthetic PDF).
3. **Mail with an image then a 3-page PDF** → 4 orders numbered `-1..-4` in attachment order, image first. Test in Task 2.
4. **PDF of 31 pages** → `rejected` "ב-PDF יש 31 עמודים — יותר מ-30, לטפל ידנית". Test in Task 1 via the `maxPages` option (pass `maxPages: 2` against the 3-page fixture; assert the reason names 3 and 2).
5. **Function bundle missing pdfjs data files on Vercel** (standard fonts / cmaps) → text in vector PDFs renders blank. Covered by `vercel.json` `includeFiles` in Task 1 and a live check in Task 3.

---

### Task 1: `api/_pdf-pages.js` — PDF buffer → JPEG pages

**Files:**
- Create: `api/_pdf-pages.js`
- Modify: `package.json`, `package-lock.json` (add exact `pdfjs-dist@4.10.38`, `@napi-rs/canvas@0.1.65`)
- Modify: `vercel.json` — for `api/email-inbound.js` and `api/wa-inbound-drain.js` add `"includeFiles": "node_modules/pdfjs-dist/{standard_fonts,cmaps}/**"` (keep existing maxDuration; keep the file's current formatting)
- Fixture (already in the worktree): `scripts/fixtures/pdf/synthetic-3p.pdf` (3 A4 pages: vector lines + Helvetica text; page 3 also has an embedded PNG). No customer data.
- Test: `scripts/test-pdf-pages.js`

**Interfaces:**
- Produces:
  - `PDF_TARGET_W = 1600`, `PDF_JPEG_Q = 80`, `PDF_MAX_PAGES = 30`
  - `class PdfError extends Error` with `.reason` (plain Hebrew, shown to Ben)
  - `async lgPdfToJpegs(buf: Buffer, opts?: {maxPages?: number, targetW?: number, quality?: number}) -> Promise<Array<{bytes: Buffer, w: number, h: number}>>` — pages in order; throws `PdfError` for: password (`e.name === 'PasswordException'`), unreadable (`InvalidPDFException` / any load error), zero pages ("ב-PDF אין עמודים"), too many pages, and a page that fails to render ("עמוד N ב-PDF לא נפתח"). Renders one page at a time and releases each canvas (memory).
  - pdfjs is ESM: load with `await import('pdfjs-dist/legacy/build/pdf.mjs')` once and cache; `getDocument({data, CanvasFactory, isEvalSupported:false, useSystemFonts:false, standardFontDataUrl, cMapUrl, cMapPacked:true})` with dirs from `require.resolve('pdfjs-dist/package.json')`. A minimal `CanvasFactory` class over `createCanvas` (create/reset/destroy).

- [ ] **Step 1: Write the failing test** `scripts/test-pdf-pages.js`:
  - fixture → 3 pages; each `w === 1600`, `h` between 2200 and 2300, bytes start with `FF D8` (JPEG), each < 400KB
  - page 1 is not blank: decode is not needed — assert JPEG byte length > 15KB (a blank white 1600×2263 JPEG is ~ 10KB)
  - `maxPages: 2` → throws PdfError whose reason contains "3" and "2"
  - first 2048 bytes of the fixture → PdfError reason "קובץ ה-PDF פגום ולא נפתח"
  - non-PDF bytes (`Buffer.from('hello')`) → same corrupt reason
  - password mapping: a unit seam `_reasonFor(err)` exported for tests: `{name:'PasswordException'}` → password reason
  - `vercel.json` has the `includeFiles` glob on both functions
- [ ] **Step 2:** `npm ci && node scripts/test-pdf-pages.js` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** test PASS; `node scripts/test-csp.js` and `node scripts/test-env-isolation.js` still pass.
- [ ] **Step 5:** Commit.

### Task 2: Wire PDF pages into the email intake

**Files:**
- Modify: `api/_email-inbound.js` (process loop ~lines 160–200; constants ~62)
- Modify: `wa-inbound-panel.js` only if it references `EM_PDF_REASON` text
- Test: `scripts/test-email-inbound.js` (update the PDF cases), `scripts/test-email-inbound-route.js` if it asserts the old reason

**Interfaces:**
- Consumes: `lgPdfToJpegs`, `PdfError`, `PDF_MAX_PAGES` from Task 1.
- Produces: `EM_MAX_SKETCHES = 40` exported; `EM_PDF_REASON` removed from exports and all references.

**Behaviour (the decisions):**
- Sketch parts = parts whose `_kind` is `image` or `pdf`, sorted by `idx`. Declared-size cap (`EM_PART_MAX_BYTES`) applies to PDFs too.
- Walk sketch parts in order: image → as today (unsniffable → `skipped`); PDF → `lgPdfToJpegs(raw)`, push each page as `{name: '<pdf name> · עמוד k/N', mime: 'image/jpeg', bytes}`; a `PdfError` → `Final(err.reason)` (email `rejected`, nothing written). Any other render exception is transient (retry), same as other transient errors.
- After the walk: `files.length > EM_MAX_SKETCHES` → `Final('במייל יש ' + n + ' סקיצות — יותר מ-40, לטפל ידנית')`. `files.length === 0` → `ignored` as today.
- Order fields unchanged in shape: `fileName` = the PDF's name for its pages, `files.f0 = {name: '<pdf name> · עמוד k/N', type: 'image/jpeg'}`, `emailPage`/`emailPages` = position in the whole email. No new order fields (so no normalizer/rules change).
- `oversize` flag keeps its rule (any single sketch > threshold).

- [ ] **Step 1: Write the failing tests** in `scripts/test-email-inbound.js` (fixture bytes staged as chunks like the existing image cases):
  - PDF only (fixture) → `done`, 3 orders `em_K_1..3`, numbers `L####-1..-3`, `files.f0.name` ends with `· עמוד 1/3`, each `sketches/em_K_n` is a `data:image/jpeg;base64,` URL, no single update carries more than one `sketches/` path
  - image (idx 0) + PDF (idx 1) → 4 orders, order 1 is the image, 2–4 the PDF pages, `emailPages: 4`
  - corrupt PDF + good image → `rejected`, zero orders, reason "קובץ ה-PDF פגום ולא נפתח" (all-or-nothing)
  - 41 sketches (stub `lgPdfToJpegs` via an injectable `opts.pdfToJpegs` seam on `lgEmailInboundProcess` returning 41 tiny JPEG buffers) → `rejected` with the 40 reason
  - the old "PDF עדיין לא נתמך" expectation is removed everywhere (`grep -r "עדיין לא נתמך במייל"` returns nothing)
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement (the `opts.pdfToJpegs` seam defaults to `lgPdfToJpegs`).
- [ ] **Step 4:** run `test-email-inbound`, `test-email-inbound-route`, `test-wa-inbound-panel`, `test-pdf-pages` and the full suite (`for t in scripts/test-*.js`) → all PASS.
- [ ] **Step 5:** Commit.

### Task 3: Release and live check (controller + Ben, not a subagent)

- [ ] Merge `feat/email-pdf` into `test` and `main` after Ben says go; push; wait for Vercel Ready.
- [ ] Ben sends from benluz358 to ordersluz: (a) his real sketch PDF, (b) a mail with a photo + a PDF. Expected within ~2 min: (a) one order per page, (b) photo first then pages, all with the "מייל" tag; images readable.
- [ ] Controller checks `emailInbound` records and function logs for render time; note results in spec §3.3.
