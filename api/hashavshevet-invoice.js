// ═══════════════════════════════════════════════════════════════════
//  /api/hashavshevet-invoice — Vercel Serverless Function (Node runtime)
//
//  מפיק חשבונית בחשבשבת עבור הזמנה אחת או כמה הזמנות של אותו לקוח.
//  נקרא ממסך "מוכן לאיסוף" באדמין, כשמסמנים הזמנות ולוחצים "הפק חשבונית".
//
//  אותה מעטפת ואותה חתימה כמו hashavshevet-order.js — plugin `imovein`,
//  שורות שטוחות שחוזרות על accountKey ו-Reference. ההבדל היחיד הוא
//  documentid, ושהמחיר כן נשלח. ר' הנימוק למטה.
//
//  ── למה כאן דווקא כן שולחים מחיר ──
//  בהזמנה לא שולחים מחיר, וחשבשבת מתמחרים לפי כרטיס הפריט. בחשבונית זה
//  שגוי: המערכת נועלת מחיר ב-lockedItems ברגע שההזמנה מסתיימת, בדיוק כדי
//  שהמחירון לא יזוז מתחת ללקוח. חשבונית שתתומחר מחדש תסתור את הנעילה,
//  והלקוח יקבל מסמך על סכום שונה ממה שסוכם. התיעוד מתיר את שניהם:
//  השמטת המחיר היא רק כשרוצים שחשבשבת יתמחרו.
//
//  ── למה הזמנה בלי נעילה נדחית ──
//  בלי lockedItems אין מחיר מוסכם, רק תחשיב חי שישתנה עם המחירון. מסמך
//  חשבונאי לא נבנה על זה. עדיף להיעצר מאשר להוציא חשבונית שאי אפשר להגן
//  עליה מול הלקוח.
//
//  משתני סביבה — כולם כבר קיימים עבור hashavshevet-order:
//    WIZGROUND_SECRET · HASHAVSHEVET_STATION · HASHAVSHEVET_COMPANY
//    HASHAVSHEVET_NET_PASSPORT_ID · FIREBASE_SERVICE_ACCOUNT
//  אופציונלי:
//    HASHAVSHEVET_INVOICE_DOCUMENT_ID   ברירת מחדל 1 (חשבונית)
//    HASHAVSHEVET_AGENT                 ברירת מחדל 1
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { verifyAdmin } = require('./_verifyAdmin');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ENDPOINT     = 'https://ws.wizground.com/api';
const DATABASE_URL = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';

// מתוך טבלת סוגי המסמכים בתיעוד imovein:
//   1 = חשבונית   2 = ח-ן קבלה   3 = ח-ן סוכן   6 = ח-ן יצוא   7 = ח-ן רכש
const DOCUMENT_TYPES = { '1': 'חשבונית', '2': 'ח-ן קבלה', '3': "ח-ן סוכן" };
const DEFAULT_DOCUMENT_ID = process.env.HASHAVSHEVET_INVOICE_DOCUMENT_ID || '1';
const DEFAULT_AGENT       = process.env.HASHAVSHEVET_AGENT || '1';

const MAX_ORDERS = 40;

function _adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('missing FIREBASE_SERVICE_ACCOUNT env var');
  return initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DATABASE_URL });
}

function sign(pluginDataJson, secret) {
  return crypto.createHash('md5').update(pluginDataJson + secret, 'utf8').digest('hex');
}

// "L1045-2" → "10452". Reference בחשבשבת מספרי, עד 9 ספרות.
function toReference(orderNum) {
  const digits = String(orderNum || '').replace(/\D/g, '');
  if (!digits)           return { ok: false, error: `מספר ההזמנה "${orderNum}" לא מכיל ספרות` };
  if (digits.length > 9) return { ok: false, error: `מספר ההזמנה "${orderNum}" נותן ${digits.length} ספרות, והמקסימום 9` };
  if (Number(digits) <= 0) return { ok: false, error: `מספר ההזמנה "${orderNum}" מתורגם ל-0` };
  return { ok: true, reference: String(Number(digits)) };
}

// מונה אסמכתאות לחשבוניות מרוכזות. אותה תבנית של meta/orderCounter —
// transaction ולא קריאה-ואז-כתיבה, אחרת שתי חשבוניות שיופקו באותו רגע
// יקבלו את אותו מספר. מתחיל ב-5001 כדי שלא יתבלבל עם מספרי הזמנות.
async function nextInvoiceRef(db) {
  const result = await db.ref('meta/invoiceCounter').transaction(current =>
    Math.max(current || 0, 5000) + 1);
  return { ok: true, reference: String(result.snapshot.val()) };
}

// חשבונית אחת שייכת לחשבון אחד — והזהות היא הטלפון, לא השם. מפתח החשבון
// נשלף מ-users/<טלפון>, ולכן הטלפון הוא מה שקובע בפועל את מי מחייבים.
// שם לקוח הוא טקסט חופשי: הזמנה בלי שם, או שם שתוקן באמצע החודש, פיצלו
// קבוצה תקינה לשתיים וחסמו חשבונית לגיטימית. ובכיוון המסוכן יותר — שני
// לקוחות שונים בעלי אותו שם היו עוברים את הבדיקה ומחויבים שניהם לפי
// הטלפון של הראשון.
function billingPhone(orders) {
  const phones = [...new Set(orders.map(o =>
    String((o && (o.clientPhone || o.phone)) || '').replace(/[-\s]/g, '')))];
  if (phones.length > 1) return { ok: false, reason: 'mixed', phones };
  if (!phones[0])        return { ok: false, reason: 'missing' };
  return { ok: true, phone: phones[0] };
}

// "כבר הופקה חשבונית" חייב להיות מסמך שחשבשבת קיבלו. הניסיון נרשם על
// ההזמנה בלי תנאי — ניסיון שנדחה כותב sentAt בדיוק כמו ניסיון שהתקבל —
// ולכן בדיקה על sentAt לבדה נעלה את ההזמנה לתמיד בגלל חשבונית שמעולם
// לא נוצרה. httpOk === false הוא הדבר היחיד שמשחרר: רשומה בלי השדה
// (מלפני שהוא היה קיים) נחשבת כהופקה, כי חסימת חשבונית היא הפיכה
// וחיוב כפול של לקוח הוא לא.
function alreadyInvoiced(orders) {
  return orders
    .filter(o => {
      const inv = o && o.hashavshevetInvoice;
      return !!(inv && inv.sentAt && inv.httpOk !== false);
    })
    .map(o => o.orderNum || o.id);
}

// שורה אחת לכל פריט נעול. Quantity = שטח כולל במ"ר, price = המחיר למ"ר
// שננעל. lineTotal לא נשלח — חשבשבת מכפילים, ושליחת שלושתם מזמינה סתירה.
function buildLines(orders, accountKey, reference, documentId, agent) {
  const lines = [], preview = [], skipped = [];

  for (const o of orders) {
    for (const li of (o.lockedItems || [])) {
      const qty  = Number(li.area || 0) * Number(li.quantity || 1);
      const ppm2 = Number(li.pricePerM2 || 0);
      const name = li.name || '';

      if (!li.sku)  { skipped.push({ order: o.orderNum, name, reason: 'אין מק"ט על השורה הנעולה' }); continue; }
      if (!qty)     { skipped.push({ order: o.orderNum, name, sku: li.sku, reason: 'שטח 0 — חסרות מידות' }); continue; }
      if (!(ppm2 > 0)) { skipped.push({ order: o.orderNum, name, sku: li.sku, reason: 'המחיר הנעול הוא 0' }); continue; }

      lines.push({
        accountKey: String(accountKey),
        documentid: documentId,
        Reference:  reference,
        itemkey:    String(li.sku),
        Quantity:   qty.toFixed(3),
        price:      ppm2.toFixed(3),
        Agent:      String(agent),
      });
      preview.push({
        order: o.orderNum, sku: li.sku, name,
        qty: qty.toFixed(3), ppm2, lineTotal: li.lineTotal,
      });
    }
  }
  return { lines, preview, skipped };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body     = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
  const dryRun   = body.dryRun !== false;     // ברירת מחדל: לא שולחים
  const force    = body.force === true;

  if (!orderIds.length)            { res.status(400).json({ error: 'לא נבחרו הזמנות' }); return; }
  if (orderIds.length > MAX_ORDERS){ res.status(400).json({ error: `מקסימום ${MAX_ORDERS} הזמנות בחשבונית אחת` }); return; }

  const SECRET  = process.env.WIZGROUND_SECRET;
  const STATION = process.env.HASHAVSHEVET_STATION;
  const COMPANY = process.env.HASHAVSHEVET_COMPANY;
  const NET_ID  = process.env.HASHAVSHEVET_NET_PASSPORT_ID;
  if (!SECRET || !STATION || !COMPANY || !NET_ID || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing environment variables' });
    return;
  }

  try {
    const db = getDatabase(_adminApp());

    const snaps  = await Promise.all(orderIds.map(id => db.ref('orders/' + id).once('value')));
    const orders = snaps.map(s => s.val());

    for (let i = 0; i < orders.length; i++) {
      if (!orders[i]) { res.status(404).json({ error: `הזמנה ${orderIds[i]} לא נמצאה` }); return; }
    }

    // ── חשבונית אחת שייכת לחשבון אחד ──
    const acct = billingPhone(orders);
    if (!acct.ok && acct.reason === 'mixed') {
      res.status(422).json({
        error: 'ההזמנות שנבחרו שייכות ליותר מלקוח אחד',
        hint:  'חשבונית מופקת על חשבון אחד. סנן לפי לקוח ובחר שוב.',
        clients: [...new Set(orders.map(o => o.orderClient || ''))],
        phones:  acct.phones,
      });
      return;
    }
    if (!acct.ok) {
      res.status(422).json({ error: 'להזמנה אין טלפון לקוח, ולכן אין דרך למצוא מפתח חשבון' });
      return;
    }
    // לתצוגה בלבד. הזהות שמחייבים לפיה היא acct.phone, ולא השם הזה.
    const clientName = orders.map(o => o.orderClient).find(Boolean) || '';

    // ── הזמנה פיקטיבית: כל המסלול רץ, המסמך לא נוצר ──
    //
    // בהתחלה זו הייתה חסימה מוחלטת, מתוך מחשבה שחשבונית חמורה מהזמנה.
    // התוצאה הייתה שאי אפשר לבדוק את המסלול בכלל — כדי לוודא שהחשבוניות
    // עובדות היה צריך להוציא מסמך אמיתי ואז לבטל אותו ידנית בחשבשבת.
    //
    // עכשיו זה מתנהג כמו hashavshevet-order: מפתח החשבון נמצא, המחירים
    // הנעולים נקראים, השורות נבנות, החתימה מחושבת והניסיון נרשם — ורק
    // הקריאה החוצה לא יוצאת. מה שנבדק הוא המסלול האמיתי, לא קיצור דרך.
    //
    // ערבוב אסור: חשבונית אחת לא יכולה להיות חצי אמיתית.
    const testNums = orders.filter(o => o.isTest).map(o => o.orderNum || o.id);
    if (testNums.length && testNums.length !== orders.length) {
      res.status(422).json({
        error: 'הבחירה מערבבת הזמנות פיקטיביות ואמיתיות',
        hint:  'חשבונית אחת היא או פיקטיבית או אמיתית. בחר קבוצה אחידה.',
        orders: testNums,
      });
      return;
    }
    const isTest = testNums.length > 0;

    // ── בלי מחיר נעול אין על מה להוציא חשבונית ──
    const unlocked = orders.filter(o => !(Array.isArray(o.lockedItems) && o.lockedItems.length))
                           .map(o => o.orderNum || o.id);
    if (unlocked.length) {
      res.status(422).json({
        error: 'יש הזמנות בלי מחיר נעול',
        hint:  'המחיר נעול כשההזמנה מסתיימת. בלי זה אין סכום מוסכם להוציא עליו חשבונית.',
        orders: unlocked,
      });
      return;
    }

    // ── אי-כפילות ──
    const already = alreadyInvoiced(orders);
    if (already.length && !force) {
      res.status(409).json({
        error: 'כבר הופקה חשבונית על חלק מההזמנות', orders: already,
        hint:  'שלח force:true כדי להפיק שוב ביודעין',
      });
      return;
    }

    // ── מפתח החשבון — אותה שרשרת כמו בהזמנה ──
    const first = orders[0];
    const phone = acct.phone;
    const user       = (await db.ref('users/' + phone).once('value')).val();
    const accountKey = user && user.customerId;
    if (!accountKey) {
      res.status(422).json({ error: `ללקוח ${clientName || phone} אין מפתח חשבון (customerId)` });
      return;
    }

    // חשבונית על הזמנה אחת נושאת את מספר ההזמנה — נוח, ומצביע חזרה על
    // המקור. חשבונית שמכסה כמה הזמנות מקבלת מספר משלה: לקחת את הראשונה
    // מבין עשרים הוא שרירותי, והמספר הזה כבר תפוס על מסמך ההזמנה שלה.
    const ref = orders.length > 1
      ? await nextInvoiceRef(db)
      : toReference(first.orderNum);
    if (!ref.ok) { res.status(422).json({ error: ref.error }); return; }

    const documentId = DOCUMENT_TYPES[String(body.documentId)] ? String(body.documentId) : DEFAULT_DOCUMENT_ID;
    const agent      = String(body.agent != null && body.agent !== '' ? body.agent : DEFAULT_AGENT).replace(/\D/g, '');
    if (!(Number(agent) > 0)) {
      res.status(422).json({ error: `קוד סוכן חייב להיות חיובי ושונה מאפס. התקבל "${agent || '(ריק)'}"` });
      return;
    }

    const { lines, preview, skipped } = buildLines(orders, accountKey, ref.reference, documentId, agent);
    if (!lines.length) { res.status(422).json({ error: 'אין אף שורה להפקה', skipped }); return; }

    const total = preview.reduce((s, p) => s + (Number(p.lineTotal) || 0), 0);

    if (dryRun) {
      res.status(200).json({
        ok: true, dryRun: true, isTest,
        client: clientName, accountKey, reference: ref.reference,
        documentId, documentName: DOCUMENT_TYPES[documentId], agent,
        orderNums: orders.map(o => o.orderNum), lineCount: lines.length,
        total, preview, skipped,
      });
      return;
    }

    const pluginDataJson = JSON.stringify(lines);
    const signature      = sign(pluginDataJson, SECRET);
    const payload =
      `{"station":${JSON.stringify(STATION)},` +
      `"plugin":"imovein",` +
      `"company":${JSON.stringify(COMPANY)},` +
      `"message":{"netPassportID":${JSON.stringify(NET_ID)},` +
      `"pluginData":${pluginDataJson}},` +
      `"signature":${JSON.stringify(signature)}}`;

    // הכל עד כאן כבר רץ: מפתח החשבון, המחירים הנעולים, השורות, החתימה.
    // מכאן והלאה גם הרישום והתשובה זהים — ההבדל היחיד הוא ש-fetch לא נקרא.
    // הבדיקה על ההזמנה עצמה ולא על פרמטר מהדפדפן, כי פרמטר אפשר לזייף.
    let wgRes, text;
    if (isTest) {
      wgRes = { status: 200, ok: true };
      text  = JSON.stringify({ simulated: true, note: 'הזמנה פיקטיבית — לא הופקה חשבונית בחשבשבת' });
    } else {
      wgRes = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: payload,
      });
      text = await wgRes.text();
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* לא JSON */ }

    // נרשם על כל הזמנה בבחירה, עם רשימת האחיות שלה — כדי שאפשר יהיה
    // לשחזר מי נכלל באותו מסמך. httpOk הוא "הבקשה התקבלה", לא "המסמך נוצר":
    // בהזמנות ראינו 200 עם status ok ובלי מסמך.
    const attempt = {
      sentAt:      Date.now(),
      sentBy:      auth.phone,
      reference:   ref.reference,
      accountKey:  String(accountKey),
      documentId,
      agent,
      lineCount:   lines.length,
      total,
      withOrders:  orders.map(o => String(o.orderNum || o.id)),
      // בלי זה אי אפשר יהיה להבדיל אחר כך בין חשבונית שהופקה בחשבשבת לבין
      // ריצה פיקטיבית שרק נראתה כך.
      simulated:   isTest || null,
      httpStatus:  wgRes.status,
      httpOk:      wgRes.ok,
      response:    text.slice(0, 4000),
      requestSample: lines[0] || null,
      skipped:     skipped.length ? skipped : null,
    };
    await Promise.all(orderIds.map(id =>
      db.ref('orders/' + id + '/hashavshevetInvoice').set(attempt)));

    if (!wgRes.ok) {
      console.error('hashavshevet-invoice: WizGround error', wgRes.status, text.slice(0, 500));
      res.status(502).json({ error: 'חשבשבת דחו את הבקשה', status: wgRes.status,
                             response: parsed || text.slice(0, 4000), skipped });
      return;
    }

    res.status(200).json({
      ok: true, dryRun: false, simulated: isTest,
      client: clientName, accountKey, reference: ref.reference,
      documentId, documentName: DOCUMENT_TYPES[documentId],
      orderNums: orders.map(o => o.orderNum),
      lineCount: lines.length, total, skipped,
      response: parsed || text.slice(0, 4000),
    });

  } catch (e) {
    console.error('hashavshevet-invoice: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
