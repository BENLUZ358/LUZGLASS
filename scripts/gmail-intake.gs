// ═══════════════════════════════════════════════════════════════════
//  סקריפט Gmail של Orderluz — רץ כל דקה ב-Google Apps Script.
//  מעלה מיילים לשרת (POST /api/email-inbound); מייל בלי קבצים נשלח עם
//  parts:[] והשרת מתייג אותו ignored.
//
//  הגדרות (Project Settings → Script Properties):
//    ENDPOINT         כתובת ה-API המלאה
//    TOKEN            הסוד המשותף עם השרת (לעולם לא נרשם ללוג)
//    START_AT         תאריך ISO — מיילים ישנים ממנו לא נקלטים
//    ALLOWED_SENDERS  רשימת כתובות מופרדת בפסיק. ריק = כולם
//    CHUNK_BYTES      גודל חתיכה, ברירת מחדל 3000000
//
//  ⚠️ "טופל" נשמר **לפי מייל** (מפתח h_<id> ב-Script Properties) ולא לפי
//  תווית: Gmail מתייג שרשור שלם, ולקוח יכול לשלוח סקיצה חדשה בתשובה בשרשור
//  ישן. נכס לכל מייל (נכס יחיד היה גולש ממגבלת 9KB); נגזם אחרי 4 ימים.
//  ערך שאבד לא מזיק — השרת עונה done על מייל חוזר.
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
  // ⚠️ מייל שהתיבה עצמה שלחה (תשובות, התראות) — לא סקיצה של לקוח
  if (cfg.ME && emAddr(msg.from) === emAddr(cfg.ME)) return false;
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
//  מה עושים עם תשובת השרת. label: התווית (null = בלי); handled: האם סופי.
//  400/401/403 סופיים — ניסיון חוזר לא יעזור. 500 / רשת (0) / state לא סופי — שוב.
function emDecide(httpCode, body) {
  if (httpCode === 400 || httpCode === 401 || httpCode === 403) {
    return { label: emLabelFor('http-final'), handled: true };
  }
  if (httpCode === 200 && body) {
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

// ─── הגדרות ───────────────────────────────────────────────────────
var EM_MAX_COMMITS = 10;              // מיילים לכל היותר בריצה (שלא נוסו קודם)
var EM_MAX_MS = 4.5 * 60 * 1000;      // עוצרים לפני מגבלת 6 דקות של Google
var EM_KEEP_MS = 4 * 24 * 3600 * 1000;
var EM_MAX_PARTS = 20, EM_MAX_CHUNKS = 10;   // גבולות השרת

function emCfg() {
  var p = PropertiesService.getScriptProperties().getProperties();
  p.CHUNK_BYTES = Number(p.CHUNK_BYTES) > 0 ? Number(p.CHUNK_BYTES) : 3000000;
  return p;
}

//  ⚠️ נכס לכל מייל: h_<id> = זמן הטיפול, r_<id> = JSON {n, at} (ניסיונות חוזרים
//  ומתי האחרון). מחזיר {handled:{id:ts}, retries:{id:n}} וגוזם h_ ו-r_ ישנים (4 ימים).
function emLoadState() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var cut = Date.now() - EM_KEEP_MS;
  var handled = {}, retries = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('h_') === 0) {
      if (Number(all[k]) < cut) props.deleteProperty(k);
      else handled[k.slice(2)] = Number(all[k]);
    } else if (k.indexOf('r_') === 0) {
      var r = {};
      try { r = JSON.parse(all[k]) || {}; } catch (e) {}
      if (!(Number(r.at) >= cut)) props.deleteProperty(k);
      else retries[k.slice(2)] = Number(r.n) || 0;
    }
  });
  return { handled: handled, retries: retries };
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

//  מעבד מייל אחד. מחזיר {label, handled} כמו emDecide.
//  ⚠️ מייל בלי קבצים נשלח עם parts:[] — השרת עונה ignored והמייל מתויג.
//  ⚠️ שום Logger.log כאן לא כולל את הטוקן או תוכן קבצים.
function emProcess(msg, cfg, me) {
  var id = msg.getId();
  var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(function (a) { return a.getSize() > 0; });
  var fail = emDecide(400, null);

  if (atts.length > EM_MAX_PARTS) {
    Logger.log('מייל ' + id + ': יותר מ-' + EM_MAX_PARTS + ' קבצים');
    return fail;
  }
  var plans = atts.map(function (a) { return emPlanChunks(a.getSize(), cfg.CHUNK_BYTES); });
  if (plans.some(function (n) { return n > EM_MAX_CHUNKS; })) {
    Logger.log('מייל ' + id + ': קובץ גדול מדי');
    return fail;
  }

  var parts = [];
  for (var i = 0; i < atts.length; i++) {
    var bytes = atts[i].getBytes();
    // ⚠️ מפצלים את הבייטים ואז מקודדים כל פרוסה — לא חותכים base64
    for (var c = 0; c < plans[i]; c++) {
      var slice = bytes.slice(c * cfg.CHUNK_BYTES, (c + 1) * cfg.CHUNK_BYTES);
      var r = emPost(cfg, {
        op: 'part', messageId: id, idx: i, chunk: c, chunks: plans[i],
        data: Utilities.base64Encode(slice)
      });
      if (r.code !== 200) {
        var d = emDecide(r.code, null);
        if (d.handled) Logger.log('חתיכה נדחתה (' + r.code + ') במייל ' + id);
        return d;
      }
    }
    parts.push({ idx: i, name: atts[i].getName(), mime: atts[i].getContentType(),
                 size: atts[i].getSize(), chunks: plans[i] });
  }

  var r2 = emPost(cfg, {
    op: 'commit', messageId: id, threadId: msg.getThread().getId(),
    from: msg.getFrom(), to: me, subject: msg.getSubject(),
    date: msg.getDate().getTime(), parts: parts
  });
  var d2 = emDecide(r2.code, r2.body);
  if (d2.handled && r2.code !== 200) Logger.log('commit נדחה (' + r2.code + ') במייל ' + id);
  return d2;
}

//  ניסיון שלא הסתיים: סופרים, ואם הגענו לתקרה — נכשל סופית.
//  מחזיר {label, handled}; handled=false = נשאר לריצה הבאה.
function emRetry(it, st, props) {
  var mid = it.info.id;
  var n = (st.retries[mid] || 0) + 1;
  st.retries[mid] = n;
  if (emGiveUp(n, Date.now() - it.info.date)) {
    Logger.log('מייל ' + mid + ': נכשל אחרי ' + n + ' ניסיונות');
    return emDecide(400, null);
  }
  props.setProperty('r_' + mid, JSON.stringify({ n: n, at: Date.now() }));
  return { label: null, handled: false };
}

//  מייל סופי: תווית, סימון "טופל", ניקוי מונה.
function emFinish(it, res, props) {
  if (res.label) emLabel(it.thread, res.label);
  props.setProperty('h_' + it.info.id, String(Date.now()));
  props.deleteProperty('r_' + it.info.id);
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
    cfg.ME = me;
    var st = emLoadState();
    var props = PropertiesService.getScriptProperties();
    var started = Date.now();

    // ⚠️ קריאה אחת לכל השרשורים (מכסת Gmail), ומסננים "טופל" לפני כל getter אחר
    var threads = GmailApp.search('in:inbox newer_than:3d');
    var groups = GmailApp.getMessagesForThreads(threads);
    var fresh = [], again = [];
    for (var t = 0; t < groups.length; t++) {
      for (var m = 0; m < groups[t].length; m++) {
        var msg = groups[t][m];
        var id = msg.getId();
        if (Object.prototype.hasOwnProperty.call(st.handled, id)) continue;
        var info = { id: id, from: msg.getFrom(), date: msg.getDate().getTime() };
        if (!emShouldTake(info, cfg, st.handled)) continue;
        // ⚠️ מיילים שעוד לא נוסו קודם — אחרת "תקועים" אוכלים את המכסה לנצח
        var item = { msg: msg, thread: threads[t], info: info };
        (st.retries[id] === undefined ? fresh : again).push(item);
      }
    }

    var queue = fresh.concat(again);
    for (var q = 0; q < queue.length && q < EM_MAX_COMMITS; q++) {
      if (Date.now() - started > EM_MAX_MS) break;
      var it = queue[q], mid = it.info.id;
      try {
        var res = emProcess(it.msg, cfg, me);
        if (!res.handled) res = emRetry(it, st, props);
        if (res.handled) emFinish(it, res, props);
      } catch (e) {
        // ⚠️ שם השגיאה בלבד — ההודעה עלולה לכלול תוכן
        Logger.log('מייל ' + mid + ': חריגה ' + (e && e.name));
        // ⚠️ חריגה נספרת כניסיון — אחרת המייל נשאר "חדש" לנצח וחוסם את המכסה
        try {
          var res2 = emRetry(it, st, props);
          if (res2.handled) emFinish(it, res2, props);
        } catch (e2) {
          Logger.log('מייל ' + mid + ': גם הספירה נכשלה ' + (e2 && e2.name));
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}
