# מספר צורה מאופטי-ווי על הפריט ועל המדבקה — תכנית עבודה

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** בן מעלה את DBLITE מהדיסק-און-קי בדף `opty.html`; כל חלק עם מספר צורה מתחבר לפריט אצלנו (לקוח + שם סקיצה + מידה), נשמר כ־`items[i].optyShape`, ומודפס על המדבקה.

**Architecture:** שני קבצים טהורים (נבדקים ב-Node): `opty-paradox.js` קורא טבלת פרדוקס, `opty-match.js` מחבר חלקים לפריטים. דף `opty.html` (מנהל בלבד) מחבר אותם ל-Firebase. המדבקה (`print-labels.js`) מקבלת שדה `shape`.

**Tech Stack:** HTML/JS סטטי, Firebase compat 9.23, Node לבדיקות (`node scripts/test-*.js`).

**Spec:** `docs/superpowers/specs/2026-11-16-optyway-shape-link-design.md` (+ בן 16/11: "3 הימים האחרונים", "המספר יודפס כשלוחצים להדפיס מדבקה").

## Global Constraints
- לא כותבים לקבצים שנבחרו (רק `File.arrayBuffer()`).
- אין שינוי הרשאות: זוגות לקוחות ב־`meta/optyClients`, חלקים לא נשמרים במסד — רק התוצאה על הפריט.
- התאמה בספק → "לבדיקה", לעולם לא נרשמת לבד.
- ברירת מחדל: חלקים מ־3 הימים האחרונים (שדה ימים בדף), הזמנות מ־30 הימים האחרונים.
- עברית: `TextDecoder('windows-1255')`.

## Review Focus
- אותו לקוח+שם+מידה בשני חלקים שונים (שתי צורות) מול שתי שורות זהות אצלנו → כל צורה לשורה אחרת, לא אותה שורה פעמיים.
- פריט שכבר יש לו מספר צורה אחר → לא דורסים; מסומן "כבר מחובר".
- לקוח חתוך ל־12 תווים ("אומנות הזכוכ") → מתחבר לפי תחילת השם.
- שם סקיצה ריק בחלק → תמיד "לבדיקה".
- מדבקה בלי מספר צורה → נראית בדיוק כמו היום.

### Task 1: `opty-paradox.js` — `lgOptyReadTable(buf: ArrayBuffer) -> {fields: [{name,type,size}], rows: object[]}`
- [ ] בדיקה `scripts/test-opty-paradox.js` על `scripts/fixtures/opty-Pezzi-sample.DB` (טבלה קטנה שנבנית מהעותק האמיתי): 274328 → CLIENTE 'BathPlace', ORDINE 'איציק', DIMXPZ 502, DIMYPZ 1902, CODCOM 'M00291'.
- [ ] מימוש לפי הסקריפט שנבדק (`pdx.py`): כותרת, שדות ב־0x78, בלוקים, מספרים עם ביט סימן הפוך.
### Task 2: `opty-match.js`
- `lgOptyPieces(rows, sinceISO) -> [{shape, client, name, w, h, qty, note, mat, job, date}]` — רק עם SAGOMA, DATACONS ≥ sinceISO.
- `lgOptyNorm(s)` — בלי רווחים/גרשיים/נקודות/מקפים.
- `lgOptyMatch(pieces, orders, pairs) -> {auto:[{shape,job,orderId,idx}], review:[{piece,cands:[{orderId,idx}]}], notFound:[piece], already:[piece]}`
- [ ] בדיקות: ודאי; מידה הפוכה; 222.1 מול 222; שתי צורות ↔ שתי שורות; כמות 2 ↔ שתי שורות; שם ריק → review; לקוח חתוך; אביבי ORDINE '16095' מול sketchName 'PO4372716095'; פריט עם צורה אחרת → already/לא נוגעים; לקוח לא מוכר → notFound.
### Task 3: מדבקה
- [ ] `lgLabelsForClient` מוסיף `shape: String(it.optyShape||'')`; `lgLabelDraw` כותב `צורה 274328` בפינה הימנית התחתונה (y=535, 26px). שלושת המקומות שמעתיקים שדות (`order-labels.js`, `prints.html:196`, `workday.html:2688`) מעבירים גם `shape`.
- [ ] בדיקות ב־`test-print-labels.js` / `test-order-labels.js`.
### Task 4: חלון ההזמנה
- [ ] `admin.html` — ליד כל פריט בחלון "פרטים": `צורה 274328` כשיש.
### Task 5: `opty.html`
- [ ] בחירת קבצים (תיקייה או Pezzi.DB/PezziCan.DB), ימים אחורה (3), "בדוק" → סיכום אוטומטי/לבדיקה/לא נמצא/כבר מחובר; "שמור" כותב `orders/<id>/items/<i>/optyShape|optyJob`; בלבדיקה — בחירת שורה ושמירה; זוגות לקוחות — הוספה ל־`meta/optyClients`.
- [ ] כפתור בתפריט הניהול.
- [ ] בדיקה בדפדפן מול TEST עם הקבצים האמיתיים.
