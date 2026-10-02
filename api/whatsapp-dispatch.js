// ═══════════════════════════════════════════════════════════════════
//  /api/whatsapp-dispatch — הודעה אחת ללקוח על הובלה שיצאה.
//
//  ─── למה endpoint נפרד ולא הרחבה של whatsapp-send ───────────────────
//
//  הסמנטיקה הפוכה. whatsapp-send הוא הודעה פר-הזמנה; כאן זו **הודעה אחת
//  לכמה הזמנות**. לדחוף את שתיהן לאותה לולאה היה אומר שהתנאים של אחת
//  נוגעים בשנייה, והמסלול שעובד בפרודקשן הוא זה שהיה משלם.
//
//  ─── הטריגר ────────────────────────────────────────────────────────
//
//  "סיים הובלה" במסך ההובלות. אצל לוז גלאס המשמעות העסקית היא שההעמסה
//  הושלמה וההובלה יוצאת — ולכן זה הטריגר הנכון, ולא נוצר שלב חדש.
//
//  ─── מי קובע את הנמען ──────────────────────────────────────────────
//
//  ⚠️ השרת, לא הדפדפן. מסך ההובלות מקבץ **לפי שם הלקוח**, וזה עובד אצל
//  לוז גלאס כי כל כרטיס חשבשבת הוא שם ייחודי. אבל השם אינו מזהה, ולכן
//  הדפדפן מוסר מזהי הזמנות בלבד והשרת פותר את הטלפון בעצמו מהכרטיס.
//
//  ⚠️ ואם שתי הזמנות באותה קבוצה מחזירות טלפונים שונים — **מסרבים ולא
//  מנחשים**. זה בדיוק המצב שבו הקיבוץ לפי שם היה טועה, והודעה אחת הייתה
//  יוצאת ללקוח הלא נכון עם מספרי ההזמנות של מישהו אחר.
//
//  ─── למה תור ולא שליחה כאן ─────────────────────────────────────────
//
//  הפעולה העסקית חייבת להסתיים מיד. ההודעה נכנסת ל-waOutbox ויוצאת משם
//  בקצב של הספק (ר' _wa-outbox.js ו-_wa-provider.js). כישלון שליחה אינו
//  נוגע בשינוי הסטטוס — הוא קרה לפני, והוא לא תלוי בתשובה מכאן.
// ═══════════════════════════════════════════════════════════════════

const { verifyAdmin }   = require('./_verifyAdmin');
const { lgDatabaseUrl } = require('./_env');
const { lgWaProvider }  = require('./_wa-provider');
const { lgWaEnqueue }   = require('./_wa-outbox');
const { resolvePhone }  = require('./_wa-recipient');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = lgDatabaseUrl();

// הובלה אחת של לקוח אחד. התקרה קיימת כדי שקריאה שגויה לא תגרור קריאת
// מאות הזמנות, לא כדי להגביל הובלה אמיתית.
const MAX_ORDERS = 40;

function _db() {
  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: DATABASE_URL,
  });
  return getDatabase(app);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body     = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const orderIds = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(String))].sort();
  // ברירת מחדל: לא שולחים. אותו כלל כמו whatsapp-send ומאותה סיבה.
  const dryRun   = body.dryRun !== false;

  if (!orderIds.length)             { res.status(400).json({ error: 'orderIds חסר' }); return; }
  if (orderIds.length > MAX_ORDERS) { res.status(400).json({ error: `יותר מדי הזמנות (מקסימום ${MAX_ORDERS})` }); return; }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing FIREBASE_SERVICE_ACCOUNT' }); return;
  }

  const provider = lgWaProvider();

  try {
    const db = _db();

    const loaded = [];
    for (const id of orderIds) {
      const snap  = await db.ref('orders/' + id).once('value');
      const order = snap.val();
      if (!order) { loaded.push({ id, skip: 'ההזמנה לא נמצאה' }); continue; }
      // הזמנה פיקטיבית לעולם לא שולחת ללקוח אמיתי. היא גם לא נכנסת למספרי
      // ההזמנות שבהודעה — אחרת היא הייתה מופיעה אצל הלקוח.
      if (order.isTest) { loaded.push({ id, skip: 'הזמנה פיקטיבית', isTest: true }); continue; }
      loaded.push({ id, order });
    }

    const live = loaded.filter(x => x.order);
    if (!live.length) {
      res.status(200).json({ ok: true, queued: false, reason: 'אין הזמנות לשליחה',
                             skipped: loaded.map(x => ({ orderId: x.id, reason: x.skip })) });
      return;
    }

    // ── הנמען. פר-הזמנה, ואז דורשים שכולן מסכימות ──
    const targets = [];
    for (const x of live) targets.push({ id: x.id, ...(await resolvePhone(db, x.order)) });

    const noPhone = targets.filter(t => !t.phone);
    if (noPhone.length) {
      res.status(422).json({ error: 'אין מספר טלפון ללקוח, לא בכרטיס ולא בהזמנה',
                             orderIds: noPhone.map(t => t.id) });
      return;
    }

    // ⚠️ הסירוב. ר' ההסבר בראש הקובץ — זה המקום שבו קיבוץ לפי שם יכול
    // לטעות, ועדיף לא לשלוח מלשלוח למישהו אחר.
    const phones = [...new Set(targets.map(t => t.phone))];
    if (phones.length > 1) {
      res.status(409).json({
        error: 'ההזמנות בקבוצה הזו מובילות למספרי טלפון שונים — לא נשלחה הודעה',
        hint:  'ייתכן ששתי רשומות לקוח שונות נושאות את אותו שם. בדקו את כרטיסי הלקוח.',
        detail: targets.map(t => ({ orderId: t.id, source: t.source, accountKey: t.accountKey })),
      });
      return;
    }

    const to         = targets[0].phone;
    const clientName = String(live[0].order.orderClient || 'לקוח');
    const orderNums  = live.map(x => String(x.order.orderNum || x.order.refNum || x.id));
    const liveIds    = live.map(x => x.id);
    const facts      = { to, kind: 'dispatched', clientName, orderNums };

    const gate = provider.gate(to);

    if (dryRun || !provider.configured || !gate.allowed) {
      res.status(200).json({
        ok: true, queued: false, preview: true,
        provider: provider.name, to, clientName, orderNums,
        phoneSource: targets[0].source, accountKey: targets[0].accountKey,
        params:  provider.params(facts),
        blocked: !gate.allowed || undefined,
        reason: !gate.allowed       ? gate.reason
              : !provider.configured ? 'חסרים משתני סביבה של ' + provider.name + ' — לא נשלח'
              : 'dryRun',
        skipped: loaded.filter(x => x.skip).map(x => ({ orderId: x.id, reason: x.skip })),
      });
      return;
    }

    // ⚠️ מפתח התור נגזר מ-kind + מזהי ההזמנות הממוינים, ולכן לחיצה כפולה
    // מייצרת אותו מפתח ולא הודעה שנייה. ר' _wa-outbox.js.
    const q = await lgWaEnqueue(db, {
      kind: 'dispatched', to, clientName, orderNums,
      orderIds: liveIds, queuedBy: auth.phone,
      // תיעוד בלבד — ר' lgWaEnqueue
      phoneSource: targets[0].source, accountKey: targets[0].accountKey,
    });

    res.status(200).json({
      ok: true, queued: q.queued, outboxKey: q.key,
      provider: provider.name, to, clientName, orderNums,
      phoneSource: targets[0].source, accountKey: targets[0].accountKey,
      reason: q.queued ? null : q.reason,
      skipped: loaded.filter(x => x.skip).map(x => ({ orderId: x.id, reason: x.skip })),
    });

  } catch (e) {
    console.error('whatsapp-dispatch: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
