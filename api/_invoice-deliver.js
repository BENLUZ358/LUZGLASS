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
//    • חסרה סקיצה להזמנה כלשהי → לא שולחים כלום (אין חבילה חלקית).
//
//  השליחה עוברת דרך התורים הקיימים (waOutbox / emailOutbox) — אותן נעילות,
//  אותן הרשאות, אותה הגנה מכפילות. וואטסאפ יוצא בתוך הבקשה הזו; מייל יוצא
//  בריצה הבאה של סקריפט הג'ימייל (כל דקה).
//
//  המצב נרשם ב-invoicePdf/<key>/delivery: { state, channel, outboxKey, reason, at }
//    state: sent · queued · failed · blocked · portal · skipped
// ═══════════════════════════════════════════════════════════════════

const S = require('./_invoice-send');

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

//  { ok, rec, files:[{name, mime, buf}] } | { ok:false, code, orderIds? }
//  הקובץ הראשון תמיד החשבונית (מקור), ואחריו סקיצה לכל הזמנה בסדר ההזמנות.
async function lgInvoiceFiles(db, key) {
  const rec = (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!rec || rec.state !== 'ready') return { ok: false, code: 'not-ready' };
  const pdf = (await db.ref('invoicePdfBlobs/' + key + '/original').once('value')).val();
  if (!pdf) return { ok: false, code: 'no-pdf' };
  const ids = rec.orderIds || [];
  const sk = {};
  for (const id of ids) sk[id] = await _sketch(db, id);
  const pkg = S.lgInvoiceBuildPackage(rec, sk);
  if (!pkg.ok) return pkg;
  const files = [{ name: 'חשבונית ' + rec.docNumber + '.pdf', mime: 'application/pdf', buf: Buffer.from(pdf, 'base64') }];
  for (let i = 0; i < ids.length; i++) {
    const d = _dataUrl(sk[ids[i]]);
    if (!d || !d.buf.length) return { ok: false, code: 'sketch-unreadable', orderIds: [ids[i]] };
    const num  = (rec.orderNums || [])[i] || String(i + 1);
    const name = (rec.sketchNames || [])[i];
    files.push({ name: 'סקיצה ' + _safe(num) + (name ? ' - ' + _safe(name) : '') + '.' + (EXT[d.mime] || 'bin'),
                 mime: d.mime, buf: d.buf });
  }
  return { ok: true, rec, files };
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
    const why = files.code === 'sketch-missing' || files.code === 'sketch-unreadable' ? 'חסרה סקיצה' : 'קובץ החשבונית חסר';
    await mark({ state: 'blocked', reason: why, code: files.code });
    return { state: 'blocked', code: files.code };
  }

  const R = require('./_wa-recipient');
  const who = waOrder ? await R.resolveRecipientWa(db, waOrder, 'invoice')
                      : await R.resolveRecipient(db, emOrder, 'invoice');
  const common = { kind: 'invoice', clientName: rec.client, orderNums: rec.orderNums || [],
                   sketchNames: rec.sketchNames || [], orderIds: ids, queuedBy: 'invoice-tool',
                   accountKey: who.accountKey, invoiceKey: key, docNumber: rec.docNumber };

  if (who.channel === 'email') {
    const { lgEmailEnqueue } = require('./_email-outbox');
    const q = await lgEmailEnqueue(db, { ...common, thread: who.thread, messageId: emOrder.emailMessageId,
                                         email: who.email, now });
    await mark({ state: 'queued', channel: 'email', outboxKey: q.key });
    return { state: 'queued', channel: 'email' };
  }

  if (!who.phone) { await mark({ state: 'blocked', channel: 'whatsapp', reason: 'אין נמען בוואטסאפ' }); return { state: 'blocked' }; }
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

module.exports = { lgInvoiceFiles, lgInvoiceDeliver };
