// ═══════════════════════════════════════════════════════════════════
//  api/_invoice-deliver.js — שליחת החשבונית והסקיצות ללקוח (DB-00004).
//
//  עוזר משותף, לא route. נקרא מיד אחרי שהדפסה שויכה לחשבונית (ready).
//
//  הכלל (בן, 29/10):
//    • מיד — בלי חלון המתנה.
//    • בערוץ שבו ההזמנות הגיעו: הזמנה מוואטסאפ → וואטסאפ (אותה קבוצה /
//      אותו מספר); הזמנה מהמייל → תשובה באותה שרשרת. הזמנה מהפורטל → לא
//      נשלח כלום (הלקוח רואה את החשבונית בפורטל). ערוצים מעורבים → וואטסאפ.
//    • חסרה סקיצה להזמנה → בכל זאת שולחים, עם הסקיצות שיש, וההודעה אומרת
//      לאיזו הזמנה אין סקיצה (בן, 4/11 — קודם לא נשלח כלום).
//
//  השליחה עוברת דרך התורים הקיימים (waOutbox / emailOutbox) — אותן נעילות,
//  אותן הרשאות, אותה הגנה מכפילות. וואטסאפ יוצא בתוך הבקשה הזו; מייל יוצא
//  בריצה הבאה של סקריפט הג'ימייל (כל דקה).
//
//  המצב נרשם ב-invoicePdf/<key>/delivery: { state, channel, outboxKey, reason, at }
//    state: sent · queued · failed · blocked · portal · skipped
// ═══════════════════════════════════════════════════════════════════

const S = require('./_invoice-send');

//  בן, 3/11: בהודעת החשבונית — "הסחורה תגיע אליך מחר במהלך היום". לפי מפתח הכרטיס
//  בחשבשבת, כמו LG_PARTIAL_INVOICE_ACCOUNTS ב-firebase-db.js (נאור חזקיה, המקום לאמבט).
const LG_DELIVERY_TOMORROW_ACCOUNTS = ['9117', '14201'];

//  מייל חשבוניות נפרד ללקוח שההזמנות שלו מגיעות במייל (בן, 9/11): החשבונית יוצאת
//  כמייל חדש לכתובת הזו, ולא כתשובה על מייל ההזמנה. לפי מפתח הכרטיס בחשבשבת.
//  waMeta/invoiceEmail/<מפתח> (אם ייכתב) גובר על הרשימה הזו.
const LG_INVOICE_EMAIL = { '07': 'ILANATA@bdo.co.il' };   // פלג מקלחונים — מנהלת החשבונות
async function lgInvoiceEmailFor(db, accountKey) {
  const k = String(accountKey || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return '';
  let v = null;
  try { v = (await db.ref('waMeta/invoiceEmail/' + k).once('value')).val(); } catch (_) { v = null; }
  const { lgEmailAddr } = require('./_email-recipient');
  return lgEmailAddr(typeof v === 'string' ? v : (v && v.email) || LG_INVOICE_EMAIL[k] || '');
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
              'image/svg+xml': 'svg', 'application/pdf': 'pdf' };

function _dataUrl(s) {
  const m = String(s || '').match(/^data:([^;,]+);base64,([\s\S]+)$/);
  return m ? { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') } : null;
}

const _safe = s => S.safeName(s).slice(0, 40);

//  הסקיצה של הזמנה: sketches/<id>, ובהזמנות ישנות orders/<id>/sketch.
async function _sketch(db, id) {
  const v = (await db.ref('sketches/' + id).once('value')).val();
  if (v) return v;
  return (await db.ref('orders/' + id + '/sketch').once('value')).val();
}

//  { ok, rec, files:[{name, mime, buf}], missing:[orderNum] } | { ok:false, code }
//  מ-2/11 (בן): קובץ PDF אחד — עמודי החשבונית (מקור) ואחריהם עמוד לכל סקיצה,
//  בסדר ההזמנות. קובץ מאוחד גדול מדי לוואטסאפ → כמו קודם: החשבונית, ואחריה
//  סקיצה לכל הזמנה כקבצים נפרדים.
//  מ-4/11 (בן): סקיצה חסרה או שלא נקראת לא עוצרת — היא נשמטת ונרשמת ב-missing.
const MAX_MERGED_BYTES = 15 * 1024 * 1024;
async function lgInvoiceFiles(db, key, opts) {
  const sep = await _separateFiles(db, key);
  if (!sep.ok) return sep;
  const { rec } = sep;
  const M = require('./_invoice-merge');
  const inv = sep.files[0].buf;
  let sks = sep.files.slice(1);
  const missing = sep.missing.slice();
  const meta = { docNumber: rec.docNumber, client: rec.client };
  let merged;
  try {
    merged = await M.lgInvoiceMerge(inv, sks.map(f => f.page), meta);
  } catch (e) {
    //  סקיצה שלא נכנסת ל-PDF — בודקים כל אחת לבד, ומשמיטים את אלה שנכשלות
    const good = [];
    for (const f of sks) {
      try { await M.lgInvoiceMerge(inv, [f.page]); good.push(f); } catch (_) { missing.push(f.num); }
    }
    sks = good;
    merged = await M.lgInvoiceMerge(inv, sks.map(f => f.page), meta);
  }
  const order = (rec.orderNums || []).map(String);
  missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (merged.length > ((opts && opts.maxMergedBytes) || MAX_MERGED_BYTES)) {
    return { ok: true, rec, files: [sep.files[0], ...sks].map(_plain), missing };
  }
  const name = 'חשבונית ' + rec.docNumber + (rec.client ? ' - ' + _safe(rec.client) : '') + '.pdf';
  return { ok: true, rec, files: [{ name, mime: 'application/pdf', buf: merged }], missing };
}
const _plain = f => ({ name: f.name, mime: f.mime, buf: f.buf });

//  החשבונית ואחריה סקיצה לכל הזמנה שיש לה סקיצה, כל אחד קובץ משלו (הצורה שלפני 2/11).
async function _separateFiles(db, key) {
  const rec = (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!rec || rec.state !== 'ready') return { ok: false, code: 'not-ready' };
  const pdf = (await db.ref('invoicePdfBlobs/' + key + '/original').once('value')).val();
  if (!pdf) return { ok: false, code: 'no-pdf' };
  const ids = rec.orderIds || [];
  if (!ids.length) return { ok: false, code: 'no-orders' };
  const files = [{ name: 'חשבונית ' + rec.docNumber + '.pdf', mime: 'application/pdf', buf: Buffer.from(pdf, 'base64') }];
  const missing = [];
  for (let i = 0; i < ids.length; i++) {
    const num  = (rec.orderNums || [])[i] || String(i + 1);
    const name = (rec.sketchNames || [])[i];
    const d = _dataUrl(await _sketch(db, ids[i]));
    if (!d || !d.buf.length) { missing.push(num); continue; }
    files.push({ name: 'סקיצה ' + _safe(num) + (name ? ' - ' + _safe(name) : '') + '.' + (EXT[d.mime] || 'bin'),
                 mime: d.mime, buf: d.buf, num, page: { buf: d.buf, mime: d.mime, num, name: name || '' } });
  }
  return { ok: true, rec, files, missing };
}

//  deps: { now?, drain?(db, keys, by) → { results }, provider? }
async function lgInvoiceDeliver(db, key, deps) {
  const d = deps || {};
  const now = d.now || Date.now();
  const mark = v => db.ref('invoicePdf/' + key + '/delivery').set({ reason: null, outboxKey: null, ...v, at: now });

  const rec = (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!rec || rec.state !== 'ready') return { state: 'none' };
  //  הדפסה חוזרת / שיוך חוזר — לא שולחים פעמיים
  const dv = rec.delivery;
  if (dv && dv.state === 'sent') return dv;
  //  וואטסאפ שנתקע או נכשל ועדיין ממתין בתור → הדפסה חוזרת מנסה שוב עכשיו.
  //  אין שליחה כפולה: התפיסה בתור (2 דקות) והמצב 'sent' חוסמים.
  if (dv && dv.channel === 'whatsapp' && dv.outboxKey && ['queued', 'failed'].includes(dv.state)) {
    const q = (await db.ref('waOutbox/' + dv.outboxKey).once('value')).val();
    if (!q || q.state === 'sent') return dv;
    //  נכשלה סופית / פג תוקף — הדפסה חוזרת היא בקשה מפורשת לשלוח שוב: חוזרת לתור, מאפס
    if (q.state !== 'pending') {
      await db.ref('waOutbox/' + dv.outboxKey).update({ state: 'pending', attempts: 0, claimedAt: null, claimedBy: null,
                                                        createdAt: now, updatedAt: now, lastError: null });
    }
    const drain = d.drain || require('./_wa-drain-core').drainNow;
    const r = await drain(db, [dv.outboxKey], 'invoice-tool');
    const res = (r && r.results || []).find(x => x.key === dv.outboxKey);
    return { state: res && res.status === 'sent' ? 'sent' : dv.state, channel: 'whatsapp', result: res || null, retried: true };
  }
  if (dv && dv.state === 'queued') return dv;
  if (rec.simulated) { await mark({ state: 'skipped', reason: 'חשבונית ניסיון' }); return { state: 'skipped' }; }

  const ids = rec.orderIds || [];
  const orders = await Promise.all(ids.map(async id => (await db.ref('orders/' + id).once('value')).val()));
  if (!ids.length || orders.some(o => !o)) { await mark({ state: 'blocked', reason: 'הזמנה חסרה' }); return { state: 'blocked' }; }

  const waOrder = orders.find(o => o.source === 'whatsapp');
  const emOrder = orders.find(o => o.source === 'email');
  if (!waOrder && !emOrder) { await mark({ state: 'portal' }); return { state: 'portal' }; }

  const files = await lgInvoiceFiles(db, key);
  if (!files.ok) {
    await mark({ state: 'blocked', reason: 'קובץ החשבונית חסר', code: files.code });
    return { state: 'blocked', code: files.code };
  }

  const R = require('./_wa-recipient');
  const who = waOrder ? await R.resolveRecipientWa(db, waOrder, 'invoice')
                      : await R.resolveRecipient(db, emOrder, 'invoice');
  const common = { kind: 'invoice', clientName: rec.client, orderNums: rec.orderNums || [],
                   sketchNames: rec.sketchNames || [], orderIds: ids, queuedBy: 'invoice-tool',
                   accountKey: who.accountKey, invoiceKey: key, docNumber: rec.docNumber,
                   missingSketchNums: files.missing || [],
                   //  שבר בחיסום (בן, 10/11): מה שעוד לא חזר מהמפעל — נאמר עם החשבונית
                   extraLines: require('./_broken').brokenInvoiceLines(orders),
                   deliveryTomorrow: orders.some(o => LG_DELIVERY_TOMORROW_ACCOUNTS.includes(String(o.customerId || ''))) };

  if (who.channel === 'email') {
    const { lgEmailEnqueue } = require('./_email-outbox');
    const sendTo = await lgInvoiceEmailFor(db, who.accountKey);
    const q = await lgEmailEnqueue(db, { ...common, fileCount: files.files.length, thread: who.thread, messageId: emOrder.emailMessageId,
                                         email: who.email, sendTo, now });
    await mark({ state: 'queued', channel: 'email', outboxKey: q.key });
    return { state: 'queued', channel: 'email' };
  }

  if (!who.phone) { await mark({ state: 'blocked', channel: 'whatsapp', reason: who.source === 'invoice-private-missing' ? 'סומן "חשבוניות לפרטי" אבל אין מספר פרטי בכרטיס הלקוח' : 'אין נמען בוואטסאפ' }); return { state: 'blocked' }; }
  const { lgWaEnqueue } = require('./_wa-outbox');
  const q = await lgWaEnqueue(db, { ...common, to: who.phone, phoneSource: who.source });
  await mark({ state: 'queued', channel: 'whatsapp', outboxKey: q.key });

  //  יוצא עכשיו. נכשל / מנותק → נשאר בתור, ויוצא ב-drain הבא ממסך האדמין.
  //  ה-drain עצמו מעדכן את delivery (ר' whatsapp-drain.js).
  const drain = d.drain || require('./_wa-drain-core').drainNow;
  const r = await drain(db, [q.key], 'invoice-tool');
  const res = (r && r.results || []).find(x => x.key === q.key);
  return { state: res && res.status === 'sent' ? 'sent' : 'queued', channel: 'whatsapp', result: res || null };
}

module.exports = { lgInvoiceFiles, lgInvoiceDeliver, lgInvoiceEmailFor, LG_INVOICE_EMAIL };
