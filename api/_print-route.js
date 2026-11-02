// ═══════════════════════════════════════════════════════════════════
//  /api/print — מרכז הדפסות (בן, 3/11). rewrite אל wa-inbound?print=1
//  (מגבלת 12 הפונקציות). הלוגיקה ב-_print-jobs.js.
// ═══════════════════════════════════════════════════════════════════

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
    const r = await require('./_print-jobs').handlePrint(req, { db: getDatabase(app), verify: verifyUser });
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('print: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
