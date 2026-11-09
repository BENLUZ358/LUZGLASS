// ── core start ──
// ═══════════════════════════════════════════════════════════════════
//  החלקים הטהורים של סקריפט Gmail — בלי GmailApp ובלי UrlFetchApp.
//  ⚠️ המקור היחיד. ההעתק ב-gmail-intake.gs זהה בייט-לבייט, ו-
//  test-gmail-intake-core.js נכשל אם הם נפרדים. משנים כאן ומעתיקים לשם.
// ═══════════════════════════════════════════════════════════════════

//  כמה חתיכות צריך לקובץ. ⚠️ לפחות 1 — השרת דורש chunks בין 1 ל-10.
function emPlanChunks(sizeBytes, chunkBytes) {
  var size = Number(sizeBytes) || 0;
  var per = Number(chunkBytes) > 0 ? Number(chunkBytes) : 3000000;
  return Math.max(1, Math.ceil(size / per));
}

//  הכתובת עצמה מתוך '"שם" <a@b.com>' או 'a@b.com', באותיות קטנות.
//  ⚠️ הקבוצה **האחרונה** ב-<...> — אותו כלל כמו lgEmailAddr בשרת ו-_waInAddr
//  בפאנל. שם תצוגה יכול להכיל <...> משלו ('"boss@x.com <boss@x.com>" <a@evil.com>'),
//  והכתובת האמיתית תמיד אחרונה.
function emAddr(s) {
  var str = String(s || '');
  var all = str.match(/<[^<>]+>/g);
  var a = all ? all[all.length - 1].slice(1, -1) : str;
  return a.trim().toLowerCase();
}

//  האם לטפל במייל הזה. msg: {id, from, date(ms)}; cfg: {START_AT, ALLOWED_SENDERS};
//  handled: {id: ts}. ⚠️ ההחלטה לפי מייל ולא לפי שרשור — לקוח עונה בשרשור ישן.
function emShouldTake(msg, cfg, handled) {
  cfg = cfg || {};
  if (handled && Object.prototype.hasOwnProperty.call(handled, msg.id)) return false;
  // ⚠️ מייל שהתיבה עצמה שלחה (תשובות, התראות) — לא סקיצה של לקוח
  if (cfg.ME && emAddr(msg.from) === emAddr(cfg.ME)) return false;
  var start = cfg.START_AT ? new Date(cfg.START_AT).getTime() : NaN;
  if (!isNaN(start) && Number(msg.date) < start) return false;
  var allowed = String(cfg.ALLOWED_SENDERS || '').split(',')
    .map(emAddr).filter(function (a) { return a; });
  if (allowed.length && allowed.indexOf(emAddr(msg.from)) < 0) return false;
  return true;
}

//  התווית לפי מה שהשרת ענה. null = בלי תווית.
//  'http-final' = השרת סירב למייל עצמו (400) — ניסיון חוזר לא יעזור.
//  'not-allowed' = השולח לא ברשימת השרת — בלי תווית (ר' emDecide).
function emLabelFor(state) {
  if (state === 'done' || state === 'ignored' || state === 'closed') return 'LG/נקלט';
  if (state === 'rejected' || state === 'dead' || state === 'http-final') return 'LG/נכשל';
  return null;
}
//  מה עושים עם תשובת השרת. label: התווית (null = בלי); handled: האם סופי;
//  stop: לעצור את כל הריצה.
//    400 — המייל עצמו פגום: סופי, LG/נכשל.
//    401/403 — ⚠️ הגדרות, לא המייל (טוקן שגוי או שהוחלף, EMAIL_INBOUND_TOKEN /
//      EMAIL_INBOUND_ADDRESS חסרים בשרת). אם זה היה סופי, כל מייל בתיבה היה
//      מקבל LG/נכשל עד שמישהו שם לב. לכן — לעצור את הריצה ולנסות בדקה הבאה,
//      **בלי** לספור ניסיון (emRun לא קורא ל-emRetry): המייל מחכה עד שמתקנים.
//    200 not-allowed — השולח לא ברשימה בשרת: "טופל" **בלי תווית**. ⚠️ בשלב
//      הבדיקה מיילים של לקוחות אמיתיים לא נוגעים בהם (אפיון §3.6).
//    500 / רשת (0) / state לא סופי — שוב בריצה הבאה.
function emDecide(httpCode, body) {
  if (httpCode === 400) return { label: emLabelFor('http-final'), handled: true };
  if (httpCode === 401 || httpCode === 403) return { label: null, handled: false, stop: true };
  if (httpCode === 200 && body) {
    if (body.state === 'not-allowed') return { label: null, handled: true };
    var label = emLabelFor(body.state);
    //  "טופל" לבד (בן, 2/11): השרת סימן וענה ללקוח — השרשור יוצא מהדואר הנכנס
    if (body.state === 'done' && body.autoHandled === true) return { label: label, handled: true, archive: true };
    return { label: label, handled: label !== null };
  }
  return { label: null, handled: false };
}
//  האם מותר להוציא שרשור מהדואר הנכנס. msgs: [{id, from, date}] — כל המיילים בו;
//  auto: {id: ts} — מיילים שהשרת סימן "טופל" לבד. כל מייל של לקוח חייב להיות שם.
//  ⚠️ רק כשאין בו אף מייל שעוד צריך לקלוט: הסריקה היא in:inbox, ומייל שנשאר לריצה
//  הבאה (תקרת מיילים לריצה, ניסיון חוזר) היה נעלם ולא נקלט לעולם. מייל שלנו (תשובה)
//  או ישן מ-START_AT לא מחזיק את השרשור — emShouldTake כבר מדלג עליהם.
function emThreadSettled(msgs, cfg, auto) {
  var list = Array.isArray(msgs) ? msgs : [];
  return list.length > 0 && list.every(function (m) {
    return !emShouldTake(m, cfg, {}) || Object.prototype.hasOwnProperty.call(auto || {}, m.id);
  });
}
//  האם להפסיק לנסות מייל. retries = מספר הניסיונות עד כה (כולל הנוכחי),
//  ageMs = גיל המייל. 20 ניסיונות או 60 שעות (לפני שנופל מחלון 3 הימים).
function emGiveUp(retries, ageMs) {
  return Number(retries) >= 20 || Number(ageMs) > 60 * 3600 * 1000;
}
//  ── תשובות ללקוח (outbox) ──────────────────────────────────────────
//  תכנית השליחה. items: מה שהשרת החזיר ב-claim; props: כל נכסי הסקריפט.
//  ⚠️ שליחה פעם אחת בלבד. שלושה סימונים מקומיים לכל key:
//    u_<key> — נקבע לפני reply (בדרך לשליחה); s_<key> — נקבע מיד אחרי reply
//    ולפני done. פעולה לכל פריט:
//    'ack'  — s_ קיים: כבר נשלח, מאשרים done ok:true בלי לשלוח.
//    'fail' — u_ קיים וגם s_ חסר: ניסיון קודם נפל באמצע, לא ידוע אם יצא.
//             done ok:false ו-**לעולם לא** שולחים שוב.
//    'send' — אחרת.
function emOutboxPlan(items, props) {
  var p = props || {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(p, k); };
  return (Array.isArray(items) ? items : []).filter(function (it) {
    return it && typeof it.key === 'string' && it.key &&
      typeof it.thread === 'string' && it.thread &&
      typeof it.messageId === 'string' && it.messageId &&
      typeof it.email === 'string' && it.email &&
      typeof it.text === 'string' && it.text &&
      typeof it.leaseToken === 'string';
  }).map(function (it) {
    var action = has('s_' + it.key) ? 'ack' : (has('u_' + it.key) ? 'fail' : 'send');
    var out = { key: it.key, thread: it.thread, messageId: it.messageId, email: it.email,
                text: it.text, leaseToken: it.leaseToken, action: action };
    //  "טופל" ידני (בן, 4/11): מיילים שכל הסקיצות שלהם טופלו — לארכיון אחרי התשובה
    var dm = Array.isArray(it.doneMails) ? it.doneMails.filter(function (x) { return typeof x === 'string' && x; }) : [];
    if (dm.length) out.doneMails = dm;
    //  ⚠️ כמה קבצים לצרף (חשבונית, DB-00004) — בלי זה emOutbox לא מושך אותם והמייל יוצא בלי קבצים
    if (Number(it.files) > 0) out.files = Number(it.files);
    //  חשבונית למייל החשבוניות של הלקוח (בן, 9/11) — מייל חדש לכתובת הזו, לא תשובה
    if (typeof it.sendTo === 'string' && /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(it.sendTo)) {
      out.sendTo = it.sendTo;
      out.subject = typeof it.subject === 'string' && it.subject ? it.subject : 'חשבונית — לוז גלאס';
    }
    return out;
  });
}
//  האם מותר לענות על המייל הזה. ⚠️ msg.reply עונה ל-Reply-To אם יש, אחרת ל-From —
//  ולכן זו הכתובת שנבדקת, והיא חייבת להיות בדיוק הכתובת המקושרת. אחרת לא שולחים
//  (מייל שיצא לכתובת לא נכונה אי אפשר להחזיר). replyTo/from: כפי שהם מ-Gmail.
//  ⚠️ כותרת עם יותר מכתובת אחת — מסרבים: msg.reply עונה לכולן, ו-emAddr (שהקליטה
//  משתמשת בו) לוקח רק את האחרונה. שמות תצוגה בגרשיים מוסרים קודם (מותר בהם '@').
function emReplyOk(replyTo, from, linkedEmail) {
  var want = emAddr(linkedEmail);
  var hdr = String(String(replyTo || '').trim() ? replyTo : (from || ''));
  var bare = hdr.replace(/"(?:[^"\\]|\\.)*"/g, '');
  if ((bare.match(/@/g) || []).length !== 1) return false;
  if ((bare.match(/</g) || []).length > 1 || (bare.match(/>/g) || []).length > 1) return false;
  return !!want && emAddr(hdr) === want;
}
//  תקציב זמן. phase: 'intake' (נעצרים מוקדם כדי להשאיר מקום לתשובות),
//  'outbox-claim' (לא מחכירים פריטים שלא נספיק לשלוח), 'outbox-item'.
function emBudgetOk(phase, elapsedMs, maxMs) {
  var reserve = phase === 'intake' ? 60000 : (phase === 'outbox-claim' ? 30000 : 0);
  return Number(elapsedMs) <= Number(maxMs) - reserve;
}
//  מה עושים עם תשובת claim. 401/403 = הגדרות — עוצרים את שלב התשובות בריצה
//  הזו (בלי לספור כלום). כל כשל אחר — אין מה לשלוח עכשיו.
function emOutboxClaim(httpCode, body) {
  if (httpCode === 401 || httpCode === 403) return { stop: true, items: [] };
  if (httpCode === 200 && body && body.ok === true && Array.isArray(body.items)) {
    return { stop: false, items: body.items };
  }
  return { stop: false, items: [] };
}
//  אילו נכסי s_/u_ למחוק: ישנים מ-keepMs, או עם ערך לא תקין.
function emSentToPrune(all, now, keepMs) {
  var cut = now - keepMs;
  return Object.keys(all || {}).filter(function (k) {
    return (k.indexOf('s_') === 0 || k.indexOf('u_') === 0) && !(Number(all[k]) >= cut);
  });
}
// ── core end ──
