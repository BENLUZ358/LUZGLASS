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
//      מקבל LG/נכשל עד שמישהו שם לב. לכן — לנסות שוב (emGiveUp עדיין עוצר
//      אחרי 20 ניסיונות / 60 שעות), ולעצור את הריצה: כל מייל אחר ייכשל באותו אופן.
//    200 not-allowed — השולח לא ברשימה בשרת: "טופל" **בלי תווית**. ⚠️ בשלב
//      הבדיקה מיילים של לקוחות אמיתיים לא נוגעים בהם (אפיון §3.6).
//    500 / רשת (0) / state לא סופי — שוב בריצה הבאה.
function emDecide(httpCode, body) {
  if (httpCode === 400) return { label: emLabelFor('http-final'), handled: true };
  if (httpCode === 401 || httpCode === 403) return { label: null, handled: false, stop: true };
  if (httpCode === 200 && body) {
    if (body.state === 'not-allowed') return { label: null, handled: true };
    var label = emLabelFor(body.state);
    return { label: label, handled: label !== null };
  }
  return { label: null, handled: false };
}
//  האם להפסיק לנסות מייל. retries = מספר הניסיונות עד כה (כולל הנוכחי),
//  ageMs = גיל המייל. 20 ניסיונות או 60 שעות (לפני שנופל מחלון 3 הימים).
function emGiveUp(retries, ageMs) {
  return Number(retries) >= 20 || Number(ageMs) > 60 * 3600 * 1000;
}
// ── core end ──
