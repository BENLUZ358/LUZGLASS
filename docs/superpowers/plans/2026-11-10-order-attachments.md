# כמה תמונות על הזמנה אחת (צרופות) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Attach "גרפיקה חלבי" / "שרטוט פרזול" images to an order (by long-press/drag or "חבר אל…" in the sketch queue), flip between them wherever the sketch is shown, include them in the invoice PDF and the drafter PDF, and undo with "הפרד".

**Architecture:** Attachments are stored like the existing `__layer`/`__base` siblings: image at `sketches/<id>__att<k>`, metadata at `orders/<id>/attachments/<k>`. One shared browser module `order-attachments.js` owns: pure helpers, merge/split writes (browser, admin — rules already allow `orders/` + `sketches/` writes), and a flipper widget used by every page. Server PDFs (`_invoice-deliver.js`, `_drafter-batch.js`) append attachment pages after the sketch page.

**Spec:** `docs/superpowers/specs/2026-11-10-order-attachments-design.md`

## Map of display sites (from code survey 10/11)
- firebase-db.js: `lgSaveSketch` 593, `lgGetSketch` 609 (cache Map 641), `lgHasSketch` 671, `lgLoadSketch` 684, `lgReplaceSketch` 701, `lgSketchIntoImg` 760, `lgNormalizeOrder` 1035, `deleteOrder` 868 (does NOT delete sketches/<id>).
- admin.html: order modal `img.mimg` 990; `previewSketch` lightbox 1684; billing `img.bill-sk` 2542; sketch queue detail `img#sqImg` 3496 filled in `sqShowDetail` 4126-4149; queue rows built in `sqRender` 4051 (row 4085, `onclick="sqSelect('id')"`, thumb 4082); `sqItems` 3574 from `buildSQItems` 3944. No long-press/drag code exists.
- drafter.html `showOrder` 327 (img.sketch-img 346-357); workday.html `showSketchPopup` 992 (`img#spImg`), board `renderSketchBoard` 1451 (`img#wdbImg`), stage tabs `_stageTabHTML` 2778 + `_openSketchFull` 2729; check-station.html `renderSketch` 898 / `_showSketchImg` 877; invoices.html `renderVerify` `img#skImg` 607/632, archive `arcSketches` 949; wa-inbound-panel.js `view` 631.
- Server: `_invoice-deliver.js` `_sketch` 76 / `lgInvoiceFiles`; `_drafter-batch.js` `_items`; `_agent-act.js` `_deleted` 139/144 + `lgAgentDeleteOnly` 165/169 (match by waMessageId); `_agent-okev.js` `lgOkevFind` 68; `_email-outbox.js` `lgEmailDoneMails` 185.

## Global Constraints
- One main sketch per order; attachments kind ∈ {`graphic`, `hardware`}; labels: `סקיצה`, `גרפיקה חלבי`, `שרטוט פרזול`.
- Merge only same customer: equal non-empty `customerId`; if source `customerId` is empty → only when `waSender`/`emailFrom` equal. Source must be in the sketch queue (no `stage`), no `items`, not sent to Hashavshevet (`hashavshevet` empty). Target: any stage.
- Source order is deleted from `orders/`; a full copy of its record (+ its `__layer`/`__base`) is kept in `attachments/<k>/from` so "הפרד" restores it exactly.
- Target already invoiced (`invoicePdf` sent / stage `collected`/`done` with invoice) → toast "החשבונית כבר נשלחה בלי התמונה הזו" (still merges).
- No Firebase rules change. No change to `sketches/<id>` (main image) semantics.
- Hebrew UI, 44px targets, works at 375px; breakpoints 600/768/900/1200 only; font ≥12px.

## Review Focus
1. Merge then a customer deletes the attachment's WhatsApp message → only the attachment goes (rules per spec), order stays.
2. Customer "השב" on the attachment's WA message → okev finds the main order.
3. Split after the main order moved stage → restored order goes back to the queue as it was (seen mark, ack, dup flag).
4. Order with attachments deleted/cancelled → attachment images not left as live orders (they are under the order; deleteOrder leaves sketches like today — acceptable).
5. Invoice PDF size grows → `MAX_MERGED_BYTES` fallback still sends separate files including attachments.

---

### Task 1: Data helpers + merge/split (browser module, pure part tested in Node)
**Files:** Create `order-attachments.js`; Test `scripts/test-order-attachments.js` (vm-load like test-sq-assign).
**Produces (globals):**
- `LG_ATT_KINDS = { graphic:'גרפיקה חלבי', hardware:'שרטוט פרזול' }`
- `lgAttList(order) -> [{k, kind, label, at}]` sorted by k.
- `lgAttCanMerge(src, dst) -> {ok:true} | {ok:false, why:'<hebrew>'}` (rules in Global Constraints; also src.id !== dst.id, dst not itself merged).
- `lgAttMergePlan(src, dst, kind, srcSketch, srcExtra:{layer,base}, now, by) -> {k, upd}` — the multi-path update object: `sketches/<dst>__att<k>`=srcSketch, `orders/<dst>/attachments/<k>`={kind, at, by, from:{order:src, layer, base}}, `orders/<src>`=null, `sketches/<src>`=null, `sketches/<src>__layer`=null, `sketches/<src>__base`=null, `orders/<dst>/updatedAt`.
- `lgAttSplitPlan(dst, k, attSketch) -> upd` — restores `orders/<from.id>` = from.order, `sketches/<from.id>`=attSketch (+layer/base), removes the att node + image.
- `lgAttFindByMsg(orders, waMessageId) -> {orderId, k} | null` (also used server-side — duplicate in api/_order-attachments.js, Task 4).
- DOM part: `lgAttMerge(srcId, dstId, kind)` / `lgAttSplit(dstId, k)` doing a single `_lgDb.ref().update(upd)` then `showToast`.
- [ ] tests: canMerge cases (same customer ✓, different ✗, empty cid same sender ✓, src has items ✗, src sent to HS ✗, src has stage ✗, target any stage ✓); mergePlan paths exact; split round-trip restores the original record deep-equal; list sorted with labels.
- [ ] RED → implement → GREEN → commit `צרופות: עזרים לאיחוד והפרדה של תמונות להזמנה`.
- [ ] `lgNormalizeOrder` keeps `attachments: o.attachments || null` (test regex like drafterBatch).

### Task 2: Sketch queue — long-press / drag / "חבר אל…" + flipper in detail
**Files:** `admin.html` (sqRender row, sqShowDetail, include script), `order-attachments.js` DOM (`lgAttPickKind()` dialog with two buttons + ביטול; `lgAttConnectMenu(src, candidates)`), test `scripts/test-order-attachments.js` (candidate list: same customer, recent first, max 12, excluding src).
- Long-press 500ms on a row (pointerdown/up, cancel on move >10px) → row "grabbed" style + menu "חבר אל…" listing candidates (any stage, `lgAttCanMerge` true) → pick → kind dialog → merge.
- Desktop: HTML5 draggable rows; drop on another row → kind dialog → merge.
- Row shows `📎 N` when attachments exist. Detail: flipper (see Task 3) under `#sqImg`, with "הפרד" on attachment slides.
- [ ] pure tests RED→GREEN; manual harness check at 375px; commit.

### Task 3: Flipper on every display site
**Files:** `order-attachments.js` `lgAttFlipper(container, order, opts)` — renders slide 0 = main (existing img stays as is), slides 1..n lazy-load `sketches/<id>__att<k>` via `lgGetSketch(id+'__att'+k)`; arrows + swipe; dots; label chip; `opts.onSplit` shows "הפרד". Wire into: admin order modal + `previewSketch`; drafter.html `showOrder`; workday.html `showSketchPopup` + board `renderSketchBoard` + `_openSketchFull`; check-station.html `renderSketch`; invoices.html `renderVerify`; wa-inbound-panel `view`. Each page: include script + one call after the main image is set; no change when the order has no attachments.
- [ ] pure test: slides model `lgAttSlides(order)` → `[{label:'סקיצה'}, {label:'גרפיקה חלבי', k:1}…]`; `test-undefined-vars` + `test-pages-ui` unchanged vs main; commit per 2-3 pages.

### Task 4: Server — PDFs, WA delete, okev, email archive
**Files:** create `api/_order-attachments.js` (`lgAttOf(db,id)` → [{k,kind,label,img:{mime,buf}}], `lgAttFindByMsg`); modify `_invoice-deliver.js` (sketch pages followed by attachment pages, header `<label> — <sketchName>`; separate-files fallback includes them), `_drafter-batch.js` `_items`/`_build` (same), `_agent-act.js` `_deleted` + `lgAgentDeleteOnly` (match attachment → stage rules on the attachment only: queue → remove silently; in work → ask customer "להוריד את <label>?" via existing ask path; production → message), `_agent-okev.js` (quotedId on attachment → main order), `_email-outbox.js` `lgEmailDoneMails` (include attachments' `from.order.emailMessageId`).
- [ ] tests extend `test-invoice-deliver`, `test-drafter-batch`, `test-agent-*` deleted cases, `test-email-outbox` done-mails; RED→GREEN each; commit.

### Task 5: Review + test release
- [ ] full suite = only the pre-existing failures; fresh reviewer (opus) on the branch; one fix pass; merge to `test`; harness check of queue + flipper at 375px; report to Ben. Not to main without Ben's go.
