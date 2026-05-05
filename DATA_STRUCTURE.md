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