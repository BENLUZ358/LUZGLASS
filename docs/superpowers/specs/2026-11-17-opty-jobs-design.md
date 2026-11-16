# OptyWay optimisations tab: sheets, labels in cut order, what was cut

Ben, 17/11/2026.

## Why

All cutting goes through OptyWay. Ben wants the system to know for certain what was cut and what wasn't, and to see and print OptyWay's work from the system itself:

- the sheets of each optimisation;
- labels in cut order, the way OptyWay prints them today (with "1/10" at the start of each sheet).

## What Ben said

- A new tab "אופטימיזציות" inside the OptyWay page (opty.html).
- Every daily stick import pulls in all of that day's optimisations.
- Filters: glass type and similar.
- Opening an optimisation lets him page through its sheets.
- On every piece: running # (cut order), shape #, client, sketch name, size. If the piece has a shape, its cut line is drawn in true proportion, the same drawing as the item's existing shape view.
- Printing: one label, or all labels of the optimisation in cut order. A sheet marker "לוח 1/10" comes at the start of each sheet.
- "בכל סוף יום, כל הסחורה שירדה נחתכת" — whatever reached the stick that day is cut by the end of that day.
- Chose approach 1: the import itself marks linked items as cut. No end-of-day button.

## Goals

- Store every optimisation found on the stick: its sheets and its pieces with positions.
- Show those in the new tab, with filters and a sheet viewer.
- Print labels in cut order on the existing TSC label printer, through the existing print queue.
- Mark every item that is linked to an OptyWay piece as cut, with the cut date and the optimisation number. Show it only in the order details window of the order board (admin.html).

## Non-goals

- Reading the cutting table's own log. We have no access to it.
- Changing how OptyWay prints its own labels.
- Linking pieces that have no shape #. That is a separate follow-up, though the data stored here enables it (ORDINE such as PHR#26083).

## Anti-goals

- Never mark an item as cut unless it is linked to a piece in a stored optimisation.
- Never invent a link while doing so.
- Never require a prod rules change. Store new data under meta/, per [[prefer-no-rules-changes]].
- Never write to the stick.

## Approaches considered

1. **Chosen (Ben). Import = cut.** The import marks linked items cut, dated by the work day Ben picks at import. Mistakes (a broken piece, a sheet left for tomorrow) are undone by hand.
2. End-of-day button "היום נחתך". Rejected: an extra daily step, and nothing gets marked if it's forgotten.

## Decoded file format

Already verified on 293 jobs (4206/4206 pieces match Pezzi sizes).

- `M00xxx.R01` sits in the stick root, next to the `.dat` files.
- Each `[...]` line is one sheet. Numbers are hex; the unit is 0.1 mm.
- **Header:** `P<n>` `H<sheet#>`, or `H5-6` for identical sheets. Then `R<length> R<height> x<trim> y<trim>`; total trim in mm = value/20. An optional `T<?>` is ignored.
- **Cuts:** nested guillotine cuts `X Y Z W Q R` (depth 1–6). Axes alternate, starting with X along the sheet length. Each value is a size; there is no kerf.
  - `V<n>` = the next node repeats n times.
  - `S<n=shape>` = the shape #.
  - `N<hex>` = POSPZ of the piece in Pezzi.DB / PezziCan.DB for that CODCOM.
- **Cut order** = the order pieces appear in the file. This is the order labels print.
- **Reference parser:** scratchpad `opty-cnc/layout.js`.

## Design

### New file `opty-layout.js`

Pure code that runs in both the browser and Node, with a test in `scripts/test-opty-layout.js`.

- `lgOptyLayoutParse(text)` → `[{ index, count, L, H, trimX, trimY, pieces: [{ order, pos, shape, x, y, w, h }], waste }]`.
- `lgOptyLayoutSvg(sheet, info, geos)` draws one sheet.
  - `info[pos]` = `{ client, name, w, h }`.
  - The cut line is drawn from `.dat` geometry in sheet units, with a thin stroke that is NOT non-scaling.
  - A rotated piece (geo.w ≠ placed w) is drawn rotated 90°.

### Import (קליטה tab)

The file picker for `.dat` also accepts `.R01`; Ben selects all files in the stick root with Ctrl+A. For each R01:

- Find its pieces in Pezzi by CODCOM.
- Save `meta/optyJobs/<M00xxx>` with:
  - `day` (the work day Ben chose at import; the default is suggested from `File.lastModified`)
  - `mat` (COD_MAT_COMP)
  - `matName` (DESCR_MAT_COMP)
  - `sheets` (parsed, without waste)
  - `pieces: { <pos>: { client, name, w, h, qty, shape, grind } }`
  - `importedAt`
- Only jobs dated within the import's existing "days" window are saved. The stick holds about a month of jobs, and the first import must not stamp old orders.
- A job already stored is overwritten (re-import is safe). Cut marks it already made are kept.

### Cut marking

After the existing shape matching and saving runs:

- Every order item whose `optyJob` + `optyShape` is in a saved job gets `items[k].optyCut = { at: <job day>, job }`, if the item has none yet.
- `optyCut` is written in the same place and with the same access as `optyShape` today. No rules change.
- Pieces without a shape, or not linked, stay unmarked.
- Later, when a pending shape is linked (`linkOne` / `wdLinkPending`) and its job is stored, it gets `optyCut` too.

### Tab "אופטימיזציות"

- **List**: one card per job, showing:
  - job #, date, glass type (code + name), sheets, pieces;
  - how many pieces are linked to our orders, and how many of those are marked cut.
- **Filters**: date range (default the last 3 days), glass type, client (Opty name), and free search (job #, shape #, client, sketch name).
- **Job view**:
  - one sheet at a time, with ‹ › to move between sheets and "לוח i/N" (counting identical-sheet repeats);
  - the drawing from `lgOptyLayoutSvg`;
  - below it, a table of the pieces in cut order;
  - tapping a piece shows its big shape window (the existing `lgOptyShapeView` style) and a 🏷 button.
- **Buttons**:
  - 🏷 for one piece;
  - "הדפס את כל המדבקות" for the whole job;
  - "הדפס לוח זה" for one sheet.

### Labels

- **Piece label**: the existing 70×70 label (`lgLabelDraw`). When linked to our order, it uses the order's own data, as `lgLabelsForClient` does today. Otherwise it uses OptyWay's data: client, short name, size, shape, job. The drawing is included when the piece has a shape.
- **Sheet marker label**, printed before each sheet's pieces: "לוח i/N", the job #, the glass type, and the number of pieces on the sheet.
  - For identical sheets (H5-6) there is one marker per physical sheet, each followed by its pieces.
- Printing goes through the existing print queue (`api/_print-jobs` → the watcher on the office PC → TSC), the same as prints.html.

### Cut status shown (Ben 17/11: NOT in chisum — only the order details window)

- **Order board → order details window (admin.html) only**: per linked item "אופטימיזציה M00xxx · ✂ נחתך dd/mm" (or "לחיתוך dd/mm" before the cut day ends). Nothing new in chisum/workday.
- **Job view**: a piece marked cut shows ✂. A "בטל נחתך" button clears `optyCut` on that item (for a broken piece or one left for tomorrow).

## Work day: Ben chooses (Ben 17/11, replaces an automatic rule)

"שיהיה לי אופציה לייבא את האופטמזציה בממשק, ולהחליט לאיזה יום עבודה זה".

- The import screen lists the optimisations found, each with a work-day picker. All of them share one picker at the top ("יום עבודה לכל האופטימיזציות"), and each row can be changed on its own.
- The default is suggested from the R01 file time: before 12:00 → that day; 12:00 or later → the next work day (Sun–Thu). Ben confirms or changes it before saving.
- The chosen day is stored as the job's `day`, and every cut stamp uses it (`optyCut.at`).
- In the jobs tab, "שנה יום עבודה" changes `day` and updates `at` on that job's items that are stamped and not undone.
- Order window: "לחיתוך dd/mm" until that day ends, then "✂ נחתך dd/mm".

## The optimisation is its own source (Ben 17/11)

"שהאופטמזציה יהיה עוד מקור חוץ מהפרטים של הממשק".

- `meta/optyJobs` is a full, separate record of what OptyWay cut: the job, day, sheets, pieces, OptyWay client, short name, sizes and shapes. It is kept whether or not a piece is linked to our orders, and it never overwrites order details.
- Order items only carry the link (`optyShape`, `optyJob`) and the stamp (`optyCut`).

## Agents learn it (Ben 17/11: "צריך ללמד את הסוכנים")

The order tracker (`api/_agent-okev.js`) uses the cut stamp:

- **Status.** An order whose items are all stamped cut (`at` ≤ today, not undone) answers "הזכוכיות נחתכו, ההזמנה בייצור". If only some are, it answers "חלק מהזכוכיות כבר נחתכו, ההזמנה בייצור". This applies when the stage is still pre-production (`'', pending, chash, drafter, opty`). Later stages keep their existing wording.
- **Cancel / change.** Once any item has a cut stamp with `at` ≤ today that is not undone, the order is too late to change (`lgOkevCanChange` → false), even if its stage is still early.
- **Ben's evening review.** The daily agent summary for Ben lists today's cut count: "נחתכו היום N זכוכיות ב-M אופטימיזציות".

## Glass names in Hebrew (Ben 17/11: "08S 8 שקוף")

- The import also reads `Magaz.DB` from DBLITE. It has 54 materials: CODMAT and an English DESCMAT such as "8 mm clear".
- Each code gets a Hebrew name, built from thickness plus translated words.
  - Default dictionary (Claude's call, Ben corrects): clear שקוף · extra clear שקוף אקסטרה · mirror מראה · acid חלבי · acid clear חלבי שקוף · bronze ברונזה · gray אפור · black שחור · mat מט · silk משי · lacobel לקובל · reflective מחזיר אור · granit גרניט · chinchilla צ'ינצ'ילה · pepitte פפיט · master carre מאסטר קרה · master line מאסטר ליין · savta סבתא.
  - Laminated names keep their own form, e.g. "3+3 שקוף".
- Names are stored in `meta/optyMats/<code>` as `{ he, en }`. They can be edited in the הגדרות tab.
- Hebrew names are used everywhere glass type shows: list, filters, sheet header, marker label, and the work screen. The code is shown beside the name, e.g. "08S · 8 שקוף".

## Work estimate (Ben 17/11: "הערכת עבודה")

For each work day, the system sums the jobs assigned to it:

- sheets (physical), pieces, m² (sum of piece w×h), and features;
- features = holes + notches + shape cuts, counted from `.dat` contours with the existing `lgOptyFeatures`. Pieces without a shape count 0.

**Work units per sheet:**
- Initial weights: `1·sheet + 0.15·piece + 0.02·m² + 0.3·feature`. These are Claude's call, and they are only a starting point.
- The weights are re-fitted nightly from timed sheet marks (below), using least squares on gaps between consecutive marks. The fit runs only once there are at least 30 usable gaps, and Ben's first days of rough marking are allowed for:
  - gaps over 45 minutes, or under 30 seconds, are dropped;
  - bulk marks (glass-type "הכל נחתך") give no timing.
- **Day verdict:** the day's units compared with the median of the last 20 work days. Below 0.8× = "יום קל", 0.8–1.2× = "יום רגיל", above 1.2× = "יום עמוס" (with the ×).
- **Hours:** once the timing fit exists, also show "בערך N שעות חיתוך".
- Stored at `meta/optyDays/<day>`: `{ sheets, pieces, m2, features, units }`. The model is stored at `meta/optyModel`: `{ weights, n, fittedAt }`.

## Sheet marking and progress (Ben 17/11)

The marking can be done on a phone, tablet or computer. Timing may be rough on the first days, and that's fine.

**Screen "עבודת היום":**
- It is a new tab in opty.html, and also reachable by a direct link `opty.html#today`. It is responsive and has big buttons.
- It picks the work day (default today) and groups the day's sheets by glass type, in job and sheet order.
- Each sheet has a big "נחתך" button, and tapping it again undoes the mark.
- Each glass-type group has a "כל ה-<08S · 8 שקוף> נחתך" button that marks all its sheets at once.
- The progress bar is weighted by work units: "ביצעת 30%, נשאר 70%". It shows per type and for the whole day.

**Storage and effects:**
- Marks are stored at `meta/optyJobs/<job>/marks/<sheetNo>` as `{ at: ms, by, bulk: bool }`.
- Marking a sheet stamps that sheet's linked items `optyCut` immediately, with `at` = the work day.
- At the end of the work day, unmarked sheets count as cut anyway, as before.
- "נחתך" status for the order window and the agents follows the same rule: a stamped item is cut, and so is any job on a day that has ended.

## Calls made after the builder check (Claude, 17/11)

These are open for Ben to correct.

1. **"בטל נחתך" survives re-import.** It writes `optyCut = { job, at, undone: true }` instead of deleting the mark.
   - The import never touches an item that already has any `optyCut`.
   - Counts treat `undone` as not cut.
   - The job view offers "סמן נחתך" to restore it.
2. **Printing.** `api/_print-jobs.js` is extended:
   - `_label()` keeps the new fields: `marker` (sheet i/N), `mat`, `pieces`, and `optyOnly`.
   - prints.html draws marker labels for "הדפס שוב".
   - A whole job is sent as several print jobs of at most 70 labels each, in order. A sheet's marker never ends a chunk: the chunk is cut before the marker instead.
   - This is a normal deploy, with no rules change.
3. **Quantity.** An item is marked cut when the first job containing its shape is imported.
   - OptyWay keeps all copies of a piece in one job.
   - A rare split across days is accepted, and the date shown is the first one.
4. **Days window.** It filters by the suggested work day (from the R01 file time) only, not by DATACONS.
5. **Order window (admin.html).** It gets "אופטימיזציה M00xxx" and "✂ נחתך dd/mm" next to the existing "צורה N".

## Left to the builder

- Exact layout and styling. Follow the existing opty.html look.
- Whether job lists load lazily.
- Field names inside meta/optyJobs beyond those above.

## Open / unverified

- Whether OptyWay's own screen uses the same origin and rotation direction for drawings.
- Default work-day suggestion from file time; Ben confirms it at every import.
