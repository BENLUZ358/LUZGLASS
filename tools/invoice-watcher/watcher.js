'use strict';
// ═══════════════════════════════════════════════════════════════════
//  tools/invoice-watcher — רץ במחשב של המשרד (DB-00004).
//
//  עוקב אחרי תיקיית הפלט של מדפסת ה-PDF. חשבשבת מדפיס מקור והעתק כשתי עבודות
//  הדפסה — שני קבצים של עמוד אחד; הכלי קורא מכל קובץ "מקור"/"העתק" ומספר
//  חשבונית, ומצמיד את השניים לפי המספר. (קובץ אחד בן שני עמודים — מפוצל.)
//  מעלה מקור+העתק לשרת, ואחרי שהשרת אישר — כותב את ההעתק לתיקייה השיתופית
//  לפי הנתיב שהשרת החזיר (שנה/חודש/לקוח).
//
//  כללי בטיחות:
//    • קובץ המקור לא נמחק ולא זז עד שההעתק נכתב בתיקייה השיתופית.
//    • שרת סירב (422: לא זוהה/לא אומת מקור-העתק) → הקובץ עובר ל-review/, לא נשלח.
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

let _pdfjsP = null;
function _pdfjs() {
  if (!_pdfjsP) _pdfjsP = (async () => {
    globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return _pdfjsP;
}

//  { pages, text } — טקסט העמוד הראשון בלבד (מספיק לזיהוי)
async function readPdf(bytes) {
  const pdfjs = await _pdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    return { pages: doc.numPages, text: tc.items.map(i => i.str).join(' ') };
  } finally { await doc.destroy().catch(() => {}); }
}

//  ── ריצה ──

function loadConfig(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['watchDir', 'sharedRoot', 'url', 'token']) if (!c[k]) throw new Error('config missing ' + k);
  return { intervalMs: 5000, ...c };
}

const move = (file, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(file, path.join(dir, Date.now() + '_' + path.basename(file)));
};

//  קובץ אחד בן שני עמודים (מקור + העתק)
async function processFile(cfg, file, post = require_post(cfg)) {
  let parts;
  try { parts = await splitTwoPages(fs.readFileSync(file)); }
  catch (e) { console.error('review (split):', path.basename(file), e.message); move(file, path.join(cfg.watchDir, 'review')); return 'review'; }
  return upload(cfg, parts, [file], post);
}

//  שני קבצים של עמוד אחד (העתקים נוספים — "העתק 2" — עוברים יחד איתם)
async function processPair(cfg, pair, post = require_post(cfg)) {
  const parts = { original: fs.readFileSync(pair.original), copy: fs.readFileSync(pair.copies[0]) };
  return upload(cfg, parts, [pair.original, ...pair.copies], post);
}

async function upload(cfg, parts, files, post) {
  const file = files[0];
  const moveAll = dir => files.forEach(f => move(f, path.join(cfg.watchDir, dir)));
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
  const dest = resolveArchive(cfg.sharedRoot, r.body.archivePath);
  if (!dest) { moveAll('review'); return 'review'; }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, parts.copy);
  } catch (e) {
    //  תיקייה שיתופית לא זמינה: שומרים מקומית ומנסים שוב, המקור נשאר במקומו
    console.error('shared folder unavailable, retry later:', e.message);
    const keep = path.join(cfg.watchDir, 'pending-copy');
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, r.body.archivePath.replace(/\//g, '__')), parts.copy);
    return 'retry';
  }
  moveAll('done');
  console.log('ok', r.body.docNumber, '→', dest);
  return 'ok';
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
  const review = f => { try { move(f, path.join(cfg.watchDir, 'review')); } catch (_) {} };
  for (;;) {
    //  סבב שנכשל (קובץ נעלם, תיקייה לא זמינה) לא מפיל את הכלי — מנסים בסבב הבא
    try {
      for (const n of fs.readdirSync(cfg.watchDir)) {
        if (!/\.pdf$/i.test(n)) continue;
        const f = path.join(cfg.watchDir, n);
        if (singles.has(f) || (retryAt.get(f) || 0) > Date.now()) continue;
        const sz = fs.statSync(f).size;
        if (!(sz > 0 && sizes.get(f) === sz)) { sizes.set(f, sz); continue; }
        sizes.delete(f);
        let info;
        try { info = await readPdf(fs.readFileSync(f)); }
        catch (e) { console.error('review (unreadable):', n, e.message); review(f); continue; }
        if (info.pages === 2) {
          const out = await processFile(cfg, f);
          if (out === 'retry') retryAt.set(f, Date.now() + (cfg.retryMs || 60000));
          else retryAt.delete(f);
          continue;
        }
        const role = roleOf(info.text), doc = docNumberOf(info.text);
        if (info.pages !== 1 || !role || !doc) { console.error('review (not an invoice page):', n); review(f); continue; }
        singles.set(f, { role, doc, at: Date.now() });
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

module.exports = { resolveArchive, splitTwoPages, processFile, processPair, groupSingles, roleOf, docNumberOf, readPdf };

if (require.main === module) {
  loop(loadConfig(process.argv[2] || path.join(__dirname, 'config.json')))
    .catch(e => { console.error(e); process.exit(1); });
}
