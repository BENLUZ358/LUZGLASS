#!/usr/bin/env node
/**
 * מסך הסוכנים מחדש + החדר (בן, 10/11) — הפונקציות הטהורות ב-agents-dash.js, ב-Node (vm).
 * Run: node scripts/test-agents-room-ui.js
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = { console, Date, Intl };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'agents-dash.js'), 'utf8'), ctx);
const J = x => JSON.parse(JSON.stringify(x));
const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 10, 0, 0);   // 12:00 בישראל

// ─── הסוכנים: מפתחות כמו בשרת (waMeta/agentConfig) ─────────────────────
check('six agents with the server keys', J(vm.runInContext('LG_AD_AGENTS', ctx)).map(a => a.id),
  ['markazan', 'kolet', 'archive', 'okev', 'price', 'manager']);
check('every agent has a one-line responsibility', J(vm.runInContext('LG_AD_AGENTS', ctx)).every(a => a.does && !a.does.includes('\n')), true);
check('agent key from Hebrew name or key', ['מרכזן', 'manager', 'עוקב', 'x'].map(ctx.lgRoomAgentKey), ['markazan', 'manager', 'okev', 'x']);
check('agent name', ['manager', 'מרכזן', ''].map(ctx.lgRoomAgentName), ['מנהל', 'מרכזן', 'סוכן']);

// ─── החדר ──────────────────────────────────────────────────────────────
const room = {
  k1: { at: NOW - 3 * H, agent: 'מרכזן', kind: 'info', text: 'נשלח לכהן: 2 סקיצות נקלטו' },
  k2: { at: NOW - 2 * H, agent: 'manager', kind: 'ask', state: 'open', text: 'כהן: יש לכם זכוכית חכמה?', customerName: 'כהן <זכוכית>',
        customerId: '777', question: 'יש לכם זכוכית חכמה?', suggest: 'כן, נבדוק מחיר' },
  k3: { at: NOW - 1 * H, agent: 'archive', kind: 'ask', state: 'answered', text: 'ביקשו חשבונית 5 — לא נמצא', customerName: 'לוי',
        question: 'חשבונית 5', note: 'ביקשו חשבונית 5 — לא נמצא', outboxKey: 'room_k3' },
  k4: { at: NOW - 50 * 60000, agent: 'archive', kind: 'answer', text: 'שלחתי במייל', replyTo: 'k3', by: '0547725552' },
  k5: { at: NOW - 4 * H, agent: 'manager', kind: 'summary', text: 'סיכום סוכנים — ישן' },
  k6: { at: NOW - 30 * 60000, agent: 'manager', kind: 'summary', text: 'סיכום סוכנים — 10.11.2026\nהודעות שנכנסו: 4' },
  k7: { at: NOW - 20 * 60000, agent: 'מרכזן', kind: 'ask', text: 'הצעתי לצרף גרפיקה ל-L1' },   // הצעת צרופה — לא שאלה לבן
};
check('open questions = ask with state open only', ctx.lgRoomOpenCount(room), 1);
check('open count of nothing', [ctx.lgRoomOpenCount(null), ctx.lgRoomOpenCount({})], [0, 0]);
check('room rows: oldest first, no summaries', J(ctx.lgRoomRows(room, {})).map(r => r.key), ['k1', 'k2', 'k3', 'k4', 'k7']);
check('room rows filtered by agent (key or Hebrew name)', [J(ctx.lgRoomRows(room, { agent: 'markazan' })).map(r => r.key),
  J(ctx.lgRoomRows(room, { agent: 'archive' })).map(r => r.key)], [['k1', 'k7'], ['k3', 'k4']]);
check('room rows limit keeps the newest', J(ctx.lgRoomRows(room, { limit: 2 })).map(r => r.key), ['k4', 'k7']);
check('latest summary', ctx.lgRoomLatestSummary(room).key, 'k6');
check('no summary', ctx.lgRoomLatestSummary({ a: room.k1 }), null);

const ob = { room_k3: { state: 'sent', text: 'שלחתי במייל' } };
const info = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k1' }, room.k1), ob);
check('info bubble: grey, agent name, no answer button', [/class="rb rb-info/.test(info), info.includes('מרכזן'), info.includes('data-roomanswer')], [true, true, false]);
const ask = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k2' }, room.k2), ob);
check('open question: yellow, customer, question, suggestion, ענה button',
  [/class="rb rb-ask is-open/.test(ask), ask.includes('כהן &lt;זכוכית&gt;'), ask.includes('יש לכם זכוכית חכמה?'), ask.includes('הצעה: כן, נבדוק מחיר'),
   /<button[^>]*data-roomanswer="k2"[^>]*>ענה<\/button>/.test(ask)], [true, true, true, true, true]);
check('customer name escaped', ask.includes('<זכוכית>'), false);
const done = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k3' }, room.k3), ob);
check('answered question: yellow, no ענה, says answered', [/rb-ask/.test(done), /is-open/.test(done), done.includes('data-roomanswer'), done.includes('ענית')],
  [true, false, false, true]);
const ans = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k4' }, room.k4), ob);
check('Ben\'s answer: own side, what was sent, delivery state', [/class="rb rb-answer/.test(ans), ans.includes('שלחתי במייל'), ans.includes('נשלח ✓')], [true, true, true]);
const blocked = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k4' }, room.k4), { room_k3: { state: 'blocked', lastError: 'הסוכן לא במצב "עונה"' } });
check('answer that was blocked says why', blocked.includes('לא נשלח: הסוכן לא במצב &quot;עונה&quot;'), true);
const att = ctx.lgRoomBubbleHtml(Object.assign({ key: 'k7' }, room.k7), ob);
check('attach suggestion (ask without state): not a question for Ben', [att.includes('data-roomanswer'), /rb-info/.test(att)], [false, true]);

// ─── כרטיסים ───────────────────────────────────────────────────────────
const shadow = {
  s1: { createdAt: NOW - H, linked: true, route: 'okev', state: 'done' },
  s2: { createdAt: NOW - H, linked: true, route: 'okev', state: 'done' },
  s3: { createdAt: NOW - H, linked: true, route: 'quote', state: 'done' },
  s4: { createdAt: NOW - 30 * H, linked: true, route: 'okev', state: 'done' },   // אתמול
  st: { createdAt: NOW - H, staff: true, route: 'staff' },
};
const cards = J(ctx.lgAgentCards(room, shadow, NOW));
const by = id => cards.find(c => c.id === id);
check('cards: today count per agent', [by('okev').today, by('price').today, by('markazan').today, by('archive').today], [2, 1, 5, 2]);
check('cards: waiting = open questions of that agent', [by('manager').waiting, by('archive').waiting, by('okev').waiting], [1, 0, 0]);

// ─── מתגים ─────────────────────────────────────────────────────────────
const cfg = { agents: { markazan: 'shadow', kolet: 'off', archive: 'reply', okev: 'reply', price: 'shadow', manager: 'shadow' } };
const sw = ctx.lgAdSwitchesHtml(cfg, true);
check('a switch per agent, three choices each', (sw.match(/data-agmode=/g) || []).length, 18);
check('current mode pressed', [/data-agent="okev" data-agmode="reply" aria-pressed="true"/.test(sw), /data-agent="kolet" data-agmode="off" aria-pressed="true"/.test(sw),
  /data-agent="okev" data-agmode="shadow" aria-pressed="true"/.test(sw)], [true, true, false]);
check('labels in Hebrew', ['כבוי', 'שקט', 'עונה'].every(t => sw.includes('>' + t + '<')), true);
check('master off → disabled with a warning', [/disabled/.test(ctx.lgAdSwitchesHtml(cfg, false)), ctx.lgAdSwitchesHtml(cfg, false).includes('מתג החירום')], [true, true]);
check('mode chip', [J(ctx.lgAdModeChip({ shadow: false }, cfg)), J(ctx.lgAdModeChip({ shadow: true }, cfg)),
  J(ctx.lgAdModeChip({ shadow: true }, { agents: { okev: 'shadow' } })), J(ctx.lgAdModeChip(null, cfg))],
  [{ text: 'כבויים', mode: 'off' }, { text: '2 עונים', mode: 'live' }, { text: 'מצב שקט', mode: 'shadow' }, { text: 'לא ידוע', mode: 'off' }]);

// ─── שורת היומן: שאלה לבן במקום שאול ─────────────────────────────────
check('route label for the "don\'t know" route', ctx.lgAgRouteLabel('shaul'), 'שאלה לבן');
const rv = ctx.lgAdReviewRowHtml('K', { linked: true, state: 'done', route: 'shaul', customerName: 'כהן', text: '?', wouldAct: [{ type: 'ask', question: '?' }] }, null, {});
check('review row says it asks Ben', rv.includes('הסוכן היה שואל אותך בחדר'), true);
check('outbox entries of a row include the line to Ben (_b)', J(ctx.lgAgOutboxOf('K', { K_0: { text: 'a' }, K_0_b: { text: 'b' }, K_1x: { text: 'c' } })).map(o => o.text), ['a', 'b']);

// ─── שלב ב׳: שאלה פנימית (בדיקות הדופק) + "כלי החשבוניות במשרד" ─────────
const M = 60 * 1000;
const inOpen = ctx.lgRoomBubbleHtml({ key: 'w1', at: NOW, agent: 'archive', kind: 'ask', state: 'open', text: 'שגיאת הדפסה', question: 'שגיאת הדפסה',
  customerName: 'כלי החשבוניות', note: 'פנימי — ייסגר לבד כשיתוקן', internal: true }, {});
check('internal question: yellow, no "answer" button (no customer to answer)', [/is-open/.test(inOpen), /data-roomanswer/.test(inOpen), inOpen.includes('מחכה לתיקון')], [true, false, true]);
const inDone = ctx.lgRoomBubbleHtml({ key: 'w1', at: NOW, agent: 'archive', kind: 'ask', state: 'answered', answeredBy: 'auto', internal: true, text: 'x', question: 'x' }, {});
check('internal question closed by itself → "תוקן ✓"', [inDone.includes('תוקן ✓'), inDone.includes('ענית')], [true, false]);
check('office tool: never heard', J(ctx.lgAdWatcherLine({}, NOW)), { state: 'never', text: 'כלי החשבוניות במשרד: עוד לא שלח דופק' });
check('office tool: working', J(ctx.lgAdWatcherLine({ OFFICE: { at: NOW - 1 * M, pending: [] } }, NOW)), { state: 'ok', text: 'כלי החשבוניות במשרד: עובד' });
check('office tool: working, files waiting', ctx.lgAdWatcherLine({ OFFICE: { at: NOW - 1 * M, pending: [{ name: 'a.pdf', ageSec: 30 }, { name: 'b.pdf', ageSec: 5 }] } }, NOW).text,
  'כלי החשבוניות במשרד: עובד · 2 קבצים מחכים');
check('office tool: silent', J(ctx.lgAdWatcherLine({ A: { at: NOW - 50 * M }, B: { at: NOW - 7 * M } }, NOW)), { state: 'silent', text: 'כלי החשבוניות במשרד: לא ענה 7 דקות' });

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll agents-room-ui checks passed.');
