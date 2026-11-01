#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  בדיקות — הזמנות מזגאגי במסכים: השדות לא נעלמים ב-lgNormalizeOrder,
//  תג "זגאגי" בתור, ותווית אדומה "עודכן מזגאגי" בתור / אצל השרטט /
//  בתחנת הבדיקה (בן, 1/11: "הסקיצה החדשה חייבת להחליף את הישנה").
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = read('firebase-db.js');

// lgNormalizeOrder + lgZgagiUpdatedTag בקונטקסט נקי
const ctx = vm.createContext({ console, lgStageToStatus: x => x, lgStatusToStage: x => x, lgEsc: x => String(x) });
const pick = re => { const m = DB.match(re); if (!m) { console.error('FAIL  could not find ' + re); process.exit(1); } return m[0]; };
vm.runInContext([pick(/function _lgClean[\s\S]*?\n}/), pick(/function lgNormalizeOrder[\s\S]*?\n}/),
  (DB.match(/function lgZgagiUpdatedTag[\s\S]*?\n}/) || ['function lgZgagiUpdatedTag(){return null}'])[0]].join('\n'), ctx);
const n = ctx.lgNormalizeOrder({ id: 'zg_1', source: 'zgagi', zgagi: { biz: 'b', order: 'o', item: 'i', orderNo: '1024', rev: 2 },
  zgagiUpdatedAt: 5, hardware: [{ name: 'ציר', qty: 2, sku: '0001' }] });
check('א. zgagi נשמר', n.zgagi, { biz: 'b', order: 'o', item: 'i', orderNo: '1024', rev: 2 });
check('א. zgagiUpdatedAt נשמר', n.zgagiUpdatedAt, 5);
check('א. פרזול נשמר', n.hardware, [{ name: 'ציר', qty: 2, sku: '0001' }]);
const plain = ctx.lgNormalizeOrder({ id: 'x' });
check('א. הזמנה רגילה — ריק', [plain.zgagi, plain.zgagiUpdatedAt, plain.hardware], [null, 0, []]);
// בן, 1/11: "לא יהיה תג זגאגי… כאילו זה מוואטסאפ" — התווית בלי המילה זגאגי
const tag = ctx.lgZgagiUpdatedTag({ zgagiUpdatedAt: 5 });
check('א. תווית — יש, בלי המילה זגאגי', [/הסקיצה עודכנה/.test(tag), /זגאגי/.test(tag)], [true, false]);
check('א. תווית — אין', ctx.lgZgagiUpdatedTag({}), '');

const ADMIN = read('admin.html');
check('ב. התור מעביר את השדות', /zgagiUpdatedAt:\s*o\.zgagiUpdatedAt/.test(ADMIN), true);
check('ב. בלי תג זגאגי — נראה כמו WhatsApp', [/'זגאגי'/.test(ADMIN), /\(item\.source==='whatsapp'\|\|item\.source==='zgagi'\)\?'sq-tag-wa'/.test(ADMIN)], [false, true]);
check('ב. תווית בתור', /lgZgagiUpdatedTag\(item\)/.test(ADMIN), true);
check('ג. תווית אצל השרטט', /lgZgagiUpdatedTag\(o\)/.test(read('drafter.html')), true);
check('ג. השרטט מעביר את השדה', /zgagiUpdatedAt:\s*o\.zgagiUpdatedAt/.test(read('drafter.html')), true);
check('ד. תווית בתחנת הבדיקה', /lgZgagiUpdatedTag\(o\)/.test(read('check-station.html')), true);
check('ד. התחנה מעבירה את השדה', /zgagiUpdatedAt:\s*o\.zgagiUpdatedAt/.test(read('check-station.html')), true);

if (failed) { console.error(`\n${failed} נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
