// ═══════════════════════════════════════════════════════════════════
//  POST /api/wa-inbound-drain — צד האדמין של קליטות WhatsApp.
//
//    { action:'drain' }               עיבוד מה שממתין (רשת ביטחון)
//    { action:'retry', key }          "נסה שוב" על קליטה קיימת
//    { action:'close', key, note }    "טופל ידנית" — סימון + audit
//
//  channel:'email' (20/10) — אותן שלוש פעולות על התור של המייל
//  (emailInbound, api/_email-inbound.js). בלי channel — WhatsApp, כמו תמיד.
//  קישור קבוצות נשאר של WhatsApp בלבד.
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
const { lgEmailInboundKey, lgEmailInboundPending, lgEmailInboundProcess,
        lgEmailInboundRetry, lgEmailInboundClose } = require('./_email-inbound');

// כמה קליטות בקריאה אחת, ותקציב זמן — מתחת ל-maxDuration (60) עם מרווח
const BATCH = 5;
const BUDGET_MS = 40 * 1000;

const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && lgWaInboundKey(k) === k;

//  ⚠️ lgEmailInboundProcess מחזיר { state, reason? } ולא { ok, claimed } —
//  מתורגם כאן לצורה של WhatsApp, כדי שהדף לא יצטרך לדעת מאיזה ערוץ הגיע.
//  לא נתפס = מצב שאינו סופי ואינו failed (מישהו אחר מעבד, או ממתין).
const _emProcess = async (db, key, opts) => {
  const r = await lgEmailInboundProcess(db, key, opts);
  const ok = r.state === 'done';
  return { ok, claimed: !['processing', 'received', 'missing'].includes(r.state),
           reason: ok ? '' : (r.reason || r.state), orderIds: r.orderIds };
};

//  הפונקציות של כל ערוץ — אותו חוזה בדיוק
const CHANNELS = {
  whatsapp: { keyOf: lgWaInboundKey, pending: lgWaInboundPending, process: lgWaInboundProcess,
              retry: lgWaInboundRetry, close: lgWaInboundClose },
  email:    { keyOf: lgEmailInboundKey, pending: lgEmailInboundPending, process: _emProcess,
              retry: lgEmailInboundRetry, close: lgEmailInboundClose },
};

//  הליבה, בלי Vercel ובלי אימות — כדי שאפשר לבדוק אותה.
//  deps: { db, by, now?, fetchImpl? }
async function handleAdmin(body, deps) {
  const b = body || {};
  const action = b.action || 'drain';
  const chName = b.channel || 'whatsapp';
  // hasOwnProperty — 'constructor' / '__proto__' אינם ערוץ
  const ch = Object.prototype.hasOwnProperty.call(CHANNELS, chName) ? CHANNELS[chName] : null;
  if (!ch) return { ok: false, code: 'bad-channel', message: 'ערוץ לא מוכר' };
  const keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && ch.keyOf(k) === k;
  const opts = { by: 'admin:' + (deps.by || ''), fetchImpl: deps.fetchImpl, now: deps.now };

  if (action === 'drain') {
    const started = Date.now();
    const keys = await ch.pending(deps.db, BATCH, deps.now, { includeExhausted: true });
    const results = [];
    for (const key of keys) {
      if (Date.now() - started > BUDGET_MS) break;
      const r = await ch.process(deps.db, key, opts);
      results.push({ key, ok: r.ok, claimed: r.claimed !== false, reason: r.ok ? '' : r.reason });
    }
    const remaining = (await ch.pending(deps.db, BATCH + 1, deps.now)).length;
    return { ok: true, processed: results.filter(r => r.claimed).length, results, remaining };
  }

  if (action === 'retry' || action === 'close') {
    if (!keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה קליטה לא תקין' };
    if (action === 'close') return ch.close(deps.db, b.key, deps.by, b.note, deps.now);

    const rt = await ch.retry(deps.db, b.key, deps.by, deps.now);
    if (!rt.ok) return rt;
    const p = await ch.process(deps.db, b.key, opts);
    return p.ok ? { ok: true, code: '', message: '', orderIds: p.orderIds }
                : { ok: false, code: 'failed', message: p.reason };
  }

  // ─── קבוצות (בן, 06/10): קישור קבוצת WhatsApp ללקוח ───────────────────
  //  רק קבוצה שכבר נראתה (waMeta/groupsSeen — נכתב ב-webhook) ורק לכרטיס
  //  חשבשבת קיים. הקישור הוא ההרשאה של הקבוצה, ולכן נכתב רק מכאן.
  if (chName === 'whatsapp' && (action === 'link-group' || action === 'unlink-group')) {
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה קבוצה לא תקין' };
    const db = deps.db, t = deps.now || Date.now(), by = String(deps.by || '');
    const seen = (await db.ref('waMeta/groupsSeen/' + b.key).once('value')).val();
    if (!seen || !seen.chatId) return { ok: false, code: 'unknown-group', message: 'הקבוצה עוד לא שלחה תמונה — אין מה לקשר' };

    if (action === 'unlink-group') {
      const cur = (await db.ref('waGroups/' + b.key).once('value')).val();
      if (!cur) return { ok: false, code: 'not-linked', message: 'הקבוצה לא מקושרת' };
      const upd = {};
      upd['waGroups/' + b.key] = null;
      upd['waMeta/groupsSeen/' + b.key + '/unlinked'] = { at: t, by, customerId: String(cur.customerId || '') };
      await db.ref().update(upd);
      return { ok: true, code: '', message: '' };
    }

    const cid = String(b.customerId || '').trim();
    const acc = cid && _keyOk(cid) ? (await db.ref('hashavshevetAccounts/' + cid).once('value')).val() : null;
    if (!acc) return { ok: false, code: 'unknown-customer', message: 'כרטיס הלקוח לא נמצא' };
    await db.ref('waGroups/' + b.key).transaction(cur => {
      const prev = cur || {};
      return {
        chatId: seen.chatId, name: seen.name || '', customerId: cid, customerName: String(acc.name || ''),
        linkedAt: t, linkedBy: by,
        audit: { ...(prev.audit || {}), [t + '_link']: { at: t, by, action: 'link', customerId: cid, from: prev.customerId || '' } },
      };
    });
    return { ok: true, code: '', message: '' };
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
