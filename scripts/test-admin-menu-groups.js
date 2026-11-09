#!/usr/bin/env node
/** תפריט האדמין לפי הדרך שהזמנה עוברת (בן, 9/11). Run: node scripts/test-admin-menu-groups.js */
const fs = require('fs'), path = require('path');
const A = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const nav = (A.match(/<nav class="unav-nav">([\s\S]*?)<\/nav>/) || ['', ''])[1];
const groups = {}; let cur = null;
for (const m of nav.matchAll(/<div class="unav-sec[^"]*"[^>]*>([^<]*)<\/div>|<a class="unav-a[^>]*>(?:<span[^>]*><\/span>)?([^<]*)/g)) {
  if (m[1] != null) { cur = m[1].replace(/^\S+\s/, '').trim(); groups[cur] = []; } else groups[cur].push(m[2].trim());
}
check('three groups in order', Object.keys(groups), ['משרד', 'ייצור', 'הגדרות']);
check('office', groups['משרד'], ['לוח הזמנות', 'תור סקיצות', 'תחנת חשבוניות', 'תיקון הזמנות', 'סוכנים', 'סיכום יום']);
check('production', groups['ייצור'], ['שרטט', 'תחנת בדיקה', 'יום עבודה', 'הדפסות']);
check('pickup board is out of the menu (Ben 9/11: not in use)', /openPickupBoard/.test(nav), false);
check('settings', groups['הגדרות'], ['מחירונים', 'משתמשים', 'בונה סקיצות']);
check('ids the code looks for are still there', ['sqNav', 'navHsCorr', 'navAgents', 'navUsers', 'navBuilder'].every(id => nav.includes('id="' + id + '"')), true);
check('users / builder still hidden until main admin', /id="navUsers"[^>]*display:none/.test(nav) && /id="navBuilder"[^>]*display:none/.test(nav), true);
check('red counter style exists', /\.unav-a \.count\.alert\{[^}]*background:#d64545/.test(A), true);
console.log(fail ? '\n' + fail + ' failed' : '\nall passed'); process.exit(fail ? 1 : 0);
