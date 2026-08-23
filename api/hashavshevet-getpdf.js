// ═══════════════════════════════════════════════════════════════════
//  /api/hashavshevet-getpdf — Vercel Serverless Function (Node runtime)
//
//  מושך מסמך שהופק בחשבשבת כ-PDF, דרך WizGround, plugin `getPDF`.
//
//  ── מה זה ולמה זה נראה כך ──
//
//  שני דברים בתיעוד של חשבשבת (api.h-erp.co.il/docs/getPDF) אינם כתובים:
//
//    1. מה בדיוק `stockid` — התיעוד קורא לו "מספר המסמך", אבל השם עצמו
//       מרמז על מק"ט. כשאנחנו פותחים מסמך אנחנו מקבלים אסמכתא (מספר
//       ההזמנה שלנו), ולא ידוע אם זה אותו מספר.
//    2. מה חוזר — base64, קישור, או בינארי. התיעוד מראה רק את הבקשה.
//
//  ולכן הפונקציה הזו מחזירה כברירת מחדל **דוח אבחון** ולא קובץ: הסטטוס,
//  סוג התוכן, האורך, והתחלת התשובה. זו הדרך לענות על שתי השאלות בלי
//  לנחש, ובלי לשפוך PDF שלם לדפדפן.
//
//  אחרי שיתברר מה חוזר — `?raw=1` כבר מחזיר את הגוף כפי שהוא, ומשם קצרה
//  הדרך להגשה ללקוח.
//
//  המעטפת והחתימה זהות ל-hashavshevet-items.js ו--order.js. שים לב שהגוף
//  מורכב מאותה מחרוזת בדיוק שעליה נחתמה החתימה, ולא עובר serialize מחדש.
//
//  משתני סביבה — אותם של שאר הקבצים:
//    WIZGROUND_SECRET · HASHAVSHEVET_STATION · HASHAVSHEVET_COMPANY
//    HASHAVSHEVET_NET_PASSPORT_ID · FIREBASE_SERVICE_ACCOUNT
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { verifyAdmin } = require('./_verifyAdmin');

const ENDPOINT = 'https://ws.wizground.com/api';

function sign(pluginDataJson, secret) {
  return crypto.createHash('md5').update(pluginDataJson + secret, 'utf8').digest('hex');
}

// מה נראה כמו PDF: קובץ PDF מתחיל תמיד ב-"%PDF-", וב-base64 זה "JVBERi0".
function describe(text) {
  const t = String(text || '');
  if (!t) return 'ריק';
  if (t.startsWith('%PDF-'))   return 'PDF בינארי (מתחיל ב-%PDF-)';
  if (t.startsWith('JVBERi0')) return 'PDF ב-base64 (מתחיל ב-JVBERi0)';
  if (/^\s*[{[]/.test(t))      return 'JSON';
  if (/^https?:\/\//.test(t))  return 'כתובת';
  return 'טקסט לא מזוהה';
}

// מאתר PDF בתוך תשובת JSON, בלי לדעת מראש את שם השדה. חשבשבת לא תיעדו
// אותו, ולכן במקום לנחש שם אחד — סורקים את העלים ומחפשים חתימת PDF.
function findPdfField(node, path = '') {
  if (node == null) return null;
  if (typeof node === 'string') {
    if (node.startsWith('JVBERi0') || node.startsWith('%PDF-')) {
      return { path: path || '(שורש)', length: node.length, kind: describe(node) };
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    const hit = findPdfField(v, path ? path + '.' + k : k);
    if (hit) return hit;
  }
  return null;
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
    res.status(500).json({
      error: 'server not configured — missing environment variables',
      hasSecret: !!SECRET, hasStation: !!STATION, hasCompany: !!COMPANY, hasNetId: !!NET_ID,
    });
    return;
  }

  const body    = req.body || {};
  const stockid = String(body.stockid == null ? '' : body.stockid).trim();
  const raw     = body.raw === true;

  if (!stockid) {
    res.status(422).json({ error: 'חסר stockid — מספר המסמך בחשבשבת' });
    return;
  }

  try {
    // מערך, שורה אחת — כמו ב-imovein. סדר המפתחות הוא חלק מחוזה החתימה.
    const pluginData     = [{ stockid }];
    const pluginDataJson = JSON.stringify(pluginData);
    const signature      = sign(pluginDataJson, SECRET);

    const payload =
      `{"station":${JSON.stringify(STATION)},` +
      `"plugin":"getPDF",` +
      `"company":${JSON.stringify(COMPANY)},` +
      `"message":{"netPassportID":${JSON.stringify(NET_ID)},` +
      `"pluginData":${pluginDataJson}},` +
      `"signature":${JSON.stringify(signature)}}`;

    const wgRes = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body:    payload,
    });

    const text        = await wgRes.text();
    const contentType = wgRes.headers.get('content-type') || '';

    if (raw) { res.status(wgRes.status).json({ ok: wgRes.ok, stockid, contentType, response: text }); return; }

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* לא JSON — נדווח כפי שהוא */ }

    // דוח אבחון: מספיק כדי לדעת מה חוזר, בלי להעביר מסמך שלם.
    res.status(200).json({
      ok:          wgRes.ok,
      httpStatus:  wgRes.status,
      stockid,
      contentType,
      length:      text.length,
      looksLike:   describe(text),
      topLevelKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : null,
      // איפה יושב ה-PDF בתוך התשובה, אם הוא שם. שם השדה אינו מתועד.
      pdfFound:    parsed ? findPdfField(parsed) : null,
      head:        text.slice(0, 600),
    });

  } catch (e) {
    console.error('hashavshevet-getpdf: unexpected error', e);
    res.status(500).json({ error: 'internal error', detail: String(e && e.message || e) });
  }
};
