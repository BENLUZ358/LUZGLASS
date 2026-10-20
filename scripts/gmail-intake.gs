// ═══════════════════════════════════════════════════════════════════
//  סקריפט Gmail של Orderluz — רץ כל דקה ב-Google Apps Script.
//  מעלה מיילים עם קבצים מצורפים לשרת (POST /api/email-inbound).
//
//  הגדרות (Project Settings → Script Properties):
//    ENDPOINT         כתובת ה-API המלאה
//    TOKEN            הסוד המשותף עם השרת (לעולם לא נרשם ללוג)
//    START_AT         תאריך ISO — מיילים ישנים ממנו לא נקלטים
//    ALLOWED_SENDERS  רשימת כתובות מופרדת בפסיק. ריק = כולם
//    CHUNK_BYTES      גודל חתיכה, ברירת מחדל 3000000
//
//  ⚠️ "טופל" נשמר **לפי מייל** (handled ב-Script Properties) ולא לפי תווית:
//  Gmail מתייג שרשור שלם, ולקוח יכול לשלוח סקיצה חדשה בתשובה בשרשור ישן.
//  הנתון נגזם אחרי 4 ימים; ערך שאבד לא מזיק — השרת עונה done על מייל חוזר.
//  ⚠️ הקוד שבין core start ל-core end הוא העתק של gmail-intake-core.js —
//  לא עורכים כאן, עורכים שם ומעתיקים (הבדיקה נכשלת אם הם נפרדים).
//  הוראות התקנה: docs/gmail-intake-setup.md
// ═══════════════════════════════════════════════════════════════════

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
function emAddr(s) {
  var str = String(s || '');
  var m = str.match(/<([^<>]+)>/);
  return (m ? m[1] : str).trim().toLowerCase();
}

//  האם לטפל במייל הזה. msg: {id, from, date(ms)}; cfg: {START_AT, ALLOWED_SENDERS};
//  handled: {id: ts}. ⚠️ ההחלטה לפי מייל ולא לפי שרשור — לקוח עונה בשרשור ישן.
function emShouldTake(msg, cfg, handled) {
  cfg = cfg || {};
  if (handled && Object.prototype.hasOwnProperty.call(handled, msg.id)) return false;
  var start = cfg.START_AT ? new Date(cfg.START_AT).getTime() : NaN;
  if (!isNaN(start) && Number(msg.date) < start) return false;
  var allowed = String(cfg.ALLOWED_SENDERS || '').split(',')
    .map(emAddr).filter(function (a) { return a; });
  if (allowed.length && allowed.indexOf(emAddr(msg.from)) < 0) return false;
  return true;
}

//  התווית לפי מה שהשרת ענה. null = לנסות שוב בריצה הבאה.
//  'http-final' = השרת סירב (400/401/403) — ניסיון חוזר לא יעזור.
function emLabelFor(state) {
  if (state === 'done' || state === 'ignored' || state === 'closed') return 'LG/נקלט';
  if (state === 'rejected' || state === 'dead' || state === 'http-final') return 'LG/נכשל';
  return null;
}
// ── core end ──

// ─── הגדרות ───────────────────────────────────────────────────────
var EM_MAX_NEW = 10;                 // מיילים חדשים לכל היותר בריצה
var EM_MAX_MS = 4.5 * 60 * 1000;     // עוצרים לפני מגבלת 6 דקות של Google
var EM_KEEP_MS = 4 * 24 * 3600 * 1000;
var EM_MAX_PARTS = 20, EM_MAX_CHUNKS = 10;   // גבולות השרת

function emCfg() {
  var p = PropertiesService.getScriptProperties().getProperties();
  p.CHUNK_BYTES = Number(p.CHUNK_BYTES) > 0 ? Number(p.CHUNK_BYTES) : 3000000;
  return p;
}

function emLoadHandled() {
  var raw = PropertiesService.getScriptProperties().getProperty('handled');
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

function emSaveHandled(handled) {
  var cut = Date.now() - EM_KEEP_MS;
  Object.keys(handled).forEach(function (k) { if (handled[k] < cut) delete handled[k]; });
  PropertiesService.getScriptProperties().setProperty('handled', JSON.stringify(handled));
}

//  שליחה אחת. מחזיר {code, body}; code 0 = שגיאת רשת (ננסה שוב).
function emPost(cfg, payload) {
  try {
    var res = UrlFetchApp.fetch(cfg.ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var body = null;
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    return { code: res.getResponseCode(), body: body };
  } catch (e) {
    return { code: 0, body: null };
  }
}

function emLabel(thread, name) {
  var l = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  thread.addLabel(l);
}

//  מעבד מייל אחד. מחזיר 'נקלט' | 'נכשל' | 'ריק' | null (לנסות שוב בריצה הבאה).
//  ⚠️ שום Logger.log כאן לא כולל את הטוקן או תוכן קבצים.
function emProcess(msg, cfg, me) {
  var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(function (a) { return a.getSize() > 0; });
  if (!atts.length) return 'ריק';

  if (atts.length > EM_MAX_PARTS) {
    Logger.log('מייל ' + msg.getId() + ': יותר מ-' + EM_MAX_PARTS + ' קבצים');
    return 'נכשל';
  }
  var plans = atts.map(function (a) { return emPlanChunks(a.getSize(), cfg.CHUNK_BYTES); });
  if (plans.some(function (n) { return n > EM_MAX_CHUNKS; })) {
    Logger.log('מייל ' + msg.getId() + ': קובץ גדול מדי');
    return 'נכשל';
  }

  var parts = [];
  for (var i = 0; i < atts.length; i++) {
    var bytes = atts[i].getBytes();
    // ⚠️ מפצלים את הבייטים ואז מקודדים כל פרוסה — לא חותכים base64
    for (var c = 0; c < plans[i]; c++) {
      var slice = bytes.slice(c * cfg.CHUNK_BYTES, (c + 1) * cfg.CHUNK_BYTES);
      var r = emPost(cfg, {
        op: 'part', messageId: msg.getId(), idx: i, chunk: c, chunks: plans[i],
        data: Utilities.base64Encode(slice)
      });
      if (r.code === 400 || r.code === 401 || r.code === 403) {
        Logger.log('חתיכה נדחתה (' + r.code + ') במייל ' + msg.getId());
        return 'נכשל';
      }
      if (r.code !== 200) return null;
    }
    parts.push({ idx: i, name: atts[i].getName(), mime: atts[i].getContentType(),
                 size: atts[i].getSize(), chunks: plans[i] });
  }

  var r2 = emPost(cfg, {
    op: 'commit', messageId: msg.getId(), threadId: msg.getThread().getId(),
    from: msg.getFrom(), to: me, subject: msg.getSubject(),
    date: msg.getDate().getTime(), parts: parts
  });
  if (r2.code === 400 || r2.code === 401 || r2.code === 403) {
    Logger.log('commit נדחה (' + r2.code + ') במייל ' + msg.getId());
    return 'נכשל';
  }
  if (r2.code !== 200 || !r2.body) return null;
  var label = emLabelFor(r2.body.state);
  return label === 'LG/נקלט' ? 'נקלט' : label === 'LG/נכשל' ? 'נכשל' : null;
}

//  נקודת הכניסה — זה מה שהטריגר מפעיל כל דקה.
function emRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;   // ריצה קודמת עוד פעילה
  try {
    var cfg = emCfg();
    if (!cfg.ENDPOINT || !cfg.TOKEN) { Logger.log('חסרים ENDPOINT או TOKEN'); return; }
    // ⚠️ הכתובת של התיבה עצמה, לא כותרת To — לקוח עשוי לשלוח בעותק (Cc/Bcc)
    var me = Session.getEffectiveUser().getEmail();
    var handled = emLoadHandled();
    var started = Date.now(), taken = 0;

    var threads = GmailApp.search('in:inbox newer_than:3d');
    outer:
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        if (taken >= EM_MAX_NEW || Date.now() - started > EM_MAX_MS) break outer;
        var msg = msgs[m];
        var info = { id: msg.getId(), from: msg.getFrom(), date: msg.getDate().getTime() };
        // ⚠️ סינון שולחים לפני כל העלאה — מייל שלא נקלט לא נשלח לשרת בכלל
        if (!emShouldTake(info, cfg, handled)) continue;
        taken++;
        var res = emProcess(msg, cfg, me);
        if (res === null) continue;                 // ננסה שוב בריצה הבאה
        handled[info.id] = Date.now();
        if (res === 'נקלט') emLabel(threads[t], 'LG/נקלט');
        else if (res === 'נכשל') emLabel(threads[t], 'LG/נכשל');
        emSaveHandled(handled);                     // אחרי כל מייל — קריסה לא מאבדת
      }
    }
  } finally {
    lock.releaseLock();
  }
}
