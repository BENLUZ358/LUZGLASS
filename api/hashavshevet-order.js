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

// ── מה נשלח בפועל ────────────────────────────────────────────────────────
//
//     accountKey · documentid · Reference · itemkey · Quantity · Agent
//
// המחיר לא נשלח — חשבשבת מושכים אותו מכרטיס הפריט. וכך גם warehouse
// ו-copies, שהוספתי קודם על סמך טבלת השדות והתבררו כמיותרים.
//
// Agent חזר אחרי שיומן הקליטה הראה "ERROR קוד עובד לא קיים" חמש פעמים,
// אחת לכל שורה. בשיחה נאמר שמספיקים חמישה שדות, אז הסרתי אותו — אבל
// דוגמת ה-JSON הרשמית שולחת "Agent": "999", וכלל 2 ב"בדיקות מיוחדות
// והערות" דורש שהסוכן יהיה חיובי ושונה מאפס. כשהשדה חסר הקליטה מציבה 0,
// וסוכן 0 לא קיים — ולכן כל שורה נפסלה.
//
// הערך ניתן לשינוי מהבקשה, כדי שאפשר יהיה לנסות קודים בלי פריסה מחדש.
const DEFAULT_AGENT = process.env.HASHAVSHEVET_AGENT || '1';
//
// ההשלכה החשובה של אי-שליחת מחיר: אסור לדלג על פריט רק בגלל שאין לו מחיר
// אצלנו. הגרסה הקודמת דילגה, ולכן שורות היו נשמטות מהמסמך בשקט.

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

// בונה שורה אחת לכל פריט. Quantity = שטח במ"ר, כי הפריטים בחשבשבת הם
// מסוג "מכפלה" והמחיר שם הוא למ"ר.
//
// המחיר שלנו עדיין מחושב — אבל רק לתצוגה המקדימה, כדי שתדע מה אתה שולח.
// הוא לא נכנס לשורה שנשלחת.
function buildLines(order, accountKey, reference, documentId, agent, globalPrices, clientPrices) {
  const cp    = (clientPrices || {})[order.orderClient || ''] || {};
  const gp    = globalPrices || {};
  const lines = [];
  const preview = [];
  const skipped = [];

  const items = Array.isArray(order.items) ? order.items
              : (order.items && typeof order.items === 'object') ? Object.values(order.items)
              : [];

  items.forEach((item, i) => {
    const name = item.glassFullName || item.name || `פריט ${i + 1}`;
    const sku  = item.sku;
    if (!sku) { skipped.push({ name, reason: 'אין מק"ט (sku) על הפריט' }); return; }

    const qty = areaM2(item.w || 0, item.h || 0);
    if (!qty) { skipped.push({ name, sku, reason: 'שטח 0 — חסרות מידות' }); return; }

    // סדר המפתחות הוא חלק מחוזה החתימה — אין לשנות.
    lines.push({
      accountKey: String(accountKey),
      documentid: documentId,
      Reference:  reference,
      itemkey:    String(sku),
      Quantity:   qty.toFixed(3),
      Agent:      String(agent),
    });

    // לתצוגה בלבד. אין מחיר אצלנו? זה בסדר גמור — חשבשבת יתמחרו.
    const ppm2 = parseFloat(cp[sku] || gp[sku] || 0);
    preview.push({ name, sku, qty: qty.toFixed(3), ppm2: ppm2 || null });
  });

  return { lines, preview, skipped };
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

    // הזמנה פיקטיבית. התהליך כולו זהה — אותן בדיקות, אותה בקשה, אותו רישום
    // ואותה תשובה — רק שהקריאה לשרת של חשבשבת לא יוצאת. ר' _simulated למטה.
    const isTest = order.isTest === true;

    // ── אי-כפילות: לא פותחים את אותה הזמנה פעמיים בחשבשבת ──
    if (order.hashavshevet && order.hashavshevet.sentAt && !force) {
      res.status(409).json({
        error: 'ההזמנה כבר נשלחה לחשבשבת',
        sentAt:    order.hashavshevet.sentAt,
        reference: order.hashavshevet.reference,
        // התשובה השמורה חוזרת מכאן ולא מרשומת ההזמנה בדפדפן, כי היא לא
        // עוברת ב-lgNormalizeOrder בכוונה: 4000 תווים כפול כל הזמנה בצומת
        // שכל דף מוריד במלואו. כאן היא נטענת רק כשמבקשים אותה.
        response:  order.hashavshevet.response || null,
        httpOk:    order.hashavshevet.httpOk ?? null,
        simulated: order.hashavshevet.simulated || null,
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
    const documentId = DOCUMENT_TYPES[String(body.documentId)] ? String(body.documentId) : DEFAULT_DOCUMENT_ID;
    const agent = String(body.agent != null && body.agent !== '' ? body.agent : DEFAULT_AGENT).replace(/\D/g, '');

    // כלל 2 בתיעוד: סוכן חייב להיות חיובי ושונה מאפס. אפס נקלט ונפסל בשקט —
    // עדיף להיעצר כאן מאשר לגלות את זה ביומן השגיאות של הקליטה.
    if (!(Number(agent) > 0)) {
      res.status(422).json({
        error: `קוד סוכן חייב להיות מספר חיובי ושונה מאפס. התקבל: "${agent || '(ריק)'}"`,
        hint:  'הקליטה בחשבשבת נכשלת עם "קוד עובד לא קיים" כשהסוכן הוא 0 או חסר',
      });
      return;
    }

    const { lines, preview, skipped } = buildLines(order, accountKey, ref.reference,
      documentId, agent, prices.global, prices.client);

    if (!lines.length) {
      res.status(422).json({ error: 'אין אף פריט לשליחה', skipped });
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
        ok: true, dryRun: true, isTest,
        reference: ref.reference, accountKey,
        documentId, documentName: DOCUMENT_TYPES[documentId] || '?', agent,
        lineCount: lines.length, lines, preview, skipped,
        // המעטפת, לאבחון. בלי signature ובלי station — אלה סודות.
        // חייב שם משלו: קודם הוא נקרא preview גם הוא, דרס את מערך התצוגה,
        // ואז .map נפל על אובייקט.
        envelope: { plugin: 'imovein', company: COMPANY, netPassportID: NET_ID, pluginData: lines },
      });
      return;
    }

    // ── הזמנה פיקטיבית: כל השאר זהה, רק הקריאה החוצה לא יוצאת ──
    //
    // עד שהמערכת מאומתת במלואה צריך לפתוח הזמנות אמיתיות ולהריץ אותן דרך כל
    // התהליך, בלי שייווצר מסמך בהנהלת החשבונות — מסמך כזה דורש ביטול ידני
    // בחשבשבת ומזהם את הספרים.
    //
    // הכל עד כאן כבר רץ: מפתח החשבון נמצא, המק"טים נפתרו, השורות נבנו,
    // החתימה חושבה. מכאן והלאה גם הרישום ל-Firebase והתשובה זהים. ההבדל
    // היחיד הוא ש-fetch לא נקרא. כך שמה שנבדק הוא באמת אותו מסלול.
    //
    // הבדיקה על ההזמנה עצמה ולא על פרמטר מהדפדפן, כי פרמטר אפשר לזייף
    // ו-isTest נקבע פעם אחת בפתיחת ההזמנה.
    let wgRes, text;
    if (isTest) {
      wgRes = { status: 200, ok: true };
      text  = JSON.stringify({ simulated: true, note: 'הזמנה פיקטיבית — לא נשלחה לחשבשבת' });
    } else {
      wgRes = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    payload,
      });
      text = await wgRes.text();
    }

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
      agent:      agent,
      lineCount:  lines.length,
      httpStatus: wgRes.status,
      httpOk:     wgRes.ok,
      response:   text.slice(0, 4000),
      requestSample: lines[0] || null,   // שורה אחת, לאימות שמות השדות
      skipped:    skipped.length ? skipped : null,
      // בלי זה אי אפשר יהיה להבדיל אחר כך בין הזמנה שנפתחה בחשבשבת לבין
      // הזמנת בדיקה שרק נראתה כך. נשמר על ההזמנה, לא רק בתשובה לדפדפן.
      simulated:  isTest || null,
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

    // ── מתי להטריד את מי שעובד על המסך ──
    //
    // המסך מראה הודעה רגילה כשהכל תקין ואזהרה כשלא, ולכן ההחלטה הזו חייבת
    // להתקבל כאן — לא בדפדפן, ולא על ידי מי שמזין הזמנות.
    //
    // HTTP 200 אינו "נוצר מסמך" — חשבשבת כבר החזירו 200 בלי שנוצר כלום.
    // מה שכן מבדיל הוא גוף התשובה. השליחה האמיתית הראשונה (הזמנה 1058)
    // החזירה:
    //
    //   {"apiRes":{"status":"ok"},"actionType":"imovein","messType":"apiReplay"}
    //
    // ולכן הבדיקה היא חיובית ולא שלילית: מחפשים את הסימן שידוע שמשמעותו
    // תקין, וכל דבר אחר מעורר אזהרה. הכיוון הזה חשוב — תשובה בצורה שלא
    // ראינו מעולם תעצור אותך במקום לחלוף כהצלחה. אזהרת שווא עולה לחיצה,
    // מסמך חסר עולה הרבה יותר.
    const apiStatus = parsed && parsed.apiRes && parsed.apiRes.status;
    const warn = isTest ? null
      : !text || !text.trim() ? 'חשבשבת החזירו תשובה ריקה — ייתכן שלא נוצר מסמך'
      : parsed === null       ? 'התשובה מחשבשבת אינה בפורמט צפוי'
      : String(apiStatus||'').toLowerCase() === 'ok' ? null
      : apiStatus             ? 'חשבשבת החזירו סטטוס "' + apiStatus + '" ולא "ok"'
      : 'התשובה מחשבשבת לא כללה סטטוס — לא ידוע אם נוצר מסמך';

    res.status(200).json({
      ok: true, dryRun: false,
      simulated: isTest,
      reference: ref.reference, accountKey,
      lineCount: lines.length, skipped,
      warn,
      response: parsed || text.slice(0, 4000),
    });

  } catch (e) {
    console.error('hashavshevet-order: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
