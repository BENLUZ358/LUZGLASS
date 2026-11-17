// /api/glass — rewrite אל wa-inbound?glass=1 (מגבלת 12 הפונקציות). הלוגיקה ב-_glass-qr.js.
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
    const r = await require('./_glass-qr').handleGlass(req, { db: getDatabase(app), verify: verifyUser });
    if (r.image != null) {
      //  התמונה: data URL → בתים; כתובת https → הפניה
      const m = r.image.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
      if (m) {
        res.setHeader('Content-Type', m[1].toLowerCase().replace('jpg', 'jpeg'));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(Buffer.from(m[2], 'base64'));
      }
      if (/^https:\/\//i.test(r.image)) { res.setHeader('Location', r.image); return res.status(302).end(); }
      return res.status(404).json({ ok: false, code: 'no-image' });
    }
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('glass: unexpected', e && e.name);
    return res.status(500).json({ ok: false, code: 'internal' });
  }
};
