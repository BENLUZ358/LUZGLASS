# LuzGlass Data Structure

## 🎯 מטרה
המסמך מגדיר את מבנה הנתונים של המערכת.  
אין לשנות מבנה ללא אישור מפורש.

---

# 📦 Order (הזמנה)

```js
order = {
  id: "ord_123",
  orderClient: "שם לקוח",

  stage: "opty",
  status: "מחכה ל-OptyWay",

  name: "שם סקיצה",
  sketch: "...",

  items: [
    {
      width: 100,
      height: 200,
      type: "חיסום", // חיתוך / ליטוש / חיסום
      glass: "שקוף",
      finish: "מלוטש"
    }
  ],

  createdAt: "",
  pickedDate: "",

  total: 0,
  urgent: false
}
```

---

# 🔄 Stage Values

```
sketch
drafter
opty
workday
chisum
done
collected
```

---

# 📦 workDay

```js
workDay = {
  date: "",

  inWork: [],     // רשימת orderId (String)
  inChisum: [],   // רשימת orderId (String)

  itemsSel: {}    // בחירת פריטים מתוך הזמנות
}
```

---

# 📦 itemsSel (קריטי)

```js
itemsSel = {
  [orderId]: [itemIndexes]
}
```

דוגמה:

```js
itemsSel = {
  "ord_123": [0, 2, 4],
  "ord_456": [1]
}
```

---

# ⚠️ חוק קריטי
itemsSel הוא מקור האמת היחיד לפריטים שנבחרו.

❌ אסור להשתמש ב:
```js
o.items
```
כאילו כל הפריטים נבחרו.

---

# ✏️ Draft (טיוטה זמנית - UI בלבד)

```js
draftItems = [
  {
    orderId: "ord_123",
    itemIndex: 0,
    name: "שם סקיצה",
    type: "חיסום",
    width: 100,
    height: 200
  }
]
```

הטיוטה זמנית בלבד (לא מקור אמת).  
העברה ליום עבודה מתבצעת רק בלחיצה על "הורד לעבודה".

---

# 🔁 קשר בין נתונים

```
Order → items (כל הפריטים)

itemsSel → רק הפריטים שנבחרו

workDay.inWork → הזמנות פעילות ביום עבודה

workDay.inChisum → הזמנות עם פריטי חיסום
```

---

# 📡 Firebase

```
/orders/{orderId}
/workday
```

Firebase הוא מקור האמת היחיד.

---

# ⚙️ פעולות במערכת

```js
updateOrder(id, fields)
updateStage(id, stage)
listenAllOrders(callback)
listenClientOrders(name, callback)
```

---

# ⚠️ חוקים חשובים

1. כל ID חייב להיות String:

```js
String(orderId)
```

2. אין לערבב בין:
- מספרים
- מחרוזות

3. לפני includes / find:

```js
String(id)
```

---

# ❌ דברים שאסור

- לא לשנות את מבנה order
- לא לשנות את workDay
- לא לשנות את itemsSel
- לא להשתמש ב-localStorage כמקור אמת להזמנות
- לא להכניס לוגיקה חדשה בלי צורך

---

# 🧪 בדיקות חובה

אחרי כל שינוי:

1. הנתונים נשמרים ב-Firebase  
2. itemsSel נשמר נכון  
3. אין כפילויות  
4. אין הזמנות ריקות  
5. אין מצב שיש מונה בלי פריטים בפועל
## invoicePdf / invoicePdfBlobs (DB-00004)

`invoicePdf/<key>` — חשבונית שהופקה בחשבשבת וממתינה ל-PDF מכלי המחשב (`tools/invoice-watcher`).
`key` = sha1 של orderIds ממוינים. כתיבה: שרת בלבד.

| שדה | הערה |
|---|---|
| `state` | `awaiting` (נרשם ב-`hashavshevet-invoice`) → `ready` (הועלה ושויך ב-`_invoice-upload`) |
| `orderIds`, `orderNums`, `sketchNames` | ההזמנות שנבחרו; לפי שמות הסקיצות מזהים את ה-PDF |
| `client`, `clientPhone`, `reference`, `simulated` | |
| `docNumber`, `date`, `archivePath`, `originalHash`, `uploadedAt` | אחרי העלאה. `archivePath` = `שנה/חודש/לקוח/תאריך_מספר.pdf` |
| `sendAfter`, `sendKey` | סוף חלון הביטול (5 דקות) ומפתח למניעת כפילות — **טרם נצרכים: אין עדיין שליחה** |

`invoicePdfBlobs/<key>` — `{ original, copy }` base64. לא קריא מהדפדפן.

Endpoint: `POST /api/invoice-pdf-upload` (rewrite ל-`wa-inbound?invoice=upload`), משתנה סביבה `INVOICE_UPLOAD_TOKEN`.

### בקרה על חשבוניות (שלב 2)

- `state` נוסף: `printed` — ההדפסה הגיעה לפני "החשבונית הופקה". מפתח `p<hash>`, עם `docNumber`, `date`, `text` (טקסט המקור לשיוך). הרישום (`register`) משייך אותה לפי מספר מסמך ושמות סקיצות, וכשהיא משויכת הרשומה נמחקת.
- `awaiting` מקבל גם `docNumber` כשנרשם דרך `register` ("החשבונית הופקה" בתחנה), ו-`createdAt` (אינדקס לרשימת הארכיון).
- `orders/<id>/invoicePdfKey` — נכתב על ההזמנות **רק כשה-PDF מוכן ושויך**. הפורטל מציג לפיו חשבוניות; לקוח אינו יכול ליצור הזמנה עם השדה.
- Endpoint: `POST /api/invoice-ctl` (rewrite ל-`wa-inbound?invoice=ctl`), `Authorization: Bearer <ID token>`: `register` (אדמין), `list` (אדמין), `pdf` (אדמין, או לקוח שכל ההזמנות בחשבונית שלו). מחזיר את **המקור בלבד**.
