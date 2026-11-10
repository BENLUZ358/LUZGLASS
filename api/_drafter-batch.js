'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_drafter-batch.js — משלוחים לשרטט (בן, 10/11).
//
//  עוזר משותף, לא route. אפיון:
//  docs/superpowers/specs/2026-11-10-drafter-pdf-batches-design.md
//
//  השרטט לא עובד על הממשק. בן שולח לו את ההזמנות במייל, והשרטט מסיים כל
//  יום את כל מה שנשלח אליו.
//    • הסל = הזמנות "אצל שרטט" (stage drafter / chash, כמו drafter.html)
//      שעוד לא נשלחו (אין drafterBatch).
//    • "שלח לשרטט" = משלוח חדש עם מספר, וכל הסל נכנס אליו. מייל עם PDF יוצא
//      ל-LG_DRAFTER_EMAIL — כתובת קבועה כאן, אף פעם לא מהבקשה.
//    • "השרטט סיים" = כל המשלוחים הפתוחים: כל הזמנה שעדיין אצל שרטט עוברת
//      ל-opty בדיוק כמו "✓ סיים סקיצה" ב-drafter.html (updateStage 'opty').
//      הזמנה שזזה בינתיים / נמחקה — לא נוגעים, ומדווחים.
//
//  ⚠️ waMeta: רק השרת כותב (חוקים). אין שינוי חוקים.
//  ⚠️ טרנזקציות: פיירבייס קוראת קודם עם null. כל handler מחזיר ערך על null.
// ═══════════════════════════════════════════════════════════════════

const LG_DRAFTER_EMAIL = 'lozzagagot@gmail.com';
const BATCHES = 'waMeta/drafterBatches';
const AT_DRAFTER = ['drafter', 'chash'];
const OPTY_STATUS = 'מחכה ל-OptyWay';

const _atDrafter = o => !!o && AT_DRAFTER.includes(o.stage);
const _brief = (id, o) => ({ id, orderNum: String(o.orderNum || ''), client: String(o.orderClient || o.client || ''),
                             sketchName: String(o.sketchName || ''), stage: o.stage, createdAt: o.createdAt || 0 });
const _sort = (a, b) => a.client.localeCompare(b.client, 'he') || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1);

async function lgDrafterBasket(db) {
  const all = (await db.ref('orders').once('value')).val() || {};
  return Object.entries(all)
    .filter(([, o]) => _atDrafter(o) && o.drafterBatch == null)
    .map(([id, o]) => _brief(id, o)).sort(_sort);
}

async function _nextNumber(db) {
  const r = await db.ref(BATCHES + '/_next').transaction(cur => (Number(cur) || 1) + 1);
  return Number(r.snapshot.val()) - 1;
}

//  deps.enqueue(db, n) — המייל (lgDrafterEnqueueEmail). מוזרק כדי שהבדיקה לא תצטרך את התור.
async function lgDrafterSend(db, { by, now } = {}, deps = {}) {
  const at = now || Date.now();
  const basket = await lgDrafterBasket(db);
  if (!basket.length) return { ok: false, code: 'empty' };
  const n = await _nextNumber(db);
  const orderIds = [];
  for (const { id } of basket) {
    const r = await db.ref('orders/' + id).transaction(cur => {
      if (cur === null) return null;
      if (!_atDrafter(cur) || cur.drafterBatch != null) return;   // abort — זזה / נתפסה במשלוח אחר
      return { ...cur, drafterBatch: n };
    });
    if (r.committed && r.snapshot.val() && r.snapshot.val().drafterBatch === n) orderIds.push(id);
  }
  if (!orderIds.length) return { ok: false, code: 'empty' };
  await db.ref(BATCHES + '/' + n).set({ n, at, by: String(by || ''), orderIds, count: orderIds.length, doneAt: null });
  const enqueue = deps.enqueue || ((d, x) => lgDrafterEnqueueEmail(d, x));
  const email = await enqueue(db, n);
  return { ok: true, n, orderIds, email };
}

async function _openBatches(db) {
  const all = (await db.ref(BATCHES).once('value')).val() || {};
  return Object.entries(all).filter(([k, b]) => k !== '_next' && b && !b.doneAt)
    .map(([, b]) => b).sort((a, b) => a.n - b.n);
}

async function lgDrafterDone(db, { by, now } = {}) {
  const at = now || Date.now();
  const moved = [], skipped = [], batches = [];
  for (const b of await _openBatches(db)) {
    const bm = [], bs = [];
    for (const id of b.orderIds || []) {
      const r = await db.ref('orders/' + id).transaction(cur => {
        if (cur === null) return null;
        if (cur.drafterBatch !== b.n || !_atDrafter(cur)) return;   // abort — לא נוגעים
        return { ...cur, stage: 'opty', status: OPTY_STATUS, updatedAt: at, optyAt: at };
      });
      const v = r.snapshot.val();
      if (r.committed && v && v.stage === 'opty') bm.push({ id, orderNum: String(v.orderNum || ''), client: String(v.orderClient || ''), n: b.n });
      else bs.push({ id, orderNum: v ? String(v.orderNum || '') : '', reason: v ? 'כבר לא אצל שרטט' : 'נמחקה' });
    }
    await db.ref(BATCHES + '/' + b.n).update({ doneAt: at, doneBy: String(by || ''), moved: bm.map(m => m.id), skipped: bs });
    moved.push(...bm); skipped.push(...bs); batches.push(b.n);
  }
  return { ok: true, moved, skipped, batches };
}

async function lgDrafterStatus(db) {
  const basket = await lgDrafterBasket(db);
  const all = (await db.ref('orders').once('value')).val() || {};
  const open = (await _openBatches(db)).map(b => ({ n: b.n, at: b.at, count: b.count, emailKey: b.emailKey || null,
    orders: (b.orderIds || []).map(id => ({ id, orderNum: String((all[id] || {}).orderNum || ''), client: String((all[id] || {}).orderClient || '') })) }));
  return { basket, open };
}

//  ─── הקובץ ───────────────────────────────────────────────────────────
//  עמוד שער ("משלוח 12", תאריך, רשימת ההזמנות) ועמוד לכל הזמנה — אותו עמוד
//  סקיצה כמו בחשבונית (lgAddSketchPage). סקיצה חסרה/פגומה → עמוד "אין סקיצה";
//  המשלוח יוצא בכל זאת. גדול מ-maxBytes → כמה קבצים (השער רק בראשון).
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const _ilTime = t => new Date(t).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit',
                                                          year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function _items(db, b) {
  const { _sketch, _dataUrl } = require('./_invoice-deliver');
  const out = [];
  for (const id of b.orderIds || []) {
    const o = (await db.ref('orders/' + id).once('value')).val() || {};
    const d = _dataUrl(await _sketch(db, id));
    out.push({ id, orderNum: String(o.orderNum || ''), client: String(o.orderClient || o.client || ''),
               sketchName: String(o.sketchName || ''), img: d && /^image\//.test(d.mime) ? d : null });
  }
  return out;
}

async function _build(cover, items, b) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const M = require('./_invoice-merge');
  const doc = await PDFDocument.create();
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const font = await doc.embedFont(M._fontBytes(), { subset: true });
  if (cover) {
    const page = doc.addPage(M.A4);
    const [W, H] = M.A4;
    const line = (t, y, size, color) => { const v = M._visual(t);
      page.drawText(v, { x: W - 40 - font.widthOfTextAtSize(v, size), y, size, font, color: color || rgb(0, 0, 0) }); };
    line('משלוח ' + b.n, H - 80, 34);
    line(_ilTime(b.at) + '   ·   ' + b.count + ' הזמנות', H - 115, 16, rgb(0.35, 0.35, 0.35));
    let y = H - 165;
    for (const it of cover) {
      if (y < 50) break;
      line([it.orderNum, it.client, it.sketchName].filter(Boolean).join('   ·   '), y, 13);
      y -= 22;
    }
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const head = { title: it.sketchName || it.orderNum || 'סקיצה',
                   info: [it.orderNum ? 'הזמנה ' + it.orderNum : '', it.client].filter(Boolean).join('   ·   '),
                   idx: i, total: items.length };
    try { await M.lgAddSketchPage(doc, font, it.img, head); }
    catch (_) { await M.lgAddSketchPage(doc, font, null, head); }   // תמונה פגומה — עמוד "אין סקיצה"
  }
  return Buffer.from(await doc.save());
}

//  → { ok:true, files:[{name, mime, buf}] } | { ok:false, code:'no-batch' }
async function lgDrafterPdf(db, n, opts) {
  const b = (await db.ref(BATCHES + '/' + n).once('value')).val();
  if (!b || !b.n) return { ok: false, code: 'no-batch' };
  const max = (opts && opts.maxBytes) || MAX_PDF_BYTES;
  const items = await _items(db, b);
  const one = await _build(items, items, b);
  if (one.length <= max || items.length <= 1) {
    return { ok: true, files: [{ name: 'משלוח ' + b.n + '.pdf', mime: 'application/pdf', buf: one }] };
  }
  //  חלוקה: מוסיפים הזמנות לחלק עד שהוא עובר את הגבול (לפחות הזמנה אחת בכל חלק)
  const parts = [];
  let cur = [];
  for (const it of items) {
    const tryBuf = await _build(parts.length ? null : items, [...cur, it], b);
    if (cur.length && tryBuf.length > max) { parts.push(cur); cur = [it]; } else cur.push(it);
  }
  if (cur.length) parts.push(cur);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    files.push({ name: 'משלוח ' + b.n + ' (' + (i + 1) + ' מתוך ' + parts.length + ').pdf', mime: 'application/pdf',
                 buf: await _build(i === 0 ? items : null, parts[i], b) });
  }
  return { ok: true, files };
}

//  המייל — משימה 3
async function lgDrafterEnqueueEmail(db, n) {
  throw new Error('lgDrafterEnqueueEmail: not implemented');
}

module.exports = { lgDrafterPdf, MAX_PDF_BYTES, LG_DRAFTER_EMAIL, lgDrafterBasket, lgDrafterSend, lgDrafterDone, lgDrafterStatus, lgDrafterEnqueueEmail };
