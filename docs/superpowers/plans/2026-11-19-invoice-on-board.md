# חשבונית בלוח + חשבונית לפני איסוף — תכנית עבודה

> For agentic workers: executed natively in this session (Ben said "תבנה").

**Goal:** חשבונית על הזמנה מוכנה מתחנת החשבוניות, תווית ואזור חשבונית בלוח (פתח, שלח שוב, הדפס), ו־🖨 סקיצה בתחנת הבדיקה, בתחנת החשבוניות ובמסך לשרטט.
**Spec:** docs/superpowers/specs/2026-11-19-invoice-on-board-design.md

## Global Constraints
- "מוכן לאיסוף" בקוד הוא `stage === 'done'`. ממתין להובלה הוא `'delivery'`. שניהם "מוכן, עוד לא נאסף": `LG_EARLY_INVOICE_STAGES = ['done','delivery']`.
- בלי שינוי חוקי DB, בלי שינוי בכלי במשרד.
- שדה חדש בהזמנה → whitelist בנורמלייזר. כאן אין שדה חדש.
- גרסת `firebase-db.js?v=` מתעדכנת בכל דף שנוגעים בו.

## Review Focus
1. הזמנה מוכנה שקיבלה חשבונית ונשארה "מוכן". כשתועבר לנאסף היא `invoiced` ולא חוזרת ללשונית יומיות/שוטף 30.
2. לקוח חלקי (9117/14201) במוכן: כל הפריטים שעוד לא חויבו נכנסים לחשבונית, ו־invoiceDone מלא נרשם כשכולם חויבו.
3. "שלח שוב" בלחיצה כפולה: אותה דקה → אותו מפתח בתור, ולכן הודעה אחת.
4. הזמנה עם invoiceDone בלי רשומת PDF: החלון מראה "ה־PDF עוד לא הגיע", ולא שגיאה.
5. חשבונית ניסיון (simulated) או לקוח פורטל: "שלח שוב" מחזיר סיבה ולא שולח.

### Task 1 — firebase-db.js: מוכן נכנס לתחנה
- `lgInvoiceState`: גם `done`/`delivery` בתחנה. `lgInvoiceablePieces`: אותו דבר כמו `collected`. `lgMarkInvoiced`: סגירה מלאה של לקוח חלקי גם בשלבים האלה.
- `lgInvoiceGroups` scope `'ready'`: רק השלבים המוקדמים. כל scope אחר ('all','daily','monthly') מדלג עליהם.
- בדיקות ב־scripts/test-invoice-station.js:
  - הזמנה ב־done היא pending.
  - scope ready מכיל אותה, ו־daily לא.
  - אחרי סימון היא invoiced ולא מופיעה באף scope, גם אחרי שעברה ל־collected.
  - חלקי ב־done: כל הפריטים, ו־invoiceDone מלא.

### Task 2 — invoices.html: לשונית "מוכן, לא נאסף"
- כפתור scope שלישי `data-scope="ready"` עם מונה `nReady` וטקסט ריק מתאים.
- אחרי `lgMarkInvoiced` מוצלח, כשיש הזמנות בשלב מוקדם, נפתח מודל "יצאה חשבונית. להעביר לנאסף?" עם [כן, העבר לנאסף] [לא, להשאיר במוכן]. "כן" מריץ `updateStage(id,'collected')` לכל אחת.

### Task 3 — שרת: /api/invoice-ctl
- `GET order&id=`: אדמין. קורא את `orders/<id>` (invoiceDone.docNumber + pieces), מושך רשומות invoicePdf לפי docNumber שה־orderIds שלהן כוללים את ה־id, ומחזיר `{ ok, docs:[docNumber...], items:[view] }`.
- `POST resend {key}`: אדמין. `lgInvoiceDeliver(db,key,{now,resend:true})` מדלג על הבדיקות "כבר נשלח", ומכניס לתור עם `keySuffix: 'r'+floor(now/60000)`. מפתח חשבונית בתור: `'invoice#'+doc+('#'+keySuffix)` (וואטסאפ ומייל).
- `POST print {key}`: אדמין. original → `lgPdfToJpegs(buf,{targetW:1240,maxPages:10})` → עבודת `sheets/a4` בתור (`create` מיוצא מ־_print-jobs).
- בדיקות: scripts/test-invoice-ctl-board.js (fake db): order, resend (נשלח פעמיים עם מפתח שונה בדקות שונות, אותו מפתח באותה דקה), simulated → skipped, print → עבודה בתור.

### Task 4 — admin.html: תווית + אזור חשבונית
- `lgInvoiceTag(o)` → `🧾 <מספרים>` כשיש invoiceDone/pieces. בכרטיס (c-tags) ובטבלה (עמודת לקוח).
- בחלון: `<div id="modInv">` מתחת לפריטים, נטען מ־`invoice-ctl?action=order`. לכל רשומה: מספר · תאריך · מצב שליחה, וכפתורים [פתח PDF] [שלח שוב (confirm)] [🖨 הדפס].

### Task 5 — 🖨 סקיצה בשלושה מסכים
- `sketch-print.js` חדש: `lgSketchPageJpeg(img, head)` (עובר מ־admin.html) + `lgPrintSketchImg(img, o, btn)` → `/api/print`. admin.html משתמש בו.
- כפתור בתחנת הבדיקה, בתחנת החשבוניות (לשונית סקיצה באימות) ובמסך לשרטט, ליד כל סקיצה מוצגת.

### Task 6 — בדיקות מלאות, העלאה לבדיקה (test), דיווח לבן
