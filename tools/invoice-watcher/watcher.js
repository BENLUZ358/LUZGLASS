'use strict';
// ═══════════════════════════════════════════════════════════════════
//  tools/invoice-watcher — רץ במחשב של המשרד (DB-00004).
//
//  עוקב אחרי תיקיית הפלט של מדפסת ה-PDF. חשבשבת מדפיס מקור והעתק כשתי עבודות
//  הדפסה — שני קבצים של עמוד אחד; הכלי קורא מכל קובץ "מקור"/"העתק" ומספר
//  חשבונית, ומצמיד את השניים לפי המספר. (קובץ אחד בן שני עמודים — מפוצל.)
//  מעלה מקור+העתק לשרת, ואחרי שהשרת אישר — מתייק את שניהם בתיקיית הלקוחות
//  (sharedRoot) לפי הלקוח והתאריך שהשרת החזיר (בן, 2/11):
//    <לקוח>/<שנה-חודש>/<מספר> <לקוח> מקור <יום-חודש-שנה>.pdf  (+ אותו דבר "העתק")
//
//  תיקיית ההדפסות נשארת ריקה: מה שטופל, מה שלבדיקה ומה שממתין לתיוק עוברים
//  לתיקיות שליד תיקיית ההדפסות — לא בתוכה. (2/11 נשמרה חשבונית בטעות ל-done/
//  שבתוך ההדפסות, והכלי לא ראה אותה.)
//
//  כללי בטיחות:
//    • קובץ ההדפסה לא נמחק ולא זז עד ששני הקבצים תויקו.
//    • שרת סירב (422: לא זוהה/לא אומת מקור-העתק) → הקובץ עובר ל"לבדיקה", לא נשלח.
//    • אין רשת / השרת נפל → הקובץ נשאר, וינסה שוב בסבב הבא.
//
//  הרצה:  node watcher.js [config.json]
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

//  ── פונקציות טהורות (נבדקות ב-scripts/test-invoice-pdf.js) ──

//  מסלול יחסי מהשרת ('2026/10/לקוח/2026-10-27_12345.pdf') → נתיב בתיקייה השיתופית.
//  מסרב לכל מה שיוצא מהשורש (.., נתיב מוחלט).
function resolveArchive(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\')) return null;
  const parts = rel.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return null;
  const full = path.resolve(root, ...parts);
  const base = path.resolve(root) + path.sep;
  return full.startsWith(base) ? full : null;
}

//  נתיב הארכיון מהשרת ('2026/11/לקוח/2026-11-02_67393.pdf') → שני הקבצים המתויקים:
//  <root>/לקוח/2026-11/67393 לקוח מקור 02-11-2026.pdf (ו"העתק"). null אם הנתיב לא בתבנית.
function filedPaths(root, rel) {
  if (!resolveArchive(root, rel)) return null;
  const parts = rel.split('/');
  if (parts.length !== 4) return null;
  const [, , client, file] = parts;
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{1,12})\.pdf$/);
  if (!m) return null;
  const [, y, mo, d, doc] = m;
  const one = role => resolveArchive(root, `${client}/${y}-${mo}/${doc} ${client} ${role} ${d}-${mo}-${y}.pdf`);
  const original = one('מקור'), copy = one('העתק');
  return original && copy ? { original, copy } : null;
}

//  תיקיות העזר — ליד תיקיית ההדפסות, לא בתוכה (אפשר לדרוס ב-config).
function sideDirs(cfg) {
  const up = path.dirname(path.resolve(cfg.watchDir));
  return {
    done:   cfg.doneDir   || path.join(up, '_הדפסות שטופלו'),
    review: cfg.reviewDir || path.join(up, 'לבדיקה'),
  };
}

//  מפצל PDF של שני עמודים לשני קבצים. זורק אם מספר העמודים אינו 2.
async function splitTwoPages(bytes) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(bytes);
  if (src.getPageCount() !== 2) throw new Error('expected 2 pages, got ' + src.getPageCount());
  const one = async i => {
    //  בלי חותמת זמן: ניסיון חוזר מייצר בדיוק אותם בתים, והשרת מזהה אותו (hash)
    const d = await PDFDocument.create({ updateMetadata: false });
    const [p] = await d.copyPages(src, [i]);
    d.addPage(p);
    return Buffer.from(await d.save());
  };
  return { original: await one(0), copy: await one(1) };
}

//  אותו זיהוי כמו בשרת (api/_invoice-match.js) — השרת בודק שוב, זה רק להצמדה.
//  "העתק" גובר: דף שכתוב בו העתק לעולם לא ייחשב מקור.
const _norm = t => String(t || '').replace(/\s+/g, ' ');
function roleOf(text) {
  const t = _norm(text);
  if (t.includes('העתק')) return 'copy';
  if (t.includes('מקור')) return 'original';
  return null;
}
function docNumberOf(text) {
  const m = _norm(text).match(/(?:חשבונית(?: מס)?(?: קבלה)?|מס'|מספר)\s*[:#]?\s*(\d{4,9})(?!\d)/);
  return m ? m[1] : null;
}

//  קבצים של עמוד אחד שחיכו להצמדה → זוגות (מקור + העתקים, לפי מספר חשבונית)
//  וקבצים שחיכו יותר מדי בלי בן זוג (→ review).
//  entries: [[file, { role, doc, at }]]
function groupSingles(entries, now, waitMs) {
  const byDoc = new Map();
  for (const [file, e] of entries) {
    if (!byDoc.has(e.doc)) byDoc.set(e.doc, { original: [], copy: [] });
    byDoc.get(e.doc)[e.role].push({ file, at: e.at });
  }
  const pairs = [], stale = [];
  for (const [doc, g] of byDoc) {
    g.original.sort((a, b) => a.at - b.at);
    if (g.original.length && g.copy.length) {
      pairs.push({ doc, original: g.original[0].file, copies: g.copy.map(c => c.file) });
      //  מקור שהודפס פעמיים — השני לבדיקה ידנית אחרי ההמתנה
      for (const o of g.original.slice(1)) if (now - o.at > waitMs) stale.push(o.file);
    } else {
      for (const x of [...g.original, ...g.copy]) if (now - x.at > waitMs) stale.push(x.file);
    }
  }
  return { pairs, stale };
}

//  מה זה הקובץ, לפי הטקסט של כל העמודים:
//    { split: true }                    — 2 עמודים, מקור ואחריו העתק (קובץ אחד לשניהם)
//    { split: false, role, doc }        — מקור או העתק, עמוד אחד או יותר (חשבונית ארוכה,
//                                         בן 2/11 — 67395: מקור 2 עמודים, העתק 2 עמודים)
//    null                               — לא חשבונית
function fileKind(texts) {
  const roles = texts.map(roleOf);
  if (texts.length === 2 && roles[0] === 'original' && roles[1] === 'copy') return { split: true };
  const role = roles[0], doc = docNumberOf(texts[0] || '');
  return role && doc ? { split: false, role, doc } : null;
}

let _pdfjsP = null;
function _pdfjs() {
  if (!_pdfjsP) _pdfjsP = (async () => {
    globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return _pdfjsP;
}

//  { pages, text, texts } — text = העמוד הראשון, texts = כל העמודים (עד 5)
async function readPdf(bytes) {
  const pdfjs = await _pdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const texts = [];
    for (let n = 1; n <= Math.min(doc.numPages, 5); n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      texts.push(tc.items.map(i => i.str).join(' '));
    }
    return { pages: doc.numPages, text: texts[0], texts };
  } finally { await doc.destroy().catch(() => {}); }
}

//  ── ריצה ──

function loadConfig(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['watchDir', 'sharedRoot', 'url', 'token']) if (!c[k]) throw new Error('config missing ' + k);
  return { intervalMs: 5000, ...c };
}

//  קובץ פתוח בתוכנה אחרת (אקרובט נפתח לבד אחרי השמירה) — Windows לא נותן
//  להזיז אותו. הטיפול בו כבר נגמר, ולכן לא נכשלים: מזיזים כשייסגר.
const deferred = new Map();   // file → dir
const _rename = (file, dir) => fs.renameSync(file, path.join(dir, Date.now() + '_' + path.basename(file)));
const move = (file, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  try { _rename(file, dir); }
  catch (e) {
    if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    deferred.set(file, dir);
  }
};
function retryDeferred() {
  for (const [file, dir] of deferred) {
    if (!fs.existsSync(file)) { deferred.delete(file); continue; }
    try { _rename(file, dir); deferred.delete(file); } catch (_) { /* עדיין פתוח */ }
  }
}

//  קובץ אחד בן שני עמודים (מקור + העתק)
async function processFile(cfg, file, post = require_post(cfg)) {
  let parts;
  try { parts = await splitTwoPages(fs.readFileSync(file)); }
  catch (e) { console.error('review (split):', path.basename(file), e.message); move(file, sideDirs(cfg).review); return 'review'; }
  return upload(cfg, parts, [file], post);
}

//  שני קבצים של עמוד אחד (העתקים נוספים — "העתק 2" — עוברים יחד איתם)
async function processPair(cfg, pair, post = require_post(cfg)) {
  const parts = { original: fs.readFileSync(pair.original), copy: fs.readFileSync(pair.copies[0]) };
  return upload(cfg, parts, [pair.original, ...pair.copies], post);
}

async function upload(cfg, parts, files, post) {
  const file = files[0];
  const dirs = sideDirs(cfg);
  const moveAll = dir => files.forEach(f => move(f, dirs[dir]));
  let r;
  try { r = await post({ original: parts.original.toString('base64'), copy: parts.copy.toString('base64') }); }
  catch (e) { console.error('retry later (network):', e.message); return 'retry'; }

  if (r.status >= 500 || r.status === 429) return 'retry';
  //  202: הודפסה, אבל החשבונית עוד לא נרשמה בתחנה ("החשבונית הופקה"). הקובץ נשאר
  //  ומועלה שוב בסבב הבא — ההעלאה החוזרת מזוהה לפי hash ומשתייכת ברגע שהחשבונית נרשמת.
  if (r.status === 202 && r.body && r.body.pending) { console.log('waiting for registration:', path.basename(file)); return 'retry'; }
  if (!r.body || !r.body.ok) {
    console.error('review:', path.basename(file), r.status, r.body && r.body.code);
    moveAll('review'); return 'review';
  }
  const dest = filedPaths(cfg.sharedRoot, r.body.archivePath);
  if (!dest) { moveAll('review'); return 'review'; }
  //  ההעתק לנייר — רק בפעם הראשונה שהוא מתויק (הדפסה חוזרת מחשבשבת לא מוציאה דף נוסף)
  const print = !!cfg.printCopyTo && !r.body.reprint && !fs.existsSync(dest.copy);
  try {
    fs.mkdirSync(path.dirname(dest.original), { recursive: true });
    fs.writeFileSync(dest.original, parts.original);
    fs.writeFileSync(dest.copy, parts.copy);
  } catch (e) {
    //  תיקיית הלקוחות לא זמינה: קובץ ההדפסה נשאר במקומו ומנסים שוב בסבב הבא
    //  (הדפסה חוזרת מזוהה בשרת לפי hash — לא נשלח ללקוח פעמיים)
    console.error('filing folder unavailable, retry later:', e.message);
    return 'retry';
  }
  moveAll('done');
  console.log('ok', r.body.docNumber, '→', path.dirname(dest.original));
  if (print) {
    //  מדפסת כבויה / תקועה — החשבונית כבר תויקה ונשלחה; מדפיסים ידנית מהתיקייה
    try { await (cfg.printFn || printWithGs)(dest.copy, cfg.printCopyTo, cfg); console.log('printed copy', r.body.docNumber); }
    catch (e) { console.error('print failed (file is filed):', r.body.docNumber, e.message); }
  }
  return 'ok';
}

//  הדפסה שקטה (בלי חלון) דרך Ghostscript שמגיע עם PDF24 (בן, 2/11)
function printWithGs(file, printer, cfg) {
  const gs = (cfg && cfg.gsPath) || 'C:\\Program Files\\PDF24\\gs\\bin\\gswin64c.exe';
  return new Promise((resolve, reject) => {
    require('child_process').execFile(gs,
      ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-dNoCancel', '-sDEVICE=mswinpr2', '-r300',
       '-sOutputFile=%printer%' + printer, file],
      { timeout: 120000, windowsHide: true },
      (err, _out, errOut) => err ? reject(new Error(String(errOut || err.message).trim())) : resolve());
  });
}

function require_post(cfg) {
  return async body => {
    const res = await fetch(cfg.url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

//  קובץ נחשב מוכן כשהגודל לא השתנה בין שני סבבים (המדפסת עדיין כותבת).
//  קובץ של עמוד אחד מחכה לבן הזוג שלו עד pairWaitMs, ואז עובר ל-review.
async function loop(cfg) {
  const sizes = new Map(), retryAt = new Map(), singles = new Map();
  const review = f => { try { move(f, sideDirs(cfg).review); } catch (_) {} };
  for (;;) {
    //  סבב שנכשל (קובץ נעלם, תיקייה לא זמינה) לא מפיל את הכלי — מנסים בסבב הבא
    try {
      retryDeferred();
      for (const n of fs.readdirSync(cfg.watchDir)) {
        if (!/\.pdf$/i.test(n)) continue;
        const f = path.join(cfg.watchDir, n);
        if (deferred.has(f) || singles.has(f) || (retryAt.get(f) || 0) > Date.now()) continue;
        const sz = fs.statSync(f).size;
        if (!(sz > 0 && sizes.get(f) === sz)) { sizes.set(f, sz); continue; }
        sizes.delete(f);
        let info;
        try { info = await readPdf(fs.readFileSync(f)); }
        catch (e) { console.error('review (unreadable):', n, e.message); review(f); continue; }
        const kind = info.pages <= 5 ? fileKind(info.texts) : null;
        if (kind && kind.split) {
          const out = await processFile(cfg, f);
          if (out === 'retry') retryAt.set(f, Date.now() + (cfg.retryMs || 60000));
          else retryAt.delete(f);
          continue;
        }
        if (!kind) { console.error('review (not an invoice):', n); review(f); continue; }
        singles.set(f, { role: kind.role, doc: kind.doc, at: Date.now() });
      }
      //  קובץ שמישהו מחק / העביר בזמן שחיכה — שוכחים אותו (בלי זה הכלי קורס)
      for (const f of [...singles.keys()]) if (!fs.existsSync(f)) { singles.delete(f); retryAt.delete(f); }
      const { pairs, stale } = groupSingles([...singles], Date.now(), cfg.pairWaitMs || 10 * 60000);
      for (const f of stale) { console.error('review (no pair):', path.basename(f)); singles.delete(f); review(f); }
      for (const pair of pairs) {
        if ((retryAt.get(pair.original) || 0) > Date.now()) continue;
        let out;
        try { out = await processPair(cfg, pair); }
        catch (e) { console.error('retry later:', path.basename(pair.original), e.message); out = 'retry'; }
        if (out === 'retry') { retryAt.set(pair.original, Date.now() + (cfg.retryMs || 60000)); continue; }
        retryAt.delete(pair.original);
        [pair.original, ...pair.copies].forEach(f => singles.delete(f));
      }
    } catch (e) { console.error('round failed, retrying:', e.message); }
    await new Promise(r => setTimeout(r, cfg.intervalMs));
  }
}

//  ── מדבקות (בן, 3/11) — מרכז ההדפסות ───────────────────────────────────
//  האייפד שולח מדבקות לשרת (/api/print, api/_print-jobs.js). הכלי הזה מושך
//  כל כמה שניות, שולח ל-TSC TE210 ברשת (TSPL בפורט 9100) ומדווח. כל מדבקה
//  היא תמונה ארוזה מהדפדפן (print-labels.js): 70 בתים לשורה × 560 שורות,
//  0 = נקודה מודפסת. עברית רק כתמונה — אין גופן עברי במדפסת.
//  config.json: "labelPrinter": {"host": "10.0.0.253", "port": 9100}
const LABEL_ROW_BYTES = 70, LABEL_ROWS = 560;

function tsplForBitmap(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length !== LABEL_ROW_BYTES * LABEL_ROWS) throw new Error('bad label bitmap: ' + raw.length + ' bytes');
  return Buffer.concat([
    Buffer.from('SIZE 70 mm,70 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,' + LABEL_ROW_BYTES + ',' + LABEL_ROWS + ',0,', 'latin1'),
    raw,
    Buffer.from('\r\nPRINT 1,1\r\n', 'latin1'),
  ]);
}

//  כל המדבקות בחיבור אחד. מחזיר {ok} / {ok:false, retryable, error}.
//  retryable — רק כשלא נשלח אף בית (מדפסת כבויה / לא ברשת): מותר לנסות שוב.
//  נשלח משהו ואז נפל — לא retryable (ייתכן שחלק יצא; בן מחליט).
function sendLabels(printer, bitmaps) {
  let data;
  try { data = Buffer.concat(bitmaps.map(tsplForBitmap)); }
  catch (e) { return Promise.resolve({ ok: false, retryable: false, error: e.message }); }
  return new Promise(resolve => {
    let sent = false, done = false;
    const end = r => { if (!done) { done = true; resolve(r); } };
    const sock = require('net').connect(Number(printer.port) || 9100, printer.host);
    sock.setTimeout(15000);
    sock.on('connect', () => { sent = true; sock.end(data); });
    sock.on('close', hadErr => { if (!hadErr) end({ ok: true }); });
    sock.on('timeout', () => { sock.destroy(); end({ ok: false, retryable: !sent, error: 'ETIMEDOUT' }); });
    sock.on('error', e => end({ ok: false, retryable: !sent, error: e.code || e.message }));
  });
}

//  סבב אחד: עבודה אחת לכל היותר.
async function printOnce(cfg, post, send) {
  const r = await post({ action: 'agent-claim' });
  const job = r && r.status === 200 && r.body && r.body.job;
  if (!job) return null;
  const out = await (send || sendLabels)(cfg.labelPrinter, job.bitmaps || []);
  if (out.ok) console.log('labels printed:', job.id, (job.bitmaps || []).length);
  else console.error('labels failed:', job.id, out.error);
  await post({ action: 'agent-done', id: job.id, ok: !!out.ok, retryable: !!out.retryable, error: out.error || '' });
  return out;
}

//  כתובת מרכז ההדפסות — מאותו אתר כמו העלאת החשבוניות, אלא אם הוגדר printUrl
const printUrl = cfg => cfg.printUrl || new URL('/api/print', cfg.url).href;

async function printLoop(cfg) {
  const post = require_post({ ...cfg, url: printUrl(cfg) });
  for (;;) {
    try { while (await printOnce(cfg, post)) { /* עוד עבודות בתור */ } }
    catch (e) { console.error('labels round failed:', e.message); }
    await new Promise(r => setTimeout(r, cfg.labelPollMs || 3000));
  }
}

module.exports = { tsplForBitmap, sendLabels, printOnce, resolveArchive, filedPaths, sideDirs, fileKind, splitTwoPages, processFile, processPair, groupSingles, roleOf, docNumberOf, readPdf };

if (require.main === module) {
  const cfg = loadConfig(process.argv[2] || path.join(__dirname, 'config.json'));
  //  מדבקות — לולאה נפרדת, כדי שחשבונית ארוכה לא תעכב מדבקות (ולהפך)
  if (cfg.labelPrinter && cfg.labelPrinter.host) printLoop(cfg).catch(e => console.error('labels loop:', e));
  loop(cfg).catch(e => { console.error(e); process.exit(1); });
}
