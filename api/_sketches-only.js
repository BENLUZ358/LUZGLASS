//  סקיצות בלי חשבונית (בן, 27/11): "הוא רוצה לדעת מה מגיע לו" — מתחנת החשבוניות,
//  לפני שיצאה חשבונית. קובץ PDF אחד, עמוד לכל סקיצה בלי כותרות ("בלי דברים מיותרים"),
//  ובהודעה רשימת שמות הסקיצות. יוצא לאן שיוצאות החשבוניות (_wa-recipient: invoice-private),
//  וואטסאפ בלבד. לא נוגע במצב החשבונית — אפשר לשלוח שוב ולהפיק חשבונית אחר כך כרגיל.
'use strict';

const MAX_ORDERS = 20;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const _safe = s => String(s || '').replace(/[\/\\:*?"<>|\r\n]/g, ' ').trim().slice(0, 40);
const _name = o => String((o && o.sketchName) || '').trim() || String((o && (o.orderNum || o.id)) || '');

//  ההזמנה שלפיה נקבע הנמען: וואטסאפ קודם (כמו החשבונית), אחרת הראשונה
const _pick = orders => orders.find(o => o && o.source === 'whatsapp') || orders[0];

async function _load(db, ids) {
  return Promise.all(ids.map(async id => { const o = (await db.ref('orders/' + id).once('value')).val(); return o ? { ...o, id } : null; }));
}

//  { ok, files:[{name,mime,buf}], missing:[name] } — נבנה בזמן השליחה, לא נשמר בתור
async function lgSketchesOnlyFiles(db, orderIds, clientName) {
  const { _sketch, _dataUrl } = require('./_invoice-deliver');
  const pages = [], missing = [];
  for (const id of orderIds || []) {
    const o = (await db.ref('orders/' + id).once('value')).val() || {};
    const d = _dataUrl(await _sketch(db, id));
    if (!d || !d.buf.length) { missing.push(_name({ ...o, id })); continue; }
    pages.push({ ...d, label: _name({ ...o, id }) });
  }
  if (!pages.length) return { ok: false, code: 'no-sketches', missing };
  const { PDFDocument } = require('pdf-lib');
  const M = require('./_invoice-merge');
  const doc = await PDFDocument.create();
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const font = await doc.embedFont(M._fontBytes(), { subset: true });
  const good = [];
  for (const p of pages) {
    //  compact בלי טקסט = הסקיצה לבד על כל הדף, לרוחב כשהיא לרוחב. סקיצה פגומה — נשמטת.
    try { await M.lgAddSketchPage(doc, font, { buf: p.buf, mime: p.mime }, { compact: true }); good.push(p); }
    catch (_) { missing.push(p.label); }
  }
  if (!good.length) return { ok: false, code: 'no-sketches', missing };
  const buf = Buffer.from(await doc.save());
  const base = 'סקיצות' + (clientName ? ' ' + _safe(clientName) : '');
  if (buf.length <= MAX_PDF_BYTES) return { ok: true, files: [{ name: base + '.pdf', mime: 'application/pdf', buf }], missing };
  //  גדול מדי לוואטסאפ → כל סקיצה כקובץ משלה
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return { ok: true, missing, files: good.map(p => ({ name: 'סקיצה ' + _safe(p.label) + '.' + (EXT[p.mime] || 'bin'), mime: p.mime, buf: p.buf })) };
}

//  deps: { now?, recipient?, drain? }
async function lgSketchesOnlyNotify(db, orderIds, deps) {
  const d = deps || {};
  const now = d.now || Date.now();
  //  ממוינים — כמו בתור (lgWaEnqueue), כדי שסדר העמודים בקובץ וסדר השמות בהודעה יהיו אחד
  const ids = [...new Set((orderIds || []).map(String))].filter(Boolean).sort();
  if (!ids.length) return { state: 'blocked', reason: 'לא נבחרו הזמנות' };
  if (ids.length > MAX_ORDERS) return { state: 'blocked', reason: 'יותר מדי הזמנות (עד ' + MAX_ORDERS + ')' };
  const orders = await _load(db, ids);
  if (orders.some(o => !o)) return { state: 'blocked', reason: 'הזמנה לא נמצאה' };
  const cards = [...new Set(orders.map(o => String(o.customerId || '')))];
  if (cards.length !== 1 || !cards[0]) return { state: 'blocked', reason: 'ההזמנות לא של אותו כרטיס לקוח' };
  if (orders.some(o => o.isTest)) return { state: 'blocked', reason: 'יש הזמנה פיקטיבית' };

  const R = d.recipient || require('./_wa-recipient');
  const who = await R.resolveRecipientWa(db, _pick(orders), 'sketches-only');
  if (!who.phone) return { state: 'blocked', reason: who.source === 'invoice-private-missing'
    ? 'סומן "חשבוניות לפרטי" אבל אין מספר פרטי בכרטיס הלקוח' : 'אין נמען בוואטסאפ ללקוח' };

  const { lgWaEnqueue } = require('./_wa-outbox');
  const q = await lgWaEnqueue(db, {
    kind: 'sketches-only', to: who.phone, phoneSource: who.source, accountKey: who.accountKey,
    clientName: orders[0].orderClient || '', orderIds: ids,
    orderNums: orders.map(o => String(o.orderNum || o.id)), sketchNames: orders.map(o => String(o.sketchName || '')),
    extraLines: orders.map(_name), queuedBy: 'sketches-only',
    //  לחיצה כפולה באותה דקה = הודעה אחת; לחיצה מאוחרת יותר = שליחה חוזרת מפורשת
    keySuffix: 'm' + Math.floor(now / 60000),
  });
  if (!q.queued) return { state: 'already', reason: q.reason, key: q.key };
  const drain = d.drain || require('./_wa-drain-core').drainNow;
  const r = await drain(db, [q.key], 'sketches-only');
  const res = (r && r.results || []).find(x => x.key === q.key);
  if (res && res.status === 'sent') return { state: 'sent', key: q.key, count: ids.length };
  return { state: res && res.status === 'blocked' ? 'blocked' : 'queued', reason: (res && res.reason) || null, key: q.key };
}

module.exports = { lgSketchesOnlyFiles, lgSketchesOnlyNotify, _pick, MAX_ORDERS };
