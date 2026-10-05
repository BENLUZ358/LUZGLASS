// ═══════════════════════════════════════════════════════════════════
//  POST /api/wa-inbound — ה-webhook של GREEN API להודעות נכנסות.
//
//  ⚠️ ה-endpoint הראשון בפרויקט שאינו דורש התחברות אדמין. ההגנה כולה כאן:
//
//    1. Authorization: Bearer <GREENAPI_WEBHOOK_TOKEN>, השוואה constant-time.
//       לא הוגדר טוקן → אף אחד לא נכנס. אחרת 401, בלי כתיבה.
//    2. idInstance בגוף = GREENAPI_ID_INSTANCE של הסביבה. אחרת 403.
//    3. סינון — רק תמונה / PDF בצ'אט פרטי. כל השאר: 200 בלי רשומה.
//    4. GREENAPI_INBOUND_ALLOWED — שולח שאינו ברשימה: 200 בלי רשומה, וממשיך
//       לטיפול ידני ב-WhatsApp כמו היום.
//    5. create-once ב-waInbound/<idMessage>. נכשל → 500, ו-GREEN API שולחת
//       שוב (עד 24 שעות). הצליח → 200 מיד.
//    6. העיבוד (הורדה, זיהוי, כתיבה לתור) רץ ב-waitUntil **אחרי** התשובה.
//       זו אופטימיזציה של זמן ההגעה, לא ערובה — אם הוא מת, הרשומה נשארת
//       ו-drain מהאדמין (שלב 3) משלים.
//
//  לעולם לא נרשמים ללוג: הטוקן, downloadUrl, או גוף הבקשה.
//  אפיון: docs/superpowers/specs/2026-10-04-whatsapp-sketch-intake-design.md §2.1
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgWaInboundAllowed } = require('./_env');
const { lgWaInboundParse, lgWaInboundRecord, lgWaInboundProcess } = require('./_wa-inbound');

//  השוואה בזמן קבוע. גיבוב קודם, כדי שגם האורך לא ידלוף.
function _tokenOk(header) {
  const want = String(process.env.GREENAPI_WEBHOOK_TOKEN || '');
  if (!want) return false;
  const got = String(header || '');
  const h = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(got), h('Bearer ' + want));
}

//  הליבה, בלי Vercel ובלי Firebase — כדי שאפשר לבדוק אותה.
//  deps: { db, waitUntil, fetchImpl?, now? }. מחזיר { status, body }.
async function handleInbound(req, deps) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const headers = req.headers || {};
  if (!_tokenOk(headers.authorization || headers.Authorization)) return { status: 401, body: { error: 'unauthorized' } };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  const inst = String(((body || {}).instanceData || {}).idInstance || '');
  const mine = String(process.env.GREENAPI_ID_INSTANCE || '');
  if (!mine || inst !== mine) return { status: 403, body: { error: 'wrong instance' } };

  const p = lgWaInboundParse(body);
  if (p.action !== 'record') return { status: 200, body: { ok: true, ignored: p.reason } };
  if (!lgWaInboundAllowed(p.entry.sender).allowed) return { status: 200, body: { ok: true, ignored: 'sender' } };

  let rec;
  try {
    rec = await lgWaInboundRecord(deps.db, p.entry, deps.now);
  } catch (e) {
    console.error('wa-inbound: record failed', e && e.name);
    return { status: 500, body: { error: 'record failed' } };
  }

  if (rec.created && p.entry.kind === 'image') {
    deps.waitUntil(
      lgWaInboundProcess(deps.db, rec.key, { by: 'webhook', fetchImpl: deps.fetchImpl, now: deps.now })
        .catch(e => console.error('wa-inbound: process crashed', e && e.name)));
  }
  return { status: 200, body: { ok: true, recorded: rec.created } };
}

// ─── Vercel ─────────────────────────────────────────────────────────
//  Firebase ו-@vercel/functions נטענים רק כאן, כדי שהבדיקות לא יצטרכו אותם.
function _db() {
  const { lgDatabaseUrl } = require('./_env');
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: lgDatabaseUrl(),
  });
  return getDatabase(app);
}

module.exports = async function handler(req, res) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) { res.status(500).json({ error: 'server not configured' }); return; }
    const { waitUntil } = require('@vercel/functions');
    const r = await handleInbound(req, { db: _db(), waitUntil });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('wa-inbound: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
};
module.exports.handleInbound = handleInbound;
