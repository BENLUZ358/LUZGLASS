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

## פתרון (היסטורי)
אם inChisum ריק → נכנס ישירות  
אם inChisum לא ריק → נכנס ל-pendingChisum  
כשהתחנה מתרוקנת → pendingChisum עולים אוטומטית ל-inChisum

## ⚠️ עדכון — הפתרון הזה כבר לא בתוקף
מנגנון ה-pendingChisum **בוטל בפועל**: אף שורת קוד לא דחפה אליו, וכל הזמנות
החיסום נכנסות לתחנה יחד (ר' ההערה ב-`handleWorkdayStart`). השדה עצמו הוסר
לגמרי מ-`workday.html` כדי שלא ייווצר מצב שבו התיעוד סותר את הקוד — מצב כזה
מזמין "שחזור" של המנגנון, שהוא בדיוק סיבה #2 של Bug 13.

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
**Firebase Realtime Database מפעיל listener סינכרונית בתוך `.update()`**

הסדר המדויק:
1. `finishSketch()` רץ, קורא ל-`updateStage(A,'opty')`
2. **בתוך** `updateStage`, הקריאה ל-`_lgDb.ref(...).update()` מפעילה
   את ה-`on('value')` listener **סינכרונית** (עוד לפני שה-await מחזיר)
3. Listener בונה מחדש: `queue = [B, C]` — כי A כבר stage='opty' לוקלית
4. חזרנו ל-`finishSketch()` — `queue` כבר `[B,C]`
5. `queue.splice(0, 1)` על `[B,C]` → מוחק את **B**! queue=`[C]`

הסיבה שהבאג עקבי (לא race condition): Firebase מפעיל listener **תמיד** סינכרונית לפני שה-splice רץ.

## פתרון
**הסרת `queue.splice()` לחלוטין מ-`finishSketch()`.**

Firebase listener כבר מוחק את ההזמנה המסיימת מה-queue סינכרונית.
ה-`queue.splice()` היה מיותר ומזיק — מחק את ההזמנה הבאה.

בגיבוי (אם Firebase איטי), ה-setTimeout מסנן את ההזמנה המסיימת:
```js
queue = queue.filter(o => o.id !== finishedId);
```

## כללים חדשים
```
1. Firebase listener יורה סינכרונית בתוך update() — queue מתעדכן לפני שורת הקוד הבאה.
2. לעולם לא לשנות queue ידנית אחרי updateStage() — Firebase כבר עשה זאת.
3. אם צריך לנקות queue ב-setTimeout — להשתמש ב-filter לפי ID, לא splice לפי index.
```

---

# 🐞 Bug 16 — "בחר הכל" מוחק הזמנות מהרשימה

## תיאור
לחיצה על "☑️ בחר הכל" בטאב "בנה יום עבודה" גרמה להיעלמות של כל ההזמנות מהרשימה.

## סיבה
`selectAllFiltered()` כתבה ישירות ל-`workDay.inWork` ו-`workDay.itemsSel`,
קראה ל-`saveWorkDay()` (Firebase), ואז ניווטה ל-`setTab('work')`.
כתוצאה מכך, ההזמנות "הועברו לעבודה" וסוננו מרשימת הבנייה.
הפונקציה עקפה לחלוטין את זרימת הטיוטה.

## פתרון
שכתוב `selectAllFiltered()` כך שתוסיף לטיוטה בלבד (כמו `addToDraft()`):
- לולאה על `getFiltered()` + פילטר זכוכית
- דילוג על פריטים שכבר בטיוטה או ב-`itemsSel`
- `draftItems.push(...)` בלבד — אין כתיבה ל-Firebase, אין שינוי `inWork`
- `updateDraftBadge()` + `renderAll()` + toast

## כלל
```
selectAll / בחר הכל = הוספה לטיוטה בלבד.
לעולם לא לכתוב ל-inWork/Firebase ישירות מ-selectAll.
```

---

# 🐞 Bug 17 — הודעה ללקוח נשלחת לפני שכל הפריטים מוכנים

## תיאור
בסיום יום עבודה, הזמנות עם פריטי מלוטש + חיסום קיבלו הודעת "מוכן לאיסוף"
למרות שפריטי החיסום עדיין לא חזרו מהמפעל.

## סיבה
`getActiveItemsForOrder(o)` מחזיר **ליטוש בלבד** (חיסום הוסר ב-`handleWorkdayStart`).
`classifyOrder(o, [ליטוש_בלבד])` מחזיר `'cut'` גם עבור הזמנה מעורבת.
לכן `confirmFinish()` שלחה הודעה "מוכן לאיסוף" לכל `cut` — כולל הזמנות עם חיסום ממתין.

## פתרון
**`_getFinishDayGroups()`** מפרידה את `cut` לשניים:
- `cutReady` — ליטוש בלבד, ה-ID **לא** ב-`inChisum` ולא `stage='chisum'` → שולח הודעה
- `cutPending` — ה-ID **נמצא** ב-`inChisum` או `stage='chisum'` → **לא שולח הודעה**

`cutPending` + `chisumOrds` ממשיכים בזרימת תחנת בדיקה ← `confirmResetChisum()` שולח הודעה כשהחיסום חוזר.

## כלל
```
הודעה ללקוח נשלחת רק כשכל הפריטים בסקיצה מוכנים.
בדיקה: order.id לא ב-inChisum ולא stage='chisum'.
```

---

# 🐞 Bug 18 — הזמנה ללא פריטים נעלמת מ"בנה יום עבודה"

## תיאור
לחיצה על "הוסף הזמנה שלמה" על הזמנה ללא פריטים (למשל העלאות לקוח `UPL-xxx`)
גרמה להזמנה להיעלם לחלוטין — גם מטאב "בנה יום עבודה" וגם מ"יום עבודה פעיל".

## סיבה
שני גורמים:
1. `addWholeOrder()` הכניס הזמנה עם 0 פריטים ל-`inWork` עם `itemsSel=[]`
2. `getFiltered()` בדק `uniqueSel.length === totalItems` — שניהם 0 → תנאי אמת → הסתיר את ההזמנה
3. ב"יום עבודה פעיל" אין מה להציג (0 פריטים) → ההזמנה פשוט נעלמת

## פתרון
`addWholeOrder()` מחזיר מוקדם + toast אם `_oi.length === 0`

## כלל
```
addWholeOrder() עם 0 פריטים = הזמנה נעלמת (0===0 תמיד אמת ב-getFiltered).
אין להוסיף הזמנה ריקה מפריטים ל-inWork.
```

---

# 🐞 Bug 19 — "0 הזמנות" בפילטר למרות שיש הזמנות

## תיאור
מונה הפילטר בטאב "בנה יום עבודה" הציג "0 הזמנות" למרות שהזמנה הייתה מוצגת.

## סיבה
`renderAvailable()` חישב `total` לפי `o.status==='ב-OptyWay'` (ישן),
אבל `lgStageToStatus('opty') = 'מחכה ל-OptyWay'` — שם שונה.
כך הזמנות עם stage='opty' לא נספרו ב-total → `filtered.length > total` → הציג "0 הזמנות".

## פתרון
שינוי `total` לשימוש ב-`o.stage === 'opty' || o.stage === 'workday'` (כמו `getFiltered`).

## כלל
```
total ב-renderAvailable חייב להשתמש ב-stage (מקור אמת), לא בשדה status.
getFiltered וה-total counter חייבים להשתמש באותה לוגיקת סינון.
```

---

# 🐞 Bug 20 — חוסר סנכרון בין מכשירים בתחנת הבדיקה

## תיאור
אותה הזמנה הופיעה בטאב "הושלמו" באייפד (Safari) ובטאב "בדיקה" בכרום (PC).

## סיבה
`cs` (checkState — מה שנבדק בתחנה) נשמר ב-**localStorage בלבד**.  
`isDone(o)` בודק `cs[o.id][itemIdx]` — ולכן כל מכשיר מחשב "הושלם?" בצורה עצמאית.  
Safari וכרום אינם חולקים localStorage → תוצאה שונה לאותה הזמנה.

## שורש הבעיה — קוד מקורי
```js
// saveCS — כתב רק ל-localStorage
function saveCS(){ safeStorage.setItem('lgCheckState', JSON.stringify(cs)); }

// load — קרא רק מ-localStorage, לא הקשיב ל-Firebase
cs = JSON.parse(safeStorage.getItem('lgCheckState')||'{}');
```

## פתרון
- `saveCS()` כותב גם ל-`/workday/checkState` ב-Firebase
- הlistener `_wdRef` (שכבר מאזין ל-`/workday`) קורא `wd.checkState` ומשים ב-`cs`
- localStorage עדיין משמש כ-cache מקומי בלבד — Firebase הוא מקור האמת

## כלל
```
כל state שמשפיע על תצוגה (isDone, tab placement) חייב לגור ב-Firebase.
localStorage = cache בלבד, לא מקור אמת.
```

---

# 🐞 Bug 21 — חיזוק תשתית תחנת הבדיקה (ביקורת יזומה)

## תיאור
ביקורת עומק יזומה על תחנת הבדיקה, אחרי שהצטברו בעיות חוזרות. נמצאה **רגרסיה חיה
של Bug 13** שסריקת התיקון המקורית פספסה, ועוד שורת כשלים.

## 1. הרגרסיה — confirmChisum/chisumArrived (workday.html)
סיננו לפי `workDay.inChisum` (= תור תחנת הבדיקה, ההזמנה עוד `stage='workday'`)
והתייחסו אליו כאילו ההזמנות **חזרו מהמפעל**. הרצה הייתה:
- שולחת "מוכן לאיסוף" ללקוחות על הזמנות שטרם נבדקו (Bug 17 בצורתו הטהורה),
- `markStageDone` → `lgNextStage` על `stage='workday'` עם חיסום → מחזיר `'chisum'`
  → דוחפת למפעל **בעקיפת תחנת הבדיקה** (Bug 13 סיבה #1, מילה במילה),
- מרוקנת את `inChisum` — מוחקת את כל תור התחנה.

היו בלתי נגישות מה-UI (`chisumArrived()` בלי קורא), אבל globals. **נמחקו.**
מסלול החזרה התקין הוא `resetChisumList`/`confirmResetChisum` בלבד.

## 2. שליחה למפעל "הצליחה" גם כשנכשלה (check-station.html)
כל כתיבה פר-הזמנה תפסה שגיאה בעצמה → `Promise.all` לעולם לא נכשל → ההזמנה
נמחקה מהתור, הודפסה בדוח, והוצג "✓ נשלחו" בזמן שה-`stage` נשאר `'workday'`
וההזמנה חזרה לליטוש. **הזכוכית נוסעת למפעל והמערכת חושבת שהיא בליטוש.**
תוקן: איסוף כשלים, ניקוי תור ודוח רק למה שבאמת עבר, הודעת שגיאה מפורשת.

## 3. הסימון "מת" באמצע עבודה (check-station.html)
`checkItem` כתב `cs[cur.id][i]` בלי הגנה, בעוד השורה שאחריה כבר השתמשה ב-`?.`
ו-`finishSketch` כן הכילה את ההגנה. ה-listener מחליף את כל `cs` בכל שינוי בצומת
`workday` → TypeError שקט בכל הקלקה, ומאותו רגע שום סימון לא נרשם עד רענון.

## 4. סימונים ישנים = משלוח בלי בדיקה
אף שורת קוד לא מחקה `workday/checkState`. הזמנה שחזרה לתחנה הגיעה עם כל
הסימונים דלוקים → `isDone` true מיד → נשלחה למפעל בלי שנבדקה.
תוקן: ניקוי ב-`sendAllToFactory` וב-`resetDay`. בנוסף **הוסר ענף ה"שחזור"**
בליסנר שדחף localStorage בחזרה לענן — הוא היה מבטל כל מחיקה לגיטימית.

## 5. לחיצה כפולה (workday.html)
`confirmResetChisum` ו-`confirmFinish` רצו בלי מנעול. לחיצה שנייה = מטח הודעות
WhatsApp כפול, ו-`lgNextStage` על הזמנה שכבר `done` מחזיר `'collected'` —
**הזמנה מסומנת "נאספה" בזמן שהיא על המדף.** נוסף מנעול (אותו דפוס כמו
`_sendingToFactory` שכבר עבד בתחנה).

## 6. עוד
- `_createReportNum`: `once`+`set` → `transaction` אטומי (מספרי דוח כפולים),
  בתוספת `.validate` מונוטוני ב-`database.rules.json` כמו ל-`orderCounter`.
- `arrivedItems` (הגעה חלקית מהמפעל) היה בזיכרון בלבד — נמחק ברענון. עכשיו מותמד.
- `saveWorkDay` ב-`firebase-db.js` עשה `.set()` על כל הצומת (מוקש: היה מוחק
  `checkState`+`inChisum`). הוחלף ל-`.update()`.
- listeners בלי error-callback → ספינר טעינה לנצח בכל כשל. נוסף מסך שגיאה.
- הדוח למפעל: נחתך לעמוד אחד בהדפסה, הכיל את תפריט הניווט, והדפיס
  "מספר דוח:" בלי המספר. נבנה מחדש כמסמך הדפסה נקי.
- קוד מת שהוסר: `offerChisum` והאוברליי `#chisReport`, `_removeFromChisumStation`,
  `isMirrorItem`, `area`, `demos`, `pendingChisum`.

## כללים
```
1. workDay.inChisum = תור תחנת הבדיקה. stage==='chisum' = כבר במפעל.
   כל פונקציה חדשה חייבת להצהיר במפורש באיזה מהשניים היא עוסקת.
2. Promise.all עם catch פנימי לכל איבר לא נכשל לעולם — לאסוף כשלים ולבדוק.
3. אסור לדווח הצלחה, לנקות תור או להדפיס מסמך לפני שווידאנו שהכתיבה עברה.
4. כל כפתור שמריץ לולאת כתיבות + הודעות חייב מנעול לחיצה כפולה.
5. מונה משותף = transaction בלבד, אף פעם לא read-then-write.
6. state שיוצא מהמערכת (הזמנה שנשלחה או אופסה) חייב לנקות אחריו את הסימונים.
```

---

# 📌 כלל זהב

אם באג כבר קרה פעם אחת  
אסור שהוא יקרה שוב