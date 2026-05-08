# LuzGlass Bug Log

## 🎯 מטרה
לתעד באגים שקרו במערכת, מה גרם להם ואיך הם נפתרו.

אין לחזור על באג שכבר נפתר.

---

# 🐞 Bug 1 — חיסום לא הופיע

## תיאור
פריטי חיסום לא הופיעו בטאב חיסום אחרי "הורד לעבודה".

## סיבה
הבדיקה הייתה על:
```js
o.items
```

במקום על:
```js
itemsSel
```

## פתרון
לעבור לבדוק רק פריטים שנבחרו בפועל (itemsSel)

---

# 🐞 Bug 2 — מונה חיסום הופיע בלי פריטים

## תיאור
היה מספר (counter) בטאב חיסום אבל הרשימה הייתה ריקה.

## סיבה
- inChisum הכיל orderId
- אבל render עבד לפי o.items
- או שלא היה התאמה בין ID

## פתרון
להציג פריטים לפי itemsSel בלבד  
ולוודא שכל ה-ID הם String

---

# 🐞 Bug 3 — פריטים לא נכנסו לחיסום בזמן

## תיאור
פריטי חיסום נכנסו רק אחרי "סיים יום עבודה"

## סיבה
הלוגיקה הייתה בתוך confirmFinish()

## פתרון
להכניס את החיסום כבר ב:
```js
handleWorkdayStart()
```

---

# 🐞 Bug 4 — פריטים נשארו ברשימה אחרי הוספה

## תיאור
לחיצה על "הוסף" הוסיפה לטיוטה אבל לא הסירה מהרשימה

## סיבה
לא היה סינון לפי draftItems

## פתרון
לסנן פריטים שכבר נמצאים בטיוטה

---

# 🐞 Bug 5 — מודאל לא נפתח

## תיאור
לחיצה על הזמנה לא פתחה מודאל

## סיבה
ID לא תאם:
```js
mod vs ov
```

## פתרון
לאחד ID

---

# 🐞 Bug 6 — סטטוס לא השתנה

## תיאור
שינוי סטטוס לא עבד

## סיבה
שימוש בפונקציה שלא קיימת:
```js
statusToStage
```

## פתרון
להשתמש ב:
```js
lgStatusToStage
```

---

# 🐞 Bug 7 — תור סקיצות לא הסתנכרן

## תיאור
סקיצות נשארו בתור גם אחרי מעבר שלב

## סיבה
לא היה סינון לפי stage

## פתרון
להציג רק:
```js
stage === 'sketch'
```

---

# 🐞 Bug 8 — עבודה לא הופיעה ביום עבודה

## תיאור
הזמנות עברו שלב אבל לא הופיעו ביום עבודה

## סיבה
- סינון לא נכון
- או race condition

## פתרון
לתקן filter ולהשתמש ב-stage נכון

---

# 🐞 Bug 9 — ערבוב בין Orders ל-Items

## תיאור
המערכת הציגה פריטים לא נכונים

## סיבה
שימוש ב-o.items במקום itemsSel

## פתרון
להפריד בין:
- Orders Mode
- Items Mode

---

# 🐞 Bug 10 — ID mismatch

## תיאור
includes / find לא עבדו

## סיבה
ערבוב בין:
- מספר
- string
- ord_123

## פתרון
תמיד להשתמש:
```js
String(id)
```

---

# ⚠️ חוק קריטי

אם באג דומה חוזר:

❌ לא לתקן מחדש  
✔ לבדוק ב-BUG_LOG קודם  

---

# 📌 איך להשתמש בזה

לפני כל תיקון:

1. לבדוק אם הבאג כבר קיים כאן  
2. אם כן — להשתמש בפתרון הקיים  
3. אם לא — להוסיף באג חדש  

---

# 🧪 הוספת באג חדש

להוסיף בפורמט:

---

# 🐞 Bug 11 — תחנת בדיקה הציגה ריק

## תיאור
check-station.html לא הציגה הזמנות שהיו ב-inChisum

## סיבה
`load()` קרא מ-localStorage בלבד, אבל workday.html כותב ל-Firebase בלבד

## פתרון
שינוי check-station.html לשימוש ב-`listenAllOrders` + Firebase workday listener  
סינון לפי `workDay.inChisum` מ-Firebase (לא workdayStatus מ-localStorage)

---

# 🐞 Bug 12 — התנגשות בתחנת בדיקה

## תיאור
הזמנות חדשות עם פריטי חיסום נכנסו לתחנה בזמן שהתחנה כבר הייתה פעילה

## סיבה
handleWorkdayStart הכניס תמיד ל-inChisum בלי לבדוק אם התחנה פנויה

## פתרון
אם inChisum ריק → נכנס ישירות  
אם inChisum לא ריק → נכנס ל-pendingChisum  
כשהתחנה מתרוקנת → pendingChisum עולים אוטומטית ל-inChisum

---

# 🐞 Bug 13 — חיסום דילג על תחנת בדיקה ✅ תוקן

## תיאור
פריטי חיסום עברו ישירות ל-stage='chisum' מבלי לעבור תחנת בדיקה

## סיבות (שלושה):
1. `confirmFinish()` קרא ל-`markStageValue(id, 'chisum')` ישירות
2. `handleWorkdayStart()` לא סינן `pendingChisum` מ-`inWork` → הזמנות pending נשארו ב-inWork ועברו stage='chisum' בסיום
3. `renderChisumTab()` ופונקציות נוספות השתמשו ב-`workDay.inChisum` (= תחנת בדיקה) במקום `stage==='chisum'` (= שלב מפעל חיסום)

## פתרון:
- `confirmFinish()`: הוסרו שורות stage='chisum' — רק `finishSketch()` ב-check-station.html מעדכן stage
- `handleWorkdayStart()`: מסנן עכשיו גם `pendingChisum` מ-`inWork`
- `renderChisumTab()`, `resetChisumList()`, `confirmResetChisum()`, `checkChisumArrived()`, `updateCounts()`: עברו לשימוש ב-`stage==='chisum'` במקום `workDay.inChisum`

## כלל חשוב שנוסף:
```
workDay.inChisum = תור תחנת בדיקה (stage='workday')
stage='chisum'   = לאחר תחנת בדיקה, נשלח למפעל
itemsSel         = מכיל רק פריטי ליטוש/חיתוך (לא חיסום)
```
אין לערבב את שניהם.

---

# 🐞 Bug 14 — פריטי חיסום הופיעו ב"יום עבודה פעיל"

## תיאור
פריטי חיסום מוצגים ב-renderWorkActive() אחרי "הורד לעבודה"

## סיבות:
1. `handleWorkdayStart()` לא ניקה את `itemsSel` מפריטי חיסום — הם נשארו בפנים
2. `renderWorkActive()` הציג את כל `itemsSel` ללא סינון
3. `getActiveItemsForOrder()` החזירה `o.items` כ-fallback (כולל חיסום)

## פתרון:
- `handleWorkdayStart()`: מבנה מחדש — `itemsSel` מכיל רק ליטוש אחרי "הורד לעבודה"
- `renderWorkActive()`: מסנן `item.chisum === true` (רשת בטחון)
- `getActiveItemsForOrder()`: fallback שב ל-`[]` ומסנן chisum תמיד
- הזמנות שנשארו ללא פריטי ליטוש מוצאות מ-inWork לגמרי

---

# 🐞 Bug 15 — הזמנה הבאה נעלמת בשרטט אחרי "סיים סקיצה"

## תיאור
לאחר לחיצה על "סיים סקיצה", ההזמנה שאחרי ה-נעלמת מהסידבר.
בטעינה מחדש — חוזרת. הנתונים ב-Firebase תקינים.

## סיבה
**Race condition בין `finishSketch()` לבין `listenAllOrders` callback:**

1. `finishSketch()` קורא ל-`queue.splice(curIdx,1)` ולאחר 1600ms ל-`showOrder()`
2. בינתיים, Firebase listener יורה (אחרי `updateStage`)
3. Listener מוצא שה-`prevId` (ההזמנה שסיימנו) לא בתור → מבצע `curIdx=0; showOrder(queue[0])` באמצע הבאנר
4. עכשיו `showOrder` נקרא פעמיים: פעם מהlistener ופעם מה-setTimeout
5. הקריאה הכפולה גורמת לרנדור לא עקבי של הסידבר

## פתרון
דגל `_showingDoneBanner`:
- מופעל ב-`finishSketch()` לפני הבאנר
- כבה ב-setTimeout לאחר 1600ms
- Firebase listener בודק: אם `_showingDoneBanner=true` — מרנדר סידבר בלבד, לא מנווט
- רק ה-setTimeout מנווט לאחר הבאנר

## כלל חדש
```
כשיש animation/banner פעיל — Firebase listener לא ינווט.
רק setTimeout/callback מפורש ינווט בסיומו.
```

---

# 📌 כלל זהב

אם באג כבר קרה פעם אחת  
אסור שהוא יקרה שוב