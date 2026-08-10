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
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = 'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';

// Meta מגבילה קצב. שליחה טורית עם הפסקה קצרה במקום מטח — עשרים הזמנות
// שנסגרות יחד הן בדיוק המקרה שבו מטח נחסם.
const GAP_MS      = 250;
const MAX_PER_RUN = 60;

function _db() {
  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: DATABASE_URL,
  });
  return getDatabase(app);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── מספר בפורמט שה-API דורש: בין-לאומי, בלי + ובלי 0 מוביל ──
//    052-2578559 → 972522578559
function toWaNumber(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!p) return '';
  if (p.startsWith('972')) return p;
  return '972' + p.replace(/^0/, '');
}

// ── לאיזה מספר ההודעה יוצאת ──
//
// אותה שרשרת בדיוק כמו lgResolveClientPhone בדפדפן, ומאותה סיבה: המספר
// שבכרטיס הלקוח בחשבשבת הוא המתוחזק. order.phone הוא עותק מיום פתיחת
// ההזמנה, והוא לא מתעדכן כשהלקוח מחליף מספר.
async function resolvePhone(db, order) {
  const norm = p => String(p || '').replace(/[-\s]/g, '');

  let key = order.customerId || null;
  if (!key) {
    const login = norm(order.clientPhone || order.phone);
    if (login) {
      const snap = await db.ref('users/' + login).once('value');
      const u = snap.val();
      key = (u && u.customerId) || null;
    }
  }
  if (key) {
    const snap = await db.ref('hashavshevetAccounts/' + String(key).trim()).once('value');
    const acc  = snap.val();
    if (acc && acc.phone) return { phone: norm(acc.phone), source: 'hashavshevet', accountKey: String(key) };
  }
  const own = norm(order.phone);
  return { phone: own, source: own ? 'order' : 'none', accountKey: null };
}

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

  const PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
  const TOKEN    = process.env.WA_ACCESS_TOKEN;
  const TEMPLATE = process.env.WA_TEMPLATE_NAME;
  const LANG     = process.env.WA_TEMPLATE_LANG  || 'he';
  const GRAPH    = process.env.WA_GRAPH_VERSION  || 'v21.0';
  // חסרה הגדרה — עדיין עונים, אבל בלי לשלוח. ככה אפשר לבדוק את כל הזרימה
  // לפני שיש חשבון Meta, במקום לגלות את הפערים ביום שהוא נפתח.
  const configured = !!(PHONE_ID && TOKEN && TEMPLATE);

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

      const to     = toWaNumber(target.phone);
      const params = [
        String(order.orderClient || 'לקוח'),
        String(order.orderNum || order.refNum || ''),
      ];

      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: TEMPLATE || '(לא מוגדר)',
          language: { code: LANG },
          components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: t })) }],
        },
      };

      if (dryRun || !configured) {
        results.push({
          orderId, status: 'preview', to, phoneSource: target.source,
          accountKey: target.accountKey, params,
          reason: configured ? null : 'חסרים משתני סביבה של Meta — לא נשלח',
        });
        continue;
      }

      let httpStatus = 0, text = '', parsed = null;
      try {
        const r = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
          method:  'POST',
          headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        httpStatus = r.status;
        text = await r.text();
        try { parsed = JSON.parse(text); } catch (_) { /* לא JSON — נשמור גולמי */ }
      } catch (e) {
        text = String(e && e.message || e);
      }

      const ok = httpStatus >= 200 && httpStatus < 300;
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
        template:    TEMPLATE,
        params,
        httpStatus,
        httpOk:      ok,
        waMessageId: (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) || null,
        response:    String(text).slice(0, 2000),
      };
      await db.ref('orders/' + orderId + '/whatsapp').set(record);

      results.push({
        orderId, status: ok ? 'sent' : 'error', to, phoneSource: target.source,
        httpStatus, waMessageId: record.waMessageId,
        reason: ok ? null : (parsed && parsed.error && parsed.error.message) || String(text).slice(0, 300),
      });

      await sleep(GAP_MS);
    }

    const tally = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    res.status(200).json({ ok: true, dryRun: dryRun || !configured, configured, tally, results });

  } catch (e) {
    console.error('whatsapp-send: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
