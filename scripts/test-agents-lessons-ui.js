#!/usr/bin/env node
/**
 * חדר הסוכנים, שלב ג׳ — למידה במסך (בן, 11/11): הצעה עם אשר / תקן / ענה אחרת,
 * "עניתי לפי מה שאישרת" עם תקן, ו"מה הסוכנים למדו" (מקופל, עם מחק).
 * Run: node scripts/test-agents-lessons-ui.js
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
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const P = fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8');

// ─── הצעה על שאלה צהובה ────────────────────────────────────────────────
const prop = { key: 'k1', at: NOW, agent: 'markazan', kind: 'ask', state: 'open', customerName: 'כהן', question: 'יש זכוכית חכמה?',
  lessonId: 'L1', proposal: 'לא <מייצרים>', topic: 'זכוכית חכמה' };
const h = ctx.lgRoomBubbleHtml(prop, {});
check('proposal shown, escaped', [h.includes('אני מציע לענות: לא &lt;מייצרים&gt;'), h.includes('<מייצרים>')], [true, false]);
check('three buttons: אשר / תקן / ענה אחרת',
  [/<button[^>]*data-lessonok="k1"[^>]*>אשר<\/button>/.test(h), /<button[^>]*data-lessoncorrect="k1"[^>]*>תקן<\/button>/.test(h),
   /<button[^>]*data-roomanswer="k1"[^>]*>ענה אחרת<\/button>/.test(h)], [true, true, true]);
const plain = ctx.lgRoomBubbleHtml(Object.assign({}, prop, { lessonId: undefined, proposal: undefined }), {});
check('no proposal → the plain ענה button only', [/data-roomanswer="k1"[^>]*>ענה<\/button>/.test(plain), plain.includes('data-lessonok')], [true, false]);
const answered = ctx.lgRoomBubbleHtml(Object.assign({}, prop, { state: 'answered', outboxKey: 'room_k1' }), { room_k1: { state: 'sent' } });
check('answered proposal → no buttons', [answered.includes('data-lessonok'), answered.includes('ענית')], [false, true]);

// ─── תשובה אוטומטית ────────────────────────────────────────────────────
const auto = { key: 'a1', at: NOW, agent: 'markazan', kind: 'info', text: 'עניתי לפי מה שאישרת: זכוכית חכמה', lessonId: 'L1', lessonAuto: true,
  customerName: 'כהן', question: 'יש זכוכית חכמה?', proposal: 'לא', chat: 'c', customerId: '777', outboxKey: 'U1_0' };
const ah = ctx.lgRoomBubbleHtml(auto, {});
check('auto answer: grey line, customer + question, תקן button',
  [/rb-info/.test(ah), ah.includes('עניתי לפי מה שאישרת: זכוכית חכמה'), ah.includes('כהן'), ah.includes('יש זכוכית חכמה?'),
   /<button[^>]*data-autofix="a1"[^>]*>תקן<\/button>/.test(ah)], [true, true, true, true, true]);
check('can fix: auto line not yet fixed', [ctx.lgRoomCanFix(auto, {}), ctx.lgRoomCanFix(Object.assign({}, auto, { fixOutboxKey: 'fix_a1' }), { fix_a1: { state: 'sent' } }),
  ctx.lgRoomCanFix(Object.assign({}, auto, { fixOutboxKey: 'fix_a1' }), { fix_a1: { state: 'blocked' } }), ctx.lgRoomCanFix({ kind: 'info', text: 'x' }, {})],
  [true, false, true, false]);
const fixed = ctx.lgRoomBubbleHtml(Object.assign({}, auto, { fixOutboxKey: 'fix_a1' }), { fix_a1: { state: 'sent' } });
check('fixed auto line says so, no button', [fixed.includes('data-autofix'), fixed.includes('תיקנת ✓')], [false, true]);

// ─── מה הסוכנים למדו ───────────────────────────────────────────────────
const lessons = {
  L1: { agent: 'markazan', topic: 'זכוכית חכמה', answer: 'לא', approvals: 3, corrections: 0, autoAt: NOW, createdAt: NOW - 2 },
  L2: { agent: 'markazan', topic: 'שעות', answer: 'עד 16', approvals: 1, corrections: 1, createdAt: NOW - 1 },
  L3: { agent: 'archive', topic: '<b>חשבוניות</b>', answer: 'במייל', approvals: 0, corrections: 0, createdAt: NOW },
  bad: null,
};
const rows = J(ctx.lgLessonRows(lessons));
check('rows grouped by agent order, newest first inside', rows.map(r => [r.agent, r.id]), [['markazan', 'L2'], ['markazan', 'L1'], ['archive', 'L3']]);
check('row fields', rows[1], { id: 'L1', agent: 'markazan', agentName: 'מרכזן', topic: 'זכוכית חכמה', answer: 'לא', approvals: 3, corrections: 0, auto: true });
const lh = ctx.lgLessonsHtml(lessons);
check('list: per-agent headings, auto yes/no, approvals, מחק', [lh.includes('מרכזן'), lh.includes('ארכיון'), lh.includes('עונה לבד'), lh.includes('מציע ושואל'),
  /<button[^>]*data-lessondel="L1"[^>]*>מחק<\/button>/.test(lh), lh.includes('&lt;b&gt;חשבוניות')], [true, true, true, true, true, true]);
check('empty list', ctx.lgLessonsHtml({}).includes('עוד לא'), true);
check('count', [ctx.lgLessonCount(lessons), ctx.lgLessonCount(null)], [3, 0]);

// ─── הדף ───────────────────────────────────────────────────────────────
check('folded section "מה הסוכנים למדו"', /<details[^>]*id="secLessons"[\s\S]{0,300}מה הסוכנים למדו/.test(P), true);
check('reads waMeta/agentLessons', /waMeta\/agentLessons/.test(P), true);
check('every lesson write goes through the drain', ['agent-lesson-approve', 'agent-lesson-correct', 'agent-lesson-fix', 'agent-lesson-delete']
  .map(a => new RegExp("action:\\s*'" + a + "'").test(P)), [true, true, true, true]);
check('delete asks first', /dataset\.lessondel\) \{[\s\S]{0,40}confirm\(/.test(P), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll agents-lessons-ui checks passed.');
