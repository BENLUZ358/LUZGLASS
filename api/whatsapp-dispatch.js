// ═══════════════════════════════════════════════════════════════════
//  /api/whatsapp-dispatch — **הודעה אחת ללקוח**, על קבוצת הזמנות.
//
//  ⚠️ השם נשאר מימיו כשטיפל בהובלות בלבד. היום הוא מטפל בשני הסוגים:
//  kind='dispatched' (ההובלה יצאה) ו-kind='ready' (מוכן לאיסוף). שינוי
//  השם היה שובר נתיב חי בשביל קוסמטיקה.
//
//  ─── למה כאן ולא ב-whatsapp-send ────────────────────────────────────
//
//  whatsapp-send הוא הודעה **פר-הזמנה**; כאן זו הודעה אחת לכמה הזמנות.
//  כשהתברר שגם "מוכן לאיסוף" צריך קיבוץ, הברירה הייתה לבנות מנגנון שני
//  שם או למחזר את זה. הקיבוץ כאן כבר הוכח בייצור על L1071 — פתרון
//  הנמען בשרת, הסירוב על טלפונים שונים, ומפתח דטרמיניסטי על הקבוצה —
//  ולכן ההרחבה כאן, ולא עותק.
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
const { resolveRecipient, orderSketchName } = require('./_wa-recipient');
const { lgSketchAckSkip, lgSketchAckActiveIds } = require('./_wa-sketch-ack');
const { lgEmailSendGate } = require('./_env');
const { lgEmailEnqueue, lgEmailActiveIds } = require('./_email-outbox');

// הובלה אחת של לקוח אחד. התקרה קיימת כדי שקריאה שגויה לא תגרור קריאת
// מאות הזמנות, לא כדי להגביל הובלה אמיתית.
const MAX_ORDERS = 40;

//  firebase-admin נטען בעצלות — כך הבדיקות מריצות את הנתיב עם בסיס מדומה
//  (deps.db). Vercel קורא ל-handler(req, res) בלי deps, ולכן בייצור זה _db().
function _db() {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: lgDatabaseUrl(),
  });
  return getDatabase(app);
}

module.exports = async function handler(req, res, deps) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const auth = await verifyAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body     = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const orderIds = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(String))].sort();
  // ברירת מחדל: לא שולחים. אותו כלל כמו whatsapp-send ומאותה סיבה.
  const dryRun   = body.dryRun !== false;
  const force    = body.force === true;
  //  'dispatched' נשאר ברירת המחדל — קוד ישן שאינו מוסר kind לא משנה התנהגות
  //  'sketches-handled' — שלב 6, "הסקיצות טופלו" (אפיון §16). נשלח מתור
  //  הסקיצות באדמין; כל סוג אחר מהאדמין נחסם שם (test-delivery-finish-guard).
  const kind     = body.kind === 'ready' ? 'ready'
                 : body.kind === 'sketches-handled' ? 'sketches-handled'
                 : 'dispatched';

  if (!orderIds.length)             { res.status(400).json({ error: 'orderIds חסר' }); return; }
  if (orderIds.length > MAX_ORDERS) { res.status(400).json({ error: `יותר מדי הזמנות (מקסימום ${MAX_ORDERS})` }); return; }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'server not configured — missing FIREBASE_SERVICE_ACCOUNT' }); return;
  }

  const provider = lgWaProvider();

  try {
    const db = (deps && deps.db) || _db();

    // ⚠️ שלב 6: הזמנה שכבר בהודעת "טופלו" שבדרך / שנשלחה לא נכללת שוב —
    // המפתח של התור מגן רק מהודעה זהה, לא מתת-קבוצה. ר' _wa-sketch-ack.js
    const ackActive = kind === 'sketches-handled' ? await lgSketchAckActiveIds(db) : null;

    const loaded = [];
    for (const id of orderIds) {
      const snap  = await db.ref('orders/' + id).once('value');
      const order = snap.val();
      if (!order) { loaded.push({ id, skip: 'ההזמנה לא נמצאה' }); continue; }
      // הזמנה פיקטיבית לעולם לא שולחת ללקוח אמיתי. היא גם לא נכנסת למספרי
      // ההזמנות שבהודעה — אחרת היא הייתה מופיעה אצל הלקוח.
      if (order.isTest) { loaded.push({ id, skip: 'הזמנה פיקטיבית', isTest: true }); continue; }
      //  ⚠️ חד-פעמיות פר-הזמנה, ורק ב-ready. בלי זה הזמנה שכבר קיבלה
      //  "מוכן לאיסוף" הייתה נכנסת שוב לקבוצה אחרת ומקבלת הודעה שנייה —
      //  המפתח הדטרמיניסטי שומר על קבוצה זהה, לא על הזמנה בודדת.
      //  ב-dispatched אין שדה כזה: הובלה היא אירוע, לא מצב של ההזמנה.
      if (kind === 'sketches-handled') {
        const why = lgSketchAckSkip(order, id, ackActive);
        if (why) { loaded.push({ id, skip: why }); continue; }
        //  הזמנת מייל שלא יוצאת למייל (השולח לא מקושר / נותק / כרטיס אחר) —
        //  כמו קודם: "הסקיצות טופלו" לא יוצא עליה בוואטסאפ.
        if (order.source === 'email' && (await resolveRecipient(db, order, kind)).channel !== 'email') {
          loaded.push({ id, skip: 'לא סקיצת WhatsApp' }); continue;
        }
      }
      if (kind === 'ready' && order.whatsapp && order.whatsapp.sentAt && !force) {
        loaded.push({ id, skip: 'כבר נשלחה הודעת מוכן לאיסוף' }); continue;
      }
      //  אותה חד-פעמיות להזמנה שקיבלה "מוכן לאיסוף" במייל (_email-outbox.js)
      if (kind === 'ready' && order.emailNotices && order.emailNotices.ready && !force) {
        loaded.push({ id, skip: 'כבר נשלחה הודעת מוכן לאיסוף במייל' }); continue;
      }
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
    // "הסקיצות טופלו" מקבוצה → לקבוצה; כל השאר בדיוק כמו קודם (resolvePhone)
    for (const x of live) targets.push({ id: x.id, ...(await resolveRecipient(db, x.order, kind)) });

    // ── ערוץ מייל (בן, 26/10) ──
    //  הזמנה מהמייל של שולח מקושר → תשובה בשרשרת שלה. ערבוב עם וואטסאפ
    //  נחסם עם הסבר — "לפצל או לא" נשארת דחויה, כמו בקבוצות. כולן מהמייל
    //  → הודעה אחת לכל שרשרת. כולן וואטסאפ → בדיוק כמו קודם, מתחת.
    const byEmail = targets.filter(t => t.channel === 'email');
    if (byEmail.length && byEmail.length !== targets.length) {
      res.status(409).json({
        error: 'בקבוצה יש הזמנות מהמייל ומוואטסאפ — לא נשלחה הודעה',
        detail: targets.map(t => ({ orderId: t.id, channel: t.channel, accountKey: t.accountKey })),
      });
      return;
    }
    if (byEmail.length) {
      const r = await _emailDispatch(db, { kind, dryRun, force, live, targets, queuedBy: auth.phone });
      if (r.body && !r.body.error) {
        r.body.skipped = loaded.filter(x => x.skip).map(x => ({ orderId: x.id, reason: x.skip })).concat(r.skipped || []);
      }
      res.status(r.status).json(r.body);
      return;
    }

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
    // ⚠️ אותו סדר בדיוק כמו orderNums — שתי המערכות נבנות מאותה רשימה
    const sketchNames = live.map(x => orderSketchName(x.order));
    const liveIds    = live.map(x => x.id);
    const facts      = { to, kind, clientName, orderNums, sketchNames };

    let gate = provider.gate({ phone: to, accountKey: targets[0].accountKey, linked: !!targets[0].linked });
    //  התבנית של Meta מכירה רק "מוכן לאיסוף" — הסוג החדש יוצא רק ב-GREEN API,
    //  שם הטקסט מרונדר כאן (renderText). אחרת הלקוח היה מקבל הודעה שגויה.
    if (kind === 'sketches-handled' && provider.name !== 'green' && gate.allowed) {
      gate = { allowed: false, reason: 'עדכון "הסקיצות טופלו" נשלח רק דרך GREEN API' };
    }

    if (dryRun || !provider.configured || !gate.allowed) {
      res.status(200).json({
        ok: true, queued: false, preview: true, kind,
        // ⚠️ המסך צריך להבדיל בין "לא מוגדר בסביבה" לבין "נחסם" —
        // הראשון אינו תקלה ואין להציג אותו למזכירה. ר' _waDispatch.
        configured: provider.configured,
        provider: provider.name, to, clientName, orderNums, sketchNames,
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
      kind, to, clientName, orderNums, sketchNames,
      orderIds: liveIds, queuedBy: auth.phone,
      // תיעוד בלבד — ר' lgWaEnqueue
      phoneSource: targets[0].source, accountKey: targets[0].accountKey,
    });

    res.status(200).json({
      ok: true, queued: q.queued, outboxKey: q.key, configured: provider.configured, kind,
      provider: provider.name, to, clientName, orderNums, sketchNames,
      phoneSource: targets[0].source, accountKey: targets[0].accountKey,
      reason: q.queued ? null : q.reason,
      skipped: loaded.filter(x => x.skip).map(x => ({ orderId: x.id, reason: x.skip })),
    });

  } catch (e) {
    console.error('whatsapp-dispatch: unexpected error', e);
    res.status(500).json({ error: 'internal error' });
  }
};

//  כל ההזמנות מהמייל. כרטיס אחד בלבד (אחרת 409 — אותו היגיון כמו "מספרים
//  שונים"), ואז הודעה אחת לכל שרשרת. נעילת הסביבה נבדקת לכל כתובת.
//  ⚠️ לא נוגע ב-waOutbox ולא בספק הוואטסאפ: התור הוא waMeta/emailOutbox,
//  והסקריפט בג'ימייל שולח משם (api/_email-outbox.js).
async function _emailDispatch(db, { kind, dryRun, force, live, targets, queuedBy }) {
  const cards = [...new Set(targets.map(t => String(t.accountKey || '')))];
  if (cards.length !== 1 || !cards[0]) {
    return { status: 409, body: {
      error: 'ההזמנות בקבוצה שייכות לכרטיסי לקוח שונים — לא נשלחה הודעה',
      detail: targets.map(t => ({ orderId: t.id, accountKey: t.accountKey })),
    } };
  }
  const byId = new Map(live.map(x => [x.id, x.order]));
  //  ⚠️ הזמנה שכבר בהודעת מייל מאותו סוג שבדרך / שנשלחה זה עתה לא נכללת שוב —
  //  [X] ואז [X,Y] הם מפתחות שונים. ב"הסקיצות טופלו" זה כבר נעשה למעלה
  //  (lgSketchAckActiveIds). ר' lgEmailActiveIds.
  const active  = (kind !== 'sketches-handled' && !force) ? await lgEmailActiveIds(db, kind) : new Set();
  const skipped = [];
  const threads = new Map();
  for (const t of targets) {
    if (!threads.has(t.thread)) threads.set(t.thread, []);
    threads.get(t.thread).push(t);
  }
  const messages = [];
  for (const [thread, all] of threads) {
    const ts = all.filter(t => !active.has(String(t.id)));
    all.filter(t => active.has(String(t.id))).forEach(t => skipped.push({ orderId: t.id, reason: 'כבר בהודעה שבדרך במייל' }));
    if (!ts.length) {
      messages.push({ thread, orderNums: [], queued: false, reason: 'כבר בהודעה שבדרך במייל' });
      continue;
    }
    const orders      = ts.map(t => byId.get(t.id));
    const orderNums   = ts.map((t, i) => String(orders[i].orderNum || orders[i].refNum || t.id));
    const sketchNames = orders.map(orderSketchName);
    const clientName  = String(orders[0].orderClient || 'לקוח');
    const emails      = [...new Set(ts.map(t => t.email))];
    //  המייל שעליו עונים: האחרון שהלקוח שלח בשרשרת (מבין ההזמנות בהודעה).
    //  הסקריפט בודק שוב שהוא מהכתובת המקושרת לפני שהוא עונה.
    const newest = orders.reduce((a, o) => (Number(o.emailReceivedAt) || 0) >= (Number(a.emailReceivedAt) || 0) ? o : a, orders[0]);
    const messageId = String(newest.emailMessageId || '');
    const msg = { thread, orderNums, queued: false, reason: null };
    const gate = emails.length === 1 ? lgEmailSendGate(emails[0])
               : { allowed: false, reason: 'בשרשרת אחת יש כמה כתובות — לא נשלח' };
    if (!gate.allowed) { msg.reason = gate.reason; msg.blocked = true; }
    else if (dryRun)   { msg.reason = 'dryRun'; }
    else {
      const q = await lgEmailEnqueue(db, { kind, thread, messageId, email: emails[0], clientName, orderNums, sketchNames,
                                           orderIds: ts.map(t => t.id), queuedBy, accountKey: cards[0] });
      msg.queued = q.queued; msg.reason = q.queued ? null : q.reason; msg.outboxKey = q.key;
    }
    messages.push(msg);
  }
  const queued  = messages.some(m => m.queued);
  const blocked = !queued && messages.every(m => m.blocked);
  const first   = messages.find(m => m.reason);
  //  preview/configured/reason — כמו בוואטסאפ, כי workday.html ו-admin.html
  //  קוראים אותם: preview + configured → טוסט עם הסיבה; queued → הצלחה.
  return { status: 200, body: {
    ok: true, queued, channel: 'email', kind,
    preview: dryRun || blocked || undefined, blocked: blocked || undefined, configured: true,
    clientName: String((byId.get(targets[0].id) || {}).orderClient || 'לקוח'),
    orderNums: messages.flatMap(m => m.orderNums), accountKey: cards[0],
    reason: queued ? null : (first ? first.reason : null),
    messages,
  }, skipped };
}
