# שבר חוזר לבדיקה + לשונית חיסום נקייה — תכנית

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** זכוכית שבורה נשלחת מלשונית החיסום לתחנת הבדיקה, יוצאת בדוח החיסום הבא כ"שבר" ונסגרת ב"✓ חזר". בכרטיס החיסום רואים בבירור לקוח, סקיצה ומידה.

**Architecture:**
- הנתונים יושבים על הרשומה הקיימת `orders/<id>/brokenChisum/<idx>`. נוספים לה `redoAt`, `redoCheckedAt`, `redoReportNum`, `redoReportId` ו-`manual`.
- ההחלטות הן פונקציות טהורות ב-firebase-db.js, ונבדקות עם vm כמו `scripts/test-broken-chisum.js`.
- workday.html ו-check-station.html רק קוראים לפונקציות האלה ומציירים.

**Tech Stack:** HTML/JS רגיל, Firebase RTDB compat, בדיקות node + vm.

**Spec:** docs/superpowers/specs/2026-11-19-broken-redo-design.md

## Global Constraints
- כל הטקסטים בעברית פשוטה.
- שבר לא מוציא חשבונית נוספת ולא שולח שוב הודעת "מוכן".
- לא משנים את `lgBrokenPlan`. השבר האוטומטי ב"סיום בדיקה" נשאר כמו שהוא.
- עובדים על הענף `feat/broken-redo` (מ-main 57a43ff). בודקים באתר הבדיקה. ל-main רק כשבן מאשר.

## Review Focus
1. **הזמנה שכל הזכוכיות בה שבורות (כמו L1288-3):** אסור שתעבור למוכן או להובלה ב"סיום בדיקה". נבדק ב-Task 1 (`lgBrokenHolds`).
2. **שבר שנשלח ושוב לוחצים "שלח למפעל":** הוא לא נכנס לדוח פעמיים, כי יש לו כבר `redoReportId`. נבדק ב-Task 1 (`lgBrokenRedoQueue`).
3. **"✓ חזר" על הזמנה שעוד בחיסום:** לא יוצאת הודעה ללקוח. במקום זה נכתבים `returnedAt` ו-`deliveredAt`. נבדק בבדיקת המקור של Task 2.
4. **בתור יש רק שברים ואין הזמנות:** "שלח למפעל" עדיין מוציא דוח עם מספר. נבדק בבדיקת המקור של Task 3.
5. **לקוח איסוף עם שבר ועם זכוכיות שחזרו:** ההזמנה מחכה ולא שולחת "מוכן". נבדק ב-Task 1.

---

### Task 1: החלטות טהורות
**Files:** Modify `firebase-db.js` (ליד `lgBrokenOpen`). Test: `scripts/test-broken-redo.js`.

**Interfaces (Produces):**
- `lgBrokenRedoQueue(orders) -> [{order, idx, checked:boolean}]`: מה שמחכה בתחנת הבדיקה. כלומר `redoAt` קיים, ואין `redoReportId` ואין `returnedAt`.
- `lgBrokenRedoLabel(v) -> string`, לפי המצב:
  - אין `redoAt`: `''`
  - נשלח לבדיקה ועוד לא נבדק: `'בתחנת הבדיקה'`
  - נבדק: `'נבדק — יוצא בדוח הבא'`
  - יצא בדוח: `'בדוח N'`
- `lgBrokenHolds({openIdxs, factoryIdxs, isDelivery, partialInvoice}) -> boolean`: האם ההזמנה מחכה בחיסום.
  - false כשאין שבר פתוח.
  - true כשהלקוח לא לקוח הובלות, או כשיש לו חשבונית חלקית.
  - true כשכל `factoryIdxs` נמצאים ב-`openIdxs`.
  - false בכל מקרה אחר.

- [ ] Step 1: לכתוב את הבדיקות:
  - `queue: {redoAt:1}` מחזיר `checked:false`.
  - `{redoAt:1, redoCheckedAt:2}` מחזיר `checked:true`.
  - אם יש `redoReportId` או `returnedAt`, הפריט לא ברשימה.
  - לכל אחד ממצבי התווית ערך מדויק.
  - holds: הובלות 1 שבור מתוך 3 ← false. הובלות 1 מתוך 1 ← true. איסוף 1 מתוך 3 ← true. חשבונית חלקית ← true. בלי שבר ← false.
- [ ] Step 2: `node scripts/test-broken-redo.js` נכשל ("missing").
- [ ] Step 3: לממש.
- [ ] Step 4: הבדיקה עוברת. גם `node scripts/test-broken-chisum.js` עובר.
- [ ] Step 5: commit.

### Task 2: יום עבודה — שבר ידני, החזקה, "✓ חזר"
**Files:** Modify `workday.html`. Test: בדיקות מקור ב-`scripts/test-broken-redo.js`.

**Interfaces:** משתמש ב-`lgBrokenHolds`, `lgBrokenRedoLabel` ו-`lgBrokenOpen`. מייצר:
- `wdMarkBroken(orderId, idx)`:
  1. שואל `confirm`.
  2. כותב `brokenChisum/<idx> = {at, track:'chisum', manual:true, redoAt}`.
  3. סוגר את idx עם `_closeArrived`.
- `wdSendBrokenToCheck(orderId, idx)`: כותב `brokenChisum/<idx>/redoAt`.

- [ ] Step 1: בדיקות מקור:
  - `confirmResetChisum` קורא ל-`_brokenHoldsOf(o)` לפני כל התקדמות, ומדלג ממנו (`return`).
  - `markBrokenReturned` בודק `stage === 'chisum'` לפני שהוא שולח ל-`/api/whatsapp-dispatch`.
  - בקופסת השבר יש כפתור `wdSendBrokenToCheck` ותווית מצב.
- [ ] Step 2: לממש את `_brokenHoldsOf(o)`.
  - `openIdxs` מ-`lgBrokenOpen`.
  - `factoryIdxs` מ-`_chisumIdxsOf` + טריפלקס.
  - `isDelivery` ו-`partialInvoice` כמו ב-`_brokenPlanOf`.
- [ ] Step 3: בדיאלוג של "סיום בדיקה", הזמנה שמחכה בגלל שבר מופיעה בקבוצה משלה: "💥 מחכות לשבר".
- [ ] Step 4: הבדיקות עוברות. commit.

### Task 3: תחנת הבדיקה — חלק "💥 שבר" ודוח
**Files:** Modify `check-station.html`. Test: בדיקות מקור.

**Interfaces:** משתמש ב-`lgBrokenRedoQueue`.
- `csRedoToggle(orderId, idx)` כותב או מוחק את `brokenChisum/<idx>/redoCheckedAt`.
- `sendAllToFactory` אוסף את `lgBrokenRedoQueue(...).filter(x=>x.checked)`:
  - מחשב `reportNum` גם כשאין הזמנות רגילות.
  - כותב לכל שבר `redoReportNum` ו-`redoReportId`.
  - מעביר את השברים ל-`printChisum` דרך `chRedo`. ב-`_csReportSection` השורה מקבלת "💥 שבר".

- [ ] Step 1: בדיקות מקור:
  - `sendAllToFactory` לא חוזר עם "אין הזמנות שהושלמו" כשיש שברים שנבדקו.
  - הדוח מכיל את "💥 שבר".
  - `renderList` מצייר את `csRedoSectionHtml()` בשני הטאבים.
- [ ] Step 2: לממש. הרשימה של השברים מגיעה מ-`window._allCsOrders` (הקורא הקיים של כל ההזמנות).
- [ ] Step 3: הבדיקות עוברות. commit.

### Task 4: כרטיס החיסום נקי ותפריט "⋯"
**Files:** Modify `workday.html` (`_chisumClientCardHtml`).
- שם הלקוח 15px.
- שורת הסקיצה: השם 14px 800 בצבע הטקסט, מספר ההזמנה 12px אפור.
- המידה 18px 900, ליד סוג הזכוכית 12px אפור.
- בשורת הסקיצה נשארים "🖼 סקיצה" ו-"⋯". ב-⋯ של הסקיצה: 📐 צורות.
- ב-⋯ של כל זכוכית: 🏷 מדבקה (ועם צורה כשיש), ו-💥 שבר — שלח לבדיקה (רק בלשונית החיסום).
- `wdMenu(btn, items)`: תפריט קטן צף שנסגר בלחיצה בחוץ.
- [ ] Step 1: בדיקת מקור: אין יותר `wdLabelBtn(` בתוך `_chisumClientCardHtml`, ו-`wdMarkBroken` מופיע דרך התפריט.
- [ ] Step 2: לממש. commit.

### Task 5: לבדוק באתר הבדיקה
- [ ] להעלות לענף test (merge) ולחכות לבנייה.
- [ ] ב-luzglass-test לסמן שבר ידני על הזמנת בדיקה. לוודא שהיא מופיעה בתחנה, נבדקת, יוצאת בדוח עם "שבר", ונסגרת ב"✓ חזר".
- [ ] צילום מסך של הכרטיס הנקי.
