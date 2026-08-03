// ═══════════════════════════════════════════════════════════════════
//  /api/hashavshevet-accounts — Vercel Serverless Function (Node runtime)
//
//  פרוקסי שרת-צד לדוח "כרטיסי לקוח" מ-WizGround (חשבשבת). אותו station/
//  company/netPassportID/secret כמו hashavshevet-items.js — רק ה-
//  encrypt_reportData שונה, כי זה דוח אחר. מחזיר ללקוח JSON נקי בלבד:
//  [{key, name, phone}, ...]. הסוד לעולם לא מגיע לדפדפן/קוד הלקוח.
//
//  משתנה סביבה נוסף על אלה שכבר קיימים ל-hashavshevet-items (Vercel
//  Dashboard → Project Settings → Environment Variables):
//    HASHAVSHEVET_REPORT_DATA_ACCOUNTS   תוכן encrypt_reportData של דוח הלקוחות
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const ENDPOINT = 'https://ws.wizground.com/api';

// טווח הפרמטרים המקורי של הדוח (מגיע מייצוא WizGround) — לא סוד, רק מגדיר
// טווח "מהכל עד הכל" (ח.פ/טלפון/טלפון נייד) כדי שהדוח יחזיר את כל הלקוחות.
const PARAMS_DATA = [
  { p_name: '__MUSTACH_P0__', id: '1',   type: 'txt', name: 'שדה מרשומת החשבון/04. פרטי לקוח/מספר עוסק מורשה', defVal: '', opName: 'מ..עד', opOrigin: 'from' },
  { p_name: '__MUSTACH_P1__', id: '501', type: 'txt', name: 'שדה מרשומת החשבון/04. פרטי לקוח/מספר עוסק מורשה', defVal: '999999999999999999999999999999999999', opName: 'מ..עד', opOrigin: 'to' },
  { p_name: '__MUSTACH_P2__', id: '2',   type: 'txt', name: 'שדה מרשומת החשבון/02. כתובת/טלפון', defVal: '', opName: 'מ..עד', opOrigin: 'from' },
  { p_name: '__MUSTACH_P3__', id: '502', type: 'txt', name: 'שדה מרשומת החשבון/02. כתובת/טלפון', defVal: 'תתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתת', opName: 'מ..עד', opOrigin: 'to' },
  { p_name: '__MUSTACH_P4__', id: '3',   type: 'txt', name: 'שדה מרשומת החשבון/02. כתובת/טלפון נייד', defVal: '', opName: 'מ..עד', opOrigin: 'from' },
  { p_name: '__MUSTACH_P5__', id: '503', type: 'txt', name: 'שדה מרשומת החשבון/02. כתובת/טלפון נייד', defVal: 'תתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתתת', opName: 'מ..עד', opOrigin: 'to' },
];

function sign(pluginDataJson, secret) {
  return crypto.createHash('md5').update(pluginDataJson + secret, 'utf8').digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const SECRET      = process.env.WIZGROUND_SECRET;
  const REPORT_DATA = process.env.HASHAVSHEVET_REPORT_DATA_ACCOUNTS;
  const STATION     = process.env.HASHAVSHEVET_STATION;
  const COMPANY     = process.env.HASHAVSHEVET_COMPANY;
  const NET_ID      = process.env.HASHAVSHEVET_NET_PASSPORT_ID;

  if (!SECRET || !REPORT_DATA || !STATION || !COMPANY || !NET_ID) {
    console.error('hashavshevet-accounts: missing env vars', {
      hasSecret: !!SECRET, hasReportData: !!REPORT_DATA, hasStation: !!STATION,
      hasCompany: !!COMPANY, hasNetId: !!NET_ID
    });
    res.status(500).json({ error: 'server not configured — missing environment variables' });
    return;
  }

  try {
    // סדר המפתחות כאן חלק מהחוזה של החתימה — אין לשנות
    const pluginData     = { encrypt_reportData: REPORT_DATA, params_data: PARAMS_DATA };
    const pluginDataJson = JSON.stringify(pluginData);
    const signature       = sign(pluginDataJson, SECRET);

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
      console.error('hashavshevet-accounts: WizGround error', wgRes.status, text.slice(0, 500));
      res.status(502).json({ error: 'WizGround request failed', status: wgRes.status });
      return;
    }

    const json = JSON.parse(text);
    const rows = (json && json.apiRes && json.apiRes.data) || [];

    const accounts = rows
      .filter(r => r['מפתח חשבון'] && r['שם חשבון'])
      .map(r => ({
        key:   String(r['מפתח חשבון'] || '').trim(),
        name:  String(r['שם חשבון'] || '').trim(),
        phone: String(r['טלפון נייד'] || r['טלפון'] || r['טלפון 1'] || r['טלפון 2'] || '').trim(),
      }))
      .filter(a => a.key);

    res.status(200).json({ ok: true, count: accounts.length, accounts });
  } catch (e) {
    console.error('hashavshevet-accounts: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
