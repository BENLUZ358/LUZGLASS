# שתי סביבות — ייצור ובדיקות

אותו קוד בדיוק, בשני ענפים, עם נתונים ואינטגרציות מבודדים.

| | ייצור | בדיקות |
|---|---|---|
| כתובת | `luzglass.vercel.app` | `luzglass-test.vercel.app` |
| ענף Git | `main` | `test` |
| פרויקט Firebase | `lussglass` | `luz-glass-test` |
| מספרי הזמנות | 1xxx | **9xxx** |
| חשבשבת / WhatsApp | פעיל | **חסום** |
| תג על המסך | — | פס אדום `TEST · luz-glass-test` |

---

## תהליך העבודה

```bash
git checkout test
# ...עובדים...
git push origin test          # TEST מתעדכן. הייצור לא זז.

# אחרי שנבדק:
git checkout main
git merge test
git push origin main          # הייצור מתעדכן.
git checkout test             # חוזרים לעבוד
```

**תיקון דחוף בייצור** נדחף ישירות ל-`main`, ואז `git merge main` בתוך `test`
כדי שהשניים לא יתפצלו.

---

## מה מפריד בין הסביבות — שתי שורות, וזה הכל

**בדפדפן** — `firebase-db.js`:

```js
const LG_PROD_HOSTS = ['luzglass.vercel.app'];
```

רק מארח ברשימה הזו מקבל את פרויקט הייצור. **כל השאר** — localhost, קובץ
מקומי, תצוגות מקדימות של Vercel, ודומיין שלא הכרנו — מקבלים את הבדיקות.

⚠️ הכיוון אינו סימטרי, וזה מה שקובע את ברירת המחדל: ייצור שמצביע בטעות על
בדיקות מראה מסך ריק — רועש, מיידי, הפיך. בדיקות שמצביעות על ייצור כותבות
הזמנות בדיקה לנתונים אמיתיים, בשקט. **דומיין ייצור חדש = שורה כאן**, ובלעדיה
הוא יעבוד מול בסיס הבדיקות ויצעק.

**בשרת** — `api/_env.js`:

```js
external = (serviceAccount.project_id === 'lussglass') && LG_ENV !== 'test'
```

נגזר ממפתח השירות, שכבר שונה בין הסביבות בהכרח — אי אפשר לשכוח להגדיר אותו.
`LG_ENV` יכול רק **להחמיר**: `LG_ENV=test` חוסם גם בייצור (חזרה יבשה), ואין
ערך שמתיר משהו שאסור בלעדיו.

`lgDatabaseUrl()` באותו קובץ גוזרת גם את כתובת ה-Database מאותו מפתח.

---

## מה חוסם פנייה חיצונית ב-TEST

שלוש חומות בלתי תלויות:

1. **`api/_env.js`** — שישה endpoints נבדקים לפני ה-`fetch`. כתיבה (הזמנה,
   חשבונית, WhatsApp) מדמה הצלחה וממשיכה לרשום ל-Firebase, כדי שאפשר לבדוק
   את כל הזרימה. קריאה (מק"טים, כרטיסים, PDF) מחזירה `503` מפורש ולא נתונים
   מזויפים.
2. **מפתח שירות נפרד** — `luz-glass-test` אינו יכול לכתוב ל-`lussglass`.
   Firebase דוחה בצד השרת.
3. **אין סודות** — `WIZGROUND_SECRET` ו-`WA_ACCESS_TOKEN` לא מוגדרים ב-TEST.
   גם אם מישהו יעקוף את (1), החתימה תיכשל ואין טוקן לשלוח איתו.

---

## מה יש ב-TEST

הועתק מהייצור: `skuCatalog` (200) · `prices` · `shapeLibrary/factory` ·
`users` (5 + אדמין בדיקות).

**לא הועתק, בכוונה:** `orders` · `sketches` · `workday` ·
`hashavshevetAccounts` (999 כרטיסי לקוח עם שם וטלפון — מידע אישי אמיתי).

**סיסמאות TEST שונות מהייצור.** ה-hash-ים לא שוכפלו: אין סיבה שפרטי הכניסה
של ארבעה לקוחות אמיתיים יהיו קיימים בסביבה שנייה ופחות מוגנת.

---

## קבצים מחוץ למאגר

| מה | איפה |
|---|---|
| מפתח שירות TEST | `C:\Users\USER\luzglass-test-key.json` |
| סיסמאות TEST | `C:\Users\USER\luzglass-test-users.txt` |
| מפתח שירות ייצור | `scripts/serviceAccountKey.json` (ב-`.gitignore`) |

---

## סקריפטים

```bash
LG_TEST_DB=https://luz-glass-test-default-rtdb.europe-west1.firebasedatabase.app \
  node scripts/deploy-rules-test.js --check   # חוקים ל-TEST
node scripts/deploy-rules.js --check          # חוקים לייצור
node scripts/clone-prod-to-test.js            # רענון נתוני בסיס
node scripts/test-env-isolation.js            # החסימות עדיין עומדות?
```

כולם מסרבים לרוץ אם היעד הוא הייצור, ונבדקו מול מפתח הייצור.
