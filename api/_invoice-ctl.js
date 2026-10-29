// ═══════════════════════════════════════════════════════════════════
//  /api/invoice-ctl — בקרה על חשבוניות (DB-00004).
//  (rewrite אל wa-inbound?invoice=ctl — מגבלת 12 הפונקציות)
//
//  פעולות (פרמטר action):
//    POST register  {docNumber, orderIds}   אדמין — "החשבונית הופקה" בתחנה
//    GET  list      ?from=<ms>&q=<טקסט>     אדמין — ארכיון חשבוניות
//    GET  pdf       ?key=                   אדמין — פותח את המקור
//    GET  mine                              לקוח — החשבוניות שלו (מוכנות בלבד)
//    GET  minepdf   ?key=                   לקוח — המקור, רק אם כל ההזמנות שלו
//
//  ההעתק לעולם לא יוצא מכאן: רק blob.original נקרא.
//
//  סדר ההדפסה והרישום לא משנה:
//    רישום ואז הדפסה → ההעלאה משייכת לרשומה 'awaiting' (_invoice-upload).
//    הדפסה ואז רישום → ההעלאה נשמרת כ'printed'; הרישום (או ניסיון חוזר של
//    הכלי) משייך אותה לפי מספר מסמך + שמות הסקיצות. כל אי-ודאות → נשארת.
// ═══════════════════════════════════════════════════════════════════

const M = require('./_invoice-match');
const S = require('./_invoice-send');

const DAY = 24 * 3600 * 1000;
const normPhone = p => String(p || '').replace(/[-\s]/g, '');
const fail = (status, code) => ({ status, body: { ok: false, code } });

//  awaiting → ready, אטומי. מחזיר את הרשומה או null אם כבר טופלה / אין נתיב ארכיון.
async function markReady(db, key, d, now) {
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    //  ⚠️ קריאה ראשונה היא עם null (מטמון ריק). undefined שם מבטל את כל
    //  הטרנזקציה בשקט — ר' הערה ב-scripts/_fake-db.js. לכן null, לא return ריק.
    if (!cur) return null;
    if (cur.state !== 'awaiting') return;
    if (cur.docNumber && cur.docNumber !== d.docNumber) return;
    const archivePath = S.lgInvoiceArchivePath(d.date, cur.client, d.docNumber);
    if (!archivePath) return;
    return { ...cur, state: 'ready', docNumber: d.docNumber, date: d.date, archivePath,
      originalHash: d.hash, uploadedAt: now, sendAfter: S.lgInvoiceSendAfter(now),
      sendKey: S.lgInvoiceSendKey(cur.clientPhone || cur.client, d.docNumber) };
  });
  const done = tx.snapshot.val();
  if (!tx.committed || !done || done.state !== 'ready') return null;
  await db.ref('invoicePdfBlobs/' + key).set({
    original: d.original.toString('base64'), copy: d.copy.toString('base64') });
  return done;
}

//  מנסה לשייך הדפסה שמחכה ('printed') לחשבונית רשומה עם אותו מספר מסמך.
async function settlePrinted(db, printedKey, now) {
  const p = (await db.ref('invoicePdf/' + printedKey).once('value')).val();
  if (!p || p.state !== 'printed' || !p.docNumber) return { settled: false };
  const pend = (await db.ref('invoicePdf').orderByChild('state').equalTo('awaiting').limitToFirst(200).once('value')).val() || {};
  const hits = Object.keys(pend).filter(k => pend[k].docNumber === p.docNumber && M.matchesPending(p.text, pend[k]));
  if (hits.length !== 1) return { settled: false };
  const blob = (await db.ref('invoicePdfBlobs/' + printedKey).once('value')).val();
  if (!blob || !blob.original || !blob.copy) return { settled: false };
  const rec = await markReady(db, hits[0], {
    docNumber: p.docNumber, date: p.date, hash: p.originalHash,
    original: Buffer.from(blob.original, 'base64'), copy: Buffer.from(blob.copy, 'base64') }, now);
  if (!rec) return { settled: false };
  await db.ref('invoicePdf/' + printedKey).set(null);
  await db.ref('invoicePdfBlobs/' + printedKey).set(null);
  return { settled: true, key: hits[0], rec };
}

async function register(db, body, by, now) {
  const dn = String((body && body.docNumber) || '').trim();
  const ids = Array.isArray(body && body.orderIds) ? [...new Set(body.orderIds.map(String))] : [];
  if (!/^\d{1,12}$/.test(dn) || !ids.length || ids.length > 40) return fail(400, 'bad-input');
  const docNumber = String(Number(dn));

  const orders = (await Promise.all(ids.map(id => db.ref('orders/' + id).once('value')))).map(s => s.val());
  if (orders.some(o => !o)) return fail(404, 'order-missing');
  const phones = [...new Set(orders.map(o => normPhone(o.clientPhone || o.phone)))];
  if (phones.length !== 1 || !phones[0]) return fail(422, 'mixed-or-missing-phone');

  const key = S.lgInvoicePdfKey(ids);
  //  כרטיס הלקוח בחשבשבת — לפיו ("מפתח" בחשבונית) משייכים את ההדפסה
  const user = (await db.ref('users/' + phones[0]).once('value')).val();
  const rec = {
    state: 'awaiting', docNumber, createdAt: now, createdBy: by,
    client: orders.map(o => o.orderClient).find(Boolean) || '', clientPhone: phones[0],
    accountKey: user && user.customerId ? String(user.customerId) : null,
    simulated: orders.every(o => o.isTest) || null,
    orderIds: ids, orderNums: orders.map(o => String(o.orderNum || o.id)),
    sketchNames: orders.map(o => String(o.sketchName || o.type || o.desc || '').trim()),
  };
  const tx = await db.ref('invoicePdf/' + key).transaction(cur => {
    if (!cur) return rec;
    if (cur.state !== 'awaiting') return;
    return { ...cur, docNumber, accountKey: cur.accountKey || rec.accountKey };
  });
  const state = tx.committed ? tx.snapshot.val().state : ((await db.ref('invoicePdf/' + key).once('value')).val() || {}).state;

  //  הדפסה שהגיעה לפני הרישום
  let settled = false;
  if (state === 'awaiting') {
    const q = (await db.ref('invoicePdf').orderByChild('docNumber').equalTo(docNumber).once('value')).val() || {};
    for (const k of Object.keys(q)) {
      if (q[k].state !== 'printed') continue;
      const r = await settlePrinted(db, k, now);
      if (r.settled) { settled = true; break; }
    }
  }
  return { status: 200, body: { ok: true, key, state: settled ? 'ready' : state, settled } };
}

//  שדות בטוחים לתצוגה. בלי hash, טקסט גולמי או נתיבי blob.
function view(k, r) {
  return { key: k, state: r.state, client: r.client || '', clientPhone: r.clientPhone || '',
    docNumber: r.docNumber || '', date: r.date || '', orderNums: r.orderNums || [],
    orderIds: r.orderIds || [], sketchNames: r.sketchNames || [], archivePath: r.archivePath || '',
    createdAt: r.createdAt || 0, uploadedAt: r.uploadedAt || 0, simulated: !!r.simulated,
    delivery: r.delivery ? { state: r.delivery.state || '', channel: r.delivery.channel || '', reason: r.delivery.reason || '' } : null };
}

async function list(db, query, now) {
  const from = Number(query.from) > 0 ? Number(query.from) : now - 183 * DAY;
  const snap = (await db.ref('invoicePdf').orderByChild('createdAt').startAt(from).once('value')).val() || {};
  const q = String(query.q || '').trim().toLowerCase();
  const items = Object.keys(snap).map(k => view(k, snap[k]))
    .filter(v => v.createdAt >= from)
    .filter(v => !q || [v.client, v.clientPhone, v.docNumber, ...v.orderNums, ...v.sketchNames]
      .some(x => String(x).toLowerCase().includes(q)))
    .map(v => ({ ...v, stale: v.state === 'awaiting' && now - v.createdAt > DAY }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  return { status: 200, body: { ok: true, items } };
}

async function original(db, key) {
  if (!key) return fail(400, 'bad-key');
  const blob = (await db.ref('invoicePdfBlobs/' + key).once('value')).val();
  if (!blob || !blob.original) return fail(404, 'no-pdf');
  return { status: 200, pdf: Buffer.from(blob.original, 'base64') };   // original בלבד
}

//  כל ההזמנות של החשבונית שייכות לטלפון הזה.
async function owns(db, rec, phone) {
  if (normPhone(rec.clientPhone) !== phone) return false;
  const ids = rec.orderIds || [];
  if (!ids.length) return false;
  const orders = await Promise.all(ids.map(id => db.ref('orders/' + id + '/clientPhone').once('value')));
  return orders.every(s => normPhone(s.val()) === phone);
}

async function mine(db, phone) {
  const snap = (await db.ref('invoicePdf').orderByChild('clientPhone').equalTo(phone).once('value')).val() || {};
  const items = [];
  for (const k of Object.keys(snap)) {
    const r = snap[k];
    if (r.state !== 'ready' || r.simulated) continue;
    if (!(await owns(db, r, phone))) continue;
    const v = view(k, r);
    items.push({ key: v.key, docNumber: v.docNumber, date: v.date, orderNums: v.orderNums,
      orderIds: v.orderIds, sketchNames: v.sketchNames });
  }
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { status: 200, body: { ok: true, items } };
}

async function minePdf(db, key, phone) {
  const r = key && (await db.ref('invoicePdf/' + key).once('value')).val();
  if (!r || r.state !== 'ready' || r.simulated || !(await owns(db, r, phone))) return fail(404, 'not-found');
  return original(db, key);
}

//  deps: { db, now, verify(req) → {ok,status,error,phone,role} }
async function handleCtl(req, deps) {
  const now = deps.now || Date.now();
  const u = await deps.verify(req);
  if (!u.ok) return fail(u.status || 401, 'unauthorized');
  const q = req.query || {};
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  const action = String(q.action || (body && body.action) || '');
  const admin = u.role === 'admin';

  if (req.method === 'POST' && action === 'register') {
    if (!admin) return fail(403, 'forbidden');
    const r = await register(deps.db, body, u.phone, now);
    //  הדפסה שחיכתה ושויכה עכשיו → נשלחת ללקוח מיד (כמו בהעלאה)
    if (r.status === 200 && r.body && r.body.settled) {
      await require('./_invoice-upload').deliverSafe(deps, r.body.key);
    }
    return r;
  }
  if (req.method !== 'GET') return fail(405, 'method');
  if (action === 'list') return admin ? list(deps.db, q, now) : fail(403, 'forbidden');
  if (action === 'pdf') return admin ? original(deps.db, q.key) : fail(403, 'forbidden');
  if (action === 'mine') return mine(deps.db, normPhone(u.phone));
  if (action === 'minepdf') return minePdf(deps.db, q.key, normPhone(u.phone));
  return fail(400, 'bad-action');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ ok: false, code: 'not-configured' });
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    const { lgDatabaseUrl } = require('./_env');
    const { verifyUser } = require('./_verifyAdmin');
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: lgDatabaseUrl() });
    const r = await handleCtl(req, { db: getDatabase(app), verify: verifyUser });
    if (r.pdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="invoice.pdf"');
      return res.status(200).send(r.pdf);
    }
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('invoice-ctl: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
module.exports.handleCtl = handleCtl;
module.exports.markReady = markReady;
module.exports.settlePrinted = settlePrinted;
