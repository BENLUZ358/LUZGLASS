# כתיבת סרטון הדרכה: המדריך

הצינור: `videos/NN-*.js` ← `lib/recorder.js` (מקליט את הדפים האמיתיים על Firebase מדומה) ← `lib/compose.js` (מצלמה, הדגשות, כתוביות, ו־MP4).

**הדוגמה המלאה היא `videos/06-invoices.js`.** כתבו לפי אותו סגנון.

## הרצה

```bash
node tools/training-video/render.js NN --record     # הקלטה בלבד, להרצה תוך כדי כתיבה
node tools/training-video/render.js NN              # הקלטה + סרטון + גרסה לוואטסאפ + דפי QA
node tools/training-video/render.js NN --compose    # הרכבת הסרטון בלבד, על ההקלטה הקיימת
```

- צריך שרת סטטי על פורט 8899, משורש הריפו (`.claude/launch.json` → `static-site`).
- קבצי העבודה נשמרים מחוץ ל־OneDrive, ב־`%LOCALAPPDATA%\lg-training-video\out\NN\` (stills/, beats.json, record-log.json).
- הסרטונים המוכנים נשמרים ב־`docs/training-videos/output/`.

## מבנה קובץ סרטון

```js
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, itemsHash, SKUS } from '../lib/seedlib.js';
export const meta = { id: 'NN', file: 'NN - שם בעברית', title: '…', viewport: { w: 1600, h: 900 } };
export function seed() { return { __clock: CLOCK, __session: '0500000000', __api: { /* path → answer */ }, db: { users: users(), orders, sketches, skuCatalog: SKUS, … } }; }
export async function script(r) { … }
```

- **`seed().db`** הוא העץ של Firebase כולו (`orders`, `users`, `sketches`, `skuCatalog`, `workday`, `meta`…). המבנה חייב להיות כמו שהדפים קוראים אותו. קראו את הקוד של הדף.
- **`__api`**: תשובות ל־`/api/<path>`. ברירת המחדל: `{ ok:true, queued:true, processed:0, remaining:0, results:[] }`.
- **`__session`**: המשתמש המחובר (`users/<phone>`). **כל הדפים במפעל דורשים `role:'admin'`.**
- **הזמנות:** מזהה בצורה `ord_9101`. יום העבודה מזהה לקוח הובלות לפי השדה `phone` של ההזמנה, ולכן תמיד שמים גם `phone` וגם `clientPhone` (`order()` עושה את זה).
- **סקיצות:** תמונה נשמרת ב־`db.sketches[id]`, ובהזמנה `hasSketch:true`.

## הפעולות (`r`)

| קריאה | מה היא עושה |
|---|---|
| `r.card({kind:'title', title, sub, bullets})` | כרטיס פתיחה על מסך מלא |
| `r.card({title, sub, bullets, table:[[k,v]], box:{kind:'warn'\|'info'\|'ok', text}, flow:[{t,hot}], panel:true})` | כרטיס הסבר. עם `panel:true` הוא מוצג כחלון מעל |
| `r.chapter('שם')` | כרטיס פרק, ותגית פרק בפינה עד הפרק הבא |
| `r.progress({stations:[…], cur, done:[…], skip:[…]})` | פס תחנות בראש המסך (רק לסרטון 00). נשאר עד הקריאה הבאה |
| `await r.open('workday.html', {wait:'selector'})` | טוען דף. **המצב (ה־DB) עובר מדף לדף** |
| `await r.show({focus, mark, text, who, chip, hold, wide})` | זום על `focus`, מסגרת זהב סביב `mark`, והטקסט מוצג למשך זמן הקריאה |
| `await r.click({target, focus, text, after, afterMark, afterFocus, who, chip, afterChip, hold, afterHold})` | זום, הדגשה והסבר, ואז הסמן זז ולוחץ **באמת**. אחר כך מוצגת התוצאה עם `after` |
| `await r.type({target, value, focus, text})` | הקלדה תו אחרי תו (Ctrl+A ו־Backspace קודם) |
| `await r.exec(fn, ...args)` | קוד בתוך הדף, שלא מוצג בסרטון. למשל שינוי ש"מישהו אחר" עשה |
| `await r.showPrinted({text})` | צילום של מה שנשלח לחלון הדפסה (`window.open`) |

**מטרות** (`target`, `focus`, `mark`) יכולות להיות:
- מחרוזת CSS;
- `{sel, text}`: האלמנט הגלוי הראשון שהטקסט שלו כולל את `text`;
- `{sel, nth}`: האלמנט הגלוי במקום ה־n, מאפס;
- מערך של כל אלה. `focus` מקבל את האיחוד של כולם.

אלמנט שלא נמצא תוך 6 שניות **מפיל את ההקלטה**, בכוונה.

- **`who`**: `'you'` מציג תגית "👤 הפעולה שלך", ו־`'system'` מציג "⚙ המערכת עושה את זה לבד".
- **`chip`/`afterChip`**: תגית חופשית, `{kind:'you'|'system'|'warn'|'ok', t:'…'}`.
- **`confirm()`/`alert()`** של הדפדפן נרשמים, ועונים עליהם "אישור" אוטומטית. בסרטון יופיע חלון שנראה כמו חלון של הדפדפן, עם הטקסט האמיתי, והסמן ילחץ "אישור". אין צורך לעשות שום דבר מיוחד.
- **הודעה קופצת (toast)** נתפסת בצילום שאחרי הלחיצה, אחרי 650ms. כדי שהכתובית לא תכסה אותה, מוסיפים את ה־selector שלה ל־`afterMark` (למשל `.toast` או `#toast`). הכתובית תעבור למעלה לבד.

## כללי כתיבה (בן, 12/10)

1. **בלי קריינות.** הטקסט על המסך הוא ההסבר, ולכן הוא חייב לעמוד לבד: מה עושים, למה, ומה קרה להזמנה.
2. **כתובית אחת: עד כ־28 מילים.** יותר מזה מפצלים לשני `show`. מדגישים מילת מפתח עם `**כוכביות**`.
3. **ניסוח ניטרלי:** "לוחצים", "בודקים", "מקלידים". לא "תלחץ".
4. **ההבדל בין המערכת לעובד חייב להיות ברור:** `who` או תגית בכל צעד שבו המערכת עושה משהו לבד.
5. **מה שכתוב על כפתור מצוטט בדיוק כמו בקוד**, בין מרכאות.
6. **לא ממציאים.** כל מסך, כפתור והתנהגות חייבים להתאים לקוד ב־`test`. אם התסריט ב־`docs/training-videos/scripts/` סותר את הקוד, **הקוד קובע**. רשמו את הסתירה בדוח.
7. **מבנה:** כרטיס פתיחה (title), ואז `chapter('סיור במסך')`, `chapter(…הדגמה…)`, `chapter('כשמשהו לא רגיל')`, `chapter('סיכום')` עם כרטיס סיכום ו־`flow` של לאן ההזמנה ממשיכה.
8. **בטיחות:** אסור לנווט בלחיצה לדף אחר. קישורים כמו תפריט הצד או "עבור לתחנה" טוענים את הדף **מחוץ** ל־harness. מעבר בין דפים נעשה רק עם `r.open`. כל בקשה שיוצאת מ־localhost נחסמת, וההקלטה נכשלת.
9. **אין `sleep` ידני**, אלא אם הדף באמת מחכה למשהו. ההשהיות לקריאה מחושבות ב־compose.

## בדיקה לפני שמסיימים

אחרי `--record`:
- **פתחו (Read) 8–12 צילומים** מתוך `stills/`, מכל פרק, וודאו שהמסך נכון: הנתונים הנכונים, אין שגיאה, אין מסך ריק.
- `record-log.json`: `pageErrors` צריך להיות ריק. 404 על favicon אפשר להתעלם.
- **אל תשנו את `lib/`, `harness/`, `render.js` או קבצי המוצר.** אם צריך שינוי, תארו אותו בדוח.
