// ═══════════════════════════════════════════════════════════════════
//  POST /api/email-inbound — סקריפט Gmail (חשבון Orderluz) שולח לכאן מיילים.
//
//  ⚠️ endpoint שני בפרויקט שאינו דורש התחברות אדמין (אחרי wa-inbound).
//  ההגנה כולה כאן:
//
//    1. Authorization: Bearer <EMAIL_INBOUND_TOKEN>, השוואה constant-time
//       (_hook-token.js, משותף עם WhatsApp). לא הוגדר → אף אחד. אחרת 401.
//    2. קלט פגום → 400 לפני שנוגעים בבסיס. ⚠️ messageId ריק היה הופך את
//       הנתיב ל-emailInbound/ — כל התיבה (lgEmailCommit זורק על זה).
//    3. commit: `to` חייב להכיל את EMAIL_INBOUND_ADDRESS. אחרת 403.
//    4. commit: שולח שאינו ב-EMAIL_INBOUND_ALLOWED → 200 not-allowed, בלי
//       רשומה. החתיכות שכבר עלו נמחקות — אף אחד לא יקרא אותן.
//       ⚠️ state נפרד ולא ignored: על ignored הסקריפט מדביק LG/נקלט, ואז
//       רשימה חסרה או שגויה הייתה מתייגת כל מייל "נקלט" בלי שנקלט, ובשלב
//       הבדיקה גם מיילים של לקוחות אמיתיים (אפיון §3.6: לא נוגעים בהם).
//       על not-allowed הסקריפט מסמן "טופל" בלי תווית.
//    5. כשל כתיבה → 500, והסקריפט מנסה שוב בריצה הבאה.
//
//  גוף הבקשה — אחד משניים:
//    { op:'part', messageId, idx, chunk, chunks, data }  → 200 { ok:true }
//    { op:'commit', messageId, threadId, from, to, subject, date, parts[] }
//                                     → 200 { ok:true, state, refNum?, reason? }
//
//  ⚠️ commit מעבד **בתוך** הבקשה (לא waitUntil כמו WhatsApp): הסקריפט צריך
//  את ה-state כדי להחליט אם להדביק תווית. state שאינו סופי (processing,
//  received, failed, missing) עובר כמו שהוא — הסקריפט מנסה שוב. maxDuration 60.
//
//  לעולם לא נרשמים ללוג: הטוקן, גוף הבקשה או תוכן הקבצים.
//  אפיון: docs/superpowers/specs/2026-10-20-email-sketch-intake-design.md §3.1–3.2
// ═══════════════════════════════════════════════════════════════════

const { lgEmailInboundAllowed } = require('./_env');
const { lgHookTokenOk } = require('./_hook-token');
const { lgEmailAddr, lgEmailKey, lgEmailSenderLink } = require('./_email-recipient');
const { lgEmailInboundKey, lgEmailPutChunk, lgEmailCommit, EM_INBOX, EM_PARTS } = require('./_email-inbound');
const { lgEmailClaim, lgEmailComplete, lgEmailOutboxKeyOk } = require('./_email-outbox');

// אותם גבולות כמו ב-_email-inbound.js (20 קבצים, 10 חתיכות לקובץ)
const _int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const _idOk = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !!lgEmailInboundKey(id);
const _partsOk = parts => Array.isArray(parts) && parts.length <= 20
  && parts.every(p => p && _int(p.idx, 0, 19) && _int(p.chunks, 1, 10));

//  `to` יכול להיות רשימה ('a@b.com, "Luz" <orderluz@gmail.com>'). פסיק בתוך
//  שם תצוגה בגרשיים רק מפצל את השם — הכתובת עצמה עדיין נמצאת.
function _toUs(to) {
  const want = lgEmailAddr(process.env.EMAIL_INBOUND_ADDRESS);
  if (!want) return false;
  return String(to || '').split(',').some(a => lgEmailAddr(a) === want);
}

const _bad = code => ({ status: 400, body: { ok: false, code } });

//  waMeta/emailSendersSeen/<key>: כתובת, מונה, זמן — בלי תוכן. listed:true = הכתובת
//  ברשימה ב-Vercel (נקלטת כבר עכשיו); הפאנל מציג אותה עם "ברשימה" ולא סופר אותה
//  בתג "דורש טיפול". כתובת שירדה מהרשימה מאבדת את הסימון.
async function _noteSeen(deps, from, listed) {
  const sk = lgEmailKey(from);
  if (!sk) return;
  try {
    await deps.db.ref('waMeta/emailSendersSeen/' + sk).transaction(cur => {
      const next = { ...(cur || {}), email: lgEmailAddr(from), count: ((cur && cur.count) || 0) + 1, lastAt: deps.now || Date.now() };
      if (listed) next.listed = true; else delete next.listed;
      return next;
    });
  } catch (e) { console.warn('email-inbound: sendersSeen', e && e.name); }
}

//  הליבה, בלי Vercel ובלי Firebase — כדי שאפשר לבדוק אותה.
//  deps: { db, now? }. מחזיר { status, body }.
async function handleEmailInbound(req, deps) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
  const headers = req.headers || {};
  if (!lgHookTokenOk(headers.authorization || headers.Authorization, process.env.EMAIL_INBOUND_TOKEN, 'email-inbound')) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  const b = (body && typeof body === 'object') ? body : {};
  // ─── מיילים יוצאים (בן, 26/10) ─────────────────────────────────────
  //  הסקריפט מושך מה לשלוח ומאשר. אותו טוקן; לפני בדיקת messageId כי
  //  לפעולות האלה אין הודעה נכנסת. ר' api/_email-outbox.js.
  if (b.op === 'outbox-claim') {
    try { return { status: 200, body: { ok: true, items: await lgEmailClaim(deps.db, 5, deps.now) } }; }
    catch (e) { console.error('email-inbound: outbox claim failed', e && e.name); return { status: 500, body: { error: 'claim failed' } }; }
  }
  if (b.op === 'outbox-done') {
    if (!lgEmailOutboxKeyOk(b.key) || typeof b.leaseToken !== 'string' || !b.leaseToken || typeof b.ok !== 'boolean') return _bad('bad-done');
    try { return { status: 200, body: await lgEmailComplete(deps.db, b.key, b.leaseToken, b.ok, deps.now) }; }
    catch (e) { console.error('email-inbound: outbox done failed', e && e.name); return { status: 500, body: { error: 'done failed' } }; }
  }

  if (!_idOk(b.messageId)) return _bad('bad-id');

  if (b.op === 'part') {
    let r;
    try {
      r = await lgEmailPutChunk(deps.db, { messageId: b.messageId, idx: b.idx, chunk: b.chunk, chunks: b.chunks, data: b.data });
    } catch (e) {
      console.error('email-inbound: part write failed', e && e.name);
      return { status: 500, body: { error: 'write failed' } };
    }
    return r.ok ? { status: 200, body: { ok: true } } : _bad(r.code);
  }

  if (b.op !== 'commit') return _bad('bad-op');
  if (!_partsOk(b.parts)) return _bad('bad-parts');
  if (!_toUs(b.to)) return { status: 403, body: { error: 'wrong recipient' } };

  const key = lgEmailInboundKey(b.messageId);
  // כתובת שמנהל קישר מהקליטות מורשית בדיוק כמו כתובת ברשימה (בן, 26/10).
  // לא ברשימה ולא מקושרת → נשמרת הכתובת בלבד (בלי תוכן) כדי שאפשר יהיה לקשר אותה.
  const listed = lgEmailInboundAllowed(b.from).allowed;
  let admitted = listed;
  if (!admitted) {
    try { admitted = !!(await lgEmailSenderLink(deps.db, b.from)); }
    catch (e) { console.error('email-inbound: sender lookup failed', e && e.name); return { status: 500, body: { error: 'lookup failed' } }; }
  } else {
    //  כתובת ברשימה ב-Vercel שעוד לא קושרה נרשמת גם היא (listed:true) — אחרת
    //  היא לא מופיעה בקליטות ו-link-sender מסרב לה, ובן לא יכול לקשר את הכתובת
    //  שלו לבדיקה העצמית. ⚠️ לפי מיטב היכולת: כשל כאן לא עוצר את הקליטה.
    try { if (!(await lgEmailSenderLink(deps.db, b.from))) await _noteSeen(deps, b.from, true); }
    catch (e) { console.warn('email-inbound: listed sender note', e && e.name); }
  }
  if (!admitted) {
    await _noteSeen(deps, b.from, false);
    // ⚠️ רק כשאין רשומה: מייל שכבר נקלט (למשל failed שממתין ל"נסה שוב")
    // ואחר כך הרשימה צומצמה — החתיכות שלו עדיין נחוצות.
    try {
      const rec = (await deps.db.ref(EM_INBOX + '/' + key).once('value')).val();
      if (!rec) await deps.db.ref(EM_PARTS + '/' + key).set(null);
    } catch (e) { console.warn('email-inbound: could not drop parts of an ignored sender', e && e.name); }
    return { status: 200, body: { ok: true, state: 'not-allowed' } };
  }

  let r;
  try {
    r = await lgEmailCommit(deps.db, {
      messageId: b.messageId, threadId: b.threadId, from: b.from,
      subject: b.subject, date: b.date, parts: b.parts,
    }, { by: 'gmail-script', now: deps.now });
  } catch (e) {
    console.error('email-inbound: commit failed', e && e.name);
    return { status: 500, body: { error: 'record failed' } };
  }
  const out = { ok: true, state: r.state };
  if (r.refNum) out.refNum = r.refNum;
  if (r.reason) out.reason = r.reason;
  return { status: 200, body: out };
}

// ─── Vercel ─────────────────────────────────────────────────────────
//  Firebase נטען רק כאן, כדי שהבדיקות לא יצטרכו אותו.
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
    const r = await handleEmailInbound(req, { db: _db() });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('email-inbound: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
};
module.exports.handleEmailInbound = handleEmailInbound;
