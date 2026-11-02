#!/usr/bin/env node
/**
 * לוח בקרה של הדפסות — prints.html (בן, 3/11).
 *   A. דף אדמין, טוען את print-labels.js ואת firebase-db.js.
 *   B. רשימה מהשרת (/api/print list) + מצב המחשב במשרד (agent.lastSeenAt).
 *   C. פתיחת הדפסה (get) → מדבקות מהטקסט השמור, עריכה, בחירה, "הדפס שוב" = create חדש עם reprintOf.
 *   D. כל מצב מוצג במילים (בתור / מדפיס / הודפס / נכשל / לא ידוע).
 *   E. קישור "הדפסות" בתפריט של admin.html ו-workday.html, וכפתור בתחנת החשבוניות.
 * Run: node scripts/test-prints-page.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const P = fs.existsSync(path.join(ROOT, 'prints.html')) ? read('prints.html') : '';
check('A1 the page exists', !!P, true);
check('A2 admin only', /lgRequireAuthAsync\('admin'\)/.test(P), true);
check('A3 loads the label drawing', /<script src="print-labels\.js[^"]*"><\/script>/.test(P), true);
check('A4 shared design base', /href="lg-ui\.css/.test(P), true);
check('B1 lists from the print center', /action: 'list'/.test(P), true);
check('B2 shows whether the office PC is connected', /lastSeenAt/.test(P) && /המחשב במשרד/.test(P), true);
check('C1 opens a job', /action: 'get'/.test(P), true);
check('C2 reprint draws again from the text and creates a new job', /lgLabelRender\(/.test(P) && /action: 'create'/.test(P) && /reprintOf/.test(P), true);
check('C3 per-label selection', /type="checkbox"/.test(P), true);
for (const w of ['בתור', 'מדפיס', 'הודפס', 'נכשל', 'לא ידוע']) check('D state word: ' + w, P.includes(w), true);
check('E1 admin menu link', /href="prints\.html"/.test(read('admin.html')), true);
check('E2 workday menu link', /href="prints\.html"/.test(read('workday.html')), true);
check('E3 invoice station button', /href="prints\.html"/.test(read('invoices.html')), true);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
