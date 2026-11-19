#!/usr/bin/env node
/**
 * דוח חיסום — שני ימי עבודה בדוח אחד (בן, 19/11/2026).
 *
 * "ייבא עבודה" הזהיר רק על הזמנות שעוד לא נבדקו. כשכל מה שלפני כבר ב"הושלמו"
 * אבל עוד לא נשלח למפעל, ההודעה הייתה "אפשר לייבא" בלי שום שאלה — ואז
 * "שלח למפעל" מוציא את שני הימים בדוח אחד.
 *
 *  1. "ייבא עבודה" שואל גם כשיש "הושלמו" שלא נשלחו — ואפשר לייבא בכל זאת.
 *  2. הייבוא שומר מתי יובאה כל הזמנה (workday/csBatch).
 *  3. "שלח למפעל" שואל כשבדוח יש הזמנות משני ייבואים — ואפשר לשלוח בכל זאת.
 *     "ביטול" לא שולח כלום וסוגר את חלון הדוח.
 *
 * Run: node scripts/test-cs-import-guard.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CS = fs.readFileSync(path.join(__dirname, '..', 'check-station.html'), 'utf8');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const bodyOf = (src, name) => {
  const i = src.search(new RegExp('function ' + name + '\\('));
  if (i < 0) { console.error('FAIL  missing ' + name); failed++; return ''; }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

const pure = vm.createContext({ Object, Number, String, Date });
vm.runInContext([bodyOf(CS, 'csImportHint'), bodyOf(CS, 'csImportQuestion'), bodyOf(CS, 'csMixedBatchQuestion')].join('\n'), pure);

// ── 1. הטקסט בפס הייבוא ──
check('nothing in front → "אפשר לייבא"', pure.csImportHint(0, 0), 'אפשר לייבא');
check('only unsent "הושלמו" → asks to send first (was "אפשר לייבא")', /שלח למפעל את 9/.test(pure.csImportHint(0, 9)), true);
check('unchecked only → unchanged wording', pure.csImportHint(3, 0), 'קודם סיים את 3 ההזמנות שלפניך, ואז ייבא');
check('both → names both', /סיים את 2[\s\S]*שלח למפעל את 4/.test(pure.csImportHint(2, 4)), true);

// ── שאלת הייבוא ──
check('nothing in front → no question', pure.csImportQuestion(0, 0), '');
{
  const q = pure.csImportQuestion(0, 18);
  check('unsent "הושלמו" → a question naming 18 and the single report', [/18/.test(q), /בדוח אחד/.test(q), /לייבא בכל זאת\?$/.test(q)], [true, true, true]);
  check('…with real line breaks, not "\\n" text', [/\n/.test(q), /\\n/.test(q)], [true, false]);
}
check('unchecked only → still asks', /3 הזמנות שלא סיימת/.test(pure.csImportQuestion(3, 0)), true);

// ── csImportWork: שואל, "לא" לא כותב, "כן" מייבא ושומר את רגע הייבוא ──
function importer(answer, ordersState) {
  const calls = { asked: null, writes: [] };
  const ctx = vm.createContext({
    console, Object, Array, String, Date, JSON,
    csHeld: [{ id: 'n1' }, { id: 'n2' }],
    orders: ordersState,
    isDone: o => !!o.done,
    confirm: m => { calls.asked = m; return answer; },
    toast: () => {},
    document: { getElementById: () => null },
    firebase: { database: () => ({ ref: p => ({ update: async v => { calls.writes.push([p, v]); } }) }) },
  });
  vm.runInContext([bodyOf(CS, 'csImportQuestion'), 'async ' + bodyOf(CS, 'csImportWork')].join('\n'), ctx);
  return { ctx, calls };
}
(async () => {
  {
    const { ctx, calls } = importer(false, [{ id: 'a', done: true }, { id: 'b', done: true }]);
    await ctx.csImportWork();
    check('import with 2 unsent "הושלמו" asks (it used to import silently)', /2 הזמנות שעוד לא נשלחו/.test(calls.asked || ''), true);
    check('…a "no" writes nothing', calls.writes.length, 0);
  }
  {
    const { ctx, calls } = importer(true, [{ id: 'a', done: true }]);
    await ctx.csImportWork();
    const [p, v] = calls.writes[0] || [];
    check('…a "yes" still imports (option to move them anyway)', [p, v && v['csNew/n1'], v && v['csNew/n2']], ['workday', null, null]);
    check('…and stamps one import time on every imported order',
      [typeof (v && v['csBatch/n1']), v && v['csBatch/n1'] === v['csBatch/n2']], ['number', true]);
  }
  {
    const { ctx, calls } = importer(true, []);
    await ctx.csImportWork();
    check('empty station → imports without asking', [calls.asked, calls.writes.length], [null, 1]);
  }

  // ── 3. "שלח למפעל" — שני ייבואים ──
  const T1 = new Date(2026, 10, 19, 7, 42).getTime(), T2 = new Date(2026, 10, 19, 14, 12).getTime();
  const ords = ids => ids.map(id => ({ id }));
  check('one import → no question', pure.csMixedBatchQuestion(ords(['a', 'b']), { a: T1, b: T1 }), '');
  check('orders imported before this change (no stamp) → not counted', pure.csMixedBatchQuestion(ords(['a', 'old']), { a: T1 }), '');
  {
    const q = pure.csMixedBatchQuestion(ords(['a', 'b', 'c']), { a: T1, b: T1, c: T2 });
    check('two imports → a question listing both, with counts', [/2 ייבואים/.test(q), /— 2 הזמנות/.test(q), /— 1 הזמנות/.test(q), /לשלוח את כולן בדוח אחד\?$/.test(q)], [true, true, true, true]);
  }

  const send = bodyOf(CS, 'sendAllToFactory');
  const iAsk = send.indexOf('csMixedBatchQuestion(doneOrds, wdCsBatch)');
  check('send asks before a report number is taken', iAsk > 0 && iAsk < send.indexOf('_createReportNum()'), true);
  check('send asks after the report window is opened (popup blocking)', send.indexOf("window.open('', '_blank')") < iAsk, true);
  check('"ביטול" closes the report window and returns', /if\(_mixQ && !confirm\(_mixQ\)\)\{\s*if\(printWin && !printWin\.closed\) printWin\.close\(\);\s*return;/.test(send), true);
  check('sent orders lose their import stamp', /workday\/csBatch\/' \+ o\.id\)\.remove\(\)/.test(send), true);
  check('the station listens to csBatch', /wdCsBatch = \(wd\.csBatch/.test(CS), true);

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll import-guard checks passed.');
})();
