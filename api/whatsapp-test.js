// ═══════════════════════════════════════════════════════════════════
//  /api/whatsapp-test — שליחת הודעת בדיקה אחת דרך GREEN API
//
//  ⚠️ כלי בדיקה זמני ומבודד, לא ארכיטקטורה.
//
//  השליחה ללקוחות רצה דרך api/whatsapp-send.js מול Meta Cloud API, והיא
//  לא נגעה. הקובץ הזה קיים כדי להוכיח דבר אחד בלבד: ש-LuzGlass TEST
//  מסוגל לשלוח הודעה דרך GREEN API. אחרי ההוכחה תתקבל החלטה אם GREEN API
//  מחליף את Meta — ואם כן, דרך שכבת ספקים מסודרת ולא דרך כאן.
//
//  ── מה הוא לא עושה, ובכוונה ──
//    · לא קורא ולא כותב הזמנות. אין דרך שישלח למישהו בגלל נתון בהזמנה.
//    · לא מקבל רשימה. הודעה אחת לקריאה — שליחה המונית אינה אפשרית מבנית.
//    · לא נגיש מהממשק. כפתור הוא דרך לשלוח בטעות.
//
//  ── ארבע נעילות, ב-lgGreenApiTest ב-_env.js ──
//    1. חסום בייצור            2. GREENAPI_TEST_ENABLED=1
//    3. נמען יחיד מורשה         4. אישורי חיבור קיימים
//
//  משתני סביבה — בפרויקט ה-Vercel של TEST בלבד:
//    GREENAPI_ID_INSTANCE    מזהה המופע
//    GREENAPI_TOKEN          ⚠️ סוד. לא ללוג, לא לתשובה, לא ל-repo
//    GREENAPI_TEST_ENABLED   חייב להיות בדיוק "1"
//    GREENAPI_TEST_TO        המספר היחיד שמותר לשלוח אליו
//    FIREBASE_SERVICE_ACCOUNT  ר' api/_verifyAdmin.js
// ═══════════════════════════════════════════════════════════════════

const { verifyAdmin }    = require('./_verifyAdmin');
const { lgGreenApiTest } = require('./_env');

const MAX_TEXT = 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // ⚠️ שליחה המונית נחסמת כאן, במבנה ולא בבדיקה: הגוף אינו מקבל רשימה
  // בכלל. קריאה אחת = הודעה אחת. אין לולאה שאפשר להאריך בטעות.
  if (Array.isArray(body.to) || Array.isArray(body.orderIds) || Array.isArray(body.text)) {
    res.status(400).json({ error: 'כלי הבדיקה שולח הודעה אחת בלבד — רשימות אינן נתמכות' });
    return;
  }

  const gate = lgGreenApiTest(body.to);
  if (!gate.allowed) {
    // 503 ולא 403: אין כאן בעיית הרשאה אלא כלי שאינו זמין בסביבה הזו
    res.status(503).json({ error: gate.reason, blocked: true });
    return;
  }

  const text = String(body.text || '').trim();
  if (!text)                 { res.status(400).json({ error: 'חסר טקסט להודעה' }); return; }
  if (text.length > MAX_TEXT){ res.status(400).json({ error: `הטקסט ארוך מ-${MAX_TEXT} תווים` }); return; }

  const idInstance = String(process.env.GREENAPI_ID_INSTANCE).trim();
  const token      = String(process.env.GREENAPI_TOKEN).trim();
  const chatId     = gate.to + '@c.us';

  // ⚠️ הטוקן יושב בתוך ה-URL — זו הדרך ש-GREEN API עובדת. ולכן ה-URL
  // עצמו הוא סוד: הוא לא נכנס ללוג, לא לתשובה, ולא להודעת שגיאה. כל מה
  // שמותר להדפיס הוא idInstance וה-HTTP status.
  const url = 'https://api.green-api.com/waInstance' + idInstance +
              '/sendMessage/' + token;

  let httpStatus = 0, parsed = null, raw = '';
  try {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chatId, message: text }),
    });
    httpStatus = r.status;
    raw = await r.text();
    try { parsed = JSON.parse(raw); } catch (_) { /* לא JSON — נשמר גולמי */ }
  } catch (e) {
    // ⚠️ e.message של fetch עלול להכיל את ה-URL, ועם זה את הטוקן.
    // לכן מדווחים על הסוג בלבד ולא על הטקסט.
    console.error('whatsapp-test: network failure', { idInstance, name: e && e.name });
    res.status(502).json({ error: 'השליחה ל-GREEN API נכשלה ברשת' });
    return;
  }

  const ok = httpStatus >= 200 && httpStatus < 300 && !!(parsed && parsed.idMessage);
  console.log('whatsapp-test: ' + (ok ? 'sent' : 'failed'),
              { idInstance, to: gate.to, httpStatus, idMessage: (parsed && parsed.idMessage) || null });

  res.status(ok ? 200 : 502).json({
    ok,
    to:        gate.to,
    httpStatus,
    idMessage: (parsed && parsed.idMessage) || null,
    // גוף התשובה של GREEN API אינו מכיל את הטוקן, ולכן מותר להחזירו —
    // הוא מה שמסביר כישלון. חתוך, כדי שלא יבלע את התשובה.
    response:  raw.slice(0, 500),
  });
};
