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
const LG_AG_INTENT = { status: 'איפה ההזמנה', cancel: 'ביטול', change: 'שינוי', document: 'מסמך', quote: 'הצעת מחיר',
  order: 'הזמנה', chitchat: 'שיחה', thanks: 'תודה', unclear: 'לא ברור' };
const LG_AG_ROUTE = { okev: 'עוקב', kolet: 'קולט', archive: 'ארכיון', quote: 'מחירון', menu: 'תפריט', none: 'בלי תשובה',
  ignore: 'מתעלם', shaul: 'לשאול', 'silent-human': 'שותק (ענו ידנית)', 'kolet-deleted': 'קולט — סקיצה נמחקה' };
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
const LG_AG_OUTCOME = { okev: 'עוקב עונה ללקוח', quote: 'מחירון מטפל בבקשת המחיר', archive: 'ארכיון שולח את המסמך',
  kolet: 'נכנסה לתור הסקיצות כרגיל — אין צורך לענות', 'kolet-deleted': 'קולט בודק אם לבטל את הסקיצה',
  menu: 'שולח ללקוח את התפריט', none: 'לא צריך לענות', ignore: 'לא צריך לענות',
  shaul: 'עובר לשאול', 'silent-human': 'לא עונה — מישהו מכם כבר ענה בשעתיים האחרונות' };
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
  return Object.keys(m).filter(k => k.indexOf(pre) === 0 && /^\d+(_s|_f\d+)?$/.test(k.slice(pre.length))).sort()
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
      const who = o.reason === 'agent-staff' ? 'לשאול' : '';
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
const AD_REVIEW_ROUTES = ['okev', 'quote', 'archive', 'menu', 'shaul', 'kolet-deleted'];
function _adWould(r) {
  return String(r.wouldReply || ((Array.isArray(r.wouldAct) ? r.wouldAct : []).filter(a => a && a.text && a.type !== 'staff' && a.type !== 'quote-ask').map(a => a.text)[0]) || '');
}
const _adToShaul = r => r.route === 'shaul' || (Array.isArray(r.wouldAct) ? r.wouldAct : []).some(a => a && (a.type === 'staff' || a.type === 'quote-ask'));
function lgAdNeedsReview(r) {
  if (!r || r.linked !== true || r.state !== 'done') return false;
  return AD_REVIEW_ROUTES.includes(r.route) || !!_adWould(r) || _adToShaul(r);
}
function lgAdReviewRowHtml(key, r, intake, c) {
  const k = _adEsc(key), would = _adWould(r);
  const sent = lgAgOutboxOf(key, (c || {}).outbox).filter(o => o.state === 'sent' && o.reason !== 'agent-staff').map(o => o.text)[0];
  const what = sent ? `<div class="wain-ag-r">נשלח ללקוח: ${_adEsc(sent)}</div>`
    : would ? `<div class="wain-ag-r">הסוכן היה עונה: ${_adEsc(would)}</div>`
    : _adToShaul(r) ? '<div class="wain-ag-r">הסוכן היה מעביר לשאול</div>'
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

//  ששת הסוכנים — routes: אילו מסלולים ביומן שייכים לו (למונה ולסינון)
const LG_AD_AGENTS = [
  { id: 'markazan', name: 'מרכזן', does: 'קורא כל הודעה ומעביר לסוכן הנכון', routes: [] },
  { id: 'okev', name: 'עוקב', does: 'עונה איפה ההזמנה, מבטל ומעביר שינויים לשאול', routes: ['okev'] },
  { id: 'archive', name: 'ארכיון', does: 'שולח העתק חשבונית או סקיצה', routes: ['archive'] },
  { id: 'quote', name: 'מחירון', does: 'מחשב הצעת מחיר, סקיצה עוברת לשאול', routes: ['quote'] },
  { id: 'kolet', name: 'קולט', does: 'מטפל בסקיצה שהלקוח מחק', routes: ['kolet', 'kolet-deleted'] },
  { id: 'menahel', name: 'מנהל', does: 'סיכום יומי ב-15:00 (רק כשהסוכנים עונים)', routes: [] },
];
