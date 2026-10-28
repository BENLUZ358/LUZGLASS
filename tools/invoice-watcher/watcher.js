'use strict';
// ═══════════════════════════════════════════════════════════════════
//  tools/invoice-watcher — רץ במחשב של המשרד (DB-00004).
//
//  עוקב אחרי תיקיית הפלט של מדפסת ה-PDF. חשבונית מודפסת = PDF בן שני עמודים
//  (1 = מקור, 2 = העתק). הכלי מפצל, מעלה את שני העמודים לשרת, ואחרי שהשרת
//  אישר — כותב את ההעתק לתיקייה השיתופית לפי הנתיב שהשרת החזיר (שנה/חודש/לקוח).
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

async function processFile(cfg, file, post = require_post(cfg)) {
  let parts;
  try { parts = await splitTwoPages(fs.readFileSync(file)); }
  catch (e) { console.error('review (split):', path.basename(file), e.message); move(file, path.join(cfg.watchDir, 'review')); return 'review'; }

  let r;
  try { r = await post({ original: parts.original.toString('base64'), copy: parts.copy.toString('base64') }); }
  catch (e) { console.error('retry later (network):', e.message); return 'retry'; }

  if (r.status >= 500 || r.status === 429) return 'retry';
  //  הודפסה, אבל עוד לא נרשם "החשבונית הופקה" בתחנה. השרת שמר אותה ומשייך כשיירשם;
  //  הקובץ נשאר ונשלח שוב (אותו hash) עד שמתקבל נתיב ארכיון.
  if (r.status === 202 && r.body && r.body.held) { console.log('held, waiting for registration:', path.basename(file)); return 'hold'; }
  if (!r.body || !r.body.ok) {
    console.error('review:', path.basename(file), r.status, r.body && r.body.code);
    move(file, path.join(cfg.watchDir, 'review')); return 'review';
  }
  const dest = resolveArchive(cfg.sharedRoot, r.body.archivePath);
  if (!dest) { move(file, path.join(cfg.watchDir, 'review')); return 'review'; }
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
  move(file, path.join(cfg.watchDir, 'done'));
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
async function loop(cfg) {
  const sizes = new Map();
  const nextTry = new Map();   // 'hold' → ניסיון חוזר רק כל דקה
  for (;;) {
    for (const n of fs.readdirSync(cfg.watchDir)) {
      if (!/\.pdf$/i.test(n)) continue;
      const f = path.join(cfg.watchDir, n);
      if ((nextTry.get(f) || 0) > Date.now()) continue;
      const sz = fs.statSync(f).size;
      if (sz > 0 && sizes.get(f) === sz) {
        const out = await processFile(cfg, f);
        if (out === 'hold') nextTry.set(f, Date.now() + (cfg.holdRetryMs || 60000));
        else nextTry.delete(f);
        if (out !== 'retry' && out !== 'hold') sizes.delete(f);
      } else sizes.set(f, sz);
    }
    await new Promise(r => setTimeout(r, cfg.intervalMs));
  }
}

module.exports = { resolveArchive, splitTwoPages, processFile };

if (require.main === module) {
  loop(loadConfig(process.argv[2] || path.join(__dirname, 'config.json')))
    .catch(e => { console.error(e); process.exit(1); });
}
