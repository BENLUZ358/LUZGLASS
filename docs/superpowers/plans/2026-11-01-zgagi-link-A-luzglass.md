# חיבור זגאגי ↔ לוז גלאס — תכנית A: הצד של לוז גלאס

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לוז גלאס מקבל מזגאגי פריט (סקיצה או מידה) עם מספר לקוח, ויוצר ממנו הזמנה בלשונית הראשונה של תור הסקיצות עם פריטים ומק"טים. הוא גם עונה לזגאגי מה השלב, מחליף פריט שעודכן, מבטל פריט, ושולח בוואטסאפ את תמונות הסקיצות שטופלו.

**Architecture:** route אחד (`/api/zgagi` → rewrite ל-`/api/wa-inbound?zgagi=1`, כי 12 הפונקציות תפוסות) עם מפתח סודי `ZGAGI_LINK_TOKEN`. הלוגיקה במודולים טהורים `api/_zgagi-*.js` עם `db` מוזרק, ונבדקת על `scripts/_fake-db.js`. הנתונים נשמרים ב-`orders/`, `sketches/` ו-`waMeta/zgagi*`, בלי שינוי rules.

**Tech Stack:** Node (Vercel functions), firebase-admin RTDB, בדיקות `node scripts/test-*.js`.

**Spec:** `docs/superpowers/specs/2026-11-01-zgagi-luzglass-link-design.md`

## Global Constraints

- בלי שינוי `database.rules.json`. נתוני אדמין חדשים יושבים תחת `waMeta/`.
- מספר פונקציות ב-`api/` (בלי קידומת `_`) נשאר ≤ 12. `scripts/test-email-inbound-route.js` אוכף את זה.
- כל סקיצה = הזמנה נפרדת. מפתח הזהות הוא `zgagiBiz/zgagiOrder/itemId`.
- אפשר לשנות או לבטל רק כש-`lgOkevCanChange(order)` נכון (`'' pending chash drafter opty`).
- מקור האמת לפריטים הוא ה-output של זגאגי. ממפים מק"ט, ולא מריצים את המנוע. שורה שאי אפשר למפות נכנסת עם `skuMissing:true`.
- סודות רק ב-env, ש-Claude לא רואה. מפתח ריק = אף אחד לא נכנס.
- טקסטים למשתמש בעברית פשוטה.

## Review Focus

1. **אותו פריט נשלח פעמיים** (רשת נפלה, זגאגי מנסה שוב): אותה הזמנה, אותו refNum, בלי כפולה.
2. **מספר לקוח שלא קיים** ב-`hashavshevetAccounts`: דחייה ברורה, ושום דבר לא נכתב.
3. **תיקון כשההזמנה כבר בייצור** (`workday` ומעלה): לא נוגעים, ומחזירים `locked` עם השלב.
4. **פורטל שמזייף `source:'zgagi'`**: ה-route לא סומך על השדה הזה בהזמנה. החלפה, ביטול ושלבים עובדים רק דרך רשומת `waMeta/zgagiItems`, שרק השרת כותב.
5. **תמונה גדולה מדי או לא PNG/JPEG**: דחייה לפני כתיבה (סף 3MB לגוף).

---

### Task 1: מיפוי פריט זגאגי → שורות לוז גלאס

**Files:**
- Create: `api/_zgagi-items.js`
- Test: `scripts/test-zgagi-items.js`

**Interfaces:**
- Produces:
  - `lgZgagiSkuMenu(catalogEntries) → menu`: עותק שרת של `lgParseGlassName` + `lgMeasureMenu`.
  - `lgZgagiItems(item, menu, activeCodes) → { items, hardware, notes, unmapped }`.
  - `lgZgagiFingerprint(item) → string`: sha1 של `{type, qty, output.panels, output.hardwareLines, measure, withHardware}`.
- `item` (מזגאגי): `{ itemId, type:'sketch'|'measure'|'uploaded', title, qty, output?, measure?, withHardware, hardware?:[{name,qty,sku}], skuHints?:{[glassKey]:sku} }`.

- [ ] **Step 1: בדיקות שנכשלות.** `scripts/test-zgagi-items.js`:
  - **parity:** `lgZgagiSkuMenu` נותן אותו תפריט כמו `lgMeasureMenu` של `firebase-db.js`, שמחולץ ב-vm כמו `scripts/test-sketch-order.js:40-67`, על כל שמות `LG_SKU_MAP`.
  - **sketch:** 2 זכוכיות `{glass:{type:'שקוף',thickness:8,work:null,processing:'chisum'}, cutW:900, cutH:1950, label:'A'}` → 2 שורות `{sku:'8SMH', glass:'שקוף', mm:8, w:900, h:1950, chisum:true, litush:false, paneLabel:'A', locked:true}`.
  - **sketch, שורה שלא ממופה:** `type:'סוג לא קיים'` → `{sku:null, skuMissing:true}`. הפריט לא נדחה.
  - **skuHint:** משמש רק כשהקוד ב-`activeCodes`.
  - **measure:** `{glassType:'מראה', thickness:5, processing:'cut', w:600, h:800}` עם `qty:3` → 3 שורות עם `quantityGroupId` משותף, `originalQuantity:3` ו-`groupIndex` 0..2 (כמו `_wa-text-order.js:93`).
  - **measure עם `led:true`:** מופיע ב-`notes` ("עם לד").
  - **`withHardware:false`:** `hardware:[]`. **true:** מעבירים את `hardware` כמו שהוא.
  - **uploaded:** `items:[]`.
  - **fingerprint:** יציב כשסדר המפתחות משתנה, ומשתנה כשמשנים `cutW`.
- [ ] **Step 2:** `node scripts/test-zgagi-items.js` → FAIL (המודול לא קיים).
- [ ] **Step 3:** מימוש. גרפיקה: אם `work==='graphic'`, הסוג לחיפוש הוא `'<type> גרפיקה'`, ואם אין, ה-hint. `work==='chalavi'` מסמן `chalavi:true`.
- [ ] **Step 4:** `node scripts/test-zgagi-items.js` → PASS.
- [ ] **Step 5:** commit.

### Task 2: קליטה — יצירת הזמנה פעם אחת

**Files:**
- Create: `api/_zgagi-inbound.js`
- Test: `scripts/test-zgagi-inbound.js`

**Interfaces:**
- Consumes: Task 1, `lgInboxRefNum` (`api/_inbox-common.js`).
- Produces: `lgZgagiReceive(db, body, now) → { code:'ok'|'unknown-customer'|'bad-input'|'locked', items?:{[itemId]:{refNum, orderId, state:'created'|'same'|'replaced'|'locked', stage}} }`.
  - `body = { biz, bizName, order, orderNo, customerNo, rev, item, imagePng? }`, ופריט אחד בכל קריאה.
  - רשומת זהות: `waMeta/zgagiItems/<k>`, כש-`k = key(biz)+'_'+key(order)+'_'+key(itemId)`. השדות: `{orderId, refNum, fp, rev, biz, order, itemId, createdAt, updatedAt}`.
  - orderId = `'zg_'+k`.

- [ ] **Step 1: בדיקות שנכשלות** (fake db עם `hashavshevetAccounts/14201:{name:'א.מ מראות',phone:'050…'}` ו-skuCatalog):
  - **קליטה ראשונה:** נוצר `orders/zg_…`, עם `source:'zgagi'`, `zgagi:{biz,order,item,orderNo,rev}`, `customerId:'14201'`, `orderClient`/`client` = שם הכרטיס, `stage:''`, `status:'ממתין לאישור'`, `hasSketch:true` (כשיש תמונה), `sketchName = title + ' · ' + orderNo`, `items` מ-Task 1 ו-`hardware`. בנוסף `sketches/<id>` = data URL של התמונה, ו-refNum `'L1000'`.
  - **אותה קריאה שוב:** `state:'same'`, אותו refNum, ו-`meta/orderCounter` לא זז.
  - **customerNo לא קיים:** `code:'unknown-customer'`, ושום מפתח חדש במסד.
  - **body חסר:** `bad-input`. גם תמונה שאינה `data:image/png|jpeg;base64,` או גדולה מ-3MB → `bad-input`.
  - **uploaded:** עם תמונה, `items:[]`.
- [ ] **Step 2:** הרצה → FAIL.
- [ ] **Step 3:** מימוש. כתיבה אטומית אחת (`db.ref().update`) של `orders/`, `sketches/` ו-`waMeta/zgagiItems/`. ה-refNum דרך `lgInboxRefNum(db, 'waMeta/zgagiItems', k, …)`. בהזמנה אין `sketchSeenAt`, ולכן היא נכנסת ללשונית הראשונה.
- [ ] **Step 4:** הרצה → PASS. **Step 5:** commit.

### Task 3: תיקון — החלפה בכל מקום, ונעילה בייצור

**Files:**
- Modify: `api/_zgagi-inbound.js`
- Test: `scripts/test-zgagi-inbound.js`

**Interfaces:**
- Produces: `lgZgagiCorrections(beforeItems, afterItems, by, at) → { [key]: {itemIndex, hsLine, type:'dims'|'glass'|'add'|'remove', from, to, by, at, done:false} }`, באותה צורה כמו `lgAddHsCorrection` (`firebase-db.js:1413`).

- [ ] **Step 1: בדיקות שנכשלות:**
  - **fp שונה, stage `''`:** `state:'replaced'`. ה-items והתמונה הוחלפו. `_editedSketch`, `checkEdits/<id>`, `sketches/<id>__layer` ו-`__base` נמחקו (null). נוסף `zgagiUpdatedAt`. **בלי** `hsCorrections`, כי לא נשלח לחשבשבת.
  - **fp שונה, stage `chash`, ו-`hashavshevet.sentAt` קיים:** הוחלף. ב-`orders/<id>/hsCorrections` יש רשומות `dims` למידה ששונתה ו-`add` לשורה שנוספה.
  - **fp שונה, stage `workday`:** `state:'locked'`, `stage:'workday'`, ושום דבר לא השתנה.
  - **fp זהה עם rev גבוה יותר:** `same`, ושום דבר לא נכתב (פריט שלא השתנה לא מסומן).
  - **rev נמוך מהשמור:** `same`, בלי שינוי (שליחה ישנה שהגיעה באיחור).
- [ ] **Step 2:** FAIL. **Step 3:** מימוש. הבדיקה והכתיבה בתוך `transaction` על `orders/<id>/stage` לא אפשרית יחד עם multi-path, ולכן קוראים, בודקים `lgOkevCanChange` ואז כותבים. **Ruling** בלדג'ר: חלון מרוץ של שניות מול שינוי שלב ידני, מקובל. **Step 4:** PASS. **Step 5:** commit.

### Task 4: שלבים וביטול

**Files:**
- Create: `api/_zgagi-status.js`
- Test: `scripts/test-zgagi-status.js`

**Interfaces:**
- Produces:
  - `lgZgagiStages(db, {biz, items:[itemId…], order}) → { [itemId]: { refNum, stage, ready:boolean, canChange:boolean, gone?:true } }`.
    - `ready` = stage ב-`delivery|done|collected`.
    - קוראים רק דרך `waMeta/zgagiItems`.
    - הזמנה שנמחקה (ביטול, או מחיקה ידנית) → `gone:true`.
  - `lgZgagiCancel(db, {biz, order, itemId}, now) → { code:'ok'|'locked'|'not-found', stage? }`.
    - כרטיס `waMeta/agentCancels/<orderId>` = `{order:<snapshot>, at, chatId:'', via:'zgagi', done:false, confirmed:true, hsSent}`, ואז מחיקת `orders/<id>`. אותו סדר כמו `lgAgentCancel` (`_agent-act.js:279`).
- [ ] **Step 1: בדיקות:**
  - שלבים: מוכן, לא מוכן, נעול ו-gone.
  - עסק אחר שמבקש את אותו itemId מקבל ריק.
  - ביטול ב-`pending`: הכרטיס נוצר וההזמנה נמחקה.
  - ביטול ב-`workday`: `locked`.
  - **הכרטיס נראה בדף:** `hs-corrections.html` מציג כרטיס בלי `chatId`. בודקים grep על הקוד שמציג (שורות 94-174) שאין תלות ב-chatId, ואם יש, מתקנים.
- [ ] **Step 2-5:** FAIL → מימוש → PASS → commit.

### Task 5: ה-route והמפתח

**Files:**
- Create: `api/_zgagi-route.js`
- Modify: `api/wa-inbound.js:150-157` (ענף `req.query.zgagi`), `vercel.json` (rewrite `/api/zgagi` → `/api/wa-inbound?zgagi=1`)
- Test: `scripts/test-zgagi-route.js`

**Interfaces:**
- Produces: `lgZgagiHandle(req, {db, env, now}) → {status, json}`, ו-`op` ב-body: `receive|stages|cancel`.
  - אימות: `lgHookTokenOk(req.headers.authorization, env.ZGAGI_LINK_TOKEN, 'zgagi')`. אחרת 401.
  - רק POST.
- [ ] **Step 1: בדיקות:**
  - בלי מפתח / מפתח שגוי / env ריק → 401, ושום קריאה ל-db.
  - כל op מנותב.
  - op לא מוכר → 400.
  - grep: `vercel.json` מכיל את ה-rewrite, ו-`api/` עדיין ≤ 12 פונקציות.
- [ ] **Step 2-5:** FAIL → מימוש → PASS (כולל `node scripts/test-email-inbound-route.js`) → commit.

### Task 6: הודעת "הסקיצות טופלו" עם התמונות

**Files:**
- Modify: `api/_wa-sketch-ack.js:16-29`, `firebase-db.js:308-332` (`lgSketchAckEligible`, `lgSketchAckPending`, `lgSketchAckUnseen`), `api/_wa-drain-core.js` (~149)
- Test: `scripts/test-zgagi-ack.js`, ו-`node scripts/test-wa-*.js` הקיימים ירוקים

- [ ] **Step 1: בדיקות:**
  - `lgSketchAckSkip` מקבל `source:'zgagi'` כשיש `zgagi.biz`.
  - `lgSketchAckEligible` נכון ל-zgagi.
  - בדרייב, הודעת `sketches-handled` שכל ההזמנות שלה zgagi נשלחת ב-`sendFiles`: קובץ לכל `sketches/<id>` base64, והכיתוב = הטקסט הרגיל, על הקובץ הראשון. ספק בלי `sendFiles` (Meta) → נשלח טקסט רגיל.
  - הודעה מעורבת (zgagi + whatsapp) → טקסט בלבד, כמו היום.
- [ ] **Step 2-5:** FAIL → מימוש → PASS → commit.

### Task 7: מסכים — השדות נשמרים, תווית "עודכן מזגאגי"

**Files:**
- Modify:
  - `firebase-db.js` `lgNormalizeOrder` (984-1176): להעביר `zgagi`, `zgagiUpdatedAt`, `hardware`.
  - `admin.html` `buildSQItems` (3671-3713): העברה, ותג "זגאגי" ליד המקור, כמו התווית 'הודעת טקסט'.
  - תווית אדומה "עודכן מזגאגי" כשיש `zgagiUpdatedAt`, ב-`admin.html` (שורת התור), `drafter.html` ו-`check-station.html`.
- Test: `scripts/test-zgagi-ui.js` (vm על `lgNormalizeOrder`, ו-grep על שלושת המסכים), ובדיקה בדפדפן על harness מדומה.

- [ ] **Step 1-5:**
  - בדיקה שנכשלת: `lgNormalizeOrder({source:'zgagi', zgagi:{biz:'b'}, zgagiUpdatedAt:5})` שומר את השדות.
  - מימוש → PASS → צילום מסך מה-harness → commit.

### Task 8: מתג "דילוג על הלשונית הראשונה", והוראות התקנה

**Files:**
- Modify: `api/_zgagi-inbound.js`. כש-`waMeta/zgagiConfig/skipFirstTab === true`, בקליטה ראשונה נכתב `sketchSeenAt: now`, וההודעה נשלחת דרך אותו מסלול כמו `whatsapp-dispatch` (`lgSketchAckSkip` + enqueue).
- Create: `docs/zgagi-link-setup.md`, בעברית: מפתח ב-Vercel, הלקוח ב-`GREENAPI_ALLOWED_ACCOUNTS`, ואיך מדליקים את המתג.
- Test: `scripts/test-zgagi-inbound.js`. המתג כבוי → אין `sketchSeenAt`. דלוק → יש, ונכנסה רשומה ל-`waOutbox`.

- [ ] **Step 1-5:** FAIL → מימוש → PASS → commit.

### Task 9: סקירה וסיום

- [ ] כל `node scripts/test-*.js` שנגעו בהם, ו-`test-wa-*` / `test-email-*`, ירוקים.
- [ ] סקירת ענף אחת (subagent).
- [ ] push ל-`feat/zgagi-link` ומיזוג ל-`test`. לא ל-main בלי אישור בן.
