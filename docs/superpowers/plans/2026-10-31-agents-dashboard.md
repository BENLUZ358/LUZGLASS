# לוח בקרה לסוכנים — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** דף `agents.html` שמרכז את עבודת הסוכנים: דורש טיפול, מספרים, יומן, מצב — ומחליף את לשונית "סוכנים · ניסיון" בקליטות.

**Architecture:** לוגיקה טהורה בקובץ `agents-dash.js` (נבדק ב-Node דרך vm, כמו `wa-inbound-panel.js`); הדף קורא `waMeta/*` בדפדפן וכותב רק דרך `/api/wa-inbound-drain` (שתי פעולות חדשות: `agent-status`, `agent-dismiss`). בלי שינוי חוקי Firebase.

**Tech Stack:** HTML/JS ללא build, Firebase RTDB compat 9.23, `lg-ui.css`, `lg-icons.js`, Vercel functions (Node).

**Spec:** `docs/superpowers/specs/2026-10-31-agents-dashboard-design.md`

## Global Constraints
- אין כתיבה ל-Firebase מהדפדפן; אין שינוי ב-`database.rules.json`.
- `agent-status` מחזיר בוליאנים בלבד — אף ערך של משתנה סביבה לא חוזר.
- כל טקסט מהנתונים עובר escaping (`lgEsc` / `_adEsc`).
- מטרות לחיצה ≥ 44px; עובד ברוחב 375 / 768 / 1280; RTL.
- אין פונקציה חדשה ב-`api/` (Vercel Hobby: 12 פונקציות) — הכל דרך `wa-inbound-drain.js`.

## Review Focus
1. רשומות חסרות שדות (אין `createdAt`, אין `customerName`, `wouldAct` לא מערך) → לא קורס, מציג "—". נבדק ב-Task 1.
2. פריט שהוסתר ואז השתנה (updatedAt חדש) → חוזר לרשימה. נבדק ב-Task 1.
3. "היום" סביב חצות שעון ישראל (22:30 UTC בחורף) → נספר ליום הנכון. נבדק ב-Task 1.
4. `agent-dismiss` עם kind לא מוכר / מפתח עם `/` או `.` → נדחה, לא נכתב כלום. נבדק ב-Task 2.
5. לשונית קליטות אחרי ההסרה — WhatsApp/מייל עובדים, אין מאזין ל-agentShadow. נבדק ב-Task 3.

---

### Task 1: `agents-dash.js` — לוגיקה טהורה

**Files:**
- Create: `agents-dash.js`
- Modify: `wa-inbound-panel.js` (העברת `LG_AG_*`, `lgAg*` מכאן ל-`agents-dash.js`; הסרת `agentsTab` והמאזינים ל-agentShadow/agentPilot/agentOutbox)
- Modify: `scripts/test-agent-panel.js` (טוען `agents-dash.js`; בדיקות הלשונית ב-admin עוברות ל-Task 3)
- Create: `scripts/test-agents-dash.js`

**Interfaces — Produces** (גלובליים בדפדפן, ב-vm בבדיקות):
- מועברים כמו שהם: `lgAgIntentLabel`, `lgAgRouteLabel`, `lgAgPilotCount`, `lgAgOutboxOf`, `lgAgActHtml`, `lgAgRowHtml`, `lgAgIntakeTaken` (+ `_adEsc`, `_adWhen` במקום `_waInEsc`, `_waInWhen`).
- `lgAdPeriodStart(period: 'today'|'7d'|'30d', now: number) → number` — 'today' = חצות Asia/Jerusalem.
- `lgAdCounts(shadow, quotes, cancels, from: number) → {incoming, selfClosed, toShaul, quotes, cancels, unlinked, ok, wrong, unmarked, accuracy: number|null, byRoute: {[route]: n}}` — הגדרות incoming/selfClosed/toShaul/unlinked כמו `lgAgentDailySummary` (בלי staff), אבל מ-`from`; quotes/cancels לפי `at`/`createdAt` ≥ from; accuracy = round(100·ok/(ok+wrong)) או null.
- `lgAdExceptions(d: {shadow, quotes, cancels, outbox, dismissed}, now) → [{kind, key, at, ver, title, detail, customerName, phone, red, link}]`, החדש למעלה. kinds: `quote` (state waiting/relaying; red אם now-at > 3h), `cancel` (confirmed && hsSent && !done; link `hs-corrections.html`), `send` (outbox blocked/failed, 7 ימים), `dead` (shadow `dead` או `failed` עם attempts ≥ 3), `unclear` (intent unclear && linked, 7 ימים), `wrong` (verdict.ok === false, 7 ימים). `ver` = updatedAt ‖ at ‖ createdAt. מוסתר אם `dismissed[kind+'_'+key].ver === ver`. phone = sender כשאין groupId.
- `lgAdLogRows(shadow, f: {route, q, verdict: 'all'|'none'|'ok'|'wrong'}, from) → rows[]` החדש למעלה.
- `lgAdMode(st: {shadow, reply, model, key, staff, summary, cron}) → {mode: 'off'|'shadow'|'live', problems: string[]}` — problems בעברית פשוטה, למשל `'אין מפתח OpenAI — הסוכנים לא מבינים הודעות'`.
- `lgAdWaLink(phone) → string` — `0501234567` → `https://wa.me/972501234567`; לא תקין → `''`.
- `LG_AD_AGENTS` — 6 סוכנים `{id, name, does, routes: string[]}` (מרכזן: כל ההודעות; עוקב: okev; ארכיון: archive; מחירון: quote; קולט: kolet, kolet-deleted; מנהל: סיכום).

- [ ] **Step 1:** כתוב `scripts/test-agents-dash.js` (אותו `check` כמו test-agent-panel) עם: today ב-22:30 UTC = יום חדש בישראל; counts על 6 רשומות (staff לא נספר, toShaul לפי `wouldAct` staff/quote-ask, accuracy 2✓1✗ → 67, ללא סימונים → null); כל kind של חריג מופיע; quote בן 4 שעות red, בן שעה לא; dismissed עם ver זהה מוסתר, ver שונה חוזר; רשומה בלי שדות לא קורסת; failed attempts 2 לא חריג, 3 כן; logRows סינון לפי route / שם / verdict; mode off/shadow/live + problem כשאין key; waLink.
- [ ] **Step 2:** `node scripts/test-agents-dash.js` → FAIL (הקובץ לא קיים).
- [ ] **Step 3:** צור `agents-dash.js`, העבר את פונקציות `lgAg*` מ-`wa-inbound-panel.js`, ממש את `lgAd*`. ב-panel: הסר `agentsTab`, את `tab==='agents'` ב-render ואת שלושת המאזינים. עדכן `test-agent-panel.js` לטעון את `agents-dash.js`.
- [ ] **Step 4:** `node scripts/test-agents-dash.js && node scripts/test-agent-panel.js && node scripts/test-wa-inbound-panel.js` → הכל עובר.
- [ ] **Step 5:** commit.

### Task 2: drain — `agent-status`, `agent-dismiss`

**Files:** Modify `api/wa-inbound-drain.js` (handleAdmin + כותרת), Test `scripts/test-agent-drain.js`.

**Interfaces:**
- `{action:'agent-status'}` → `{ok:true, status:{shadow, reply, model, key, staff, summary, cron}}` (כולם boolean, מ-`process.env`: AGENT_SHADOW_ENABLED==='true', AGENT_REPLY_ENABLED==='true', !!AGENT_MODEL, !!OPENAI_API_KEY, !!AGENT_STAFF_PHONES, !!AGENT_SUMMARY_TO, !!CRON_SECRET).
- `{action:'agent-dismiss', kind, key, ver}` → כותב `waMeta/agentDash/dismissed/<kind>_<key>` = `{ver:Number, at, by}`. kind ∈ quote|cancel|send|dead|unclear|wrong; key עובר `_keyOk`; ver מספר סופי. אחרת `{ok:false, code:'bad-kind'|'bad-key'|'bad-ver'}`.

- [ ] **Step 1:** בדיקות: status מחזיר רק 7 בוליאנים ושום מחרוזת מה-env (env עם ערך סודי → `JSON.stringify(res)` לא מכיל אותו); dismiss כותב את הנתיב; kind לא מוכר / key עם `/` / ver לא מספר → נדחה ו-db לא השתנה.
- [ ] **Step 2:** הרץ → FAIL. **Step 3:** ממש. **Step 4:** `node scripts/test-agent-drain.js` → PASS. **Step 5:** commit.

### Task 3: `agents.html` + תפריט admin + הסרת הלשונית

**Files:** Create `agents.html`; Modify `admin.html` (קישור "סוכנים" עם `<span id="navAgents">` אחרי "תיקון הזמנות"; הסרת כפתור `data-tab="agents"`; טעינת `agents-dash.js` ומונה once); Test `scripts/test-agents-page.js`.

**דף:** תבנית `hs-corrections.html` (פס עליון + חזרה). `lgRequireAuthAsync('admin')` → מאזינים: `waMeta/agentShadow` (`orderByChild('createdAt').startAt(now-30d)`), `agentQuotes`, `agentCancels`, `agentOutbox`, `agentPilot`, `agentDash/dismissed`, `waGroups`, `waSenders`; פעם אחת `agent-status`. ארבעה מקטעים לפי האפיון: דורש טיפול (כרטיסים, כפתור "טופל" → agent-dismiss, "פתח בוואטסאפ" כשיש phone, קישור לתיקון הזמנות ל-cancel); מספרים (בורר היום/7/30, אריחים, דיוק, שורת byRoute); יומן (סינון סוכן/חיפוש לקוח/סימון, `lgAgRowHtml`, "הצג עוד" 50, ✓/✗ → agent-verdict, פיילוט → agent-pilot); מצב (mode, problems באדום, 6 סוכנים עם מונה 7 ימים, רשימת פיילוט + "הוסף לפיילוט" מתוך waGroups/waSenders מקושרים). רשת: עמודה אחת עד 768, שתיים מעל (חריגים+מצב / מספרים+יומן).
**מונה admin:** בטעינה, `once` על quotes/cancels/outbox/dismissed + shadow 7 ימים → `lgAdExceptions(...).length` ב-`#navAgents` (ריק כש-0).

- [ ] **Step 1:** בדיקות מבנה (קריאת קבצים כמו test-agent-panel): agents.html טוען `agents-dash.js`, `firebase-db.js`, משתמש ב-`lgRequireAuthAsync('admin')`, קורא ל-`agent-status`/`agent-dismiss`/`agent-verdict`/`agent-pilot` רק דרך `_lgAuthPost('/api/wa-inbound-drain'`; אין `.set(`/`.update(`/`.push(`/`.remove(` על `_lgDb` בדף; admin.html מכיל `href="agents.html"` ו-`id="navAgents"`, ואין בו `data-tab="agents"`; wa-inbound-panel.js לא מאזין ל-`waMeta/agentShadow`.
- [ ] **Step 2:** FAIL. **Step 3:** ממש. **Step 4:** PASS + כל `scripts/test-agent-*.js`, `test-wa-inbound-panel*.js`, `test-order-normalizer.js`, `test-wa-sketch-ack.js`. **Step 5:** commit.

### Task 4: בדיקה חזותית ופריסה
- [ ] הרץ את הדף מול נתונים מזויפים (רתמת fake-Firebase מ-mobile-ui-audit, או stub של `_lgDb`) ב-375/768/1280; צילומי מסך; אין שגיאות בקונסול.
- [ ] merge ל-main, push (בן אישר פרודקשן ישירות), ובדיקה ב-luzglass.vercel.app/agents.html שהדף נטען.
