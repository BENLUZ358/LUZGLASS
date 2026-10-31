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
check('admin counter reads the same 31 days as the page',
  (() => { const m = live(A).match(/function lgAgentsNavCount\(\)[\s\S]*?\n}/); return !!m && /31 \* 24 \* 60 \* 60 \* 1000/.test(m[0]); })(), true);
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
