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
//  PDF24 מוגדר בחשבשבת לתמיד (בן, 10/11) — כל הדפסה מחשבשבת מגיעה לכאן, והכלל:
//  **מה שהודפס תמיד יוצא על נייר** (cfg.printCopyTo — ה-Brother):
//    • חשבונית של לקוח במערכת → נשלחת, מתויקת, וההעתק מודפס (כמו קודם).
//    • "העתק משוחזר" → נשלח ללקוח (אם לא נשלח קודם) ומודפס פעם אחת.
//    • חשבונית של לקוח שלא במערכת (השרת: known=false) → מקור והעתק על נייר מיד,
//      ועותק בתיקיית הלקוחות תחת "לקוחות שלא במערכת".
//    • לקוח במערכת שאין לו התאמה אחרי pendingPaperMs (10 דק') → על נייר.
//    • מסמך שאינו חשבונית (תעודת משלוח, דוח...) → על נייר כמו שהוא.
//    • השרת סירב / לא נקרא / אין בן זוג → על נייר, והקובץ ל"לבדיקה".
//
//  כללי בטיחות:
//    • קובץ ההדפסה לא נמחק ולא זז עד ששני הקבצים תויקו (או הודפסו על נייר).
//    • אין רשת / השרת נפל → הקובץ נשאר, וינסה שוב בסבב הבא; אחרי pendingPaperMs — נייר.
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
//    { split: false, role:'copy', doc, restored: true } — "העתק משוחזר": לא מחכה לבן זוג
function fileKind(texts) {
  const roles = texts.map(roleOf);
  if (texts.length === 2 && roles[0] === 'original' && roles[1] === 'copy') return { split: true };
  const role = roles[0], doc = docNumberOf(texts[0] || '');
  if (!(role && doc)) return null;
  //  חשבונית מס בלבד — "חשבונית" בעמוד. מסמך אחר עם "מקור"/"העתק" (תעודת משלוח) הוא לא חשבונית.
  if (!_norm(texts[0]).includes('חשבונית')) return null;
  const restored = role === 'copy' && texts.every(t => _norm(t).includes('משוחזר'));
  return restored ? { split: false, role, doc, restored: true } : { split: false, role, doc };
}

//  מספר המסמך משם הקובץ של חשבשבת: "H-erp Document RtL - HDoc10.ard - 348338_67423_249926.pdf"
function docFromName(file) {
  const m = path.basename(String(file || '')).match(/_(\d{4,9})_\d+(?: \(\d+\))?\.pdf$/i);
  return m ? m[1] : null;
}

//  לאן נשמר עותק של חשבונית שהודפסה על נייר כי הלקוח לא במערכת
function paperArchivePath(root, doc, now) {
  const d = new Date(now || Date.now());
  const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const dmy = String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
  return resolveArchive(root, `לקוחות שלא במערכת/${ym}/${String(doc || 'ללא מספר').replace(/[^\d]/g, '') || 'ללא מספר'} ${dmy}.pdf`);
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
async function processFile(cfg, file, post = require_post(cfg), firstAt) {
  let parts;
  try { parts = await splitTwoPages(fs.readFileSync(file)); }
  catch (e) { console.error('review (split):', path.basename(file), e.message); await paper(cfg, [file], 'review', 'split'); return 'review'; }
  return upload(cfg, parts, [file], post, { firstAt });
}

//  שני קבצים של עמוד אחד (העתקים נוספים — "העתק 2" — עוברים יחד איתם)
async function processPair(cfg, pair, post = require_post(cfg), firstAt) {
  const parts = { original: fs.readFileSync(pair.original), copy: fs.readFileSync(pair.copies[0]) };
  return upload(cfg, parts, [pair.original, ...pair.copies], post, { firstAt, doc: pair.doc });
}

//  "העתק משוחזר" — קובץ אחד, נשלח כמקור וכהעתק (השרת בודק שכתוב בו "משוחזר")
async function processRestored(cfg, file, post = require_post(cfg), firstAt, doc) {
  const buf = fs.readFileSync(file);
  return upload(cfg, { original: buf, copy: buf }, [file], post, { firstAt, restored: true, doc });
}

//  ── נייר ──
//  מדפיס את הקבצים כמו שהם ב-Brother, ואז מזיז אותם (done / review).
//  הדפסה שנכשלה (מדפסת כבויה): הקובץ בכל זאת זז, והשגיאה ביומן — לא מדפיסים
//  בלולאה אינסופית. archive: נתיב לעותק בתיקיית הלקוחות (לקוח שלא במערכת).
async function paper(cfg, files, dir, why, archive) {
  const printer = cfg.printCopyTo;
  for (const f of files) {
    if (!printer) { console.error('paper: no printer configured —', path.basename(f)); break; }
    try { await (cfg.printFn || printWithGs)(f, printer, cfg); console.log('paper (' + why + '):', path.basename(f)); }
    catch (e) { console.error('paper failed (' + why + '):', path.basename(f), e.message); }
  }
  if (archive) {
    try { fs.mkdirSync(path.dirname(archive), { recursive: true });
          if (!fs.existsSync(archive)) fs.copyFileSync(files[0], archive); }
    catch (e) { console.error('paper archive failed:', e.message); }
  }
  files.forEach(f => { try { move(f, sideDirs(cfg)[dir]); } catch (e) { console.error('move failed:', e.message); } });
  return dir === 'review' ? 'review' : 'paper';
}

async function upload(cfg, parts, files, post, opts = {}) {
  const file = files[0];
  const dirs = sideDirs(cfg);
  const moveAll = dir => files.forEach(f => move(f, dirs[dir]));
  const waitedTooLong = () => opts.firstAt && Date.now() - opts.firstAt > (cfg.pendingPaperMs || 10 * 60000);
  let r;
  try { r = await post({ original: parts.original.toString('base64'), copy: parts.copy.toString('base64'),
                         ...(opts.restored ? { restored: true } : {}) }); }
  catch (e) {
    console.error('retry later (network):', e.message);
    return waitedTooLong() ? paper(cfg, files, 'review', 'no server') : 'retry';
  }

  if (r.status >= 500 || r.status === 429) return waitedTooLong() ? paper(cfg, files, 'review', 'server ' + r.status) : 'retry';
  //  202: הודפסה, אבל אין חשבונית רשומה שמתאימה.
  //  לקוח שלא במערכת (known=false) → נייר מיד. לקוח במערכת → מנסים שוב, ואחרי
  //  pendingPaperMs → נייר (בן, 10/11: שום חשבונית לא נתקעת כמו 67423).
  if (r.status === 202 && r.body && r.body.pending) {
    if (r.body.known === false) {
      return paper(cfg, files, 'done', 'not in system', paperArchivePath(cfg.sharedRoot, opts.doc || docFromName(file)));
    }
    if (waitedTooLong()) return paper(cfg, files, 'done', 'no match after wait');
    console.log('waiting for registration:', path.basename(file)); return 'retry';
  }
  if (!r.body || !r.body.ok) {
    console.error('review:', path.basename(file), r.status, r.body && r.body.code);
    return paper(cfg, files, 'review', 'refused ' + (r.body && r.body.code || r.status));
  }
  const dest = filedPaths(cfg.sharedRoot, r.body.archivePath);
  if (!dest) return paper(cfg, files, 'review', 'bad archive path');
  //  העתק משוחזר: תמיד יוצא על נייר פעם אחת, ולא דורס את המקור שכבר מתויק
  if (opts.restored) {
    try {
      fs.mkdirSync(path.dirname(dest.original), { recursive: true });
      if (!fs.existsSync(dest.original)) fs.writeFileSync(dest.original, parts.original);
      if (!fs.existsSync(dest.copy)) fs.writeFileSync(dest.copy, parts.copy);
    } catch (e) { console.error('filing folder unavailable, retry later:', e.message); return 'retry'; }
    console.log('ok (restored)', r.body.docNumber, r.body.reprint ? '(already sent before — not sent again)' : '');
    return paper(cfg, files, 'done', 'restored copy');
  }
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
  const sizes = new Map(), retryAt = new Map(), singles = new Map(), firstAt = new Map();
  const first = f => { if (!firstAt.has(f)) firstAt.set(f, Date.now()); return firstAt.get(f); };
  const review = f => paper(cfg, [f], 'review', 'review').catch(e => console.error('paper:', e.message));
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
        catch (e) { console.error('review (unreadable):', n, e.message); await review(f); continue; }
        const kind = info.pages <= 5 ? fileKind(info.texts) : null;
        if (kind && (kind.split || kind.restored)) {
          let out;
          try { out = kind.split ? await processFile(cfg, f, undefined, first(f))
                                 : await processRestored(cfg, f, undefined, first(f), kind.doc); }
          catch (e) { console.error('retry later:', n, e.message); out = 'retry'; }
          if (out === 'retry') retryAt.set(f, Date.now() + (cfg.retryMs || 60000));
          else { retryAt.delete(f); firstAt.delete(f); }
          continue;
        }
        //  לא חשבונית (תעודת משלוח, דוח...) — יוצא על נייר כמו שהוא
        if (!kind) { await paper(cfg, [f], 'done', 'not an invoice'); continue; }
        singles.set(f, { role: kind.role, doc: kind.doc, at: Date.now() });
      }
      //  קובץ שמישהו מחק / העביר בזמן שחיכה — שוכחים אותו (בלי זה הכלי קורס)
      for (const f of [...singles.keys()]) if (!fs.existsSync(f)) { singles.delete(f); retryAt.delete(f); firstAt.delete(f); }
      const { pairs, stale } = groupSingles([...singles], Date.now(), cfg.pairWaitMs || 10 * 60000);
      for (const f of stale) { console.error('review (no pair):', path.basename(f)); singles.delete(f); await review(f); }
      for (const pair of pairs) {
        if ((retryAt.get(pair.original) || 0) > Date.now()) continue;
        let out;
        try { out = await processPair(cfg, pair, undefined, first(pair.original)); }
        catch (e) { console.error('retry later:', path.basename(pair.original), e.message); out = 'retry'; }
        if (out === 'retry') { retryAt.set(pair.original, Date.now() + (cfg.retryMs || 60000)); continue; }
        retryAt.delete(pair.original); firstAt.delete(pair.original);
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
//  "הודפס" = כל הבתים נכתבו לחיבור ונשלחו (finish) — גם אם המדפסת משאירה את
//  החיבור פתוח ולא סוגרת (אז אחרי timeoutMs מסיימים). בלי זה הדפסה שיצאה הייתה
//  מסומנת "נכשל", ובן היה מדפיס שוב — כפול.
//  retryable — רק כשלא התחברנו בכלל (מדפסת כבויה / לא ברשת): שום דבר לא נשלח.
//  התחברנו ונפל באמצע — לא retryable (ייתכן שחלק יצא; בן מחליט).
function sendLabels(printer, bitmaps) {
  let data;
  try { data = Buffer.concat(bitmaps.map(tsplForBitmap)); }
  catch (e) { return Promise.resolve({ ok: false, retryable: false, error: e.message }); }
  return new Promise(resolve => {
    let connected = false, finished = false, done = false;
    const end = r => { if (!done) { done = true; resolve(r); } };
    const sock = require('net').connect(Number(printer.port) || 9100, printer.host);
    sock.setTimeout(printer.timeoutMs || 15000);
    sock.on('connect', () => {
      connected = true;
      sock.end(data, () => { finished = sock.bytesWritten >= data.length; if (finished) sock.setTimeout(printer.timeoutMs || 5000); });
    });
    sock.on('close', () => end(finished ? { ok: true } : { ok: false, retryable: !connected, error: connected ? 'החיבור נסגר באמצע' : 'ECONNRESET' }));
    sock.on('timeout', () => { sock.destroy(); end(finished ? { ok: true } : { ok: false, retryable: !connected, error: 'ETIMEDOUT' }); });
    sock.on('error', e => end(finished ? { ok: true } : { ok: false, retryable: !connected, error: e.code || e.message }));
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
    //  עוד עבודות בתור — ברצף. סבב שנכשל (מדפסת כבויה) עוצר עד הסבב הבא
    try { for (let out = await printOnce(cfg, post); out && out.ok; out = await printOnce(cfg, post)) { /* הבאה */ } }
    catch (e) { console.error('labels round failed:', e.message); }
    //  כל 10 שניות — מספיק מהר לאייפד, ולא עומס על השרת (כ-260 אלף קריאות בחודש)
    await new Promise(r => setTimeout(r, cfg.labelPollMs || 10000));
  }
}

module.exports = { loop, tsplForBitmap, sendLabels, printOnce, resolveArchive, filedPaths, sideDirs, fileKind, splitTwoPages, processFile, processPair, processRestored, paper, paperArchivePath, docFromName, groupSingles, roleOf, docNumberOf, readPdf };

if (require.main === module) {
  const cfg = loadConfig(process.argv[2] || path.join(__dirname, 'config.json'));
  //  מדבקות — לולאה נפרדת, כדי שחשבונית ארוכה לא תעכב מדבקות (ולהפך)
  if (cfg.labelPrinter && cfg.labelPrinter.host) printLoop(cfg).catch(e => console.error('labels loop:', e));
  loop(cfg).catch(e => { console.error(e); process.exit(1); });
}
