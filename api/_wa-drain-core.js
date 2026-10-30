// ═══════════════════════════════════════════════════════════════════
//  api/_wa-drain-core.js — הלולאה של whatsapp-drain, בלי ה-route.
//
//  עוזר משותף, לא route. whatsapp-drain.js (מסך אדמין) ו-_invoice-deliver.js
//  (חשבונית שהודפסה — אין מסך פתוח) מוציאים מאותה לולאה, באותו קצב ובאותן
//  בדיקות. ההסברים המלאים ב-whatsapp-drain.js.
// ═══════════════════════════════════════════════════════════════════

const { lgWaProvider }  = require('./_wa-provider');
const { lgWaClaim, lgWaComplete, lgWaRelease, lgWaPending, lgWaReserveSlot, lgWaStampField } = require('./_wa-outbox');
const { resolveRecipientWa } = require('./_wa-recipient');

// ⚠️ חייב להישאר מתחת ל-maxDuration שמוגדר ב-vercel.json (60). 45 משאיר
// מרווח לשליחה שנתקעת ולסגירת הרשומה אחריה.
const BUDGET_MS = 45 * 1000;

//  כמה מותר להמתין לחלון שליחה. חייב להיות קטן מספיק כדי להישאר בתקציב,
//  וגדול מספיק כדי שדילוג על חלון לא יהפוך לשגרה. gap אחד ועוד מרווח.
const SLOT_MAX_WAIT_MS = 15 * 1000;

//  מצב החיבור, כדי שמסך יוכל להראות אותו בלי לשאול את GREEN API בעצמו.
//  ⚠️ waMeta כבר קיים בחוקים — קריאה לאדמין, כתיבה חסומה. אין שינוי rules.
const WA_STATE = 'waMeta/whatsapp';

//  'authorized' הוא היחיד שמתיר שליחה. כל השאר אומר להמתין — notAuthorized
//  (המכשיר נותק), blocked (המספר נחסם), starting, sleepMode, suspended.
const isLive = st => st === 'authorized';

async function recordState(db, { state, reason, pending }) {
  try {
    await db.ref(WA_STATE).update({
      state:     String(state || 'unknown'),
      reason:    String(reason || ''),
      pending:   Number(pending) || 0,
      checkedAt: Date.now(),
    });
  } catch (e) {
    // רישום מצב אינו שליחה — כישלון כאן לא עוצר דבר
    console.warn('whatsapp-drain: recordState', e && e.name);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

//  חשבונית (DB-00004): הקבצים נטענים עכשיו, לא נשמרים בתור. ספק בלי שליחת
//  קבצים (Meta — תבניות בלבד) → כישלון, ולא "מוכן לאיסוף" במקום חשבונית.
async function _sendInvoice(db, provider, to, entry) {
  if (typeof provider.sendFiles !== 'function') {
    return { ok: false, failureKind: 'other', reason: 'הספק הנוכחי לא שולח קבצים — החשבונית לא נשלחה' };
  }
  //  ⚠️ חריגה כאן הייתה משאירה את הרשומה תפוסה בלי סגירה ובלי סיבה (30/10, L1143).
  //  כל כשל נסגר כ-ok:false עם שם השגיאה בלבד — הודעת השגיאה עלולה להכיל URL עם טוקן.
  try {
    const f = await require('./_invoice-deliver').lgInvoiceFiles(db, entry.invoiceKey);
    if (!f.ok) return { ok: false, failureKind: 'other', reason: 'קבצי החשבונית לא זמינים (' + f.code + ')' };
    return await provider.sendFiles({ to, kind: 'invoice', clientName: entry.clientName, orderNums: entry.orderNums,
                                      sketchNames: entry.sketchNames || [], docNumber: entry.docNumber, files: f.files });
  } catch (e) {
    return { ok: false, failureKind: 'other', reason: 'חריגה בשליחת החשבונית (' + (e && e.name) + (e && e.code ? ' ' + e.code : '') + ')' };
  }
}

async function _invoiceDelivery(db, invoiceKey, outboxKey, out) {
  try {
    await db.ref('invoicePdf/' + invoiceKey + '/delivery').update({
      state: out.ok ? 'sent' : 'failed', channel: 'whatsapp', outboxKey,
      reason: out.ok ? null : String(out.reason || '').slice(0, 300), at: Date.now() });
  } catch (e) { console.error('whatsapp-drain: invoice delivery stamp failed', e && e.name); }
}

//  פרוסה אחת של התור. מחזיר { results, processed, state? }.
async function drainKeys(db, provider, keys, by, started) {
  let state = null;
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

    const { claimed, entry, reason } = await lgWaClaim(db, key, by);
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

    //  ⚠️ וואטסאפ בלבד: ההודעה כבר בתור הוואטסאפ. אם הכתובת במייל קושרה מאז,
    //  resolveRecipient היה עונה 'email' בלי טלפון והלקוח לא היה מקבל כלום.
    const live = await resolveRecipientWa(db, order, entry.kind);
    const gate = provider.gate({ phone: live.phone, accountKey: live.accountKey, linked: !!live.linked });

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

    const out = entry.kind === 'invoice' ? await _sendInvoice(db, provider, live.phone, entry) : await provider.send({
      to:          live.phone,
      kind:        entry.kind,
      clientName:  entry.clientName,
      orderNums:   entry.orderNums,
      sketchNames: entry.sketchNames || [],
    });

    //  ⚠️ ניתוק שהתחיל באמצע הסבב. הרשומה חוזרת לתור **בלי לספור
    //  ניסיון**, והסבב נעצר — אין טעם לנסות את שאר ההודעות מול מכשיר
    //  שאינו מחובר, וכל ניסיון כזה שורף חלון שליחה של 10 שניות.
    if (!out.ok && out.failureKind === 'disconnected') {
      await lgWaRelease(db, key, out.reason || 'WhatsApp מנותק');
      await recordState(db, { state: 'notAuthorized', reason: out.reason || '',
                              pending: (await lgWaPending(db, 60)).length });
      results.push({ key, status: 'waiting', reason: 'WhatsApp מנותק — ההודעה ממתינה' });
      state = 'notAuthorized';
      break;
    }

    await lgWaComplete(db, key, out);
    processed++;
    if (entry.invoiceKey) await _invoiceDelivery(db, entry.invoiceKey, key, out);

    // ── הרישום על ההזמנות עצמן ──
    //
    //  kind='ready' נכתב ל-orders/<id>/whatsapp באותו מבנה כמו תמיד, כדי
    //  שהמסך וגם הדילוג "כבר נשלחה" ב-whatsapp-send ימשיכו לעבוד.
    //  kind='dispatched' נכתב בנפרד — זו הודעה אחת לכמה הזמנות.
    //  sketches-handled נכתב ל-sketchAck (שלב 6). ר' lgWaStampField.
    const field = lgWaStampField(entry.kind);
    const stamp = {
      outboxKey:   key,
      sentAt:      out.ok ? Date.now() : null,
      attemptedAt: Date.now(),
      sentBy:      entry.queuedBy || by,
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
      sketchNames: entry.sketchNames || null,
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
  return { results, processed, state };
}

//  שליחה מיידית מהשרת, בלי מסך אדמין (חשבונית שהודפסה). בודק חיבור כמו
//  ה-handler; מנותק → ההודעות נשארות בתור ל-drain הבא.
async function drainNow(db, keys, by) {
  const provider = lgWaProvider();
  if (!provider.configured) return { results: [], processed: 0, state: 'not-configured' };
  if (provider.checksState) {
    const st = await provider.getState();
    if (!isLive(st.state)) return { results: [], processed: 0, state: st.state };
  }
  return drainKeys(db, provider, keys, by, Date.now());
}

module.exports = { drainKeys, drainNow, recordState, isLive, BUDGET_MS, WA_STATE };
