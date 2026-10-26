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

const { lgWaInboundAllowed } = require('./_env');
const { lgWaSenderLink, lgWaSenderKey } = require('./_wa-recipient');
const { lgHookTokenOk } = require('./_hook-token');
const { lgWaInboundParse, lgWaInboundRecord, lgWaInboundProcess, lgWaInboundKey } = require('./_wa-inbound');

//  הסוד נבדק ב-_hook-token.js — משותף עם email-inbound. שם גם ההסבר למה
//  "Bearer ", רווחים וסימני כיוון בלתי נראים לא נחשבים חלק מהסוד (15/10).

//  הליבה, בלי Vercel ובלי Firebase — כדי שאפשר לבדוק אותה.
//  deps: { db, waitUntil, fetchImpl?, now? }. מחזיר { status, body }.
async function handleInbound(req, deps) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const headers = req.headers || {};
  if (!lgHookTokenOk(headers.authorization || headers.Authorization, process.env.GREENAPI_WEBHOOK_TOKEN, 'wa-inbound')) return { status: 401, body: { error: 'unauthorized' } };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  const inst = String(((body || {}).instanceData || {}).idInstance || '');
  const mine = String(process.env.GREENAPI_ID_INSTANCE || '');
  if (!mine || inst !== mine) return { status: 403, body: { error: 'wrong instance' } };

  const captured = await require('./_devbrain-relay').maybeCaptureOwner(body, { ...deps, rawBodyBytes: typeof req.body === 'string' ? Buffer.byteLength(req.body) : undefined });
  if (captured) return captured;
  return handleCustomerInbound(body, deps);
}

// Internal replay entry: the caller supplies only the stored, validated relay event.
async function handleCustomerInbound(body, deps) {
  const p = lgWaInboundParse(body);
  if (p.action !== 'record') return { status: 200, body: { ok: true, ignored: p.reason } };
  if (p.entry.groupId) {
    // קבוצה: הקישור ללקוח הוא ההרשאה (waGroups, נכתב רק מ-endpoint אדמיני).
    // לא מקושרת → נשמר שם הקבוצה בלבד — בלי תמונה, קישור או כיתוב — כדי
    // שאפשר יהיה לקשר אותה מהפאנל. ההודעה עצמה לא נקלטת.
    const gk = lgWaInboundKey(p.entry.groupId);
    let link = null;
    try { link = (await deps.db.ref('waGroups/' + gk).once('value')).val(); }
    catch (e) { console.error('wa-inbound: group lookup failed', e && e.name); return { status: 500, body: { error: 'lookup failed' } }; }
    if (!link) {
      try {
        await deps.db.ref('waMeta/groupsSeen/' + gk).transaction(cur => ({
          chatId: p.entry.groupId, name: p.entry.groupName || (cur && cur.name) || '',
          count: ((cur && cur.count) || 0) + 1, lastAt: deps.now || Date.now(),
        }));
      } catch (e) { console.warn('wa-inbound: groupsSeen', e && e.name); }
      return { status: 200, body: { ok: true, ignored: 'group not linked' } };
    }
  } else if (!lgWaInboundAllowed(p.entry.sender).allowed) {
    // פרטי: מספר שמנהל קישר מהקליטות מורשה בדיוק כמו מספר ברשימה (בן, 26/10).
    // לא מקושר → נשמר המספר בלבד (בלי תוכן) כדי שאפשר יהיה לקשר אותו.
    let link = null;
    try { link = await lgWaSenderLink(deps.db, p.entry.sender); }
    catch (e) { console.error('wa-inbound: sender lookup failed', e && e.name); return { status: 500, body: { error: 'lookup failed' } }; }
    if (!link) {
      const sk = lgWaSenderKey(p.entry.sender);
      if (sk) {
        try {
          await deps.db.ref('waMeta/sendersSeen/' + sk).transaction(cur => ({
            ...(cur || {}), phone: sk, count: ((cur && cur.count) || 0) + 1, lastAt: deps.now || Date.now(),
          }));
        } catch (e) { console.warn('wa-inbound: sendersSeen', e && e.name); }
      }
      return { status: 200, body: { ok: true, ignored: 'sender' } };
    }
  }

  let rec;
  try {
    rec = await lgWaInboundRecord(deps.db, p.entry, deps.now);
  } catch (e) {
    console.error('wa-inbound: record failed', e && e.name);
    return { status: 500, body: { error: 'record failed' } };
  }

  if (rec.created && (p.entry.kind === 'image' || p.entry.kind === 'text')) {
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
  // Rewrite selects a protected route, never an authentication bypass.
  // Only this exact server query value selects the relay's own token/project gate.
  if (req.query && req.query.devbrain === 'relay') return require('./_devbrain-route')(req, res);
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

module.exports.handleCustomerInbound = handleCustomerInbound;
