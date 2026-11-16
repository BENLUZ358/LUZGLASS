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
  }, meta: { optyClients: { k1: { ours: 'ד"ר', opty: 'ד"ר' } } } });
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
  check('pair saved', pushed.filter(([p]) => p === 'meta/optyClients').map(([p, v]) => [p, v.ours, v.opty]), [['meta/optyClients', 'דוקטור זכוכית', 'ד"ר']]);
  const hist = pushed.filter(([p]) => p === 'meta/optyImports').map(([, v]) => [v.auto, v.wait, v.notFound, v.shapes.slice().sort()]);
  check('import history: one line per save (2 linked, the shapes listed)', hist, [[2, 0, 0, ['274325', '274328']]]);

  //  ─── לחיבור (בן, 16/11: לחבר לפני החיסום) ───
  d.o1.items = [{ ...it(502, 1902), optyShape: '274328' }, it(499, 1887), it(499, 1887)];
  db._data.meta.optyPending = { o1: { '900': { shape: '900', job: 'M1', w: 501, h: 1889, qty: 1, name: 'איציק' } } };
  db._data.meta.optyReview = { '901': { shape: '901', job: 'M2', w: 520, h: 1941, qty: 1, client: 'ד"ר', name: '', cands: [{ orderId: 'o1', idx: 2 }, { orderId: 'o2', idx: 0 }] } };
  db._data.meta.optyGeo = Object.assign(db._data.meta.optyGeo || {}, { '900': { w: 501, h: 1889, c: [] } });
  db._data.sketches = { o1: 'data:image/png;base64,iVBORw0KGgo=' };
  doc.querySelector('[data-tab="link"]').click();
  for (let i = 0; i < 30 && !doc.querySelector('[data-go]'); i++) await tick();
  check('link tab: the order shape + the unknown-order shape', [...doc.querySelectorAll('[data-go]')].map(b => b.dataset.go), ['p|o1|900', 'r||901']);
  check('net size shown (501×1889 → 499×1887)', doc.querySelector('#linkOut .net').textContent.replace(/[⁦⁩]/g, ''), '499×1887');
  //  צורה גדולה + הסקיצה של ההזמנה (בן, 16/11)
  check('big drawing with sizes in the row', !!doc.querySelector('[data-row="p|o1|900"] .wvis svg text'), true);
  for (let i = 0; i < 30 && !doc.querySelector('[data-skbox] img'); i++) await tick();
  check('the sketch of the guessed order is shown beside it', doc.querySelector('[data-skbox][data-big="p|o1|900"] img') && doc.querySelector('[data-skbox][data-big="p|o1|900"] img').getAttribute('src').slice(0, 15), 'data:image/png;');
  check('unknown order: the sketch follows the first candidate (o2 has none)', doc.querySelector('[data-skbox][data-big="r||901"]').textContent.includes('אין סקיצה'), true);
  doc.querySelector('[data-big="p|o1|900"]').click();
  check('tap opens a big window: drawing + sketch + the glasses of the order', [!!doc.querySelector('#big svg'), !!doc.querySelector('#big img'), /499/.test(doc.getElementById('big').textContent)], [true, true, true]);
  doc.querySelector('#big [data-close]').click();
  check('the big window closes', doc.getElementById('big'), null);
  const pick = doc.querySelector('select[data-pick="p|o1|900"]');
  check('the matching glass first, with ✓, already chosen', [pick.value, pick.options[0].textContent.trim().startsWith('✓')], ['o1|1', true]);
  check('a glass that already has a shape is not offered', [...pick.options].map(o => o.value).includes('o1|0'), false);
  doc.querySelector('[data-go="p|o1|900"]').click();
  for (let i = 0; i < 30 && !(db._data.orders.o1.items[1].optyShape); i++) await tick();
  for (let i = 0; i < 10; i++) await tick();
  check('link writes the shape + job, and the shape leaves the list', [d.o1.items[1].optyShape, d.o1.items[1].optyJob, (db._data.meta.optyPending.o1 || {})['900']], ['900', 'M1', undefined]);
  const rp = doc.querySelector('select[data-pick="r||901"]');
  check('unknown order: the candidates from both orders, closest first (o2 518×1939)', rp && [...rp.options].map(o => o.value), ['o2|0', 'o1|2']);
  w.confirm = () => true;
  doc.querySelector('[data-drop="r||901"]').click();
  for (let i = 0; i < 20 && db._data.meta.optyReview && db._data.meta.optyReview['901']; i++) await tick();
  check('"לא שייך" removes it from the list', (db._data.meta.optyReview || {})['901'], undefined);

  //  ─── חיפוש + נתק ───
  doc.querySelector('[data-tab="find"]').click();
  doc.getElementById('q').value = '900';
  doc.getElementById('btnFind').click();
  for (let i = 0; i < 30 && !doc.querySelector('[data-cut]'); i++) await tick();
  check('search by shape number finds the linked glass', doc.querySelector('#findOut .shape') && doc.querySelector('#findOut .shape').textContent, '900');
  doc.querySelector('[data-cut]').click();
  for (let i = 0; i < 30 && d.o1.items[1].optyShape; i++) await tick();
  check('"נתק" clears the glass and puts the shape back to link (size from the drawing)', [d.o1.items[1].optyShape, db._data.meta.optyPending.o1['900'].w, db._data.meta.optyPending.o1['900'].h], [undefined, 501, 1889]);

  //  ─── הגדרות ───
  doc.querySelector('[data-tab="set"]').click();
  for (let i = 0; i < 30 && !doc.querySelector('[data-unpair]'); i++) await tick();
  check('settings: fixed pairs + saved pairs (with remove)', [doc.querySelectorAll('#pairsOut .row').length > 10, !!doc.querySelector('[data-unpair="k1"]')], [true, true]);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
