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
  for (const f of ['opty-paradox.js', 'opty-match.js', 'opty-shape.js', 'opty-layout.js', 'print-labels.js', 'order-labels.js'])
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
    const files = list.map(([name, buf, lastModified]) => {
      const f = new w.File([buf], name, lastModified ? { lastModified } : {});
      f.arrayBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      f.text = async () => buf.toString('utf8');
      return f;
    });
    Object.defineProperty(doc.getElementById(id), 'files', { value: files, configurable: true });
    doc.getElementById(id).dispatchEvent(new w.Event('change'));
  };
  const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
  db._data.meta.optyMats = { '06MIR': { he: '6 מראה כסף', en: '6 mm mirror' } };   // שם שבן תיקן — לא נדרס
  setFiles('inDb', [['Pezzi.DB', fx('opty-Pezzi-sample.DB')], ['Magaz.DB', fx('opty-Magaz-sample.DB')], ['other.txt', Buffer.from('x')]]);
  const dat = fs.readFileSync(path.join(__dirname, 'fixtures', 'opty-shapes', '274378.dat'), 'utf8').replace(/^427\.000000 1992\.000000/, '502.000000 1902.000000');
  //  קובצי חיתוך (בן, 17/11): M00291 ירד 12/11 17:10 → 13/11 שישי → יום מוצע 15/11; M00200 ישן — לא מוצג
  const R291 = '[P1H1R7D64R639Cx190y190X1F54Y5410S<n=274328>N18X1F54Y5410S<n=274325>N17]' + String.fromCharCode(13, 10) + 'N23 B';
  setFiles('inDat', [['274328.dat', Buffer.from(dat)], ['M00291.R01', Buffer.from(R291), Date.parse('2026-11-12T17:10:00+02:00')],
    ['M00200.R01', Buffer.from(R291), Date.parse('2026-10-01T10:00:00+03:00')], ['notes.txt', Buffer.from('x')]]);
  await tick();
  check('picks Pezzi.DB (and the glass list) out of the folder', doc.getElementById('gotDb').textContent, '✓ Pezzi.DB + Magaz.DB');
  check('reads .dat shape files and cutting files', doc.getElementById('gotDat').textContent, '✓ 1 צורות · 2 קובצי חיתוך');
  check('check button enabled', doc.getElementById('btnCheck').disabled, false);

  doc.getElementById('days').value = '3';
  doc.getElementById('btnCheck').click();
  for (let i = 0; i < 20 && !doc.querySelector('.sum'); i++) await tick();
  const nums = [...doc.querySelectorAll('.sum b')].map(b => b.textContent);
  check('summary: 2 sure (BathPlace/איציק, ד"ר/56891), 0 review, 0 not found, 0 already', nums, ['2', '0', '0', '0']);
  check('the sure list shows the shape drawing', !!doc.querySelector('.card .row svg'), true);

  //  אופטימיזציות שנמצאו + יום עבודה (בן, 17/11: "להחליט לאיזה יום עבודה זה")
  check('found optimisations: only the recent one, day suggested', [...doc.querySelectorAll('[data-jobday]')].map(i => [i.dataset.jobday, i.value]), [['M00291', '2026-11-15']]);
  const all = doc.getElementById('jobDayAll');
  all.value = '2026-11-16'; all.dispatchEvent(new w.Event('change'));
  check('one picker sets the day for all', doc.querySelector('[data-jobday="M00291"]').value, '2026-11-16');

  doc.getElementById('btnSave').click();
  for (let i = 0; i < 40 && !/אופטימיזציות/.test(doc.getElementById('st').textContent); i++) await tick();
  const d = db._data.orders;
  const J = (db._data.meta.optyJobs || {});
  check('glass names saved in Hebrew; a name Ben fixed is kept', [db._data.meta.optyMats['08S'], db._data.meta.optyMats['06MIR'].he, Object.keys(db._data.meta.optyMats).length], [{ he: '8 שקוף', en: '8 mm clear' }, '6 מראה כסף', 53]);   // 54 ברשימה, אחד מהם "חיסום/חור" — לא קוד זכוכית
  check('optimisation saved with the chosen day, its sheet and pieces', [Object.keys(J), J.M00291 && J.M00291.day, J.M00291 && J.M00291.sheets.length, J.M00291 && J.M00291.pieces[24].shape], [['M00291'], '2026-11-16', 1, '274328']);
  check('linked item stamped for that work day', d.o1.items[0].optyCut, { at: '2026-11-16', job: 'M00291' });
  check('status line counts optimisations and stamped glasses', /1 אופטימיזציות.*2 זכוכיות סומנו לחיתוך/.test(doc.getElementById('st').textContent), true);
  check('shape written on the right item (array)', [d.o1.items[0].optyShape, d.o1.items[0].optyJob, d.o1.items[1].optyShape], ['274328', 'M00291', undefined]);
  check('shape written on the right item (object-keyed items)', d.o2.items.a.optyShape, '274325');
  check('an order older than 30 days is not touched', d.old.items[0].optyShape, undefined);
  check('the drawing is saved for the order window and the label', db._data.meta.optyGeo['274328'].w, 502);
  check('no drawing saved for a shape without a .dat file', db._data.meta.optyGeo['274325'], undefined);

  doc.getElementById('btnCheck').click();
  for (let i = 0; i < 20 && !(doc.querySelector('.sum b') && doc.querySelector('.sum b').textContent === '0'); i++) await tick();
  check('second run: both already linked, nothing new', [...doc.querySelectorAll('.sum b')].map(b => b.textContent), ['0', '0', '0', '2']);
  //  סקירה: קליטה חוזרת לא מזיזה אופטימיזציה שכבר נשמרה ליום אחר
  check('re-import: a saved optimisation shows its saved day, marked as saved', [doc.querySelector('[data-jobday="M00291"]').value, doc.querySelector('[data-jobday="M00291"]').dataset.saved], ['2026-11-16', '1']);
  const all2 = doc.getElementById('jobDayAll');
  if (all2) { all2.value = '2026-11-25'; all2.dispatchEvent(new w.Event('change')); }
  check('re-import: the "all" picker does not move a saved one', doc.querySelector('[data-jobday="M00291"]').value, '2026-11-16');

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
  d.o1.items[1].optyCut = { at: '2026-11-13', job: 'M1' };   // סקירה: חותמת ישנה לא נשארת אחרי ניתוק
  doc.querySelector('[data-cut]').click();
  for (let i = 0; i < 30 && d.o1.items[1].optyShape; i++) await tick();
  check('"נתק" clears the glass and puts the shape back to link (size from the drawing)', [d.o1.items[1].optyShape, db._data.meta.optyPending.o1['900'].w, db._data.meta.optyPending.o1['900'].h], [undefined, 501, 1889]);
  check('"נתק" also clears the cut mark', d.o1.items[1].optyCut, undefined);

  //  ─── הגדרות ───
  doc.querySelector('[data-tab="set"]').click();
  for (let i = 0; i < 30 && !doc.querySelector('[data-unpair]'); i++) await tick();
  check('settings: fixed pairs + saved pairs (with remove)', [doc.querySelectorAll('#pairsOut .row').length > 10, !!doc.querySelector('[data-unpair="k1"]')], [true, true]);
  for (let i = 0; i < 30 && !doc.querySelector('[data-mat="08S"]'); i++) await tick();
  const mi = doc.querySelector('[data-mat="08S"]');
  check('settings: glass names table', mi && mi.value, '8 שקוף');
  mi.value = '8 שקוף פשוט'; doc.querySelector('[data-matgo="08S"]').click();
  for (let i = 0; i < 30 && db._data.meta.optyMats['08S'].he !== '8 שקוף פשוט'; i++) await tick();
  check('settings: a name can be fixed', db._data.meta.optyMats['08S'].he, '8 שקוף פשוט');

  //  ─── אופטימיזציות (בן, 17/11) ───
  db._data.meta.optyJobs.M00337 = { job: 'M00337', day: '2026-11-13', mat: '10S', matName: '10 mm clear',
    sheets: [w.lgOptyLayoutParse('[P1H1R7D64R639CX1F54Y5410S<n=500>N1X1F54Y5410N2]')[0]],
    pieces: { 1: { client: 'נאור', name: 'דני', w: 800, h: 2150, shape: '500' }, 2: { client: 'אגן ברזל', name: 'PHR#26083', w: 800, h: 2150, shape: '' } } };
  d.o1.items[0] = Object.assign(it(502, 1902), { optyShape: '274328', optyJob: 'M00291', optyCut: { at: '2026-11-16', job: 'M00291' } });
  const posts = [];
  w._lgAuthPost = async (url, body) => { posts.push([url, body]); return { ok: true, json: async () => ({ ok: true, id: 'j' + posts.length, job: { state: 'printed' } }) }; };
  w.lgLabelRender = () => ({ bitmap: 'B' });
  doc.querySelector('[data-tab="jobs"]').click();
  for (let i = 0; i < 30 && doc.querySelectorAll('[data-job]').length < 2; i++) await tick();
  check('jobs tab lists the saved optimisations, newest day first', [...doc.querySelectorAll('[data-job]')].map(b => b.dataset.job), ['M00291', 'M00337']);
  check('work estimate per day: sheets, glasses, verdict', [...doc.querySelectorAll('.jday')].map(h => h.dataset.day + ':' + /לוחות/.test(h.textContent) + ':' + /יום (קל|רגיל|עמוס)/.test(h.textContent)), ['2026-11-16:true:true', '2026-11-13:true:true']);
  check('import counted holes per sheet (from the .dat)', typeof db._data.meta.optyJobs.M00291.sheets[0].feat, 'number');
  const mat = doc.getElementById('jMat');
  check('glass filter lists the glass types', [...mat.options].map(o => o.value).filter(Boolean).sort(), ['08S', '10S']);
  mat.value = '10S'; mat.dispatchEvent(new w.Event('change'));
  check('glass filter hides the others', [...doc.querySelectorAll('[data-job]')].map(b => b.dataset.job), ['M00337']);
  mat.value = ''; mat.dispatchEvent(new w.Event('change'));
  const jq = doc.getElementById('jQ');
  jq.value = 'אגן'; jq.dispatchEvent(new w.Event('input'));
  check('shape search finds an unlinked client', [...doc.querySelectorAll('[data-hit]')].map(b => b.dataset.hit), ['M00337|1|2']);
  jq.value = ''; jq.dispatchEvent(new w.Event('input'));
  doc.querySelector('[data-job="M00291"]').click();
  for (let i = 0; i < 30 && !doc.querySelector('#jobView svg'); i++) await tick();
  check('job view: sheet i/N and the drawing', [/לוח 1\/1/.test(doc.getElementById('jobView').textContent), !!doc.querySelector('#jobView svg')], [true, true]);
  check('linked piece shows its cut status', /לחיתוך|נחתך/.test(doc.querySelector('[data-pc="24"]') ? doc.querySelector('[data-pc="24"]').textContent : ''), true);
  doc.getElementById('jPrintAll').click();
  for (let i = 0; i < 30 && !posts.length; i++) await tick();
  check('print all: one queue job, marker + 2 pieces', posts.length && [posts[0][1].labels.length, posts[0][1].labels[0].marker], [3, 'לוח 1/1']);
  const sd = doc.getElementById('jDay');
  sd.value = '2026-11-19'; doc.getElementById('jDayGo').click();
  for (let i = 0; i < 30 && db._data.meta.optyJobs.M00291.day !== '2026-11-19'; i++) await tick();
  for (let i = 0; i < 5; i++) await tick();
  check('change work day: job and the stamped glass move', [db._data.meta.optyJobs.M00291.day, d.o1.items[0].optyCut.at], ['2026-11-19', '2026-11-19']);
  doc.querySelector('[data-undo="o1|0"]').click();
  for (let i = 0; i < 30 && !d.o1.items[0].optyCut.undone; i++) await tick();
  check('"בטל נחתך" keeps the mark but as undone', [d.o1.items[0].optyCut.undone, d.o1.items[0].optyCut.job], [true, 'M00291']);

  //  ─── עבודת היום (בן, 17/11): סימון לוחות, סוג זכוכית, אחוז ביצוע ───
  db._data.meta.optyJobs.M00400 = { job: 'M00400', day: '2026-11-13', mat: '10S',
    sheets: [w.lgOptyLayoutParse('[P1H1R7D64R639CX1F54Y5410S<n=700>N1X1F54Y5410N2]')[0], w.lgOptyLayoutParse('[P1H2-4R7D64R639CX1F54Y5410N3]')[0]],
    pieces: { 1: { client: 'נאור', name: 'דני', w: 800, h: 2150, shape: '700' } } };
  db._data.meta.optyJobs.M00401 = { job: 'M00401', day: '2026-11-13', mat: '06MIR', sheets: [w.lgOptyLayoutParse('[P1H1R7D64R639CX1F54Y5410N1]')[0]], pieces: {} };
  db._data.meta.optyMats['10S'] = { he: '10 שקוף', en: '10 mm clear' };
  d.o2.items.a = Object.assign(it(518, 1939), { optyShape: '700', optyJob: 'M00400', optyCut: { at: '2026-11-13', job: 'M00400' } });
  doc.querySelector('[data-tab="today"]').click();
  for (let i = 0; i < 30 && doc.querySelectorAll('[data-mark]').length < 6; i++) await tick();
  check('today: groups by glass (Hebrew name) and one button per physical sheet', [[...doc.querySelectorAll('[data-tgroup]')].map(g => g.dataset.tgroup), doc.querySelectorAll('[data-mark]').length, /10S · 10 שקוף/.test(doc.getElementById('pane-today').textContent)], [['10S', '06MIR'], 6, true]);   // 10S: M00400 (1 + 3 זהים) + M00337 מלמעלה
  check('today: progress starts at 0%', /ביצעת 0%/.test(doc.getElementById('tProg').textContent), true);
  doc.querySelector('[data-mark="M00400|1"]').click();
  for (let i = 0; i < 30 && !(db._data.meta.optyJobs.M00400.marks || {})[1]; i++) await tick();
  for (let i = 0; i < 5; i++) await tick();
  check('mark a sheet: saved with time, not bulk', [typeof db._data.meta.optyJobs.M00400.marks[1].at, db._data.meta.optyJobs.M00400.marks[1].bulk], ['number', false]);
  check('mark a sheet: its linked glass is cut now', d.o2.items.a.optyCut.marked, true);
  check('progress moves above 0', /ביצעת ([1-9]\d?)%/.test(doc.getElementById('tProg').textContent), true);
  doc.querySelector('[data-mark="M00400|1"]').click();
  for (let i = 0; i < 30 && (db._data.meta.optyJobs.M00400.marks || {})[1]; i++) await tick();
  for (let i = 0; i < 5; i++) await tick();
  check('tap again: unmarked', [(db._data.meta.optyJobs.M00400.marks || {})[1], !!d.o2.items.a.optyCut.marked], [undefined, false]);
  doc.querySelector('[data-markmat="10S"]').click();
  for (let i = 0; i < 30 && Object.keys(db._data.meta.optyJobs.M00400.marks || {}).length < 4; i++) await tick();
  check('"all of this glass": every sheet of 10S marked as bulk', Object.values(db._data.meta.optyJobs.M00400.marks).map(m => m.bulk), [true, true, true, true]);
  check('06MIR untouched', db._data.meta.optyJobs.M00401.marks, undefined);

  //  ─── עבודת היום: הדפסה (בן, 17/11) — לוחות במדפסת רגילה, מדבקות לפי לוח ───
  //  ישר ל-Brother (בן, 17/11): הדף מצייר עמודי A4 (בדפדפן) ושולח לתור ההדפסות, printer a4
  const plan = w.sheetsPrintPlan(['M00400']);
  check('print plan: one block per different sheet, repeated sheet once with its range', plan[0].blocks.map(b => b.title.split(' · ').slice(0, 2).join(' · ')), ['M00400 · לוח 1/4', 'M00400 · לוחות 2–4/4 (×3)']);
  check('print plan: table row = order on sheet, shape, client, sketch, size', plan[0].blocks[0].rows[0].filter((_, i) => i !== 2 && i !== 3), ['1', '700', '800×2150']);
  w.renderSheetPages = async pl => pl.map(j => ({ job: j.job, pages: j.blocks.map(() => '/9j/AAAA') }));
  let p0 = posts.length;
  doc.querySelector('[data-tprint="M00400"]').click();
  for (let i = 0; i < 30 && posts.length === p0; i++) await tick();
  const sp = posts[p0] && posts[p0][1];
  check('print sheets: straight to the Brother queue', sp && [sp.action, sp.kind, sp.printer, sp.pages.length, sp.client], ['create', 'sheets', 'a4', 2, 'אופטי-ווי M00400']);
  p0 = posts.length;
  doc.querySelector('[data-tprintday]').click();
  for (let i = 0; i < 40 && posts.length < p0 + 3; i++) await tick();
  check('print whole day: one job per optimisation, in order', posts.slice(p0).map(x => x[1].client), ['אופטי-ווי M00337', 'אופטי-ווי M00400', 'אופטי-ווי M00401']);
  const n0 = posts.length;
  doc.querySelector('[data-tlabels="M00400"]').click();
  for (let i = 0; i < 30 && posts.length === n0; i++) await tick();
  check('labels for an optimisation: marker before each physical sheet', posts[n0] && posts[n0][1].labels.filter(l => l.marker).map(l => l.marker), ['לוח 1/4', 'לוח 2/4', 'לוח 3/4', 'לוח 4/4']);
  const n1 = posts.length;
  doc.querySelector('[data-tlab="M00400|1"]').click();
  for (let i = 0; i < 30 && posts.length === n1; i++) await tick();
  check('labels for one sheet: its marker + its glass', posts[n1] && [posts[n1][1].labels[0].marker, posts[n1][1].labels.length], ['לוח 1/4', 3]);

  //  ─── חיפוש (בן, 17/11): גם בזכוכיות של האופטימיזציות — שבוע אחורה מיד, "חפש עוד אחורה", והאם נחתכה ───
  const iso = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const one = (job, day, client) => ({ job, day, mat: '08S', sheets: [w.lgOptyLayoutParse('[P1H1R7D64R639CX1F54Y5410S<n=7' + job.slice(-2) + '>N1]')[0]], pieces: { 1: { client, name: 'מקלחון', w: 800, h: 2000, shape: '7' + job.slice(-2) } } });
  db._data.meta.optyJobs.M00402 = one('M00402', w.lgOptyTodayIso(), 'שמעון כהן');
  db._data.meta.optyJobs.M00403 = one('M00403', iso(w.Date.now() - 20 * 86400000), 'שמעון כהן');
  db._data.meta.optyJobs.M00404 = one('M00404', iso(w.Date.now() - 3 * 86400000), 'שמעון כהן');
  doc.querySelector('[data-tab="find"]').click();
  doc.getElementById('q').value = 'שמעון';
  doc.getElementById('btnFind').click();
  for (let i = 0; i < 40 && !doc.querySelector('[data-ohit]'); i++) await tick();
  const ohits = () => [...doc.querySelectorAll('[data-ohit]')].map(x => x.dataset.ohit.split('|')[0]);
  check('search: optimisation glass from the last week, newest first', ohits(), ['M00402', 'M00404']);
  check('search: cut state for a glass not linked to an order', [...doc.querySelectorAll('[data-ohit] .cst')].map(x => x.textContent.trim()), ['לחיתוך היום · חיסום', 'חזר מחיסום · מוכן']);   // 08S = חיסום (בן, 17/11)
  doc.querySelector('[data-older]').click();
  for (let i = 0; i < 40 && ohits().length < 3; i++) await tick();
  check('"חפש עוד אחורה" adds older glass', ohits(), ['M00402', 'M00404', 'M00403']);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
