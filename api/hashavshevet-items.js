// ═══════════════════════════════════════════════════════════════════
//  /api/hashavshevet-items — Vercel Serverless Function (Node runtime)
//
//  פרוקסי שרת-צד ל-WizGround reports API (חשבשבת). קורא סוד ונתוני חתימה
//  אך ורק ממשתני סביבה של Vercel — הם לעולם לא מגיעים לדפדפן/קוד הלקוח.
//  הפונקציה מחזירה ללקוח רק JSON נקי: [{code, name, price, itemType}, ...].
//
//  משתני סביבה נדרשים (Vercel Dashboard → Project Settings → Environment
//  Variables — לא בקובץ, לא ב-repo):
//    WIZGROUND_SECRET               הסוד לחתימת MD5
//    HASHAVSHEVET_REPORT_DATA       תוכן encrypt_reportData (בלוק מוצפן)
//    HASHAVSHEVET_STATION           מזהה תחנה (GUID)
//    HASHAVSHEVET_COMPANY           קוד חברה
//    HASHAVSHEVET_NET_PASSPORT_ID   מזהה הדוח
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const ENDPOINT = 'https://ws.wizground.com/api';

function sign(pluginDataJson, secret) {
  return crypto.createHash('md5').update(pluginDataJson + secret, 'utf8').digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const SECRET      = process.env.WIZGROUND_SECRET;
  const REPORT_DATA = process.env.HASHAVSHEVET_REPORT_DATA;
  const STATION     = process.env.HASHAVSHEVET_STATION;
  const COMPANY     = process.env.HASHAVSHEVET_COMPANY;
  const NET_ID      = process.env.HASHAVSHEVET_NET_PASSPORT_ID;

  if (!SECRET || !REPORT_DATA || !STATION || !COMPANY || !NET_ID) {
    console.error('hashavshevet-items: missing env vars', {
      hasSecret: !!SECRET, hasReportData: !!REPORT_DATA, hasStation: !!STATION,
      hasCompany: !!COMPANY, hasNetId: !!NET_ID
    });
    res.status(500).json({ error: 'server not configured — missing environment variables' });
    return;
  }

  try {
    // סדר המפתחות כאן חלק מהחוזה של החתימה — אין לשנות
    const pluginData     = { encrypt_reportData: REPORT_DATA, params_data: [] };
    const pluginDataJson = JSON.stringify(pluginData);
    const signature       = sign(pluginDataJson, SECRET);

    // מרכיבים את הגוף מאותה מחרוזת מדויקת שעליה חתמנו — לא serialize מחדש
    const body =
      `{"station":${JSON.stringify(STATION)},` +
      `"plugin":"reports",` +
      `"company":${JSON.stringify(COMPANY)},` +
      `"message":{"netPassportID":${JSON.stringify(NET_ID)},` +
      `"pluginData":${pluginDataJson}},` +
      `"signature":${JSON.stringify(signature)}}`;

    const wgRes = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    });
    const text = await wgRes.text();

    if (!wgRes.ok) {
      console.error('hashavshevet-items: WizGround error', wgRes.status, text.slice(0, 500));
      res.status(502).json({ error: 'WizGround request failed', status: wgRes.status });
      return;
    }

    const json = JSON.parse(text);
    const rows = (json && json.apiRes && json.apiRes.data) || [];

    // בשלב זה: רק פריטי "מכפלה" (זכוכית — מחיר לפי מ"ר) עם שם תקין.
    // הערה: הדוח הנוכחי (netPassportID) לא מחזיר שדה "פעיל/לא פעיל" בכלל — אין
    // לפי מה לסנן לפי סטטוס פעיל עד שהדוח בחשבשבת יעודכן להכליל את העמודה הזו.
    const items = rows
      .filter(r => r['שם פריט'] && r['סוג הפריט'] === 'מכפלה')
      .map(r => ({
        code:     String(r['מפתח פריט'] || '').trim(),
        name:     String(r['שם פריט'] || '').trim(),
        price:    Number(r['מחיר מכירה']) || 0,
        itemType: r['סוג הפריט'] || ''
      }))
      .filter(it => it.code);

    res.status(200).json({ ok: true, count: items.length, items });
  } catch (e) {
    console.error('hashavshevet-items: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
