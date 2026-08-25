# Monthly Billing (שוטף 30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client can be marked שוטף 30, which stops the per-delivery invoice question and lets the admin issue one consolidated invoice for everything that client has collected and not yet been billed for.

**Architecture:** A client-level flag following the exact shape of the existing `isDelivery` flag, one branch in the finish-delivery dialog, a new admin screen that searches for a client and populates the existing invoice selection, and a running reference number for consolidated invoices. Nothing new is invented: the propagation helper, the invoice preview/send chain and the counter pattern all already exist.

**Tech Stack:** Vanilla JS, Firebase RTDB, Vercel serverless functions (Node), plain-node test scripts under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-08-25-monthly-billing-design.md`

## Global Constraints

- **No build step.** Vanilla HTML/CSS/JS. Never introduce a bundler, a framework, or a compiled dependency.
- **Tests are plain node scripts** in `scripts/test-*.js`, run as `node scripts/test-x.js`, exit 1 on failure, using a local `check(name, actual, expected)` helper. There is no test framework. Follow the shape of `scripts/test-invoice.js`.
- **Three suites fail before you start** — `test-hashavshevet-order.js`, `test-order-pricing.js`, `test-sketch-storage.js` — for a line-ending reason unrelated to this work (`core.autocrlf=true` writes CRLF on checkout while editors write LF, and some regexes contain a literal `\n`). Do not try to fix them, and do not count them as your failures. Every OTHER suite must pass before any commit.
- **`lgNormalizeOrder` is a whitelist.** A field not named there is silently dropped on the way to every screen. This has bitten four times: `chisumArrivedIdxs`, `itemType`, `pickedDate`, `hashavshevetInvoice`.
- **Hebrew comments** in application code, matching the surrounding style. Test files are commented in English.
- **No font-size below 12px** anywhere — `test-pages-ui.js` fails on it.
- **Touch targets 44px minimum**, 8px between them.
- **Money order of operations:** the stage moves to `collected` only after an invoice succeeds. Never before.
- **Do not change `database.rules.json`.** Nothing in this plan needs it; the invoice API writes through the Admin SDK, which bypasses rules.

---

### Task 1: The client flag

`users/<phone>.isDelivery` already exists as a client-level flag with a toggle button, a propagation helper and a slot in the normaliser. `monthlyBilling` follows it exactly.

**Files:**
- Modify: `admin.html` — the user-manager row (~line 3923), `umToggleDelivery` (~line 3960), `_propagateDeliveryToOrders` (~line 3981)
- Modify: `firebase-db.js` — `lgNormalizeOrder`
- Test: `scripts/test-monthly-billing.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `users/<phone>.monthlyBilling` (boolean), denormalised to `order.monthlyBilling` (boolean), carried by `lgNormalizeOrder`. Tasks 2 and 4 read `order.monthlyBilling`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-monthly-billing.js`:

```js
#!/usr/bin/env node
/**
 * Tests monthly billing — שוטף 30.
 *
 * Some clients collect orders through the month and are billed once at the end.
 * Today every collected order asks whether to invoice, which for such a client
 * is the same needless question twenty times.
 *
 * The flag is not a new mechanism. users.isDelivery already does exactly this:
 * a toggle in the user manager, _propagateDeliveryToOrders to reach orders that
 * already exist (keyed on phone, not name — names change), and a slot in
 * lgNormalizeOrder. monthlyBilling follows it line for line.
 *
 * The whitelist slot is the part worth guarding. A field not named in
 * lgNormalizeOrder is dropped on the way to every screen, and that has cost
 * four separate bugs here: chisumArrivedIdxs, itemType, pickedDate and
 * hashavshevetInvoice.
 *
 * Run: node scripts/test-monthly-billing.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = read('admin.html');
const DB    = read('firebase-db.js');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (src, name) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── the flag survives to every screen ─────────────────────────────────── */
{
  const norm = bodyOf(DB, 'lgNormalizeOrder');
  check('monthlyBilling is in the whitelist',
        /monthlyBilling: !!o\.monthlyBilling,/.test(norm), true);
}

/* ── the toggle, following isDelivery exactly ──────────────────────────── */
check('there is a toggle', /async function umToggleMonthly\(/.test(ADMIN), true);
check('it writes the flag on the user',
      /update\(\{ monthlyBilling: newVal, updatedAt: Date\.now\(\) \}\)/.test(ADMIN), true);
/* keyed on phone, because a client's name can change and their phone is the
   identifier every order carries */
check('and propagates by phone, not name',
      /_propagateMonthlyToOrders\(user\.phone, newVal\)/.test(ADMIN), true);
check('the button is on the row', /umToggleMonthly\('\$\{u\.id\}'/.test(ADMIN), true);
check('and the row says when it is on', /שוטף 30/.test(ADMIN), true);

/* ── propagation reaches orders that already exist ─────────────────────── */
{
  const prop = bodyOf(ADMIN, '_propagateMonthlyToOrders');
  check('propagation exists', prop.length > 0, true);
  check('it matches orders by phone',
        /o\.clientPhone === phone \|\| o\.phone === phone/.test(prop), true);
  check('and only writes where the value differs',
        /if\(!!o\.monthlyBilling !== !!isMonthly\)/.test(prop), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll monthly-billing checks passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-monthly-billing.js`
Expected: FAIL on every check — none of the code exists yet.

- [ ] **Step 3: Add the field to the whitelist**

In `firebase-db.js`, inside `lgNormalizeOrder`, immediately after the line `deliveryClient: !!o.deliveryClient,`:

```js
    // שוטף 30 — הלקוח אוסף לאורך החודש ומחויב פעם אחת בסופו. מסומן על
    // ההזמנה ולא רק על הלקוח, כדי שהזמנה תזכור באיזה משטר היא נפתחה גם
    // אם ההגדרה של הלקוח תשתנה מאוחר יותר.
    monthlyBilling: !!o.monthlyBilling,
```

- [ ] **Step 4: Add the propagation helper**

In `admin.html`, immediately after the closing brace of `_propagateDeliveryToOrders`:

```js
// מפזר את דגל שוטף 30 להזמנות קיימות. לפי טלפון ולא לפי שם — שם לקוח
// משתנה, והטלפון הוא המזהה שכל הזמנה נושאת. זהה במבנה ל-
// _propagateDeliveryToOrders; אם אחד מהם משתנה, שנה את שניהם.
async function _propagateMonthlyToOrders(phone, isMonthly){
  if(!phone) return;
  const updates = {};
  orders.forEach(o => {
    if(o.clientPhone === phone || o.phone === phone){
      if(!!o.monthlyBilling !== !!isMonthly) updates['orders/' + o.id + '/monthlyBilling'] = !!isMonthly;
    }
  });
  if(Object.keys(updates).length) await firebase.database().ref().update(updates);
}
```

- [ ] **Step 5: Add the toggle**

In `admin.html`, immediately after the closing brace of `umToggleDelivery`:

```js
// שוטף 30 — אותו דפוס בדיוק כמו umToggleDelivery.
async function umToggleMonthly(userId, clientName, currentVal){
  const newVal = !currentVal;
  const label  = newVal ? 'שוטף 30' : 'חיוב רגיל';
  if(!confirm(`לשנות את ${clientName} ל${label}?\n\n${newVal
    ? 'בסיום הובלה לא תישאל יותר שאלת החשבונית — ההזמנה תעבור לנאסף, והחשבונית תופק מרוכזת.'
    : 'ההגדרה תוסר, ושאלת החשבונית תחזור להישאל בכל סיום הובלה.'}`)) return;
  try {
    const snap = await firebase.database().ref('users/' + userId).once('value');
    const user = snap.val();
    if(!user){ showToast('לא נמצא משתמש'); return; }
    await firebase.database().ref('users/' + userId).update({ monthlyBilling: newVal, updatedAt: Date.now() });
    await _propagateMonthlyToOrders(user.phone, newVal);
    showToast(`✓ ${clientName} עודכן ל${label}`);
    _loadUsers();
  } catch(e){ showToast('שגיאה: ' + e.message); }
}
```

Note the difference from `umToggleDelivery`: propagation runs when the flag is turned **off** as well as on. Delivery deliberately leaves old orders alone; billing must not, or an order would keep asking the invoice question after the client moved to monthly.

- [ ] **Step 6: Add the badge and the button to the row**

In `admin.html`, in the user-manager row, after the `🚚 הובלות` badge line:

```js
          ${u.monthlyBilling?'<span style="font-size:12px;color:var(--gold-text)">📅 שוטף 30</span>':''}
```

And after the `umToggleDelivery` button, inside the same `${u.role==='client' ? ...}` block:

```js
          <button onclick="umToggleMonthly('${u.id}','${lgJsStr(u.businessName||u.name)}',${!!u.monthlyBilling})"
            title="${u.monthlyBilling ? 'בטל שוטף 30' : 'הגדר כשוטף 30'}"
            style="padding:4px 8px;background:${u.monthlyBilling?'rgba(184,146,42,0.15)':'rgba(0,0,0,0.04)'};border:1px solid ${u.monthlyBilling?'rgba(184,146,42,0.4)':'rgba(0,0,0,0.1)'};color:${u.monthlyBilling?'var(--gold-text)':'#aaa'};font-family:Heebo,sans-serif;font-size:12px;cursor:pointer;border-radius:4px;">📅</button>
```

- [ ] **Step 7: Run the new test**

Run: `node scripts/test-monthly-billing.js`
Expected: PASS, all checks.

- [ ] **Step 8: Run every other suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: exactly the three known pre-existing failures listed in Global Constraints, and nothing else.

- [ ] **Step 9: Commit**

```bash
git add admin.html firebase-db.js scripts/test-monthly-billing.js
git commit -m "feat: a client can be marked שוטף 30

Follows users.isDelivery exactly — a toggle in the user manager, propagation to
existing orders keyed on phone rather than name, and a slot in
lgNormalizeOrder. Nothing new is invented; the hard part, reaching orders that
already exist, is already solved.

The whitelist slot is not optional. A field not named in lgNormalizeOrder is
dropped on the way to every screen, which has cost four separate bugs here.

One deliberate difference from the delivery flag: propagation runs when the
flag is turned off as well as on. Delivery leaves old orders alone; billing
cannot, or an order would keep asking the invoice question after the client had
moved to monthly."
```

---

### Task 2: The question that stops being asked

At the end of a delivery the dialog asks whether to invoice. For a שוטף 30 client that question has one answer, twenty times a month.

**Files:**
- Modify: `workday.html` — `showClientDeliveryPrompt`
- Test: `scripts/test-monthly-billing.js` (extend)

**Interfaces:**
- Consumes: `order.monthlyBilling` from Task 1.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-monthly-billing.js`, before the final `if (failed)` block:

```js
/* ── the question that stops being asked ───────────────────────────────── */
/*
 * For a שוטף 30 client the finish-delivery dialog does not ask about an
 * invoice — the order goes straight to collected and waits for the monthly
 * run. For everyone else the dialog is untouched, which is the whole point:
 * this is the only existing behaviour the feature changes.
 *
 * The flag is read from the order, not from the client record, because the
 * order carries the regime it was opened under.
 */
{
  const WD  = read('workday.html');
  const fn  = bodyOf(WD, 'showClientDeliveryPrompt');
  check('the dialog checks the flag', /o\.monthlyBilling/.test(fn), true);
  check('a monthly client skips straight to collected',
        /finalizeDelivery\(id, false\)\);\s*return;/.test(fn), true);
  /* silence would look like nothing happened */
  check('and is told what happened',
        /שוטף 30/.test(fn), true);
  /* the ordinary path must survive untouched */
  check('everyone else still gets the choice',
        /_cldInv'\)\.onclick/.test(fn), true);
  check('and can still issue from there',
        /_deliveryInvoice\(orderIds\)/.test(fn), true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-monthly-billing.js`
Expected: FAIL on `the dialog checks the flag`, `a monthly client skips straight to collected` and `and is told what happened`.

- [ ] **Step 3: Add the branch**

In `workday.html`, inside `showClientDeliveryPrompt`, immediately after the line `const clientName = firstO?.orderClient || '—';`:

```js
  // שוטף 30 — לא שואלים. ההזמנה עוברת לנאסף וממתינה להפקה המרוכזת במסך
  // "הפקת חשבונית" באדמין. הדגל נקרא מההזמנה ולא מרשומת הלקוח, כי ההזמנה
  // נושאת את המשטר שבו נפתחה.
  if(firstO && firstO.monthlyBilling){
    orderIds.forEach(id => finalizeDelivery(id, false));
    showToast('✓ הובלה הושלמה — ' + lgEsc(clientName) + ' בשוטף 30, החשבונית תופק מרוכזת');
    return;
  }
```

- [ ] **Step 4: Run the test**

Run: `node scripts/test-monthly-billing.js`
Expected: PASS, all checks.

- [ ] **Step 5: Run every other suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: only the three known pre-existing failures.

- [ ] **Step 6: Commit**

```bash
git add workday.html scripts/test-monthly-billing.js
git commit -m "feat: a שוטף 30 client is not asked about an invoice per delivery

The order goes straight to collected and waits for the monthly run. For every
other client the dialog is untouched — this is the only existing behaviour the
feature changes, and it is one question that stops being asked.

The flag is read from the order rather than the client record, because the
order carries the regime it was opened under. A toast still says what happened;
silence would read as nothing having happened at all."
```

---

### Task 3: A consolidated invoice gets its own reference

`toReference(first.orderNum)` gives a monthly invoice covering twenty orders the number of whichever order happened to be first — and that number is already carried by that order's own document in Hashavshevet. Order 1061 has an order document with reference 1061; its invoice took 1061 too.

**Files:**
- Modify: `api/hashavshevet-invoice.js` — the reference block (~line 200)
- Test: `scripts/test-invoice.js` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `meta/invoiceCounter` in Firebase — a number, incremented by a transaction. Reference strings are its value as a string.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-invoice.js`, before the final `if (failed)` block:

```js
/* ── a consolidated invoice gets its own number ────────────────────────── */
/*
 * The reference was the first order's number. For one order that is right and
 * convenient — you see an invoice and know which order it belongs to. For
 * twenty it is arbitrary, and it collides: order 1061 already carries
 * reference 1061 on its own order document in Hashavshevet, and its invoice
 * took 1061 as well.
 *
 * A consolidated invoice takes a running number of its own, from the same
 * transaction pattern as meta/orderCounter. A single-order invoice is left
 * exactly as it was.
 */
check('a consolidated invoice uses its own counter',
      /const ref = orders\.length > 1[\s\S]{0,200}?nextInvoiceRef\(db\)/.test(SRC), true);
check('a single-order invoice keeps the order number',
      /: toReference\(first\.orderNum\);/.test(SRC), true);
{
  const fn = (SRC.match(/async function nextInvoiceRef[\s\S]*?\n}/) || [''])[0];
  check('the counter is a transaction, not a read-then-write',
        /\.transaction\(/.test(fn), true,
        'two invoices issued at once would otherwise take the same number');
  check('it never goes backwards',
        /Math\.max\(current \|\| 0, 5000\) \+ 1/.test(fn), true);
  check('and it is a separate node from the order counter',
        /meta\/invoiceCounter/.test(fn), true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-invoice.js`
Expected: FAIL on all five new checks.

- [ ] **Step 3: Add the counter**

In `api/hashavshevet-invoice.js`, immediately after the `toReference` function:

```js
// מונה אסמכתאות לחשבוניות מרוכזות. אותה תבנית של meta/orderCounter —
// transaction ולא קריאה-ואז-כתיבה, אחרת שתי חשבוניות שיופקו באותו רגע
// יקבלו את אותו מספר. מתחיל ב-5001 כדי שלא יתבלבל עם מספרי הזמנות.
async function nextInvoiceRef(db) {
  const result = await db.ref('meta/invoiceCounter').transaction(current =>
    Math.max(current || 0, 5000) + 1);
  return { ok: true, reference: String(result.snapshot.val()) };
}
```

- [ ] **Step 4: Use it for consolidated invoices only**

In the same file, replace:

```js
    // האסמכתא היא של ההזמנה הראשונה; כל המספרים נרשמים אצלנו על כל הזמנה
    const ref = toReference(first.orderNum);
```

with:

```js
    // חשבונית על הזמנה אחת נושאת את מספר ההזמנה — נוח, ומצביע חזרה על
    // המקור. חשבונית שמכסה כמה הזמנות מקבלת מספר משלה: לקחת את הראשונה
    // מבין עשרים הוא שרירותי, והמספר הזה כבר תפוס על מסמך ההזמנה שלה.
    const ref = orders.length > 1
      ? await nextInvoiceRef(db)
      : toReference(first.orderNum);
```

- [ ] **Step 5: Run the test**

Run: `node scripts/test-invoice.js`
Expected: PASS, all checks.

- [ ] **Step 6: Run every other suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: only the three known pre-existing failures.

- [ ] **Step 7: Commit**

```bash
git add api/hashavshevet-invoice.js scripts/test-invoice.js
git commit -m "feat: a consolidated invoice gets its own reference

The reference was the first order's number. For one order that is right — you
see an invoice and know which order it belongs to. For twenty it is arbitrary,
and it collides: order 1061 already carries reference 1061 on its own order
document, and its invoice took 1061 as well.

A consolidated invoice now takes a running number from meta/invoiceCounter,
using the same transaction the order counter uses — read-then-write would give
two invoices issued at the same moment the same number. Single-order invoices
are untouched."
```

---

### Task 4: The issuing screen

A flow, not a browse: start empty, search for a client, see their uninvoiced collected orders, issue one invoice. The preview and send chain already exists — `invPreview()` reads the `invSel` Set — so this screen fills that Set and calls it. No second copy of the money path.

**Files:**
- Modify: `admin.html` — a new overlay, a nav entry, and the render functions
- Test: `scripts/test-monthly-billing.js` (extend)

**Interfaces:**
- Consumes: `order.monthlyBilling` from Task 1; the existing globals `orders`, `invSel`, `invSelClient`, and the existing functions `invPreview()`, `lgCalcOrderTotal(order, globalPrices, clientPrices)`, `lgSketchIntoImg(imgEl, order, onSrc)`, `showToast(msg)`.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-monthly-billing.js`, before the final `if (failed)` block:

```js
/* ── the issuing screen ────────────────────────────────────────────────── */
/*
 * A flow, not a browse. It starts empty and you search for one client — the
 * action is "invoice this client", not "survey everyone".
 *
 * "Not yet billed" is not a new field. The invoice API already refuses to
 * invoice an order twice by checking hashavshevetInvoice.sentAt, so the same
 * fact defines the list. No new state, nothing that can drift out of sync, and
 * double billing stays blocked on the server rather than in this screen.
 */
{
  const fn = bodyOf(ADMIN, '_billFilterOrders');
  check('the list is collected orders only', /o\.stage === 'collected'/.test(fn), true);
  check('and only those not yet billed',
        /!\(o\.invoice && o\.invoice\.sentAt\)/.test(fn), true);

  check('there is a screen', /id="billOv"/.test(ADMIN), true);
  check('it starts with no client chosen', /let _billClient = null;/.test(ADMIN), true);
  check('and is reached from the menu', /openBillBoard\(\)/.test(ADMIN), true);

  const list = bodyOf(ADMIN, '_renderBillClients');
  check('only clients with something to bill are listed',
        /if\(!list\.length\) return;/.test(list), true);
  check('the search filters by client name',
        /_billSearch/.test(list), true);
  /* a Hebrew client name must not be assembled into an inline onclick — the
     codebase already avoids this, see the data-ids buttons in workday.html */
  check('the client name travels in a data attribute',
        /data-client="\$\{?lgEsc\(c\)/.test(list) || /'data-client="' \+ lgEsc\(c\)/.test(list), true);

  const det = bodyOf(ADMIN, '_renderBillClient');
  check('every order starts selected', /invSel\.add\(String\(o\.id\)\)/.test(det), true);
  check('the sketch carries an id and no src',
        /data-sketch-for="\$\{lgEsc\(String\(o\.id\)\)\}"/.test(det), true);
  check('and is filled only when a row is opened',
        /if\(d\.open\) _hydrateBillSketches\(d\)/.test(det), true);

  /* reuse, not a second copy of the money path */
  check('issuing goes through the existing preview',
        /onclick="invPreview\(\)"/.test(ADMIN), true);

  /* the running total has to be announced, not only drawn */
  check('the total is announced to a screen reader',
        /id="billTotal" aria-live="polite"/.test(ADMIN), true);
  /* colour alone must not carry meaning */
  check('a selected row says so in words, not only in colour',
        /נבחרו \$\{/.test(ADMIN), true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-monthly-billing.js`
Expected: FAIL on every new check.

- [ ] **Step 3: Add the overlay markup**

In `admin.html`, immediately before the closing `</body>` tag:

```html
<!-- הפקת חשבונית — תהליך ולא רשימה. מתחיל ריק; בוחרים לקוח אחד. -->
<div id="billOv" class="ov">
  <div class="ov-panel">
    <div class="ov-head">
      <h2 style="display:flex;align-items:center;gap:8px"><span>🧾</span>הפקת חשבונית</h2>
      <button class="mcl" onclick="closeBillBoard()" aria-label="סגור"><span data-icon="x"></span></button>
    </div>
    <div id="billBody" class="ov-body"></div>
  </div>
</div>
```

- [ ] **Step 4: Add the styles**

In `admin.html`, immediately before the closing `</style>` of the main stylesheet:

```css
/* מסך הפקת חשבונית */
#billOv{position:fixed;inset:0;background:rgba(26,23,20,0.6);z-index:820;display:none;}
#billOv.open{display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;}
#billOv .ov-panel{background:var(--surface);border-radius:10px;max-width:640px;width:100%;
                  max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;}
#billOv .ov-head{padding:16px 18px;border-bottom:1px solid var(--border);
                 display:flex;align-items:center;justify-content:space-between;}
#billOv .ov-body{padding:16px 18px;overflow-y:auto;}
.bill-search{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;margin-bottom:12px;
             border:1px solid var(--border);border-radius:6px;background:var(--bg);
             font-family:Heebo,sans-serif;font-size:16px;color:var(--text);outline:none;direction:rtl;}
.bill-search:focus{border-color:var(--gold-text);box-shadow:0 0 0 3px rgba(184,146,42,0.15);}
.bill-cli{display:flex;align-items:center;justify-content:space-between;gap:10px;
          min-height:44px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;
          background:var(--bg);margin-bottom:6px;cursor:pointer;width:100%;
          font-family:Heebo,sans-serif;font-size:14px;color:var(--text);text-align:right;}
.bill-cli:hover{background:var(--bg2);}
.bill-cli:focus-visible{outline:2px solid var(--gold-text);outline-offset:1px;}
.bill-cli-n{font-weight:700;}
.bill-cli-s{font-size:13px;color:var(--muted);white-space:nowrap;}
.bill-row{border:1px solid var(--border);border-radius:6px;margin-bottom:6px;overflow:hidden;}
.bill-row-top{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:44px;}
.bill-row-top input{width:20px;height:20px;flex-shrink:0;cursor:pointer;}
.bill-row-t{flex:1;min-width:0;font-size:13px;color:var(--text);}
.bill-row-a{font-size:13px;font-weight:700;color:var(--gold-text);white-space:nowrap;}
.bill-det>summary{min-height:44px;display:flex;align-items:center;padding:0 12px;
                  font-size:13px;font-weight:700;color:var(--gold-text);cursor:pointer;
                  outline:none;direction:rtl;list-style:none;border-top:1px solid var(--border);}
.bill-det>summary::-webkit-details-marker{display:none;}
.bill-det>summary:focus-visible{outline:2px solid var(--gold-text);outline-offset:-2px;}
.bill-item{font-size:12px;color:#555;padding:1px 12px;}
.bill-sk{width:100%;max-height:110px;min-height:60px;object-fit:contain;display:block;
         border:1px solid var(--border);border-radius:4px;background:var(--bg2);
         margin:6px 12px 8px;cursor:zoom-in;opacity:0;transition:opacity 200ms ease;}
.bill-sk.is-loaded{opacity:1;}
.bill-foot{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--border);
           padding:12px 0 0;margin-top:12px;}
.bill-sum{font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px;}
@media (prefers-reduced-motion:reduce){ .bill-sk{transition:none;opacity:1;} }
```

- [ ] **Step 5: Add the render functions**

In `admin.html`, immediately before `function renderPickupBoard(){`:

```js
// ── הפקת חשבונית ───────────────────────────────────────────────────────
//
//  תהליך ולא סקירה: מתחיל ריק, מחפשים לקוח, ורואים רק את שלו.
//
//  "לא חויב" אינו שדה חדש. ה-API כבר מסרב לחייב הזמנה פעמיים לפי
//  hashavshevetInvoice.sentAt, ולכן אותה עובדה מגדירה את הרשימה — אין מצב
//  חדש לתחזק, ואין סנכרון שיכול להתפצל. חיוב כפול נשאר חסום בשרת.
let _billClient = null;
let _billSearch = '';

function _billFilterOrders(){
  return orders.filter(o => o.stage === 'collected' && !(o.invoice && o.invoice.sentAt));
}

function openBillBoard(){
  _billClient = null; _billSearch = '';
  invSel.clear(); invSelClient = null;
  document.getElementById('billOv').classList.add('open');
  renderBillBoard();
}
function closeBillBoard(){
  document.getElementById('billOv').classList.remove('open');
  invSel.clear(); invSelClient = null;
}

function renderBillBoard(){
  const el = document.getElementById('billBody');
  if(!el) return;
  if(_billClient) _renderBillClient(el); else _renderBillClients(el);
}

function _renderBillClients(el){
  const byClient = {};
  _billFilterOrders().forEach(o => {
    const c = o.orderClient || '—';
    (byClient[c] = byClient[c] || []).push(o);
  });
  const q = _billSearch.trim().toLowerCase();
  const list = Object.entries(byClient)
    .filter(([c]) => !q || c.toLowerCase().includes(q))
    .sort((a,b) => b[1].length - a[1].length);

  el.innerHTML =
    '<input class="bill-search" id="billSearch" type="search" autocomplete="off"' +
    ' placeholder="חפש לקוח..." aria-label="חיפוש לקוח לחיוב" value="' + lgEsc(_billSearch) + '">' +
    '<div id="billClients"></div>';
  const inp = document.getElementById('billSearch');
  inp.oninput = () => { _billSearch = inp.value; _renderBillClients(el); document.getElementById('billSearch').focus(); };

  const box = document.getElementById('billClients');
  if(!list.length){
    box.innerHTML = '<div class="empty-state"><div class="empty-state-msg">' +
      (q ? 'אין לקוח תואם' : 'אין הזמנות שנאספו וטרם חויבו') + '</div></div>';
    return;
  }
  // שם הלקוח עובר ב-data ולא בתוך onclick. הרכבת JS עם שם בעברית בתוך
  // מחרוזת HTML היא בדיוק מה שהקוד הקיים כבר נמנע ממנו — ר' ההערה ליד
  // כפתורי ההובלה ב-workday.html.
  box.innerHTML = list.map(([c, ords]) => {
    const total = ords.reduce((s,o) => s + (lgCalcOrderTotal(o, globalPrices, clientPrices) || o.total || 0), 0);
    return '<button class="bill-cli" data-client="' + lgEsc(c) + '">' +
      '<span class="bill-cli-n">' + lgEsc(c) + '</span>' +
      '<span class="bill-cli-s">' + ords.length + ' · ₪' + total.toLocaleString() + '</span>' +
    '</button>';
  }).join('');
  box.querySelectorAll('button[data-client]').forEach(btn =>
    btn.addEventListener('click', () => _billPick(btn.dataset.client)));
}

function _billPick(clientName){
  _billClient = clientName;
  invSel.clear(); invSelClient = _billClient;
  renderBillBoard();
}

function _renderBillClient(el){
  const ords = _billFilterOrders()
    .filter(o => (o.orderClient || '—') === _billClient)
    .sort((a,b) => (a.orderNum||'').localeCompare(b.orderNum||''));

  // הכל מסומן כברירת מחדל — בסוף החודש מחייבים על הכל, והסרת סימון היא החריג
  ords.forEach(o => invSel.add(String(o.id)));

  el.innerHTML =
    '<button class="bill-cli" onclick="_billBack()" style="margin-bottom:12px">' +
      '<span class="bill-cli-n">← ' + lgEsc(_billClient) + '</span>' +
      '<span class="bill-cli-s">' + ords.length + ' הזמנות</span>' +
    '</button>' +
    '<div id="billRows"></div>' +
    '<div class="bill-foot">' +
      '<div class="bill-sum" id="billTotal" aria-live="polite"></div>' +
      '<button class="btn btn-primary" style="width:100%" onclick="invPreview()">הפק חשבונית</button>' +
    '</div>';

  document.getElementById('billRows').innerHTML = ords.map(o => {
    const total = lgCalcOrderTotal(o, globalPrices, clientPrices) || o.total || 0;
    const items = (o.items||[]).map(it =>
      '<div class="bill-item">• ' + lgEsc(it.name||'') + ' ' + (it.w||'') + '×' + (it.h||'') + ' מ"מ</div>').join('');
    const sk = (o.hasSketch || o.sketch)
      ? '<img class="bill-sk" data-sketch-for="' + lgEsc(String(o.id)) + '"' +
        ' alt="סקיצה — ' + lgEsc(o.orderNum||'') + '" onclick="if(this.src)previewSketchSrc(this.src)">'
      : '';
    return '<div class="bill-row">' +
      '<div class="bill-row-top">' +
        '<input type="checkbox" checked data-oid="' + lgEsc(String(o.id)) + '"' +
        ' aria-label="כלול את ' + lgEsc(o.orderNum||'') + ' בחשבונית">' +
        '<span class="bill-row-t">' + lgEsc(o.orderNum||'') + ' · ' + lgEsc(o.date||'') + '</span>' +
        '<span class="bill-row-a">₪' + total.toLocaleString() + '</span>' +
      '</div>' +
      '<details class="bill-det"><summary>פירוט</summary>' + items + sk + '</details>' +
    '</div>';
  }).join('');

  el.querySelectorAll('.bill-row-top input').forEach(cb => cb.addEventListener('change', () => {
    if(cb.checked) invSel.add(cb.dataset.oid); else invSel.delete(cb.dataset.oid);
    _billUpdateTotal(ords);
  }));
  el.querySelectorAll('details.bill-det').forEach(d =>
    d.addEventListener('toggle', () => { if(d.open) _hydrateBillSketches(d); }));
  _billUpdateTotal(ords);
}

function _billBack(){ _billClient = null; invSel.clear(); invSelClient = null; renderBillBoard(); }

// הסכום נאמר, לא רק מצויר — aria-live מודיע לקורא מסך כשהוא משתנה
function _billUpdateTotal(ords){
  const chosen = ords.filter(o => invSel.has(String(o.id)));
  const total  = chosen.reduce((s,o) => s + (lgCalcOrderTotal(o, globalPrices, clientPrices) || o.total || 0), 0);
  const el = document.getElementById('billTotal');
  if(el) el.textContent = `נבחרו ${chosen.length} מתוך ${ords.length} · ₪${total.toLocaleString()}`;
}

// סקיצות נטענות רק בפתיחת שורה — ר' אותו דפוס ב-workday.html
function _hydrateBillSketches(root){
  root.querySelectorAll('img[data-sketch-for]').forEach(el => {
    const id = el.getAttribute('data-sketch-for');
    if(el.dataset.lgFor === id) return;
    const o = orders.find(x => String(x.id) === String(id));
    if(o) lgSketchIntoImg(el, o, () => el.classList.add('is-loaded'));
  });
}
```

- [ ] **Step 6: Add the menu entry**

In `admin.html`, immediately after the `לוח איסופים` nav link:

```html
    <a class="unav-a" href="#" onclick="openBillBoard()"><span class="ic" data-icon="file-text"></span>הפקת חשבונית</a>
```

If `lgIcons` has no `file-text` entry, use `calendar` — `test-pages-ui.js` fails on an icon name that is not in the set.

- [ ] **Step 7: Add the full-size sketch viewer used by the rows**

In `admin.html`, immediately after `_hydrateBillSketches`:

```js
// תצוגה מלאה של סקיצה מתוך מסך החיוב. previewSketch הקיים מקבל מזהה הזמנה
// וקורא את o.sketch; כאן התמונה כבר נטענה ל-img, אז מוצג המקור שלו.
function previewSketchSrc(src){
  if(!src) return;
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:900;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;';
  ov.innerHTML = '<img src="' + lgEsc(src) + '" alt="סקיצה בתצוגה מלאה" style="max-width:95vw;max-height:90vh;object-fit:contain;">';
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}
```

- [ ] **Step 8: Run the test**

Run: `node scripts/test-monthly-billing.js`
Expected: PASS, all checks.

- [ ] **Step 9: Run every other suite**

Run: `for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: only the three known pre-existing failures. In particular `test-undefined-vars.js`, `test-dom-ids.js`, `test-csp.js` and `test-pages-ui.js` must pass — they parse `admin.html`.

- [ ] **Step 10: Commit**

```bash
git add admin.html scripts/test-monthly-billing.js
git commit -m "feat: a screen for issuing a consolidated invoice

A flow, not a browse. It starts empty and you search for one client — the
action is 'invoice this client', not 'survey everyone'. Every order starts
selected, because at the end of the month you bill for all of it and
unselecting is the exception; that is also how a single order gets invoiced
early for a monthly client.

'Not yet billed' is not a new field. The invoice API already refuses to invoice
an order twice by checking hashavshevetInvoice.sentAt, so the same fact defines
the list. No new state to keep in sync, and double billing stays blocked on the
server rather than in this screen.

Issuing reuses invPreview() rather than repeating it — the preview, the
confirmation and the rule that the stage moves only after the invoice succeeds
all already exist, and a second copy of the money path is the last thing this
needs.

Sketches carry an id and no src, filled only when a row is opened, the same
pattern as the graphics and delivery tabs. The running total is announced with
aria-live, since it changes without the focus moving."
```

---

## Notes for whoever executes this

**No scheduling.** There is no month-end job, no reminder and no automatic run. "End of the month" is the operator's decision, so there is nothing to schedule and nothing that can fire by accident.

**The document type is an open question, and it does not block this.** Sending `documentid: 1` — which the imovein table calls "חשבונית" — produced a "חשבונית סוכן" in Hashavshevet, and the same happened with orders (30 produced nothing; 31 produced an agent order). Whether an agent invoice is a valid tax invoice is being checked separately. This plan changes *when and for whom* an invoice is issued, not *what kind* — if the type changes later, it changes in one environment variable.

**Three suites already fail** for a line-ending reason unrelated to this work. They are named in the Global Constraints. Do not fix them here and do not let them mask a real failure — check the list every time.
