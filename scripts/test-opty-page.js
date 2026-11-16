#!/usr/bin/env node
/**
 * opty.html — קליטה מאופטי-ווי, מקצה לקצה בדפדפן מדומה (בן, 16/11).
 *   הקבצים האמיתיים (בלוק מ-Pezzi.DB + קבצי .dat) נבחרים בשדות, "בדוק" מול הזמנות
 *   בבסיס מדומה, "שמור" כותב את מספר הצורה על הפריט הנכון ואת הצורה ב-meta/optyGeo.
 *   הקבצים שנבחרו רק נקראים.
 * Run: node scripts/test-opty-page.js   (צריך jsdom: npm i --no-save jsdom)
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { console.error('jsdom missing — npm i --no-save jsdom'); process.exit(1); }
const { fakeDb } = require('./_fake-db.js');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
  const now = Date.now(), it = (w, h) => ({ name: 'שקוף 8', w, h });
  const db = fakeDb({ orders: {
    o1: { id: 'o1', orderNum: '1240', orderClient: 'המקום לאמבט', sketchName: 'איציק', createdAt: now, items: [it(502, 1902), it(499, 1887)] },
    o2: { id: 'o2', orderNum: '1241', orderClient: 'ד"ר', sketchName: '56891', createdAt: now, items: { a: it(518, 1939) } },
    old: { id: 'old', orderNum: '1100', orderClient: 'המקום לאמבט', sketchName: 'איציק', createdAt: now - 60 * 86400000, items: [it(502, 1902)] },
  } });
  const pushed = [];
  const ref0 = db.ref.bind(db);
  db.ref = p => Object.assign(ref0(p), { push: async v => { pushed.push([p, v]); } });

  let html = fs.readFileSync(path.join(ROOT, 'opty.html'), 'utf8')
    .replace(/<script src="https:[^"]*"><\/script>/g, '').replace(/<script src="(firebase-db|lg-icons)\.js[^"]*"><\/script>/g, '');
  for (const f of ['opty-paradox.js', 'opty-match.js', 'opty-shape.js'])
    html = html.replace(new RegExp(`<script src="${f.replace('.', '\\.')}[^"]*"></script>`), `<script>${fs.readFileSync(path.join(ROOT, f), 'utf8')}</script>`);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://luzglass-test.vercel.app/opty.html',
    beforeParse(w) {
      w._lgDb = db; w.lgRequireAuthAsync = async () => ({});
      w.lgEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      w.TextDecoder = TextDecoder; w.CSS = { escape: s => String(s).replace(/"/g, '\\"') };
      w.Date.now = () => Date.parse('2026-11-13T10:00:00Z');   // הקובץ לדוגמה מ-12/11
    } });
  const w = dom.window, doc = w.document;
  const setFiles = (id, list) => {
    const files = list.map(([name, buf]) => {
      const f = new w.File([buf], name);
      f.arrayBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      f.text = async () => buf.toString('utf8');
      return f;
    });
    Object.defineProperty(doc.getElementById(id), 'files', { value: files, configurable: true });
    doc.getElementById(id).dispatchEvent(new w.Event('change'));
  };
  const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
  setFiles('inDb', [['Pezzi.DB', fx('opty-Pezzi-sample.DB')], ['other.txt', Buffer.from('x')]]);
  const dat = fs.readFileSync(path.join(__dirname, 'fixtures', 'opty-shapes', '274378.dat'), 'utf8').replace(/^427\.000000 1992\.000000/, '502.000000 1902.000000');
  setFiles('inDat', [['274328.dat', Buffer.from(dat)], ['M00288.R01', Buffer.from('x')]]);
  await tick();
  check('picks Pezzi.DB out of the folder', doc.getElementById('gotDb').textContent, '✓ Pezzi.DB');
  check('reads only .dat shape files', doc.getElementById('gotDat').textContent, '✓ 1 צורות');
  check('check button enabled', doc.getElementById('btnCheck').disabled, false);

  doc.getElementById('days').value = '3';
  doc.getElementById('btnCheck').click();
  for (let i = 0; i < 20 && !doc.querySelector('.sum'); i++) await tick();
  const nums = [...doc.querySelectorAll('.sum b')].map(b => b.textContent);
  check('summary: 2 sure (BathPlace/איציק, ד"ר/56891), 0 review, 0 not found, 0 already', nums, ['2', '0', '0', '0']);
  check('the sure list shows the shape drawing', !!doc.querySelector('.card .row svg'), true);

  doc.getElementById('btnSave').click();
  for (let i = 0; i < 20 && !/נשמרו/.test(doc.getElementById('st').textContent); i++) await tick();
  const d = db._data.orders;
  check('shape written on the right item (array)', [d.o1.items[0].optyShape, d.o1.items[0].optyJob, d.o1.items[1].optyShape], ['274328', 'M00291', undefined]);
  check('shape written on the right item (object-keyed items)', d.o2.items.a.optyShape, '274325');
  check('an order older than 30 days is not touched', d.old.items[0].optyShape, undefined);
  check('the drawing is saved for the order window and the label', db._data.meta.optyGeo['274328'].w, 502);
  check('no drawing saved for a shape without a .dat file', db._data.meta.optyGeo['274325'], undefined);

  doc.getElementById('btnCheck').click();
  for (let i = 0; i < 20 && !(doc.querySelector('.sum b') && doc.querySelector('.sum b').textContent === '0'); i++) await tick();
  check('second run: both already linked, nothing new', [...doc.querySelectorAll('.sum b')].map(b => b.textContent), ['0', '0', '0', '2']);

  //  לקוח שלא מזוהה → שיוך נשמר ב-meta/optyClients
  d.o2.orderClient = 'דוקטור זכוכית'; delete d.o2.items.a.optyShape;
  doc.getElementById('btnCheck').click();
  for (let i = 0; i < 20 && !doc.querySelector('[data-pairgo]'); i++) await tick();
  const sel = doc.querySelector('select[data-pair]');
  check('unknown client offered for pairing', sel && sel.dataset.pair, 'ד"ר');
  sel.value = 'דוקטור זכוכית';
  doc.querySelector('[data-pairgo]').click();
  await tick();
  check('pair saved', pushed.map(([p, v]) => [p, v.ours, v.opty]), [['meta/optyClients', 'דוקטור זכוכית', 'ד"ר']]);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
