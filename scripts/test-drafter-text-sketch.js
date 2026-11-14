#!/usr/bin/env node
/** הזמנת טקסט בטיוטה / משלוח לשרטט (בן, 14/11): במקום "אין סקיצה" — שורות ההודעה ומה נקלט.
 *  Run: node scripts/test-drafter-text-sketch.js */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'api', '_wa-text-order.js'));
const F = require(path.join(ROOT, 'api', '_wa-free-text.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const txt = 'מראה 6 ממ מלוטש\n89.7 על 178.6 ×1\nמראה 5 80 על 60 X2 <b>&"';
const svg = T.lgWaTextSvg(txt, { client: 'טום גלאס', when: '13/11/2026 13:44' });
const L = T.lgWaTextSvgLines(svg);
check('message SVG → its lines, header first, entities restored',
  L.map(l => [l.kind, l.text]),
  [['head', 'הודעת וואטסאפ · טום גלאס · 13/11/2026 13:44'], ['line', 'מראה 6 ממ מלוטש'], ['line', '89.7 על 178.6 ×1'], ['line', 'מראה 5 80 על 60 X2 <b>&"']]);
check('not a message SVG → null', [T.lgWaTextSvgLines('data:image/png;base64,AAAA'), T.lgWaTextSvgLines(null), T.lgWaTextSvgLines('data:image/svg+xml;charset=utf-8,%E0%A4%A')], [null, null, null]);

//  _drafter-batch נטען בלי pdf-lib (נדרש רק בתוך _build)
const D = require(path.join(ROOT, 'api', '_drafter-batch.js'));
const items = T.lgWaTextItems(F.lgWaFreeTextResolve(F.lgWaFreeTextParse('מראה 5\n80 על 60 X2\n50 על 40'), {}), {});
check('what the system understood: one line per size, units grouped',
  D.lgTextItemsLines(items).map(l => [l.kind, l.text]),
  [['gap', ''], ['head', 'מה נקלט במערכת:'], ['size', 'מראה 5   ·   רוחב 800 × גובה 600 מ"מ   ·   כמות 2'], ['size', 'מראה 5   ·   רוחב 500 × גובה 400 מ"מ   ·   כמות 1']]);
check('no items → nothing added', D.lgTextItemsLines([]), []);

const SRC = fs.readFileSync(path.join(ROOT, 'api', '_drafter-batch.js'), 'utf8');
check('batch items: text order gets the lines page, images unchanged',
  [/const lines = d \? null : require\('\.\/_wa-text-order'\)\.lgWaTextSvgLines\(raw\)/.test(SRC),
   /img: lines \? \{ lines: lines\.concat\(lgTextItemsLines\(o\.items\)\) \} : d && \/\^image\\\/\/\.test\(d\.mime\) \? d : null/.test(SRC)], [true, true]);
const MG = fs.readFileSync(path.join(ROOT, 'api', '_invoice-merge.js'), 'utf8');
check('sketch page draws lines instead of an image', [/if \(img && Array\.isArray\(img\.lines\)\)/.test(MG), /const pic = !img \|\| img\.lines \? null/.test(MG)], [true, true]);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drafter-text-sketch checks passed.');
