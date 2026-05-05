# LuzGlass Firebase Rules

## 🎯 מטרה
להגדיר איך המערכת עובדת עם Firebase.

Firebase הוא מקור האמת היחיד לכל הנתונים.

---

# 📡 מבנה בסיסי

```text
/orders/{orderId}
/workday
```

---

# 📦 Orders

כל הזמנה נשמרת תחת:

```text
/orders/{orderId}
```

---

## שדות מרכזיים

```js
order = {
  id: "ord_123",
  orderClient: "שם לקוח",

  stage: "opty",
  status: "מחכה ל-OptyWay",

  items: [],
  sketch: "",

  createdAt: "",
  pickedDate: ""
}
```

---

# 📦 Workday

```js
workDay = {
  date: "",
  inWork: [],
  inChisum: [],
  itemsSel: {}
}
```

---

# 🔄 קריאה לנתונים

## כל ההזמנות

```js
listenAllOrders(callback)
```

✔ מאזין בזמן אמת  
✔ מקור אמת לאדמין  

---

## פורטל לקוח

```js
listenClientOrders(clientName, callback)
```

✔ מסנן לפי orderClient  
✔ מציג רק ללקוח  

---

# ✏️ עדכון נתונים

## עדכון הזמנה

```js
updateOrder(id, fields)
```

✔ משנה שדות בלבד  
❌ לא משנה stage  

---

## שינוי סטטוס

```js
updateStage(id, stage)
```

✔ משנה stage  
✔ מתעדכן בכל המערכת  

---

# ⚠️ חוקים קריטיים

1. Firebase הוא מקור האמת  
2. אין להשתמש ב-localStorage להזמנות  
3. אין לשמור נתונים כפולים  
4. אין לשנות נתונים ישירות בקוד  

---

# 🚫 אסור

- לא לעקוף Firebase  
- לא ליצור נתונים מקומיים במקום Firebase  
- לא לשנות stage ידנית  
- לא ליצור מבנה חדש  

---

# 🔥 ביצועים

## Index

יש להגדיר:

```json
{
  "rules": {
    ".read": true,
    ".write": true,
    "orders": {
      ".indexOn": ["orderClient"]
    }
  }
}
```

---

# ⚠️ Warning נפוץ

```text
orderByChild orderClient without index
```

✔ נפתר ע"י indexOn  

---

# 🔄 סנכרון

```text
Admin → Firebase → Client Portal
```

✔ כל שינוי מתעדכן בזמן אמת  

---

# 🌐 פורטל לקוח

- קורא רק מ-Firebase  
- לא שומר נתונים  
- לא משנה נתונים  

---

# 🧪 בדיקות חובה

אחרי כל שינוי:

1. Firebase מתעדכן  
2. אין שגיאות  
3. הנתונים חוזרים נכון  
4. פורטל מתעדכן  
5. אין כפילויות  

---

# 📌 כלל זהב

אם הנתון לא ב-Firebase — הוא לא קיים