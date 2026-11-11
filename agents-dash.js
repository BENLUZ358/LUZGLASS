// ═══════════════════════════════════════════════════════════════════
//  agents-dash.js — לוח הבקרה לסוכנים (agents.html) והמונה בתפריט של admin.
//
//  לוגיקה טהורה בלבד: מקבלת את מה שנקרא מ-waMeta/* ומחזירה רשימות, ספירות
//  ו-HTML. אין כאן קריאה ל-Firebase ואין כתיבה — הדף קורא, והכתיבה עוברת
//  דרך /api/wa-inbound-drain (agent-verdict / agent-pilot / agent-dismiss).
//  נבדק ב-Node: scripts/test-agents-dash.js, scripts/test-agent-panel.js.
//
//  עד 31/10 החלק של "שורת יומן" ישב ב-wa-inbound-panel.js (לשונית "סוכנים ·
//  ניסיון" בקליטות). הלשונית עברה לדף הזה, והפונקציות איתה.
//  אפיון: docs/superpowers/specs/2026-10-31-agents-dashboard-design.md
// ═══════════════════════════════════════════════════════════════════

function _adEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _adWhen(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric',
      year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}

// ─── לשונית "סוכנים · ניסיון" (30/10) ────────────────────────────────────
//  מה המרכזן החליט על כל הודעה נכנסת ומה עוקב היה עונה. מצב צל: שום דבר
//  לא נשלח ללקוח. הקריאה מ-waMeta/agentShadow; הסימון ✓/✗ עובר דרך
//  /api/wa-inbound-drain (agent-verdict) — הפאנל לא כותב ל-Firebase.
const LG_AG_INTENT = { status: 'איפה ההזמנה', cancel: 'ביטול', change: 'שינוי', document: 'מסמך', quote: 'הצעת מחיר', price: 'טענת מחיר',
  order: 'הזמנה', chitchat: 'שיחה', thanks: 'תודה', unclear: 'לא ברור' };
const LG_AG_ROUTE = { okev: 'עוקב', kolet: 'קולט', archive: 'ארכיון', quote: 'מחירון', price: 'מחירון — טענת מחיר', menu: 'תפריט', none: 'בלי תשובה',
  ignore: 'מתעלם', shaul: 'שאלה לבן', 'silent-human': 'שותק (ענו ידנית)', 'kolet-deleted': 'קולט — סקיצה נמחקה' };
function lgAgIntentLabel(i) { return LG_AG_INTENT[i] || String(i == null ? '' : i); }
function lgAgRouteLabel(r) { return LG_AG_ROUTE[r] || String(r == null ? '' : r); }
//  שלב 2: כמה לקוחות בפיילוט
function lgAgPilotCount(pilot) {
  return Object.keys(pilot || {}).filter(k => pilot[k] === true).length;
}
//  תיקון סופי 6: לקוחות בפיילוט — רשימה קטנה בראש הלשונית, כדי שאפשר יהיה להוציא
//  לקוח גם כשאין לו שורה ב-100 האחרונות. nameOf(id) → שם; אין → המזהה. escaped.
function lgAgPilotListHtml(pilot, nameOf) {
  const ids = Object.keys(pilot || {}).filter(k => pilot[k] === true).sort();
  if (!ids.length) return '';
  const e = _adEsc;
  return '<div class="wain-note"><b>לקוחות בפיילוט</b>' + ids.map(id => {
    const n = String((nameOf && nameOf(id)) || '') || id;
    return `<div class="wain-l1"><span class="wain-client">${e(n)}</span>
          <button type="button" class="wain-btn" data-agpilot data-cid="${e(id)}" data-on="0">הוצא מפיילוט</button></div>`;
  }).join('') + '</div>';
}
//  'no-action' = לסוכן אין מה לעשות; ריק — שורת "מה קורה" כבר אומרת את זה
const LG_AG_WHY = { 'not-pilot': 'לא נשלח — הלקוח לא בפיילוט', 'not-linked': 'לא מקושר בקליטות', off: 'מתג כבוי', 'switches-off': 'מתג כבוי', 'no-staff': 'אין מספר של שאול', error: 'שגיאה', 'no-action': '' };
//  "מה קורה" בשורת היומן — משפט במקום שם המסלול (בן, 31/10)
const LG_AG_OUTCOME = { okev: 'עוקב עונה ללקוח', quote: 'מחירון מטפל בבקשת המחיר', price: 'מחירון בודק את המחיר ומעביר לשאול', archive: 'ארכיון שולח את המסמך',
  kolet: 'נכנסה לתור הסקיצות כרגיל — אין צורך לענות', 'kolet-deleted': 'קולט בודק אם לבטל את הסקיצה',
  menu: 'שולח ללקוח את התפריט', none: 'לא צריך לענות', ignore: 'לא צריך לענות',
  shaul: 'הסוכן לא יודע — שואל אותך בחדר הסוכנים', 'silent-human': 'לא עונה — מישהו מכם כבר ענה בשעתיים האחרונות' };
//  מה הלקוח שלח, במילים
function lgAgSentText(r) {
  if (r.deleted) return 'מחק הודעה';
  if (!r.linked && !r.text) return 'מספר שלא מקושר לאף לקוח — התוכן לא נשמר';
  if (r.hasImage) return r.text ? 'שלח תמונה: ' + r.text : 'שלח תמונה';
  return r.text ? 'כתב: ' + r.text : 'שלח הודעה בלי טקסט';
}
function lgAgOutcome(r) {
  if (!r.linked) return 'לא עונים למספר לא מקושר — רק נספר בסיכום';
  return LG_AG_OUTCOME[r.route] || lgAgRouteLabel(r.route);
}
const LG_AG_STATE = { received: 'ממתין', processing: 'בעיבוד', failed: 'נכשל', dead: 'נכשלה סופית — המערכת הפסיקה לנסות' };
const LG_AG_OB = { sent: 'נשלח ✓', pending: 'בתור', blocked: 'נחסם', failed: 'נכשל' };
//  רשומות התור של שורה: <key>_<i>, <key>_<i>_s או <key>_<i>_f<j> (קובץ לכל רשומה; מפתח מנוקה כמו בשרת)
function lgAgOutboxOf(key, outbox) {
  const pre = String(key).replace(/[.#$[\]/]/g, '_') + '_', m = outbox || {};
  return Object.keys(m).filter(k => k.indexOf(pre) === 0 && /^\d+(_s|_b|_f\d+)?$/.test(k.slice(pre.length))).sort()
    .map(k => m[k]).filter(Boolean);
}
//  מה נעשה בפועל / מה היה נעשה — שורה אחת או יותר, הכל escaped
function lgAgActHtml(r, c) {
  const e = _adEsc;
  if (r.state && r.state !== 'done') return `<div class="wain-reason">${e(LG_AG_STATE[r.state] || r.state)}</div>`;
  if (r.acted) {
    const ob = lgAgOutboxOf(r._key, c.outbox);
    if (!ob.length) return '<div class="wain-reason">בוצע</div>';
    return ob.map(o => {
      const who = o.reason === 'agent-staff' ? 'לשאול' : o.reason === 'agent-ask' ? 'לבן' : '';
      const st = LG_AG_OB[o.state] || String(o.state || '');
      return o.state === 'sent'
        ? `<div class="wain-ag-r">${who ? who + ' ✓' : st}: ${e(o.text || '')}</div>`
        : `<div class="wain-reason">${who ? e(who) + ' · ' : ''}${e(st)}</div>`;
    }).join('');
  }
  const would = r.wouldReply || ((r.wouldAct || []).filter(a => a && a.text).map(a => a.text)[0]) || '';
  const why = !r.actReason ? '' : Object.prototype.hasOwnProperty.call(LG_AG_WHY, r.actReason) ? LG_AG_WHY[r.actReason] : r.actReason;
  return (would ? `<div class="wain-ag-r">היה עונה: ${e(would)}</div>` : '')
    + (why ? `<div class="wain-reason">${e(why)}</div>` : '');
}
//  100 האחרונות, חדש למעלה
function lgAgRows(map) {
  const m = map || {};
  return Object.keys(m).map(k => Object.assign({ key: k }, m[k]))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100);
}
//  האם ההודעה באמת נקלטה בתור (waInbound באותו מפתח, ולא נדחתה)?
//  ⚠️ intakeKind לבד לא מספיק — טקסט חופשי שהקליטה זרקה, או PDF שנדחה, לא נקלטו.
//  המפתח — אותו ניקוי כמו lgWaInboundKey בשרת.
function lgAgIntakeTaken(key, r, intake) {
  const m = intake || {};
  const ik = r.idMessage ? String(r.idMessage).replace(/[.#$[\]/]/g, '_') : key;
  const x = Object.prototype.hasOwnProperty.call(m, ik) ? m[ik] : null;
  if (!x) return false;
  return x.state !== 'rejected' && !(x.state === 'closed' && x.closedFrom === 'rejected');
}
//  intake — waInbound הגולמי (raw.whatsapp בפאנל)
function lgAgRowHtml(key, r, intake, c) {
  const k = _adEsc(key);
  const cc = c || {};
  const pilotOn = !!(r.customerId && (cc.pilot || {})[r.customerId] === true);
  //  פיילוט רק לצ'אט שמקושר כמו שהשליחה בודקת (קבוצה / מספר בקליטות) — לא רשימת Vercel
  const pilotBtn = r.linked && r.customerId && (r.linkVia === 'group' || r.linkVia === 'sender')
    ? `<button type="button" class="wain-btn" data-agpilot data-cid="${_adEsc(r.customerId)}" data-on="${pilotOn ? 0 : 1}">${pilotOn ? 'בפיילוט — הוצא' : 'הכנס לפיילוט'}</button>` : '';
  //  הודעה שהסוכן לא ראה כהזמנה אבל נקלטה כהזמנה — בן צריך לראות את זה
  const both = r.intent !== 'order' && lgAgIntakeTaken(key, r, intake)
    ? ' <span class="wain-ag-red">נקלטה גם כהזמנה</span>' : '';
  const v = r.verdict ? (r.verdict.ok ? 'נכון ✓' : 'לא נכון ✗') : '';
  return `<div class="wain-row wain-ag" data-agkey="${k}">
        <div class="wain-l1"><span class="wain-client">${r.linked ? _adEsc(r.customerName || '') : 'לא מקושר'}</span>
          <span class="wain-when">${_adEsc(_adWhen(r.createdAt))}</span></div>
        <div class="wain-ag-t">${_adEsc(lgAgSentText(r))}</div>
        ${r.intent ? `<div class="wain-reason">הסוכן הבין: <b>${_adEsc(lgAgIntentLabel(r.intent))}</b></div>` : ''}
        <div class="wain-reason">מה קורה: ${_adEsc(lgAgOutcome(r))}${both}</div>
        ${lgAgActHtml(Object.assign({ _key: key }, r), cc)}
        <div class="wain-acts">
          ${pilotBtn}
          <button type="button" class="wain-btn" data-agv="1" data-key="${k}" aria-label="הסוכן הבין נכון">✓ הבין נכון</button>
          <button type="button" class="wain-btn" data-agv="0" data-key="${k}" aria-label="הסוכן טעה">✗ טעה</button>
          ${v ? `<span class="wain-chip">${v}</span>` : ''}
        </div>
      </div>`;
}

// ─── יומן פשוט (בן, 31/10: "קצת מסובך למשתמש") ─────────────────────────
//  ביומן מוצגות רק הודעות שיש מה לבדוק בהן — הסוכן היה עונה ללקוח או מעביר
//  לשאול — וכל אחת כשאלה אחת "זה נכון?". השאר (תמונה שנכנסת לתור כרגיל, מספר
//  לא מקושר, מישהו כבר ענה, אין מה לענות) — שורה קצרה במקטע מקופל.
const AD_REVIEW_ROUTES = ['okev', 'quote', 'price', 'archive', 'menu', 'shaul', 'kolet-deleted'];
function _adWould(r) {
  return String(r.wouldReply || ((Array.isArray(r.wouldAct) ? r.wouldAct : []).filter(a => a && a.text && a.type !== 'staff' && a.type !== 'quote-ask').map(a => a.text)[0]) || '');
}
const _adToShaul = r => (Array.isArray(r.wouldAct) ? r.wouldAct : []).some(a => a && (a.type === 'staff' || a.type === 'quote-ask'));
//  "לא יודע → בן" (חדר הסוכנים, 10/11)
const _adToBen = r => r.route === 'shaul' || (Array.isArray(r.wouldAct) ? r.wouldAct : []).some(a => a && a.type === 'ask');
function lgAdNeedsReview(r) {
  if (!r || r.linked !== true || r.state !== 'done') return false;
  return AD_REVIEW_ROUTES.includes(r.route) || !!_adWould(r) || _adToShaul(r) || _adToBen(r);
}
//  היומן בשלושה חלקים (בן, 8/11): todo — עוד לא סומנו; marked — כבר סימנת
//  (יוצאות מהרשימה, נשארות במקטע מקופל כדי שאפשר לשנות); other — אין מה לבדוק.
//  כשמסננים לפי סימון (✓/✗) — מה שסומן הוא מה שמחפשים, אז הוא נשאר ברשימה.
function lgAdSplitLog(rows, verdictFilter) {
  const byMark = verdictFilter === 'ok' || verdictFilter === 'wrong';
  const todo = [], marked = [], other = [];
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!lgAdNeedsReview(r)) other.push(r);
    else if (r.verdict && !byMark) marked.push(r);
    else todo.push(r);
  });
  return { todo, marked, other };
}
function lgAdReviewRowHtml(key, r, intake, c) {
  const k = _adEsc(key), would = _adWould(r);
  const sent = lgAgOutboxOf(key, (c || {}).outbox).filter(o => o.state === 'sent' && o.reason !== 'agent-staff' && o.reason !== 'agent-ask').map(o => o.text)[0];
  const what = sent ? `<div class="wain-ag-r">נשלח ללקוח: ${_adEsc(sent)}</div>`
    : would ? `<div class="wain-ag-r">הסוכן היה עונה: ${_adEsc(would)}</div>`
    : _adToShaul(r) ? '<div class="wain-ag-r">הסוכן היה מעביר לשאול</div>'
    : _adToBen(r) ? '<div class="wain-ag-r">הסוכן היה שואל אותך בחדר הסוכנים</div>'
    : `<div class="wain-ag-r">${_adEsc(lgAgOutcome(r))}</div>`;
  const both = r.intent !== 'order' && lgAgIntakeTaken(key, r, intake) ? '<div class="wain-ag-red">נקלטה גם כהזמנה</div>' : '';
  const v = r.verdict ? `<span class="wain-chip">סימנת: ${r.verdict.ok ? 'נכון ✓' : 'לא נכון ✗'}</span>` : '';
  return `<div class="wain-row wain-ag" data-agkey="${k}">
        <div class="wain-l1"><span class="wain-client">${_adEsc(r.customerName || '')}</span>
          <span class="wain-when">${_adEsc(_adWhen(r.createdAt))}</span></div>
        <div class="wain-ag-t">${_adEsc(lgAgSentText(r))}</div>
        ${what}${both}
        <div class="wain-acts"><b class="wain-q">זה נכון?</b>
          <button type="button" class="wain-btn" data-agv="1" data-key="${k}">כן</button>
          <button type="button" class="wain-btn" data-agv="0" data-key="${k}">לא</button>
          ${v}
        </div>
      </div>`;
}
//  שורה קצרה, בלי כפתורים: מי · מה שלח · מה קורה
function lgAdOtherRowHtml(r) {
  const x = r || {};
  return `<div class="ad-other"><b>${x.linked ? _adEsc(x.customerName || '') : 'לא מקושר'}</b> · ${_adEsc(lgAgSentText(x))}
        <small>${_adEsc(lgAgOutcome(x))} · ${_adEsc(_adWhen(x.createdAt))}</small></div>`;
}


// ─── לוח הבקרה (31/10) ──────────────────────────────────────────────
const _AD_H = 60 * 60 * 1000, _AD_D = 24 * _AD_H;
const AD_QUOTE_RED_MS = 3 * _AD_H;        // כמו STUCK_MS בסיכום היומי
const AD_RECENT_MS = 7 * _AD_D;           // חריגים מתוך היומן — 7 ימים אחרונים
const AD_DEAD_ATTEMPTS = 3;               // כמו MAX_ATTEMPTS בשרת: פחות מזה המערכת עוד מנסה לבד
const _adVals = m => Object.keys(m || {}).filter(k => m[k] && typeof m[k] === 'object').map(k => ({ key: k, v: m[k] }));

//  תחילת התקופה. 'today' = חצות בשעון ישראל, לא 24 שעות אחורה.
function lgAdPeriodStart(period, now) {
  const t = Number(now) || Date.now();
  if (period === '7d') return t - 7 * _AD_D;
  if (period === '30d') return t - 30 * _AD_D;
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
  const sinceMidnight = ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (t % 1000);
  return t - sinceMidnight;
}

//  ספירות מ-from ואילך. ההגדרות של נכנסו / נסגרו לבד / לשאול / לא מקושרים —
//  כמו lgAgentDailySummary (api/_agent-daily.js): הודעות צוות לא נספרות,
//  "לשאול" = wouldAct עם staff או quote-ask. ההבדל: הסיכום סופר רק acted, כי הוא
//  נשלח רק כשהסוכנים עונים. במצב שקט אף רשומה לא acted, ולכן כאן נספרת כל
//  רשומה שהוחלט עליה (state done) — "היה נסגר לבד" / "היה עובר לשאול".
//  מספר לא מקושר רק נספר (לא נשלח לשאול), כמו בסיכום.
function lgAdCounts(shadow, quotes, cancels, from) {
  const f = Number(from) || 0;
  const rs = _adVals(shadow).map(r => r.v).filter(r => (r.createdAt || 0) >= f && r.staff !== true && r.route !== 'staff');
  const acts = r => Array.isArray(r.wouldAct) ? r.wouldAct : [];
  const isShaul = r => acts(r).some(a => a && (a.type === 'staff' || a.type === 'quote-ask'));
  const acted = rs.filter(r => r.linked !== false && (r.acted === true || r.state === 'done'));
  const ok = rs.filter(r => r.verdict && r.verdict.ok === true).length;
  const wrong = rs.filter(r => r.verdict && r.verdict.ok === false).length;
  const byRoute = {};
  rs.forEach(r => { if (r.route) byRoute[r.route] = (byRoute[r.route] || 0) + 1; });
  return {
    incoming: rs.length,
    selfClosed: acted.filter(r => r.route !== 'shaul' && !isShaul(r)).length,
    toShaul: acted.filter(isShaul).length,
    quotes: _adVals(quotes).filter(r => (r.v.at || 0) >= f).length,
    cancels: _adVals(cancels).filter(r => (r.v.at || 0) >= f).length,
    unlinked: rs.filter(r => r.linked === false).length,
    ok, wrong, unmarked: rs.length - ok - wrong,
    accuracy: ok + wrong ? Math.round(100 * ok / (ok + wrong)) : null,
    byRoute,
  };
}

//  "דורש טיפול". ver = מתי הרשומה השתנתה לאחרונה; "טופל" שומר אותו, ואם
//  הרשומה השתנתה מאז — הכרטיס חוזר (waMeta/agentDash/dismissed/<kind>_<key>).
//  להצעת מחיר אין updatedAt: waiting → relaying כותב relayAt, ולכן הוא ה-ver.
//  ביטול לא מוסתר לעולם: הוא נסגר רק ב"בוצע בחשבשבת" בתיקון הזמנות — הסתרה
//  הייתה משאירה הזמנה מבוטלת פתוחה בחשבשבת (סקירה, 31/10).
const AD_UNDISMISSABLE = ['cancel'];
function lgAdExceptions(d, now) {
  const t = Number(now) || Date.now(), x = d || {}, dis = x.dismissed || {}, out = [];
  const add = (kind, key, r, at, title, extra) => {
    const ver = Number(r.updatedAt || r.relayAt || r.at || r.createdAt) || 0;
    const dismissable = !AD_UNDISMISSABLE.includes(kind);
    const h = dis[kind + '_' + key];
    if (dismissable && h && Number(h.ver) === ver) return;
    out.push(Object.assign({ kind, key: String(key), at: Number(at) || 0, ver, title, dismissable,
      customerName: String(r.customerName || (r.order && (r.order.orderClient || r.order.client)) || ''),
      phone: '', detail: '', red: false, link: '' }, extra || {}));
  };
  const phoneOf = r => (!r.groupId && r.sender) ? String(r.sender) : '';
  _adVals(x.quotes).forEach(({ key, v }) => {
    if (v.state !== 'waiting' && v.state !== 'relaying') return;
    add('quote', key, v, v.at, 'הצעת מחיר מחכה לשאול', { red: !!v.at && t - v.at > AD_QUOTE_RED_MS, detail: String(v.text || '') });
  });
  _adVals(x.cancels).forEach(({ key, v }) => {
    if (v.confirmed !== true || v.hsSent !== true || v.done) return;
    add('cancel', key, v, v.at, 'ביטול שמחכה לחשבשבת', { link: 'hs-corrections.html',
      detail: 'הזמנה ' + String((v.order && v.order.orderNum) || key) });
  });
  _adVals(x.outbox).forEach(({ key, v }) => {
    if (v.state !== 'blocked' && v.state !== 'failed') return;
    if (t - (v.updatedAt || 0) > AD_RECENT_MS) return;
    add('send', key, v, v.updatedAt, 'הודעה שלא נשלחה', { detail: String(v.text || '') });
  });
  _adVals(x.shadow).forEach(({ key, v }) => {
    const at = v.createdAt || 0;
    if (v.state === 'dead' || (v.state === 'failed' && (v.attempts || 0) >= AD_DEAD_ATTEMPTS)) {
      add('dead', key, v, at, 'הודעה שהמערכת לא הצליחה לעבד', { detail: String(v.reason || v.lastError || ''), phone: phoneOf(v) });
      return;
    }
    if (t - at > AD_RECENT_MS) return;
    if (v.linked === true && v.intent === 'unclear')
      add('unclear', key, v, at, 'הסוכן לא הבין', { detail: String(v.text || ''), phone: phoneOf(v) });
    if (v.verdict && v.verdict.ok === false)
      add('wrong', key, v, at, 'סומן ✗', { detail: String(v.text || ''), phone: phoneOf(v) });
  });
  return out.sort((a, b) => b.at - a.at);
}

//  יומן — מ-from, החדש למעלה. f: { route, q (שם לקוח), verdict: all|none|ok|wrong }
function lgAdLogRows(shadow, f, from) {
  const o = f || {}, q = String(o.q || '').trim();
  return _adVals(shadow).map(r => Object.assign({ key: r.key }, r.v))
    .filter(r => (r.createdAt || 0) >= (Number(from) || 0))
    .filter(r => !o.route || r.route === o.route)
    .filter(r => !q || String(r.customerName || '').includes(q))
    .filter(r => !o.verdict || o.verdict === 'all'
      || (o.verdict === 'none' ? !r.verdict : !!r.verdict && r.verdict.ok === (o.verdict === 'ok')))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

//  מצב כללי מהבוליאנים של agent-status. המתגים משותפים לכל הסוכנים.
function lgAdMode(st) {
  const s = st || {};
  const mode = s.shadow !== true ? 'off' : s.reply === true ? 'live' : 'shadow';
  const problems = [];
  if (s.shadow === true) {
    if (!s.key) problems.push('אין מפתח OpenAI — הסוכנים לא מבינים הודעות');
    if (!s.model) problems.push('לא הוגדר מודל (AGENT_MODEL) — הסוכנים לא מבינים הודעות');
    if (!s.staff) problems.push('לא הוגדר המספר של שאול — אין למי להעביר');
    if (!s.cron) problems.push('חסר CRON_SECRET — הבדיקה היומית לא רצה');
    if (s.reply === true && !s.summary) problems.push('לא הוגדר למי לשלוח את הסיכום היומי');
  }
  return { mode, problems };
}

function lgAdWaLink(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return 'https://wa.me/972' + d.slice(1);
  if (/^9725\d{8}$/.test(d)) return 'https://wa.me/' + d;
  return '';
}

//  ששת הסוכנים — id = המפתח בשרת (waMeta/agentConfig, api/_agent-config.js).
//  does — "מי אחראי על מה" באפיון חדר הסוכנים (10/11). routes: אילו מסלולים ביומן שייכים לו.
//  heb — השם שסוכנים ישנים כותבים בחדר (agent:'מרכזן').
const LG_AD_AGENTS = [
  //  ⚠️ (תיקון סקירה 10/11) רק מה שהמתג הזה שולט בו. "נקלטו" והצעת צרופות — מתגים נפרדים.
  { id: 'markazan', name: 'מרכזן', does: 'תפריט ללקוח, ומה שאף סוכן לא יודע — שאלה אליך ("נקלטו" והצעת צרופות — לא במתג הזה)', routes: ['menu', 'shaul'] },
  { id: 'kolet', name: 'קולט', does: 'מתור הסקיצות עד "השרטט סיים", וסקיצה שהלקוח מחק', routes: ['kolet', 'kolet-deleted'] },
  { id: 'archive', name: 'ארכיון', does: 'חשבוניות, והעתק חשבונית או סקיצה ללקוח', routes: ['archive'] },
  { id: 'okev', name: 'עוקב', does: '"איפה ההזמנה" ללקוח, ביטול ושינוי לפני ייצור', routes: ['okev'] },
  { id: 'price', name: 'מחירון', does: 'מחירים, הצעות מחיר וטענות מחיר', routes: ['quote', 'price'] },
  { id: 'manager', name: 'מנהל', does: 'סיכום יומי מכולם — בחדר, ובוואטסאפ כשהוא "עונה"', routes: [] },
];
const LG_AD_MODES = [['off', 'כבוי'], ['shadow', 'שקט'], ['reply', 'עונה']];

// ─── חדר הסוכנים (בן, 10/11) ──────────────────────────────────────────
//  waMeta/agentRoom: info (אפור) | ask (צהוב; state open/answered = שאלה לבן) |
//  answer (תשובת בן, בצד שלו) | summary (המנהל — מוצמד למעלה, לא ברשימה).
//  ⚠️ ask בלי state = הצעת צרופה בתור — לא שאלה לבן, מוצגת כמו info.
function lgRoomAgentKey(a) {
  const s = String(a == null ? '' : a);
  const hit = LG_AD_AGENTS.find(x => x.id === s || x.name === s);
  return hit ? hit.id : s;
}
function lgRoomAgentName(a) {
  const hit = LG_AD_AGENTS.find(x => x.id === lgRoomAgentKey(a));
  return hit ? hit.name : (String(a || '') || 'סוכן');
}
const lgRoomIsQuestion = e => !!e && e.kind === 'ask' && (e.state === 'open' || e.state === 'answered');
function lgRoomOpenCount(room) {
  return _adVals(room).filter(r => r.v.kind === 'ask' && r.v.state === 'open').length;
}
//  waMeta/agentRoomOpen — אינדקס השאלות הפתוחות בשרת (תיקון סקירה 10/11). המונה בתפריט ובחדר
function lgRoomOpenIndexCount(idx) {
  return _adVals(idx).filter(r => r.v && typeof r.v === 'object').length;
}
//  שאלות פתוחות מהאינדקס שלא בחלון האירועים שנטען — המפתחות שצריך להביא בנפרד
function lgRoomMissingOpen(idx, room) {
  const r = room || {};
  return _adVals(idx).map(x => x.key).filter(k => !Object.prototype.hasOwnProperty.call(r, k));
}
//  התשובה בתור נגמרה בלי לצאת (נחסמה / פגה / נכשלה 3 פעמים — MAX_ATTEMPTS ב-_wa-outbox.js)
const lgRoomSendFinal = o => !!o && (o.state === 'blocked' || o.state === 'expired' || (o.state === 'failed' && (Number(o.attempts) || 0) >= 3));
//  אפשר לענות: שאלה פתוחה, או שנענתה והתשובה לא יצאה ("שלח שוב")
//  שאלה פנימית (בדיקות הדופק, _agent-watch — שלב ב׳ 10/11): אין לקוח לענות לו; נסגרת לבד כשתוקן
const lgRoomIsInternal = e => lgRoomIsQuestion(e) && e.internal === true;
function lgRoomCanAnswer(e, outbox) {
  if (!lgRoomIsQuestion(e) || lgRoomIsInternal(e)) return false;
  if (e.state === 'open') return true;
  return !!e.outboxKey && lgRoomSendFinal((outbox || {})[e.outboxKey]);
}
//  החדר — הישן למעלה, החדש למטה (צ'אט). o: { agent (מפתח), limit }
function lgRoomRows(room, o) {
  const f = o || {}, lim = Number(f.limit) || 200;
  const rows = _adVals(room).map(r => Object.assign({ key: r.key }, r.v))
    .filter(r => r.kind !== 'summary')
    .filter(r => !f.agent || lgRoomAgentKey(r.agent) === f.agent)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.slice(Math.max(0, rows.length - lim));
}
function lgRoomLatestSummary(room) {
  const s = _adVals(room).filter(r => r.v.kind === 'summary').sort((a, b) => (Number(b.v.at) || 0) - (Number(a.v.at) || 0))[0];
  return s ? Object.assign({ key: s.key }, s.v) : null;
}
const LG_ROOM_OB = { sent: 'נשלח ✓', pending: 'בתור', failed: 'נכשל — המערכת תנסה שוב', expired: 'פג' };
//  בועה אחת. outbox — waMeta/agentOutbox (למצב השליחה של תשובת בן)
function lgRoomBubbleHtml(e, outbox) {
  const x = e || {}, esc = _adEsc;
  const head = `<div class="rb-h"><b>${esc(x.kind === 'answer' ? 'אתה' : lgRoomAgentName(x.agent))}</b><span>${esc(_adWhen(x.at))}</span></div>`;
  if (lgRoomIsQuestion(x)) {
    const open = x.state === 'open', retry = !open && lgRoomCanAnswer(x, outbox);
    const lost = retry ? (outbox || {})[x.outboxKey] : null;
    return `<div class="rb rb-ask${open || retry ? ' is-open' : ''}" data-roomkey="${esc(x.key)}">${head}
      <div class="rb-who">${esc(x.customerName || 'לקוח')}${x.note ? ' · ' + esc(x.note) : ''}</div>
      <div class="rb-q">${esc(x.question || x.text || '')}</div>
      ${x.suggest ? `<div class="rb-s">הצעה: ${esc(x.suggest)}</div>` : ''}
      ${x.proposal && open ? `<div class="rb-s">אני מציע לענות: ${esc(x.proposal)}</div>` : ''}
      ${x.proposal && open && x.lessonFrom ? `<div class="rb-st">נלמד מ: ${esc(x.lessonFrom)}</div>` : ''}
      ${lgRoomIsInternal(x) ? (open ? `<div class="rb-st">מחכה לתיקון — ייסגר לבד</div>
            <div class="rb-acts"><button type="button" class="sbtn" data-roomclose="${esc(x.key)}">סגור</button></div>`
          : `<div class="rb-st">${x.answeredBy === 'ben' ? 'סגרת ✓' : x.answeredBy === 'stale' ? 'נסגר — המחשב לא שלח דופק שבוע' : 'תוקן ✓'}</div>`)
        : open && x.proposal && x.lessonId ? `<div class="rb-acts"><button type="button" class="sbtn is-primary" data-lessonok="${esc(x.key)}">אשר</button>
            <button type="button" class="sbtn" data-lessoncorrect="${esc(x.key)}">תקן</button>
            <button type="button" class="sbtn" data-roomanswer="${esc(x.key)}">ענה אחרת</button></div>`
        : open ? `<div class="rb-acts"><button type="button" class="sbtn is-primary" data-roomanswer="${esc(x.key)}">ענה</button></div>`
        : retry ? `<div class="rb-st">התשובה לא נשלחה: ${esc(lost.lastError || lost.state)}</div>
            <div class="rb-acts"><button type="button" class="sbtn is-primary" data-roomanswer="${esc(x.key)}">שלח שוב</button></div>`
        : '<div class="rb-st">ענית ✓</div>'}
    </div>`;
  }
  if (x.kind === 'answer') {
    const o = (outbox || {})[x.outboxKey || 'room_' + String(x.replyTo || '')];
    const st = !o ? '' : o.state === 'blocked' ? 'לא נשלח: ' + String(o.lastError || '') : (LG_ROOM_OB[o.state] || String(o.state || ''));
    return `<div class="rb rb-answer" data-roomkey="${esc(x.key)}">${head}
      <div class="rb-q">${esc(x.text || '')}</div>${st ? `<div class="rb-st">${esc(st)}</div>` : ''}</div>`;
  }
  //  תשובה שהסוכן נתן לבד לפי כלל (למידה, 11/11) — עם "תקן"
  if (x.kind === 'info' && x.lessonAuto === true) {
    const fix = lgRoomCanFix(x, outbox), fo = x.fixOutboxKey ? (outbox || {})[x.fixOutboxKey] : null;
    return `<div class="rb rb-info" data-roomkey="${esc(x.key)}">${head}<div class="rb-q">${esc(x.text || '')}</div>
      <div class="rb-who">${esc(x.customerName || 'לקוח')}: ${esc(x.question || '')}</div>
      ${x.proposal ? `<div class="rb-s">עניתי: ${esc(x.proposal)}</div>` : ''}
      ${x.lessonFrom ? `<div class="rb-st">נלמד מ: ${esc(x.lessonFrom)}</div>` : ''}
      ${fix ? `${fo ? `<div class="rb-st">התיקון לא נשלח: ${esc(fo.lastError || fo.state)}</div>` : ''}
        <div class="rb-acts"><button type="button" class="sbtn" data-autofix="${esc(x.key)}">תקן</button></div>`
        : x.fixOutboxKey ? '<div class="rb-st">תיקנת ✓ — מעכשיו אני שוב שואל קודם</div>' : ''}</div>`;
  }
  return `<div class="rb rb-info" data-roomkey="${esc(x.key)}">${head}<div class="rb-q">${esc(x.text || '')}</div></div>`;
}
//  אפשר לתקן תשובה אוטומטית: עוד לא תוקנה, או שהתיקון לא יצא (נחסם / נכשל סופית)
function lgRoomCanFix(e, outbox) {
  if (!e || e.kind !== 'info' || e.lessonAuto !== true || !e.lessonId) return false;
  return !e.fixOutboxKey || lgRoomSendFinal((outbox || {})[e.fixOutboxKey]);
}

// ─── מה הסוכנים למדו (למידה, 11/11) — waMeta/agentLessons ─────────────
//  שורה לכל כלל, לפי סדר הסוכנים, החדש ראשון בתוך כל סוכן
function lgLessonRows(lessons) {
  const order = LG_AD_AGENTS.map(a => a.id);
  const pos = a => { const i = order.indexOf(lgRoomAgentKey(a)); return i < 0 ? order.length : i; };
  return _adVals(lessons).filter(r => r.v && typeof r.v === 'object')
    .sort((a, b) => pos(a.v.agent) - pos(b.v.agent) || (Number(b.v.createdAt) || 0) - (Number(a.v.createdAt) || 0))
    .map(r => ({ id: r.key, agent: lgRoomAgentKey(r.v.agent), agentName: lgRoomAgentName(r.v.agent), topic: String(r.v.topic || ''),
                 answer: String(r.v.answer || ''), approvals: Number(r.v.approvals) || 0, corrections: Number(r.v.corrections) || 0,
                 auto: !!r.v.autoAt, customerName: String(r.v.customerName || r.v.customerId || ''), general: r.v.general === true }));
}
function lgLessonCount(lessons) { return lgLessonRows(lessons).length; }
function lgLessonsHtml(lessons) {
  const rows = lgLessonRows(lessons), esc = _adEsc;
  if (!rows.length) return '<div class="hint">הסוכנים עוד לא למדו כלום. כל תשובה שלך בחדר נשמרת כאן.</div>';
  let last = '';
  return rows.map(r => {
    const h = r.agent !== last ? `<h3 class="ls-h">${esc(r.agentName)}</h3>` : '';
    last = r.agent;
    return h + `<div class="ls-row">
      <div class="ls-t"><b>${esc(r.topic || 'בלי נושא')}</b> · ${r.auto ? '<span class="ls-auto">עונה לבד</span>' : 'מציע ושואל'}</div>
      <div class="ls-a">${esc(r.answer)}</div>
      <div class="ls-n">${r.customerName ? 'נלמד מ: ' + esc(r.customerName) + ' · ' : ''}${r.general ? 'עונה לכל הלקוחות (בלי מספרים / מחיר / תאריך)' : 'עונה לבד רק ללקוח הזה'}
        <button type="button" class="sbtn" data-lessongen="${esc(r.id)}" data-on="${r.general ? '0' : '1'}" aria-pressed="${r.general ? 'true' : 'false'}">${r.general ? 'כללי ✓' : 'הפוך לכללי'}</button></div>
      <div class="ls-n">אושר ${esc(r.approvals)} ברצף${r.corrections ? ' · תוקן ' + esc(r.corrections) : ''}
        <button type="button" class="sbtn" data-lessondel="${esc(r.id)}">מחק</button></div></div>`;
  }).join('');
}
//  "כלי החשבוניות במשרד" — מהדופק (waMeta/invoiceWatcher/<pc>, כל דקה). המחשב האחרון ששלח קובע.
//  → { state: 'ok'|'silent'|'never', text }. עובד = דופק ב-3 הדקות האחרונות.
function lgAdWatcherLine(watchers, now) {
  const last = Object.values(watchers || {}).filter(w => w && Number(w.at)).sort((a, b) => Number(b.at) - Number(a.at))[0];
  if (!last) return { state: 'never', text: 'כלי החשבוניות במשרד: עוד לא שלח דופק' };
  const m = Math.floor((now - Number(last.at)) / 60000);
  if (m >= 3) return { state: 'silent', text: 'כלי החשבוניות במשרד: לא ענה ' + m + ' דקות' };
  const n = Array.isArray(last.pending) ? last.pending.length : 0;
  return { state: 'ok', text: 'כלי החשבוניות במשרד: עובד' + (n ? ' · ' + n + (n === 1 ? ' קובץ מחכה' : ' קבצים מחכים') : '') };
}
//  כרטיס לכל סוכן: מה עשה היום (רשומות היומן במסלולים שלו + אירועים שלו בחדר),
//  וכמה שאלות שלו מחכות לבן. המרכזן — כל הודעה שנכנסה.
function lgAgentCards(room, shadow, now) {
  const from = lgAdPeriodStart('today', now);
  const sh = _adVals(shadow).map(r => r.v).filter(r => (r.createdAt || 0) >= from && r.staff !== true && r.route !== 'staff');
  const all = _adVals(room).map(r => r.v);
  const rm = all.filter(r => r.kind !== 'summary');
  return LG_AD_AGENTS.map(a => ({
    id: a.id, name: a.name, does: a.does,
    today: (a.id === 'markazan' ? sh.length : sh.filter(r => a.routes.includes(r.route)).length)
      + rm.filter(r => (Number(r.at) || 0) >= from && lgRoomAgentKey(r.agent) === a.id).length,
    waiting: rm.filter(r => r.kind === 'ask' && r.state === 'open' && lgRoomAgentKey(r.agent) === a.id).length,
    //  שורות בחדר היום (כולל סיכום של המנהל) — הקישור של כל סוכן לגלגל (11/11)
    room: all.filter(r => (Number(r.at) || 0) >= from && lgRoomAgentKey(r.agent) === a.id).length,
  }));
}
//  המתגים — כבוי / שקט / עונה לכל סוכן. master = AGENT_SHADOW_ENABLED (מתג החירום ב-Vercel)
function lgAdSwitchesHtml(cfg, master) {
  const ag = (cfg && cfg.agents) || {}, esc = _adEsc;
  return (master ? '' : '<div class="prob">⚠ מתג החירום ב-Vercel כבוי — כל הסוכנים כבויים, בלי קשר למה שנבחר כאן</div>')
    + LG_AD_AGENTS.map(a => `<div class="sw" role="group" aria-label="${esc(a.name)}"><b>${esc(a.name)}</b><div class="seg">`
      + LG_AD_MODES.map(([m, t]) => `<button type="button" data-agent="${esc(a.id)}" data-agmode="${m}" aria-pressed="${ag[a.id] === m}"${master ? '' : ' disabled'}>${t}</button>`).join('')
      + '</div></div>').join('');
}
//  התג בראש המסך
function lgAdModeChip(status, cfg) {
  if (!status) return { text: 'לא ידוע', mode: 'off' };
  if (status.shadow !== true) return { text: 'כבויים', mode: 'off' };
  const ag = (cfg && cfg.agents) || {};
  const n = LG_AD_AGENTS.filter(a => ag[a.id] === 'reply').length;
  return n ? { text: n + ' עונים', mode: 'live' } : { text: 'מצב שקט', mode: 'shadow' };
}

// ─── מה כל סוכן עשה (בן, 11/11: "מרכזן ניתב לפה בשעה ככה") ─────────────
//  לחיצה על כרטיס → רשימת פעולות של הסוכן הזה, החדש למעלה, שורה לכל פעולה.
//  מקורות: waMeta/agentShadow (כל הודעה ומה הוחלט עליה) + waMeta/agentRoom
//  (מה שהסוכן כתב בחדר). מרכזן — כל הודעה שנכנסה (הוא זה שמנתב); השאר —
//  ההודעות שנותבו אליו (routes ב-LG_AD_AGENTS) + השורות שלו בחדר.
//  טהור, קריאה בלבד.
const LG_ACT_ROUTE = { okev: 'העביר לעוקב', quote: 'העביר למחירון', price: 'העביר למחירון (טענת מחיר)', archive: 'העביר לארכיון',
  kolet: 'נכנס לתור הסקיצות', 'kolet-deleted': 'העביר לקולט (סקיצה נמחקה)', menu: 'שלח תפריט', none: 'לא צריך לענות',
  ignore: 'לא צריך לענות', shaul: 'לא ידע — שאל אותך', 'silent-human': 'שתק — מישהו מכם כבר ענה' };
//  טווח: today | yesterday | 7d → { from, to }
function lgActRange(period, now) {
  const t = Number(now) || Date.now(), today = lgAdPeriodStart('today', t);
  if (period === 'yesterday') return { from: lgAdPeriodStart('today', today - _AD_H), to: today };
  if (period === '7d') return { from: t - 7 * _AD_D, to: Infinity };
  return { from: today, to: Infinity };
}
//  → [{ key, at, who, what, did, review, verdict, kind }]  חדש למעלה
function lgAgentActivity(agentId, shadow, room, range, outbox) {
  const a = LG_AD_AGENTS.find(x => x.id === agentId);
  if (!a) return [];
  const r = range || {}, from = Number(r.from) || 0, to = r.to == null ? Infinity : Number(r.to);
  const inR = at => (Number(at) || 0) >= from && (Number(at) || 0) < to;
  const out = [];
  _adVals(shadow).forEach(({ key, v }) => {
    if (!inR(v.createdAt) || v.staff === true || v.route === 'staff') return;
    if (agentId !== 'markazan' && !a.routes.includes(v.route)) return;
    const who = v.linked ? String(v.customerName || 'לקוח') : 'מספר לא מקושר';
    let did;
    if (v.state && v.state !== 'done') did = LG_AG_STATE[v.state] || String(v.state);
    else if (agentId === 'markazan') did = !v.linked ? 'רק נספר — לא עונים למספר לא מקושר' : (LG_ACT_ROUTE[v.route] || lgAgRouteLabel(v.route));
    else {
      const sent = lgAgOutboxOf(key, outbox).filter(o => o.state === 'sent' && o.reason !== 'agent-staff' && o.reason !== 'agent-ask').map(o => o.text)[0];
      const would = _adWould(v);
      did = sent ? 'ענה ללקוח: ' + sent : would ? 'היה עונה: ' + would
        : _adToShaul(v) ? 'היה מעביר לשאול' : _adToBen(v) ? 'שאל אותך בחדר' : lgAgOutcome(v);
    }
    out.push({ key, at: Number(v.createdAt) || 0, kind: 'msg', who, what: !v.linked && !v.text ? 'שלח הודעה' : lgAgSentText(v), did,
      review: lgAdNeedsReview(v), verdict: v.verdict ? (v.verdict.ok ? 'ok' : 'wrong') : '' });
  });
  _adVals(room).forEach(({ key, v }) => {
    if (!inR(v.at) || v.kind === 'answer' || lgRoomAgentKey(v.agent) !== agentId) return;
    const q = String(v.question || '');
    out.push({ key, at: Number(v.at) || 0, kind: v.kind === 'summary' ? 'summary' : 'room',
      who: v.kind === 'summary' ? 'סיכום' : String(v.customerName || ''),
      what: String(v.text || q),
      did: lgRoomIsQuestion(v) ? (v.state === 'open' ? 'מחכה לתשובה שלך' : 'ענית ✓') : '',
      review: false, verdict: '' });
  });
  return out.sort((x, y) => y.at - x.at || (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
}
//  שעה בלבד להיום, אחרת תאריך + שעה
function _adHm(ms, today) {
  if (!ms) return '';
  if (ms < today) return _adWhen(ms);
  try { return new Date(ms).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return _adWhen(ms); }
}
function lgActRowHtml(x, today) {
  const e = _adEsc, k = e(x.key);
  const marks = x.review ? `<div class="wain-acts"><b class="wain-q">צדק?</b>
      <button type="button" class="wain-btn" data-agv="1" data-key="${k}" aria-pressed="${x.verdict === 'ok'}">✓</button>
      <button type="button" class="wain-btn" data-agv="0" data-key="${k}" aria-pressed="${x.verdict === 'wrong'}">✗</button>
      ${x.verdict ? `<span class="wain-chip">סימנת: ${x.verdict === 'ok' ? 'נכון ✓' : 'לא נכון ✗'}</span>` : ''}</div>` : '';
  return `<div class="act act-${e(x.kind)}"><span class="act-t">${e(_adHm(x.at, today))}</span><div class="act-b">
      <div class="act-w">${x.who ? `<b>${e(x.who)}</b> · ` : ''}${e(x.what)}</div>
      ${x.did ? `<div class="act-d">← ${e(x.did)}</div>` : ''}${marks}</div></div>`;
}
