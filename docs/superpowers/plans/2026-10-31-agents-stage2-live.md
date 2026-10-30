# סוכני לקוחות שלב 2 — עונים באמת (מאחורי מתגים), ארכיון, מחירון, קולט, מנהל

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** כל ששת הסוכנים מהאפיון (חוץ מ"שברים" ומערוץ המייל) פועלים: מרכזן+עוקב עונים ומבטלים, ארכיון שולח העתק חשבונית/סקיצה, מחירון מחשב הצעה מטקסט ומעביר סקיצה לשאול, קולט מטפל בסקיצה שנמחקה, מנהל שולח סיכום ב-15:00 — **הכל כבוי כברירת מחדל**, ולקוח מקבל תשובה אמיתית רק אם הוא ברשימת הפיילוט שבן מדליק בפאנל.

**Architecture:** שלב 1 (`_agent-shadow.js`) כבר מסווג ומחשב `wouldReply`. מוסיפים אחריו שכבת פעולה `_agent-act.js` שמחליטה מה **לעשות** (טקסט, קבצים, ביטול, העברה לשאול) ורושמת את זה ברשומת הצל. שליחה עוברת דרך תור נפרד `waMeta/agentOutbox/<key>` ומשלח `_agent-send.js` שמשתמש באותו ספק (`lgWaProvider`), אותו `getState`, אותו חלון שליחה (`lgWaReserveSlot`) ואותו שער (`provider.gate`) — בלי לגעת ב-`_wa-drain-core.js` של ההודעות הקיימות. מצב שיחה ב-`waMeta/agentConv/<chatKey>`. ביטול מעביר את ההזמנה ל-`waMeta/agentCancels/<orderId>` בעדכון אחד. הכל תחת `waMeta/` — אין שינוי rules. אין נתיב API חדש: cron ופעולות אדמין עוברים דרך rewrite + פרמטר ב-`wa-inbound.js` / `wa-inbound-drain.js`.

**Tech Stack:** Node (Vercel), firebase-admin RTDB, GREEN API, OpenAI Responses (json_schema), admin.html + wa-inbound-panel.js + hs-corrections.html. בדיקות: `node scripts/test-*.js` + `scripts/_fake-db.js`.

**Spec:** `docs/superpowers/specs/2026-10-30-customer-agents-design.md`. שלב 1: `docs/superpowers/plans/2026-10-30-agents-shadow-markazan-okev.md`.

## Global Constraints

- **שום הודעה לא יוצאת** אלא אם: `AGENT_SHADOW_ENABLED==='true'` **וגם** `AGENT_REPLY_ENABLED==='true'` **וגם** (הנמען הוא לקוח עם `waMeta/agentPilot/<customerId> === true` **או** הנמען הוא איש צוות מ-`AGENT_STAFF_PHONES`). אחרת — רק נרשם `wouldAct`.
- שער הספק נשאר הסמכות האחרונה: כל שליחה עוברת `provider.gate({phone, accountKey, linked})`; `linked:true` רק אחרי בדיקה חוזרת **בזמן השליחה** שהצ'אט עדיין מקושר לאותו `customerId` (קבוצה ב-`waGroups`, מספר ב-`waSenders`), או שהמספר ב-`AGENT_STAFF_PHONES`.
- שתיקה: `humanQuiet` (שעתיים מהודעה ידנית) → אין שום פעולה ושום שליחה בצ'אט.
- ביטול/שינוי רק בשלבים `''`,`pending`,`chash`,`drafter`,`opty`. ביטול רק אחרי "כן" מפורש לשאלת "בטוח?".
- כל מה שהסוכנים לא מטפלים בו → הודעה לשאול + ללקוח: `העברנו לשאול, הוא יחזור אליך`.
- שאול: `AGENT_STAFF_PHONES` (רשימה מופרדת בפסיק, הראשון = שאול). בן ושאול לסיכום: `AGENT_SUMMARY_TO`. לא מקודדים מספרים בקוד.
- מחירון: שטח = רוחב×גובה (מ') לפריט, מינימום לפריט: חתוך 0.20 · מלוטש 0.20 · מחוסם 0.30 מ"ר. מראה: פינוי 30 ₪, חור 15 ₪ ליחידה. מחיר למ"ר: `prices/clients/<customerId>/<SKU>` ואם אין — `prices/global/<SKU>`. מע"מ 18%. מוצר שאין לו מחיר → שאול.
- ארכיון: רק חשבוניות מ-`invoicePdf` במצב `ready` עם `accountKey === customerId`; שולחים **העתק** (`invoicePdfBlobs/<key>/copy`). סקיצה: `sketches/<orderId>` של הזמנה של אותו לקוח.
- לא נרשמים ללוג: טקסט הודעה, טוקנים, מפתחות, base64.
- `wa-inbound.js` הוא קליטה חיה: אין `await` חדש על מסלול התשובה; כל עבודת סוכן ב-`waitUntil` עם `.catch`.

## Review Focus

1. **שאול עונה ב"השב" על הודעה שלא נשלחה ממחירון** — לא מעבירים כלום ללקוח. → משימה 6.
2. **"כן" שמגיע אחרי יותר מ-30 דקות משאלת "בטוח?"** — לא מבטל; שואל מחדש. → משימה 3.
3. **הזמנה שירדה לביצוע בין השאלה ל"כן"** — לא מבטל, עונה שכבר בייצור. → משימה 3.
4. **אותה הודעה מעובדת פעמיים (webhook + drain)** — פעולה ושליחה פעם אחת בלבד (מפתח תור דטרמיניסטי מ-idMessage). → משימות 2,3.
5. **מספר חשבונית של לקוח אחר** — לא נשלח, עובר לשאול. → משימה 5.

---

### Task 1: תור שליחה של הסוכנים

**Files:** Create `api/_agent-send.js`; Test `scripts/test-agent-send.js`

**Interfaces — Produces:**
- `AGENT_OUTBOX = 'waMeta/agentOutbox'`
- `lgAgentStaff(env) → string[]` — `AGENT_STAFF_PHONES` מנורמל לספרות מקומיות (`0…`).
- `lgAgentEnqueue(db, {key, to, customerId, text, files?, reason}) → Promise<{key, queued}>` — create-once ב-`AGENT_OUTBOX/<key>`; `to` = chatId (`…@g.us`) או טלפון מקומי; `files` = `[{kind:'invoice-copy', invoiceKey}|{kind:'sketch', orderId}]`.
- `lgAgentSendPending(db, {provider?, env?, now?, budgetMs?}) → Promise<{sent, failed, skipped}>` — תופס (claim + TTL 2 דק', עד 3 ניסיונות, 24ש' תוקף, אותו דפוס כמו `lgWaClaim`), בודק `getState()==='authorized'`, חלון `lgWaReserveSlot`, בודק מחדש את הקישור/צוות (Global Constraints), `provider.gate`, ואז `provider.send`-טקסט חופשי או `provider.sendFiles`. כותב `state:'sent'|'failed'|'blocked'`, `messageId`.

- [ ] **Step 1: failing tests** (ספק מזויף עם `getState`, `gate`, `sendText`/`send`, `sendFiles`): טקסט לקבוצה מקושרת נשלח פעם אחת; אותו `key` פעמיים → `queued:false`; צ'אט שהקישור שלו הוסר אחרי ההכנסה לתור → `blocked`, לא נשלח; טלפון צוות נשלח בלי קישור; טלפון לא-צוות לא-מקושר → `blocked`; `getState` לא authorized → נשאר `pending`, ניסיון לא נספר; `invoice-copy` קורא `invoicePdfBlobs/<k>/copy` ושולח PDF בשם `חשבונית <docNumber>.pdf`; `sketch` קורא data-URL מ-`sketches/<id>` ושולח תמונה; כשל ספק → `failed` עם `lastError` בלי טקסט ההודעה.
- [ ] **Step 2:** run `node scripts/test-agent-send.js` → FAIL.
- [ ] **Step 3: implement.** שליחת טקסט חופשי: מוסיפים ל-`greenProvider()` ב-`api/_wa-provider.js` מתודה `sendText({to, text})` (POST `sendMessage` עם `{chatId: lgWaChatId(to), message: text}`, אותו סיווג כשלים). לא משנים את `send`/`renderText` הקיימים.
- [ ] **Step 4:** run → PASS; גם `scripts/test-greenapi-errors.js`, `scripts/test-whatsapp-provider.js` עוברים.
- [ ] **Step 5: commit** `agents: תור שליחה של הסוכנים — טקסט חופשי וקבצים דרך אותו ספק, אותו שער`

### Task 2: מרכזן+עוקב עונים — פיילוט, מצב שיחה, העברה לשאול

**Files:** Create `api/_agent-act.js`; Modify `api/_agent-shadow.js` (קריאה ל-act בסוף process), `api/_agent-okev.js` (נוסחים חסרים); Test `scripts/test-agent-act.js`

**Interfaces — Produces:**
- `CONV = 'waMeta/agentConv'`, `CONV_TTL_MS = 30*60*1000`
- `lgAgentDecide({rec, orders, conv, now}) → {actions: Action[], conv: object|null}` — טהור. `Action` = `{type:'reply', text}` | `{type:'staff', text}` | `{type:'cancel', orderId}` | `{type:'files', files}`.
- `lgAgentAct(db, key, {env, now, fetchImpl}) → Promise<{acted, actions}>` — קורא רשומה+conv+הזמנות, מחליט, ואם מותר (Global Constraints) מכניס לתור ב-`lgAgentEnqueue` עם `key = <recordKey>_<i>`, ומבצע ביטול (Task 3). תמיד כותב ברשומה `wouldAct: actions` ו-`acted: true|false`.

**התנהגות (טבלה):**
| מצב | פעולה |
|---|---|
| route `okev`, intent `status`, match one | reply: נוסח עוקב |
| match many | reply: רשימה; conv `{await:'which', intent, orderIds}` |
| conv `which` + הלקוח עונה מספר ברשימה (1..n) או שם | ממשיך את ה-intent על ההזמנה שנבחרה |
| intent `cancel`, ניתן | reply: "בטוח לבטל…?"; conv `{await:'confirm-cancel', orderId, at}` |
| conv `confirm-cancel` + "כן"/"בטוח"/"כן תבטל" (≤30 דק') | cancel + reply `ההזמנה בוטלה` |
| conv `confirm-cancel` + "לא" | reply `בסדר, ההזמנה ממשיכה`; conv נמחק |
| intent `change`, ניתן | reply "מה בדיוק לשנות…?"; conv `{await:'change-details', orderId}` |
| conv `change-details` + תשובה | staff: `שינוי בהזמנה <L> (<סקיצה>) של <לקוח>: <טקסט>` + reply `העברנו לשאול, הוא יחזור אליך` |
| cancel/change לא ניתן | reply לפי עוקב |
| route `menu` | reply `AGENT_MENU_TEXT` |
| route `shaul` (unclear/לא מקושר/כועס) | staff: `<לקוח/מספר>: <טקסט>`; reply `העברנו לשאול, הוא יחזור אליך` — **ללא-מקושר: רק staff, בלי reply** |
| `silent-human`, `ignore`, `none` | אין פעולה |

- **הכרעה:** שינוי מידה/סקיצה מועבר לשאול עם הפרטים (לא עריכה אוטומטית) — עריכה אוטומטית של מידות מטקסט חופשי מסוכנת יותר מהחיסכון בשלב הזה.
- [ ] **Step 1: failing tests** לכל שורה בטבלה, ל-Review Focus 2 ו-4, ולפיילוט: לקוח לא בפיילוט → `acted:false`, `wouldAct` מלא, אין רשומה בתור; `AGENT_REPLY_ENABLED` כבוי → אותו דבר; פעולה נכתבת פעם אחת גם אם `lgAgentAct` נקרא פעמיים.
- [ ] **Step 2:** FAIL. **Step 3: implement.** **Step 4:** PASS + `test-agent-shadow.js`, `test-agent-okev.js`.
- [ ] **Step 5: commit** `agents: מרכזן ועוקב עונים בפועל ללקוחות פיילוט — בירור הזמנה, אישור ביטול, העברה לשאול`

### Task 3: ביטול הזמנה + "הזמנות לטיפול"

**Files:** Modify `api/_agent-act.js` (`lgAgentCancel`), `hs-corrections.html`, `api/wa-inbound-drain.js` (פעולה `agent-cancel-done`); Test `scripts/test-agent-cancel.js`

**Interfaces — Produces:** `lgAgentCancel(db, orderId, {customerId, chatId, now}) → Promise<{ok, code}>` — בטרנזקציה על `orders/<id>`: ההזמנה קיימת, `customerId` תואם, השלב עדיין מותר (Review Focus 3); ואז עדכון רב-נתיבי אחד: `orders/<id>=null`, `waMeta/agentCancels/<id> = {order, at, chatId, hsSent: !!(order.hsOrder && order.hsOrder.sentAt && !order.hsOrder.simulated), done:false}`. `sketches/<id>` נשאר.
- hs-corrections.html: מקטע "ביטולים מהסוכן" (קורא `waMeta/agentCancels`, רק `hsSent && !done`), שורה: מספר הזמנה, לקוח, שם סקיצה, תאריך, כפתור "בוצע בחשבשבת" → POST `agent-cancel-done {key}` לנקודת ה-drain הקיימת (מאחורי אדמין) שכותב `done:true, doneAt, doneBy`.
- [ ] tests: ביטול תקין; לקוח אחר → `forbidden`; שלב `workday` → `too-late`; כבר בוטל → `missing`; `hsSent` נגזר נכון; `agent-cancel-done` בלי אדמין נדחה; תצוגה ב-hs-corrections (בדיקת vm כמו `scripts/test-hs-corrections*.js` אם קיים, אחרת בדיקת פונקציית רינדור טהורה).
- [ ] FAIL → implement → PASS → commit `agents: ביטול מהסוכן — ההזמנה יורדת מהממשק ונכנסת לביטולים לטיפול בחשבשבת`

### Task 4: פאנל — פיילוט ומה נעשה בפועל

**Files:** Modify `wa-inbound-panel.js`, `api/wa-inbound-drain.js` (פעולה `agent-pilot {customerId, on}` → `waMeta/agentPilot/<id>`), admin.html CSS; Test `scripts/test-agent-panel.js`
- בלשונית "סוכנים · ניסיון": בכל שורה של לקוח מקושר — מתג "פיילוט: כן/לא" ללקוח; שורה שנשלחה בפועל מציגה "נשלח ✓" במקום "היה עונה:"; שורה שמחכה בתור — "בתור"; שורה עם `state` לא `done` מציגה את המצב (received/failed). כותרת: כמה לקוחות בפיילוט.
- [ ] tests + FAIL → implement → PASS → commit `agents: פאנל — הדלקת פיילוט ללקוח, ומה נשלח בפועל`

### Task 5: ארכיון — העתק חשבונית וסקיצה

**Files:** Create `api/_agent-archive.js`; Modify `api/_agent-act.js` (route `archive`); Test `scripts/test-agent-archive.js`

**Interfaces — Produces:** `lgArchiveFind(db, {customerId, ref, text}) → Promise<{kind:'invoice'|'sketch'|'none', invoiceKey?, docNumber?, orderIds?, orderId?}>`
- "חשבונית 34472" / "חשבונית ריכוז 34472": `invoicePdf` לפי `docNumber` (יש אינדקס), `state==='ready'`, `accountKey===customerId`. אם הטקסט מבקש גם סקיצות ("עם הסקיצות") — מוסיפים `sketch` לכל `orderIds`.
- "סקיצה להזמנה 4334": `lgOkevFind` על הזמנות הלקוח (פתוחות + שנאספו) → `sketch`.
- לא נמצא / לא שלו / לא ready → staff `ביקשו <חשבונית/סקיצה> <ref> — לא נמצא אצל <לקוח>` + reply `אני בודק ואחזור אליך`.
- נמצא → files + reply `מצורף` .
- [ ] tests כולל Review Focus 5; FAIL → implement → PASS → commit `agents: ארכיון — העתק חשבונית וסקיצה ללקוח, רק מהתיק שלו`

### Task 6: מחירון — הצעה מטקסט, סקיצה לשאול והחזרה ללקוח

**Files:** Create `api/_agent-quote.js`; Modify `api/_agent-act.js`, `api/_agent-shadow.js` (הודעה משאול); Test `scripts/test-agent-quote.js`

**Interfaces — Produces:**
- `lgQuoteExtract({text, catalog, model, key, fetcher}) → Promise<{items:[{sku, w, h, qty, holes, cutouts}], ok}>` — קריאת מודל אחת (json_schema, אותו דפוס כמו `_agent-classify.js`, לא זורק). מק"ט רק מתוך `catalog` שמועבר (אותו סינון כמו `catalogForModel`); מידות בס"מ.
- `lgQuotePrice({items, catalog, clientPrices, globalPrices}) → {lines:[{sku,name,w,h,qty,area,ppm2,extras,total}], net, vat, gross, missing:[sku]}` — טהור, לפי Global Constraints. סוג עיבוד מ-`catalog[sku].proc` (`chisum`→0.30, `litush`→0.20, אחר→0.20). תוספות רק כש-`catalog[sku].glass==='מראה'`.
- `lgQuoteText(priced) → string` — שורה לפריט `<שם> <w>×<h> × <qty> — <total> ₪`, ואז `סה"כ לפני מע"מ`, `מע"מ 18%`, `סה"כ`.
- טקסט עם `missing` או `ok:false` → שאול.
- **סקיצה + intent quote:** reply `קיבלנו, נחזור אליך עם מחיר`; staff: העברת ההודעה המקורית (`{type:'forward', fromChat, idMessage}` → מתודת ספק חדשה `forward({to, fromChat, idMessages})` = GREEN API `forwardMessages` עם `{chatId, chatIdFrom, messages}`, מוסיפים ל-Task 1 את סוג הקובץ `{kind:'forward', fromChat, idMessage}`) ואחריה טקסט `בקשת מחיר #<n> — <לקוח>. נא לענות ב"השב" עם מחיר לכל פריט (ואם יש, מחיר כולל)`. נשמר `waMeta/agentQuotes/<n> = {customerId, chat, staffMessageId, at, state:'waiting'}`.
- **שאול עונה ב"השב":** הודעה נכנסת ממספר ב-`AGENT_STAFF_PHONES` עם `quotedId` = `staffMessageId` של בקשה ממתינה → reply ללקוח `הצעת מחיר:\n<טקסט של שאול>`, הבקשה `state:'answered'`. כל הודעה אחרת משאול → מתעלמים (Review Focus 1). הודעות צוות לא נכנסות לסיווג.
- תזכורת לשאול: בסיכום היומי (Task 8) — בקשות `waiting` מעל 3 שעות.
- [ ] tests (מודל מזויף): 8 שקוף 50×50 → שטח מינימום 0.2 (חתוך); מחוסם 40×40 → 0.3; מראה 100×80 עם 2 חורים ופינוי → +60; מחיר לקוח גובר על כללי; אין מחיר → שאול; Review Focus 1; תשובת שאול מועברת פעם אחת.
- [ ] FAIL → implement → PASS → commit `agents: מחירון — הצעת מחיר מטקסט לפי המחירון, סקיצה לשאול והחזרה ללקוח`

### Task 7: קולט — סקיצה שנמחקה

**Files:** Modify `api/_agent-shadow.js` (זיהוי מחיקה), `api/_agent-act.js`; Test `scripts/test-agent-deleted.js`
- זיהוי: `incomingMessageReceived` עם `messageData.typeMessage==='deletedMessage'`; המזהה של ההודעה שנמחקה מ-`messageData.deletedMessageData.stanzaId` או `extendedTextMessageData.stanzaId` או `messageData.stanzaId` (מה שקיים). רשומה עם `deletedId`.
- הזמנה עם `waMessageId===deletedId` של אותו לקוח:
  - שלב `''`/`pending` → `lgAgentCancel` בשקט (בלי הודעה ללקוח).
  - מותר לשנות (שאר השלבים המותרים) → reply `הסקיצה שמחקת כבר בטיפול אצלנו. לבטל אותה?` + conv `confirm-cancel` (Task 2 ממשיך).
  - אחרת → reply `הסקיצה שמחקת כבר בייצור, ואי אפשר לבטל אותה.`
  - אין הזמנה → אין פעולה.
- [ ] tests לשלושת המקרים + צורות payload שונות; FAIL → implement → PASS → commit `agents: קולט — סקיצה שנמחקה: מהתור יורדת לבד, בטיפול שואלים, בייצור מודיעים`

### Task 8: מנהל — סיכום יומי 15:00 + השלמת תור

**Files:** Create `api/_agent-daily.js`; Modify `api/wa-inbound.js` (ענף `?agent=daily`), `vercel.json` (rewrite `/api/agent-daily` → `/api/wa-inbound?agent=daily`, `crons: [{path:'/api/agent-daily', schedule:'0 13 * * *'}]`); Test `scripts/test-agent-daily.js`
- אימות: `Authorization: Bearer <CRON_SECRET>` (השוואה קבועת-זמן דרך `lgHookTokenOk`); בלי סוד מוגדר → 401.
- עושה: (1) `lgAgentSendPending` ו-`lgAgentShadowPending`+process (רשת ביטחון); (2) אם `AGENT_SHADOW_ENABLED` — בונה סיכום של 24 השעות האחרונות ושולח לכל מספר ב-`AGENT_SUMMARY_TO` דרך `lgAgentEnqueue` (צוות):
  ```
  סיכום סוכנים — <תאריך>
  הודעות שנכנסו: <n>
  נסגרו לבד: <n>
  הועברו לשאול: <n>
  הצעות מחיר שמחכות לשאול: <n> (<מספרים>)
  ביטולים שמחכים לחשבשבת: <n> (<מספרי הזמנות>)
  סומנו ✗ בפאנל: <n>
  ```
- הכרעה: 13:00 UTC = 15:00 שעון חורף; בשעון קיץ זה 16:00 — לעדכן ל-`0 12 * * *` במרץ.
- [ ] tests: בלי סוד → 401; סוד שגוי → 401; ספירות נכונות מנתוני דמה; כבוי → לא נשלח סיכום; `vercel.json` תקין (JSON, cron ו-rewrite קיימים).
- [ ] FAIL → implement → PASS → commit `agents: מנהל — סיכום יומי ב-15:00 לבן ולשאול, ורשת ביטחון לתור`

### Task 9: אימות כולל

- [ ] כל `scripts/test-agent-*.js`, `scripts/test-wa-*.js`, `scripts/test-whatsapp-*.js`, `scripts/test-greenapi-errors.js`, `scripts/test-devbrain-relay.js` עוברים.
- [ ] בדיקה בדפדפן (harness מקומי): לשונית הסוכנים עם פיילוט ו"נשלח ✓"; מקטע "ביטולים מהסוכן" ב-hs-corrections.
