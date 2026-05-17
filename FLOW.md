# LuzGlass — זרימת עבודה מלאה
_עדכון אחרון: 11/05/2026_

---

## כלל הברזל

כל שינוי `stage` חייב לעבור **`updateStage(id, stage)`** בלבד.
אין כתיבה ישירה ל-Firebase. אין שינוי `status` ישירות.
`status` הוא תמיד תוצר של `lgStageToStatus(stage)`.

---

## טבלת שלבים

| stage | status | מי מגדיר | טאב בworkday |
|-------|--------|----------|--------------|
| `''` / `pending` | ממתין לאישור | אוטומטי בהגשה | — |
| `drafter` | אצל שרטט | שרטט | — |
| `opty` | מחכה ל-OptyWay | שרטט (סיום) | רשימה זמינה |
| `workday` | ירד לביצוע | יום עבודה (הורד) | יום עבודה פעיל |
| `chisum` | נשלח לחיסום | תחנת בדיקה (שלח למפעל) | חיסום |
| `graphic` | בגרפיקה | confirmResetChisum / markStageDone | גרפיקה |
| `delivery` | ממתין להובלה | confirmResetChisum / markStageDone | הובלות |
| `done` | מוכן לאיסוף | confirmResetChisum / markStageDone | — |
| `collected` | נאסף | דשבורד (נאסף) | — |

---

## זרימות מלאות לפי סוג הזמנה

### 1. ליטוש בלבד — לקוח רגיל
```
opty → workday → [confirmFinish] → done → collected
```

### 2. ליטוש בלבד — לקוח הובלות
```
opty → workday → [confirmFinish] → delivery → collected
```

### 3. ליטוש + גרפיקה — לקוח רגיל
```
opty → workday → [confirmFinish] → graphic → done → collected
```

### 4. ליטוש + גרפיקה — לקוח הובלות
```
opty → workday → [confirmFinish] → graphic → delivery → collected
```

### 5. חיסום בלבד — לקוח רגיל
```
opty → workday → [תחנת בדיקה → שלח למפעל] → chisum
     → [confirmResetChisum, allDone] → done → collected
```

### 6. חיסום + גרפיקה — לקוח רגיל
```
opty → workday → [תחנת בדיקה] → chisum
     → [confirmResetChisum, allDone] → graphic → done → collected
```

### 7. חיסום + גרפיקה — לקוח הובלות
```
opty → workday → [תחנת בדיקה] → chisum
     → [confirmResetChisum, allDone] → graphic → delivery → collected
```

### 8. מעורב (ליטוש + חיסום) — לקוח רגיל
```
opty → workday
  ↓ פריטי ליטוש: inWork (יום עבודה פעיל)
  ↓ פריטי חיסום: inChisum (תחנת בדיקה)
[confirmFinish: ליטוש הסתיים, stage נשאר workday/chisum]
[תחנת בדיקה → שלח למפעל] → chisum
[confirmResetChisum, allDone] → done/graphic/delivery
```

---

## הפונקציה המרכזית: `lgNextStage(order, isDelivery)`

**מיקום:** `firebase-db.js` — מקור אמת אחד לכל המערכת.

**לוגיקה:**
```js
hasChisum  = items.some(i => !!i.chisum)
hasGraphic = items.some(i => !!i.graphic || name.includes('גרפיקה'))
finalStage = isDelivery ? 'delivery' : 'done'

switch (stage):
  'workday' → hasChisum ? 'chisum' : hasGraphic ? 'graphic' : finalStage
  'chisum'  → hasGraphic ? 'graphic' : finalStage
  'graphic' → finalStage
  'done' / 'delivery' → 'collected'
```

**חשוב:** `hasGraphic` בודק גם `item.graphic === true` וגם שם הפריט מכיל "גרפיקה".
זה מבטיח תאימות לאחור עם פריטים ישנים שנוצרו לפני שנוסף הדגל.

---

## זיהוי לקוח הובלות

- **מקור:** `users/<phone>/isDelivery: true`
- **קאש:** `_deliveryClientNames` ב-workday.html (נטען פעם אחת ב-startup)
- **פונקציה:** `_isDeliveryClient(orderClient)` — בדיקת שם לקוח
- **דנורמליזציה:** `order.deliveryClient: true` — ניתן לשמור על ההזמנה לאחר שהלקוח סומן

---

## דוחות חיסום (chisumReport)

**עיקרון:** כל קריאה ל-`sendAllToFactory()` יוצרת `reportId` חדש ועצמאי.

**מחזור חיים:**
1. `sendAllToFactory()` → יוצר `reportId = 'chisum_' + Date.now()` + `reportNum = 'CH-DDMM-XXX'`
2. כל הזמנה שהושלמה בתחנה → `updateOrder(id, { stage: 'chisum', chisumReportId, chisumReportNum })`
3. הזמנות מוסרות מ-`workday/inChisum`
4. workday.html מציג הזמנות ב-**קבוצות לפי reportId**
5. כשכל פריטי הזמנה מגיעים → `stage='graphic'/'done'/'delivery'`

**אי-ערבוב:** כל הזמנה שייכת לדוח אחד בלבד. `sendAllToFactory` מעבד רק הזמנות שנמצאות כרגע ב-`wdInChisum` — הזמנות שכבר נשלחו בדוח קודם אינן ב-`wdInChisum` ולכן לא נכנסות לדוח חדש.

---

## תחנת בדיקה — מה זמני ומה קבוע

| מה | איפה נשמר | מחיקה |
|----|-----------|--------|
| אילו פריטים נבדקו (`checkState`) | `workday/checkState` ב-Firebase | נשמר עד שההזמנה עוברת שלב |
| ציורי הערות על סקיצה | `checkEdits/<orderId>` ב-Firebase | נמחק אוטומטית ב-`sendAllToFactory` |
| הסקיצה המקורית (`sketch`) | `orders/<id>/sketch` | **לעולם לא נוגעים בה מהבדיקה** |

---

## WhatsApp — מתי נשלח ומתי לא

| מצב | הודעה |
|-----|--------|
| `confirmFinish` + `lgNextStage = 'done'` | ✅ שלח "מוכן לאיסוף" |
| `confirmFinish` + `lgNextStage = 'graphic'` | ❌ אל תשלח — עדיין בגרפיקה |
| `confirmFinish` + `lgNextStage = 'delivery'` | ❌ אל תשלח — הובלה |
| `confirmResetChisum` + `nextSt = 'done'` | ✅ שלח "הגיע חיסום / מוכן" |
| `confirmResetChisum` + `nextSt = 'graphic'` | ❌ אל תשלח |
| `confirmResetChisum` + `nextSt = 'delivery'` | ❌ אל תשלח |
| `completeGraphic` + `nextSt = 'done'` | ✅ שלח "מוכן לאיסוף" |
| `completeGraphic` + `nextSt = 'delivery'` | ❌ אל תשלח |

---

## inWork ו-inChisum — כללי ניהול

**`workDay.inWork`:** רשימת הזמנות פעילות ביום עבודה הנוכחי.
- מותר stages: `opty`, `workday`, `chisum` (מעורב — ליטוש עדיין בתהליך)
- אסור: `graphic`, `delivery`, `done`, `collected`
- נוקה: `confirmFinish` מוחק הכל → `workDay.inWork = []`

**`workDay.inChisum`:** הזמנות שנמצאות בתחנת הבדיקה.
- מתמלא: `handleWorkdayStart` כש-`hasChisum === true`
- מתרוקן: `sendAllToFactory` ב-check-station → `firebase.update({inChisum: remaining})`
- מנוקה חלקית: `confirmResetChisum` → מסיר הזמנות שהושלמו

**`checkState` (Firebase):** `{orderId: {itemIdx: true/false}}`
- מקור אמת: Firebase `workday/checkState`
- מגובה: localStorage `lgCSEdits` (fallback)
- recovery: אם Firebase חסר — משוחזר מ-localStorage בטעינה

---

## Firebase Realtime — עקרונות

| מה | כיצד |
|----|------|
| `workday` node | `.update()` — לא `.set()` (מונע מחיקת checkState) |
| `orders/<id>` | `updateOrder()` / `updateStage()` בלבד |
| stage + status | תמיד יחד ב-`updateStage()` — לעולם לא בנפרד |
| checkState | נכתב ב-`saveCS()` → `workday/checkState.set(cs)` |
| checkEdits | נכתב ב-`edSave()` → `checkEdits/<orderId>.set(src)` |

---

## מקורות אמת

| נתון | מקור אמת |
|------|----------|
| `stage` / `status` | Firebase `orders/<id>/stage` |
| פריטים שנבדקו | Firebase `workday/checkState` |
| ציורי בדיקה | Firebase `checkEdits/<id>` |
| יום עבודה פעיל | Firebase `workday/inWork, inChisum, itemsSel` |
| לקוח הובלות | Firebase `users/<phone>/isDelivery` |

---

## נעילת מחיר סופי — `totalFinal`

### מתי המחיר דינמי ומתי קבוע?

| מצב | סוג מחיר | מקור |
|-----|----------|------|
| שלבים: `opty`, `workday`, `chisum`, `graphic`, `delivery` | **דינמי** | מחושב בזמן אמת מ-`lgCalcOrderTotal` |
| שלב `done` / `collected` | **קבוע** | `order.totalFinal` — נשמר פעם אחת |

### מתי נועל?
נעילה מתרחשת **לפני** שינוי ה-stage ל-`done` או `delivery`, מ-4 נקודות:
1. `markStageDone()` ב-workday.html — סיום יום עבודה
2. `completeGraphic()` ב-workday.html — סיום גרפיקה
3. `confirmResetChisum()` ב-workday.html — כל פריטי החיסום הגיעו
4. `invoiceMarkDone()` ב-admin.html — מעבר ידני מהדשבורד

### מה נשמר?
```js
order.totalFinal     // ₪ — המחיר הסופי הנעול
order.totalM2        // מ"ר — שטח כולל מחושב מפריטים
order.pricesLockedAt // timestamp של זמן הנעילה
```

### לוגיקת תצוגה
`lgCalcOrderTotal(order, globalP, clientP)`:
- אם `order.totalFinal` קיים → מחזיר אותו ישירות (מחיר נעול)
- אחרת → מחשב מ-items × מחירון × מ"ר

**חוק:** שינוי מחירון אחרי `done` **לא** ישפיע על הזמנות שכבר נעולות.

---

## חוקים קריטיים

1. **stage='chisum' נקבע אך ורק ב-`sendAllToFactory` בתחנת הבדיקה** — לא מ-workday ולא מהדשבורד ידנית.
2. **graphic מזוהה מ-`item.graphic===true` OR שם מכיל "גרפיקה"** — שני המקרים נתמכים.
3. **לא לשלוח WhatsApp לפני שכל השלבים של ההזמנה הושלמו** — גרפיקה/הובלה עדיין לא מוכנים.
4. **כל דוח חיסום הוא קבוצה עצמאית** — `reportId` נוצר בשלח למפעל, לא ניתן לשנות.
5. **`workday.set()` מוחלף ב-`workday.update()`** — מונע מחיקת `checkState`.
6. **`totalFinal` נכתב פעם אחת בלבד** — אחרי שנשמר, לא ניתן לשינוי אוטומטי. שינוי ידני רק ע"י admin ישירות ב-Firebase.
