# קליטת סקיצות מ-WhatsApp לתור הסקיצות הקיים — אפיון

**תאריך:** 2026-10-04
**סטטוס:** מאושר עקרונית ע"י בן, 2026-10-04. שלב 0 טרם בוצע. שום קוד לא שונה.
**עיקרון מנחה:** ערוץ קליטה **חדש** לתור **הקיים**. לא מערכת הזמנות מקבילה, לא
workflow חדש, לא שכתוב של לוגיקה שעובדת.

---

## 0 · החלטות בן (2026-10-04) — לא לפתוח מחדש

| # | נושא | החלטה |
|---|---|---|
| D1 | איכות תמונה | **לא** נקבעת לפי הפורטל (1000px / 0.6). נקבעת ב-spike של שלב 0 על סקיצות אמיתיות: מידות וכתב קטן חייבים להישאר קריאים, בלי לנפח את RTDB חריג. **עדכון 2026-10-04:** אין הנחה מראש שצריך resize/recompression. האפשרות הראשונה היא לשמור את הקובץ **בדיוק** כפי ש-GREEN API מספקת. אם הוא קריא וקטן מספיק — לא נוגעים בו. ה-spike קובע קודם *האם* לגעת בתמונה, ורק אחר כך *כמה*. |
| D2 | הופעה בפורטל | **כן.** סקיצה שהלקוח שלה זוהה מופיעה בפורטל שלו כמו כל סקיצה שהתקבלה. |
| D3 | "טופל וטרם נשלח עדכון" | **רק `source:'whatsapp'`** בשלב הראשון. התנהגות סקיצות הפורטל לא משתנה. איחוד — אולי בעתיד, בהחלטה נפרדת. |
| D4 | PDF | **כל עמוד = סקיצה, תמיד. אין partial success.** קובץ שחורג מהמגבלה הטכנית או שאי אפשר לעבד — **כל הקובץ נכשל בבירור**, נשאר לטיפול/retry, ואף עמוד לא נוצר. המגבלה נקבעת ב-spike. |
| D5 | ספק בייצור | `WA_PROVIDER=green`. |
| D6 | עיבוד | ה-webhook רק מאמת, רושם create-once ומחזיר 200. הורדה/רינדור/כתיבה — **בנפרד**, לא תלויים בחלון הבקשה של GREEN API. |
| D7 | באג `lgWaPending` | באג קיים, **לא חלק מהפיצ'ר**. מטופל ראשון כשלב 0A נפרד: reproduction → תיקון מינימלי → regression → TEST → אישור → ייצור. לא מתערבב עם inbound. |
| D8 | PDF renderer | spike מבודד **לפני** התחייבות ל-`pdfjs-dist` + `@napi-rs/canvas`. |

---

## 1 · Current flow — איך זה עובד היום (audit, main @ d73c444)

### 1.1 סקיצה = הזמנה
אין ישות "סקיצה" נפרדת. כל קובץ שלקוח מעלה הוא רשומה ב-`orders/<id>`.

**העלאה מהפורטל** (`upload.html`):
- זהות: `lgVerifiedSession()` (`firebase-db.js:708`) — Auth uid + טלפון.
- אצווה: `lgUploadBatch()` → `{batchId, refNum}` ב-sessionStorage; `refNum` מ-`lgNextOrderNum()` (טרנזקציה על `meta/orderCounter`, `firebase-db.js:1732`). מספר לכל קובץ: `L####-1..n`.
- תמונה: `compressImage(data, 1000, 0.6)` בדפדפן.
- **PDF: נשמר כ-data URL גולמי ומוצג שבור** (`upload.html:~416`) — באג פרודקשן קיים, מחוץ להיקף כאן (ראו §12).
- id דטרמיניסטי `sub_<batchId>_<i>`; timeouts 20/30/15 שניות; אימות בקריאה חוזרת של `orders/<id>/id`.
- `saveSubmission` (`firebase-db.js:506`) כותב: `stage:''`, `status:'ממתין לאישור'`, `source:'upload'`, `phone`+`clientPhone` (מנורמל), `customerId`+`businessName` (מ-`users/<phone>`), `paymentStatus:'unpaid'`, `hasSketch`, `sketchName:''`, `files:{f0:{name,type}}`, `createdAt/updatedAt`.
- התמונה: base64 ב-RTDB, פעמיים — `orders/<id>/sketch` (ישן) ו-`sketches/<id>` (`lgSaveSketch`, שלב 1 מתוך 4 של הוצאת התמונות מההזמנה). אין Firebase Storage בשימוש.

### 1.2 התור
- `buildSQItems()` (`admin.html:2883`) — כל הזמנה עם `stage` ריק.
- **"לא נראה" / "נראה"** — שדה אחד: `sketchSeenAt` (`sqSeenSplit`, `admin.html:2676`). טאבים `sqTabUnseen` / `sqTabSeen`.
- **"✓ סקיצה טופלה"** = `sqMarkSeen()` (`admin.html:2701`) → `updateOrder(id,{sketchSeenAt})` בלבד. בלי stage, status, מחיר או הודעה.
- פתיחת הזמנה מטאב "נראה": "הועבר לחשבשבת" → `updateStage(id,'chash')` + `/api/hashavshevet-order`. ההזמנה יוצאת מהתור.
- שם: `sketchName`, ניתן לעריכה (`#sqNameInput` → `sqSaveName`, `admin.html:3119`). השרת כבר מצרף `sketchNames` להודעות WhatsApp (`orderSketchName`, `api/_wa-recipient.js`).
- **פילטר לקוח קיים**: `#sqFClient`, בלי ספירות, מסנן לפי מחרוזת `orderClient`. `lgFillFilterSelect` (`firebase-db.js:259`) כבר תומך `{label,count}`.
- הלבנה: כל שדה הזמנה חדש חייב להיכנס ל-`lgNormalizeOrder` (`firebase-db.js:719`), נאכף ע"י `scripts/test-order-normalizer.js`.

### 1.3 WhatsApp יוצא
- `whatsapp-dispatch` (admin בלבד, dryRun כברירת מחדל) → `lgWaEnqueue` → `waOutbox/<sha1(kind|ids)>` בטרנזקציה; לא מכניס מחדש `pending`/`sent`.
- `whatsapp-drain` (מופעל מהדפדפן בלבד, `lgWaDrain`, `firebase-db.js:2005`) → `lgWaReserveSlot` → `lgWaClaim` (TTL 2 דק', 3 ניסיונות, תפוגה 24h) → `resolvePhone` חי → `provider.gate` → `send` → `lgWaComplete` → חתימה על ההזמנה.
- הצלחה = HTTP 2xx **וגם** `idMessage`. `sentAt` נכתב רק בהצלחה.
- חתימה: `kind==='dispatched'` → `whatsappDispatch`, **כל השאר** → `whatsapp` (`whatsapp-drain.js:156`).
- `renderText` (`api/_wa-provider.js:74`): כל kind לא מוכר נופל לטקסט "מוכן לאיסוף".
- `whatsapp-dispatch.js:72`: כל kind שאינו `ready` נכפה ל-`dispatched`.
- שער 6 מנעולים (`api/_env.js:160-203`), כולל `GREENAPI_ALLOWED_ACCOUNTS` חתום על project_id ו-accountKey חובה.

### 1.4 טלפונים וזהות
- נרמול יחיד בכל המערכת: הסרת `-` ורווחים (`_lgNormalizePhone`, `firebase-db.js:1262`; `norm`, `_wa-recipient.js:31`). אין 972→0.
- `users/<phone>` — מפתח = טלפון הכניסה שאדמין הקליד. ייחודי לטלפון ולכרטיס.
- `hashavshevetAccounts/<KEY>.phone` — מועתק כפי שהוא מהכרטיס (נייד ← טלפון ← טלפון 1/2). יכול להיות נייח, ריק, משותף לכמה כרטיסים.
- כיוון הזמנה→טלפון: `resolvePhone` (`_wa-recipient.js:46`). **כיוון שולח→לקוח לא קיים.**

### 1.5 Inbound
**לא קיים כלום.** אין webhook, אין endpoint לא-אדמיני, אין הגדרות GREEN API מתועדות.

---

## 2 · Proposed flow

```
לקוח שולח תמונה / PDF בצ'אט פרטי
  → GREEN API
  → POST /api/wa-inbound
       אימות token + idInstance · סינון סוג
       create-once: waInbound/<idMessage>  {state:'received'}
       ← 200                                  (GREEN API סיימה כאן)
       waitUntil(processInbound(id))          (טריגר 1, best-effort)
  → admin פתוח: POST /api/wa-inbound-drain    (טריגר 2, הערובה)
       claim → הורדה → תמונה: עיבוד | PDF: פירוק כל העמודים בזיכרון
       → זיהוי לקוח → כתיבה אטומית אחת של כל ההזמנות + sketches + state:'done'
  → התור הקיים, טאב "לא נראה", source:'whatsapp'
```

העובד: מסנן לפי לקוח → מתקן שם → "טופל" (כמו היום) → פותח הזמנה (כמו היום).
בנפרד: "שלח עדכון ללקוח" דרך ה-outbox הקיים.

### 2.1 Webhook — `api/wa-inbound.js`
1. `Authorization: Bearer <GREENAPI_WEBHOOK_TOKEN>`, השוואה constant-time. אחרת 401, בלי כתיבה.
2. `body.instanceData.idInstance === GREENAPI_ID_INSTANCE` של הסביבה. אחרת 403.
3. סינון: רק `typeWebhook==='incomingMessageReceived'`; `chatId` חייב `@c.us` (קבוצה `@g.us` / `@lid` → נרשם `ignored`); רק `imageMessage`, או `documentMessage` עם `mimeType` PDF / `image/*`. טקסט וכל השאר → 200 בלי רשומה.
4. בזמן rollout: `GREENAPI_INBOUND_ALLOWED` (רשימת שולחים מורשים, חתומה על project_id כמו `GREENAPI_ALLOWED_ACCOUNTS`). שולח שאינו ברשימה → 200 בלי רשומה, וממשיך לטיפול ידני כמו היום.
5. create-once בטרנזקציה על `waInbound/<idMessage>`. קיים → 200, no-op.
6. כתיבה הצליחה → **200 מיד**. כתיבה נכשלה → 500, ו-GREEN API תשלח שוב (מנסה עד 24h).
7. `waitUntil(processInbound(id))` — מתחיל עיבוד אחרי שהתשובה כבר יצאה. אם מת / timeout — הרשומה נשארת, טריגר 2 משלים.

**למה זה עומד ב-D6:** GREEN API מחכה רק לשלבים 1–6 (מילישניות). שום הורדה או רינדור לא בחלון שלה. `waitUntil` הוא אופטימיזציה של זמן ההגעה, לא ערובה — הערובה היא הרשומה + טריגר 2.

### 2.2 עיבוד — `api/_wa-inbound.js` (קוד אחד, שני טריגרים)
- **טריגר 1:** `waitUntil` מה-webhook.
- **טריגר 2:** `api/wa-inbound-drain.js` (verifyAdmin), נקרא מ-`admin.html` בטעינה, בפתיחת התור, וכל ~2 דקות כל עוד admin פתוח — אותו דפוס כמו `lgWaDrain`.
- **טריגר 3 (אופציונלי):** Vercel cron יומי (Hobby: פעם ביום) — רשת ביטחון לסימון `dead` ולהתראה. לא תנאי.
- תפיסה: טרנזקציה על הרשומה, TTL ארוך מ-maxDuration של הפונקציה (ייקבע לפי ה-spike), עד 3 ניסיונות, חלון 24h. נבנה בדפוס של `lgWaClaim` כולל הטיפול ב-`null` בקריאה הראשונה (באג L9005).
- הורדה: `fileMessageData.downloadUrl`; חסר / פג → `POST downloadFile {chatId, idMessage}`. בדיקת גודל לפני קריאה מלאה.
- `downloadUrl` נמחק מהרשומה בסיום (URL עם הרשאה).

### 2.3 תמונות
**ברירת המחדל המועמדת: passthrough.** הבייטים בדיוק כפי ש-GREEN API מספקת — בלי resize ובלי recompression. נבדקים רק דברים שאינם משנים את התמונה: שזו באמת תמונה (magic bytes), ושהגודל מתחת לתקרה.
עיבוד (`sharp`) נכנס **רק אם ה-spike מראה צורך**: למשל תמונה שנשלחה "כמסמך" או ב-HD, שעוברת את הדחיסה של WhatsApp בשלמותה, או שגודלה חורג מהתקרה. במקרה כזה — רק הקבצים שחורגים מעובדים, לא כולם.
⚠️ תמונה שנשלחה "כמסמך" שומרת EXIF, ובו לעיתים מיקום GPS. אם ה-spike יראה שכאלה מגיעות — הסרת metadata היא שינוי ב-metadata בלבד, לא בפיקסלים, וההחלטה עליה נפרדת.
החלטה סופית: ב-spike 0B-1 (D1).

### 2.4 PDF — הכל או כלום (D4)
- כל עמוד → JPEG בזיכרון. **רק אחרי שכל העמודים הצליחו** — כתיבה אטומית אחת (`update` רב-נתיבי) של כל `orders/wa_<idMessage>_<p>` + `sketches/...` + `waInbound/<id>.state='done'`.
- עמוד אחד נכשל / הקובץ פגום / מוגן בסיסמה / חורג מהמגבלה → **אפס סקיצות**, `state:'failed'` (זמני, ייעשה retry) או `state:'rejected'` (קבוע — חריגה, סיסמה, פגום), עם `reason` מפורש.
- מגבלה טכנית (עמודים, MB) — **נקבעת ב-spike 0B-2** לפי: זמן לעמוד × עמודים < maxDuration עם מרווח; זיכרון; וגודל הכתיבה האטומית ב-RTDB עם מרווח בטוח.
- הכתיבה האטומית חייבת להיכנס בגבול הכתיבה של RTDB. אם המגבלה הזו היא הצוואר — המגבלה בעמודים נגזרת ממנה, לא מתפשרים על האטומיות.

### 2.5 קליטה שנכשלה — לא הולכת לאיבוד, ולא נראית כאילו נקלטה
- `admin.html`, ראש התור: באדג' "⚠ N קליטות WhatsApp לא הושלמו" + "⏳ N בקליטה".
- פאנל: שולח (מזוהה או מספר), שם קובץ, שעה, סיבה, מספר ניסיונות.
- פעולות: **"נסה שוב"** (מאפס attempts, דרך אותו drain) · **"טופל ידנית"** (סוגר עם הערה; למקרה שהעובד ביקש מהלקוח קובץ אחר).
- **אין סקיצת placeholder בתור** — כדי שהתור יכיל רק סקיצות אמיתיות, וכשל ייראה ככשל.

### 2.6 זיהוי הלקוח — `lgClientFromWaSender(chatId)` ב-`api/_wa-recipient.js`
1. `9725XXXXXXXX@c.us` → ספרות → 972→0 → `05XXXXXXXX`.
2. `users/<phone>` מדויק → `customerId`, `businessName`, שם.
3. אחרת סריקת `hashavshevetAccounts` בהשוואת **ספרות בלבד** → **רק אם יש בדיוק התאמה אחת**.
4. אחרת → `waUnassigned:true`, `orderClient:'לא מזוהה · 05X-XXXXXXX'`, `clientPhone` = השולח.

שיוך ידני בתור: "שייך ללקוח" → בורר → כותב `orderClient, phone, clientPhone, customerId, businessName`, מוחק `waUnassigned`. עדיפות: אותו מסלול כתיבה כמו עריכת הזמנה רגילה.
שלב עתידי (לא בהיקף): `waSenderAlias/<phone>` לעובד של לקוח ששולח ממספר אחר.

**D2:** `clientPhone` = טלפון הלקוח המזוהה → מופיע בפורטל שלו אוטומטית (שאילתת `clientPhone` הקיימת). לא-מזוהה: מופיע בפורטל רק אם קיים משתמש עם המספר הזה — כלומר אצל בעל המספר בלבד.

### 2.7 שם הסקיצה
- `caption` → `sketchName`: trim, כיווץ רווחים, עד 80 תווים.
- אין caption → ריק ("ללא שם"), כמו הפורטל.
- PDF: caption, אחרת שם הקובץ בלי `.pdf`; לכל עמוד `"<שם> (עמוד p/N)"`.
- בלי OCR. עריכה — `sqSaveName` הקיים.
- ההודעה ללקוח לוקחת את השם **ברגע ה-enqueue** (`sketchNames` נקפא ברשומת ה-outbox, כמו היום).
- מגבלה ידועה: שם שנשלח כהודעת טקסט נפרדת אחרי התמונה — לא נקלט.

### 2.8 טיפול ≠ עדכון (D3)
| | שדה | שינוי |
|---|---|---|
| טיפול | `sketchSeenAt` | **אין.** "טופל" עושה בדיוק מה שעושה היום. |
| עדכון ללקוח | `sketchAck{sentAt, outboxKey, attemptedAt, httpStatus, waMessageId}` | **חדש.** נכתב רק ע"י ה-drain ורק אחרי הצלחה אמיתית. |

**ממתין לעדכון** = `source==='whatsapp'` ∧ `sketchSeenAt` ∧ ¬`sketchAck.sentAt` ∧ ¬`isTest` ∧ לא נמצא ברשומת outbox מסוג זה במצב `pending`/`sent`.
- לא תלוי ב-`stage`: סקיצה שכבר נפתחה ממנה הזמנה עדיין נכללת.
- אין צורך ב-cutoff — `source:'whatsapp'` לא קיים היום בכלל.

### 2.9 סינון לפי לקוח
- `#sqFClient` מקבל `{label,count}` לפי הטאב הנוכחי, מפתח = טלפון (`lgClientKey`) ולא שם. "לא מזוהה" מוצמד למעלה.
- אחרי "טופל" עם פילטר פעיל: טוסט "נותרו עוד N סקיצות של <לקוח> שטרם טופלו" — N = סקיצות "לא נראו" של אותו מפתח.
- בלי Session של 5/10 דקות.

### 2.10 עדכון ללקוח — מחזור ה-outbox הקיים
פאנל "עדכונים ללקוחות" בתור: `<לקוח> · 4 טופלו וטרם נשלח עדכון · [שלח עדכון ללקוח]`.
1. לחיצה → `whatsapp-dispatch` `{kind:'sketches-handled', dryRun:true}` → תצוגת הטקסט המדויק.
2. אישור → enqueue → `lgWaDrain()`.

| קובץ | שינוי |
|---|---|
| `api/whatsapp-dispatch.js:72` | whitelist ל-`sketches-handled`. לסוג הזה: מסנן הזמנות בלי `sketchSeenAt`, עם `sketchAck.sentAt`, שאינן `source:'whatsapp'`, ושמופיעות ברשומת outbox פעילה/שנשלחה מאותו סוג. |
| `api/whatsapp-drain.js:156` | מפת kind→שדה במקום הטרנרי (אחרת סוג חדש **דורס** את `whatsapp` של "מוכן לאיסוף"). |
| `api/_wa-provider.js` `renderText` | ענף חדש: פתיחה, כמות, רשימת שמות (מספר הזמנה כשאין שם), סה"כ, חתימה. **שום מידע על סקיצות שלא טופלו.** |

**כפילות 4+2:** 4 בתור/נכשלו ועוד 2 טופלו → לחיצה נוספת שולחת רק את ה-2 (ה-4 מוחרגים כי הם ברשומה פעילה). אם הרשומה הראשונה מתה (3 ניסיונות / 24h) — ה-4 חוזרים ל"טרם עודכן" מעצמם.
"טופל" לעולם לא תלוי ב-GREEN API.

---

## 3 · קבצים
| קובץ | מה |
|---|---|
| `api/wa-inbound.js` **חדש** | webhook (§2.1) |
| `api/wa-inbound-drain.js` **חדש** | טריגר 2 (§2.2) |
| `api/_wa-inbound.js` **חדש** | תפיסה, הורדה, תמונה, PDF, זיהוי, כתיבה אטומית |
| `api/_wa-recipient.js` | `lgClientFromWaSender` + נרמול ספרות |
| `api/_env.js` | `GREENAPI_WEBHOOK_TOKEN`, `GREENAPI_INBOUND_ALLOWED` |
| `api/whatsapp-dispatch.js`, `whatsapp-drain.js`, `_wa-provider.js` | §2.10 |
| `admin.html` | ספירות בפילטר, טוסט "נותרו", שיוך, פאנל עדכונים, פאנל קליטות, טריגר drain |
| `firebase-db.js` | whitelist, `lgClientsInOrders` עם ספירות, `lgSketchAckPending` |
| `database.rules.json` | §5 |
| `vercel.json`, `package.json` | maxDuration לפונקציות החדשות; תלויות לפי תוצאות ה-spike |
| `scripts/test-*.js` | idempotency inbound, זיהוי, PDF הכל-או-כלום, kind חדש |

**לא נוגעים:** `upload.html`, `sqMarkSeen`, השלבים, `sqSendHashavshevet`, workday, התנהגות סקיצות פורטל.

## 4 · מודל נתונים
**`orders/<id>` — שדות חדשים** (+ `lgNormalizeOrder`):
`source:'whatsapp'` · `waMessageId` · `waPage` · `waPages` · `waSender` · `waReceivedAt` · `waUnassigned` · `sketchAck{…}`

**`waInbound/<idMessage>`:**
`state` (received · processing · done · failed · rejected · dead · closed) · `chatId` · `typeMessage` · `caption` · `fileName` · `mimeType` · `sizeBytes` · `timestamp` · `refNum` · `pages` · `orderIds[]` · `clientMatch{via, customerId}` · `attempts` · `claimedAt` · `lastError` · `reason` · `closedBy/closedNote`

`refNum` מוקצה **פעם אחת** ונשמר ברשומה לפני כל כתיבת עמודים; retry משתמש בו שוב.

## 5 · Security / rules / storage
- `waInbound`: admin read, `.write:false`, `.indexOn: ["createdAt","state"]`. ("נסה שוב" / "טופל ידנית" עוברים דרך endpoint אדמיני, לא כתיבה ישירה.)
- `orders` — blocklist ליצירה ע"י לקוח: `+sketchAck`, `+waUnassigned`, `+waMessageId`. נבדק ב-`test-rules-order-fields.js`.
- ה-webhook — ה-endpoint הראשון בלי התחברות אדמין: token, instance, סינון סוג, תקרת גודל, אף פעם לא לוגים של token / downloadUrl.
- אחסון: base64 ב-RTDB כמו היום. אין Firebase Storage, אין שאלת Blaze. גודל נקבע ב-spike (D1).
- הגדרות GREEN API: `incomingWebhook=yes`, `markIncomingMessagesReaded=no`, `enableLidMode` כבוי. `SetSettings` מאתחל את המופע ~5 דק'.
- תוכנית GREEN API: **Business** חובה (Developer מוגבל ל-3 צ'אטים בחודש, כולל נכנסות).

## 6 · Risks / edge cases
| מקרה | התנהגות |
|---|---|
| webhook כפול | create-once על `idMessage` |
| עיבוד מקבילי | claim עם TTL |
| PDF 8 → 16 | ids דטרמיניסטיים + כתיבה אטומית אחת |
| restart באמצע | claim פג → drain משלים; אין כתיבה חלקית כי הכתיבה אטומית |
| הורדה חלקית / timeout | `failed` → retry, `downloadFile` כגיבוי |
| PDF פגום / סיסמה / חורג | `rejected`, אפס סקיצות, מוצג בפאנל קליטות |
| GREEN API לא זמינה (נכנס) | היא שומרת 24h ושולחת שוב |
| GREEN API לא זמינה (יוצא) | נשאר "טרם עודכן"; "טופל" לא מושפע; retry בלי כפילות |
| שולח לא מזוהה / כמה כרטיסים | `waUnassigned` + שיוך ידני; לא מנחשים |
| קבוצה / הודעה מהטלפון שלנו / טקסט | מסוננים |
| אותה תמונה פעמיים בשתי הודעות | שתי סקיצות (שתי הודעות לגיטימיות). אופציונלי: סימון "ייתכן כפול" לפי hash, בלי חסימה |
| שם שונה אחרי שליחה | ההודעה כבר יצאה עם השם הקפוא — מקובל |
| admin לא פתוח שעות | `waitUntil` בדרך כלל מעבד מיד; אחרת הקליטה מחכה עד פתיחת admin, בתוך חלון 24h של `downloadUrl` / `downloadFile` |
| TEST מול ייצור | webhookUrl אחד למופע — ראו §8 |

## 7 · ממחזרים מול חדש
**ממחזרים:** התור, השלבים, `sketchSeenAt`, `sketchName` ועריכתו, `#sqFClient`, מבנה ההזמנה והשדות של `saveSubmission`, `sketches/<id>`, `meta/orderCounter`, `waOutbox` + drain + claim + שער 6 מנעולים + dryRun + `lgWaDrain`, `resolvePhone`, דפוס ה-id הדטרמיניסטי, החלטות ה-PDF מהאפיון של 2026-08-30 (עמוד = סקיצה, 2× supersample, סיסמה/פגום = שגיאה מפורשת).
**חדש באמת:** webhook, inbound drain, זיהוי שולח הפוך, עיבוד תמונה ו-PDF בשרת, פאנל קליטות, פאנל עדכונים, שיוך לקוח, kind חדש.

## 8 · סדר ביצוע
כל שלב: ענף → `test` → luzglass-test → בדיקה → אישור בן → `main`.

- **0A** — באג `lgWaPending` (D7). נפרד לגמרי. ראו §10.
- **0B** — spikes, בלי קוד מוצר ובלי merge. ראו §11. תוצאה: פרמטרי תמונה, renderer, מגבלות PDF, `waitUntil` — מעדכנים את האפיון הזה לפני שלב 1.
1. נתונים: whitelist, rules, בדיקות. בלי UI.
2. קליטת תמונות ב-TEST: webhook, `waInbound`, עיבוד, זיהוי. ה-webhookUrl של המופע מופנה ל-TEST עם `GREENAPI_INBOUND_ALLOWED` = המספר של בן בלבד. בייצור אין היום צרכן ל-inbound, כך שלא נאבד כלום; הודעות לקוחות אמיתיים מסוננות ולא נשמרות ב-TEST.
3. drain + פאנל קליטות.
4. PDF (הכל או כלום).
5. תור: ספירות, טוסט "נותרו", שיוך.
6. עדכון ללקוח: kind, dispatch, drain, טקסט, פאנל.
7. ייצור: deploy rules, env, webhookUrl לייצור, `GREENAPI_INBOUND_ALLOWED` = לקוחות הפיילוט, ואותם לקוחות ב-`GREENAPI_ALLOWED_ACCOUNTS`.

## 9 · QA לפני Production
1. תמונה + caption → סקיצה אחת, "לא נראה", לקוח ושם נכונים, מופיעה בפורטל שלו.
2. תמונה בלי caption → "ללא שם".
3. PDF 1 עמוד / 8 עמודים → 1 / 8 סקיצות, `L####-1..8`, קריאות.
4. אותו webhook ×3 → אין תוספת. הריגה באמצע PDF → retry מסיים בדיוק 8.
5. PDF פגום / סיסמה / מעל המגבלה → **אפס סקיצות**, מופיע בפאנל קליטות עם סיבה.
6. מספר לא מוכר → לא מזוהה → שיוך → מופיע אצל הלקוח ובפורטל שלו.
7. מספר על שני כרטיסים → לא מזוהה.
8. token שגוי / instance אחר → 401/403, אין כתיבה.
9. טקסט / קבוצה / הודעה מהטלפון שלנו → מסוננים.
10. פילטר לקוח → ספירות נכונות, טוסט "נותרו עוד N".
11. "טופל" כש-WhatsApp כבוי → עובד כרגיל.
12. עדכון ל-4 → הודעה אחת, 4 שמות. עוד 2 → ההודעה הבאה רק עם 2.
13. שליחה כש-GREEN חסומה → "טרם עודכן"; לחיצה חוזרת → אין כפילות.
14. סקיצה שנפתחה ממנה הזמנה לפני העדכון → נכללת.
15. סקיצת פורטל שטופלה → **לא** מופיעה בפאנל העדכונים (D3).
16. העלאה מהפורטל → בדיוק כמו קודם (רגרסיה).
17. admin סגור בזמן שליחה → הסקיצה מופיעה (דרך `waitUntil`), או מיד עם פתיחת admin.

---

## 10 · שלב 0A — באג `lgWaPending` (קיים, לא חלק מהפיצ'ר)

**הבאג:** `lgWaPending` (`api/_wa-outbox.js:218`) מבצע `orderByChild('createdAt').limitToFirst(limit)` **ורק אחר כך** מסנן `pending`/`failed`. רשומות `sent`/`expired`/`failed` שמוצו לא נמחקות אף פעם. ה-drain קורא עם `limit=60` (`whatsapp-drain.js:66,200`). מרגע שיש 60 רשומות סופיות ישנות — ה-60 הראשונות כולן סופיות, ושום הודעה חדשה לא נאספת. השליחה נעצרת בשקט.

**למה הבדיקות לא תפסו:** ה-`fakeDb` ב-`scripts/test-whatsapp-provider.js:519` מתעלם מ-`limitToFirst` (`limitToFirst: () => self`).

**תיקון מינימלי:** שאילתה לפי מצב במקום לפי זמן:
`orderByChild('state').equalTo('pending')` + `equalTo('failed')` → איחוד → סינון `attempts < MAX_ATTEMPTS` → מיון לפי `createdAt` → חיתוך ל-`limit`. אותה חתימה, אותו ערך החזרה. + `".indexOn": ["createdAt","state"]` ב-`waOutbox`.
**לא:** מחיקת רשומות ישנות — ה-guard ב-`lgWaEnqueue` נשען על קיום רשומות `sent`, ומחיקה משנה התנהגות.

## 11 · שלב 0B — spikes
בלי קוד מוצר, בלי merge. דוגמאות אמיתיות של לקוחות **לא נכנסות ל-repo** — תיקייה מקומית מחוץ לו.

### 11.1 איכות תמונה (D1) — _טרם בוצע_
**השאלה הראשונה: האם בכלל צריך לגעת בתמונה אחרי WhatsApp.** רק אם כן — כמה.

**קלט:** 5–10 סקיצות זכוכית אמיתיות **אחרי הדחיסה של WhatsApp** — נשמרו מתוך צ'אט WhatsApp שבו הן התקבלו, כולל אחת שנשלחה "כמסמך" ואחת ב-HD אם יש. אימות לפני שמתחילים: בלי EXIF, ממדים בטווח של WhatsApp (בערך 1600px, או עד 4096 ב-HD). קובץ מקור מהמצלמה **אינו** מייצג את מה ש-GREEN API תספק, ולא ישמש כ-baseline.

**וריאנטים, לפי הסדר:**
1. **passthrough** — הקובץ בדיוק כפי שהתקבל. בלי resize, בלי recompression. *הבסיס שכל השאר נמדדים מולו.*
2. 2000/0.8 · 1600/0.75 · 1400/0.7 · 1000/0.6 (הפורטל) — להשוואה בלבד.

**לכל וריאנט:** גודל קובץ · גודל base64 ב-RTDB · ממדים · חיתוך 100% של המידה / הכתב הקטן ביותר בסקיצה, צד לצד עם passthrough.
**השפעה על RTDB:** גודל ממוצע ומקסימלי לסקיצה × נפח חודשי צפוי, מול הגודל הנוכחי של `sketches/` בייצור.

**כלל ההחלטה (המלצה לבן, הוא מחליט):**
- passthrough קריא **וגם** הגודל לסקיצה מתחת לתקרה שנקבע → **לא נוגעים בתמונה.** אין `sharp`, אין תלות נייטיבית.
- passthrough קריא אבל יש קבצים מעל התקרה (מסמך / HD) → passthrough לרוב, ועיבוד **רק לחריגים**, בוריאנט הקטן ביותר שעדיין קריא.
- וריאנט מוקטן נבחר רק אם הוא קריא באותה מידה **וגם** החיסכון ב-RTDB משמעותי. "קטן יותר" לבד אינו סיבה.

#### תוצאות 11.1 (2026-10-04) — ממתין להחלטת בן
דגימות: 3 סקיצות אמיתיות שנשמרו מתוך WhatsApp. אומתו כפלט WhatsApp: 120–199KB, 900×1600 / 1152×2048, JFIF בלבד, בלי EXIF, progressive. פחות מהיעד (5–10). אין דגימה של "כמסמך" או HD.

| וריאנט | ממוצע קובץ | ממוצע ב-RTDB (base64) | קריאות |
|---|---|---|---|
| **passthrough** | 152KB | 203KB | מלאה — הבסיס |
| 2000/0.8 | 150KB | 200KB | זהה. אין חיסכון; s1 אף **גדל** (138→145KB) |
| 1600/0.75 | 102KB | 136KB | זהה בחיתוכים |
| 1400/0.7 | 72KB | 96KB | זהה בחיתוכים |
| 1000/0.6 (פורטל) | 86KB | 115KB | זהה בחיתוכים |

- כל המידות הקטנות (157⁷, 112⁷, 75⁴, 79³, 0.5) והטקסט המודפס קריאים בכל הוריאנטים.
- recompression באותם ממדים לא חוסך כלום. רק הקטנה אמיתית חוסכת, ועד ~50%.
- **הקשר בייצור (קריאה בלבד):** סקיצת פורטל היום — ממוצע 184KB ב-base64, מקסימום 475KB. **כל סקיצה נשמרת פעמיים**: `sketches/` + `orders/*/sketch` (23 עותקים, 4.2MB בתוך `orders/`). כלומר passthrough של WhatsApp ≈ סקיצת פורטל של היום. הכפילות בתוך `orders/` משפיעה יותר מכל הגדרת דחיסה — החלטה לשלב 1.
- **הסרת metadata בלי לגעת בפיקסלים — עובד.** ~60 שורות JS בלי ספרייה: משמיט APP1 (EXIF/GPS/XMP), APP3–15, COM. שומר JFIF, פרופיל צבע ICC ואת כל נתוני ה-scan. נבדק: נתוני ה-scan זהים בייט-לבייט, הפיקסלים המפוענחים זהים. Orientation נשמר (APP1 מינימלי עם התג הזה בלבד), ונבדק על קובץ סינתטי עם סיבוב 6 ו-GPS: GPS הוסר, הסיבוב נשאר. פלט WhatsApp רגיל ממילא בלי EXIF, ולכן שם זה no-op.

**המלצה:** passthrough + הסרת metadata בלבד. `sharp` — רק לקבצים מעל תקרה (ערך לקבוע), שלא נדגמו.

#### החלטות בן על 11.1 (2026-10-04) — לא לפתוח מחדש
1. **passthrough היא ברירת המחדל.** בלי resize ובלי recompression.
2. תמונה שמגיעה בלי EXIF (פלט WhatsApp רגיל) — **נשמרת בדיוק כפי שהתקבלה, בלי שום פעולה עליה.** אם מגיע EXIF — מסירים metadata לא נחוץ / רגיש (GPS ודומיו), שומרים orientation נכון, ולא משנים את נתוני התמונה.
3. **800KB — תקרת oversized זמנית (provisional), לא חוק סופי.** נקבעת סופית רק אחרי שנבדקה לפחות דוגמה אמיתית אחת של HD או image-as-document. ממומשת כ**קונפיגורציה אחת שאפשר לשנות** (קבוע יחיד / env), לא כמספר קסם שמפוזר בקוד.
4. **הכפילות `orders/*/sketch` ↔ `sketches/` — החלטה מפורשת של שלב 1.** לפני שכותבים סקיצות WhatsApp: להבין למה שני העותקים קיימים היום, ומה אפשר לשנות בלי לשבור את הפורטל / התור / המסכים הקיימים. **אין migration ואין שינוי storage עכשיו.**
5. נפח יומי צפוי — _טרם נמסר_.
6. בדיקת `waitUntil` — אושרה על Vercel preview זמני בלבד, בלי Production ובלי נתוני לקוחות.
PDF — נשאר on hold.

### 11.2 PDF renderer + מגבלה טכנית (D4, D8) — _נדחה בהחלטת בן, 2026-10-04_
בן: מתחילים בתמונות רגילות; PDF ייפתח בהמשך אם תהיה בעיה. אין כרגע PDF סקיצה לדגימה.
מה שכן נבדק מקומית, על PDF בדיקה שאינו סקיצה (עותקים נמחקו — הכיל מידע פיננסי):
- pdfjs-dist 6.4 + @napi-rs/canvas רצים ב-Node. ~0.3s לעמוד ב-1240/1654px, ~0.45s ב-2480px. RSS ~180–220MB. עברית מוטמעת רונדרה נכון.
- קובץ קטוע / זבל / ריק → חריגה (`InvalidPDFException`), אפס עמודים. מתאים להכל-או-כלום.
- **לא נבדק:** Vercel (bundle, binary נייטיבי, standard fonts — נמצא שב-Windows `standardFontDataUrl` דורש URL ולא נתיב), סרוק / וקטורי אמיתי, מגבלה טכנית.
- מקומי: 3–5 PDF אמיתיים (כולל רב-עמודי, סרוק, וקטורי). רינדור ב-pdfjs-dist + @napi-rs/canvas בכמה רזולוציות → אותה השוואת קריאות כמו 11.1.
- Vercel: ענף זמני `spike/pdf-render` → preview deployment בלבד (לא `test`, לא `main`, נמחק בסוף). endpoint בלי גישה ל-DB ובלי סודות, על PDF סינתטי: האם נבנה ורץ (binary נייטיבי, ESM), cold start, זמן לעמוד, זיכרון שיא, גודל bundle.
- מגבלה טכנית מוצעת = המינימום מבין: עמודים שנכנסים ב-maxDuration בחצי מהזמן · זיכרון · כתיבה אטומית אחת ב-RTDB עם מרווח.
- נכשל → חלופה B (רינדור בדפדפן האדמין עם pdf.js מ-`pdf-split`), עם אותו כלל הכל-או-כלום.

### 11.3 `waitUntil` על התשתית שלנו (D6) — _טרם בוצע_
באותו preview: endpoint שמחזיר 200 מיד ורושם log אחרי השהיה של 20 שניות דרך `waitUntil`. מאמת שהעבודה ממשיכה אחרי התשובה בפרויקט שלנו (Hobby). נכשל → טריגר 2 בלבד (admin), וזה עדיין עומד ב-D6.

## 12 · ממצאים בדרך, מחוץ להיקף
- **PDF מהפורטל נשמר גולמי ומוצג שבור** (`upload.html:~416`) — באג פרודקשן קיים. ה-renderer מ-0B עשוי לשמש לתיקונו בהמשך, בהחלטה נפרדת.
- **(הסקה, לא אומת)** ה-rule של `orders` ללקוח דורש `!data.exists()`; retry של העלאה חלקית שכותב שוב id שכבר נשמר עלול להידחות. קשור ל-[[upload-reliability-untested]] — לבדוק בבדיקה הידנית שעוד לא בוצעה.
- הערת header מיושנת ב-`api/_wa-provider.js:39-45` (`GREENAPI_TEST_*` במקום `GREENAPI_ONLY_TO`).
