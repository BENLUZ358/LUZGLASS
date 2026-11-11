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

// ─── שיחות (thread) ───────────────────────────────────────────────────
const TH = {
  t1: { at: NOW - 5 * H, agent: 'okev', kind: 'info', thread: 'ob:1', to: 'archive', step: 'handoff', text: 'חשבונית 67550 לא נשלחה' },
  t2: { at: NOW - 4 * H, agent: 'archive', kind: 'info', thread: 'ob:1', step: 'done', text: 'נשלח ✓' },
  t3: { at: NOW - 3 * H, agent: 'okev', kind: 'info', thread: 'wa:7', step: 'found', text: 'מוכן ל-L1240 נכשל פעמיים' },
  t4: { at: NOW - 2 * H, agent: 'okev', kind: 'ask', state: 'open', internal: true, thread: 'wa:7', step: 'need-ben', text: 'חסר טלפון', customerName: 'עוקב', question: 'חסר טלפון' },
  t5: { at: NOW - 1 * H, agent: 'price', kind: 'info', thread: 'sh:1', step: 'would', text: 'הייתי שולח שוב' },
  t6: { at: NOW - 30 * 60000, agent: 'kolet', kind: 'info', thread: 'self:1', step: 'found', text: 'סקיצה תקועה' },
  t7: { at: NOW - 29 * 60000, agent: 'kolet', kind: 'info', thread: 'self:1', step: 'done', text: 'שחררתי' },
};
const mix = Object.assign({}, room, TH);
const ths = J(ctx.lgRoomThreads(mix));
const tOf = id => ths.find(t => t.thread === id);
check('threads: rows grouped by thread, oldest first inside', tOf('ob:1').rows.map(r => r.key), ['t1', 't2']);
check('thread states', [tOf('wa:7').state, tOf('sh:1').state, tOf('self:1').state, tOf('ob:1').state], ['ben', 'would', 'done', 'done']);
check('a handoff-only thread is still open', J(ctx.lgRoomThreads({ t1: TH.t1 }))[0].state, 'open');
check('thread lastAt = newest row', tOf('wa:7').lastAt, TH.t4.at);
check('open threads (incl. open ask) come first, then newest first',
  ths.map(t => t.isOpen).join('') === ths.map(t => t.isOpen).sort().reverse().join('') && ths.every((t, i, a) => !a[i + 1] || a[i + 1].isOpen !== t.isOpen || a[i + 1].lastAt <= t.lastAt), true);
check('old rows without a thread: each its own thread', J(ctx.lgRoomThreads(room)).map(t => t.rows.length + t.rows[0].key).sort(), ['1k1', '1k2', '1k3', '1k4', '1k7']);
check('old open question is an open thread, old info is closed', [J(ctx.lgRoomThreads(room)).find(t => t.rows[0].key === 'k2').isOpen, J(ctx.lgRoomThreads(room)).find(t => t.rows[0].key === 'k1').isOpen], [true, false]);
check('filter by agent keeps threads that agent took part in', J(ctx.lgRoomThreads(mix, { agent: 'archive' })).map(t => t.thread).includes('ob:1'), true);
const one = ctx.lgRoomThreadHtml(ths.find(t => t.thread === 'self:1'), {});
check('same finder and owner → one line "מצאתי → עשיתי" joining both texts', [one.includes('מצאתי → עשיתי'), one.includes('סקיצה תקועה'), one.includes('שחררתי'), (one.match(/class="rb /g) || []).length], [true, true, true, 1]);
const hand = ctx.lgRoomThreadHtml(ths.find(t => t.thread === 'ob:1'), {});
check('handoff between agents: two bubbles, "← ארכיון" on the sender, ✓ נפתר', [(hand.match(/class="rb /g) || []).length, hand.includes('← ארכיון'), hand.includes('נפתר')], [2, true, true]);
const ben = ctx.lgRoomThreadHtml(ths.find(t => t.thread === 'wa:7'), {});
check('need-ben thread: ⚠ label and the close button', [ben.includes('צריך את בן'), /data-roomclose="t4"/.test(ben)], [true, true]);
check('would thread: ⏸ label', ctx.lgRoomThreadHtml(ths.find(t => t.thread === 'sh:1'), {}).includes('הייתי עושה'), true);
check('single old row renders as its plain bubble (no thread chrome)', ctx.lgRoomThreadHtml(J(ctx.lgRoomThreads({ k1: room.k1 }))[0], {}).includes('class="rt'), false);
check('after-bubble hook is called per row', ctx.lgRoomThreadHtml(ths.find(t => t.thread === 'ob:1'), {}, r => '<i>' + r.key + '</i>').includes('<i>t2</i>'), true);
check('bubble shows "← name" only when to is set', [ctx.lgRoomBubbleHtml(Object.assign({ key: 'a' }, TH.t1), {}).includes('← ארכיון'), ctx.lgRoomBubbleHtml(Object.assign({ key: 'a' }, TH.t2), {}).includes('←')], [true, false]);
const days = J(ctx.lgRoomDayGroups(ths.filter(t => !t.isOpen), NOW));
check('closed threads folded per day', days.length >= 1 && days.every(d => d.label && d.threads.length), true);
check('today labelled "היום"', days[0].label.includes('היום'), true);

// ─── תיקון סקירה: סינון לפי סוכן לא שובר מצב שיחה ───────────────────────
const fth = J(ctx.lgRoomThreads(mix, { agent: 'okev' })).find(t => t.thread === 'ob:1');
check('filtered handoff thread keeps ALL rows and stays closed', [fth.rows.length, fth.state, fth.isOpen], [2, 'done', false]);
check('filtered handoff thread still shows ✓ נפתר', ctx.lgRoomThreadHtml(fth, {}).includes('נפתר'), true);
const fself = J(ctx.lgRoomThreads(mix, { agent: 'kolet' })).find(t => t.thread === 'self:1');
check('filtered found+done keeps the one-line form', ctx.lgRoomThreadHtml(fself, {}).includes('מצאתי → עשיתי'), true);
const closedBen = J(ctx.lgRoomThreads({ a: TH.t3, b: Object.assign({}, TH.t4, { state: 'answered', answeredBy: 'ben' }) }))[0];
const cbH = ctx.lgRoomThreadHtml(closedBen, {});
check('closed need-ben thread: ✓ נפתר, not ⚠', [closedBen.isOpen, cbH.includes('נפתר'), cbH.includes('צריך את בן')], [false, true, false]);
const manyT = J(ctx.lgRoomThreads(mix));
const win = ctx.lgRoomThreadWindow(manyT, 2);
check('window counts threads, never splits one', [win.length, win.every(t => t.rows.length === manyT.find(x => x.thread === t.thread && x.rows[0].key === t.rows[0].key).rows.length)], [2, true]);

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
check('I4: internal open question has a "סגור" button', [/data-roomclose="w1"/.test(inOpen), inOpen.includes('>סגור<')], [true, true]);
check('I4: closed by Ben → "סגרת ✓"', ctx.lgRoomBubbleHtml({ key: 'w1', at: NOW, agent: 'archive', kind: 'ask', state: 'answered', answeredBy: 'ben', internal: true, text: 'x' }, {}).includes('סגרת ✓'), true);
check('I4: agents.html sends agent-room-close on the button', /data-roomclose/.test(fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8')) && /agent-room-close/.test(fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8')), true);
check('internal question closed by itself → "תוקן ✓"', [inDone.includes('תוקן ✓'), inDone.includes('ענית')], [true, false]);
check('office tool: never heard', J(ctx.lgAdWatcherLine({}, NOW)), { state: 'never', text: 'כלי החשבוניות במשרד: עוד לא שלח דופק' });
check('office tool: working', J(ctx.lgAdWatcherLine({ OFFICE: { at: NOW - 1 * M, pending: [] } }, NOW)), { state: 'ok', text: 'כלי החשבוניות במשרד: עובד' });
check('office tool: working, files waiting', ctx.lgAdWatcherLine({ OFFICE: { at: NOW - 1 * M, pending: [{ name: 'a.pdf', ageSec: 30 }, { name: 'b.pdf', ageSec: 5 }] } }, NOW).text,
  'כלי החשבוניות במשרד: עובד · 2 קבצים מחכים');
check('office tool: silent', J(ctx.lgAdWatcherLine({ A: { at: NOW - 50 * M }, B: { at: NOW - 7 * M } }, NOW)), { state: 'silent', text: 'כלי החשבוניות במשרד: לא ענה 7 דקות' });

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll agents-room-ui checks passed.');
