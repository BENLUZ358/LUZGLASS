# WhatsApp Free-Text Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For customers Ben enables, a free-form private WhatsApp text such as "תכין לי מראה 5 מלוטש 70 120" opens an order in the sketch queue. The rows are pre-filled the same way as for Agan's fixed format.

**Architecture:**
- A new pure parser `api/_wa-free-text.js` turns lines into `{groups, unparsed}`. The groups use the same shape `lgWaTextItems` already consumes, so item building is reused. SKU is chosen against the live `skuCatalog` by name tokens, and only when exactly one SKU matches.
- `lgWaInboundParse` (sync, no DB) marks a text that looks like a free-text order with `textMode:'free'`. The webhook then admits it only if the sender's customer is in `waTextCustomers/<customerId>`.
- Processing builds the items, plus notes for lines that weren't parsed.
- Admin toggles go through `/api/wa-inbound-drain`, and there is a small panel box.

**Tech Stack:** Vanilla JS, Vercel Node CommonJS, Firebase RTDB Admin, `scripts/_fake-db.js` (transactions called with null first).

**Spec:** `docs/superpowers/specs/2026-10-26-wa-free-text-orders-design.md`

## Global Constraints
- No new `api/*.js` route file (Hobby limit 12). New helpers start with `_`.
- Private chats only. Groups: text is still not read at all.
- Agan's fixed format (`lgWaTextIsOrder`) is checked first and keeps its exact behaviour. It needs no flag, as today.
- Units: cm ×10 → mm. Any dimension above 400 cm means the line goes to `unparsed`, not to an item.
- The only SKU default is a mirror with no colour → 5 mm, polished. Glass has no default processing.
- The flag is written only via the admin endpoint. Rules: `waTextCustomers` read for admins only, `.write:false`.
- Plain Hebrew in the UI. Touch targets 44px.

## Review Focus
- **Ordinary chat with numbers** ("נדבר מחר ב-10 על 2 דברים", "מתי מוכן? 3 ימים?") never becomes an order: no product word, or no clean pair. Task 1 tests this.
- **`50*89` and `50x89` are a size pair, never a quantity.** `X2` / `x 2` at the end is a quantity. Task 1 tests this.
- **A customer who is not enabled** sending a perfect free-text order: nothing happens, exactly as today. Agan's format still works for everyone allowed. Task 2 tests this.
- **The thickness number is never taken as a dimension** ("מראה 5 76 54", "מראה 5 מ״מ 89 על 123"). Task 1 tests this.
- **An ambiguous SKU stays empty** (`skuMissing`, which the existing send guard blocks), and the order still opens. Task 1/2 tests this.

---

### Task 1: Pure free-text parser + SKU matcher

**Files:**
- Create: `api/_wa-free-text.js`
- Test: `scripts/test-wa-free-text.js` (new)

**Interfaces:**
- Produces:
  - `lgWaFreeTextParse(text) -> { groups: [{ heading, desc, sku: null, lines: [{ w, h, qty }] }], unparsed: [string] }`
    - `desc = { kind: 'mirror'|'glass', color: ''|'ברונזה'|'אפורה'|'שקוף'|'קליר'|'חלבי'|'אסיד'|'אפור', mm: number|null, proc: ''|'חתוך'|'מלוטש'|'מחוסם' }`
    - `w`/`h` in mm.
  - `lgWaFreeTextIsOrder(text) -> boolean`: at least one group line.
  - `lgWaFreeTextSku(desc, catalog) -> string|null`: the unique active match, else null.
  - `lgWaFreeTextResolve(parsed, catalog) -> parsed`: fills `sku` on each group, ready for `lgWaTextItems`.
- Line algorithm, in this order:
  1. Normalise as in `_wa-text-order.js` `_norm`.
  2. Explicit pairs `(\d+(?:\.\d+)?)\s*(?:על|[xX×*])\s*(\d+(?:\.\d+)?)`.
  3. Quantity: `(?:^|\s)[xX×]\s*(\d{1,3})(?=\s|$)` or `(\d{1,3})\s*יח`.
  4. Thickness: a number followed by `מ"מ|מ'מ|ממ`. Otherwise the first number directly after the product word, if it is in {3,4,5,6,8,10,12} and at least 2 other numbers remain.
  5. Bare remaining numbers: exactly 2 make a pair. The line is an item only if there is exactly one pair, plus a product on this line or carried from the last product-only line.
  6. A line with ≥ 2 numbers that is not an item goes to `unparsed`.
- Mirror defaults: `mm` 5, `proc` 'מלוטש'. Colour words: ברונזה; אפורה/אפור/שחורה/שחור → 'אפורה' for a mirror.
- SKU match: among `active !== false` entries, the name must contain `${mm} מ''מ`, the kind word (מראה for a mirror), the colour word if any, and the proc word if any (חתוך / מלוטש / מחוסם). It must contain none of these extras unless requested: גרפיקה, צורתית, עגול, עגולה, טריפלקס, דלתות, פינויים, אסיד, קליר, חלבי, ברונזה, אפורה, אפור, מראה, שקוף. For glass with no proc → null.

- [ ] **Step 1: Write failing tests** in `scripts/test-wa-free-text.js`. Use this catalog fixture: the real names `5MIRM` "5 מ''מ מראה מלוטש", `5MIRH` "5 מ''מ מראה חתוך", `5MIRBM` "5 מ''מ מראה ברונזה מלוטש", `5MIRAM` "5 מ''מ מראה אפורה מלוטש", `5MIRR` "מראה 5 מ''מ עגול מלוטש", `5MIRS` "מראה 5 מ''מ צורתית מלוטש", `5MIRG` "מראה 5 מ''מ מלוטש גרפיקה", `8SM` "8 מ''מ שקוף מלוטש", `8SH` "8 מ''מ שקוף חתוך", `8SMH` "8 מ''מ שקוף מחוסם".
  - `ben 1`: "מה קורה אחי תכין לי בבקשה מראה 5 מ״מ 89 על 123" → one line `{w:890,h:1230,qty:1}`, sku 5MIRM.
  - `ben 2`: "אני צריך מראה 50*89" → `{500,890,1}`, 5MIRM.
  - `ben 3`: "מראה 5 76 54 X2" → `{760,540,2}`, 5MIRM.
  - `ben 4`: "תכין לי בבקשה מראה 5 מלוטש 70 120" → `{700,1200,1}`, 5MIRM.
  - `variants`: "מראה 70x120" → pair. "מראה 70 x 120" → pair. "מראה 5 70 120 x 3" → qty 3. "מראה 70 120 2 יח'" → qty 2.
  - `colour/proc`: "מראה ברונזה 60 80" → 5MIRBM. "מראה שחורה 60 80" → 5MIRAM. "מראה חתוך 60 80" → 5MIRH.
  - `glass`: "זכוכית 8 שקוף מלוטש 100 על 200" → 8SM. "זכוכית 8 שקוף 100 על 200" → line parsed, sku null.
  - `multi`: "מראה 5\n60 80\n70 90 x2" → 2 lines in one group with qty 1 and 2, sku 5MIRM.
  - `not orders`: "נדבר מחר ב-10 על 2 דברים", "מתי מוכן? 3 ימים?", "מראה יפה תודה" → `lgWaFreeTextIsOrder` false.
  - `unparsed`: "מראה 5 60 80\nעוד 30 40 50" → 1 item, `unparsed:['עוד 30 40 50']`.
  - `too big`: "מראה 500 80" → not an item; `unparsed:['מראה 500 80']`.
  - `agan format untouched`: covered by running the unchanged `scripts/test-wa-text-order.js` in Step 4.
- [ ] **Step 2: Run** `node scripts/test-wa-free-text.js`. Expected: FAIL (cannot find module).
- [ ] **Step 3: Implement** `api/_wa-free-text.js` per the interfaces. Reuse `_norm` by exporting it from `_wa-text-order.js` (add it to its exports).
- [ ] **Step 4: Run** `node scripts/test-wa-free-text.js && node scripts/test-wa-text-order.js`. Expected: PASS.
- [ ] **Step 5: Commit** `wa-free-text: פענוח הזמנה מטקסט חופשי (מראה/זכוכית, מידות, כמות, עובי) ובחירת מק"ט מהקטלוג`

### Task 2: Wire into intake — per-customer flag, order building

**Files:**
- Modify: `api/_wa-inbound.js` (parse ~line 84; process ~line 271)
- Modify: `api/wa-inbound.js` (after the private-sender gate)
- Test: `scripts/test-wa-free-text.js` (extend, using `fakeDb` and `handleInbound` as in `scripts/test-wa-senders.js`)

**Interfaces:**
- Consumes: Task 1 exports. `lgClientFromWaSender(db, chatId)`.
- Produces:
  - Parse: when not Agan format and `lgWaFreeTextIsOrder(t)` → `kind:'text'`, `textMode:'free'`, `text`.
  - Webhook: for `textMode:'free'`, resolve `who = lgClientFromWaSender(db, chatId)`. If `!who.customerId` or `waTextCustomers/<customerId>` is not truthy → `{ok:true, ignored:'text not enabled'}`, with no record and no sendersSeen.
  - Process: for `entry.textMode === 'free'`: read the whole `skuCatalog` → `lgWaFreeTextResolve` → `order.items = lgWaTextItems(...)`, `order.sketchName = 'הודעת טקסט'`, `order.notes = unparsed.map(l => 'לא פוענח: ' + l).join('\n')`, `order.waText = true`, same SVG. No duplicate check (there is no order number).
  - DB: `waTextCustomers/<customerId> = { customerName, addedAt, addedBy }`.

- [ ] **Step 1: Write failing tests:**
  - `enabled customer free text → order` → seed `users/0501234567={customerId:'888'}`, `waTextCustomers/888`, catalog. Send "תכין לי מראה 5 70 120 x2". The order has 2 items with `sku:'5MIRM'`, `w:700`, `sketchName:'הודעת טקסט'`, `waText:true`.
  - `not enabled → ignored, nothing recorded` → the same message without the flag gives `body.ignored === 'text not enabled'` and an empty `waInbound`.
  - `unknown sender free text` → not allowed, so `ignored:'sender'` and the number appears in sendersSeen. This is the existing Task-1 behaviour of wa-senders; just assert it.
  - `agan format needs no flag` → the Agan MSG from a listed sender is still recorded with no `waTextCustomers` entry.
  - `unparsed lines go to notes` → "מראה 5 60 80\nעוד 30 40 50" → `notes === 'לא פוענח: עוד 30 40 50'`.
  - `ambiguous sku keeps skuMissing` → "זכוכית 8 שקוף 100 על 200" from an enabled customer → items have `skuMissing:true`.
  - `group text still ignored` → a free-text order in a linked group → ignored (`not a sketch`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node scripts/test-wa-free-text.js && node scripts/test-wa-text-inbound.js && node scripts/test-wa-text-order.js && node scripts/test-wa-inbound.js && node scripts/test-wa-senders.js && node scripts/test-wa-groups.js`. Expected: all PASS.
- [ ] **Step 5: Commit** `wa-free-text: הודעה חופשית מלקוח מוגדר → הזמנה בתור עם שורות; שורות לא מפוענחות בהערות`

### Task 3: Admin toggle + panel box + rules

**Files:**
- Modify: `api/wa-inbound-drain.js` (next to the sender actions)
- Modify: `database.rules.json` (add `waTextCustomers` like `waSenders`)
- Modify: `wa-inbound-panel.js` (box `#waInTextCustomers` + pure `lgWaInTextCustomersHtml(map)`)
- Modify: `admin.html` (CSS like `#waInSenders`)
- Test: `scripts/test-wa-free-text.js`, `scripts/test-wa-inbound-panel.js`

**Interfaces:**
- Produces:
  - POST `{channel:'whatsapp', action:'text-customer-add'|'text-customer-remove', customerId}`.
  - add: the card must exist (`unknown-customer`), then write `{customerName, addedAt, addedBy}`.
  - remove: `not-enabled` if absent.
  - The panel box is titled `הזמנות מטקסט חופשי`. It shows a line per customer (name, key, `הסר` button) and a picker with `הוסף` (reusing `accountMatches`/`renderAccList`, row attribute `data-tkey`). The box is always shown when the panel is open, including when the list is empty, with the hint `לקוחות שמזמינים בהודעה כמו "מראה 5 70 על 120" — ההזמנה תיפתח לבד בתור.`

- [ ] **Step 1: Write failing tests:**
  - `add writes the flag with the card name`
  - `add refuses unknown card`
  - `remove deletes`
  - `remove when absent → not-enabled`
  - `rules: waTextCustomers admin-read, .write false`
  - panel: `lgWaInTextCustomersHtml({888:{customerName:'x<b>'}})` escapes the name and has `data-tkey="888"` and `הסר`. An empty map still renders the hint and the add picker. The panel source listens to `waTextCustomers` and never writes it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Wire clicks (`button[data-tact]`) and extend the picker's row selector to `[data-gkey],[data-skey],[data-tkey]`.
- [ ] **Step 4: Run** both test files. Expected: PASS. Then check the box at 375px in the browser harness (`scratchpad/wa-senders-harness.html` pattern; add a `waTextCustomers` path): add → POST, row appears, no horizontal scroll, 44px buttons.
- [ ] **Step 5: Commit** `wa-free-text: קליטות — תיבת "הזמנות מטקסט חופשי" (הוסף/הסר לקוח), endpoint אדמיני וחוקים`

### Task 4: Ship

- [ ] **Step 1:** Run the full suite. The only accepted failures are the 6 that already fail on base (email-inbound, pdf-pages, 3 playwright UI, undefined-vars).
- [ ] **Step 2:**
  - Deploy the rules to TEST: diff them first, then run `deploy-rules-test.js`.
  - Merge into `test` and push. Wait for Vercel success. Check that `wa-inbound-panel.js` on luzglass-test contains `lgWaInTextCustomersHtml`.
- [ ] **Step 3: Production on Ben's OK.**
  - Rules: give Ben the desktop `.cmd` that runs the rules-put script, after diffing prod against main.
  - Give Ben the PR link.
  - After the merge, verify that the live asset has the new code.
