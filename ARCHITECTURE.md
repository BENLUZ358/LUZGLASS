# LuzGlass — ארכיטקטורה ונקודות סיכון
_עדכון אחרון: 12/05/2026 | גרסה 2.5_

---

## מצב כללי

המערכת פועלת על Firebase Realtime Database, דפי HTML סטטיים, ו-firebase-db.js כשכבת שירות משותפת. הארכיטקטורה עובדת טוב לנפח הנוכחי, אבל יש כמה נקודות שצריך לחזק לפני גדילה וחיבור API לחשבשבת.

---

## מה בנוי נכון ✅

| מה | למה זה טוב |
|----|------------|
| `ord_<ts>` / `sub_<ts>` כ-document ID | יציב, ייחודי, לא משתנה |
| `lgNextOrderNum()` עם `runTransaction` | אין כפילויות גם בבו-זמנית |
| `_lgNormalizePhone` ב-`lgSaveUser` | טלפון אחיד במשתמשים |
| `listenAllPrices` → `lgCalcOrderTotal` | מחיר דינמי real-time |
| `totalFinal` / `pricesLockedAt` | מחיר נעול אחרי `done` |
| `deliveryClient` כ-denormalization | אין תלות ב-users/ בrender |
| `_csLocalPending` ב-check-station | מניעת race condition checkState |
| `LG_STAGE_TO_STATUS` כמפה מרכזית | stage ↔ status עקביים |

---

## נקודות סיכון — לפי חומרה

### 🔴 קריטי — לטפל לפני חשבשבת

#### 1. `lgLockPrice + updateStage` — לא אטומי
**קבצים:** `firebase-db.js`, `workday.html` ×3, `admin.html` ×1

שתי כתיבות נפרדות ל-Firebase. אם `updateStage` נכשל אחרי `lgLockPrice`:
- ה-order נשאר ב-`workday` עם `totalFinal` נעול — מחיר נעול בשלב הלא נכון.

אם `lgLockPrice` נכשל אבל `updateStage` מצליח:
- ה-order עבר ל-`done` **ללא `totalFinal`** — ייחשב דינמית לנצח.

**תיקון:** פונקציה `lgLockAndAdvance(orderId, order, globalP, clientP, nextStage)` שעושה multi-path update אחד אטומי לכל השדות.

---

#### 2. `lockedItems[]` חסר — פירוט שורות לחשבונית
**קבצים:** `firebase-db.js` → `lgLockPrice`

`totalFinal` שומר רק סכום כולל. חשבשבת דורש **פירוט שורות**: כמות × מחיר יחידה לכל פריט. ללא זה, הפקת חשבונית API לא תוכל לכלול פירוט.

**תיקון:** ב-`lgLockPrice`, שמור גם:
```js
order.lockedItems = items.map(item => ({
  name:       item.glassFullName || item.name,
  sku:        item.sku || lgFindPriceItem(item.glassFullName||item.name),
  w: item.w, h: item.h,
  area:       round2((item.w/100)*(item.h/100)),
  pricePerM2: ppm2,
  lineTotal:  Math.round(area * ppm2)
}))
```

---

#### 3. `customerId` + `clientPhone` חסרים על ה-order
**קבצים:** `firebase-db.js` → `saveOrder`, `saveSubmission`

חשבשבת דורש `customerId` (מזהה לקוח בחשבשבת) על ה-order. כרגע קיים רק על `users/<phone>`. בנוסף, `orderClient` (שם כמחרוזת) משמש כ-foreign key — אם שם הלקוח ישתנה, ההיסטוריה תישבר.

**תיקון:** ב-`saveOrder`/`saveSubmission`:
```js
clientPhone: _lgNormalizePhone(data.phone || ''),
customerId:  data.customerId || ''  // ימולא מה-user בזמן יצירה
```

---

#### 4. שדות חסרים לחשבונית API

| שדה | מצב | נדרש לחשבשבת |
|-----|-----|--------------|
| `invoiceId` | חסר לחלוטין | ✅ מזהה חשבונית שהוחזר מ-API |
| `invoiceNum` | חסר | ✅ מספר חשבונית לתצוגה |
| `invoiceDate` | חסר | ✅ |
| `paymentStatus` | חסר | ✅ `'unpaid'|'paid'|'partial'` |
| `vatType` | חסר | ✅ עם/ללא מע"מ |
| `businessName` | רק ב-user | ✅ על ה-order עצמו |
| `item.sku` | לא נשמר | ✅ לשורת פריט בחשבונית |
| `item.quantity` (מ"ר) | לא נשמר, רק w×h | ✅ |
| `item.unitPrice` | לא נשמר | ✅ |

---

### 🟡 בינוני — לטפל לפני גדילה

#### 5. `LG_SKU_MAP` vs `LG_PRICE_ITEMS` — פערים
**קבצים:** `firebase-db.js`

`LG_SKU_MAP` מכיל ~70 מק"טים. `LG_PRICE_ITEMS` מכיל רק 17. פריטים כמו פיפטה, גלינה, אסיד קליר — **אין להם price item**. `lgFindPriceItem` יחזיר fallback `cl-8-pol` בשקט ב-₪0 (אם לא הוגדר מחיר).

**תיקון:** הוסף price items לכל קטגוריה חסרה. הוסף validation.

---

#### 6. `item.sku` / `item.priceItemId` לא נשמרים
**קבצים:** `workday.html` → `saveManualItem`, `new-order.html`

פריטים מזוהים רק לפי `glassFullName` (מחרוזת חופשית). שגיאת כתיב בשם → מחיר 0 בשקט. לחשבשבת נדרש `catalogNumber` קבוע.

**תיקון:** בזמן הוספת פריט: `item.sku = glass` (אם הוזן מק"ט), `item.priceItemId = lgFindPriceItem(name)`.

---

#### 7. `arrivedItems` — session state שאובד
**קבצים:** `workday.html`

`arrivedItems` (פריטים שסומנו "הגיע מהמפעל" בסשן הנוכחי) לא נשמר ל-Firebase עד `confirmResetChisum`. אם הדף נסגר — הסימונים אובדים.

**תיקון:** שמור `arrivedItems` ל-`workday/arrivedItems/<orderId>` בכל toggle (debounced 500ms). שחזר בטעינה.

---

#### 8. `saveWorkDay` עושה `.set()` במקום `.update()`
**קבצים:** `firebase-db.js` שורה 227

`.set()` על כל ה-workday node יכול לדרוס `checkState` אם נכתב בין הקריאה לכתיבה.

**תיקון:** שנה ל-`.update()` על שדות ספציפיים בלבד.

---

#### 9. `phone` לא מנורמל ב-`saveOrder`
**קבצים:** `firebase-db.js` → `saveOrder`, `saveSubmission`

`_lgNormalizePhone` נקרא ב-`lgSaveUser` אבל לא ב-`saveOrder`. תוצאה: `"052-777-8888"` ו-`"0527778888"` עלולים להישמר לאותו לקוח בצורות שונות.

**תיקון:** `phone: _lgNormalizePhone(data.phone || '')` בשני המקומות.

---

#### 10. `orderClient` כ-foreign key — טקסט משתנה
**קבצים:** `firebase-db.js` → `listenClientOrders`

שאילתת Firebase: `orderByChild('orderClient').equalTo(clientName)`. אם שם לקוח משתנה — ההיסטוריה ניתקת. אין index מוכרז.

**תיקון:** עבור ל-`orderByChild('clientPhone')` (אחרי migration). הוסף `.indexOn: ["clientPhone"]` ב-Firebase Rules.

---

### 🟢 נמוך / עתידי

#### 11. `markStageValue` — prefix מיותר
```js
const ordKey = sid.startsWith('ord_')||sid.startsWith('sub_') ? sid : 'ord_'+sid;
```
לא שובר אבל מבלבל. כדאי לפשט.

#### 12. `allOrders` ב-workday — IDs "מת" ב-inWork
אם הזמנה עברה ל-`done` ע"י admin בזמן שworkday פועל, ה-id נשאר ב-`inWork` עד הניקוי הבא. לא קריטי — אוטומטית נוקה ב-filter.

---

## מיפוי: מה תלוי ב-UI ולא ב-Firebase

| State | מיקום | בעיה |
|-------|-------|------|
| `globalPrices`, `clientPrices` | admin.html זיכרון | נטען מ-Firebase, אבד ברענון |
| `arrivedItems` | workday.html זיכרון | לא נשמר — **אובד** |
| `workDay.inWork`, `itemsSel` | workday.html זיכרון | נטען מ-Firebase, כתיבה ב-set |
| `qnEdits`, `sqNoteMap` | admin.html זיכרון | session only |
| `_deliveryPhones` | workday.html זיכרון | נטען מ-Firebase, cache חד-פעמי |

---

## תוכנית הכנה ל-חשבשבת API

### שלב 1 — תשתית (לפני כל קוד API)

```
1. הוסף לסכמת order:
   clientPhone, customerId, businessName
   invoiceId, invoiceNum, invoiceDate
   paymentStatus: 'unpaid'
   vatType: 'inclusive' | 'exclusive' | 'none'

2. lgLockAndAdvance — multi-path update אטומי

3. lockedItems[] — פירוט שורות נעולות

4. item.sku + item.priceItemId על כל פריט חדש
```

### שלב 2 — Migration Scripts

```
1. הוסף clientPhone לכל הזמנה היסטורית
   (lookup לפי orderClient → users → phone)

2. הוסף customerId לכל הזמנה היסטורית

3. נרמל phone בכל הזמנות

4. הוסף paymentStatus: 'unpaid' לכל הזמנות פעילות
```

### שלב 3 — Cloud Function לחשבשבת
```
שום credential של חשבשבת לא יחשף ב-client-side JS.
הקריאה ל-API תהיה תמיד דרך Cloud Function:
  createInvoice(orderId) → Hashavshevet API → שמור invoiceId על ה-order
```

---

## מבנה Order מלא לחשבשבת (עתידי)

```js
{
  // זהות
  id:             'ord_1747036800000',
  orderNum:       'L1042',
  orderClient:    'א.מ מראות',      // לתצוגה
  clientPhone:    '0521234567',      // foreign key לטלפון
  customerId:     'C-0042',          // מזהה ב-חשבשבת
  businessName:   'א.מ מראות בע"מ', // copy מה-user
  
  // שלב
  stage:          'done',
  status:         'מוכן לאיסוף',
  
  // מחיר
  totalFinal:     2966,              // נעול בעת done
  totalM2:        10.6,
  pricesLockedAt: 1747036800000,
  vatType:        'inclusive',
  lockedItems: [
    { name:'מראה 5מ"מ מלוטש', sku:'5MIRM', area:2.4, pricePerM2:280, lineTotal:672 }
  ],
  
  // חשבונית
  invoiceId:      null,              // ימולא אחרי API call
  invoiceNum:     null,
  invoiceDate:    null,
  paymentStatus:  'unpaid',
  
  // מטאדאטה
  createdAt:      1747036800000,
  updatedAt:      1747036800000
}
```

---

## פעולות לביצוע — לפי עדיפות

| # | פעולה | קבצים | דחיפות |
|---|--------|-------|--------|
| 1 | `lgLockAndAdvance` — multi-path atomic | firebase-db.js + workday + admin | 🔴 עכשיו |
| 2 | `lockedItems[]` ב-`lgLockPrice` | firebase-db.js | 🔴 עכשיו |
| 3 | הוסף `clientPhone`+`customerId`+`invoiceId`+`paymentStatus` לסכמת order | firebase-db.js | 🔴 לפני חשבשבת |
| 4 | `saveWorkDay` → `.update()` | firebase-db.js | 🟡 בקרוב |
| 5 | שמור `arrivedItems` ב-Firebase | workday.html | 🟡 בקרוב |
| 6 | `phone` normalization ב-`saveOrder` | firebase-db.js | 🟡 בקרוב |
| 7 | `item.sku` + `item.priceItemId` | workday.html, new-order.html | 🟡 לפני חשבשבת |
| 8 | הרחב `LG_PRICE_ITEMS` לכל הקטגוריות | firebase-db.js | 🟡 בקרוב |
| 9 | Firebase Rules + `.indexOn: clientPhone` | firebase.rules | לפני חשבשבת |
| 10 | Cloud Function לחשבשבת API | functions/ | כשמגיע לחשבשבת |
