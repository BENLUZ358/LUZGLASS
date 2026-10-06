// ═══════════════════════════════════════════════════════════════════
//  POST /api/wa-inbound-drain — צד האדמין של קליטות WhatsApp.
//
//    { action:'drain' }               עיבוד מה שממתין (רשת ביטחון)
//    { action:'retry', key }          "נסה שוב" על קליטה קיימת
//    { action:'close', key, note }    "טופל ידנית" — סימון + audit
//
//  ─── למה זו רשת ביטחון ולא מנגנון שני ──────────────────────────────
//
//  ה-webhook מעבד ב-waitUntil, וזה בדרך כלל מספיק. אבל waitUntil אינו
//  ערובה: פונקציה שמתה באמצע משאירה רשומה ב-received / processing. כשאדמין
//  פתוח, הדף קורא לכאן, וזה עובר על **אותו תור** (waInbound) דרך **אותה
//  פונקציה** (lgWaInboundProcess) ו**אותה תפיסה** בטרנזקציה. אין כאן שום
//  לוגיקת עיבוד משלו — ולכן webhook + שתי לשוניות + retry במקביל מתנגשים
//  בטרנזקציה, ורק אחד מהם עובד על כל קליטה.
//
//  פונקציה אחת לשלוש הפעולות בכוונה: Vercel Hobby מגביל ל-12 פונקציות.
//  אפיון: docs/superpowers/specs/2026-10-04-whatsapp-sketch-intake-design.md §2.2, §2.5
// ═══════════════════════════════════════════════════════════════════

const { lgWaInboundKey, lgWaInboundPending, lgWaInboundProcess,
        lgWaInboundRetry, lgWaInboundClose } = require('./_wa-inbound');

// כמה קליטות בקריאה אחת, ותקציב זמן — מתחת ל-maxDuration (60) עם מרווח
const BATCH = 5;
const BUDGET_MS = 40 * 1000;

const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && lgWaInboundKey(k) === k;

//  הליבה, בלי Vercel ובלי אימות — כדי שאפשר לבדוק אותה.
//  deps: { db, by, now?, fetchImpl? }
async function handleAdmin(body, deps) {
  const b = body || {};
  const action = b.action || 'drain';
  const opts = { by: 'admin:' + (deps.by || ''), fetchImpl: deps.fetchImpl, now: deps.now };

  if (action === 'drain') {
    const started = Date.now();
    const keys = await lgWaInboundPending(deps.db, BATCH, deps.now, { includeExhausted: true });
    const results = [];
    for (const key of keys) {
      if (Date.now() - started > BUDGET_MS) break;
      const r = await lgWaInboundProcess(deps.db, key, opts);
      results.push({ key, ok: r.ok, claimed: r.claimed !== false, reason: r.ok ? '' : r.reason });
    }
    const remaining = (await lgWaInboundPending(deps.db, BATCH + 1, deps.now)).length;
    return { ok: true, processed: results.filter(r => r.claimed).length, results, remaining };
  }

  if (action === 'retry' || action === 'close') {
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה קליטה לא תקין' };
    if (action === 'close') return lgWaInboundClose(deps.db, b.key, deps.by, b.note, deps.now);

    const rt = await lgWaInboundRetry(deps.db, b.key, deps.by, deps.now);
    if (!rt.ok) return rt;
    const p = await lgWaInboundProcess(deps.db, b.key, opts);
    return p.ok ? { ok: true, code: '', message: '', orderIds: p.orderIds }
                : { ok: false, code: 'failed', message: p.reason };
  }

  return { ok: false, code: 'bad-action', message: 'פעולה לא מוכרת' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  try {
    const { verifyAdmin } = require('./_verifyAdmin');
    const auth = await verifyAdmin(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const { getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    // verifyAdmin כבר אתחל את האפליקציה עם הכתובת של הסביבה
    const db = getDatabase(getApps()[0]);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const r = await handleAdmin(body, { db, by: auth.phone });
    res.status(200).json(r);
  } catch (e) {
    console.error('wa-inbound-drain: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
};
module.exports.handleAdmin = handleAdmin;
