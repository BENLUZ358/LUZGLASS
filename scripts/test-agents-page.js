#!/usr/bin/env node
/** הדף agents.html והקישור אליו מ-admin — חיווט בלבד (הלוגיקה ב-test-agents-dash.js).
 *  Run: node scripts/test-agents-page.js */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const P = fs.existsSync(path.join(ROOT, 'agents.html')) ? fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8') : '';
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const live = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

check('page exists', P.length > 0, true);
check('page loads its scripts', ['firebase-db.js', 'agents-dash.js', 'lg-ui.css', 'lg-icons.js'].map(s => P.includes(s)), [true, true, true, true]);
check('admin-only page', /lgRequireAuthAsync\(\s*'admin'\s*\)/.test(P), true);
check('mobile viewport + RTL', [/name="viewport"/.test(P), /dir="rtl"/.test(P)], [true, true]);
check('the four sections', ['id="secTodo"', 'id="secNums"', 'id="secLog"', 'id="secState"'].map(s => P.includes(s)), [true, true, true, true]);
check('every write goes through the drain',
  ['agent-status', 'agent-dismiss', 'agent-verdict', 'agent-pilot'].map(a => new RegExp("action:\\s*'" + a + "'").test(P)), [true, true, true, true]);
check('posts only to /api/wa-inbound-drain', (live(P).match(/_lgAuthPost\(\s*'([^']+)'/g) || []).every(m => m.includes('/api/wa-inbound-drain')), true);
check('no Firebase writes from the page', /_lgDb\.ref\([^)]*\)[^;]*\.(set|update|push|remove|transaction)\(/.test(live(P)), false);
check('the "טופל" button only on dismissable cards', /x\.dismissable\s*\?[^:]*data-dismiss/.test(P), true);
//  חדר הסוכנים (10/11): המונה = שאלות צהובות שמחכות לבן — מהאינדקס בשרת, כמו הדף (תיקון סקירה)
check('admin counter = open questions from the server index, same as the page',
  (() => { const m = live(A).match(/function lgAgentsNavCount\(\)[\s\S]*?\n}/);
    return !!m && /lgRoomOpenIndexCount\(/.test(m[0]) && /agentRoomOpen'\)/.test(m[0]) && /lgRoomOpenIndexCount\(OPEN_IDX\)/.test(P); })(), true);
check('log shows review rows as questions, the rest folded',
  [/lgAdSplitLog\(/.test(P), /lgAdReviewRowHtml\(r\.key,\s*r,\s*intake/.test(P), /<details[^>]*>[\s\S]{0,200}לא צריך לבדוק/.test(P), /lgAdOtherRowHtml\(/.test(P)],
  [true, true, true, true]);
check('no pilot buttons in the log any more', /lgAgRowHtml\(/.test(live(P)), false);
check('new script version so phones do not keep the old one', [/agents-dash\.js\?v=20261111/.test(P), /agents-dash\.js\?v=20261111/.test(A)], [true, true]);
// ─── עונה לכל הלקוחות + מייל להתראות (משימה 5) ───
check('all-customers switch above the pilot list, off by default',
  [/עונה לכל הלקוחות/.test(P), P.indexOf('id="allCust"') > -1 && P.indexOf('id="allCust"') < P.indexOf('id="pilot"'), /allCustomers\)\s*===\s*true/.test(P)], [true, true, true]);
check('email field with the edit/save pattern and its hint',
  [/id="benMail"/.test(P), /data-mailsave/.test(P), /data-mailedit/.test(P), /מייל להתראות כשהוואטסאפ לא עובד/.test(P), /escalateEmail:/.test(live(P)), /allCustomers:\s*/.test(live(P))], [true, true, true, true, true, true]);
// ─── חדר הסוכנים (בן, 10/11) ───
check('room screen: switches, summary, cards, room on top; the old sections folded',
  [['id="secSwitches"', 'id="secSummary"', 'id="secCards"', 'id="secRoom"'].every(x => P.includes(x)),
   ['secTodo', 'secNums', 'secLog', 'secCancels', 'secState'].every(id => new RegExp('<details[^>]*id="' + id + '"').test(P))], [true, true]);
check('switches and answers go through the drain', ['agent-config-set', 'agent-room-answer'].map(a => new RegExp("action:\\s*'" + a + "'").test(P)), [true, true]);
check('reads the room and the switches', [/waMeta\/agentRoom/.test(P), /waMeta\/agentConfig/.test(P)], [true, true]);
// ─── שיחות בחדר (11/11) ───
check('room renders threads: open first, closed folded per day',
  [P.includes('lgRoomThreads('), P.includes('lgRoomThreadHtml('), P.includes('lgRoomDayGroups('), /<details class="room-day"/.test(P)], [true, true, true, true]);
check('script version bumped to 20261111c in the page and in admin', [P.includes('agents-dash.js?v=20261111c'), A.includes('agents-dash.js?v=20261111c')], [true, true]);
check('threads built from all rows (filter only passed to lgRoomThreads), window by threads, opened days kept',
  [P.includes("lgRoomThreads(ROOM, { agent: FILTER })"), P.includes('lgRoomThreadWindow('), P.includes('OPEN_DAYS')], [true, true, true]);
check('no Vercel switch names left in the texts', /AGENT_REPLY_ENABLED|AGENT_SHADOW_ENABLED/.test(P), false);
check('only the allowed breakpoints', (P.match(/@media[^{]*/g) || []).every(m => /\((min|max)-width:\s*(600|768|900|1200)px\)/.test(m)), true);
check('no font below 12px', /font-size:\s*(\d|1[01])px/.test(P), false);
check('the page script parses', (() => { try { (P.match(/<script>([\s\S]*?)<\/script>/g) || []).forEach(s => new (require('vm').Script)(s.replace(/<\/?script>/g, ''))); return true; }
  catch (e) { return e.message; } })(), true);
check('reads the dismissals', /waMeta\/agentDash\/dismissed/.test(P), true);
check('the log reads 30 days, not everything', /agentShadow['"`]\s*\)\s*\.orderByChild\(\s*'createdAt'\s*\)\s*\.startAt\(/.test(P), true);
check('period switch: today / 7 days / 30 days', ['data-period="today"', 'data-period="7d"', 'data-period="30d"'].map(s => P.includes(s)), [true, true, true]);
check('record text never goes into HTML unescaped', /\$\{\s*[\w.]*\.(text|detail|customerName|title|key|kind)\s*\}/.test(live(P)), false);

// admin
check('admin menu links the page, with a counter', [/href="agents\.html"/.test(A), /id="navAgents"/.test(A)], [true, true]);
check('admin loads agents-dash.js', /<script src="agents-dash\.js/.test(A), true);
check('admin counter is a one-off read, not a live listener',
  (() => { const m = live(A).match(/function lgAgentsNavCount\(\)[\s\S]*?\n}/); return !!m && /once\(/.test(m[0]) && !/\.on\(/.test(m[0]); })(), true);
check('the קליטות agents tab is gone', /data-tab="agents"/.test(A), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll agents-page checks passed.');
