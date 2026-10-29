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
const { lgWaPending } = require('./_wa-outbox');
//  הלולאה עצמה ב-_wa-drain-core.js — כדי שגם שליחת חשבונית מהשרת (בלי מסך) תשתמש בה
const { drainKeys, recordState, isLive } = require('./_wa-drain-core');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const DATABASE_URL = lgDatabaseUrl();

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

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing FIREBASE_SERVICE_ACCOUNT' }); return;
  }

  const provider = lgWaProvider();
  const started  = Date.now();

  const body      = (req.body && typeof req.body === 'object') ? req.body : {};
  //  בדיקת מצב בלבד, בלי לגעת בתור — כדי שמסך יוכל לרענן אינדיקציה
  //  בבטחה. אותו endpoint, בלי לפתוח אחד חדש בשביל שורה אחת.
  const checkOnly = body.checkOnly === true;

  try {
    const db      = _db();
    const keys    = await lgWaPending(db, 60);

    // ── מצב המכשיר, לפני שנוגעים בתור ──
    //
    //  ⚠️ זה המנגנון ולא הגיבוי. כשהמכשיר מנותק GREEN API לרוב **אינה
    //  מחזירה שגיאה** — היא מכניסה את ההודעה לתור שלה ל-24 שעות. אם
    //  נשלח בכל זאת נקבל idMessage ונרשום "נשלח" על הודעה שלא נמסרה.
    //  לכן שואלים לפני, וזו גם ההמלצה הרשמית של GREEN API.
    //
    //  שאלה אחת לכל הפעלה, לא לכל הודעה.
    let state = 'authorized', stateReason = '';
    if (provider.checksState && provider.configured && (keys.length || checkOnly)) {
      const st = await provider.getState();
      state = st.state; stateReason = st.reason || '';
      await recordState(db, { state, reason: stateReason, pending: keys.length });

      if (!isLive(state)) {
        //  ⚠️ לא תופסים, לא שולחים, לא סופרים ניסיון. ההודעות נשארות
        //  pending ויצאו כשהחיבור יחזור — דרך אותו drain ואותו קצב.
        res.status(200).json({
          ok: true, provider: provider.name, state, stateReason,
          disconnected: true, processed: 0, remaining: keys.length,
          tally: keys.length ? { waiting: keys.length } : {}, results: [],
          elapsedMs: Date.now() - started,
        });
        return;
      }
    }

    if (checkOnly) {
      res.status(200).json({
        ok: true, provider: provider.name, state, stateReason,
        checkOnly: true, processed: 0, remaining: keys.length,
        tally: {}, results: [], elapsedMs: Date.now() - started,
      });
      return;
    }
    const run = await drainKeys(db, provider, keys, auth.phone, started);
    const { results, processed } = run;
    if (run.state) state = run.state;

    // מה שנשאר אחרי הפרוסה — הקורא יודע אם לחזור
    const remaining = (await lgWaPending(db, 60)).length;
    const tally = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

    //  מה שנמדד בפועל — כולל כמה ממתינות — כדי שהמסך יראה תמונה עדכנית
    if (provider.checksState && provider.configured) {
      await recordState(db, { state, reason: stateReason, pending: remaining });
    }

    res.status(200).json({
      ok: true, provider: provider.name, gapMs: provider.gapMs, state,
      disconnected: !isLive(state) || undefined,
      processed, remaining, tally, results,
      elapsedMs: Date.now() - started,
    });

  } catch (e) {
    console.error('whatsapp-drain: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};
