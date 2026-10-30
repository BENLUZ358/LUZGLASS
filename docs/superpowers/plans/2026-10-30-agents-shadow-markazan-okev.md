# מרכזן + עוקב במצב שקט — תוכנית בנייה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** כל הודעת וואטסאפ מלקוח מקושר נרשמת, "מרכזן" מסווג אותה ו"עוקב" מחשב מה **היה** עונה — בלי לשלוח כלום ללקוח ובלי לגעת בקליטה הקיימת — ובן רואה ומסמן נכון/לא נכון בפאנל הקליטות.

**Architecture:** ה-webhook הקיים (`api/wa-inbound.js`) קורא, אחרי הטיפול הרגיל ובלי להשפיע עליו, ל-`lgAgentShadowRecord` שרושם את ההודעה ב-`waMeta/agentShadow/<id>` (create-once). העיבוד (סיווג במודל + חישוב תשובת עוקב) רץ ב-`waitUntil`, ומה שלא הושלם נאסף ב-drain הקיים. הכל תחת `waMeta/` — אין שינוי rules (העדפת בן). אין נתיב API חדש — Vercel Hobby כבר ב-12 נתיבים, ולכן פעולות אדמין חדשות נכנסות ל-`wa-inbound-drain.js`.

**Tech Stack:** Node (Vercel functions), firebase-admin RTDB, GREEN API webhooks, OpenAI Responses API עם json_schema (אותו דפוס כמו `readImage` ב-`api/_sketch-reader.js`), דף אדמין סטטי (`admin.html` + `wa-inbound-panel.js`). בדיקות: `node scripts/test-*.js` עם `scripts/_fake-db.js`.

**Spec:** `docs/superpowers/specs/2026-10-30-customer-agents-design.md` (כללים 1–11, סוכנים 1–2).

## Global Constraints

- **שום הודעה לא יוצאת ללקוח בשלב הזה.** אין קריאה ל-`lgWaEnqueue`/provider מקוד הסוכנים.
- **הקליטה הקיימת לא משתנה.** התשובה של ה-webhook (status/body) זהה לפני ואחרי; כשל בסוכן לעולם לא מחזיר 500.
- דגל: `AGENT_SHADOW_ENABLED === 'true'`; מודל: `AGENT_MODEL`; מפתח: `OPENAI_API_KEY` (קיים). דגל כבוי → אפס כתיבות.
- נתונים חדשים רק תחת `waMeta/` (קריאה לאדמין, כתיבה רק מהשרת).
- לא נרשמים ללוג: טוקנים, downloadUrl, גוף הבקשה, טקסט הודעה.
- רק לקוח **מקושר** (קבוצה ב-`waGroups`, מספר ב-`waSenders`, או ברשימת `lgWaInboundAllowed`) נרשם עם תוכן. לא מקושר → נרשם `route:'shaul'` בלי טקסט.
- כלל ביטול/שינוי: מותר רק בשלבים `''`, `pending`, `chash`, `drafter`, `opty`.
- שתיקה כשבן/שאול ענו ידנית: 2 שעות מההודעה הידנית האחרונה באותו צ'אט (`AGENT_HUMAN_QUIET_MS = 2*60*60*1000`).
- נוסח תשובות סטטוס (מהאפיון, מילה במילה):

| stage | טקסט |
|---|---|
| `''`, `pending` | קיבלנו, ההזמנה בבדיקה |
| `chash`, `drafter`, `opty` | ההזמנה בהכנה |
| `workday` | ההזמנה בייצור |
| `chisum` | ההזמנה בחיסום |
| `graphic` | ההזמנה בגרפיקה |
| `delivery` | מוכן, יוצא אליך במשלוח |
| `done` | מוכן, אפשר לבוא לאסוף |
| `collected` | ההזמנה כבר נאספה |

- תפריט שיחה-לא-עבודה (מילה במילה):
```
הצ'אט הזה מיועד לעבודה בלבד. אפשר:
1. לבדוק איפה הזמנה
2. לבטל או לשנות הזמנה
3. לקבל חשבונית או סקיצה
4. לקבל הצעת מחיר
5. לשלוח הזמנה חדשה
לכל דבר אחר: שאול, 050-6824365
```

## Review Focus

1. **שאלה עם מספר ומידות** ("PHR#26037 90/145 מתי מוכן?") — הקליטה הקיימת עלולה לקלוט אותה כהזמנה; ברשומת הצל צריך לראות `intent:'status'` וגם `intakeKind:'text'` כדי שבן יראה את ההתנגשות. → בדיקה במשימה 3.
2. **אותה הודעה מגיעה פעמיים מ-GREEN API** — רשומה אחת, סיווג אחד (create-once + claim). → משימה 3.
3. **הודעה בקבוצה בין חברי הקבוצה** ("מי מביא את הרכב?") — `route:'ignore'`, אף פעם לא תפריט. → משימה 1.
4. **שם סקיצה שמתאים לשתי הזמנות פתוחות** — `match:'many'` ושאלה, לא בחירה. → משימה 1.
5. **סוג webhook לא מוכר** (מחיקת הודעה, תגובת אימוג'י, outgoing) — נרשם רק `typeWebhook`/`typeMessage` ומזהים, לא נופל. כך נגלה איך GREEN API שולחת מחיקה. → משימה 3.

---

### Task 1: עוקב — מציאת הזמנה ונוסח תשובה (טהור, בלי DB)

**Files:**
- Create: `api/_agent-okev.js`
- Test: `scripts/test-agent-okev.js`

**Interfaces:**
- Produces:
  - `OKEV_STATUS_TEXT: {[stage]: string}` — הטבלה מ-Global Constraints.
  - `lgOkevCanChange(order) → boolean` — `true` רק ב-stage `''|pending|chash|drafter|opty`.
  - `lgOkevFind(orders: object[], q: {quotedId?: string, ref?: string}) → {match:'one'|'many'|'none', orders: object[], via:'quoted'|'ref'|'open'|''}`
  - `lgOkevReply(intent: 'status'|'cancel'|'change', found) → string`
  - `lgOkevRoute({intent, isGroup, linked, humanQuiet}) → 'okev'|'kolet'|'archive'|'quote'|'menu'|'none'|'ignore'|'shaul'|'silent-human'`
  - `AGENT_MENU_TEXT: string` — התפריט מ-Global Constraints.

- [ ] **Step 1: Write the failing tests** (`check(name, actual, expected)` כמו ב-`scripts/test-wa-text-inbound.js`)
  - `lgOkevCanChange` — true ל-`''`,`pending`,`chash`,`drafter`,`opty`; false ל-`workday`,`chisum`,`graphic`,`delivery`,`done`,`collected`.
  - `lgOkevFind(orders, {quotedId:'ABC'})` מחזיר את ההזמנה עם `waMessageId:'ABC'` גם אם היא `collected`, `via:'quoted'`.
  - ref: `'כהן'` מול `sketchName:'מטבח כהן'` → one; ref `'1234'` ו-`'L1234'` מול `orderNum:'L1234'` → one; ref שמתאים לשתי הזמנות פתוחות → many (2).
  - בלי quotedId ובלי ref: הזמנה פתוחה אחת (לא `collected`, לא `agentCancelled`) → one, `via:'open'`; שתיים → many; אפס → none.
  - `lgOkevReply('status', one(stage:'chisum', orderNum:'L1234', sketchName:'כהן'))` === `'הזמנה L1234 (סקיצה: כהן): ההזמנה בחיסום'`.
  - `lgOkevReply('status', many)` מתחיל ב-`'על איזו הזמנה מדובר?'` ושורה לכל הזמנה בצורה `'1. L1234 — כהן'`.
  - `lgOkevReply('status', none)` === `'לא מצאתי את ההזמנה. אפשר לכתוב את שם הסקיצה?'`.
  - `lgOkevReply('cancel', one(stage:'opty'))` === `'בטוח לבטל את הזמנה L1234 (סקיצה: כהן)?'`; ב-`workday` === `'הזמנה L1234 כבר בייצור ואי אפשר לבטל או לשנות אותה'`.
  - `lgOkevReply('change', one(stage:'drafter'))` === `'מה בדיוק לשנות בהזמנה L1234 (סקיצה: כהן)?'`.
  - `lgOkevRoute`: `linked:false` → `'shaul'`; `humanQuiet:true` → `'silent-human'`; status/cancel/change → `'okev'`; order → `'kolet'`; document → `'archive'`; quote → `'quote'`; chitchat בפרטי → `'menu'`, בקבוצה → `'ignore'`; thanks → `'none'`; unclear → `'shaul'`.

- [ ] **Step 2: Run** `node scripts/test-agent-okev.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `api/_agent-okev.js`. השוואת ref: מנרמלים (רווחים, גרש/גרשיים, `L` מוביל, אותיות קטנות) ובודקים equal או includes מול `sketchName`, `orderNum`, `refNum`. quoted גובר על ref, ref גובר על open.
- [ ] **Step 4: Run** `node scripts/test-agent-okev.js` — Expected: כל השורות `ok`, exit 0.
- [ ] **Step 5: Commit** `git add api/_agent-okev.js scripts/test-agent-okev.js && git commit -m "agents: עוקב — מציאת הזמנה ונוסח תשובה (מצב שקט)"`

### Task 2: מרכזן — סיווג הודעה במודל

**Files:**
- Create: `api/_agent-classify.js`
- Test: `scripts/test-agent-classify.js`

**Interfaces:**
- Produces:
  - `AGENT_INTENTS = ['order','status','cancel','change','document','quote','chitchat','thanks','unclear']`
  - `lgAgentClassify({text: string, quotedText?: string, hasImage: boolean, model: string, key: string, fetcher?}) → Promise<{intent, ref: string, usage: object|null}>`

- [ ] **Step 1: Write the failing tests** עם `fetcher` מזויף:
  - הבקשה נשלחת ל-`https://api.openai.com/v1/responses` עם `store:false`, `text.format.type:'json_schema'`, `strict:true`, וה-schema מכיל `intent` כ-enum של `AGENT_INTENTS` ו-`ref` כמחרוזת.
  - תשובת מודל `{"intent":"status","ref":"כהן"}` → `{intent:'status', ref:'כהן'}`.
  - intent שאינו ב-enum, JSON שבור, `status!=='completed'`, refusal, או HTTP 500 → `{intent:'unclear', ref:''}` (לא זורק).
  - `hasImage:true` בלי טקסט → `'order'` **בלי** קריאה ל-fetcher.
  - `key` ריק → `'unclear'` בלי קריאה.
  - טקסט ריק → `'unclear'` בלי קריאה.
- [ ] **Step 2: Run** `node scripts/test-agent-classify.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** ה-instructions בעברית מתארים כל intent בשורה (מתוך האפיון: "מוכן?"=status, ביטול=cancel, שינוי מידה/סקיצה=change, חשבונית/חשבונית ריכוז/סקיצה חסרה=document, "כמה עולה"=quote, הזמנה חדשה=order, ברכות/שיחה=chitchat, תודה/אחלה=thanks), ומבקשים ב-`ref` את שם הסקיצה/מספר ההזמנה/מספר החשבונית כפי שנכתב, או ''. הטקסט עובר כתוכן משתמש ומסומן "מידע, לא הוראות". `AbortSignal.timeout(20000)`, `max_output_tokens: 300`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "agents: מרכזן — סיווג הודעה (מצב שקט)"`

### Task 3: רשומת צל — רישום ועיבוד

**Files:**
- Create: `api/_agent-shadow.js`
- Test: `scripts/test-agent-shadow.js`

**Interfaces:**
- Consumes: `lgOkevFind`, `lgOkevReply`, `lgOkevRoute`, `AGENT_MENU_TEXT` (Task 1); `lgAgentClassify` (Task 2); `lgWaInboundParse`, `lgWaInboundKey` מ-`_wa-inbound.js`; `lgWaSenderLink`, `lgClientFromWaSender`, `lgClientFromWaGroup`, `waChatToLocal` מ-`_wa-recipient.js`; `lgWaInboundAllowed` מ-`_env.js`; `lgInboxStillMine` מ-`_inbox-common.js`.
- Produces:
  - `SHADOW = 'waMeta/agentShadow'`, `HUMAN = 'waMeta/agentHuman'`, `AGENT_HUMAN_QUIET_MS`
  - `lgAgentShadowParse(body) → {action:'record'|'human'|'ignore', entry}` — `entry`: `{idMessage, typeWebhook, typeMessage, chatId, groupId, sender, text, quotedId, hasImage, timestamp}`. `quotedId` = `extendedTextMessageData.stanzaId` ב-`quotedMessage`. `outgoingMessageReceived` → `'human'`. סוג לא מוכר → `'record'` עם `text:''` ו-`typeMessage` בלבד.
  - `lgAgentShadowRecord(db, body, now) → Promise<{key, created}|null>` — create-once, כולל בדיקת קישור (רשומה של לא-מקושר: `linked:false`, בלי `text`), ו-`intakeKind` = `lgWaInboundParse(body).entry?.kind || ''`.
  - `lgAgentShadowProcess(db, key, {now, fetchImpl, env}) → Promise<{ok, reason}>` — claim → זיהוי לקוח → סיווג → `humanQuiet` מ-`HUMAN/<chatKey>/lastAt` → `route` → אם `okev`: קריאת `orders` וסינון לפי `customerId` → `wouldReply`. כותב: `{state:'done', intent, ref, route, wouldReply, matchedOrderIds, customerId, customerName, model, usage, doneAt}`.
  - `lgAgentShadowPending(db, limit, now) → Promise<string[]>` — אותו דפוס כמו `lgWaInboundPending`.

- [ ] **Step 1: Write the failing tests** (fakeDb עם `waGroups`, `waSenders`, `orders`, ו-`fetchImpl` מזויף למודל):
  - הודעה פרטית ממספר מקושר "מה עם כהן?" → רשומה אחת; אחרי process: `intent:'status'`, `route:'okev'`, `wouldReply` לפי Task 1, `matchedOrderIds` = ההזמנה של **אותו לקוח** בלבד (הזמנת "כהן" של לקוח אחר לא נכנסת).
  - אותו `idMessage` פעמיים → `created:false` בשנייה; process פעמיים → המודל נקרא פעם אחת.
  - תגובה (`quotedMessage`, `stanzaId:'WA1'`) → `quotedId:'WA1'`, וההזמנה עם `waMessageId:'WA1'` נמצאת.
  - מספר לא מקושר → `linked:false`, אין שדה `text` ברשומה, `route:'shaul'`, המודל לא נקרא.
  - קבוצה מקושרת, chitchat → `route:'ignore'`.
  - `outgoingMessageReceived` לצ'אט X → `HUMAN/<X>/lastAt` נכתב, אין רשומת צל; הודעת לקוח באותו צ'אט שעה אחר כך → `route:'silent-human'`; שלוש שעות אחר כך → לא.
  - Review Focus 1: "PHR#26037 90/145 מתי מוכן?" ממספר מקושר → `intakeKind:'text'` נשמר (המודל המזויף מחזיר status).
  - Review Focus 5: `typeMessage:'deletedMessage'` / סוג לא מוכר → רשומה עם `typeMessage` ו-`text:''`, process לא נופל, `route:'none'`.
  - המודל נכשל (HTTP 500) → `intent:'unclear'`, `route:'shaul'`, `state:'done'`.
- [ ] **Step 2: Run** `node scripts/test-agent-shadow.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `api/_agent-shadow.js`. מפתח הצ'אט ל-HUMAN: `lgWaInboundKey(groupId || chatId)`. הזמנות שבוטלו (`agentCancelled`) לא קיימות עדיין — רק מסננים. קריאת כל `orders` מקובלת כאן (מעט הזמנות בפרודקשן); הערה בקוד שלפני הפעלה חיה צריך אינדקס `customerId`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "agents: רשומת צל — רישום, סיווג ותשובת עוקב בלי שליחה"`

### Task 4: חיבור ל-webhook מאחורי דגל

**Files:**
- Modify: `api/wa-inbound.js` (`handleInbound` / `handleCustomerInbound`)
- Test: `scripts/test-agent-webhook.js`; וגם הבדיקות הקיימות: `scripts/test-wa-inbound.js`, `test-wa-text-inbound.js`, `test-wa-groups.js`, `test-wa-senders.js`, `test-wa-free-text.js`

**Interfaces:**
- Consumes: `lgAgentShadowRecord`, `lgAgentShadowProcess` (Task 3).

- [ ] **Step 1: Write the failing tests**
  - `AGENT_SHADOW_ENABLED` לא מוגדר → אין שום כתיבה תחת `waMeta/agentShadow`/`agentHuman`.
  - מוגדר `'true'` → טקסט "מתי מוכן?" ממספר מקושר: התשובה `{status:200, body:{ok:true, ignored:'not a sketch'}}` — **זהה** למצב בלי דגל — ונוצרת רשומת צל, ו-`waitUntil` קיבל את ה-process.
  - תמונה ממספר מקושר: גם הזמנה בתור (כמו היום) וגם רשומת צל עם `intakeKind:'image'`.
  - `outgoingMessageReceived` → 200 ו-`agentHuman` נכתב (היום מוחזר `ignored:'type'` — נשאר אותו body).
  - `lgAgentShadowRecord` זורק → התשובה עדיין זהה ל-200 הרגיל.
- [ ] **Step 2: Run** `node scripts/test-agent-webhook.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** קריאה אחת בתחילת `handleCustomerInbound`, עטופה ב-try/catch, שרק רושמת ומעבירה את ה-process ל-`deps.waitUntil`; שום `return` לא תלוי בה. `maybeCaptureOwner` של devbrain נשאר לפני הכל, כמו היום.
- [ ] **Step 4: Run** את הבדיקה החדשה ואת חמש הקיימות — Expected: כולן PASS.
- [ ] **Step 5: Commit** `git commit -m "agents: ה-webhook רושם רשומת צל (AGENT_SHADOW_ENABLED), הקליטה לא משתנה"`

### Task 5: drain וסימון נכון/לא נכון

**Files:**
- Modify: `api/wa-inbound-drain.js`
- Modify: `api/_agent-shadow.js` (הוספת `lgAgentShadowVerdict`)
- Test: `scripts/test-agent-drain.js`

**Interfaces:**
- Produces: `lgAgentShadowVerdict(db, key, {ok: boolean, note: string, by: string}, now) → Promise<{ok, code, message}>` — כותב `verdict:{ok, note(≤300), by, at}`; רשומה לא קיימת → `{ok:false, code:'missing'}`.
- ב-drain: אחרי הקליטות, עד `BATCH` רשומות מ-`lgAgentShadowPending` בתוך אותו `BUDGET_MS`; פעולה חדשה `action:'agent-verdict'` עם `key`, `ok`, `note` — מאחורי אותו אימות אדמין כמו `retry`/`close`.

- [ ] **Step 1: Write the failing tests** — רשומת `received` שנתקעה מעובדת ב-drain; `agent-verdict` בלי אדמין → 401/403 כמו הפעולות הקיימות; עם אדמין → `verdict` נכתב; key לא חוקי → 400.
- [ ] **Step 2: Run** `node scripts/test-agent-drain.js` — Expected: FAIL.
- [ ] **Step 3: Implement** לפי הדפוס של `retry`/`close` הקיימים בקובץ.
- [ ] **Step 4: Run** את החדשה ואת הבדיקות הקיימות של ה-drain — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "agents: drain משלים רשומות צל; סימון נכון/לא נכון מהאדמין"`

### Task 6: לשונית "סוכנים · ניסיון" בקליטות

**Files:**
- Modify: `wa-inbound-panel.js`, `admin.html` (CSS בלבד, ליד `/* ─ קליטות (27/10)`)
- Test: `scripts/test-agent-panel.js` (באותו סגנון כמו `scripts/test-wa-inbound-panel.js`)

**Interfaces:**
- Consumes: `waMeta/agentShadow` (קריאה), פעולת `agent-verdict` (Task 5).

- [ ] **Step 1: Write the failing tests** — לשונית שלישית "סוכנים · ניסיון" ליד וואטסאפ/מייל; כל רשומה מציגה: שעה, לקוח (או "לא מקושר"), טקסט ההודעה, הסיווג בעברית (status→"איפה ההזמנה", cancel→"ביטול", change→"שינוי", document→"מסמך", quote→"הצעת מחיר", order→"הזמנה", chitchat→"שיחה", thanks→"תודה", unclear→"לא ברור"), לאן הועבר, "היה עונה:" + `wouldReply`, ושני כפתורים ✓ / ✗ ששולחים `agent-verdict`. רשומה עם `intakeKind` ו-intent שאינו `order` מסומנת באדום "נקלטה גם כהזמנה". 100 האחרונות, חדש למעלה. טקסט ההודעה מוצג דרך escape (אין innerHTML גולמי).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** באותו מבנה של הלשוניות מ-27/10.
- [ ] **Step 4: Run** + בדיקה בדפדפן מול ה-fake-Firebase harness הקיים (`scratchpad/fake-firebase-admin.js`) ברוחב 375px ובמחשב. Expected: הלשונית נפתחת, שורות מוצגות, ✓ מסמן.
- [ ] **Step 5: Commit** `git commit -m "agents: לשונית 'סוכנים · ניסיון' בקליטות — מה המרכזן החליט ומה עוקב היה עונה"`

### Task 7: הפעלה בסביבת test

- [ ] **Step 1:** כל הבדיקות: `for f in scripts/test-agent-*.js scripts/test-wa-*.js; do node "$f" || echo "FAIL $f"; done` — Expected: אין FAIL.
- [ ] **Step 2:** מיזוג ל-`test` (כמו ב-ENVIRONMENTS.md), ואז בן מוסיף ב-Vercel לסביבת test: `AGENT_SHADOW_ENABLED=true`, `AGENT_MODEL=<אותו מודל כמו SKETCH_READER_MODEL>`.
- [ ] **Step 3:** בן מפעיל ב-GREEN API (הגדרות המופע) "Receive webhooks on outgoing messages" — בלי זה כלל השתיקה (9) לא יראה הודעות ידניות.
- [ ] **Step 4:** הודעת בדיקה ממספר מקושר בסביבת test → רשומה בלשונית עם סיווג ותשובה. Expected: מופיעה תוך דקה; שום הודעה לא יצאה ללקוח.
- [ ] **Step 5:** לפרודקשן — רק באישור של בן, ואז כמה ימים של סימון ✓/✗ לפני תוכנית שלב 2 (שליחה אמיתית + ביטול).
