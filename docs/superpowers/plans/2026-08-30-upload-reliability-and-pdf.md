# העלאת סקיצות — אמינות ופיצול PDF — תכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** שלקוח לעולם לא יראה "נשלח" על סקיצה שלא נשמרה, ושקובץ PDF יתפצל לסקיצה נפרדת לכל עמוד.

**Architecture:** מזהה דטרמיניסטי לכל קובץ בתוך משלוח הופך ניסיון חוזר לדריסה במקום לכפילות. כל שלב נעטף בזמן קצוב, והצלחה מדווחת רק אחרי קריאה חוזרת מ-Firebase. PDF מרונדר לתמונות בדפדפן ונכנס ללולאה הקיימת שכבר שומרת כל קובץ כהזמנה נפרדת.

**Tech Stack:** HTML/CSS/JS ללא build, Firebase RTDB compat 9.23.0, pdf.js legacy UMD מאוחסן מקומית, בדיקות Node ב-`scripts/test-*.js`

**Spec:** `docs/superpowers/specs/2026-08-30-upload-reliability-and-pdf-design.md`

## Global Constraints

- **סדר המשימות מחייב.** האמינות (1–3) נכנסת לפני ה-PDF (4–5). קוד PDF שנוחת ראשון נכשל בשקט, וזה בדיוק מה שהתכנית באה למנוע.
- **`saveSubmission` שומרת את חתימתה.** היא מקבלת `id` אופציונלי; בלעדיו התנהגותה זהה להיום. כל קורא קיים ממשיך לעבוד.
- אין שינוי ב-`lgNormalizeOrder` ואין שדה חדש ברמת ההזמנה.
- אין שינוי ב-`database.rules.json`.
- המזהה נשאר בתבנית `sub_*` — קוד קיים מסתמך על התחילית.
- דחיסת עמוד PDF: רוחב 1000, איכות 0.6, JPEG — זהה ל-`compressImage` הקיים.
- תקרה: 20 עמודים ל-PDF.
- זמנים קצובים: 20000ms לעיבוד קובץ, 30000ms לשמירה, 15000ms לאימות.
- pdf.js נטען עצלה, מ-`vendor/` בלבד. `workerSrc` על נתיב מקומי, לא blob — CSP חוסם blob.
- עיצוב: יעד מגע 44px, ניגודיות 4.5:1, גופן ≥12px, שגיאה ליד הכפתור, התקדמות אמיתית, `prefers-reduced-motion`, בלי גלילה אופקית.
- כל משימה מסתיימת בחבילה שלה ירוקה **ובלי נפילות חדשות**. שלוש חבילות נכשלות מראש מסיבת CRLF — `test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage` — ואין לתקן אותן כאן.
- הרצת הסריקה חייבת לבדוק **קוד יציאה**, לא לחפש את המחרוזת `FAIL`. חבילה שקורסת אינה מדפיסה `FAIL` ונראית ירוקה בטעות.

---

### Task 1: חסימת קבצים שאינם תמונה או PDF

הכי קטנה, והיא זו שמונעת את התקלה שכבר קרתה בפועל.

**Files:**
- Modify: `upload.html` — `handleFiles`
- Test: `scripts/test-upload-reliability.js` (חדש)

**Interfaces:**
- Produces: `lgIsAcceptedUpload(file)` — פונקציה טהורה, `{ok:true}` או `{ok:false, reason}`

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-upload-reliability.js`:

```js
#!/usr/bin/env node
/**
 * Tests the upload path in upload.html.
 *
 * Three ways a sketch could be lost without anyone being told, all found on
 * 2026-08-30 while chasing a broken image in the queue:
 *
 *  1. compressImage counts completions and calls saveAll() only when the count
 *     matches. One callback that never fires stops the count, saveAll is never
 *     reached, and the button sits on "מעבד..." with no error at all.
 *  2. Firebase set() resolves on server ack. With no network the promise never
 *     settles either way — same stuck button, same silence.
 *  3. saveAll writes one file at a time and saveSubmission mints
 *     'sub_' + Date.now() per call, so a retry after a partial failure saves
 *     the already-saved files a second time as separate orders.
 *
 * And the file that started it: a Windows .url shortcut, 513 bytes, accepted
 * as a sketch because handleFiles checked only size. accept="image/*,.pdf" is
 * a hint to the picker; drag-and-drop ignores it entirely.
 *
 * Run: node scripts/test-upload-reliability.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.join(__dirname, '..');
const UPLOAD = fs.readFileSync(path.join(ROOT, 'upload.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── only images and PDFs get in ───────────────────────────────────────── */
{
  const fn = (UPLOAD.match(/function lgIsAcceptedUpload[\s\S]*?\n}/) || [''])[0];
  check('the accept predicate is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const ok = f => ctx.lgIsAcceptedUpload(f).ok;

  check('a jpeg is accepted',  ok({ name: 'a.jpg',  type: 'image/jpeg' }), true);
  check('a png is accepted',   ok({ name: 'a.png',  type: 'image/png'  }), true);
  check('a heic photo from an iPhone is accepted',
                               ok({ name: 'a.heic', type: 'image/heic' }), true);
  check('a pdf is accepted',   ok({ name: 'a.pdf',  type: 'application/pdf' }), true);

  /* the actual file that reached the queue */
  check('a Windows .url shortcut is refused',
        ok({ name: 'link.url', type: 'application/octet-stream' }), false);
  check('and so is a spreadsheet',
        ok({ name: 'a.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), false);
  check('a video is refused — it is not a sketch',
        ok({ name: 'a.mp4', type: 'video/mp4' }), false);

  /* browsers hand over an empty type for unknown extensions, so the name has
     to be able to decide on its own */
  check('an empty type falls back to the extension',
        ok({ name: 'scan.pdf', type: '' }), true);
  check('and an unknown extension with an empty type is refused',
        ok({ name: 'thing.url', type: '' }), false);
  check('the refusal says which file and why',
        typeof ctx.lgIsAcceptedUpload({ name: 'link.url', type: '' }).reason, 'string');
}

/* ── it is wired into the picker AND the drop zone ─────────────────────── */
{
  const fn = (UPLOAD.match(/function handleFiles[\s\S]*?\n}/) || [''])[0];
  check('handleFiles is found', fn.length > 0, true);
  check('every file is checked before it is read',
        /lgIsAcceptedUpload\(/.test(fn), true);
  check('a refused file never reaches uploadedFiles',
        /lgIsAcceptedUpload[\s\S]{0,200}?return;/.test(fn), true);
  check('the size limit still applies', /file\.size >/.test(fn), true);
}
check('the picker still advertises what it wants',
      /accept="image\/\*,\.pdf"/.test(UPLOAD), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll upload checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-upload-reliability.js
```
צפוי: `FAIL  the accept predicate is found`.

- [ ] **Step 3: הוסף את הפונקציה**

ב-`upload.html`, מיד לפני `function handleFiles(files) {`:

```js
// accept="" הוא רמז לחלון הבחירה בלבד: אפשר לבחור "כל הקבצים", וגרירה
// עוקפת אותו לגמרי. כך נכנס קובץ .url של Windows בן 513 בתים ונשמר
// כסקיצה, והוצג בכל מסך כתמונה שבורה.
//
// הסוג שהדפדפן מוסר ריק לפעמים, ולכן הסיומת צריכה להכריע לבדה.
function lgIsAcceptedUpload(file){
  var name = String((file && file.name) || '');
  var type = String((file && file.type) || '').toLowerCase();
  var ext  = (name.split('.').pop() || '').toLowerCase();
  var IMG_EXT = ['jpg','jpeg','png','gif','webp','heic','heif','bmp'];
  if (type.indexOf('image/') === 0)   return { ok: true };
  if (type === 'application/pdf')     return { ok: true };
  if (!type) {
    if (ext === 'pdf')                return { ok: true };
    if (IMG_EXT.indexOf(ext) !== -1)  return { ok: true };
  }
  return { ok: false, reason: 'הקובץ "' + name + '" אינו תמונה או PDF ולכן לא צורף' };
}
```

- [ ] **Step 4: חבר ל-`handleFiles`**

החלף:

```js
function handleFiles(files) {
  Array.from(files).forEach(file => {
    if(file.size > 10 * 1024 * 1024) { alert(`הקובץ ${file.name} גדול מ-10MB`); return; }
```

ב:

```js
function handleFiles(files) {
  Array.from(files).forEach(file => {
    const verdict = lgIsAcceptedUpload(file);
    if(!verdict.ok) { uploadNotice(verdict.reason); return; }
    if(file.size > 10 * 1024 * 1024) { uploadNotice(`הקובץ ${file.name} גדול מ-10MB`); return; }
```

- [ ] **Step 5: הוסף את `uploadNotice`**

`alert` בנייד נבלע לפעמים ואינו נראה. מיד אחרי `lgIsAcceptedUpload`:

```js
// alert חוסם, ובדפדפני נייד מסוימים הוא פשוט לא מוצג. ההודעה יושבת בדף,
// ליד מה שהמשתמש עשה.
function uploadNotice(msg, kind){
  var el = document.getElementById('upNotice');
  if(!el){ console.warn('[upload]', msg); return; }
  el.textContent = msg;
  el.className = 'up-notice' + (kind === 'ok' ? ' up-ok' : ' up-err');
  el.style.display = msg ? 'block' : 'none';
}
```

ובגוף הדף, מיד לפני כפתור השליחה:

```html
<div id="upNotice" class="up-notice" style="display:none" role="status" aria-live="polite"></div>
```

וב-CSS:

```css
.up-notice{
  margin:12px 0;padding:12px 14px;border-radius:8px;
  font-family:Heebo,sans-serif;font-size:14px;line-height:1.5;
}
.up-err{background:#fdecea;border:1px solid #f5c6c2;color:#8f2d24;}
.up-ok {background:#eaf7ef;border:1px solid #bfe3cd;color:#1e6b3a;}
```

- [ ] **Step 6: הרץ**

```
node scripts/test-upload-reliability.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
node scripts/test-csp.js
```

- [ ] **Step 7: קבע**

```bash
git add upload.html scripts/test-upload-reliability.js
git commit -m "fix: the upload accepted any file, and a .url shortcut became a sketch"
```

---

### Task 2: מזהה דטרמיניסטי — ניסיון חוזר לא יוצר כפילות

**Files:**
- Modify: `firebase-db.js` — `saveSubmission`
- Modify: `upload.html` — `submitUpload`
- Test: `scripts/test-upload-reliability.js`

**Interfaces:**
- Produces: `saveSubmission(data)` מכבד `data.id` אם נמסר
- Produces: `lgUploadBatch()` ב-`upload.html` — מחזיר `{batchId, refNum}` יציבים

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

הוסף ל-`scripts/test-upload-reliability.js`, לפני בלוק הדיווח:

```js
/* ── a retry must not double-save ──────────────────────────────────────── */
/*
 * saveAll writes one file at a time. Fail on the fourth of six and the first
 * three are already in Firebase; the client retries, saveSubmission mints a
 * fresh 'sub_' + Date.now() for each, and those three become six orders with
 * six order numbers. A deterministic id per (batch, index) turns the retry
 * into an overwrite of the same paths.
 */
{
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const fn = (FB.match(/async function saveSubmission[\s\S]*?\n}/) || [''])[0];
  check('saveSubmission is found', fn.length > 0, true);
  check('a caller may supply the id', /data\.id\s*\|\|\s*\('sub_' \+ Date\.now\(\)\)/.test(fn), true);
  /* the prefix is load-bearing: sqSaveEdit, markStageValue and the queue all
     branch on it */
  check('and the generated form still starts with sub_', /'sub_' \+ /.test(fn), true);

  const batch = (UPLOAD.match(/function lgUploadBatch[\s\S]*?\n}/) || [''])[0];
  check('the batch helper is found', batch.length > 0, true);
  const store = {};
  const ctx = vm.createContext({
    sessionStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    Date: { now: () => 1756500000000 },
  });
  vm.runInContext(batch, ctx);

  const first = ctx.lgUploadBatch();
  check('a batch has an id', typeof first.batchId, 'string');
  check('and asking again during the same attempt returns the same one',
        ctx.lgUploadBatch().batchId, first.batchId);
  check('so the retry writes the same order ids',
        'sub_' + ctx.lgUploadBatch().batchId + '_0', 'sub_' + first.batchId + '_0');
  /* cleared only once everything is verified */
  ctx.lgUploadBatch.clear ? ctx.lgUploadBatch.clear() : ctx.sessionStorage.removeItem('lgUploadBatch');
  check('and a new submission after a clear gets a new batch',
        Object.keys(store).length, 0);
}

/* ── nothing waits forever ─────────────────────────────────────────────── */
{
  const fn = (UPLOAD.match(/async function submitUpload[\s\S]*?\n}/) || [''])[0];
  check('submitUpload is found', fn.length > 0, true);
  check('saving is bounded by a timeout', /_lgWithTimeout\(|lgWithTimeout\(/.test(fn), true);
  check('and so is processing each file', /PROCESS_TIMEOUT_MS|20000/.test(fn), true);
}
check('the timeout helper is reachable from the page',
      /function lgWithTimeout|_lgWithTimeout/.test(fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8')), true);

/* ── success is claimed only after a read-back ─────────────────────────── */
{
  const fn = (UPLOAD.match(/async function verifySaved[\s\S]*?\n}/) || [''])[0];
  check('there is a verification step', fn.length > 0, true);
  /* one field, not the order: an order carries a base64 sketch and reading it
     back to prove it exists would cost hundreds of kilobytes per file */
  check('it reads one field, not the whole order',
        /orders\/' \+ [^)]*\+ '\/id'/.test(fn), true);
  const submit = (UPLOAD.match(/async function submitUpload[\s\S]*?\n}/) || [''])[0];
  check('and the success screen waits for it',
        /verifySaved\([\s\S]{0,400}?successScreen/.test(submit), true);
}
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-upload-reliability.js
```

- [ ] **Step 3: תן ל-`saveSubmission` לקבל מזהה**

ב-`firebase-db.js`, החלף:

```js
async function saveSubmission(data) {
  const id  = 'sub_' + Date.now();
```

ב:

```js
async function saveSubmission(data) {
  // המזהה מגיע מהקורא כשהוא רוצה שניסיון חוזר יידרוס ולא ייצור כפילות.
  // בלעדיו — התנהגות זהה לקודם, וכל קורא קיים ממשיך כרגיל.
  const id  = data.id || ('sub_' + Date.now());
```

- [ ] **Step 4: הוסף את עוזר המשלוח**

ב-`upload.html`, לפני `submitUpload`:

```js
// משלוח אחד = מזהה אחד, שנשמר עד שהכל אומת. ניסיון חוזר משתמש בו שוב,
// כותב לאותם נתיבים, ולכן דורס במקום ליצור הזמנות כפולות.
//
// sessionStorage ולא localStorage: המשלוח שייך ללשונית הזו. חסום בדפדפן
// פרטי — אז נופלים לזיכרון, וההגנה מכפילות שורדת ניסיון חוזר אבל לא רענון.
var _lgBatchMem = null;
function lgUploadBatch(){
  var raw = null;
  try { raw = sessionStorage.getItem('lgUploadBatch'); } catch(e) { raw = _lgBatchMem; }
  if(raw){ try { return JSON.parse(raw); } catch(e) {} }
  var made = { batchId: String(Date.now()), refNum: null };
  var s = JSON.stringify(made);
  try { sessionStorage.setItem('lgUploadBatch', s); } catch(e) { _lgBatchMem = s; }
  return made;
}
function lgUploadBatchSet(b){
  var s = JSON.stringify(b);
  try { sessionStorage.setItem('lgUploadBatch', s); } catch(e) { _lgBatchMem = s; }
}
function lgUploadBatchClear(){
  try { sessionStorage.removeItem('lgUploadBatch'); } catch(e) {}
  _lgBatchMem = null;
}
```

- [ ] **Step 5: הוסף אימות**

```js
// "נשמר" פירושו שקראנו את זה בחזרה. set() שחזר אינו הוכחה שההזמנה שם.
// שדה בודד ולא ההזמנה: הזמנה נושאת סקיצת base64, והורדתה לאימות הייתה
// עולה מאות קילובייטים לכל קובץ.
async function verifySaved(id){
  const snap = await _lgWithTimeout(
    firebase.database().ref('orders/' + id + '/id').once('value'),
    15000, 'אימות שמירה');
  return snap.exists() && snap.val() === id;
}
```

- [ ] **Step 6: החלף את `saveAll`**

ב-`submitUpload`, החלף את `saveAll` ואת הלולאה שקוראת לה בגרסה שמשתמשת במזהה, בזמן קצוב ובאימות:

```js
  const PROCESS_TIMEOUT_MS = 20000;
  const SAVE_TIMEOUT_MS    = 30000;

  const batch = lgUploadBatch();
  if(!batch.refNum){ batch.refNum = await lgNextOrderNum(); lgUploadBatchSet(batch); }
  const refNum = batch.refNum;

  async function saveAll(images){
    const failures = [];
    for (let i = 0; i < images.length; i++) {
      const id  = 'sub_' + batch.batchId + '_' + i;
      const num = refNum + (images.length > 1 ? '-' + (i + 1) : '');
      try {
        await _lgWithTimeout(saveSubmission({
          id,
          refNum:      num,
          orderClient: name,
          client:      name,
          phone,
          sketchName:  '',
          orderNum:    num,
          notes,
          read:        false,
          fileName:    images[i].name || '',
          sketch:      images[i].data || null,
          files:       [{ name: images[i].name || '', type: 'image/jpeg' }],
          date:        dateStr,
          time:        timeStr
        }), SAVE_TIMEOUT_MS, 'שמירת סקיצה');

        if(!await verifySaved(id)) throw new Error('ההזמנה לא נמצאה אחרי השמירה');
      } catch(e){
        console.error('[upload] save failed', id, e);
        failures.push({ n: i + 1, name: images[i].name || '', msg: e.message });
      }
    }

    if(failures.length){
      uploadNotice('נשמרו ' + (images.length - failures.length) + ' מתוך ' + images.length +
                   '. נכשלו: ' + failures.map(f => f.name || ('קובץ ' + f.n)).join(', ') +
                   '. לחיצה על "שלח" תשלים את החסרים בלבד.');
      btn.disabled = false;
      btn.textContent = 'שלח סקיצה ←';
      return;
    }

    lgUploadBatchClear();
    uploadNotice('');
    document.getElementById('formPage').style.display = 'none';
    document.getElementById('successScreen').classList.add('show');
    document.getElementById('successRef').textContent = 'מספר פנייה: ' + refNum;
  }
```

- [ ] **Step 7: החלף את לולאת הדחיסה בגרסה שלא יכולה להיתקע**

```js
  // הלולאה הקודמת ספרה סיומים וקראה ל-saveAll רק כשהמונה השתווה. קריאה
  // חוזרת אחת שלא הגיעה עצרה את הספירה, saveAll לא נקרא, ושום שגיאה לא
  // הוצגה — הכפתור נשאר "מעבד...". Promise.all עם זמן קצוב לכל קובץ הופך
  // את אותה תקלה לשגיאה שרואים.
  function compressOne(f){
    return new Promise(resolve => {
      compressImage(f.data, 1000, 0.6, d => resolve({ name: f.name, data: d }));
    });
  }
  let images;
  try {
    images = await Promise.all(uploadedFiles.map((f, i) =>
      _lgWithTimeout(compressOne(f), PROCESS_TIMEOUT_MS, 'עיבוד ' + (f.name || ('קובץ ' + (i+1))))));
  } catch(e){
    uploadNotice('העיבוד נכשל: ' + e.message + '. נסה שוב, או הסר את הקובץ הבעייתי.');
    btn.disabled = false;
    btn.textContent = 'שלח סקיצה ←';
    return;
  }
  await saveAll(images);
```

- [ ] **Step 8: הרץ**

```
node scripts/test-upload-reliability.js
node scripts/test-order-normalizer.js
node scripts/test-sketch-naming.js
node scripts/test-timeout.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
```

- [ ] **Step 9: קבע**

```bash
git add upload.html firebase-db.js scripts/test-upload-reliability.js
git commit -m "fix: an upload could stall or double-save without anyone being told"
```

---

### Task 3: בדיקה ידנית של האמינות

לא ניתן לבדוק סטטית. חובה לפני שממשיכים ל-PDF.

- [ ] **Step 1:** העלה 3 תמונות → 3 הזמנות, מסך הצלחה.
- [ ] **Step 2:** כבה רשת ב-DevTools (Network → Offline), לחץ שלח.
      צפוי: **תוך 30 שניות** הודעת שגיאה בדף, הכפתור חוזר להיות פעיל. לא ספינר נצחי.
- [ ] **Step 3:** החזר רשת, לחץ שלח שוב.
      צפוי: ההזמנות נשמרות **פעם אחת**. בדוק בלוח ההזמנות שאין כפילויות.
- [ ] **Step 4:** גרור קובץ `.txt` לאזור ההעלאה.
      צפוי: הודעה שנוקבת בשם הקובץ, והוא לא מצורף.
- [ ] **Step 5:** בנייד אמיתי, לא רק בסימולטור.

---

### Task 4: אחסון pdf.js מקומית

**Files:**
- Create: `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`
- Modify: `scripts/test-csp.js`
- Test: `scripts/test-pdf-split.js` (חדש)

- [ ] **Step 1: הורד את הספרייה**

גרסת legacy UMD — לא ESM, כי הדף אינו מודול:

```bash
mkdir -p vendor
curl -L -o vendor/pdf.min.js        https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js
curl -L -o vendor/pdf.worker.min.js https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js
```

- [ ] **Step 2: אמת שהקבצים אמיתיים**

```bash
ls -la vendor/
head -c 100 vendor/pdf.min.js
```
צפוי: שניהם קיימים, `pdf.min.js` מעל 200KB, `pdf.worker.min.js` מעל 800KB, והתוכן הוא JavaScript ולא HTML של שגיאה.

- [ ] **Step 3: כתוב את הבדיקה**

צור `scripts/test-pdf-split.js`:

```js
#!/usr/bin/env node
/**
 * Tests PDF splitting on the upload page.
 *
 * One page becomes one sketch. upload.html already saves each file as its own
 * order — that is where L1064-1/-2/-3 came from — so a PDF only has to become
 * several images before that loop runs. Once a page is a JPEG it is
 * indistinguishable from a photo, and nothing downstream changes at all.
 *
 * The CSP is the constraint that decides the shape: script-src is 'self' plus
 * four Google hosts, so the library is vendored rather than loaded from a CDN,
 * and there is no worker-src, so workerSrc must be a same-origin path — a blob
 * worker, which is pdf.js's default in some builds, would be blocked.
 *
 * Run: node scripts/test-pdf-split.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.join(__dirname, '..');
const UPLOAD = fs.readFileSync(path.join(ROOT, 'upload.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the library is ours, not a CDN's ──────────────────────────────────── */
for (const f of ['pdf.min.js', 'pdf.worker.min.js']) {
  const p = path.join(ROOT, 'vendor', f);
  check(`vendor/${f} exists`, fs.existsSync(p), true);
  if (fs.existsSync(p)) {
    check(`vendor/${f} is not an error page`,
          !fs.readFileSync(p, 'utf8').slice(0, 200).includes('<html'), true);
  }
}
check('the page loads it from our own origin, never a CDN',
      /cdn\.|unpkg|jsdelivr/.test(UPLOAD), false);
check('and the worker path is same-origin, not a blob',
      /workerSrc\s*=\s*['"]vendor\/pdf\.worker\.min\.js['"]/.test(UPLOAD), true);

/* ── it is loaded only when a PDF is actually chosen ───────────────────── */
{
  const fn = (UPLOAD.match(/(async )?function lgLoadPdfLib[\s\S]*?\n}/) || [''])[0];
  check('the lazy loader is found', fn.length > 0, true);
  check('it injects the script at call time', /createElement\(['"]script['"]\)/.test(fn), true);
  check('and only once', /_lgPdfLib|_pdfLibPromise/.test(fn), true);
}
check('there is no eager <script src="vendor/pdf',
      /<script[^>]+src=["']vendor\/pdf/.test(UPLOAD), false);

/* ── the page cap ──────────────────────────────────────────────────────── */
{
  const fn = (UPLOAD.match(/(async )?function lgPdfToImages[\s\S]*?\n}/) || [''])[0];
  check('the renderer is found', fn.length > 0, true);
  check('there is a page cap', /MAX_PDF_PAGES|20/.test(fn), true);
  check('a page is rendered to jpeg at the same quality as a photo',
        /toDataURL\(['"]image\/jpeg['"],\s*0\.6\)/.test(fn), true);
  check('at the same width as a photo', /1000/.test(fn), true);
  check('progress is reported per page, not left as a silent spinner',
        /onProgress|uploadNotice\(/.test(fn), true);
  check('a failure names the file rather than throwing raw',
        /catch\s*\(/.test(fn), true);
}

/* ── a pdf becomes several entries in the existing loop ────────────────── */
{
  const fn = (UPLOAD.match(/async function submitUpload[\s\S]*?\n}/) || [''])[0];
  check('submitUpload flattens files into images',
        /lgPdfToImages\(/.test(fn), true);
  /* the order numbering already handles n>1; it must key off the flattened
     count, not the number of files the client picked */
  check('numbering follows the flattened count',
        /images\.length > 1/.test(fn), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll pdf-split checks passed.');
```

- [ ] **Step 4: הרץ וודא שהיא נכשלת**

```
node scripts/test-pdf-split.js
```

- [ ] **Step 5: ודא שה-CSP לא נשבר**

`vendor/` הוא same-origin ולכן `script-src 'self'` מכסה אותו. הוסף ל-`scripts/test-csp.js`, ברשימת הבדיקות:

```js
check("script-src allows our own vendored libraries",
      /script-src[^;]*'self'/.test(csp), true);
```

- [ ] **Step 6: קבע**

```bash
git add vendor scripts/test-pdf-split.js scripts/test-csp.js
git commit -m "chore: vendor pdf.js — the CSP has no CDN and no blob worker"
```

---

### Task 5: פיצול PDF לעמודים

**Files:**
- Modify: `upload.html`
- Test: `scripts/test-pdf-split.js`

**Interfaces:**
- Consumes: `vendor/pdf.min.js` ממשימה 4, `uploadNotice` ממשימה 1, המשלוח ממשימה 2
- Produces: `lgPdfToImages(file, onProgress)` → `Promise<[{name, data}]>`

- [ ] **Step 1: הוסף את הטוען העצל**

```js
// נטען רק כשבאמת נבחר PDF. הרוב המוחלט מעלה תמונות, ואין סיבה שישלמו
// על ספרייה של מגהבייט. הנתיב מקומי — ה-CSP לא מתיר CDN.
var _pdfLibPromise = null;
function lgLoadPdfLib(){
  if(_pdfLibPromise) return _pdfLibPromise;
  _pdfLibPromise = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    s.onload = function(){
      // חייב נתיב מאותו מקור. worker מ-blob נחסם: אין worker-src ב-CSP,
      // והוא נופל ל-default-src 'self' שאינו כולל blob:
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = function(){ reject(new Error('טעינת מנוע ה-PDF נכשלה')); };
    document.head.appendChild(s);
  });
  return _pdfLibPromise;
}
```

- [ ] **Step 2: הוסף את הרינדור**

```js
var MAX_PDF_PAGES = 20;

// עמוד אחד = סקיצה אחת. אותם רוחב ואיכות ש-compressImage משתמש בהם, כדי
// שעמוד מ-PDF ישקול כמו צילום ולא יפתיע את נפח הבסיס.
async function lgPdfToImages(file, onProgress){
  var lib = await lgLoadPdfLib();
  var buf = await file.arrayBuffer();
  var doc;
  try {
    doc = await lib.getDocument({ data: buf }).promise;
  } catch(e){
    if(String(e && e.name) === 'PasswordException')
      throw new Error('הקובץ "' + file.name + '" מוגן בסיסמה');
    throw new Error('לא ניתן לקרוא את "' + file.name + '"');
  }
  if(doc.numPages > MAX_PDF_PAGES)
    throw new Error('"' + file.name + '" מכיל ' + doc.numPages +
                    ' עמודים, והמקסימום ' + MAX_PDF_PAGES);

  var out = [];
  var base = (file.name || 'מסמך').replace(/\.pdf$/i, '');
  for(var p = 1; p <= doc.numPages; p++){
    if(onProgress) onProgress(p, doc.numPages);
    var page = await doc.getPage(p);
    var vp1  = page.getViewport({ scale: 1 });
    var scale = Math.min(1, 1000 / vp1.width) * 2;   // ×2 כדי שכתב יד יישאר קריא
    var vp   = page.getViewport({ scale: scale });
    var cv   = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;

    // הקטנה לרוחב היעד אחרי הרינדור — אותם 1000/0.6 של תמונה רגילה
    var fin = document.createElement('canvas');
    var k = Math.min(1, 1000 / cv.width);
    fin.width = Math.round(cv.width * k); fin.height = Math.round(cv.height * k);
    fin.getContext('2d').drawImage(cv, 0, 0, fin.width, fin.height);
    out.push({ name: base + ' — עמוד ' + p, data: fin.toDataURL('image/jpeg', 0.6) });
  }
  return out;
}
```

- [ ] **Step 3: שטח את הקבצים לתמונות ב-`submitUpload`**

החלף את בלוק הדחיסה ממשימה 2, שלב 7, ב:

```js
  function compressOne(f){
    return new Promise(resolve => {
      compressImage(f.data, 1000, 0.6, d => resolve({ name: f.name, data: d }));
    });
  }
  // PDF מתפצל לעמודים כאן, ומכאן והלאה אין הבדל בינו לבין צילום —
  // הלולאה ששומרת כבר יודעת לשמור כל פריט כהזמנה נפרדת.
  async function toImages(f, i){
    const label = f.name || ('קובץ ' + (i + 1));
    const isPdf = (f.type === 'application/pdf') ||
                  /\.pdf$/i.test(String(f.name || ''));
    if(isPdf){
      return lgPdfToImages(f.file, (p, n) =>
        uploadNotice('מעבד את "' + label + '" — עמוד ' + p + ' מתוך ' + n, 'ok'));
    }
    return [await compressOne(f)];
  }

  let images;
  try {
    const groups = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      groups.push(await _lgWithTimeout(
        toImages(uploadedFiles[i], i), PROCESS_TIMEOUT_MS,
        'עיבוד ' + (uploadedFiles[i].name || ('קובץ ' + (i + 1)))));
    }
    images = groups.flat();
  } catch(e){
    uploadNotice('העיבוד נכשל: ' + e.message + '. נסה שוב, או הסר את הקובץ הבעייתי.');
    btn.disabled = false;
    btn.textContent = 'שלח סקיצה ←';
    return;
  }
  uploadNotice('');
  if(!images.length){
    uploadNotice('לא נוצרה אף סקיצה מהקבצים שנבחרו.');
    btn.disabled = false; btn.textContent = 'שלח סקיצה ←';
    return;
  }
  await saveAll(images);
```

- [ ] **Step 4: שמור את אובייקט ה-File**

`lgPdfToImages` צריך `arrayBuffer()`, שקיים על `File` ולא על data URL. ב-`handleFiles`, החלף:

```js
      uploadedFiles.push({ name: file.name, data: e.target.result, type: file.type });
```

ב:

```js
      // ה-File עצמו נשמר לצד ה-data URL: pdf.js קורא arrayBuffer, ותצוגת
      // התצוגה המקדימה קוראת data. שניהם נחוצים.
      uploadedFiles.push({ name: file.name, data: e.target.result, type: file.type, file: file });
```

- [ ] **Step 5: הצג PDF בתצוגה המקדימה**

ב-`renderPreviews`, האייקון 📄 כבר מטופל. הוסף את שם הקובץ מתחתיו כדי שאפשר יהיה לדעת מה נבחר:

```js
        : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px;">
             <div style="font-size:28px;">📄</div>
             <div style="font-size:12px;color:#666;padding:0 6px;text-align:center;word-break:break-all;">${lgEsc(f.name)}</div>
           </div>`}
```

- [ ] **Step 6: הרץ**

```
node scripts/test-pdf-split.js
node scripts/test-upload-reliability.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
node scripts/test-csp.js
```

- [ ] **Step 7: סריקה מלאה — לפי קוד יציאה**

```bash
for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```
מותר להיכשל רק ל-`test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage`.

- [ ] **Step 8: קבע**

```bash
git add upload.html scripts/test-pdf-split.js
git commit -m "feat: a PDF becomes one sketch per page"
```

---

### Task 6: בדיקה ידנית של ה-PDF

- [ ] **Step 1:** העלה PDF בן 3 עמודים לבדו → 3 הזמנות, `L####-1/-2/-3`.
- [ ] **Step 2:** כל אחת מציגה את **העמוד הנכון** בתור הסקיצות.
- [ ] **Step 3:** כתב יד על העמוד **קריא** בגודל מלא. אם לא — העלה את המכפיל בשלב 2 של משימה 5 מ-`* 2` ל-`* 3`.
- [ ] **Step 4:** ערוך והדגש על עמוד מ-PDF. ההדגשה נשמרת ומגיעה לשרטט ולתחנת הבדיקה.
- [ ] **Step 5:** 2 תמונות + PDF בן 3 עמודים ביחד → **5** הזמנות.
- [ ] **Step 6:** PDF בן 25 עמודים → הודעת שגיאה ברורה, לא תקיעה.
- [ ] **Step 7:** בנייד — ההתקדמות "עמוד 2 מתוך 5" נראית, והדף לא קורס.
- [ ] **Step 8:** בדוק את נפח הבסיס אחרי כמה העלאות PDF — עמוד אמור לשקול כמו צילום.

---

## סדר העלייה

אמינות (1–3) עולה **בנפרד ולפני** ה-PDF (4–6). היא מגנה על כל השאר, כולל על ה-PDF עצמו, וכדאי שתרוץ כמה ימים לבד לפני שנוסיף עליה ספרייה חדשה.
