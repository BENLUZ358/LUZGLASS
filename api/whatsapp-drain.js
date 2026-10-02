// ═══════════════════════════════════════════════════════════════════
//  /api/whatsapp-drain — מוציא הודעות מ-waOutbox, בקצב של הספק.
//
//  ─── מה הוא לא עושה ────────────────────────────────────────────────
//
//  לא מחליט למי לשלוח ולא מה לכתוב. הכל נקבע ברגע ההכנסה לתור, על ידי
//  הלוגיקה העסקית. כאן רק מוציאים.
//
//  ─── התקציב ────────────────────────────────────────────────────────
//
//  ⚠️ הוא נעצר מעצמו, ובכוונה. עם 10 שניות בין נמענים, 40 הודעות הן מעל
//  6 דקות — ואין request HTTP שיכול להחזיק את זה (תקרת Hobby היא 60
//  שניות). לכן כל קריאה מוציאה פרוסה ומחזירה remaining, והקורא חוזר.
//
//  מי קורא:
//    1. הדפדפן מיד אחרי הפעולה העסקית — לופ קצר עם התקדמות על המסך
//    2. kick בטעינת המסך — אם נשאר משהו בתור
//
//  שניהם בטוחים יחד, כי התפיסה היא טרנזקציה (ר' _wa-outbox.js). אם הטאב
//  נסגר באמצע — ההודעות **לא אובדות**, הן ממתינות בתור ליוצאות בפעם הבאה.
// ═══════════════════════════════════════════════════════════════════

const { verifyAdmin }   = require('./_verifyAdmin');
const { lgDatabaseUrl } = require('./_env');
const { lgWaProvider }  = require('./_wa-provider');
const { lgWaClaim, lgWaComplete, lgWaPending, lgWaReserveSlot } = require('./_wa-outbox');
const { resolvePhone } = require('./_wa-recipient');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = lgDatabaseUrl();

// ⚠️ חייב להישאר מתחת ל-maxDuration שמוגדר ב-vercel.json (60). 45 משאיר
// מרווח לשליחה שנתקעת ולסגירת הרשומה אחריה.
const BUDGET_MS = 45 * 1000;

//  כמה מותר להמתין לחלון שליחה. חייב להיות קטן מספיק כדי להישאר בתקציב,
//  וגדול מספיק כדי שדילוג על חלון לא יהפוך לשגרה. gap אחד ועוד מרווח.
const SLOT_MAX_WAIT_MS = 15 * 1000;

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

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing FIREBASE_SERVICE_ACCOUNT' }); return;
  }

  const provider = lgWaProvider();
  const started  = Date.now();

  try {
    const db      = _db();
    const keys    = await lgWaPending(db, 60);
    const results = [];
    let processed = 0;

    for (const key of keys) {
      if (processed >= provider.maxPerRun)         break;
      if (Date.now() - started > BUDGET_MS)        break;

      // ── חלון השליחה, לפני התפיסה ──
      //
      //  ⚠️ הסדר מכוון. אילו תפסנו קודם ולא היינו מקבלים חלון, היינו
      //  צריכים לשחרר תפיסה שכבר ספרה ניסיון. כך, מי שאינו מקבל חלון
      //  פשוט פורש בלי לגעת באף הודעה.
      //
      //  המחיר: אם החלון התקבל והתפיסה נכשלה (drain אחר הקדים), החלון
      //  מתבזבז — gap אחד של שקט. מחיר סביר על קוד פשוט יותר.
      if (provider.globalSlot) {
        const slot = await lgWaReserveSlot(db, provider.nextGap(), SLOT_MAX_WAIT_MS);
        if (!slot.ok) {
          // העתיד הקרוב תפוס על ידי drain אחר. לא ממתינים — חוזרים אחר כך.
          results.push({ key, status: 'deferred', reason: 'חלון השליחה תפוס' });
          break;
        }
        if (slot.waitMs) await sleep(slot.waitMs);
      }

      const { claimed, entry, reason } = await lgWaClaim(db, key, auth.phone);
      if (!claimed) { results.push({ key, status: 'skipped', reason }); continue; }

      // ── בדיקה חוזרת מהנתונים החיים, לפני כל יציאה אמיתית ──
      //
      //  ⚠️ ה-accountKey שנשמר ברשומה הוא **תיעוד, לא הרשאה**. בין ההכנסה
      //  לתור לבין השליחה יכולים לחלוף דקות: הכרטיס יכול להשתנות, הלקוח
      //  יכול לרדת מרשימת המורשים, וההזמנה יכולה להיות מסומנת פיקטיבית.
      //  סמיכה על מה שנכתב פירושה שרשומה שנכתבה שגוי תישלח.
      //
      //  לכן פותרים מחדש מההזמנה עצמה, ומה שחוזר הוא שקובע — גם את
      //  ההרשאה וגם את הנמען.
      const firstId = (entry.orderIds || [])[0];
      const snap    = firstId ? await db.ref('orders/' + firstId).once('value') : null;
      const order   = snap && snap.val();

      if (!order) {
        const why = 'ההזמנה לא נמצאה — לא נשלחה הודעה';
        await lgWaComplete(db, key, { ok: false, reason: why });
        results.push({ key, status: 'blocked', reason: why });
        continue;
      }
      // הזמנה שסומנה פיקטיבית אחרי ההכנסה לתור
      if (order.isTest) {
        const why = 'ההזמנה סומנה פיקטיבית — לא נשלחה הודעה';
        await lgWaComplete(db, key, { ok: false, reason: why });
        results.push({ key, status: 'blocked', reason: why });
        continue;
      }

      const live = await resolvePhone(db, order);
      const gate = provider.gate({ phone: live.phone, accountKey: live.accountKey });

      if (!gate.allowed || !provider.configured || !live.phone) {
        const why = !live.phone          ? 'אין מספר טלפון ללקוח'
                  : !gate.allowed        ? gate.reason
                  :                        'הספק אינו מוגדר בסביבה הזו';
        await lgWaComplete(db, key, { ok: false, reason: why });
        results.push({ key, status: 'blocked', reason: why });
        continue;
      }

      // ⚠️ הכרטיס הוא מקור האמת גם לנמען. אם הלקוח החליף מספר מאז ההכנסה
      // לתור, ההודעה תצא למספר המעודכן — וההפרש נרשם כדי שיהיה מה לחקור.
      if (live.phone !== entry.to) {
        console.log('whatsapp-drain: recipient changed since enqueue', { key, source: live.source });
      }

      const out = await provider.send({
        to:         live.phone,
        kind:       entry.kind,
        clientName: entry.clientName,
        orderNums:  entry.orderNums,
      });

      await lgWaComplete(db, key, out);
      processed++;

      // ── הרישום על ההזמנות עצמן ──
      //
      //  kind='ready' נכתב ל-orders/<id>/whatsapp באותו מבנה כמו תמיד, כדי
      //  שהמסך וגם הדילוג "כבר נשלחה" ב-whatsapp-send ימשיכו לעבוד.
      //  kind='dispatched' נכתב בנפרד — זו הודעה אחת לכמה הזמנות.
      const field = entry.kind === 'dispatched' ? 'whatsappDispatch' : 'whatsapp';
      const stamp = {
        outboxKey:   key,
        sentAt:      out.ok ? Date.now() : null,
        attemptedAt: Date.now(),
        sentBy:      entry.queuedBy || auth.phone,
        to:          live.phone,
        // ⚠️ דרך מה נמצא המספר. במסלול הישיר של Meta השדות האלה נכתבו
        // תמיד; ב-drain הם חסרו, ולכן אי אפשר היה לענות בדיעבד על
        // "למה ההודעה יצאה דווקא למספר הזה".
        // ⚠️ מה שנפתר **בשליחה**, לא מה שנשמר בהכנסה. זה מה שבאמת קבע.
        phoneSource: live.source     || null,
        accountKey:  live.accountKey || null,
        queuedAccountKey: entry.accountKey || null,
        provider:    provider.name,
        kind:        entry.kind,
        orderNums:   entry.orderNums,
        params:      out.params || null,
        httpStatus:  out.httpStatus,
        httpOk:      out.ok,
        waMessageId: out.messageId,
        response:    String(out.detail || '').slice(0, 2000),
      };
      await Promise.all((entry.orderIds || []).map(id =>
        db.ref('orders/' + id + '/' + field).set(stamp).catch(e => {
          // ⚠️ ההודעה כבר יצאה. כישלון ברישום לא הופך אותה ללא-נשלחה,
          // ולכן הוא לא מחזיר את הרשומה לתור — רק נרשם.
          console.error('whatsapp-drain: stamp failed', { id, name: e && e.name });
        })));

      results.push({ key, status: out.ok ? 'sent' : 'error',
                     orderNums: entry.orderNums, reason: out.reason || null });

      //  ⚠️ רק לספק שאינו עובד עם חלון גלובלי — כלומר Meta, שאצלה הקצב
      //  נשאר בדיוק כפי שהיה. אצל green ההמתנה כבר קרתה לפני השליחה,
      //  והמתנה נוספת כאן הייתה מכפילה את המרווח.
      if (!provider.globalSlot &&
          processed < provider.maxPerRun && Date.now() - started < BUDGET_MS) {
        await sleep(provider.nextGap());
      }
    }

    // מה שנשאר אחרי הפרוסה — הקורא יודע אם לחזור
    const remaining = (await lgWaPending(db, 60)).length;
    const tally = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

    res.status(200).json({
      ok: true, provider: provider.name, gapMs: provider.gapMs,
      processed, remaining, tally, results,
      elapsedMs: Date.now() - started,
    });

  } catch (e) {
    console.error('whatsapp-drain: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
