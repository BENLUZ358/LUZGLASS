# Glass-type filter — check-station and workday

**Date:** 2026-08-07
**Status:** design, not started

## The logic being asked for

Both stations already have a "כל הזכוכיות" dropdown. It should stop being a
hand-written list and start describing what is actually in the system:

- the options come from the SKUs synced out of Hashavshevet
- each option reads as thickness + glass type — `8 שקוף`, `8 קליר` — not the
  SKU code, and not the full item name, which also carries the process
  (`חתוך` / `מלוטש` / `מחוסם`)
- choosing one filters the **items** sitting at that stage, which are the
  items entered through the sketch queue

## What exists today

| | check-station | workday |
|---|---|---|
| Options | ~30 hardcoded `<option>` rows | ~25 hardcoded `<option>` rows |
| Match | `o.glassFullName.includes(value)` | `item.glassFullName.includes(value)` |
| Level | whole order | item, in `selectAllFiltered` only |

Two problems follow. The lists are maintained by hand and already disagree with
each other and with Hashavshevet. And check-station matches a single
order-level string, so an order containing two glass types is shown or hidden
as one unit.

## What the data actually holds

`skuCatalog` — 200 rows, synced from Hashavshevet via `/api/hashavshevet-items`:

| field | meaning | populated |
|---|---|---|
| `code` | SKU, e.g. `8SMH` | 200/200 |
| `name` | full name, e.g. `8 מ''מ שקוף מחוסם` | 200/200 |
| `mm` | thickness | 177/200 |
| `glass` | glass type | **141/200** |
| `proc` | `chisum` / `litush` | — |

Order items carry `item.sku`, and every one of the 12 items currently in the
database has one. So `item.sku` → `skuCatalog[sku]` → `{mm, glass}` is a
complete path, and `mm + ' ' + glass` produces exactly the label wanted.

Run over the current catalogue it yields **28 labels**:

```
4 מראה · 4 שקוף · 5 אפור · 5 ברונזה · 5 מראה · 5 שקוף · 6 אסיד קליר
6 אפור · 6 ברונזה · 6 גרניט · 6 מראה · 6 קליר · 6 שקוף · 8 אסיד קליר
8 אפור · 8 ברונזה · 8 גרניט · 8 קליר · 8 שקוף · 10 אסיד קליר · 10 אפור
10 ברונזה · 10 קליר · 10 שקוף · 12 קליר · 12 שקוף · 15 קליר · 15 שקוף
```

## The blocking problem

**59 of 200 SKUs have no glass type at all**, so building the dropdown from
`glass` alone would make roughly a third of the catalogue invisible to the
filter.

The cause is in `lgGuessOperationalFromName` (firebase-db.js:823). It derives
`glass` by matching the item name against a fixed nine-word list:

```js
const LG_GLASS_TYPES_BY_LENGTH =
  ['אסיד קליר','גלינה שקוף','גלינה קליר','שקוף','קליר','אפור','ברונזה','גרניט','מראה'];
```

Real item names contain words that list has never heard of:

| word | SKUs affected |
|---|---|
| חלבי | 24 |
| אסיד (on its own) | 10 |
| פפיטה | 7 |
| צנצילה | 6 |
| לקובל | 4 |
| סבתא · מאסטר · ליין | 3 each |

`אסיד` is the instructive one. `10 מ''מ אסיד קליר חתוך` matches `אסיד קליר`
and resolves, while `10 מ''מ אסיד חתוך` matches nothing and resolves to blank —
the list is ordered longest-first precisely so the two-word type wins, but the
one-word type was never added behind it.

`mm` is missing on 23 rows for two separate reasons: `10+10 טריפלקס` does not
match the `\d+ מ"מ` pattern, and `שכר חיסום` is a labour charge rather than
glass and has no thickness to find.

## Design

### 1. Fix the source data first

Nothing downstream is worth building on a field that is 70% populated.

- extend the type list with the missing words, keeping the longest-first order
  so `אסיד קליר` still resolves before `אסיד`
- teach the `mm` parser the `10+10` laminated form
- mark non-glass items (labour, fittings) as explicitly not-glass rather than
  leaving `glass` blank, so "missing" and "not applicable" stop looking alike
- re-run the guess over rows that have no glass yet. Manual edits already win
  over guesses — `syncSkuCatalogFromHashavshevet` only fills a field that is
  `undefined`, and flags what it filled with `opAuto` — so a backfill cannot
  overwrite anything a person set.

### 2. One shared derivation

A single helper in `firebase-db.js`, used by both stations, so the two lists
cannot drift apart again:

```
lgGlassTypeOf(item, skuCatalogMap) -> { mm, glass, label } | null
lgGlassTypesInOrders(orders, skuCatalogMap) -> [{ label, mm, glass, count }]
```

The dropdown is built from the second one, so it lists only the glass types
actually present at that stage, each with how many items carry it. An option
that would return nothing is not offered.

Matching is on the resolved `{mm, glass}` pair, not on a substring of a name.
`8 שקוף` stops accidentally matching `18 שקוף`.

### 3. Filter items, not orders

check-station moves from `o.glassFullName.includes(...)` to asking whether any
item in the order resolves to the selected type. workday's `selectAllFiltered`
already works per item and only needs its comparison swapped.

## Decided: the filter narrows the order, it does not hide it

A single sketch routinely carries several glass types — `8 שקוף` and `מראה`
and `8 קליר` in one order. Selecting `8 שקוף` shows **only the `8 שקוף`
items**, and the order stays on screen because it has some.

This is a real change of behaviour, not a tidy-up. Today check-station tests
one order-level string and shows or hides the whole order; that order would
currently appear in full, `מראה` items and all.

It follows that the filter has to be applied wherever items are counted or
rendered, not only where the list is built:

- the item list inside an opened order
- the "checked 2 of 4" progress on the card and in the top bar
- "select all" in workday, which already filters per item but by substring
- any total or per-order summary that walks `o.items`

A filtered progress count is the point of the feature — while filtering to
`8 שקוף` the operator wants to see progress through the `8 שקוף` items, not
through the whole order. But it means the same order shows a different
denominator depending on the filter, so the header has to say which filter is
active rather than leaving the number unexplained.

## Dropdown scope

Only the types actually present at that stage, each with its item count. An
option that would return nothing is not offered. The list is short and changes
with the work in front of you, which is more useful here than a fixed 28-row
list whose options mostly return empty.

## Open question

**The 59 uncategorised SKUs.** The parser can be extended with the words found
above, but four of them — `סבתא`, `מאסטר`, `ליין`, `לקובל` — read like product
lines rather than glass types, and guessing would put wrong options in the
dropdown. These need naming by someone who knows the products.

`חלבי` (24 SKUs), `אסיד` (10) and `פפיטה` (7) look unambiguously like glass
types and can be added on that basis; `צנצילה` (6) probably too.

## Out of scope

Changing how SKUs are synced from Hashavshevet, and the client price lists,
which are a separate gap.
