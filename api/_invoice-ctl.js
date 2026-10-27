// ═══════════════════════════════════════════════════════════════════
//  POST /api/invoice-ctl — בקרת חשבוניות (DB-00004).
//  (rewrite אל wa-inbound?invoice=ctl — מגבלת 12 הפונקציות)
//
//  גוף: { action, ... }. כל הפעולות POST, כדי שה-rewrite לא יצטרך להעביר query.
//    register    (אדמין) { orderIds, docNumber } — "החשבונית הופקה": יוצר רשומה
//                        'awaiting', ואם ההדפסה כבר הגיעה ('printed') משייך אליה.
//    list        (אדמין) { sinceMs } — רשימה בלי קבצים ובלי טקסט.
//    pdf         (אדמין) { key } — המקור בלבד, base64.
//    customerPdf (לקוח)  { key } — המקור בלבד, רק אם כל ההזמנות של החשבונית שלו.
//
//  ההעתק לעולם לא יוצא מכאן. הלקוח לא קורא את invoicePdf ישירות (חסום בחוקים);
//  הוא רואה רק orders/<id>/invoicePdfKey, והקובץ עובר דרך הבדיקה כאן.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const M = require('./_invoice-match');
const S = require('./_invoice-send');

const _fail = (status, code, error) => ({ status, body: { ok: false, code, error } });
const _digits = s => String(s || '').replace(/\D/g, '');
const DOC_RE = /^\d{4,9}$/;

//  אותו חישוב מפתח כמו api/hashavshevet-invoice.js — שני הנתיבים נפגשים באותה רשומה.
function lgInvoicePdfKey(orderIds) {
  return crypto.createHash('sha1')
    .update('invoicePdf|' + [...orderIds].sort().join(',')).digest('hex').slice(0, 20);
}

const _sketchName = o => String(o.sketchName || o.type || o.desc || '').trim();

//  חשבונית מוכנה → כל הזמנה מקבלת קישור, והפורטל יודע להציג כפתור.
async function lgInvoiceLinkOrders(db, key, orderIds) {
  const upd = {};
  orderIds.forEach(id => { upd['orders/' + id + '/invoicePdfKey'] = key; });
  await db.ref().update(upd);
}

async function _register(body, deps, who) {
  const ids = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(String).filter(Boolean))];
  const docNumber = String(body.docNumber || '').trim();
  if (!ids.length || ids.length > 100) return _fail(400, 'bad-orders', 'לא נבחרו הזמנות');
  if (!DOC_RE.test(docNumber)) return _fail(400, 'bad-doc', 'מספר מסמך לא תקין');

  const orders = [];
  for (const id of ids) {
    const o = (await deps.db.ref('orders/' + id).once('value')).val();
    if (!o) return _fail(404, 'order-missing', 'הזמנה לא נמצאה: ' + id);
    orders.push(o);
  }
  const phones = new Set(orders.map(o => _digits(o.clientPhone || o.phone)));
  if (phones.size !== 1 || phones.has('')) return _fail(422, 'mixed-clients', 'ההזמנות אינן של לקוח אחד');
  const client = orders.map(o => o.orderClient).find(Boolean) || '';
  const now = deps.now || Date.now();
  const key = lgInvoicePdfKey(ids);

  const base = {
    reference: docNumber, docNumber, createdBy: who,
    client, clientPhone: [...phones][0],
    orderIds: ids, orderNums: orders.map(o => String(o.orderNum || o.id)),
    sketchNames: orders.map(_sketchName),
  };
  const tx = await deps.db.ref('invoicePdf/' + key).transaction(cur => {
    if (cur && cur.state !== 'awaiting') return;           // כבר מוכנה: לא דורסים
    return { ...(cur || {}), ...base, state: 'awaiting', createdAt: (cur && cur.createdAt) || now };
  });
  if (!tx.committed) {
    const cur = (await deps.db.ref('invoicePdf/' + key).once('value')).val() || {};
    return { status: 200, body: { ok: true, key, state: cur.state, existing: true } };
  }
  const rec = tx.snapshot.val();

  //  מצב א׳: ההדפסה הגיעה לפני הרישום. מתאימים לפי מספר מסמך + שמות הסקיצות.
  const printed = (await deps.db.ref('invoicePdf').orderByChild('state').equalTo('printed').limitToFirst(200).once('value')).val() || {};
  const pk = Object.keys(printed).find(k => printed[k].docNumber === docNumber && M.matchesPending(printed[k].text, rec));
  if (pk) {
    const p = printed[pk];
    const archivePath = S.lgInvoiceArchivePath(p.date, client, docNumber);
    if (archivePath) {
      const cl = await deps.db.ref('invoicePdf/' + key).transaction(cur => {
        if (cur === null) return cur;   // קריאה ראשונה עם מטמון ריק — ר' _fake-db
        if (cur.state !== 'awaiting') return;
        return { ...cur, state: 'ready', date: p.date, archivePath, originalHash: p.originalHash,
          uploadedAt: p.createdAt, sendAfter: S.lgInvoiceSendAfter(now),
          sendKey: S.lgInvoiceSendKey(cur.clientPhone || cur.client, docNumber) };
      });
      if (cl.committed && cl.snapshot.val() && cl.snapshot.val().state === 'ready') {
        const blobs = (await deps.db.ref('invoicePdfBlobs/' + pk).once('value')).val();
        if (blobs) await deps.db.ref('invoicePdfBlobs/' + key).set(blobs);
        await deps.db.ref('invoicePdfBlobs/' + pk).set(null);
        await deps.db.ref('invoicePdf/' + pk).set(null);
        await lgInvoiceLinkOrders(deps.db, key, ids);
        return { status: 200, body: { ok: true, key, state: 'ready', matchedPrinted: true } };
      }
    }
  }
  return { status: 200, body: { ok: true, key, state: 'awaiting' } };
}

async function _list(body, deps) {
  const since = Number(body.sinceMs) || 0;
  const all = (await deps.db.ref('invoicePdf').once('value')).val() || {};
  const rows = Object.keys(all).map(k => {
    const r = all[k];
    return { key: k, state: r.state, docNumber: r.docNumber || null, date: r.date || null,
      client: r.client || '', clientPhone: r.clientPhone || '', createdAt: r.createdAt || 0,
      orderIds: r.orderIds || [], orderNums: r.orderNums || [], sketchNames: r.sketchNames || [],
      archivePath: r.archivePath || null, simulated: !!r.simulated };
  }).filter(r => r.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt).slice(0, 1000);
  return { status: 200, body: { ok: true, rows } };
}

async function _original(key, deps, check) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9]{6,40}$/.test(key)) return _fail(400, 'bad-key');
  const rec = (await deps.db.ref('invoicePdf/' + key).once('value')).val();
  //  נראה ללקוח/אדמין רק מה שאומת ושויך. 'printed' עדיין לא שויך לאף לקוח.
  if (!rec || rec.state !== 'ready') return _fail(404, 'not-ready');
  const denied = await check(rec);
  if (denied) return denied;
  const blobs = (await deps.db.ref('invoicePdfBlobs/' + key).once('value')).val();
  if (!blobs || !blobs.original) return _fail(404, 'no-file');
  return { status: 200, body: { ok: true, docNumber: rec.docNumber, pdf: blobs.original } };
}

//  deps: { db, now, verifyAdmin(req), verifyUser(req) }
async function handleCtl(req, deps) {
  if (req.method !== 'POST') return _fail(405, 'method');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body.action !== 'string') return _fail(400, 'bad-body');

  if (body.action === 'customerPdf') {
    const u = await deps.verifyUser(req);
    if (!u.ok) return _fail(u.status || 401, 'unauthorized');
    return _original(body.key, deps, async rec => {
      if (rec.simulated) return _fail(404, 'not-ready');
      const ids = rec.orderIds || [];
      if (!ids.length) return _fail(403, 'forbidden');
      for (const id of ids) {
        const p = (await deps.db.ref('orders/' + id + '/clientPhone').once('value')).val();
        if (!p || _digits(p) !== _digits(u.phone)) return _fail(403, 'forbidden');
      }
      return null;
    });
  }

  const a = await deps.verifyAdmin(req);
  if (!a.ok) return _fail(a.status || 401, 'unauthorized');
  if (body.action === 'register') return _register(body, deps, a.phone);
  if (body.action === 'list') return _list(body, deps);
  if (body.action === 'pdf') return _original(body.key, deps, async () => null);
  return _fail(400, 'bad-action');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ ok: false, code: 'not-configured' });
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    const { getAuth } = require('firebase-admin/auth');
    const { lgDatabaseUrl } = require('./_env');
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: lgDatabaseUrl() });
    const verifyUser = async r => {
      const m = String((r.headers && r.headers.authorization) || '').match(/^Bearer (.+)$/);
      if (!m) return { ok: false, status: 401 };
      try {
        const d = await getAuth(app).verifyIdToken(m[1]);
        const phone = String(d.email || '').split('@')[0].replace(/[-\s]/g, '');
        return phone ? { ok: true, phone } : { ok: false, status: 403 };
      } catch (_) { return { ok: false, status: 401 }; }
    };
    const out = await handleCtl(req, { db: getDatabase(app), verifyAdmin: require('./_verifyAdmin').verifyAdmin, verifyUser });
    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error('invoice-ctl: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
module.exports.handleCtl = handleCtl;
module.exports.lgInvoicePdfKey = lgInvoicePdfKey;
module.exports.lgInvoiceLinkOrders = lgInvoiceLinkOrders;
