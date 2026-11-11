#!/usr/bin/env node
/** לוח הבקרה לסוכנים — הלוגיקה הטהורה (agents-dash.js). Run: node scripts/test-agents-dash.js */
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

const H = 60 * 60 * 1000, D = 24 * H;
// 31/10/2026 12:00 שעון ישראל (חורף, UTC+2) = 10:00 UTC
const NOW = Date.UTC(2026, 9, 31, 10, 0, 0);

// ─── תקופות ───────────────────────────────────────────────────────────
check('today starts at Israel midnight (22:00 UTC the day before)',
  new Date(ctx.lgAdPeriodStart('today', NOW)).toISOString(), '2026-10-30T22:00:00.000Z');
check('a message at 23:30 UTC is already "today" in Israel',
  ctx.lgAdPeriodStart('today', Date.UTC(2026, 9, 31, 23, 30)) === Date.UTC(2026, 9, 31, 22, 0), true);
check('7d and 30d are rolling', [ctx.lgAdPeriodStart('7d', NOW), ctx.lgAdPeriodStart('30d', NOW)], [NOW - 7 * D, NOW - 30 * D]);

// ─── מספרים ───────────────────────────────────────────────────────────
const sh = {
  a: { createdAt: NOW - H, linked: true, route: 'okev', acted: true, wouldAct: [{ type: 'reply' }], verdict: { ok: true } },
  b: { createdAt: NOW - H, linked: true, route: 'quote', acted: true, wouldAct: [{ type: 'quote-ask' }], verdict: { ok: true } },
  c: { createdAt: NOW - H, linked: true, route: 'shaul', acted: true, wouldAct: [{ type: 'staff' }], verdict: { ok: false } },
  d: { createdAt: NOW - H, linked: false, route: 'shaul' },
  e: { createdAt: NOW - H, staff: true, route: 'staff' },                // צוות — לא נספר
  f: { createdAt: NOW - 3 * D, linked: true, route: 'okev', acted: true }, // מחוץ ל"היום"
};
const quotes = { 1: { state: 'waiting', at: NOW - 4 * H }, 2: { state: 'answered', at: NOW - 2 * D } };
const cancels = { L1: { at: NOW - H, confirmed: true } };
const c = J(ctx.lgAdCounts(sh, quotes, cancels, ctx.lgAdPeriodStart('today', NOW)));
check('counts for today', [c.incoming, c.selfClosed, c.toShaul, c.unlinked, c.quotes, c.cancels], [4, 1, 2, 1, 1, 1]);
check('accuracy: 2 right, 1 wrong → 67%, 1 unmarked', [c.ok, c.wrong, c.accuracy, c.unmarked], [2, 1, 67, 1]);
check('per-agent counts', c.byRoute, { okev: 1, quote: 1, shaul: 2 });
// במצב שקט אף רשומה לא acted — הספירה לפי ההחלטה (state done), אחרת "היה נסגר לבד" תמיד 0
const quiet = {
  q1: { createdAt: NOW - H, linked: true, route: 'okev', state: 'done', acted: false, actReason: 'not-pilot' },
  q2: { createdAt: NOW - H, linked: true, route: 'shaul', state: 'done', acted: false, wouldAct: [{ type: 'staff' }] },
  q3: { createdAt: NOW - H, linked: false, route: 'shaul', state: 'done' },          // לא מקושר — רק נספר
  q4: { createdAt: NOW - H, linked: true, route: 'okev', state: 'processing' },      // עוד לא הוחלט
};
const cq = J(ctx.lgAdCounts(quiet, {}, {}, 0));
check('quiet mode: decisions still counted', [cq.incoming, cq.selfClosed, cq.toShaul, cq.unlinked], [4, 1, 1, 1]);
check('no marks → accuracy null, not 0', ctx.lgAdCounts({ x: { createdAt: NOW, linked: true } }, {}, {}, 0).accuracy, null);
check('broken records do not crash the counts',
  ctx.lgAdCounts({ x: null, y: { wouldAct: 'zz' }, z: {} }, null, undefined, 0).incoming, 2);

// ─── דורש טיפול ───────────────────────────────────────────────────────
const data = {
  shadow: {
    s1: { createdAt: NOW - H, updatedAt: NOW - H, state: 'dead', customerName: 'דנה' },
    s2: { createdAt: NOW - H, updatedAt: NOW - H, state: 'failed', attempts: 2 },
    s3: { createdAt: NOW - H, updatedAt: NOW - H, state: 'failed', attempts: 3 },
    s4: { createdAt: NOW - 2 * H, updatedAt: NOW - 2 * H, state: 'done', linked: true, intent: 'unclear', sender: '0501234567', groupId: '' },
    s5: { createdAt: NOW - 2 * H, updatedAt: NOW - 2 * H, state: 'done', linked: false, intent: 'unclear' },
    s6: { createdAt: NOW - 3 * H, updatedAt: NOW - 3 * H, state: 'done', linked: true, verdict: { ok: false }, groupId: 'g@g.us', sender: '0501234567' },
    s7: { createdAt: NOW - 9 * D, updatedAt: NOW - 9 * D, state: 'done', linked: true, intent: 'unclear' },   // ישן מ-7 ימים
  },
  quotes: { 7: { state: 'waiting', at: NOW - 4 * H, customerName: 'כהן' }, 8: { state: 'relaying', at: NOW - H }, 9: { state: 'answered', at: NOW - H } },
  cancels: { L5: { confirmed: true, hsSent: true, at: NOW - H, order: { orderNum: 'L5' } }, L6: { confirmed: true, hsSent: true, done: true, at: NOW } },
  outbox: { o1: { state: 'blocked', updatedAt: NOW - H }, o2: { state: 'sent', updatedAt: NOW }, o3: { state: 'failed', updatedAt: NOW - 8 * D } },
  dismissed: {},
};
const ex = J(ctx.lgAdExceptions(data, NOW));
const ids = ex.map(x => x.kind + ':' + x.key).sort();
check('every exception kind, and nothing else',
  ids, ['cancel:L5', 'dead:s1', 'dead:s3', 'quote:7', 'quote:8', 'send:o1', 'unclear:s4', 'wrong:s6']);
check('newest first', ex.every((x, i) => i === 0 || ex[i - 1].at >= x.at), true);
check('a quote waiting 4 hours is red, one waiting 1 hour is not',
  [ex.find(x => x.key === '7').red, ex.find(x => x.key === '8').red], [true, false]);
check('cancel links to hs-corrections', ex.find(x => x.kind === 'cancel').link, 'hs-corrections.html');
check('private chat carries a phone; a group does not',
  [ex.find(x => x.key === 's4').phone, ex.find(x => x.key === 's6').phone], ['0501234567', '']);
check('ver is the record\'s updatedAt', ex.find(x => x.key === 's1').ver, NOW - H);
const dis = Object.assign({}, data, { dismissed: { dead_s1: { ver: NOW - H }, quote_7: { ver: 123 } } });
const ex2 = J(ctx.lgAdExceptions(dis, NOW)).map(x => x.kind + ':' + x.key);
check('dismissed with the same ver stays hidden', ex2.includes('dead:s1'), false);
check('dismissed but changed since → comes back', ex2.includes('quote:7'), true);
check('empty data → no exceptions, no crash', J(ctx.lgAdExceptions({}, NOW)), []);
// סקירה 31/10: ביטול נסגר רק בתיקון הזמנות ("בוצע בחשבשבת") — אין לו "טופל", והסתרה לא חלה עליו
{
  const cx = J(ctx.lgAdExceptions(Object.assign({}, data, { dismissed: { cancel_L5: { ver: NOW - H } } }), NOW));
  const cn = cx.find(x => x.kind === 'cancel');
  check('a cancel cannot be dismissed — it stays until done in hs-corrections', [!!cn, cn && cn.dismissable], [true, false]);
  check('every other kind can be dismissed', cx.filter(x => x.kind !== 'cancel').every(x => x.dismissable === true), true);
}
// הצעת מחיר בלי updatedAt: waiting → relaying כותב relayAt. הסתרה של waiting לא מסתירה את ה-relaying שנתקע
{
  const q = { quotes: { 7: { state: 'relaying', at: NOW - 4 * H, relayAt: NOW - H } }, dismissed: { quote_7: { ver: NOW - 4 * H } } };
  check('a dismissed quote that moved to relaying comes back', J(ctx.lgAdExceptions(q, NOW)).map(x => x.key), ['7']);
  check('quote ver follows relayAt', J(ctx.lgAdExceptions({ quotes: q.quotes }, NOW))[0].ver, NOW - H);
}

// ─── יומן ─────────────────────────────────────────────────────────────
const log = {
  l1: { createdAt: NOW - H, route: 'okev', customerName: 'דנה כהן', verdict: { ok: true } },
  l2: { createdAt: NOW - 2 * H, route: 'quote', customerName: 'אביבי מטבחים' },
  l3: { createdAt: NOW - 3 * H, route: 'okev', customerName: 'טום גלאס', verdict: { ok: false } },
  l4: { createdAt: NOW - 40 * D, route: 'okev', customerName: 'ישן' },
};
const L = (f, from) => J(ctx.lgAdLogRows(log, f, from == null ? NOW - 30 * D : from)).map(r => r.key);
check('log: newest first, older than the period dropped', L({}), ['l1', 'l2', 'l3']);
check('log: by agent', L({ route: 'okev' }), ['l1', 'l3']);
check('log: by customer name', L({ q: 'אביבי' }), ['l2']);
check('log: by mark', [L({ verdict: 'none' }), L({ verdict: 'ok' }), L({ verdict: 'wrong' })], [['l2'], ['l1'], ['l3']]);

// ─── מצב ──────────────────────────────────────────────────────────────
const all = { shadow: true, reply: false, model: true, key: true, staff: true, summary: true, cron: true };
check('shadow only → shadow mode, no problems', J(ctx.lgAdMode(all)), { mode: 'shadow', problems: [] });
check('both on → live', ctx.lgAdMode(Object.assign({}, all, { reply: true })).mode, 'live');
check('shadow off → off', ctx.lgAdMode(Object.assign({}, all, { shadow: false })).mode, 'off');
check('missing OpenAI key → a plain-Hebrew problem',
  J(ctx.lgAdMode(Object.assign({}, all, { key: false })).problems), ['אין מפתח OpenAI — הסוכנים לא מבינים הודעות']);
check('no status yet → off, no crash', ctx.lgAdMode(null).mode, 'off');

// ─── קישור וואטסאפ וסוכנים ───────────────────────────────────────────
check('wa.me link', [ctx.lgAdWaLink('050-123-4567'), ctx.lgAdWaLink('12'), ctx.lgAdWaLink('')],
  ['https://wa.me/972501234567', '', '']);
check('six agents', J(vm.runInContext('LG_AD_AGENTS', ctx)).map(a => a.id), ['markazan', 'kolet', 'archive', 'okev', 'price', 'manager']);

// ─── שורת יומן בעברית פשוטה (בן, 31/10: "לא הבנתי מה רשום שם") ─────────
{
  const row = r => ctx.lgAgRowHtml('K', Object.assign({ linked: true, customerName: 'טום גלאס', state: 'done', createdAt: NOW }, r), null, { pilot: {}, outbox: {} });
  const img = row({ hasImage: true, text: '', intent: 'order', route: 'kolet', acted: false, actReason: 'no-action' });
  check('image without caption → "שלח תמונה"', img.includes('שלח תמונה'), true);
  check('kolet → plain outcome: went into the sketch queue', img.includes('נכנסה לתור הסקיצות'), true);
  check('no English codes on screen', [/no-action/.test(img), />kolet</.test(img)], [false, false]);
  check('what the agent understood is labelled', img.includes('הסוכן הבין:'), true);
  check('caption is shown with the image', row({ hasImage: true, text: 'מקלחון 90', intent: 'order', route: 'kolet' }).includes('מקלחון 90'), true);
  check('deleted message → "מחק הודעה"', row({ deleted: true, route: 'kolet-deleted' }).includes('מחק הודעה'), true);
  check('a text message is shown as said', row({ text: 'איפה ההזמנה?', intent: 'status', route: 'okev' }).includes('כתב: איפה ההזמנה?'), true);
  const un = ctx.lgAgRowHtml('K', { linked: false, route: 'shaul', state: 'done', actReason: 'no-action', createdAt: NOW }, null, {});
  check('unlinked → explained, no reply, not "לשאול"',
    [un.includes('מספר שלא מקושר'), un.includes('רק נספר'), un.includes('היה עונה:'), un.includes('no-action')], [true, true, false, false]);
  check('someone already answered → says so', row({ text: 'תודה', route: 'silent-human' }).includes('כבר ענה'), true);
  check('verdict buttons say what they mean', [row({ route: 'okev' }).includes('הבין נכון'), row({ route: 'okev' }).includes('טעה')], [true, true]);
}

// ─── יומן פשוט: רק מה שיש לבדוק, כשאלה אחת (בן, 31/10: "קצת מסובך למשתמש") ──
{
  const base = { linked: true, customerName: 'טום גלאס', state: 'done', createdAt: NOW };
  const R = o => Object.assign({}, base, o);
  const needs = [
    R({ text: 'כמה עולה מראה 80 על 60?', intent: 'quote', route: 'quote', wouldAct: [{ type: 'reply', text: '185 ש"ח + מע"מ' }] }),
    R({ text: 'איפה ההזמנה?', intent: 'status', route: 'okev', wouldReply: 'ההזמנה בחיסום' }),
    R({ text: '??', intent: 'unclear', route: 'shaul', wouldAct: [{ type: 'staff', text: 'לשאול' }] }),
    R({ text: 'שלום', intent: 'chitchat', route: 'menu', wouldReply: 'תפריט' }),
  ];
  const skip = [
    R({ hasImage: true, intent: 'order', route: 'kolet' }),          // תמונה רגילה — נכנסת לתור
    { linked: false, route: 'shaul', state: 'done', createdAt: NOW },  // לא מקושר
    R({ text: 'תודה', route: 'silent-human' }),                        // מישהו כבר ענה
    R({ text: 'תודה', intent: 'thanks', route: 'none' }),
    R({ text: 'x', route: 'okev', state: 'processing' }),              // עוד לא הוחלט
  ];
  check('needs review: what the agent would answer or pass to Shaul', needs.map(ctx.lgAdNeedsReview), [true, true, true, true]);
  check('no review: plain image, unlinked, already answered, nothing to say, undecided', skip.map(ctx.lgAdNeedsReview), [false, false, false, false, false]);

  const q = ctx.lgAdReviewRowHtml('K1', needs[0], null, { outbox: {} });
  check('review row: who, what they wrote, what the agent would answer, one question',
    ['טום גלאס', 'כתב: כמה עולה מראה 80 על 60?', 'הסוכן היה עונה:', '185 ש&quot;ח + מע&quot;מ', 'זה נכון?'].map(s => q.includes(s)), [true, true, true, true, true]);
  check('review row: two buttons כן / לא, no pilot button', [/data-agv="1"[^>]*>כן</.test(q), /data-agv="0"[^>]*>לא</.test(q), /data-agpilot/.test(q)], [true, true, false]);
  check('passed to Shaul → said in words', ctx.lgAdReviewRowHtml('K3', needs[2], null, {}).includes('הסוכן היה מעביר לשאול'), true);
  check('marked rows say what you chose', ctx.lgAdReviewRowHtml('K1', Object.assign({}, needs[0], { verdict: { ok: false } }), null, {}).includes('סימנת: לא נכון'), true);
  check('review row escapes text', ctx.lgAdReviewRowHtml('K', R({ text: '<img onerror=1>', route: 'okev', wouldReply: '<b>' }), null, {}).includes('<img'), false);

  const o = ctx.lgAdOtherRowHtml(skip[0]);
  check('the other rows: one short line, no buttons', [o.includes('טום גלאס'), o.includes('שלח תמונה'), /<button/.test(o)], [true, true, false]);
}

check('a record that failed for good reads in Hebrew, not "dead"',
  (() => { const h = ctx.lgAgRowHtml('K', { linked: true, state: 'dead' }); return [h.includes('נכשלה סופית'), />dead</.test(h)]; })(), [true, false]);

// ─── escaping בשורת יומן (הפונקציה עברה מהפאנל) ───────────────────────
check('row escapes customer text',
  ctx.lgAgRowHtml('K', { linked: true, customerName: '<b>x</b>', text: '<img onerror=1>', state: 'done' }).includes('<img'), false);

// ─── הודעה שסומנה יוצאת מ"לבדוק" (בן, 8/11: "סימנתי ... וזה לא עובר הלאה") ──
{
  const base = { linked: true, customerName: 'נאור', state: 'done', createdAt: NOW, route: 'okev', wouldReply: 'x' };
  const rows = [
    Object.assign({ key: 'a' }, base),
    Object.assign({ key: 'b' }, base, { verdict: { ok: true } }),
    Object.assign({ key: 'c' }, base, { verdict: { ok: false } }),
    { key: 'd', linked: true, state: 'done', createdAt: NOW, route: 'none' },
  ];
  const S = f => { const x = ctx.lgAdSplitLog(rows, f); return [x.todo.map(r => r.key), x.marked.map(r => r.key), x.other.map(r => r.key)]; };
  check('split: unmarked to check, marked ones aside, the rest folded', S('all'), [['a'], ['b', 'c'], ['d']]);
  check('split: no filter acts like "all"', S(undefined), [['a'], ['b', 'c'], ['d']]);
  check('split: filtering by a mark keeps marked rows in the main list (the filter already chose them)', S('ok'), [['a', 'b', 'c'], [], ['d']]);
}

// ─── מה כל סוכן עשה (בן, 11/11) ──────────────────────────────────────
{
  const R = ctx.lgActRange('today', NOW);
  const shA = {
    m1: { createdAt: NOW - H, linked: true, customerName: 'נאור', text: 'איפה ההזמנה?', route: 'okev', state: 'done', wouldReply: 'בחיסום, תצא מחר' },
    m2: { createdAt: NOW - 2 * H, linked: true, customerName: 'אגן', hasImage: true, route: 'kolet', state: 'done' },
    m3: { createdAt: NOW - 3 * H, linked: false, route: 'shaul', state: 'done' },
    m4: { createdAt: NOW - H, staff: true, route: 'staff', state: 'done' },                       // צוות — לא מוצג
    m5: { createdAt: NOW - 2 * D, linked: true, customerName: 'ישן', text: 'x', route: 'okev', state: 'done' }, // לא היום
    m6: { createdAt: NOW - 30 * 60 * 1000, linked: true, customerName: 'פלג', text: 'כמה עולה?', route: 'quote', state: 'done', verdict: { ok: false } },
  };
  const room = {
    r1: { at: NOW - 90 * 60 * 1000, agent: 'okev', kind: 'info', text: 'L1235 תקועה בחיסום 3 ימים' },
    r2: { at: NOW - 10 * 60 * 1000, agent: 'מנהל', kind: 'summary', text: 'סיכום בוקר' },
    r3: { at: NOW - 5 * 60 * 1000, agent: 'okev', kind: 'answer', text: 'תשובה של בן' },              // תשובה שלך — לא של הסוכן
    r4: { at: NOW - 20 * 60 * 1000, agent: 'markazan', kind: 'ask', state: 'open', customerName: 'נאור', question: 'מה זה?' },
  };
  const mk = J(ctx.lgAgentActivity('markazan', shA, room, R));
  check('markazan: every incoming message today + its room rows, newest first, no staff, no old',
    mk.map(x => x.key), ['r4', 'm6', 'm1', 'm2', 'm3']);
  check('markazan says where it routed', mk.filter(x => x.kind === 'msg').map(x => x.did),
    ['העביר למחירון', 'העביר לעוקב', 'נכנס לתור הסקיצות', 'רק נספר — לא עונים למספר לא מקושר']);
  check('open question shows waiting', mk[0].did, 'מחכה לתשובה שלך');
  const ok = J(ctx.lgAgentActivity('okev', shA, room, R));
  check('okev: only its messages + its room rows (not Ben\'s answer)', ok.map(x => x.key), ['m1', 'r1']);
  check('okev row says what it would answer, and can be marked', [ok[0].did, ok[0].review], ['היה עונה: בחיסום, תצא מחר', true]);
  check('marked row keeps its mark', J(ctx.lgAgentActivity('price', shA, room, R)).map(x => x.verdict), ['wrong']);
  check('manager: the summary', J(ctx.lgAgentActivity('manager', shA, room, R)).map(x => [x.key, x.what]), [['r2', 'סיכום בוקר']]);
  check('unknown agent → nothing', J(ctx.lgAgentActivity('nobody', shA, room, R)), []);
  const Y = ctx.lgActRange('yesterday', NOW);
  check('yesterday = the Israel day before today', [Y.to === R.from, Y.from < Y.to, R.from - Y.from], [true, true, D]);
  const yo = J(ctx.lgAgentActivity('okev', { y: { createdAt: R.from - H, linked: true, customerName: 'א', text: 't', route: 'okev', state: 'done' } }, {}, Y));
  check('yesterday shows yesterday only', yo.map(x => x.key), ['y']);
  check('7 days reaches 2 days back', J(ctx.lgAgentActivity('okev', shA, {}, ctx.lgActRange('7d', NOW))).map(x => x.key), ['m1', 'm5']);
  const html = ctx.lgActRowHtml({ key: 'k"1', at: NOW, kind: 'msg', who: '<b>x</b>', what: '<img onerror=1>', did: 'd', review: true, verdict: '' }, R.from);
  check('activity row escapes text', [html.includes('<img'), html.includes('<b>x'), html.includes('data-agv="1"')], [false, false, true]);

  //  תשובות בשילוב (spec ג): כל תשובה שנעטפה → "נוסח מקורי" מתחת, לכל אחת
  const FACTS = 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור';
  const F2 = 'לא מצאתי את ההזמנה. אפשר לכתוב את שם הסקיצה?';
  const shW = {
    w1: { createdAt: NOW - H, linked: true, customerName: 'כהן', text: 'מה עם ההזמנה?', route: 'okev', state: 'done', acted: true,
          wouldAct: [{ type: 'reply', text: FACTS }, { type: 'reply', text: F2 }],
          replyWords: [{ original: FACTS, sent: 'היי\n' + FACTS }, { original: F2, sent: 'היי\n' + F2 }] },
    w2: { createdAt: NOW - 2 * H, linked: true, customerName: 'כהן', text: 'מה עם ההזמנה?', route: 'okev', state: 'done', acted: true,
          wouldAct: [{ type: 'reply', text: FACTS }] },
  };
  const obW = { w1_0: { state: 'sent', reason: 'agent-reply', text: 'היי\n' + FACTS }, w2_0: { state: 'sent', reason: 'agent-reply', text: FACTS } };
  const aw = J(ctx.lgAgentActivity('okev', shW, {}, R, obW));
  check('wrapped replies: sent text + every original', aw.map(x => [x.did, x.origs || []]),
    [['ענה ללקוח: היי\n' + FACTS, [FACTS, F2]], ['ענה ללקוח: ' + FACTS, []]]);
  const hw = ctx.lgActRowHtml({ key: 'w', at: NOW, kind: 'msg', who: 'כהן', what: 'x', did: 'ענה', origs: ['<i>מקור</i>', 'שני'], review: false, verdict: '' }, R.from);
  check('row shows a "נוסח מקורי" line per reply, escaped', [hw.split('נוסח מקורי').length - 1, hw.includes('<i>'), hw.includes('&lt;i&gt;מקור')], [2, false, true]);
  check('row without original has no such line', ctx.lgActRowHtml({ key: 'w', at: NOW, kind: 'msg', who: 'כהן', what: 'x', did: 'ענה', review: false, verdict: '' }, R.from).includes('נוסח מקורי'), false);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll agents-dashboard checks passed.');
