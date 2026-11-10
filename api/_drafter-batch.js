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

//  משלוחים שנסגרו ("השרטט סיים"). הזמנה שחזרה לשרטט אחרי שהמשלוח שלה נסגר —
//  חוזרת לסל (סקירה 10/11: אחרת היא נעלמת מהסל ומ"השרטט סיים").
async function _doneSet(db) {
  const all = (await db.ref(BATCHES).once('value')).val() || {};
  return new Set(Object.entries(all).filter(([k, b]) => k[0] !== '_' && b && b.doneAt).map(([, b]) => Number(b.n)));
}
const _waiting = (o, done) => _atDrafter(o) && (o.drafterBatch == null || done.has(Number(o.drafterBatch)));
//  "לא לשלוח עכשיו" (בן, 10/11) — drafterHold: נשאר אצל שרטט, לא נכנס למשלוח עד "החזר"
const _inBasket = (o, done) => _waiting(o, done) && !o.drafterHold;

//  hold=true → "לא לשלוח עכשיו"; false → "החזר". רק הזמנה שמחכה (אצל שרטט, לא במשלוח פתוח).
async function lgDrafterHold(db, id, hold) {
  if (typeof id !== 'string' || !id || /[.#$[\]/]/.test(id)) return { ok: false, code: 'bad-id' };
  const done = await _doneSet(db);
  const r = await db.ref('orders/' + id).transaction(cur => {
    if (cur === null) return null;
    if (!_waiting(cur, done)) return;   // abort — לא אצל שרטט / כבר במשלוח
    const next = { ...cur };
    if (hold) next.drafterHold = true; else delete next.drafterHold;
    return next;
  });
  const v = r.snapshot.val();
  if (!r.committed || !v) return { ok: false, code: 'not-waiting' };
  return { ok: true };
}

async function lgDrafterBasket(db, done) {
  const d = done || await _doneSet(db);
  const all = (await db.ref('orders').once('value')).val() || {};
  return Object.entries(all)
    .filter(([, o]) => _inBasket(o, d))
    .map(([id, o]) => _brief(id, o)).sort(_sort);
}

//  נעילה קצרה — שתי לחיצות "שלח" במקביל = משלוח אחד (סקירה 10/11). פגה אחרי 2 דקות.
const LOCK_MS = 2 * 60 * 1000;
async function _lock(db, at) {
  const token = at + ':' + Math.random().toString(36).slice(2);
  const r = await db.ref(BATCHES + '/_sending').transaction(cur => {
    if (cur && cur.until > at && cur.token !== token) return;   // abort — מישהו אחר שולח
    return { token, until: at + LOCK_MS };
  });
  return r.committed && r.snapshot.val() && r.snapshot.val().token === token ? token : null;
}
async function _unlock(db, token) {
  await db.ref(BATCHES + '/_sending').transaction(cur => (cur === null ? null : cur.token === token ? null : undefined));
}

async function _nextNumber(db) {
  const r = await db.ref(BATCHES + '/_next').transaction(cur => (Number(cur) || 1) + 1);
  return Number(r.snapshot.val()) - 1;
}

//  deps.enqueue(db, n) — המייל (lgDrafterEnqueueEmail). מוזרק כדי שהבדיקה לא תצטרך את התור.
async function lgDrafterSend(db, { by, now } = {}, deps = {}) {
  const at = now || Date.now();
  const token = await _lock(db, at);
  if (!token) return { ok: false, code: 'busy' };
  try {
    const done = await _doneSet(db);
    const basket = await lgDrafterBasket(db, done);
    if (!basket.length) return { ok: false, code: 'empty' };
    const n = await _nextNumber(db);
    //  הרשומה לפני ההזמנות — קריסה באמצע משאירה משלוח שרואים ואפשר לשלוח שוב
    await db.ref(BATCHES + '/' + n).set({ n, at, by: String(by || ''), orderIds: [], count: 0, doneAt: null });
    const orderIds = [];
    for (const { id } of basket) {
      const r = await db.ref('orders/' + id).transaction(cur => {
        if (cur === null) return null;
        if (!_inBasket(cur, done)) return;   // abort — זזה / נתפסה במשלוח אחר
        return { ...cur, drafterBatch: n };
      });
      if (r.committed && r.snapshot.val() && r.snapshot.val().drafterBatch === n) orderIds.push(id);
    }
    if (!orderIds.length) { await db.ref(BATCHES + '/' + n).set(null); return { ok: false, code: 'empty' }; }
    await db.ref(BATCHES + '/' + n).update({ orderIds, count: orderIds.length });
    const enqueue = deps.enqueue || ((d, x) => lgDrafterEnqueueEmail(d, x, at));
    let email = null;
    try { email = await enqueue(db, n); }
    catch (e) { await db.ref(BATCHES + '/' + n + '/emailError').set(String((e && e.message) || e).slice(0, 200)); }
    return { ok: true, n, orderIds, email };
  } finally {
    await _unlock(db, token);
  }
}

//  מייל שנכשל / פג / לא נבנה — שליחה חוזרת של אותו משלוח (אותו מפתח בתור; רשומה שנכשלה נוצרת מחדש)
async function lgDrafterResend(db, n, { now } = {}) {
  const b = (await db.ref(BATCHES + '/' + n).once('value')).val();
  if (!b || !b.n || b.doneAt) return { ok: false, code: 'no-batch' };
  await db.ref(BATCHES + '/' + n + '/emailError').set(null);
  const r = await lgDrafterEnqueueEmail(db, n, now);
  return { ok: !!r.key, key: r.key, queued: r.queued, reason: r.reason };
}

async function _openBatches(db) {
  const all = (await db.ref(BATCHES).once('value')).val() || {};
  return Object.entries(all).filter(([k, b]) => k[0] !== '_' && b && !b.doneAt)
    .map(([, b]) => b).sort((a, b) => a.n - b.n);
}
const MAIL_FAILED = ['failed', 'expired', 'cancelled'];

//  n (רשות) — רק המשלוח הזה ("השרטט סיים" על קובץ אחד בתחנת שרטט, בן 10/11). בלי n — כל הפתוחים.
async function lgDrafterDone(db, { by, now, n } = {}) {
  const at = now || Date.now();
  const moved = [], skipped = [], batches = [], held = [];
  const outbox = (await db.ref('waMeta/emailOutbox').once('value')).val() || {};
  const only = n == null ? null : Number(n);
  for (const b of await _openBatches(db)) {
    if (only != null && Number(b.n) !== only) continue;
    //  המייל לא יצא — השרטט לא קיבל את המשלוח הזה; לא מעבירים (סקירה 10/11)
    const mail = b.emailKey && outbox[b.emailKey] ? outbox[b.emailKey].state : '';
    if (b.emailError || MAIL_FAILED.includes(mail)) { held.push(b.n); continue; }
    //  תופסים את המשלוח קודם — שתי לחיצות במקביל לא דורסות זו את זו
    const c = await db.ref(BATCHES + '/' + b.n).transaction(cur => {
      if (cur === null) return null;
      if (cur.doneAt) return;   // abort — לחיצה אחרת כבר סוגרת
      return { ...cur, doneAt: at, doneBy: String(by || '') };
    });
    if (!c.committed || !c.snapshot.val() || c.snapshot.val().doneAt !== at) continue;
    const bm = [], bs = [];
    for (const id of b.orderIds || []) {
      const r = await db.ref('orders/' + id).transaction(cur => {
        if (cur === null) return null;
        if (cur.drafterBatch !== b.n || !_atDrafter(cur)) return;   // abort — לא נוגעים
        return { ...cur, stage: 'opty', status: OPTY_STATUS, updatedAt: at, optyAt: at };
      });
      const v = r.snapshot.val();
      if (r.committed && v && v.stage === 'opty') bm.push({ id, orderNum: String(v.orderNum || ''), client: String(v.orderClient || v.client || ''), n: b.n });
      else bs.push({ id, orderNum: v ? String(v.orderNum || '') : '', reason: v ? 'כבר לא אצל שרטט' : 'נמחקה' });
    }
    await db.ref(BATCHES + '/' + b.n).update({ moved: bm.map(m => m.id), skipped: bs });
    moved.push(...bm); skipped.push(...bs); batches.push(b.n);
  }
  return { ok: true, moved, skipped, batches, held };
}

//  ─── בדיקת סנכרון אחרי "השרטט סיים" (קולט, בן 11/11) ───────────────────
//  שלושה מקורות: (1) המשלוח (orderIds) מול הקובץ שנשמר (drafterPdf/<n>/items — מה שנכנס ל-PDF),
//  (2) מי עכשיו בשלב opty ("בנה יום עבודה"), (3) מי דולג ולמה. קורא רק names/items מהקובץ (לא את ה-base64).
//  קובץ ישן בלי items (לפני 11/11) — לא משווים את הרשימות (אין מה להשוות), רק בודקים שהוא קיים.
//  → { kind:'info'|'ask', text, ok, total, inOpty, issues:[{ id, orderNum, client, reason }] }
async function lgDrafterSyncCheck(db, n) {
  const b = (await db.ref(BATCHES + '/' + n).once('value')).val() || {};
  const names = (await db.ref('waMeta/drafterPdf/' + n + '/names').once('value')).val();
  const rawItems = (await db.ref('waMeta/drafterPdf/' + n + '/items').once('value')).val();
  const pdfItems = rawItems ? Object.values(rawItems).filter(x => x && x.id) : null;
  const ids = (Array.isArray(b.orderIds) ? b.orderIds : Object.values(b.orderIds || {})).map(String);
  const skipped = {};
  Object.values(b.skipped || {}).forEach(x => { if (x && x.id) skipped[x.id] = x; });
  const pdfById = {};
  (pdfItems || []).forEach(x => { pdfById[String(x.id)] = x; });
  const orders = {};
  for (const id of new Set([...ids, ...Object.keys(pdfById)])) {
    orders[id] = /[.#$[\]/]/.test(id) ? null : (await db.ref('orders/' + id).once('value')).val();
  }
  const label = id => {
    const o = orders[id] || {}, p = pdfById[id] || {}, s = skipped[id] || {};
    return { id, orderNum: String(o.orderNum || p.orderNum || s.orderNum || id), client: String(o.orderClient || o.client || p.client || '') };
  };
  const issues = [];
  if (!names) issues.push({ id: '', orderNum: '', client: '', reason: 'הקובץ של המשלוח לא נשמר' });
  let inOpty = 0;
  for (const id of ids) {
    const o = orders[id];
    if (pdfItems && !pdfById[id]) issues.push({ ...label(id), reason: 'במשלוח אבל לא בקובץ' });
    if (o && o.stage === 'opty') { inOpty++; continue; }
    const reason = !o ? 'נמחקה'
      : Number(o.drafterBatch) !== Number(n) ? 'עברה למשלוח אחר'
      : _atDrafter(o) ? 'לא עברה — עדיין אצל שרטט'
      : 'הוזזה ידנית (לא אצל שרטט)';
    issues.push({ ...label(id), reason });
  }
  for (const id of Object.keys(pdfById)) if (!ids.includes(id)) issues.push({ ...label(id), reason: 'בקובץ אבל לא במשלוח' });
  //  סדר יציב: לפי מספר ההזמנה (הבעיה של הקובץ ראשונה)
  issues.sort((x, y) => (x.id ? 1 : 0) - (y.id ? 1 : 0) || x.orderNum.localeCompare(y.orderNum, 'he', { numeric: true }));
  const head = `השרטט סיים משלוח ${n}: ${inOpty} מתוך ${ids.length} בבנה יום עבודה`;
  const ok = !issues.length;
  const text = ok ? head + ' ✓'
    : head + ' — לבדוק: ' + issues.map(x => (x.id ? [x.orderNum, x.client, x.reason].filter(Boolean).join(' · ') : x.reason)).join('; ');
  return { kind: ok ? 'info' : 'ask', text, ok, total: ids.length, inOpty, issues };
}

async function lgDrafterStatus(db) {
  const done = await _doneSet(db);
  const basket = await lgDrafterBasket(db, done);
  const all = (await db.ref('orders').once('value')).val() || {};
  const held = Object.entries(all).filter(([, o]) => _waiting(o, done) && o.drafterHold)
    .map(([id, o]) => _brief(id, o)).sort(_sort);
  const outbox = (await db.ref('waMeta/emailOutbox').once('value')).val() || {};
  const open = (await _openBatches(db)).map(b => ({ n: b.n, at: b.at, count: b.count, emailKey: b.emailKey || null,
    emailState: b.emailError ? 'failed' : b.emailKey && outbox[b.emailKey] ? String(outbox[b.emailKey].state || '') : '',
    orders: (b.orderIds || []).map(id => ({ id, orderNum: String((all[id] || {}).orderNum || ''), client: String((all[id] || {}).orderClient || ''),
                                            sketchName: String((all[id] || {}).sketchName || ''), stage: String((all[id] || {}).stage || '') })) }));
  return { basket, held, open };
}

//  ─── הקובץ ───────────────────────────────────────────────────────────
//  עמוד שער ("משלוח 12", תאריך, רשימת ההזמנות) ועמוד לכל הזמנה — אותו עמוד
//  סקיצה כמו בחשבונית (lgAddSketchPage). סקיצה חסרה/פגומה → עמוד "אין סקיצה";
//  המשלוח יוצא בכל זאת. גדול מ-maxBytes → כמה קבצים (השער רק בראשון).
//  ⚠️ 3MB: הקובץ חוזר לסקריפט כ-base64 בתוך תשובת Vercel, שמוגבלת ל-4.5MB (סקירה 10/11).
//  סקיצה טיפוסית 40–460KB (נמדד 10/11) → משלוח של ~10 הזמנות = חלק אחד.
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const _ilTime = t => new Date(t).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit',
                                                          year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function _items(db, b) {
  const { _sketch, _dataUrl } = require('./_invoice-deliver');
  const out = [];
  for (const id of b.orderIds || []) {
    const o = (await db.ref('orders/' + id).once('value')).val() || {};
    const d = _dataUrl(await _sketch(db, id));
    //  צרופות (בן, 10/11) — עמוד לכל אחת מיד אחרי הסקיצה
    const atts = (await require('./_order-attachments').lgAttOf(db, id)).map(a => ({ label: a.label, img: a.img }));
    out.push({ id, orderNum: String(o.orderNum || ''), client: String(o.orderClient || o.client || ''),
               sketchName: String(o.sketchName || ''), img: d && /^image\//.test(d.mime) ? d : null, atts });
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
    line(b.title || ('משלוח ' + b.n), H - 80, 34);
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
    for (const a of it.atts || []) {
      const ah = { ...head, title: a.label + ' — ' + (it.sketchName || it.orderNum || 'סקיצה'), total: 0 };
      try { await M.lgAddSketchPage(doc, font, a.img, ah); }
      catch (_) { await M.lgAddSketchPage(doc, font, null, ah); }
    }
  }
  return Buffer.from(await doc.save());
}

//  → { ok:true, files:[{name, mime, buf}] } | { ok:false, code:'no-batch' }
//  הטיוטה כקובץ — מה שייצא אם לוחצים עכשיו "שלח לשרטט". לא משנה כלום.
//  → { ok, files:[...] } | { ok:false, code:'empty' }
async function lgDrafterPreview(db, { now, maxBytes } = {}) {
  const basket = await lgDrafterBasket(db);
  if (!basket.length) return { ok: false, code: 'empty' };
  const b = { n: 0, title: 'טיוטה לשרטט', at: now || Date.now(), count: basket.length, orderIds: basket.map(x => x.id) };
  const items = await _items(db, b);
  const files = await _split(items, b, maxBytes || MAX_PDF_BYTES);
  return { ok: true, files: files.map((buf, i) => ({ name: 'טיוטה לשרטט' + (files.length > 1 ? ' (' + (i + 1) + ' מתוך ' + files.length + ')' : '') + '.pdf',
                                                      mime: 'application/pdf', buf })) };
}

//  פיצול לחלקים עד max (השער רק בראשון) → [Buffer]
async function _split(items, b, max) {
  const one = await _build(items, items, b);
  if (one.length <= max || items.length <= 1) return [one];
  const parts = [];
  let cur = [];
  for (const it of items) {
    const tryBuf = await _build(parts.length ? null : items, [...cur, it], b);
    if (cur.length && tryBuf.length > max) { parts.push(cur); cur = [it]; } else cur.push(it);
  }
  if (cur.length) parts.push(cur);
  const out = [];
  for (let i = 0; i < parts.length; i++) out.push(await _build(i === 0 ? items : null, parts[i], b));
  return out;
}

async function lgDrafterPdf(db, n, opts) {
  const b = (await db.ref(BATCHES + '/' + n).once('value')).val();
  if (!b || !b.n) return { ok: false, code: 'no-batch' };
  const max = (opts && opts.maxBytes) || MAX_PDF_BYTES;
  const items = await _items(db, b);
  const bufs = await _split(items, b, max);
  const name = i => 'משלוח ' + b.n + (bufs.length > 1 ? ' (' + (i + 1) + ' מתוך ' + bufs.length + ')' : '') + '.pdf';
  //  items — ההזמנות שבאמת נכנסו לקובץ (בדיקת הסנכרון של הקולט, 11/11)
  return { ok: true, files: bufs.map((buf, i) => ({ name: name(i), mime: 'application/pdf', buf })),
           items: items.map(it => ({ id: it.id, orderNum: it.orderNum, client: it.client })) };
}

//  קובץ שנשמר בשליחה → { ok, name, mime, b64 } | { ok:false, code }
async function lgDrafterStoredFile(db, n, idx) {
  const v = (await db.ref('waMeta/drafterPdf/' + n).once('value')).val();
  const i = Number(idx);
  if (!v || !v.parts || !Number.isInteger(i) || !v.parts[i]) return { ok: false, code: v ? 'bad-idx' : 'no-file' };
  return { ok: true, name: String((v.names || {})[i] || ('משלוח ' + n + '.pdf')), mime: 'application/pdf', b64: String(v.parts[i]) };
}

//  המייל
//  → { key, queued, reason } — ומסמן במשלוח את מפתח המייל (emailKey)
async function lgDrafterEnqueueEmail(db, n, now) {
  const b = (await db.ref(BATCHES + '/' + n).once('value')).val();
  if (!b) return { key: null, queued: false, reason: 'no-batch' };
  const items = await _items(db, b);
  const pdf = await lgDrafterPdf(db, n);
  //  נבנה פעם אחת ונשמר — outbox-file רק קורא (סקירה 10/11: אחרת נבנה מחדש לכל קובץ,
  //  ושינוי בסקיצה באמצע היה משנה את מספר החלקים)
  if (pdf.ok) {
    const parts = {}, names = {};
    pdf.files.forEach((f, i) => { parts[i] = f.buf.toString('base64'); names[i] = f.name; });
    //  items — רשימת ההזמנות שנכנסו לקובץ, לבדיקת הסנכרון ב"השרטט סיים" (lgDrafterSyncCheck)
    await db.ref('waMeta/drafterPdf/' + n).set({ at: now || Date.now(), parts, names, items: pdf.items });
  }
  const lines = ['משלוח ' + b.n + ' · ' + _ilTime(b.at) + ' · ' + b.count + ' הזמנות',
                 ...items.map(it => [it.orderNum, it.client, it.sketchName].filter(Boolean).join(' · '))];
  const { lgEmailEnqueue } = require('./_email-outbox');
  const r = await lgEmailEnqueue(db, { kind: 'drafter-batch', thread: 'drafter', messageId: 'drafter-' + b.n,
    email: LG_DRAFTER_EMAIL, sendTo: LG_DRAFTER_EMAIL, keySuffix: b.n, drafterBatch: b.n, extraLines: lines,
    orderIds: b.orderIds || [], fileCount: pdf.ok ? pdf.files.length : 1, queuedBy: 'drafter', now });
  await db.ref(BATCHES + '/' + n + '/emailKey').set(r.key);
  return r;
}

module.exports = { lgDrafterSyncCheck, lgDrafterInBasket: _inBasket, lgDrafterDoneSet: _doneSet, lgDrafterPreview, lgDrafterHold, lgDrafterResend, lgDrafterStoredFile, lgDrafterPdf, MAX_PDF_BYTES, LG_DRAFTER_EMAIL, lgDrafterBasket, lgDrafterSend, lgDrafterDone, lgDrafterStatus, lgDrafterEnqueueEmail };
