# קורא סקיצות באישור מנהל
תאריך: 2026-10-22

## מטרה והחלטות מאושרות בשיחה
פענוח ידני בכפתור מתוך תור הסקיצות. המודל רואה רק את תמונת הסקיצה, לא פריטים קיימים ולא דפי חשבשבת. מחלץ סוג זכוכית, מק"ט מוצע מתוך הקטלוג, מידות מעטפת לחיוב וכמות. המנהל מתקן ומאשר; אין שליחה אוטומטית לחשבשבת או הודעה ללקוח.

## מסלול
קרא סקיצה -> טיוטה נפרדת עם ספקות -> תיקון מידות במ"מ, מק"ט וכמות -> אישור והחלפת פריטים בהזמנה -> המשך המסלול הקיים. החלפה של פריטים קיימים מוצגת במפורש לפני אישור. כפתור הסרה לשורה שגויה. ביטול סוגר בלי שינוי פריטים; הטיוטה נשמרת בשרת.

## כללי קריאה
מעטפת מרבית לכל ציר; אין הפחתת חורים ומגרעות. מפרידים מידות זכוכית ממידות עיבוד. מספר מוגבה עשוי להיות שבר עשרוני ולא כמות. ממירים יחידות למ"מ, אך יחידה לא ברורה נשארת חסרה. סוג/מידה/כמות לא ברורים נשארים null ומסומנים. מחיקות, מידע סותר או חוסר בגודל כולל דורשים אישור. אין ברירת מחדל של מראה 5, זכוכית 8 או כמות 1 כשזה לא ברור.

## ארכיטקטורה — בחירת מימוש
HTML/JS הקיימים ו-Node ללא חבילות נוספות. OpenAI Responses עם input_image ו-JSON schema קשיח, לפי התיעוד הרשמי; המודל מוגדר במשתנה סביבה ולא מקובע לפי זיכרון. OPENAI_API_KEY נשמר בשרת בלבד, SKETCH_READER_ENABLED=true נדרש במפורש. בתצוגה הספק אינו פרט מוצר.
שירות אדמין בלבד, תמונה נטענת מההזמנה בשרת; אין כתובות URL שרירותיות או תוכן פריטים מהדפדפן. בגרסה ראשונה תומכים בתמונת JPEG/PNG/WebP אחת להזמנה. איחוד כמה סקיצות להזמנה נדחה; לא ממזגים לפי סמיכות הודעות.
טיוטות וריצות ב-sketchReader/{orderId}, חסום ללקוחות בחוקי ברירת המחדל, גישה דרך API בלבד. שומרים snapshot מקור, hash, פענוח ראשוני, גרסת prompt/model, usage, זמן ומנהל. אישור נשמר יחד עם הפריטים בטרנזקציה על ההזמנה, עם snapshot של הנתונים שאושרו. שינוי בהזמנה/סקיצה מאז הקריאה מחייב קריאה מחדש. הזמנה שנשלחה או התקדמה מעבר לתור אינה ניתנת להחלפה.

## עלות ושגיאות
כפתור ידני בלבד; החזרת טיוטה קיימת לאותה תמונה במקום חיוב חוזר, קריאה מחדש דורשת כפתור מפורש. נעילה נגד מקביליות ותקציב מספר קריאות יומי בשרת (ברירת מחדל 30). אין retry אוטומטי מול הספק. timeout מוצג בלי שינוי הזמנה; תוצאה חלקית או לא תקינה נדחית.
לא מבצעים קריאה אמיתית במסגרת פיתוח. הפעלה דורשת מפתח שרת ומודל תומך תמונות ופלט מובנה, ללא הדבקת סודות בצ'אט.

## תיקונים ולמידה
שומרים מקור, פענוח ראשוני, שורות מתוקנות וזהות מאשר. זהו מאגר דוגמאות לבדיקת שיפורים, לא אימון אוטומטי ולא הפצת כלל מתיקון יחיד. שינוי כללים ייעשה בנפרד בגרסה מתועדת אחרי בדיקה על דוגמאות מוחזקות בצד. התמונות שכבר נראו בצ'אט אינן מבחן עיוור.

## תנאי קבלה
קריאה/ביטול אינם משנים items/stage או שולחים דבר; אישור חסר מק"ט/מידה/כמות חסום; אין אישור כפול או דריסת עריכות מקבילות; קיימת דרך חזרה לטיוטה; מיפוי המק"ט משתמש בקטלוג העדכני ומונע ניחוש מסלול ייצור; עברית ו-RTL, שדות בעלי תוויות ומטרות מגע 44px.

## תוצאת הבנייה המקומית — 2026-10-22
- נבנו מודול כללים ואימות, שירות אדמין, מסך טיוטה בעברית, כפתור בתור ושמירת מקור/פענוח/אישור/תיקונים.
- נשמרת היסטוריית אישורים בהזמנה; ריצות ומקור תמונה בצומת שרת נפרד.
- מודל מקבל תמונה וקטלוג בלבד, ללא שורות הזמנה קיימות.
- הגנות שנבדקו: הרשאות, שירות כבוי, לחיצה כפולה, נעילה מקבילה, מכסה יומית, שגיאת ספק, פלט חלקי/סירוב, שינוי תמונה/פריטים/קטלוג, אישור מפורש, והקלדה ללא שמירה להזמנה.
- הורצו 123 קובצי scripts/test-*.js: אפס כישלונות. 5 מהם בדיקות חדשות לקורא.
- לא בוצעו קריאות אמיתיות לספק; אין עדיין מדידת דיוק/עלות/זמן על סקיצות אמיתיות.
- לא נמצאו דפדפנים מחוברים בכלי הבדיקה; לא בוצעה בדיקה חזותית או בדיקת מכשיר אמיתי.
- לא נפרס לטסט/לייצור ולא נפתחו מסמכים בחשבשבת.
- החלטת מימוש: מקור התמונה הוא sketches/{orderId} הקנוני בלבד, כמו מצב new ב-lgLoadSketch. תמונה ישנה שקיימת רק inline תדרוש העברה למקור הקנוני. לא עוקפים את שכבת הסקיצות.
- החלטת מימוש: התיקונים המקומיים נשמרים רק באישור; ביציאה עם תיקונים לא מאושרים יש אזהרת אובדן. הפענוח המקורי נשמר וניתן לפתיחה מחדש.
- ממשק בפועל: lgSketchReader.open({orderId,title,image,onApproved}) ו-lgSketchReader.close(); אין ממשק refresh נפרד.

## הפעלה עתידית בטסט
להגדיר בסודות השרת בלבד OPENAI_API_KEY, SKETCH_READER_MODEL (מודל תומך תמונות ופלט מובנה) ו-SKETCH_READER_ENABLED=true.
SKETCH_READER_DAILY_LIMIT ברירת מחדל 30 קריאות לכל הסביבה ביממה לפי שעון ישראל; זו מכסת קריאות ולא תקרת חיוב כספית. מומלץ להתחיל ב-5.
FIREBASE_SERVICE_ACCOUNT ו-FIREBASE_DATABASE_URL של סביבת הטסט, בלי העתקת פרטי ייצור.
לא שולחים סודות בצ'אט. הפעלה וחיוב עבור קריאה נפרדים ממנוי WhatsApp.
ניסיון קבלה: סקיצה אחת, השוואה ידנית, תיקון ואישור, וידוא items במערכת; לאחר מכן עוד סקיצות עם סוגים/כמויות/כתב לא ברור. הזמנות חשבשבת אינן קלט למודל.

## הכנה לניסוי בטסט — 2026-10-22
הגרסה שולבה על origin/test בעותק עבודה נפרד. תוקנו תחרות על cache לאחר נעילה ושמירת ריצה+latest בכתיבה אטומית. cache תלוי גם בקטלוג, במודל ובגרסת ההנחיה. נשמר זמן ריצה והערכת עלות לפי צריכת GPT-5.4 ותעריף Standard שנבדק בתיעוד ב-2026-10-22: קלט 2.50, קלט cached 0.25 ופלט 15 דולר למיליון; לא עלות חשבונית, ללא מסים. מודל לא מזוהה/צריכה חסרה או קלט מעל 272K: לא מוצגת הערכת מחיר.
נוספה יציאה מהמתנה של בקשת דפדפן אחרי 65 שניות, בלי retry אוטומטי.
סקירת קוד: נשאר חלון מרוץ צר בין קריאת קטלוג בתחילת אישור לבין טרנזקציית ההזמנה. הפריטים משתמשים בצילום הקטלוג שאומת בתחילת האישור, בדומה להזנה הידנית; פיילוט הטסט אינו הוכחה לנעילה אטומית של הקטלוג. אין לשנות קטלוג בזמן ניסוי אישור.
135 קובצי בדיקות עברו על גרסת הטסט המשולבת; לאחר שינוי timeout הורצו שוב בדיקות המסך שהשתנה.
ההכנה הזו אינה כוללת קריאה אמיתית לספק או אישור הזמנה אמיתית.
## תיקון מסלול הלחיצה הראשונה — 2026-10-23
אבחון ברישומי TEST ובמסד TEST בלבד: L9034 נפתח פעמיים עם GET אך לא התחילה קריאה. כפתור התור קרא ל-open בלבד, והחלון דרש כפתור קריאה שני. L9032 הוכיח שפענוח ושמירה עובדים (6 חלקים). L9027 החזיר אפס חלקים משום שההנחיה הרחבה מדי דחתה טופס לקוח מודפס עם שרטוטים.
תיקון: sqReadSketch מעביר readOnOpen:true; אחרי טעינת טיוטה, רק אם אין טיוטה והשירות מופעל מתחילה קריאה אחת. פתיחה לבדיקת טיוטה קיימת נשארת ללא קריאה נוספת. גרסת הנחיה v2 מבחינה בין טופס לקוח ממותג עם שרטוטים (תקף) לבין טבלת חשבשבת ללא שרטוטים (לא קלט). תשובת טיוטה משחזרת rows/warnings ריקים ש-Firebase משמיט, ומציגה מצב אפס פריטים במפורש.
בדיקות: תרחיש אחד-לחיצה נכשל לפני התיקון ועבר אחריו, כולל קריאה לפונקציה האמיתית מתוך admin.html. 136 קובצי בדיקות עברו; אחרי חיבור הדגל במסך הורצו שוב בדיקת המסלול ובדיקת משתנים חסרים. בדיקת WebKit 26.4 במסך מגע 393x852 עם ספק מדומה הציגה פריט ושדות עריכה בקריאה אחת, ללא שגיאות דפדפן. לא בוצעה קריאה חדשה בתשלום במסגרת הבדיקה. עדיין נדרש ניסיון אמיתי של L9034 לאימות הפענוח של המודל, ולא רק המסלול והנחיית הטופס.
## התאוששות מתוצאה ריקה בגרסה קודמת — 2026-10-23
הקריאה שנבדקה בלוג ובמסד TEST הייתה עדיין v1 ושמרה אפס שורות בגלל דחיית טופס מודפס. נוספה needsReread לטיוטה רק אם גרסת ההנחיה ישנה וגם אין שורות. לחיצה מפורשת על כפתור התור קוראת תוצאה כזו מחדש בהנחיה המעודכנת; טיוטה עם פריטים וטויוטה ריקה מהגרסה הנוכחית אינן מפעילות קריאה אוטומטית חוזרת. בדיקות API ומסלול הלחיצה נכשלו לפני השינוי ועברו אחריו; בדיקות race, התנהגות UI ושילוב עברו. לא בוצעה קריאה בתשלום במסגרת בדיקות התיקון.## Approved correction examples — 2026-10-23
User authorized correction-based improvement. This section supersedes the earlier no-example runtime design: prompt v3 may receive one prior approved sketch image with sanitized original/corrected structured fields, followed by an explicitly labeled current target image. This is retrieval of approved examples, not model training or automatic rule promotion. Only the target supplies output dimensions/SKUs; uncertainty remains required.

Consent is captured atomically in the approval with learningScope resolved against server-registered customer identity. Display names and customerId-only orders are insufficient. Index sketchReaderLearning/<scope>/<timestamp_digest> is server-only under existing root deny rules; query limited to last20 pointers. Each candidate revalidates live archived consent, current verified customer assignment, original source image hash, corrected row digest and full immutable run catalog hash. Target order and identical target image are excluded, max12 rows and one example. No cross-customer sharing. Historical approvals without captured verified scope stay excluded.

Approval index publication is recoverable and nonfatal to item approval. Identical approval retry repairs index. Admin learning toggle revokes/restores consent with assignment checks; retrieval treats the order approval archive as authoritative even if index is stale. Selected examples are revalidated immediately before provider dispatch; a change aborts without calling provider. Revocation cannot withdraw a request already submitted to provider. Used example identities/digests and learningHash are retained with each run and participate in cache validity. Cache retrieval/opening remains free; no automatic reread solely because a new example exists.

UI: optional checked consent on eligible unapproved draft, no paid call when approving/toggling; already approved draft permits removal. Ineligible orders show a customer-assignment note. Reading shows whether an example was used. Extra image input may increase cost and measured provider usage includes it. No automatic order approval, accounting or messaging actions.

Validation: 140 scripts passed, including new helper/API/WebKit consent/undo tests, same-name and forged-id exclusion, changed product definition exclusion, mid-flight revocation before dispatch, index outage/retry, and provider multi-image contract. Read-only peer review found no remaining TEST pilot blocker. No paid model calls performed and no claim of measured accuracy improvement. Enable SKETCH_READER_LEARNING_ENABLED=true only on Test; production unchanged.
## Customer-specific glass recognition — 2026-10-23
The user requested explicit per-uploading-customer profiles and glass type improvement. Existing verified identity (registered client, account/phone or linked WhatsApp group) remains the isolation boundary; typed names and printed letterheads do not establish identity.

Prompt v4 adds a bounded client glossary. Each row can optionally include admin-entered glassNotation, the actual wording seen on that sketch. Explicit approval with learning consent stores the note alongside corrected SKU and catalogHash. The profile derives up to12 mappings from20 recent consented approvals; each mapping includes exact current catalog glass, mm, proc and flags. Repeated SKU use without an approved notation never becomes a default. Ambiguous notation with different SKUs is a conflict, not a winning hint. Changing catalog definitions, revoking consent or changing verified client assignment invalidates the source. Same target order/image excluded from inference. Profile display can list the current approved sample, while inference cannot reuse it as a target example.

Text glossary adds no reference image beyond the existing one-image-example maximum. It is labeled as data, requires matching visible target notation/attributes, preserves null on uncertainty, and is included in learningHash and pre-dispatch revalidation. Runs retain source references and hint/conflict counts for audit. No automatic override of suggested SKU and no approval bypass. Profile GET loads no example images; example selection avoids fetching unchanged runs.

Tests: 141 scripts passed, including API customer isolation, glass-only consent with zero reference images, revocation race without provider dispatch, conflicting notation and no-frequency-default helpers, provider contract and WebKit string persistence/approval opt-out. Peer review: no TEST pilot blocker. No paid reads during development and no measured unseen-image accuracy claim. Deployment remains TEST only.
