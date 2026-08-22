# Hardware Items Reach Hashavshevet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hardware (hinges, brackets, handles) syncs from Hashavshevet into the SKU catalogue and can be sent on an order document with a unit count instead of an area.

**Architecture:** Hardware already exists in Hashavshevet and already comes down in the same report call. One filter throws it away and one whitelist drops the field that says what kind of item it is. Restore both, teach the order API to read the catalogue, and make `buildLines` compute quantity from the item's type rather than assuming every item is glass.

**Tech Stack:** Vanilla JS, Vercel serverless functions (Node), Firebase RTDB, plain-node test scripts under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-08-21-shape-builder-design.md` — section "פרזול ותמחור" and "סדר הביצוע" stage 0.

## Global Constraints

- **No build step.** Vanilla HTML/CSS/JS. Never introduce a bundler, a framework, or a package that must be compiled.
- **Tests are plain node scripts** in `scripts/test-*.js`, run as `node scripts/test-x.js`, exit 1 on failure. They use a local `check(name, actual, expected)` helper. There is no test framework. Follow the shape of `scripts/test-hashavshevet-order.js` exactly.
- **Every suite must pass** before any commit: `for f in scripts/test-*.js; do node "$f" || echo "FAIL $f"; done`
- **`lgNormalizeOrder` is a whitelist.** Any order field not named there is dropped on the way to every page. Same for `LG_SKU_BUSINESS_FIELDS`.
- **Vercel does not deploy Firebase rules.** If rules change, run `node scripts/deploy-rules.js`. This plan does not change rules.
- **Hashavshevet field names are a signature contract.** The key order inside a line object feeds the MD5. Add keys deliberately, never reorder existing ones.
- **Hebrew comments**, matching the surrounding code. Test files are commented in English.
- **Item type values** come from Hashavshevet verbatim: `'מכפלה'` (area-priced, glass) and `'רגיל'` (unit-priced, hardware). Compare against these exact strings.

---

### Task 1: Hardware comes down from Hashavshevet

Today the sync keeps only `'מכפלה'` rows. The hardware rows arrive in the same response and are discarded, and `itemType` — which the API already returns — is dropped by a four-field whitelist before it reaches the catalogue.

**Files:**
- Modify: `api/hashavshevet-items.js:86`
- Modify: `firebase-db.js:1139`
- Modify: `admin.html:1517`
- Test: `scripts/test-sku-sync.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `skuCatalog/<CODE>.itemType` — a string, either `'מכפלה'` or `'רגיל'`, on every synced item. Task 2 reads it.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-sku-sync.js`:

```js
#!/usr/bin/env node
/**
 * Tests that hardware survives the trip from Hashavshevet into skuCatalog.
 *
 * Hardware was never missing from Hashavshevet. It came down in the same report
 * call as the glass and was discarded here:
 *
 *   .filter(r => r['שם פריט'] && r['סוג הפריט'] === 'מכפלה')
 *
 * with a comment saying "בשלב זה" — at this stage. This is the later stage.
 *
 * The second loss is quieter. The API returns itemType on every row, and
 * LG_SKU_BUSINESS_FIELDS lists four fields that may be written; itemType is not
 * among them, so it was computed, returned, and thrown away at the last step.
 * Same shape as lgNormalizeOrder dropping chisumArrivedIdxs.
 *
 * itemType is not decoration. It decides whether a line's quantity is an area
 * or a count — see scripts/test-hashavshevet-order.js.
 *
 * Run: node scripts/test-sku-sync.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ITEMS = read('api/hashavshevet-items.js');
const DB    = read('firebase-db.js');
const ADMIN = read('admin.html');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the filter no longer drops everything that is not glass ───────────── */
check('hardware rows are not filtered out',
      /'סוג הפריט'\] === 'מכפלה'/.test(ITEMS), false);
check('a row still needs a name and a code',
      /\.filter\(r => r\['שם פריט'\]\)/.test(ITEMS), true);
check('itemType is still returned', /itemType: r\['סוג הפריט'\]/.test(ITEMS), true);

/* ── and it survives the whitelist ─────────────────────────────────────── */
check('itemType may be written to the catalogue',
      /LG_SKU_BUSINESS_FIELDS\s+= \[[^\]]*'itemType'/.test(DB), true);
check('the sync passes it', /itemType: it\.itemType/.test(ADMIN), true);

/* ── the guess must not run on hardware ────────────────────────────────── */
/* lgGuessOperationalFromName reads '8 מ"מ שקוף מחוסם' and fills glass/mm/proc.
   Run against 'ציר קיר-זכוכית ניקל' it produces nonsense and marks it opAuto,
   which shows in the admin as an unverified guess on an item that has no
   operational fields at all. */
{
  const body = (DB.match(/async function syncSkuCatalogFromHashavshevet[\s\S]*?\n}/) || [''])[0];
  check('the operational guess is skipped for unit items',
        /if \(safe\.itemType !== 'רגיל'\)/.test(body), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll SKU-sync checks passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-sku-sync.js`
Expected: FAIL on `hardware rows are not filtered out`, `itemType may be written to the catalogue`, `the sync passes it`, and `the operational guess is skipped for unit items`.

- [ ] **Step 3: Remove the filter**

In `api/hashavshevet-items.js`, replace the comment and filter at lines 82–86:

```js
    // כל הפריטים — גם "מכפלה" (זכוכית, מחיר למ"ר) וגם "רגיל" (פרזול, מחיר
    // ליחידה). קודם ירדה רק זכוכית, וסוג הפריט הוא מה שקובע איך מחשבים כמות
    // בשורה שנשלחת לחשבשבת. ר' buildLines ב-api/hashavshevet-order.js.
    //
    // הערה: הדוח הנוכחי (netPassportID) לא מחזיר שדה "פעיל/לא פעיל" בכלל — אין
    // לפי מה לסנן לפי סטטוס פעיל עד שהדוח בחשבשבת יעודכן להכליל את העמודה הזו.
    const items = rows
      .filter(r => r['שם פריט'])
```

Leave the `.map(...)` and the trailing `.filter(it => it.code)` untouched.

- [ ] **Step 4: Let itemType through the whitelist**

In `firebase-db.js:1139`:

```js
const LG_SKU_BUSINESS_FIELDS    = ['name', 'hashavshevetCode', 'active', 'source', 'itemType'];
```

- [ ] **Step 5: Pass it from the sync**

In `admin.html:1517`:

```js
          await syncSkuCatalogFromHashavshevet(it.code, { name: it.name, hashavshevetCode: it.code, active: true, itemType: it.itemType });
```

- [ ] **Step 6: Stop guessing glass fields on hardware**

In `firebase-db.js`, inside `syncSkuCatalogFromHashavshevet`, wrap the guess. Replace:

```js
  const guess = lgGuessOperationalFromName(safe.name || existing.name || '');
  const opFill = {};
  LG_SKU_OPERATIONAL_FIELDS.forEach(k => { if (existing[k] === undefined && guess[k] !== undefined) opFill[k] = guess[k]; });
  if (Object.keys(opFill).length) opFill.opAuto = true;
```

with:

```js
  // הניחוש התפעולי קורא שם כמו '8 מ"מ שקוף מחוסם' וגוזר ממנו זכוכית, עובי
  // ועיבוד. על 'ציר קיר-זכוכית ניקל' הוא מייצר שטויות ומסמן אותן opAuto,
  // כלומר "ניחוש לא מאומת" — על פריט שאין לו שדות תפעוליים בכלל.
  const opFill = {};
  if (safe.itemType !== 'רגיל') {
    const guess = lgGuessOperationalFromName(safe.name || existing.name || '');
    LG_SKU_OPERATIONAL_FIELDS.forEach(k => { if (existing[k] === undefined && guess[k] !== undefined) opFill[k] = guess[k]; });
    if (Object.keys(opFill).length) opFill.opAuto = true;
  }
```

- [ ] **Step 7: Run the new test**

Run: `node scripts/test-sku-sync.js`
Expected: PASS, all checks.

- [ ] **Step 8: Run every suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add api/hashavshevet-items.js firebase-db.js admin.html scripts/test-sku-sync.js
git commit -m "feat: hardware syncs from Hashavshevet alongside the glass

The hardware was never missing from Hashavshevet — it arrived in the same
report call and was discarded by one filter, whose own comment said
\"בשלב זה\". This is the later stage.

The second loss was quieter: itemType is computed and returned by the API and
then dropped by LG_SKU_BUSINESS_FIELDS, a four-field whitelist. Same shape as
lgNormalizeOrder dropping chisumArrivedIdxs.

itemType is not decoration. It decides whether a line's quantity is an area or
a count.

The operational guess no longer runs on unit items: it reads names like
'8 מ\"מ שקוף מחוסם' to derive glass, thickness and process, and on
'ציר קיר-זכוכית ניקל' it produces nonsense flagged opAuto — an unverified guess
on an item with no operational fields at all."
```

---

### Task 2: The order API knows each item's type

`buildLines` must decide area-or-count per item. The type lives on `skuCatalog/<CODE>.itemType`, and the handler currently loads only the order and the prices.

**Files:**
- Modify: `api/hashavshevet-order.js:161-164` (the parallel load) and `:224-225` (the `buildLines` call)
- Test: `scripts/test-order-pricing.js` (extend)

**Interfaces:**
- Consumes: `skuCatalog/<CODE>.itemType` from Task 1.
- Produces: `buildLines(order, accountKey, reference, documentId, agent, globalPrices, clientPrices, skuTypes)` — an eighth parameter, `skuTypes`, a plain object mapping upper-case SKU code to its `itemType` string. Task 3 uses it.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-order-pricing.js`, immediately before the final `if (failed)` block:

```js
/* ── the handler must supply the item types ────────────────────────────── */
/* buildLines cannot tell a hinge from a pane without them, and the handler
   loaded only the order and the prices. */
check('the handler loads the SKU catalogue',
      /db\.ref\('skuCatalog'\)\.once\('value'\)/.test(SRC), true);
check('and passes the types to buildLines',
      /clientPricesByName\(prices\), skuTypes\)/.test(SRC), true);
check('the map is keyed by upper-case code',
      /skuTypes\[String\(k\)\.toUpperCase\(\)\]/.test(SRC), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-order-pricing.js`
Expected: FAIL on all three new checks.

- [ ] **Step 3: Load the catalogue**

In `api/hashavshevet-order.js`, replace the parallel load at lines 161–164:

```js
    const [orderSnap, pricesSnap, skuSnap] = await Promise.all([
      db.ref('orders/' + orderId).once('value'),
      db.ref('prices').once('value'),
      db.ref('skuCatalog').once('value'),
    ]);
```

- [ ] **Step 4: Build the type map and pass it**

In the same file, replace the `buildLines` call and the comment above it:

```js
    // סוג הפריט קובע אם הכמות היא שטח או מספר יחידות. הוא יושב על הקטלוג ולא
    // על הפריט שבהזמנה, כי הזמנות קיימות נשמרו לפניו — ר' Task 1 בתוכנית.
    const skuTypes = {};
    Object.entries(skuSnap.val() || {}).forEach(([k, v]) => {
      if (v && v.itemType) skuTypes[String(k).toUpperCase()] = v.itemType;
    });

    // prices.clients, לא prices.client — הצומת הוא ברבים. הטעות הזו הפכה את
    // מחירון הלקוח ל-undefined, וכל מחיר נפל לגלובלי: 190 במקום 171 ל"המקום
    // לאמבט". היא לא הזיקה כל עוד המחיר לא נשלח בכלל.
    const { lines, preview, skipped } = buildLines(order, accountKey, ref.reference,
      documentId, agent, prices.global, clientPricesByName(prices), skuTypes);
```

- [ ] **Step 5: Accept the parameter**

In the same file, change the `buildLines` signature:

```js
function buildLines(order, accountKey, reference, documentId, agent, globalPrices, clientPrices, skuTypes) {
```

The body does not use it yet — Task 3 does. This step only threads it through.

- [ ] **Step 6: Run the tests**

Run: `node scripts/test-order-pricing.js && node scripts/test-hashavshevet-order.js`
Expected: PASS. The pricing suite runs `buildLines` directly with seven arguments; the eighth is `undefined`, and nothing reads it yet.

- [ ] **Step 7: Run every suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add api/hashavshevet-order.js scripts/test-order-pricing.js
git commit -m "refactor: the order API loads the SKU catalogue

buildLines has to decide whether a line's quantity is an area or a unit count,
and the type lives on skuCatalog/<CODE>.itemType. The handler loaded only the
order and the prices.

The type is read from the catalogue rather than from the item on the order,
because orders written before this exists carry no such field.

Threaded through only — the body still computes area for everything. The next
commit uses it."
```

---

### Task 3: Quantity follows the item's type

`buildLines` computes `areaM2(item.w, item.h)` for every item and skips anything that comes out zero, with the reason "שטח 0 — חסרות מידות". A hinge has no width or height, so every hardware line would vanish from the document silently — the same class of fault as the missing price fixed on 21/08.

**Files:**
- Modify: `api/hashavshevet-order.js` — `buildLines` body
- Test: `scripts/test-order-pricing.js` (extend)

**Interfaces:**
- Consumes: `skuTypes` from Task 2.
- Produces: order lines whose `Quantity` is a unit count for `'רגיל'` items and an area in m² for everything else.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-order-pricing.js`, before the final `if (failed)` block:

```js
/* ── a hinge is counted, not measured ──────────────────────────────────── */
/*
 * areaM2 for every item was safe only while every item was glass. A hinge has
 * no width and no height, so its area is 0 and it was skipped as
 * "שטח 0 — חסרות מידות" — the document would go out complete-looking and
 * missing all its hardware.
 *
 * The type comes from the catalogue, and 'רגיל' is Hashavshevet's own word for
 * a unit-priced item.
 */
const TYPES = { '8SMH': 'מכפלה', 'HNG-GG-N': 'רגיל' };
const HW_ORDER = {
  orderNum: 'L9001', orderClient: 'המקום לאמבט',
  items: [
    { sku: '8SMH',     w: 110, h: 220, glassFullName: '8 מ"מ שקוף מחוסם' },
    { sku: 'HNG-GG-N', quantity: 2,    glassFullName: 'ציר זכוכית-זכוכית ניקל' },
  ],
};
const HW_PRICES = {
  global:     { '8SMH': 190, 'HNG-GG-N': 45 },
  clients:    { '14201': { '8SMH': 171, 'HNG-GG-N': 40 } },
  clientKeys: { '14201': 'המקום לאמבט' },
};
{
  const { lines, skipped } = ctx.buildLines(HW_ORDER, '14201', '9001', '31', '1',
    HW_PRICES.global, ctx.clientPricesByName(HW_PRICES), TYPES);

  check('the hinge is not skipped for want of dimensions', skipped.length, 0);
  check('both lines are sent', lines.length, 2);
  check('the glass is still measured', lines[0].Quantity, '0.024');
  check('the hinge is counted', lines[1].Quantity, '2.000');
  check('and priced per unit from the client list', lines[1].price, '40.000');
  /* a unit item with no quantity at all means one of it, not none */
  const single = { ...HW_ORDER, items: [{ sku: 'HNG-GG-N', glassFullName: 'ציר' }] };
  const one = ctx.buildLines(single, '14201', '9001', '31', '1',
    HW_PRICES.global, ctx.clientPricesByName(HW_PRICES), TYPES);
  check('a unit item with no count defaults to one', one.lines[0].Quantity, '1.000');
  /* an unknown type is treated as glass — the safe default, because every item
     in every order written before this was glass */
  const unknown = ctx.buildLines(ORDER_1058, '14201', '1058', '31', '1',
    PRICES.global, ctx.clientPricesByName(PRICES), {});
  check('an item of unknown type is still measured', unknown.lines[0].Quantity, '0.024');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-order-pricing.js`
Expected: FAIL — `the hinge is not skipped for want of dimensions` expects 0 and gets 1; `both lines are sent` expects 2 and gets 1.

- [ ] **Step 3: Compute quantity by type**

In `api/hashavshevet-order.js`, inside `buildLines`, replace:

```js
    const qty = areaM2(item.w || 0, item.h || 0);
    if (!qty) { skipped.push({ name, sku, reason: 'שטח 0 — חסרות מידות' }); return; }
```

with:

```js
    // "רגיל" בחשבשבת = פריט שנמכר ביחידות (פרזול). "מכפלה" = לפי מ"ר (זכוכית).
    // בלי ההבחנה הזו לציר יוצא שטח 0 והוא מדולג — המסמך יוצא שלם למראה
    // ובלי שום פרזול. סוג שאינו מוכר נחשב זכוכית, כי כל פריט בכל הזמנה
    // שנכתבה עד היום הוא זכוכית.
    const isUnit = String((skuTypes || {})[String(sku).toUpperCase()] || '') === 'רגיל';
    const qty = isUnit ? Number(item.quantity || 1) : areaM2(item.w || 0, item.h || 0);
    if (!qty) {
      skipped.push({ name, sku, reason: isUnit ? 'כמות 0' : 'שטח 0 — חסרות מידות' });
      return;
    }
```

- [ ] **Step 4: Run the tests**

Run: `node scripts/test-order-pricing.js`
Expected: PASS, all checks.

- [ ] **Step 5: Run every suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add api/hashavshevet-order.js scripts/test-order-pricing.js
git commit -m "fix: a hinge is counted, not measured

buildLines computed areaM2 for every item and skipped anything that came out
zero with the reason 'שטח 0 — חסרות מידות'. A hinge has no width and no
height, so every hardware line would have vanished and the document would have
gone out looking complete and carrying no hardware at all.

That is the same fault as the missing price on 21/08: a calculation that
assumed one thing about every item.

'רגיל' is Hashavshevet's own word for a unit-priced item and comes from their
catalogue, not from us. An unknown type is measured as glass — the safe
default, because every item in every order written until now is glass."
```

---

### Task 4: Verify against Hashavshevet with one real hinge

Everything above rests on one assumption that has never been tested against Hashavshevet: **that a `'רגיל'` item is accepted with `Quantity` as a unit count and `price` per unit.** On 20/08 an assumption of exactly this kind was asserted by a test and shipped a price of 0. This task is a manual verification, performed by the operator.

**Files:**
- None. This task changes no code.

**Interfaces:**
- Consumes: Tasks 1–3, deployed.
- Produces: a confirmed or refuted answer to the open question in the spec.

- [ ] **Step 1: Deploy**

```bash
git push origin main
```

Then wait for Vercel and confirm the change is live:

```bash
curl -s https://luzglass.vercel.app/firebase-db.js | grep -c "'itemType'"
```

Expected: `1`.

- [ ] **Step 2: Sync the catalogue**

In the admin, run the Hashavshevet item sync. Then confirm hardware arrived:

```bash
node -e "
const {initializeApp,cert}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
initializeApp({credential:cert(require('./scripts/serviceAccountKey.json')),
  databaseURL:'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'});
getDatabase().ref('skuCatalog').once('value').then(s=>{
  const v=s.val()||{}, e=Object.entries(v);
  const byType={};
  e.forEach(([k,o])=>{ const t=(o&&o.itemType)||'(none)'; (byType[t]=byType[t]||[]).push(k); });
  Object.entries(byType).forEach(([t,ks])=>console.log(t, ks.length, ks.slice(0,5).join(', ')));
  process.exit(0);
});"
```

Expected: a `רגיל` group with hardware codes in it. If it is empty, the report in Hashavshevet does not include hardware rows and **stop here** — the rest of the plan cannot be verified, and the report needs extending on the Hashavshevet side first.

- [ ] **Step 3: Build one test order**

In the admin sketch queue, open any order and add two items: one glass item as usual, and one hardware item using a SKU from the `רגיל` group with quantity 2. Mark the order **fictitious** (🧪 הזמנה פיקטיבית) first — a simulated run exercises the entire path including the recorded attempt, and creates nothing that needs cancelling in the books.

- [ ] **Step 4: Send it and read what was built**

Press "הועבר לחשבשבת". Then read the recorded request:

```bash
node -e "
const {initializeApp,cert}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
initializeApp({credential:cert(require('./scripts/serviceAccountKey.json')),
  databaseURL:'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app'});
getDatabase().ref('orders').once('value').then(s=>{
  s.forEach(c=>{ const o=c.val()||{};
    if(o.hashavshevet) console.log(o.orderNum, JSON.stringify(o.hashavshevet.requestSample), 'skipped:', JSON.stringify(o.hashavshevet.skipped));
  });
  process.exit(0);
});"
```

Expected: `skipped` is `null`, and the hardware line carries `"Quantity":"2.000"` with a non-zero `price`.

- [ ] **Step 5: Send one for real and check the document**

Repeat on a **non-fictitious** order with a single hardware line. Open the document in Hashavshevet and confirm the hinge appears with quantity 2 and the price from the client's list.

**If the quantity or the price is wrong**, record what Hashavshevet actually shows and stop. The assumption in Task 3 is refuted and the mapping in the spec's stage 2 must not be built on it.

- [ ] **Step 6: Record the answer in the spec**

Edit `docs/superpowers/specs/2026-08-21-shape-builder-design.md`, in "שאלות פתוחות", replacing the second question with what was observed. Commit:

```bash
git add docs/superpowers/specs/2026-08-21-shape-builder-design.md
git commit -m "docs: a regular item is accepted with a unit count — verified"
```

---

## Notes for whoever executes this

**The invoice API is deliberately untouched.** `api/hashavshevet-invoice.js` builds its lines from `order.lockedItems`, and hardware does not reach `lockedItems` yet — `lgLockAndAdvance` writes glass. When hardware becomes part of an order for real, that file needs the same quantity-by-type rule, and its `buildLines` has its own copy of the area calculation. It is not in this plan because there is nothing to exercise it with, and a change nothing can test is a change nobody can trust.

**Nothing here produces hardware items.** That is the shape builder's job, in the next plan. What this plan buys is that when hardware does appear on an order, it reaches Hashavshevet correctly — and that the assumption underneath is verified before anything is built on top of it.
