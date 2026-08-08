# חלבי, טריפלקס, and fixing the glass-type model

**Date:** 2026-08-08
**Status:** design, ready to plan
**Supersedes part of:** 2026-08-07-glass-type-filter-design.md

## What the filter work uncovered

Building a glass-type filter surfaced 59 SKUs with no glass type. Working
through them showed the model was wrong, not merely under-populated.

**חלבי is not a glass type.** It is sandblasting. `8 מ''מ חלבי חתוך` is cut as
`8 שקוף`, is `8 שקוף` everywhere in the system, and carries a marker saying it
still owes a trip to the sandblaster. Twenty-four SKUs were being recorded as a
material when they describe an outstanding operation. Filtering by "8 חלבי"
would have been asking the wrong question, and worse, those items would never
have appeared under `8 שקוף` where they belong.

`5 מ''מ דלתות נגרים` is the same: 5mm שקוף with special holes, ordinary
tempering and polishing, nothing to model.

## The corrected model

Three independent axes where today there is one overloaded `glass` field:

| axis | field | values |
|---|---|---|
| what the material **is** | `glass` | שקוף · קליר · אסיד · אסיד קליר · אפור · ברונזה · גרניט · מראה · פפיטה · צנצילה · סבתא · מאסטר ליין · לקובל שחור · לקובל לבן |
| how it is **cut** | `proc` | חתוך · מלוטש · מחוסם |
| what it still **owes** | flags | `graphic` (exists) · `chalavi` (new) · `triplex` (new) |

`4 מ''מ צנצילה חלבי מחוסם` is צנצילה, tempered, and owes sandblasting — three
facts, not one string.

לקובל arrives from the supplier already cut in black or white and needs no
processing to become that colour. Recorded as two glass types rather than one
with a colour attribute, because the operator has to tell a black sheet from a
white one when picking, exactly as with אפור and ברונזה.

## חלבי needs no new stage

Sandblasting and graphics are the same operation as far as routing goes — both
are surface work, both happen after tempering when the item is tempered. So
`hasGraphic` becomes `hasSurfaceWork = graphic || chalavi` and the existing
`graphic` stage absorbs it. No new stage, no ordering question between them.

The `chalavi` flag still matters: the station has to know whether to sandblast
or to print, and triplex חלבי has to be excluded.

## טריפלקס — the code already has this pattern

Three behaviours under one word:

| | route |
|---|---|
| **regular** | cut in-house — **ready after the work day, like mirrors** |
| **חלבי** | arrives already frosted — skips surface work entirely |
| **מחוסם** | goes to tempering, laminated there, back after **days, unpredictable** |

Regular triplex needs no new mechanism. `sendAllToFactory` in check-station
already carves mirrors out of the factory run:

```js
const hasRealChisum = (o.items||[]).some(i => i.chisum && !(i.name||'').includes('מראה'));
if (!hasRealChisum) { /* lock the price, go straight to done */ }
```

Regular triplex joins that carve-out. Worth noting the existing test is a
substring match on the item name, which is the same fragility this whole piece
of work is removing — it should ask the catalogue, not the string.

### Tempered triplex: two reports, not two stages

The requirement is at the **report**, not the stage. When a day contains both
tempered triplex and ordinary tempering, check-station must export **two
numbered reports** — one per destination — so the two can be told apart when
they come back.

That falls out of how the current flow works. `sendAllToFactory` mints one
`reportNum`, stamps every order with it, and prints one document. Ordinary
tempering returns the next day and the "הגיע חיסום!" banner clears the list in
one action. Triplex sits at the laminator for days. Sharing a report number
means either the reset clears triplex while it is still out, or triplex blocks
the reset for everything else.

So: split the outgoing set by `triplex`, mint a number for each, stamp and
print each separately. The stage stays `chisum` for both — no new stage, no new
status.

## Where this touches the code

| area | change |
|---|---|
| `LG_GLASS_TYPES_BY_LENGTH` | real types only; חלבי stops being one |
| `lgGuessOperationalFromName` | derive `chalavi` and `triplex` flags; parse the `3+3` / `4+4` thickness |
| `lgNextStage` | `hasSurfaceWork = graphic \|\| chalavi`; triplex-חלבי exception |
| `sendAllToFactory` (check-station) | split the run by triplex, two report numbers, two printouts |
| the mirror carve-out | ask the catalogue instead of matching `'מראה'` in a name; regular triplex joins it |
| `skuCatalog` backfill | 59 rows re-derived, 2 removed |
| the glass filter | what started this — now buildable on a correct model |

`updateStage` remains the single point through which status changes.

## Backfill, resolved

| SKUs | glass | flags |
|---|---|---|
| 24 חלבי (`08HH`, `10HM`, `4CHH` …) | שקוף — except `4 מ''מ צנצילה חלבי`, which is צנצילה | `chalavi` |
| 10 אסיד | אסיד | — |
| 7 פפיטה | פפיטה | — |
| 3 צנצילה | צנצילה | — |
| 3 סבתא | סבתא | — |
| 3 מאסטר ליין | מאסטר ליין | — |
| 4 לקובל | לקובל שחור / לקובל לבן | — |
| 1 דלתות נגרים | שקוף | — |
| 4 טריפלקס | per name; `3+3`/`4+4` gives the thickness | `triplex`, plus `chalavi` where the name says חלבי |
| 2 שכר חיסום | removed from the catalogue | — |

The backfill is safe to re-run: `syncSkuCatalogFromHashavshevet` only fills a
field that is `undefined` and marks what it filled with `opAuto`, so no manual
edit can be overwritten.

## Remaining question

**צנצילה חלבי.** `4 מ''מ צנצילה חלבי` is read above as צנצילה + `chalavi`,
consistent with חלבי never being a material. Worth confirming, since it is the
one case where חלבי sits on something other than שקוף.

## Out of scope

Client price lists and the Hashavshevet order import, both tracked separately.
