#!/usr/bin/env node
/**
 * test-sketch-api-guard.js — שכבת הסקיצה היא הדרך היחידה לגעת בתמונה.
 *
 * ─── למה ───────────────────────────────────────────────────────────────
 *
 * עד 2026-10-04 כעשרים מקומות במסכים קראו o.sketch ישירות. כל אחד מהם היה
 * נשבר בשקט ברגע שהעותק בתוך orders/ ייעלם — וסקיצת WhatsApp, שנשמרת
 * ב-sketches/<id> בלבד, הייתה נראית בהם כ"אין סקיצה". בפורטל זה היה אפילו
 * מציג סקיצה מחוללת במקום התמונה האמיתית.
 *
 * עכשיו מסך שואל רק lgHasSketch / lgLoadSketch / lgSketchIntoImg, ומחליף
 * דרך lgReplaceSketch. רק firebase-db.js יודע איפה התמונה יושבת — ולכן מעבר
 * עתידי (למשל Firebase Storage) הוא שינוי שם בלבד.
 *
 * חלק א' אוכף את הכלל על הקוד. חלק ב' מריץ את השכבה עצמה מול מסד מדומה.
 *
 * Run: node scripts/test-sketch-api-guard.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ═══ חלק א' · אף מסך לא קורא את התמונה ישירות ═══════════════════════ */

//  דפים שעובדים על localStorage בלבד, בלי Firebase. הם מחוץ לכלל — ונבדק
//  למטה שהם באמת לא נוגעים ב-Firebase, כדי שהפטור לא יהפוך לפרצה.
//  sketch-demo.html טוען את firebase-db.js (לעזרים), ולכן הוא **לא** פטור —
//  הוא נסרק כמו כל מסך.
const LOCAL_ONLY = ['order-view.html', 'mekhlahon.html', 'lg-preview.html', 'logo.html'];

const strip = src => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))        // שומר מספרי שורות
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');                          // // הערה, לא https://

const FORBIDDEN = [
  [/\.sketch(?![\w-])/, 'o.sketch'],                 // .sketch-view (CSS) ו-.sketchName אינם
  [/\bf0\.data\b/,       'files.f0.data'],
  [/\[\s*['"]sketch['"]\s*\]/, "o['sketch']"],
];

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !LOCAL_ONLY.includes(f));
const apis  = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f);
const hits = [];
for (const f of [...pages, ...apis]) {
  strip(read(f)).split('\n').forEach((line, i) => {
    for (const [re, what] of FORBIDDEN) if (re.test(line)) hits.push(`${f}:${i + 1} ${what}`);
  });
}
check('no page or API reads the sketch image directly', hits, []);
check('the scan actually covers the screens that show sketches',
      ['admin.html', 'workday.html', 'check-station.html', 'drafter.html', 'portal.html', 'invoices.html']
        .every(f => pages.includes(f)), true);

for (const f of LOCAL_ONLY) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  const s = read(f);
  check(`${f} really is local-only (no Firebase)`,
        /firebase-db\.js|firebase\.database\(|_lgDb\b/.test(s), false);
}

/* ═══ חלק ב' · השכבה עצמה, מול מסד מדומה ══════════════════════════════ */

const DB = read('firebase-db.js');
const fn = name => {
  const m = DB.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
};

function makeDb(initial) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  const get = p => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const put = (p, v) => { const ks = p.split('/'); let o = data; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = v; };
  const db = { data, reads: [], updates: [], failNext: false,
    ref(p) { return {
      once: async () => { db.reads.push(p); const v = get(p); return { exists: () => v !== undefined, val: () => (v === undefined ? null : v) }; },
      update: async upd => {
        if (p !== undefined && p !== '' && p !== '/') throw new Error('test expects root update');
        if (db.failNext) { db.failNext = false; throw new Error('offline'); }
        db.updates.push(Object.keys(upd).sort()); Object.entries(upd).forEach(([k, v]) => put(k, v));
      },
      set: async v => put(p, v),
    }; } };
  return db;
}

function sandbox(db, source) {
  const store = { lgSketchSource: source || 'old' };
  const observed = [];
  const ctx = {
    console, Promise, Map, Date, String,
    _lgDb: db,
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    IntersectionObserver: function (cb) { this.observe = el => observed.push({ el, cb, io: this }); this.unobserve = () => {}; },
    _observed: observed,
  };
  vm.createContext(ctx);
  vm.runInContext(['const _lgSketchCache = new Map();',
    fn('lgSketchSource'), fn('lgGetSketch'), fn('_lgInlineSketch'), fn('lgHasSketch'),
    fn('lgSketchFields'), fn('lgLoadSketch'), fn('lgReplaceSketch'),
    fn('lgHydrateSketchImgs'), fn('lgSketchIntoImg'),
    'this.cache = _lgSketchCache;'].join('\n'), ctx);
  return ctx;
}
const fakeImg = id => ({ src: '', dataset: {}, classList: { add() {} }, getAttribute: k => (k === 'data-sketch-for' ? id : null) });
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  const LEGACY = { id: 'p1', sketch: 'data:old', hasSketch: true };   // פורטל — שני עותקים
  const WA     = { id: 'w1', hasSketch: true };                        // WhatsApp — צומת בלבד
  const NONE   = { id: 'n1' };

  {
    const db = makeDb({ sketches: { p1: 'data:old', w1: 'data:wa' } });
    const S = sandbox(db);
    check('legacy order: has a sketch', S.lgHasSketch(LEGACY), true);
    check('WhatsApp order: has a sketch with no inline copy', S.lgHasSketch(WA), true);
    check('order without one: false', S.lgHasSketch(NONE), false);
    check('legacy order loads from memory, no database read',
          [await S.lgLoadSketch(LEGACY), db.reads.length], ['data:old', 0]);
    check('WhatsApp order loads from the node', await S.lgLoadSketch(WA), 'data:wa');
    const r = db.reads.length; await S.lgLoadSketch(WA);
    check('and is cached — a second render costs no read', db.reads.length, r);
    check('no sketch → null', await S.lgLoadSketch(NONE), null);
    check('view fields for a WhatsApp order carry no image', S.lgSketchFields(WA), { sketch: null, hasSketch: true });
    check('view fields for a legacy order carry the inline copy', S.lgSketchFields(LEGACY), { sketch: 'data:old', hasSketch: true });
  }

  {
    /* ⚠️ הלב: עריכה כותבת פעם אחת, ולא יוצרת עותק בתוך orders להזמנת WhatsApp */
    const db = makeDb({ orders: { p1: { sketch: 'data:old' }, w1: {} }, sketches: { p1: 'data:old', w1: 'data:wa' } });
    const S = sandbox(db);
    await S.lgReplaceSketch(LEGACY, 'data:new');
    check('legacy edit: ONE update covering both copies',
          db.updates, [['orders/p1/hasSketch', 'orders/p1/sketch', 'orders/p1/updatedAt', 'sketches/p1']]);
    check('both copies identical afterwards', db.data.orders.p1.sketch === db.data.sketches.p1, true);
    await S.lgReplaceSketch(WA, 'data:wa2');
    check('WhatsApp edit: no copy is created inside orders',
          [db.updates[1], db.data.orders.w1.sketch], [['orders/w1/hasSketch', 'orders/w1/updatedAt', 'sketches/w1'], undefined]);
    check('the new image is what the screen loads next', await S.lgLoadSketch(WA), 'data:wa2');

    db.failNext = true;
    let threw = false;
    try { await S.lgReplaceSketch(WA, 'data:never-saved'); } catch (e) { threw = true; }
    check('a failed save throws, so the screen can say so', threw, true);
    check('and the screen goes back to the last saved image', await S.lgLoadSketch(WA), 'data:wa2');
    check('nothing was written on failure', db.data.sketches.w1, 'data:wa2');
  }

  {
    /* מצב 'new' — כל המערכת מול הצומת, בלי למחוק בייט */
    const db = makeDb({ sketches: { p1: 'data:from-node' } });
    const S = sandbox(db, 'new');
    check("source 'new' reads the node even when an inline copy exists",
          await S.lgLoadSketch(LEGACY), 'data:from-node');
  }

  {
    const db = makeDb({ sketches: { w1: 'data:wa', w2: 'data:wa2' } });
    const S = sandbox(db);
    const img = fakeImg('w1');
    S.lgSketchIntoImg(img, WA);
    check('an image with no inline copy starts empty, not with a wrong picture', img.src, '');
    await tick(); await tick();
    check('and is filled from the node', img.src, 'data:wa');

    /* פתח w2, עבור ל-w1 לפני שהתשובה חזרה — התשובה המאחרת נזרקת */
    const img2 = fakeImg('x');
    S.lgSketchIntoImg(img2, { id: 'w2', hasSketch: true });
    img2.dataset.lgFor = 'something-else';
    await tick(); await tick();
    check('a late answer for another order is discarded', img2.src, '');

    /* lazy: רק מה שנכנס למסך נטען */
    const els = ['w1', 'w2'].map(fakeImg);
    const root = { querySelectorAll: () => els };
    S.lgHydrateSketchImgs(root, id => ({ id, hasSketch: true }), { lazy: true });
    check('lazy hydration only observes, loads nothing yet', [els[0].src, els[1].src, S._observed.length], ['', '', 2]);
    const o = S._observed[1]; o.cb([{ isIntersecting: true, target: o.el }]);
    await tick(); await tick();
    check('the one that scrolled into view is loaded, the other is not', [els[0].src, els[1].src], ['', 'data:wa2']);
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll sketch-API guard checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
