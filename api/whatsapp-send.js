// ═══════════════════════════════════════════════════════════════════
//  /api/whatsapp-send — Vercel Serverless Function (Node runtime)
//
//  שולח ללקוח הודעת "ההזמנה מוכנה" בוואטסאפ, מהשרת, בלי שאף דפדפן ייפתח.
//  עד היום נבנה קישור wa.me — deep link שרק פותח את WhatsApp עם טקסט מוכן
//  ומחכה שמישהו ילחץ שלח. ביום עם עשרות הזמנות זה לא עובד.
//
//  ── מה שולח בפועל ──
//  WhatsApp Cloud API של Meta. מחוץ לחלון 24 השעות מאז שהלקוח כתב לנו,
//  מותר לשלוח *רק תבנית מאושרת מראש* עם משתנים — לא טקסט חופשי. "ההזמנה
//  מוכנה" היא תבנית מסוג Utility, וזה בדיוק השימוש שהיא נועדה לו.
//
//  ── למה הכל נקרא כאן ולא מגיע מהדפדפן ──
//  אותו טעם כמו ב-hashavshevet-order: הדפדפן שולח מזהי הזמנות בלבד. הטלפון,
//  שם הלקוח ומספר ההזמנה נקראים מ-Firebase דרך Admin SDK. דפדפן לא יכול
//  להזריק מספר טלפון של מישהו אחר לתוך שליחה יוצאת.
//
//  משתני סביבה נדרשים (Vercel Dashboard → Project Settings):
//    WA_PHONE_NUMBER_ID     מזהה המספר ב-Meta (לא המספר עצמו)
//    WA_ACCESS_TOKEN        טוקן קבוע של אפליקציית ה-System User
//    WA_TEMPLATE_NAME       שם התבנית המאושרת, למשל order_ready
//    FIREBASE_SERVICE_ACCOUNT   ר' api/_verifyAdmin.js
//
//  אופציונלי:
//    WA_TEMPLATE_LANG       ברירת מחדל he
//    WA_GRAPH_VERSION       ברירת מחדל v21.0
//
//  כל עוד המשתנים חסרים, ה-API עונה תקין ומחזיר מה *היה* נשלח. אפשר לחבר
//  את המסך ולבדוק את כל הזרימה לפני שיש בכלל חשבון ב-Meta.
// ═══════════════════════════════════════════════════════════════════

const { verifyAdmin } = require('./_verifyAdmin');
const { lgDatabaseUrl } = require('./_env');
const { lgWaProvider }  = require('./_wa-provider');
const { lgWaEnqueue }   = require('./_wa-outbox');
const { resolvePhone, toWaNumber } = require('./_wa-recipient');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

// נגזרת ממפתח השירות — ר' lgDatabaseUrl ב-_env.js. הייתה קשיחה כאן, וזה
// נשבר בשקט בכל סביבה שאינה הייצור.
const DATABASE_URL = lgDatabaseUrl();

//  ⚠️ תקרת הבקשה, ולא תקרת השליחה. היא מגבילה כמה הזמנות אפשר למסור
//  בקריאה אחת — 40 הזמנות שנכנסות לתור הן זולות ואסור לדחות אותן. הקצב
//  והתקרה של השליחה עצמה הם מאפיין של הספק (ר' _wa-provider.js), כי Meta
//  ו-GREEN API רחוקות זו מזו בשלושה סדרי גודל.
const MAX_PER_RUN = 60;

function _db() {
  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: DATABASE_URL,
  });
  return getDatabase(app);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body     = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
  // ברירת מחדל: לא שולחים. חייבים dryRun:false במפורש — כמו בחשבשבת,
  // ומאותה סיבה: הודעה שיצאה ללקוח אי אפשר להחזיר.
  const dryRun   = body.dryRun !== false;
  const force    = body.force === true;

  if (!orderIds.length)            { res.status(400).json({ error: 'orderIds חסר' }); return; }
  if (orderIds.length > MAX_PER_RUN) { res.status(400).json({ error: `יותר מדי הזמנות בבת אחת (מקסימום ${MAX_PER_RUN})` }); return; }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing FIREBASE_SERVICE_ACCOUNT' }); return;
  }

  //  ── מי שולח ──
  //  ברירת המחדל היא Meta, והפרודקשן אינו מגדיר WA_PROVIDER — ולכן שם
  //  שום דבר בקובץ הזה לא מתנהג אחרת מאתמול.
  const provider = lgWaProvider();
  // חסרה הגדרה — עדיין עונים, אבל בלי לשלוח. ככה אפשר לבדוק את כל הזרימה
  // לפני שיש חשבון Meta, במקום לגלות את הפערים ביום שהוא נפתח.
  const configured = provider.configured;
  // ── חסימת סביבה ──
  // הנזק כאן חמור מכל השאר: מסמך מיותר בחשבשבת מבטלים, הודעה שיצאה ללקוח
  // כבר נקראה. אצל Meta זו החסימה הגלובלית של _env.js; אצל GREEN API אלה
  // ארבע הנעילות, והן נבדקות **לכל נמען בנפרד**. ר' _wa-provider.js.
  const envGate = provider.gate();

  try {
    const db      = _db();
    const results = [];

    for (const orderId of orderIds) {
      const snap  = await db.ref('orders/' + orderId).once('value');
      const order = snap.val();

      if (!order) { results.push({ orderId, status: 'skipped', reason: 'ההזמנה לא נמצאה' }); continue; }

      // הזמנה פיקטיבית לעולם לא שולחת ללקוח אמיתי. אותה חסימה כמו בחשבשבת,
      // וכאן היא חמורה יותר: מסמך מיותר מבטלים, הודעה שיצאה כבר נקראה.
      if (order.isTest) {
        results.push({ orderId, status: 'skipped', reason: 'הזמנה פיקטיבית', isTest: true });
        continue;
      }

      // חד-פעמיות. בלי זה לחיצה כפולה, או ריצה שנייה של אותו תור, שולחת
      // ללקוח את אותה הודעה פעמיים.
      const prev = order.whatsapp;
      if (prev && prev.sentAt && !force) {
        results.push({ orderId, status: 'skipped', reason: 'כבר נשלחה', sentAt: prev.sentAt });
        continue;
      }

      const target = await resolvePhone(db, order);
      if (!target.phone) {
        results.push({ orderId, status: 'error', reason: 'אין מספר טלפון ללקוח, לא בכרטיס ולא בהזמנה' });
        continue;
      }

      const to        = toWaNumber(target.phone);
      const orderNums = [String(order.orderNum || order.refNum || '')];
      const facts     = { to: target.phone, kind: 'ready',
                          clientName: String(order.orderClient || 'לקוח'), orderNums };
      const params    = provider.params(facts);

      // ⚠️ השער נבדק כאן עם הטלפון בפורמט **המקומי** ולא עם to. אצל GREEN
      // API נעילה 3 משווה אותו ל-GREENAPI_TEST_TO כפי שהוא מוגדר, ו-972...
      // לא היה תואם לו לעולם.
      const gate = provider.gate(target.phone);

      if (dryRun || !configured || !gate.allowed) {
        results.push({
          orderId, status: 'preview', to, phoneSource: target.source,
          accountKey: target.accountKey, params,
          blocked: !gate.allowed || undefined,
          reason: !gate.allowed ? gate.reason
                : configured    ? null
                : 'חסרים משתני סביבה של ' + provider.name + ' — לא נשלח',
        });
        continue;
      }

      // ── ספק שמקצב לאט שולח דרך תור ──
      //
      //  ⚠️ זה הסעיף שמאפשר לפעולה העסקית להסתיים מיד. אצל GREEN API הקצב
      //  הבטוח הוא 10 שניות בין נמענים, ו-40 לקוחות הם מעל 6 דקות — זמן
      //  שאין שום request HTTP שיכול להחזיק. ההכנסה לתור זולה, ולכן גם אין
      //  כאן sleep: הלולאה רק רושמת, וה-drain מוציא.
      //
      //  Meta אינה בתור (provider.queued === false) ולכן ממשיכה לשלוח כאן
      //  בתוך הבקשה, בדיוק כמו עד היום.
      if (provider.queued) {
        const q = await lgWaEnqueue(db, {
          kind: 'ready', to: target.phone,
          clientName: facts.clientName, orderNums,
          orderIds: [orderId], queuedBy: auth.phone,
        });
        results.push({
          orderId, status: q.queued ? 'queued' : 'skipped',
          to, phoneSource: target.source, accountKey: target.accountKey,
          outboxKey: q.key, reason: q.queued ? null : q.reason,
        });
        continue;
      }

      const out = await provider.send(facts);
      const { ok, httpStatus } = out;
      const text = out.detail;
      // רישום מלא תמיד, גם בכישלון. בחשבשבת למדנו ש-HTTP 200 אינו "נוצר
      // מסמך"; כאן 200 אינו "הלקוח קיבל" — הוא רק "Meta קיבלה ממני".
      // מסירה אמיתית מגיעה ב-webhook נפרד.
      const record = {
        sentAt:      ok ? Date.now() : null,
        attemptedAt: Date.now(),
        sentBy:      auth.phone,
        to,
        phoneSource: target.source,
        accountKey:  target.accountKey,
        template:    provider.template,
        provider:    provider.name,
        params,
        httpStatus,
        httpOk:      ok,
        waMessageId: out.messageId,
        response:    String(text).slice(0, 2000),
      };
      await db.ref('orders/' + orderId + '/whatsapp').set(record);

      results.push({
        orderId, status: ok ? 'sent' : 'error', to, phoneSource: target.source,
        httpStatus, waMessageId: record.waMessageId,
        reason: ok ? null : out.reason,
      });

      await sleep(provider.gapMs);
    }

    const tally = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    res.status(200).json({ ok: true, dryRun: dryRun || !configured || !envGate.allowed, configured,
                           provider: provider.name, queued: provider.queued,
                           blocked: !envGate.allowed || undefined,
                           reason: envGate.allowed ? undefined : envGate.reason,
                           tally, results });

  } catch (e) {
    console.error('whatsapp-send: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
