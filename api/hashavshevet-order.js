// ═══════════════════════════════════════════════════════════════════
//  /api/hashavshevet-order — Vercel Serverless Function (Node runtime)
//
//  פותח הזמנה בחשבשבת דרך WizGround, plugin `imovein`.
//  נקרא מתור הסקיצות ב-admin.html בלחיצה על "הועבר לחשבשבת".
//
//  המעטפת והחתימה זהות ל-hashavshevet-items.js / -accounts.js. ההבדל
//  היחיד: ב-`reports` ה-pluginData הוא אובייקט, וב-`imovein` הוא מערך —
//  שורה אחת לכל פריט בהזמנה.
//
//  ── למה הנתונים נקראים מהשרת ולא מגיעים מהדפדפן ──
//  זה מסמך חשבונאי. הלקוח שולח orderId בלבד; כל מפתח חשבון, מק"ט, כמות
//  ומחיר נקראים כאן מ-Firebase דרך Admin SDK. דפדפן לא יכול להזריק מחיר.
//
//  משתני סביבה נדרשים (Vercel Dashboard → Project Settings):
//    WIZGROUND_SECRET               הסוד לחתימת MD5
//    HASHAVSHEVET_STATION           מזהה תחנה (GUID)
//    HASHAVSHEVET_COMPANY           קוד חברה
//    HASHAVSHEVET_NET_PASSPORT_ID   מזהה הדרכון
//    FIREBASE_SERVICE_ACCOUNT       ר' api/_verifyAdmin.js
//
//  אופציונלי — רק אם חשבשבת יגידו שהערכים שונים ל-imovein:
//    HASHAVSHEVET_IMOVEIN_NET_PASSPORT_ID   דורס את הדרכון לפלאגין הזה
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { verifyAdmin } = require('./_verifyAdmin');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const ENDPOINT     = 'https://ws.wizground.com/api';
const DATABASE_URL = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';

// סוגי המסמכים הרלוונטיים מתוך הטבלה בתיעוד:
//   30 = הזמנה        31 = הזמ' סוכן        34 = הזמ' רכש
//
// בהתחלה נאמר לנו "תמיד 30", ושלחנו 30. חשבשבת החזירו status:ok אבל שום
// מסמך לא נוצר, ואז התברר שההזמנות אצלנו נפתחות דרך "הזמנת סוכן" — כלומר
// 31, ולא 30. לכן זה לא מקודד קשיח יותר.
const DOCUMENT_TYPES = { '30': 'הזמנה', '31': "הזמ' סוכן", '34': "הזמ' רכש" };
const DEFAULT_DOCUMENT_ID = process.env.HASHAVSHEVET_DOCUMENT_ID || '31';

// Agent — בהזמנת סוכן אמיתית שקיימת אצל הלקוח בחשבשבת השדה מכיל 0, לא ריק.
// לכן ברירת המחדל היא "0" והשדה נשלח תמיד. גרסה קודמת גם דרשה מספר סוכן
// לא-אפס וגם השמיטה את השדה לגמרי כשלא הוזן — שתיהן טעויות.
const DEFAULT_AGENT = process.env.HASHAVSHEVET_AGENT != null
  ? String(process.env.HASHAVSHEVET_AGENT) : '0';

// מחסן. מסומן חובה בטבלת השדות, ובמסך של הלקוח הוא מגיע כ-1 כברירת מחדל.
// לא נשלח עד כה — מועמד סביר לכך שהקליטה עברה "ok" בלי ליצור מסמך.
const DEFAULT_WAREHOUSE = process.env.HASHAVSHEVET_WAREHOUSE || '1';

function _adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('missing FIREBASE_SERVICE_ACCOUNT env var');
  return initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DATABASE_URL });
}

function sign(pluginDataJson, secret) {
  return crypto.createHash('md5').update(pluginDataJson + secret, 'utf8').digest('hex');
}

// זהה ל-lgCalcAreaM2 ב-firebase-db.js. משוכפל בכוונה: אותו חישוב חייב
// לרוץ כאן בשרת, ואי אפשר לייבא קובץ דפדפן. אם אחד משתנה — שנה את שניהם.
function areaM2(widthMm, heightMm) {
  return Math.round((widthMm || 0) * (heightMm || 0) / 1000) / 1000;
}

// "L1000" → "1000"  ·  "2026-54321" → "202654321"
// Reference בחשבשבת הוא מספרי עד 9 ספרות; מספרי ההזמנה שלנו אינם מספריים.
function toReference(orderNum) {
  const digits = String(orderNum || '').replace(/\D/g, '');
  if (!digits)             return { ok: false, error: `מספר ההזמנה "${orderNum}" לא מכיל ספרות` };
  if (digits.length > 9)   return { ok: false, error: `מספר ההזמנה "${orderNum}" נותן ${digits.length} ספרות, והמקסימום הוא 9` };
  if (Number(digits) <= 0) return { ok: false, error: `מספר ההזמנה "${orderNum}" מתורגם ל-0, וחשבשבת דורשים חיובי` };
  return { ok: true, reference: String(Number(digits)) };
}

// בונה שורה אחת לכל פריט מתומחר.
// Quantity = שטח במ"ר, price = מחיר למ"ר — הפריטים בחשבשבת הם מסוג "מכפלה",
// וזה גם בדיוק מה ש-lgCalcOrderTotal מחשב.
// התיעוד סותר את עצמו: דוגמת ה-JSON כותבת "documentid" והטבלה "DocumentID".
// בחתימת MD5 ובפענוח בשרת אלה שני שדות שונים לגמרי, ואם השם לא נכון השרת
// עשוי להתעלם מהשדה בשקט — מה שמסביר "status: ok" בלי מסמך.
// אפשר לבחור בזמן ריצה כדי לבדוק את שתי האפשרויות בלי פריסה מחדש.
const DOC_ID_FIELDS = {
  lower: 'documentid',   // לפי הדוגמה בתיעוד — ברירת המחדל, וזה מה שנשלח עד כה
  upper: 'DocumentID',   // לפי טבלת השדות
  both:  null,           // שולח את שניהם
};

function buildLines(order, accountKey, reference, globalPrices, clientPrices, opts) {
  const { docIdMode, documentId, agent, warehouse } = opts;
  const cp    = (clientPrices || {})[order.orderClient || ''] || {};
  const gp    = globalPrices || {};
  const lines = [];
  const skipped = [];

  const items = Array.isArray(order.items) ? order.items
              : (order.items && typeof order.items === 'object') ? Object.values(order.items)
              : [];

  items.forEach((item, i) => {
    const name = item.glassFullName || item.name || `פריט ${i + 1}`;
    const sku  = item.sku;
    if (!sku) { skipped.push({ name, reason: 'אין מק"ט (sku) על הפריט' }); return; }

    const ppm2 = parseFloat(cp[sku] || gp[sku] || 0);
    if (!ppm2) { skipped.push({ name, sku, reason: 'אין מחיר למק"ט הזה' }); return; }

    const qty = areaM2(item.w || 0, item.h || 0);
    if (!qty) { skipped.push({ name, sku, reason: 'שטח 0 — חסרות מידות' }); return; }

    // סדר המפתחות כאן הוא חלק מחוזה החתימה — אין לשנות.
    const line = { accountKey: String(accountKey) };
    if (docIdMode === 'upper')      line.DocumentID = documentId;
    else if (docIdMode === 'both') { line.documentid = documentId; line.DocumentID = documentId; }
    else                            line.documentid = documentId;
    line.Reference = reference;
    line.itemkey   = String(sku);
    line.Quantity  = qty.toFixed(3);
    line.price     = ppm2.toFixed(3);
    // שניהם נשלחים תמיד, כולל כשהערך הוא "0" — כך זה נראה במסמך אמיתי.
    if (warehouse !== '') line.warehouse = String(warehouse);
    if (agent     !== '') line.Agent     = String(agent);
    lines.push(line);
  });

  return { lines, skipped };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const SECRET  = process.env.WIZGROUND_SECRET;
  const STATION = process.env.HASHAVSHEVET_STATION;
  const COMPANY = process.env.HASHAVSHEVET_COMPANY;
  const NET_ID  = process.env.HASHAVSHEVET_IMOVEIN_NET_PASSPORT_ID
               || process.env.HASHAVSHEVET_NET_PASSPORT_ID;

  if (!SECRET || !STATION || !COMPANY || !NET_ID) {
    console.error('hashavshevet-order: missing env vars', {
      hasSecret: !!SECRET, hasStation: !!STATION, hasCompany: !!COMPANY, hasNetId: !!NET_ID
    });
    res.status(500).json({ error: 'server not configured — missing environment variables' });
    return;
  }

  const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const orderId = String(body.orderId || '').trim();
  const dryRun  = body.dryRun !== false;   // ברירת מחדל: לא שולחים. חייבים dryRun:false במפורש.
  const force   = body.force === true;

  if (!orderId) { res.status(400).json({ error: 'orderId חסר' }); return; }

  try {
    const db = getDatabase(_adminApp());

    const [orderSnap, pricesSnap] = await Promise.all([
      db.ref('orders/' + orderId).once('value'),
      db.ref('prices').once('value'),
    ]);

    const order = orderSnap.val();
    if (!order) { res.status(404).json({ error: 'הזמנה לא נמצאה' }); return; }

    // ── אי-כפילות: לא פותחים את אותה הזמנה פעמיים בחשבשבת ──
    if (order.hashavshevet && order.hashavshevet.sentAt && !force) {
      res.status(409).json({
        error: 'ההזמנה כבר נשלחה לחשבשבת',
        sentAt:    order.hashavshevet.sentAt,
        reference: order.hashavshevet.reference,
        hint:      'שלח force:true כדי לשלוח שוב ביודעין',
      });
      return;
    }

    // ── Reference ──
    const ref = toReference(order.orderNum);
    if (!ref.ok) { res.status(422).json({ error: ref.error }); return; }

    // ── accountKey: מפתח החשבון של הלקוח ──
    const phone = String(order.clientPhone || order.phone || '').replace(/[-\s]/g, '');
    if (!phone) { res.status(422).json({ error: 'להזמנה אין טלפון לקוח, ולכן אין דרך למצוא מפתח חשבון' }); return; }

    const userSnap  = await db.ref('users/' + phone).once('value');
    const user      = userSnap.val();
    const accountKey = user && user.customerId;
    if (!accountKey) {
      res.status(422).json({
        error: `ללקוח ${order.orderClient || phone} אין מפתח חשבון (customerId) במערכת`,
        hint:  'סנכרן לקוחות מחשבשבת, או הגדר מפתח חשבון בניהול משתמשים',
      });
      return;
    }

    // ── שורות ──
    const prices = pricesSnap.val() || {};
    const docIdMode  = ['lower', 'upper', 'both'].includes(body.docIdMode) ? body.docIdMode : 'lower';
    const documentId = DOCUMENT_TYPES[String(body.documentId)] ? String(body.documentId) : DEFAULT_DOCUMENT_ID;
    const agent     = String(body.agent     != null ? body.agent     : DEFAULT_AGENT).replace(/\D/g, '');
    const warehouse = String(body.warehouse != null ? body.warehouse : DEFAULT_WAREHOUSE).replace(/\D/g, '');

    const { lines, skipped } = buildLines(order, accountKey, ref.reference,
      prices.global, prices.client, { docIdMode, documentId, agent, warehouse });

    if (!lines.length) {
      res.status(422).json({ error: 'אין אף פריט מתומחר לשליחה', skipped });
      return;
    }

    // ── מעטפת + חתימה. סדר המפתחות והמחרוזת היחידה — כמו בשאר הקבצים. ──
    const pluginDataJson = JSON.stringify(lines);
    const signature      = sign(pluginDataJson, SECRET);

    const payload =
      `{"station":${JSON.stringify(STATION)},` +
      `"plugin":"imovein",` +
      `"company":${JSON.stringify(COMPANY)},` +
      `"message":{"netPassportID":${JSON.stringify(NET_ID)},` +
      `"pluginData":${pluginDataJson}},` +
      `"signature":${JSON.stringify(signature)}}`;

    // ── מצב בדיקה: מראים בדיוק מה היה נשלח, בלי לשלוח ──
    if (dryRun) {
      res.status(200).json({
        ok: true, dryRun: true,
        reference: ref.reference, accountKey,
        documentId, documentName: DOCUMENT_TYPES[documentId] || '?', agent, warehouse,
        docIdMode, docIdField: docIdMode === 'both' ? 'documentid + DocumentID' : DOC_ID_FIELDS[docIdMode],
        lineCount: lines.length, lines, skipped,
        // בלי signature ובלי station — אלה סודות
        preview: { plugin: 'imovein', company: COMPANY, netPassportID: NET_ID, pluginData: lines },
      });
      return;
    }

    const wgRes = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body:    payload,
    });
    const text = await wgRes.text();

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* לא JSON — נשמור גולמי */ }

    // ── רישום הניסיון תמיד, גם בכישלון ──
    //
    // בפעם הראשונה שמרנו רק חותמת בלי התשובה. WizGround החזירו HTTP 200,
    // ההזמנה סומנה כנשלחה — ובחשבשבת לא נוצר שום מסמך. בלי גוף התשובה לא
    // הייתה שום דרך לדעת למה. מכאן והלאה התשובה נשמרת תמיד.
    //
    // שים לב: httpOk הוא "הבקשה התקבלה", לא "המסמך נוצר". אלה שני דברים
    // שונים, וזה בדיוק מה שהכשיל אותנו.
    const attempt = {
      sentAt:     Date.now(),
      sentBy:     auth.phone,
      reference:  ref.reference,
      accountKey: String(accountKey),
      documentId: documentId,
      agent:      agent || null,
      warehouse:  warehouse || null,
      docIdMode:  docIdMode,
      lineCount:  lines.length,
      httpStatus: wgRes.status,
      httpOk:     wgRes.ok,
      response:   text.slice(0, 4000),
      requestSample: lines[0] || null,   // שורה אחת, לאימות שמות השדות
      skipped:    skipped.length ? skipped : null,
    };
    await db.ref('orders/' + orderId + '/hashavshevet').set(attempt);

    if (!wgRes.ok) {
      console.error('hashavshevet-order: WizGround error', wgRes.status, text.slice(0, 500));
      res.status(502).json({
        error: 'חשבשבת דחו את הבקשה',
        status: wgRes.status,
        // קודי H-Connect: 5 = netPassportID חסר, 10 = אין רישיון למודול,
        // 13 = ולידציה נכשלה. זו הדרך היחידה לאבחן.
        response: parsed || text.slice(0, 4000),
        skipped,
      });
      return;
    }

    res.status(200).json({
      ok: true, dryRun: false,
      reference: ref.reference, accountKey,
      lineCount: lines.length, skipped,
      response: parsed || text.slice(0, 4000),
    });

  } catch (e) {
    console.error('hashavshevet-order: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
