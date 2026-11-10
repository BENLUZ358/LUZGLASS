# שבר בחיסום — תכנית ביצוע

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** הזמנת הובלות שחלק ממנה לא חזר מהחיסום ממשיכה להובלה ולחשבונית על כולה. הלקוח מקבל הודעה עם החשבונית, והודעה נוספת כשהפריט חוזר.

**Architecture:** שלושה חלקים:
- **החלטה טהורה** ב־`firebase-db.js`: מי שבור, והאם ההזמנה ממשיכה. נבדקת ב־vm, כמו בשאר הבדיקות.
- **workday.html** משתמש בה ב"סיום בדיקה", וגם מציג את הכרטיסים "שבור" ו"פריט חוזר".
- **בשרת:** מודול `api/_broken.js` מנסח את שורות ההודעה. `renderText` מקבל `extraLines`, והשדה עובר דרך התורים של הוואטסאפ והמייל. הודעת "חזר" נשלחת דרך `whatsapp-dispatch` עם `kind:'broken-returned'`.

**Tech Stack:** JS בדפדפן, Vercel functions ב־Node, Firebase RTDB. הבדיקות הן `node scripts/test-*.js`.

**Spec:** `docs/superpowers/specs/2026-11-10-broken-chisum-invoice-design.md`

## Global Constraints
- רק לקוחות הובלות: `order.deliveryClient`, או `_isDeliveryClient(...)`, או `LG_DELIVERY_ACCOUNTS`.
- טריפלקס שעוד לא חזר (`!o.triplexArrived` כשיש טריפלקס פתוח): ההזמנה מחכה, ושום דבר לא נחשב שבור.
- אסור לשנות rules. `brokenChisum` נכתב על ההזמנה דרך `updateOrder`.
- ההודעות ללקוח נשלחות לנמען החשבונית (`resolveRecipient*(…,'invoice')` + `lgInvoiceEmailFor`).
- אין חשבונית שנייה, ואין חזרה לשלב `chisum`.

## Review Focus
1. **הזמנה שכל פריטי המפעל שלה חסרים ואין בה שום דבר אחר:** נשארת בחיסום (בדיקה ב־Task 1).
2. **"סיום בדיקה" שני על הזמנה שכבר יש לה `brokenChisum`:** לא נוגע ברשומה, כי ההזמנה כבר לא בחיסום (Task 2, בדיקת ההסתעפות).
3. **חשבונית על כמה הזמנות שרק לאחת מהן יש שבור:** רק השורות של אותה הזמנה מופיעות (Task 3).
4. **לחיצה כפולה על "חזר":** הודעה אחת בלבד, כי המפתח בתור הוא לפי `broken-returned#idx` (Task 3).
5. **לקוח שאינו לקוח הובלות עם פריט חסר:** אין שינוי מהיום, וההזמנה נשארת בחיסום (Task 1).

---

### Task 1: החלטה טהורה — `lgBrokenPlan`, `lgBrokenOpen`
**Files:** `firebase-db.js` (ליד `LG_DELIVERY_ACCOUNTS`). בדיקה: `scripts/test-broken-chisum.js`.
**Produces:**
- `lgBrokenPlan({ isDelivery, waitsPolish, done, chisumPending:number[], chisumArrived:number[], triplexPending:number[], triplexArrived:number[], triplexBack:boolean, closedAny:boolean, itemCount:number, factoryCount:number }) → null | [{idx, track}]`
  - מחזיר `null` כשאחד מאלה נכון: `!isDelivery`, `done`, `waitsPolish`, או שיש טריפלקס פתוח ו־`!triplexBack`.
  - מחזיר `null` גם כשאין שום דבר מוכן: `chisumArrived.length + triplexArrived.length === 0 && !closedAny && itemCount <= factoryCount`.
  - אחרת מחזיר את הפתוחים שלא סומנו: קודם החיסום, אחר כך הטריפלקס.
- `lgBrokenOpen(o) → [{idx, track, at}]`: מה שיש ב־`o.brokenChisum` בלי `returnedAt`, ממוין לפי idx.
- `lgBrokenReturnedUndelivered(o) → [{idx, track, returnedAt}]`: יש `returnedAt` ואין `deliveredAt`.

- [ ] כתוב בדיקות: לקוח לא־הובלות → null; done → null; טריפלקס פתוח בלי triplexBack → null; כלום לא מוכן → null; חיסום 2 מתוך 3 חזר → `[{idx:X,track:'chisum'}]`; מראה בבית + אפס חזר → שבורים; triplexBack עם טריפלקס חסר → `track:'triplex'`; `closedAny` → ממשיכה.
- [ ] הרץ ובדוק שהבדיקות נכשלות. אחר כך ממש את הפונקציות, הרץ, ובדוק שהכול עובר.

### Task 2: workday — "סיום בדיקה", כרטיס שבור, פריט חוזר בהובלה
**Files:** `workday.html` (`resetChisumList`, `confirmResetChisum`, `renderChisumTab`, לשונית ההובלה). בדיקה: תוספת ל־`scripts/test-broken-chisum.js` (בדיקה סטטית של המקור).
- **פונקציה חדשה** `_brokenPlanOf(o)`, שקוראת ל־`lgBrokenPlan` עם:
  - `_factoryDoneState(o)`
  - `_pendingIdxsOf`
  - `o.triplexArrived`
  - `closedAny`: האם יש משהו ב־closed lists
  - `itemCount = items.length`
  - `factoryCount`: האורך של chisum+triplex מ־`lgSplitFactoryItems`
  - `isDelivery = lgNextStage(o, _isDeliveryClient(..)) !== 'done' && (o.deliveryClient || _isDeliveryClient(..) || LG_DELIVERY_ACCOUNTS.includes(cid))`
- **בדיאלוג:** קבוצה חדשה `brokenOrds`, שנבדקת לפני partial. הכותרת: "🚚 N הזמנות ממשיכות — פריט שלא חזר ייחשב שבור", ושורה לכל הזמנה: "L… · פריט X לא חזר".
- **באישור:** לכל הזמנה ב־brokenOrds:
  1. `_closeArrived` על מה שסומן.
  2. `updateOrder(sid, {brokenChisum: {idx:{at, track}}})`.
  3. אותו מסלול התקדמות כמו `st.done` (`lgLockAndAdvance` להובלה, `updateOrder` לגרפיקה) וניקוי הרשימות. בלי הודעת "מוכן".
- **בלשונית החיסום:** קטע עליון "פריטים שבורים — בייצור מחדש" לכל `lgBrokenOpen` מכל ההזמנות. כל שורה מציגה מספר הזמנה, לקוח, שם סקיצה, מידות ו־`[✓ חזר]`.
- **`markBrokenReturned(id, idx)`:**
  - כותב `brokenChisum/idx/returnedAt`.
  - קורא `_lgAuthPost('/api/whatsapp-dispatch', {kind:'broken-returned', orderIds:[id], idx})`.
  - מציג toast לפי התוצאה.
- **בלשונית ההובלה:** קטע "פריטים חוזרים" לכל `lgBrokenReturnedUndelivered`, עם `[נמסר]` שכותב `deliveredAt`.
- [ ] בדיקה סטטית: confirmResetChisum קורא ל־`_brokenPlanOf`, ו־brokenChisum נכתב לפני הניקוי. אחר כך ממש והרץ את כל `scripts/test-*.js` הקשורים: stage-routing, delivery-accounts-list, invoice-station.

### Task 3: שרת — שורות ההודעה, חשבונית, הודעת "חזר"
**Files:**
- Create `api/_broken.js`
- Modify:
  - `api/_wa-provider.js` (renderText)
  - `api/_wa-outbox.js`
  - `api/_email-outbox.js`
  - `api/_wa-drain-core.js`
  - `api/_invoice-deliver.js`
  - `api/whatsapp-dispatch.js`

Test: `scripts/test-broken-chisum.js`.

**Produces:**
- `brokenInvoiceLines(orders) → string[]`: שורה לכל פריט פתוח, `"בהזמנה {orderNum} ({sketchName}) הפריט {w×h} מ\"מ נשבר בחיסום ונמצא בייצור מחדש."`.
- `brokenReturnedLines(order, idx, docNumber) → string[]`.
- `renderText({..., extraLines})`:
  - כשמדובר ב־invoice ויש extraLines, נוסף בסוף: `"שימו לב:\n" + lines + "\nהחשבונית יוצאת על כל ההזמנה, והפריט יגיע בהמשך."`.
  - `kind 'broken-returned'` → `"הפריט {…} מהזמנה {num} ({sketch}) חזר מהחיסום ויגיע אליכם בהובלה הקרובה. החשבונית כבר יצאה על כל ההזמנה (חשבונית {doc})."`. בלי doc, החלק שבסוגריים לא מופיע.
- `lgWaEnqueue` / `lgEmailEnqueue` מקבלים `extraLines` ו־`keySuffix`. המפתח הוא `kind + '#' + keySuffix` כשיש keySuffix. `sendTo` + subject חלים גם על `broken-returned`.
- `lgBrokenReturnedNotify(db, orderId, idx, deps)` ב־`_broken.js`:
  - פותר נמען כמו `lgInvoiceDeliver`.
  - מכניס לתור עם `extraLines` ו־`keySuffix: idx`.
  - בוואטסאפ מריץ drain.
  - מחזיר `{state, channel}`.
- [ ] בדיקות: renderText עם/בלי extraLines; broken-returned עם/בלי doc; brokenInvoiceLines רק להזמנה עם פתוח; מפתח תור שונה לכל idx ואותו מפתח בלחיצה כפולה.
- [ ] ממש, והרץ את כל `scripts/test-*.js` של wa/email/invoice.

### Task 4: תג בתחנת החשבוניות + העלאה ל־test
**Files:** `invoices.html` (`renderOrders`).
- [ ] בשורת ההזמנה יש `lgBrokenOpen(o).length`. התג הוא `<span class="tag-broken">פריט שבור — עוד בחיסום</span>`. אם כל הפריטים חזרו, התג הוא "פריט שבור חזר".
- [ ] בדיקה סטטית, ואז קומיט, מיזוג ל־test, ובדיקה באתר הבדיקות.
