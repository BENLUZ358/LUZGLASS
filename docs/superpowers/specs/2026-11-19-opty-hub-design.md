# OptyWay: one search, one status per glass, "not in our system" list

Ben, 19/11/2026.

## Why

Ben: "אני רוצה שהמערכת שלי תהיה מסודרת וקלה למשתמש… סטטוסים משני מקורות וסטטוס ממקור אחד… לחפש ולסנן לפי קטגוריה, היסטוריה, זכוכיות… הזמנות שנחתכו ב-OPTYWAY אבל עדיין אין לנו בממשק." The OptyWay page felt scattered:

- There were two searches: the "חיפוש" tab, and the shape search inside "אופטימיזציות". They showed different things.
- What OptyWay knows lived on opty.html. What we know (chisum, ready, collected) lived on the order board. No single place showed both.
- "לא נמצא פריט" was visible only at import time, and it disappeared afterwards.

When asked what he wants first when he opens the screen, Ben answered: "חיפוש הזמנה עפ"י כמה פרמטרים, מידה, שם הזמנה, שם סקיצה וכו'". Then he said "תתחיל לבנות".

## What was built

- **"🔍 חיפוש" is the first tab and opens by default.** One box searches:
  - a size (`850x1900`, `850×1900`, `1900*850`, or one side such as `1900`; ±3 mm, either way round, and OptyWay's +2 mm grinding is allowed);
  - order number, client, sketch name, shape number, and M00… job number.

  Every word must match.
- **Results: one card per order, all of its glasses, and one status per glass** (`lgHubItemState`):
  - From chisum onward, our stage decides: "בחיסום / תחנת בדיקה", "בגרפיקה", "מוכן · ממתין להובלה", "מוכן לאיסוף", "נאסף".
  - Before that, OptyWay decides: "✂ נחתך dd/mm", "לחיתוך…", or "באופטימיזציה M…". Otherwise it shows our early stage: "ממתין לאישור", "אצל שרטט", "מחכה לאופטי-ווי", or "ביום עבודה".
  - The glass that matched the search is highlighted.
  - Buttons: 📐 shape, "ללוח" (opens its sheet in the optimisations tab), and "נתק".
- **Filters:** a date range (an order matches by its creation day or its cut day), glass type (by the OptyWay job), "כל התאריכים", and "נקה". State chips with counts: הכל · לפני חיתוך · לחיתוך · נחתך · מוכן/נאסף · לא אצלנו.
- **History:** the search covers all orders, not just the last 30 days. Optimisations cover the last 400, and "טען אופטימיזציות ישנות יותר" loads 400 more each time. With no search word and no dates, it shows the last 7 days.
- **"לא אצלנו" tab** (with a count for the last week). It is the same screen, filtered to OptyWay glasses that are not linked to any item of ours (by shape, or by position for glasses without a shape).
  - Glasses are grouped by OptyWay client.
  - Each shows the ready state from 17/11 (chisum from the note or the glass type).
  - "מחכה לחיבור" marks glasses that already wait in "לחיבור".
  - Tapping one opens its sheet.
- **Tab order:** חיפוש · עבודת היום · אופטימיזציות · לא אצלנו · לחיבור | קליטה · הגדרות. The search box was removed from "אופטימיזציות", which keeps its date and glass filters and its day estimates.
- **Phone:** tabs and chips scroll sideways, and the selected one stays in view. Filters fold under "סינון". The search box is not pinned to the top.

## Approaches

1. **Chosen: one search screen, with "לא אצלנו" as a filter of it.** One place, one way of showing status, and nothing is duplicated.
2. A separate "לא אצלנו" page with its own list code. Rejected: it would be a third way of listing the same glasses.
3. Adding OptyWay status to the order board in admin.html. Rejected for now: Ben asked for order on the OptyWay page, and admin.html is shared by many sessions.

## Not done / left open

- "לא אצלנו" has no "link to order" or "open order" action. Ben was asked what he does with those glasses and didn't answer yet. For now it is a list, and tapping a glass opens its sheet.
- The two ways of marking cut were left as they are: the import stamps by work day, and "נחתך" per sheet in "עבודת היום".

## Files

- `opty-hub.js`: pure logic, with tests in `scripts/test-opty-hub.js`.
- `opty.html`: tabs, the search pane, and loading all orders (`ALL_ORDERS`).
- `scripts/test-opty-page.js`: the page end to end.
- No new data and no rules change. The screen only reads `orders` and `meta/opty*`.
