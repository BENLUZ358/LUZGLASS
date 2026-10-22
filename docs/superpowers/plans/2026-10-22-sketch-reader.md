# Sketch Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** פענוח סקיצות בתור עם טיוטה, תיקון ואישור מנהל בלבד.
**Architecture:** מודול טהור לחוזי נתונים; API אדמין לריצה ושמירה; רכיב JS/CSS נפרד שמתחבר לעורך הקיים.
**Tech Stack:** Node CommonJS, Firebase RTDB Admin, HTML/CSS/JS, OpenAI Responses REST.
**Spec:** ../specs/2026-10-22-sketch-reader-design.md

## Global Constraints
אין קריאה בתשלום בזמן פיתוח. אין פריסה. אין שינוי פריטים לפני אישור. אין אימון/שינוי כללים אוטומטי. אין חשבשבת כקלט. תמונה אחת להזמנה בשלב ראשון.

## Review Focus
- יחידה/כמות/סוג לא ברורים נשארים חסרים ואינם מומצאים.
- תמונה או פריטים השתנו בזמן הפענוח: האישור נחסם.
- רענון/לחיצה כפולה: טיוטה חוזרת, חיוב וכתיבה לא משוכפלים.
- ביטול ושגיאת ספק: items ו-stage נשארים ללא שינוי.
- שורות רבות במסך צר ומקלדת: שדות מסומנים, גלילה וכפתורי 44px.

### Task 1: contracts and rules
Files: api/_sketch-reader.js; scripts/test-sketch-reader.js.
Interfaces: normalizeReading(raw,catalog); approvedItems(rows,catalog); orderFingerprint(order); canRead(order); sourceImage(order,stored).
- [x] Write and run failing tests: unknowns, maximum dimensions, quantity groups, invalid SKU/quantity/dimension, safe source image.
- [x] Implement pure contracts, strict schema and prompt.
- [x] Run tests and syntax checks.

### Task 2: authenticated server workflow
Files: api/sketch-reader.js; scripts/test-sketch-reader-api.js; vercel.json.
Interfaces: POST {action:read|approve,orderId,runId?,rows?,acknowledged?,force?}; GET ?orderId retrieves latest draft without provider calls.
- [x] Write failing tests using injected auth/db/provider for disabled access, stale approvals, concurrency and no preapproval writes.
- [x] Implement server source loading, daily cap, lock, immutable run records, provider schema/refusal/incomplete checks and atomic approval.
- [x] Verify tests without live services.

### Task 3: review UI and integration
Files: sketch-reader-ui.js; sketch-reader.css; admin.html; scripts/test-sketch-reader-ui.js.
Interfaces: lgSketchReader.open({orderId,onApproved}); lgSketchReader.close().
- [x] Write UI integration checks for read-only drafts, labeled inputs, no automatic save on input, explicit confirmation.
- [x] Add manual read button and independent review panel; reuse _lgAuthPost and current SKU catalog, refresh items after successful approval.
- [x] Test browser if available, parse all modified JS and run related regression tests.

### Handoff
- [x] Self-review design coverage, document checks and limitations.
- [x] Report exactly what was built, what is untested, and environment values needed before live trials.

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
