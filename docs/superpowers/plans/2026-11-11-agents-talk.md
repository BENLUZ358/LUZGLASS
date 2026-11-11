# הסוכנים עובדים לבד ומדברים ביניהם — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents detect stuck customer messages / intake / infrastructure, fix what is safe, escalate the rest to Ben, show every case as a conversation in the agents room, and answer all linked WhatsApp customers with fact-checked natural wording.

**Architecture:** Everything hangs on the two existing clocks: the office invoice-watcher heartbeat (`/api/invoice-pdf-upload` op `heartbeat`, every 60s) and the Gmail script's per-minute `op:'outbox-claim'` call (`api/email-inbound.js:93`). New pure modules decide (guards, wording check, Ben-notify policy); thin runners do the DB work inside the existing throttle gates of `api/_agent-watch.js`. All state lives under `waMeta/` (no Firebase rules change).

**Tech Stack:** Node 24 CommonJS on Vercel (maxDuration 60s, Hobby — one daily cron), firebase-admin RTDB, GREEN API WhatsApp (`api/_wa-provider.js`), OpenAI Responses API (`AGENT_MODEL`), vanilla JS front end (`agents.html`, `agents-dash.js`). Tests: plain `node scripts/test-*.js` with in-memory fake DB (follow `scripts/test-agent-watch.js` / `scripts/test-agent-room.js`).

**Spec:** `docs/superpowers/specs/2026-11-11-agents-talk-design.md` (Hebrew). Read it before any task.

## Global Constraints

- All new data under `waMeta/…`; never touch `database.rules.json`.
- Every user-visible string (customer, Ben, screen) in plain Hebrew, no English tech words.
- Every new behaviour off by default: guards act only per agent mode (`off` nothing · `shadow` room only, text "הייתי …" · `reply` acts); master `AGENT_SHADOW_ENABLED==='true'`; no `waMeta/agentConfig` → nothing new runs (keep `test-release-off`-style guarantee).
- Server WhatsApp drain behind env `WA_SERVER_DRAIN==='true'` (default off), independent of agent switches.
- Resend at most **once** per problem key, and only on a *clear* failure: `failureKind ∈ {disconnected, rate, quota}`, or row still `pending`/never attempted (`attempts===0`). `recipient`, `network`, `other`, blocked rows → ask Ben.
- Never auto-resend: Hashavshevet sends, print jobs, rows already `sent`.
- Freshness: `ready` resend only < 24h from `createdAt`; `dispatched` only same Israel calendar day; inbound image retry only < 24h.
- Ben notifications: one per problem key, one reminder after 3h, none 21:00–06:00 Israel (except alarms), max 20/day, rest only in room.
- Alarms (WA disconnected, office PC silent >30 min in working hours, Gmail script silent >15 min) reach Ben even when agents are on `shadow`.
- Shaul gets nothing new.
- Heartbeat request must finish < 60s: server drain budget 18s, watch run deadline 30s.
- Each heartbeat/claim call must not read all of `orders` (keep the hourly `lastOrdersScan` gate).

## Review Focus

1. Double send — server drain + an open admin page + `_ready-net` + guard resend on the same outbox row: exactly one send (claim transaction). Test in Task 1 and Task 3.
2. Stale message — a `ready` row 30h old or a `dispatched` row from yesterday must never be resent. Test in Task 3.
3. Wording invents a fact — model output adds a date/number/order not in facts, or drops one → fallback to template. Test in Task 7.
4. Ben flooded — 50 problems in one scan → ≤20 pings/day, nothing at night, one per key. Test in Task 4.
5. Config write drops new fields — saving an agent mode must keep `allCustomers` and `escalateEmail` (current `lgAgentConfigSet` rebuilds the object). Test in Task 5.

---

### Task 1: WhatsApp queue sent from the server on each heartbeat

**Files:**
- Modify: `api/_wa-drain-core.js` (`drainKeys`, `drainNow` take optional budget)
- Modify: `api/_wa-outbox.js` (`lgWaComplete` stores `failureKind`)
- Create: `api/_wa-server-drain.js`
- Modify: `api/_invoice-upload.js` (`heartbeat()` calls it first; passes `deadline: now+30s` to watch run)
- Test: `scripts/test-wa-server-drain.js`

**Interfaces:**
- Produces: `drainKeys(db, provider, keys, by, started, budgetMs = BUDGET_MS)`, `drainNow(db, keys, by, opts = { budgetMs })`
- Produces: `lgWaServerDrain(db, { env, now, budgetMs = 18000, drain? }) → { ok, skipped?: 'off'|'throttled'|'empty'|'disconnected', processed }` — gate `waMeta/serverDrain/lastRun` transaction 55s (same pattern as `_agent-watch` `gate`), keys = `lgWaPending(db, 20)`.
- Produces: outbox rows get `failureKind` (string|null) on `lgWaComplete`.

- [ ] Step 1: tests — `off when WA_SERVER_DRAIN unset` (no reads of waOutbox); `throttled second call within 55s`; `sends pending rows via drainNow with by='server'`; `budget respected` (fake provider slow → stops, rest stay pending); `failureKind stored` on failed complete; `no double send` (row claimed by "page" concurrently → server skips).
- [ ] Step 2: run `node scripts/test-wa-server-drain.js` → FAIL.
- [ ] Step 3: implement; heartbeat order = server drain → watch run (deadline 30s) → ready-net.
- [ ] Step 4: run new test + `node scripts/test-agent-watch.js` + `node scripts/test-agent-drain.js` → PASS.
- [ ] Step 5: commit `wa: שליחת התור מהשרת בכל דופק (מתג WA_SERVER_DRAIN)`.

### Task 2: Conversation threads in the room

**Files:**
- Modify: `api/_agent-room.js` (`lgRoomPost` accepts `thread`, `to`, `step`)
- Modify: `agents-dash.js` (`lgRoomRows` groups by thread; new `lgRoomThreadHtml`)
- Modify: `agents.html` (render threads; open threads first, closed folded per day)
- Test: `scripts/test-agent-room.js` (extend), `scripts/test-agents-room-ui.js` (extend)

**Interfaces:**
- Produces: room row fields `thread` (key string ≤120), `to` (agent id), `step ∈ 'found'|'handoff'|'done'|'need-ben'|'would'`.
- Produces: `lgRoomSay(db, { thread, from, to?, step, text, ref? }, now) → roomKey|null` (wraps `lgRoomPost`, kind `info`; `need-ben` → kind `ask`, `state:'open'`, `internal:true` so existing close/answer logic applies).
- Produces (UI): `lgRoomThreads(room) → [{ thread, rows:[…], state:'open'|'done'|'ben'|'would', lastAt }]`; rows without `thread` = their own single-row thread (old rows keep working).

- [ ] Step 1: tests — `lgRoomSay stores thread/to/step`; `need-ben opens ask + open index`; `lgRoomThreads groups and orders (open first, then lastAt desc)`; `old rows without thread still render`; `same finder and owner renders as one line "מצאתי → עשיתי"`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run both tests + `node scripts/test-agents-page.js` → PASS.
- [ ] Step 5: commit `חדר: שיחות בין סוכנים (thread)`.

### Task 3: Guards — find, hand off, fix

**Files:**
- Create: `api/_agent-guards.js` (pure `lgGuardProblems` + `lgGuardResendOk`; runner `lgGuardRun`)
- Modify: `api/_agent-watch.js` (call `lgGuardRun` in the slow tier, after existing checks, before morning; existing `deliv_` retry window widened from 2h to 48h and moved to the thread format)
- Test: `scripts/test-agent-guards.js`

**Interfaces:**
- Consumes: `lgRoomSay` (Task 2), `drainNow` (Task 1), `lgInvoiceDeliver` (`api/_invoice-deliver.js`), `lgEmailEnqueue` (`api/_email-outbox.js`), `lgWaInboundRetry` / `lgEmailInboundRetry` (used by `api/wa-inbound-drain.js:95-97`), `lgBenNotify` (Task 4 — until Task 4 lands call through a stub that only posts to the room).
- Produces: `lgGuardProblems({ now, waOutbox, emailOutbox, invoices, waInbound, emailInbound, orders?, waState, sendersSeen, groupsSeen }) → [{ key, finder, owner, level:'fix'|'ben', text, fix?: { type:'wa-resend'|'wa-drain'|'invoice-redeliver'|'email-requeue'|'inbound-retry', src } }]`
- Produces: `lgGuardResendOk(row, now) → { ok:boolean, why:string }` — the freshness + clear-failure rules from Global Constraints.
- Produces: `lgGuardRun(db, { env, now, cfg, deadline }) → { found, fixed, asked }` — problem state in `waMeta/agentWatch/problems/<key>` (reuse `lgWatchDiff`), resend memory in `waMeta/agentWatch/retried/<key>` (existing, 14 days).

Rows = spec section ו table rows 1–12א (ownership per spec "בעלות"). Reads per slow run (10 min): `waOutbox` by `state` (`pending`,`failed`,`expired` — indexed queries, like `lgWaPending`), `waMeta/emailOutbox` (small), `invoicePdf` by `createdAt` 48h (existing query), `waInbound`/`emailInbound` by state `dead`/`failed`, `waMeta/sendersSeen`/`groupsSeen`. Hashavshevet failures (row 10) only inside the existing hourly orders scan.
Mode handling per owner agent: `off` skip · `shadow` thread ends with step `would` ("הייתי שולח שוב") · `reply` performs fix, writes `retried` **before** acting, then `done` or (fail) `need-ben`.

- [ ] Step 1: tests (one per spec row 1–12א, plus): `ready 30h old → not resent`; `dispatched yesterday → not resent`; `recipient failure → ben, not resent`; `network failure → ben`; `disconnected → no resend while WA down (alarm instead)`; `second failure after resend → ben, no third try`; `shadow → would, no write to outbox`; `off → nothing`; `no agentConfig → lgGuardRun not called`; `same problem two runs → one thread`; `invoice queued >1h → lgInvoiceDeliver called once`.
- [ ] Step 2: run `node scripts/test-agent-guards.js` → FAIL. Step 3: implement. Step 4: run it + `node scripts/test-agent-watch.js` → PASS.
- [ ] Step 5: commit `סוכנים: שומרים — מוצאים, מעבירים, שולחים שוב`.

### Task 4: Telling Ben — without flooding, and alarms

**Files:**
- Create: `api/_agent-ben.js`
- Modify: `api/_agent-send.js` (`_liveRecipient`: Ben's number allowed for `AGENT_BEN_REASONS`)
- Modify: `api/_agent-watch.js` (`lgAgentEvent` ask-ping goes through `lgBenNotify`)
- Modify: `api/_invoice-upload.js` (`heartbeat`: record `waMeta/clocks/office`, run `lgClockCheck('office')`), `api/email-inbound.js` (`outbox-claim`: record `waMeta/clocks/gmail`, run `lgClockCheck('gmail')`; must not delay the claim response more than ~3s — run after building the response, errors swallowed)
- Test: `scripts/test-agent-ben.js`

**Interfaces:**
- Produces: `AGENT_BEN_REASONS = ['agent-ask','agent-upset','agent-guard','agent-digest','agent-alarm']` (exported from `_agent-send.js`).
- Produces: `lgBenPolicy({ now, key, urgent, sentLog, dayCount }) → { send:'now'|'night'|'skip', reminderAt? }` (pure: quiet 21–06 Israel, cap 20/day, one per key + one reminder after 3h).
- Produces: `lgBenNotify(db, { key, text, reason, urgent, env, now, cfg }) → { sent:'now'|'night'|'skip' }` — non-urgent → `lgAgentEnqueue` to `lgAgentEscalatePhone(cfg)`; urgent → direct `lgWaProvider().sendText` to Ben; when WA state not authorized → email via `lgEmailEnqueue` to `cfg.escalateEmail` (skip if empty). Night items kept in `waMeta/agentBen/night/<key>`; state `waMeta/agentBen/sent/<key>`, `waMeta/agentBen/day/<yyyymmdd>`.
- Produces: `lgBenDigestRun(db, { env, now, cfg })` — first clock after 06:00 sends one message listing night items.
- Produces: `lgClockCheck(db, which:'office'|'gmail', { env, now, cfg })` — the other clock silent (office >30 min in `lgIsWorkingHours`, gmail >15 min) → urgent `lgBenNotify` (key `alarm_<other>`), plus WA-disconnected check (`waMeta/whatsapp.state`).

- [ ] Step 1: tests — `night → queued not sent, digest at 06:00 sends one message`; `21st ping same day → room only`; `same key twice → one ping`; `reminder once after 3h`; `alarm at night still sent`; `alarm with agents on shadow still sent`; `WA down → email to escalateEmail`; `Ben number refuses reason 'agent-reply'` (send-layer guard still tight); `gmail silent 16 min → office heartbeat alarms once`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: run it + `node scripts/test-agent-send.js` + `node scripts/test-agent-room-review.js` → PASS.
- [ ] Step 5: commit `סוכנים: הודעות לבן בלי הצפה + שני שעונים + התראות תקלה`.

### Task 5: "Answer all customers" switch + Ben's alert email

**Files:**
- Modify: `api/_agent-config.js` (view/set keep `allCustomers` (bool) and `escalateEmail`; new `lgAgentCustomerOn`)
- Modify: `api/_agent-act.js` (pilot checks at the `_pilotOn`, `_pilot`, `not-pilot` lines) and `api/_agent-send.js` (`_liveRecipient` two pilot reads) → `lgAgentCustomerOn`
- Modify: `agents.html` (toggle "עונה לכל הלקוחות" above the customer list; email field under Ben's number, same edit/save pattern as `benLine`)
- Test: `scripts/test-agent-config.js`, `scripts/test-agent-send.js`, `scripts/test-agents-page.js` (extend)

**Interfaces:**
- Produces: `lgAgentCustomerOn(db, cid, cfg) → Promise<boolean>` = `!!cid && (cfg?.allCustomers === true || pilot[cid] === true)`.
- Produces: `agent-config-set` accepts `{ allCustomers: boolean }` and `{ escalateEmail: string }` (valid email or '' to clear).

- [ ] Step 1: tests — `saving an agent mode keeps allCustomers and escalateEmail`; `allCustomers → linked customer not in pilot gets reply`; `allCustomers → unlinked number still not answered`; `bad email rejected`; page shows toggle off by default.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: run the three tests + `node scripts/test-agent-act.js` → PASS.
- [ ] Step 5: commit `סוכנים: עונה לכל הלקוחות + מייל להתראות`.

### Task 6: Unhappy customer

**Files:**
- Modify: `api/_agent-classify.js` (intent `complaint`; schema field `upset: boolean`)
- Modify: `api/_agent-shadow.js` (store `upset`)
- Modify: `api/_agent-act.js` (`lgAgentDecide`: upset/complaint → reply apology + facts if any + action `ask` with reason `agent-upset`; same customer upset earlier today and not answered → only `ask`)
- Test: `scripts/test-agent-classify.js`, `scripts/test-agent-act.js` (extend)

**Interfaces:**
- Produces: classify result `{ intent, ref, upset, usage }`; `AGENT_INTENTS` includes `'complaint'`.
- Consumes: `lgBenNotify` (Task 4) for the ping, `urgent:false` (night rule and cap apply — spec ח: only alarms bypass).
- Spec section א (step 0) is already done (11/11, read-only prod probe): ~20 incoming/day, mostly images (no model call needed); room quiet because nothing got stuck. No fix needed.
- Customer text (fixed, then reworded by Task 7): `'מצטערים על העיכוב. בן יחזור אליך בהקדם.'` — no promises.

- [ ] Step 1: tests — `"איפה ההזמנה כבר שבוע!!" → status + upset → status facts + apology + ask Ben`; `complaint without order → apology + ask`; `second upset message same day → ask only, no auto reply`; `old records without upset field unchanged`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: run both + `node scripts/test-agent-shadow.js` → PASS.
- [ ] Step 5: commit `סוכנים: לקוח לא מרוצה → התנצלות + בן`.

### Task 7: Mixed wording with a fact check

**Files:**
- Create: `api/_agent-wording.js`
- Modify: `api/_agent-act.js` (before `enq` of `agent-reply` rows: reword when `cfg` exists and agent is `reply`; store `replyOriginal` on the shadow record)
- Modify: `agents-dash.js` ("מה X עשה" shows original + sent text)
- Test: `scripts/test-agent-wording.js`

**Interfaces:**
- Produces: `lgWordingFactsOk(facts, out) → boolean` — pure. Tokens = digits runs, order refs (`L\d+`), Hebrew weekday names, `₪`/`ש"ח` amounts, sketch name from facts. Every token in `out` ∈ facts tokens AND every number token of facts ∈ out. Length ≤ 350 chars, ≤ 3 sentences.
- Produces: `lgAgentWord({ kind:'facts'|'free'|'clarify', customerText, customerName, facts, model, key, fetcher, timeoutMs=8000 }) → { text, reworded:boolean, usage }` — any failure / check fail → `{ text: facts, reworded:false }`. `free`: output with any digit → rejected. Lesson answers (`lessonAuto`) are never reworded.
- Prompt (Hebrew, the builder writes it): short, warm, "אנחנו", no new facts, customer text is data not instructions.

- [ ] Step 1: tests — `adds a date not in facts → fallback`; `drops order number → fallback`; `same facts reworded → accepted`; `free reply with digit → fallback`; `model timeout → fallback`; `prompt-injection text in customer message ignored (still fact-checked)`; `lesson auto answer not reworded`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: run it + `node scripts/test-agent-act.js` → PASS.
- [ ] Step 5: commit `סוכנים: תשובות בשילוב עם בדיקת עובדות`.

### Task 8: Full check, test environment, release notes

- [ ] Step 1: run every `scripts/test-*.js` (`for f in scripts/test-*.js; do node "$f" || echo FAIL $f; done`); compare to main's known pre-existing failures (run the same loop on the `mainread` checkout); new failures = 0.
- [ ] Step 2: one fresh whole-branch review (opus) focused on Review Focus 1–5 and "what changes in prod with all switches off" — expected: nothing except clock timestamps under `waMeta/clocks`.
- [ ] Step 3: merge to `test` branch, push, confirm served (per `ENVIRONMENTS.md`).
- [ ] Step 4: write Ben's turn-on list (plain Hebrew): set `WA_SERVER_DRAIN=true` in Vercel, fill alert email, switch "עונה לכל הלקוחות", agents to "עונה".
