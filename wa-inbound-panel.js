// ═══════════════════════════════════════════════════════════════════
//  wa-inbound-panel.js — פאנל "קליטות WhatsApp ומייל" בתור הסקיצות (admin.html).
//
//  מה רואים: כל הודעה נכנסת שלא הפכה להזמנה תקינה — וגם כאלה שהפכו
//  להזמנה אבל צריכות עין (לקוח לא זוהה, כמה כרטיסים, תמונה גדולה).
//
//  שני ערוצים ברשימה אחת (20/10): waInbound (WhatsApp) ו-emailInbound
//  (תיבת Orderluz, api/_email-inbound.js). כל שורה יודעת מאיזה ערוץ היא
//  (row.channel), והפעולות שלה נשלחות עם channel:'email' כשצריך.
//
//  ⚠️ הדף הזה **לא כותב** ל-waInbound ולא ל-emailInbound. אף פעם. "נסה
//  שוב" ו"טופל ידנית" עוברים דרך /api/wa-inbound-drain, שם הם טרנזקציה על
//  אותה רשומה עם audit. גם העיבוד כשהאדמין פתוח עובר שם, דרך אותה תפיסה
//  כמו ה-webhook. scripts/test-wa-inbound-panel.js אוכף את זה.
//
//  ⚠️ התמונה נטענת רק דרך שכבת הסקיצה (lgSketchIntoImg).
//
//  החלק העליון — פונקציות טהורות (שורה → תצוגה), נבדקות ב-Node.
//  החלק התחתון — DOM, מאזין ו-drain, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const WA_IN_MAX_ATTEMPTS = 3;
const WA_IN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WA_IN_CLAIM_TTL_MS = 2 * 60 * 1000;

function _waInEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _waInPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3) : d;
}
//  "דני <Dani@X.co.il>" → "dani@x.co.il" — כמו lgEmailAddr בשרת
//  ⚠️ הקבוצה **האחרונה** ב-<...>, כמו בשרת ובסקריפט: שם תצוגה יכול להכיל
//  <...> משלו, והפאנל היה מציג את הכתובת המזויפת במקום השולח האמיתי.
function _waInAddr(from) {
  const s = String(from || '');
  const all = s.match(/<[^<>]+>/g);
  return (all ? all[all.length - 1].slice(1, -1) : s).trim().toLowerCase();
}
function _waInWhen(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric',
      year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}
//  שגיאות טכניות באנגלית → משפט שבן אדם מבין
function _waInHuman(s) {
  return String(s || '')
    .replace(/(TypeError:\s*)?fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|network error/gi,
             'תקלת רשת בהורדה מ-GREEN API');
}

const _WA_IN_STATUS = {
  received:   ['ממתין לעיבוד', 'wait'],
  processing: ['בעיבוד',       'wait'],
  failed:     ['נכשל — ינוסה שוב', 'warn'],
  dead:       ['נעצר — צריך טיפול', 'bad'],
  rejected:   ['לא נקלט',       'bad'],
  closed:     ['טופל ידנית',    'closed'],
  done:       ['נקלט',          'ok'],
  ignored:    ['לא סקיצה — דולג', 'closed'],   // מייל בלי קובץ סקיצה — קיים רק במייל
};

//  גוף הבקשה לפעולה. WhatsApp — בלי channel, בדיוק כמו לפני המייל.
function lgWaInActBody(channel, action, key, note) {
  const b = channel === 'email' ? { channel: 'email', action, key } : { action, key };
  if (note !== undefined) b.note = note;
  return b;
}

//  רשומה מ-waInbound (או מ-emailInbound, channel:'email') → כל מה שהפאנל
//  מציג ומאפשר.
//  ⚠️ במייל אין כלל 24 שעות: הבייטים שמורים אצלנו ב-emailParts, ו"נסה שוב"
//  עובד גם אחרי שבוע. ב-WhatsApp הקובץ אצל GREEN API ונעלם אחרי יום.
//
//  assigned (לא חובה) — חיפוש טהור: orderIds → {done, client}. done = כל
//  ההזמנות של הקליטה כבר שויכו ביד ("שייך ללקוח", sq-assign.js). ואז
//  השורה לא דורשת טיפול — בלי לכתוב כלום לרשומת הקליטה.
const _WA_IN_UNMATCHED = ['none', 'ambiguous', 'group-unlinked'];
function lgWaInRow(key, r, now, channel, assigned) {
  r = r || {};
  const isEm = channel === 'email';
  const t = now || Date.now();
  const st = r.state || 'received';
  const cm = r.clientMatch || {};
  const fresh = st === 'processing' && r.claimedAt && (t - r.claimedAt) < WA_IN_CLAIM_TTL_MS;
  const young = isEm || (t - (r.createdAt || t)) <= WA_IN_MAX_AGE_MS;
  // "תקלת רשת ב-GREEN API" נכון רק ל-WhatsApp. במייל — השגיאה כמו שהיא.
  const human = isEm ? (s => String(s || '')) : _waInHuman;
  const who = isEm ? _waInAddr(r.from) : _waInPhone(r.sender);

  let [statusLabel, tone] = _WA_IN_STATUS[st] || [st, 'wait'];
  let reason = '', needsAttention = false, client = '—';
  const orderIds = Array.isArray(r.orderIds) ? r.orderIds : (r.orderIds ? Object.values(r.orderIds) : []);

  if (st === 'done') {
    if (cm.via === 'users' || cm.via === 'hashavshevet' || cm.via === 'email') client = cm.name || who;
    else client = 'לא שויך';
    // איפה משייכים: הכפתור בתור הסקיצות (sq-assign.js) — לשני הערוצים
    const where = ' בתור הסקיצות, בכפתור "שייך ללקוח".';
    if (cm.via === 'ambiguous') {
      reason = (isEm ? 'הכתובת מופיעה ב-' : 'המספר מופיע ב-') + (cm.candidates || 'כמה')
        + ' כרטיסי לקוח — לא שויך אוטומטית. צריך לשייך ביד' + where;
      needsAttention = true; statusLabel = 'נקלט — לא שויך'; tone = 'warn';
    } else if (cm.via === 'none') {
      reason = (isEm ? 'הכתובת לא נמצאה אצל אף לקוח' : 'המספר לא נמצא אצל אף לקוח') + ' — צריך לשייך ביד' + where;
      needsAttention = true; statusLabel = 'נקלט — לא שויך'; tone = 'warn';
    }
    // שויך ביד מאז — ההזמנות הן המקור, לא clientMatch (שנשאר כמו שנקלט)
    const a = _WA_IN_UNMATCHED.includes(cm.via) && orderIds.length && typeof assigned === 'function'
      ? assigned(orderIds) : null;
    if (a && a.done) {
      needsAttention = false; tone = 'ok'; reason = '';
      statusLabel = 'נקלט — שויך ידנית'; client = a.client || client;
    }
    if (r.oversize) {
      reason = (reason ? reason + ' ' : '') + 'תמונה גדולה (' + Math.round((r.sizeBytes || 0) / 1024) + 'KB) — כדאי לוודא שהיא תקינה.';
      needsAttention = true; if (tone === 'ok') tone = 'warn';
    }
    if (r.handled) {
      needsAttention = false; tone = 'closed';
      reason = 'סומן כטופל' + (r.handled.note ? ': ' + r.handled.note : '') + ' · ' + _waInPhone(r.handled.by) + ' · ' + _waInWhen(r.handled.at);
    }
  } else if (st === 'failed') {
    reason = human(r.lastError) || 'העיבוד נכשל'; needsAttention = true;
  } else if (st === 'dead' || st === 'rejected') {
    reason = human(r.reason || r.lastError) || 'לא ידוע'; needsAttention = true;
  } else if (st === 'ignored') {
    reason = String(r.reason || '');
  } else if (st === 'closed') {
    reason = (r.closedNote ? r.closedNote + ' · ' : '') + _waInPhone(r.closedBy) + ' · ' + _waInWhen(r.closedAt);
  } else if (st === 'processing' && !fresh) {
    reason = 'העיבוד נקטע באמצע — ייאסף שוב אוטומטית';
  }

  // מייל — קבצים שלא נקלטו (docx, xlsx...) נרשמים ב-skipped. שבן יראה מה נשאר בחוץ.
  const skipped = isEm && Array.isArray(r.skipped) ? r.skipped.filter(Boolean) : [];
  if (skipped.length) reason = (reason ? reason + ' ' : '') + 'לא נקלטו: ' + skipped.join(', ') + '.';

  const parts = isEm ? (Array.isArray(r.parts) ? r.parts : Object.values(r.parts || {})).filter(Boolean) : [];
  const kindLabel = isEm
    ? (parts.length === 1 ? 'מייל · קובץ אחד' : parts.length ? 'מייל · ' + parts.length + ' קבצים' : 'מייל בלי קבצים')
    : r.kind === 'text' ? 'הודעת טקסט' : r.kind === 'pdf' ? 'PDF'
    : r.kind === 'image' ? (r.typeMessage === 'documentMessage' ? 'תמונה (כמסמך)' : 'תמונה') : 'קובץ';

  let view = null;
  if (st === 'done' && orderIds[0]) view = { type: 'sketch', orderId: String(orderIds[0]) };
  else if (isEm) view = null;                    // המייל עצמו — בתיבת Orderluz
  else if (/^https:\/\//i.test(r.downloadUrl || '')) view = { type: 'link', url: r.downloadUrl };
  else if (r.sender) view = { type: 'chat', url: 'https://wa.me/972' + String(r.sender).replace(/\D/g, '').replace(/^0/, '') };

  const at = (isEm ? r.receivedAt : r.timestamp) || r.createdAt || 0;
  return {
    key, channel: isEm ? 'email' : 'whatsapp',
    state: st, statusLabel, tone, reason, needsAttention, client,
    at, atText: _waInWhen(at),
    sender: who, kindLabel,
    fileName: isEm ? parts.map(p => String(p.name || '')).filter(Boolean).join(', ') : (r.fileName || ''),
    caption: isEm ? String(r.subject || '') : (r.caption || ''),
    // ניסיונות — רק כשמשהו השתבש. על קליטה שהצליחה "1 / 3" הוא רעש (07/10)
    attempts: r.attempts || 0,
    attemptsText: r.attempts && ['failed', 'dead', 'processing'].includes(st) ? r.attempts + ' / ' + WA_IN_MAX_ATTEMPTS : '',
    orderNum: st === 'done' ? (r.refNum || '') : '', orderId: orderIds[0] || '',
    canRetry: (st === 'failed' || st === 'dead') && young,
    canClose: st !== 'closed' && st !== 'ignored' && !fresh && !(st === 'done' && (!needsAttention || r.handled)),
    inProgress: st === 'received' || st === 'processing',
    view,
  };
}

//  החיפוש של assigned מתוך רשימת ההזמנות (orders הגלובלי ב-admin.html).
//  done רק כשכל הזמנה קיימת, יש לה customerId ואף סימון "לא שויך".
function lgWaInAssignedFrom(orders) {
  const byId = {};
  (Array.isArray(orders) ? orders : Object.values(orders || {})).forEach(o => { if (o && o.id != null) byId[String(o.id)] = o; });
  return ids => {
    const os = (ids || []).map(id => byId[String(id)]);
    const done = os.length > 0 && os.every(o => o && o.customerId && !o.waUnassigned && !o.emailUnassigned);
    return { done, client: done ? String(os[0].orderClient || '') : '' };
  };
}

function lgWaInCounts(rows) {
  return { attention: rows.filter(x => x.needsAttention).length,
           inProgress: rows.filter(x => x.inProgress).length };
}

function lgWaInRowHtml(x) {
  const e = _waInEsc;
  const ch = ` data-ch="${e(x.channel || 'whatsapp')}"`;
  const viewBtn = !x.view ? ''
    : x.view.type === 'sketch' ? `<button class="wain-btn" data-act="view" data-key="${e(x.key)}"${ch} data-order="${e(x.view.orderId)}">צפה בסקיצה</button>`
    : x.view.type === 'link'   ? `<a class="wain-btn" href="${e(x.view.url)}" target="_blank" rel="noopener noreferrer">פתח קובץ מקורי</a>`
    :                            `<a class="wain-btn" href="${e(x.view.url)}" target="_blank" rel="noopener noreferrer">פתח צ'אט ב-WhatsApp</a>`;
  return `<div class="wain-row wain-${e(x.tone)}" data-key="${e(x.key)}"${ch}>
  <div class="wain-l1"><span class="wain-chip">${e(x.statusLabel)}</span>
    <span class="wain-when">${e(x.atText)}</span>
    ${x.channel === 'email' ? '<span class="wain-chan">מייל</span>' : ''}
    <span class="wain-from" dir="ltr">${e(x.sender)}</span>
    <span class="wain-client">${e(x.client)}</span></div>
  <div class="wain-l2"><span>${e(x.kindLabel)}${x.fileName ? ' · <bdi>' + e(x.fileName) + '</bdi>' : ''}</span>
    ${x.caption ? `<span>“<bdi>${e(x.caption)}</bdi>”</span>` : ''}
    ${x.orderNum ? `<span>הזמנה <b>${e(x.orderNum)}</b></span>` : ''}
    ${x.attemptsText ? `<span>ניסיונות ${e(x.attemptsText)}</span>` : ''}</div>
  ${x.reason ? `<div class="wain-reason">${e(x.reason)}</div>` : ''}
  <div class="wain-acts">
    ${x.canRetry ? `<button class="wain-btn wain-primary" data-act="retry" data-key="${e(x.key)}"${ch}>נסה שוב</button>` : ''}
    ${x.canClose ? `<button class="wain-btn" data-act="close" data-key="${e(x.key)}"${ch}>טופל ידנית</button>` : ''}
    ${viewBtn}
  </div>
</div>`;
}

// ═══ דפדפן ═══════════════════════════════════════════════════════════
// ─── מספרים פרטיים (בן, 26/10) ─────────────────────────────────────────
//  מספר שלא ברשימה ושלח הודעה נרשם בשרת (רק מספר, מונה וזמן). כאן הוא
//  מוצג, ובן מקשר אותו לכרטיס — ומאז הוא עובד בכל הגלגל. פונקציות טהורות,
//  כדי שאפשר לבדוק אותן ב-Node.
function _waInPhoneText(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 9 && d[0] === '0') return d.slice(0, 2) + '-' + d.slice(2);   // קווי: 03-7436564
  return _waInPhone(d);
}
function lgWaInSenderRows(seen, linked, showAll) {
  const S = seen || {}, L = linked || {};
  const keys = Array.from(new Set(Object.keys(S).concat(Object.keys(L))));
  return keys.map(k => {
    const s = S[k] || {}, l = L[k] || null;
    return { key: k, phoneText: _waInPhoneText(k), linked: !!(l && l.customerId),
             customerId: l ? String(l.customerId || '') : '',
             customerName: l ? String(l.customerName || l.customerId || '') : '',
             count: s.count || 0, lastAt: s.lastAt || (l && l.linkedAt) || 0, ignored: !l && !!s.ignored };
  })
    .filter(r => showAll || !r.ignored)
    .sort((a, b) => (a.linked - b.linked) || (a.ignored - b.ignored) || (b.lastAt - a.lastAt));
}
function lgWaInSendersAttention(seen, linked) {
  return lgWaInSenderRows(seen, linked, false).filter(r => !r.linked).length;
}
// ─── שתי צורות לכל שולח (בן, 27/10: "שיהיה מסודר") ─────────────────────
//  מחכה לקישור — כרטיס עם "קשר ללקוח" (פותח את בורר הלקוח על כל המסך).
//  מקושר / מוסתר — שורה אחת: מי שולח ← לאיזה לקוח. הפעולה (נתק / בטל
//  התעלמות) בתפריט ⋮, כדי שלא ילחצו עליה בטעות.
//  attr — data-gkey/skey/ekey/tkey="..." (כבר מוברח). sub — HTML מוברח.
function _waInCard(attr, icon, title, when, text, acts) {
  return `<div class="wain-row wain-warn" ${attr}>
        <div class="wain-l1"><span class="wain-client">${icon} <bdi dir="ltr">${_waInEsc(title)}</bdi></span>
          <span class="wain-when">${_waInEsc(_waInWhen(when))}</span></div>
        <div class="wain-reason">${text}</div>
        <div class="wain-acts">${acts}</div>
      </div>`;
}
function _waInLine(attr, icon, title, sub, act, actLabel) {
  return `<div class="wain-line" ${attr}>
        <span class="wain-ic${icon === '✉' ? ' wain-ic-m' : ''}" aria-hidden="true">${icon}</span>
        <span class="wain-who"><b><bdi dir="ltr">${_waInEsc(title)}</bdi></b><small>${sub}</small></span>
        <button type="button" class="wain-more" aria-label="אפשרויות" aria-expanded="false">⋮</button>
        <span class="wain-menu" hidden><button type="button" class="wain-btn" ${act}>${actLabel}</button></span>
      </div>`;
}
//  textOn — הלקוח ברשימת הטקסט החופשי (סימון ✓ ליד השם)
function _waInTo(name, kind, textOn) {
  return '← ' + _waInEsc(name) + (kind ? ' · ' + kind : '') + (textOn ? ' · טקסט חופשי ✓' : '');
}

//  קבוצות — groupsSeen (שם, מונה, זמן) + waGroups (הקישור)
function lgWaInGroupRows(seen, linked) {
  const S = seen || {}, L = linked || {};
  return Object.keys(S).map(k => {
    const g = S[k] || {}, l = L[k] || null;
    return { key: k, name: String(g.name || 'קבוצה ללא שם'), count: g.count || 1, lastAt: g.lastAt || 0,
             linked: !!l, customerId: l ? String(l.customerId || '') : '',
             customerName: l ? String(l.customerName || l.customerId || '') : '' };
  }).sort((a, b) => (a.linked - b.linked) || (b.lastAt - a.lastAt));
}
function lgWaInGroupHtml(g, textOn) {
  const attr = `data-gkey="${_waInEsc(g.key)}"`;
  if (g.linked) return _waInLine(attr, '👥', g.name, _waInTo(g.customerName, 'קבוצה', textOn), 'data-gact="unlink"', 'נתק');
  return _waInCard(attr, '👥', g.name, g.lastAt,
    `${g.count} תמונות נשלחו מהקבוצה ולא נקלטו. קשר אותה ללקוח, והתמונות הבאות ייכנסו לתור.`,
    `<button class="wain-btn wain-primary" data-gact="link">קשר ללקוח</button>`);
}

function lgWaInSenderHtml(r, textOn) {
  const attr = `data-skey="${_waInEsc(r.key)}"`;
  if (r.linked) return _waInLine(attr, '📱', r.phoneText, _waInTo(r.customerName, 'מספר', textOn), 'data-sact="unlink"', 'נתק');
  if (r.ignored) return _waInLine(attr, '📱', r.phoneText, 'מוסתר — הודעות ממנו לא נקלטות', 'data-sact="unignore"', 'בטל התעלמות');
  return _waInCard(attr, '📱', r.phoneText, r.lastAt,
    `${r.count || 1} הודעות נשלחו מהמספר ולא נקלטו. קשר אותו ללקוח, וההודעות הבאות ייכנסו לתור.`,
    `<button class="wain-btn wain-primary" data-sact="link">קשר ללקוח</button>
          <button class="wain-btn" data-sact="ignore">התעלם</button>`);
}

// ─── כתובות מייל (בן, 26/10) — אותו דבר, למייל ───────────────────────────
//  כתובת שלא ברשימה ושלחה מייל נרשמת בשרת (waMeta/emailSendersSeen: כתובת,
//  מונה, זמן). המפתח הוא הכתובת עם פסיק במקום נקודה; מוצגת מפוענחת.
//  listed:true = הכתובת ברשימה ב-Vercel ועוד לא קושרה: כבר נקלטת, אז היא מוצגת
//  ("ברשימה" + קישור — כך בן מקשר את הכתובת שלו) אבל לא נספרת ב"דורש טיפול".
function lgWaInEmailRows(seen, linked, showAll) {
  const S = seen || {}, L = linked || {};
  const keys = Array.from(new Set(Object.keys(S).concat(Object.keys(L))));
  return keys.map(k => {
    const s = S[k] || {}, l = L[k] || null;
    return { key: k, emailText: String(s.email || (l && l.email) || k.replace(/,/g, '.')), linked: !!(l && l.customerId),
             customerName: l ? String(l.customerName || l.customerId || '') : '',
             count: s.count || 0, lastAt: s.lastAt || (l && l.linkedAt) || 0,
             listed: !l && !!s.listed, ignored: !l && !s.listed && !!s.ignored };
  })
    .filter(r => showAll || !r.ignored)
    .sort((a, b) => (a.linked - b.linked) || (a.ignored - b.ignored) || (b.lastAt - a.lastAt));
}
function lgWaInEmailsAttention(seen, linked) {
  return lgWaInEmailRows(seen, linked, false).filter(r => !r.linked && !r.listed).length;
}
function lgWaInEmailHtml(r) {
  const attr = `data-ekey="${_waInEsc(r.key)}"`;
  if (r.linked) return _waInLine(attr, '✉', r.emailText, _waInTo(r.customerName, 'מקושר'), 'data-eact="unlink"', 'נתק');
  if (r.ignored) return _waInLine(attr, '✉', r.emailText, 'מוסתרת — מיילים ממנה לא נקלטים', 'data-eact="unignore"', 'בטל התעלמות');
  const link = `<button class="wain-btn wain-primary" data-eact="link">קשר ללקוח</button>`;
  if (r.listed) return _waInCard(attr, '✉', r.emailText, r.lastAt,
    `<span class="wain-chip">ברשימה</span> המיילים ממנה כבר נקלטים. קשר אותה ללקוח, וההודעות על ההזמנות יחזרו אליה במייל.`, link);
  return _waInCard(attr, '✉', r.emailText, r.lastAt,
    `${r.count || 1} מיילים נשלחו מהכתובת ולא נקלטו. קשר אותה ללקוח, והמיילים הבאים ייכנסו לתור.`,
    link + `
          <button class="wain-btn" data-eact="ignore">התעלם</button>`);
}

// ─── הזמנות מטקסט חופשי (בן, 26/10) ─────────────────────────────────────
//  הלקוחות שהודעה כמו "מראה 5 70 על 120" מהם פותחת הזמנה לבד. הכתיבה דרך
//  /api/wa-inbound-drain (text-customer-add/remove) — לא ישירות.
function lgWaInTextCustomersHtml(map) {
  const m = map || {};
  const rows = Object.keys(m).sort((a, b) => String(m[a].customerName || a).localeCompare(String(m[b].customerName || b), 'he'))
    .map(k => _waInLine(`data-tkey="${_waInEsc(k)}"`, '✍', m[k].customerName || k, 'מפתח ' + _waInEsc(k), 'data-tact="remove"', 'הסר')).join('');
  return `<div class="wain-note">לקוחות שמזמינים בהודעה כמו "מראה 5 70 על 120" — ההזמנה תיפתח לבד בתור.</div>
      ${rows ? `<div class="wain-lines">${rows}</div>` : ''}
      <div data-tkey=""><button type="button" class="wain-addbtn" data-tact="add">＋ הוסף לקוח שמזמין בטקסט חופשי</button></div>`;
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
  const e = _waInEsc;
  return '<div class="wain-note"><b>לקוחות בפיילוט</b>' + ids.map(id => {
    const n = String((nameOf && nameOf(id)) || '') || id;
    return `<div class="wain-l1"><span class="wain-client">${e(n)}</span>
          <button type="button" class="wain-btn" data-agpilot data-cid="${e(id)}" data-on="0">הוצא מפיילוט</button></div>`;
  }).join('') + '</div>';
}
const LG_AG_WHY = { 'not-pilot': 'לא בפיילוט', 'not-linked': 'לא מקושר בקליטות', off: 'מתג כבוי', 'switches-off': 'מתג כבוי', 'no-staff': 'אין מספר של שאול', error: 'שגיאה' };
const LG_AG_STATE = { received: 'ממתין', processing: 'בעיבוד', failed: 'נכשל' };
const LG_AG_OB = { sent: 'נשלח ✓', pending: 'בתור', blocked: 'נחסם', failed: 'נכשל' };
//  רשומות התור של שורה: <key>_<i>, <key>_<i>_s או <key>_<i>_f<j> (קובץ לכל רשומה; מפתח מנוקה כמו בשרת)
function lgAgOutboxOf(key, outbox) {
  const pre = String(key).replace(/[.#$[\]/]/g, '_') + '_', m = outbox || {};
  return Object.keys(m).filter(k => k.indexOf(pre) === 0 && /^\d+(_s|_f\d+)?$/.test(k.slice(pre.length))).sort()
    .map(k => m[k]).filter(Boolean);
}
//  מה נעשה בפועל / מה היה נעשה — שורה אחת או יותר, הכל escaped
function lgAgActHtml(r, c) {
  const e = _waInEsc;
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
  const why = r.actReason ? (LG_AG_WHY[r.actReason] || r.actReason) : '';
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
  const k = _waInEsc(key);
  const cc = c || {};
  const pilotOn = !!(r.customerId && (cc.pilot || {})[r.customerId] === true);
  //  פיילוט רק לצ'אט שמקושר כמו שהשליחה בודקת (קבוצה / מספר בקליטות) — לא רשימת Vercel
  const pilotBtn = r.linked && r.customerId && (r.linkVia === 'group' || r.linkVia === 'sender')
    ? `<button type="button" class="wain-btn" data-agpilot data-cid="${_waInEsc(r.customerId)}" data-on="${pilotOn ? 0 : 1}">פיילוט: ${pilotOn ? 'כן' : 'לא'}</button>` : '';
  //  הודעה שהסוכן לא ראה כהזמנה אבל נקלטה כהזמנה — בן צריך לראות את זה
  const both = r.intent !== 'order' && lgAgIntakeTaken(key, r, intake)
    ? ' <span class="wain-ag-red">נקלטה גם כהזמנה</span>' : '';
  const v = r.verdict ? (r.verdict.ok ? 'נכון ✓' : 'לא נכון ✗') : '';
  return `<div class="wain-row wain-ag" data-agkey="${k}">
        <div class="wain-l1"><span class="wain-client">${r.linked ? _waInEsc(r.customerName || '') : 'לא מקושר'}</span>
          <span class="wain-when">${_waInEsc(_waInWhen(r.createdAt))}</span></div>
        ${r.text ? `<div class="wain-ag-t">${_waInEsc(r.text)}</div>` : ''}
        <div class="wain-reason"><b>${_waInEsc(lgAgIntentLabel(r.intent))}</b> ← ${_waInEsc(lgAgRouteLabel(r.route))}${both}</div>
        ${lgAgActHtml(Object.assign({ _key: key }, r), cc)}
        <div class="wain-acts">
          ${pilotBtn}
          <button type="button" class="wain-btn" data-agv="1" data-key="${k}" aria-label="נכון">✓</button>
          <button type="button" class="wain-btn" data-agv="0" data-key="${k}" aria-label="לא נכון">✗</button>
          ${v ? `<span class="wain-chip">${v}</span>` : ''}
        </div>
      </div>`;
}

//  מכאן והלאה רק בדפדפן. ב-Node (בדיקות) אין document, ולכן לא רץ כלום.
if (typeof document !== 'undefined') (function () {
  // שורות לכל ערוץ בנפרד — כל מאזין מחליף רק את שלו; rows = שניהם יחד
  let rows = [], byCh = { whatsapp: [], email: [] }, timer = null, busyKey = '';
  const draining = { whatsapp: false, email: false };
  // לשונית פתוחה, ואילו מקטעים מקופלים פתוחים — שרענון חי לא יסגור אותם
  let tab = 'whatsapp';
  let agentShadow = {}, agentPilot = {}, agentOutbox = {};
  const folds = {};

  const $ = id => document.getElementById(id);

  // ─── מקורות הנתונים — הכתיבה תמיד דרך /api/wa-inbound-drain, לא ישירות ───
  //  קבוצות (06/10): כל קבוצה שמספר העסק חבר בה ושלחה תמונה (רק שמה נשמר).
  //  "קשר ללקוח" → כל תמונה בה נכנסת לתור על הלקוח, והעדכון יוצא לקבוצה.
  let groupsSeen = {}, groupsLinked = {};
  //  מספרים פרטיים וכתובות מייל (26/10) — אותו דבר, לשולח בודד
  let sendersSeen = {}, sendersLinked = {};
  let emailsSeen = {}, emailsLinked = {};
  //  לקוחות שמזמינים בטקסט חופשי (26/10)
  let textCustomers = {};

  // ─── בורר הלקוח (27/10) ─────────────────────────────────────────────
  //  נפתח רק בלחיצה על "קשר ללקוח" / "הוסף", על כל הפאנל. קודם הרשימה ישבה
  //  מתחת לשדה בתוך הכרטיס, נפתחה לבד בפוקוס ונחתכה בתחתית הכרטיס.
  //  רשימה גלויה ולא רשימת ההצעות של הדפדפן (07/10): ב-iOS ההצעות מופיעות רק
  //  מעל המקלדת ורק כשיש התאמה, ונראה כמו שדה שלא עושה כלום.
  let pick = null;   // { kind: 'g'|'s'|'e'|'t', key }
  function accountMatches(q) {
    const m = (typeof hashavshevetAccountsMap !== 'undefined' && hashavshevetAccountsMap) || {};
    const t = String(q || '').trim().toLowerCase();
    return Object.values(m).filter(a => a && a.key)
      .filter(a => !t || String(a.name || '').toLowerCase().includes(t) || String(a.key).toLowerCase().includes(t))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
      .slice(0, 30);
  }
  function renderAccList(input) {
    const list = $('waInPickL');
    if (!list || !input) return;
    const hits = accountMatches(input.value);
    list.innerHTML = hits.length
      ? hits.map(a => `<button type="button" class="wain-acc-opt" data-acc="${_waInEsc(a.key)}" data-name="${_waInEsc(a.name || '')}">
           <span>${_waInEsc(a.name || '')}</span><span class="wain-acc-key" dir="ltr">${_waInEsc(a.key)}</span></button>`).join('')
      : `<div class="wain-acc-none">לא נמצא כרטיס בשם הזה. נסה חלק מהשם או את מפתח הלקוח בחשבשבת.</div>`;
  }
  const PICK_TEXT = {
    g: ['הודעות מהקבוצה ייכנסו לתור על הלקוח, והעדכונים יישלחו לקבוצה.'],
    s: ['הודעות מהמספר ייכנסו לתור על הלקוח, והעדכונים יישלחו אליו.'],
    e: ['מיילים מהכתובת ייכנסו לתור על הלקוח, והעדכונים יחזרו אליה במייל.'],
    t: ['הודעה כמו "מראה 5 70 על 120" מהלקוח תפתח הזמנה בתור.'],
  };
  function openPick(kind, key, who) {
    const box = $('waInPick'), q = $('waInPickQ'); if (!box || !q) return;
    pick = { kind, key };
    $('waInPickT').textContent = kind === 't' ? 'איזה לקוח מזמין בטקסט חופשי?' : 'למי שייך ' + String.fromCharCode(0x2066) + who + String.fromCharCode(0x2069) + '?';
    $('waInPickS').textContent = PICK_TEXT[kind][0];
    q.value = '';
    box.hidden = false;
    renderAccList(q);
    q.focus();
  }
  function closePick() { const box = $('waInPick'); if (box) box.hidden = true; pick = null; }
  function picked(customerId) {
    const p = pick; closePick(); if (!p || !customerId) return;
    if (p.kind === 'g') groupAct(p.key, 'link', customerId);
    else if (p.kind === 's') senderAct(p.key, 'link', customerId);
    else if (p.kind === 'e') emailAct(p.key, 'link', customerId);
    else textAct('', 'add', customerId);
  }

  async function groupAct(key, action, customerId) {
    if (action === 'unlink' && !confirm('לנתק את הקבוצה? תמונות חדשות ממנה לא ייכנסו לתור.')) return;
    const r = await post({ action: action === 'link' ? 'link-group' : 'unlink-group', key, customerId: customerId || '' });
    if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
  }
  async function senderAct(key, action, customerId) {
    if (action === 'unlink' && !confirm('לנתק את המספר? הודעות חדשות ממנו לא ייכנסו לתור.')) return;
    const name = { link: 'link-sender', unlink: 'unlink-sender', ignore: 'ignore-sender', unignore: 'unignore-sender' }[action];
    if (!name) return;
    const r = await post({ action: name, key, customerId: customerId || '' });
    if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
  }
  async function emailAct(key, action, customerId) {
    if (action === 'unlink' && !confirm('לנתק את הכתובת? מיילים חדשים ממנה לא ייכנסו לתור, והיא לא תקבל יותר הודעות.')) return;
    const name = { link: 'link-sender', unlink: 'unlink-sender', ignore: 'ignore-sender', unignore: 'unignore-sender' }[action];
    if (!name) return;
    const r = await post({ channel: 'email', action: name, key, customerId: customerId || '' });
    if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
  }
  async function textAct(key, action, customerId) {
    if (action === 'remove' && !confirm('להפסיק לפתוח הזמנות מטקסט ללקוח הזה?')) return;
    const r = await post({ action: action === 'add' ? 'text-customer-add' : 'text-customer-remove', customerId: action === 'add' ? customerId : key });
    if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
  }

  // ─── ספירות — "דורש טיפול" לכל ערוץ, לתג על הכפתור ועל הלשוניות ──────
  function attention() {
    const wa = lgWaInCounts(byCh.whatsapp).attention
      + lgWaInGroupRows(groupsSeen, groupsLinked).filter(g => !g.linked).length   // קבוצה שלא קושרה
      + lgWaInSendersAttention(sendersSeen, sendersLinked);
    const em = lgWaInCounts(byCh.email).attention + lgWaInEmailsAttention(emailsSeen, emailsLinked);
    return { wa, em };
  }
  function badge() {
    const n = attention(), c = lgWaInCounts(rows);
    const a = $('waInBadgeA'), p = $('waInBadgeP');
    if (a) { a.textContent = '⚠ ' + (n.wa + n.em); a.hidden = !(n.wa + n.em); }
    if (p) { p.textContent = '⏳ ' + c.inProgress; p.hidden = !c.inProgress; }
    [['waInTabWa', n.wa], ['waInTabEm', n.em]].forEach(([id, v]) => { const t = $(id); if (t) { t.textContent = v; t.hidden = !v; } });
  }

  // ─── לשונית: מחכים לקישור · מקושרים · (טקסט חופשי) · לא נקלטו · היסטוריה ──
  function sec(title, n, body) {
    return `<div class="wain-sec">${title}<span>${n}</span></div>${body}`;
  }
  function fold(id, title, n, body) {
    return `<details class="wain-fold" data-fold="${id}"${folds[id] ? ' open' : ''}>
        <summary>${title}<span>${n}</span></summary><div class="wain-fold-b">${body}</div></details>`;
  }
  function intakeRows(ch) {
    const all = byCh[ch];
    const now = all.filter(x => x.needsAttention || x.inProgress);
    return {
      problems: now.length ? now.map(lgWaInRowHtml).join('') : '',
      problemsN: now.length,
      history: all.length ? all.map(lgWaInRowHtml).join('') : '<div class="wain-ok-note">אין עדיין קליטות.</div>',
      historyN: all.length,
    };
  }
  function lines(html) { return html ? `<div class="wain-lines">${html}</div>` : ''; }

  function waTab() {
    const groups = lgWaInGroupRows(groupsSeen, groupsLinked);
    const senders = lgWaInSenderRows(sendersSeen, sendersLinked, true);
    const textOn = id => !!(id && textCustomers[id]);
    const waiting = groups.filter(g => !g.linked).map(g => [g.lastAt, lgWaInGroupHtml(g)])
      .concat(senders.filter(s => !s.linked && !s.ignored).map(s => [s.lastAt, lgWaInSenderHtml(s)]))
      .sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const linkedG = groups.filter(g => g.linked), linkedS = senders.filter(s => s.linked);
    const linked = linkedG.map(g => lgWaInGroupHtml(g, textOn(g.customerId)))
      .concat(linkedS.map(s => lgWaInSenderHtml(s, textOn(s.customerId)))).join('');
    const ignored = senders.filter(s => s.ignored);
    const ir = intakeRows('whatsapp');
    const tN = Object.keys(textCustomers).length;
    return sec('מחכים לקישור', waiting.length, waiting.join('') || '<div class="wain-ok-note">אין קבוצות או מספרים חדשים ✓</div>')
      + sec('מקושרים', linkedG.length + linkedS.length, lines(linked) || '<div class="wain-ok-note">עוד אין קבוצות או מספרים מקושרים.</div>')
      + fold('wa-text', 'מזמינים בטקסט חופשי', tN, lgWaInTextCustomersHtml(textCustomers))
      + (ir.problemsN ? sec('הודעות שלא נקלטו', ir.problemsN, ir.problems)
                      : fold('wa-prob', 'הודעות שלא נקלטו', 'אין ✓', '<div class="wain-ok-note">כל ההודעות נקלטו ✓</div>'))
      + (ignored.length ? fold('wa-ign', 'מספרים מוסתרים', ignored.length, lines(ignored.map(s => lgWaInSenderHtml(s)).join(''))) : '')
      + fold('wa-hist', 'כל ההיסטוריה', ir.historyN, ir.history);
  }
  function emailTab() {
    const all = lgWaInEmailRows(emailsSeen, emailsLinked, true);
    const waiting = all.filter(r => !r.linked && !r.ignored);
    const linked = all.filter(r => r.linked), ignored = all.filter(r => r.ignored);
    const ir = intakeRows('email');
    return sec('מחכים לקישור', waiting.length, waiting.map(lgWaInEmailHtml).join('') || '<div class="wain-ok-note">אין כתובות חדשות ✓</div>')
      + sec('מקושרים', linked.length, lines(linked.map(lgWaInEmailHtml).join('')) || '<div class="wain-ok-note">עוד אין כתובות מקושרות.</div>')
      + (ir.problemsN ? sec('מיילים שלא נקלטו', ir.problemsN, ir.problems)
                      : fold('em-prob', 'מיילים שלא נקלטו', 'אין ✓', '<div class="wain-ok-note">כל המיילים נקלטו ✓</div>'))
      + (ignored.length ? fold('em-ign', 'כתובות מוסתרות', ignored.length, lines(ignored.map(lgWaInEmailHtml).join(''))) : '')
      + fold('em-hist', 'כל ההיסטוריה', ir.historyN, ir.history);
  }

  function agentsTab() {
    const rs = lgAgRows(agentShadow);
    const c = { pilot: agentPilot, outbox: agentOutbox };
    const accs = (typeof hashavshevetAccountsMap !== 'undefined' && hashavshevetAccountsMap) || {};
    const nameOf = id => (accs[id] && accs[id].name) || ((rs.find(r => r.customerId === id) || {}).customerName) || '';
    return lgAgPilotListHtml(agentPilot, nameOf) + `<div class="wain-note">בפיילוט: ${lgAgPilotCount(agentPilot)} לקוחות. רק לקוח בפיילוט מקבל תשובות אמיתיות; לשאר נרשם מה היה עונה. סמן ✓ אם ההחלטה והתשובה נכונות, ✗ אם לא.</div>`
      + sec('100 האחרונות', rs.length, rs.map(r => lgAgRowHtml(r.key, r, raw.whatsapp, c)).join('') || '<div class="wain-ok-note">עוד אין רשומות.</div>');
  }

  function render() {
    badge();
    const list = $('waInList'); if (!list) return;
    const top = list.scrollTop;
    list.innerHTML = tab === 'agents' ? agentsTab() : tab === 'email' ? emailTab() : waTab();
    list.scrollTop = top;                             // רענון חי לא מקפיץ לראש הרשימה
    document.querySelectorAll('#waInPanel .wain-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('wain-tab-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  //  הרשומות הגולמיות נשמרות, כדי לחשב שוב כשההזמנות משתנות (שיוך ידני)
  const raw = { whatsapp: {}, email: {} };
  function rebuild() {
    const now = Date.now();
    // orders — הגלובלי של admin.html (listenAllOrders). קריאה בלבד.
    const assigned = lgWaInAssignedFrom(typeof orders !== 'undefined' ? orders : []);
    ['whatsapp', 'email'].forEach(ch => {
      byCh[ch] = Object.keys(raw[ch]).map(k => lgWaInRow(k, raw[ch][k], now, ch, assigned));
    });
    rows = byCh.whatsapp.concat(byCh.email).sort((a, b) => b.at - a.at);
  }

  const onSnap = ch => snap => {
    raw[ch] = snap.val() || {};
    rebuild();
    render();
    if (byCh[ch].some(x => x.inProgress)) drain(ch);   // רשת ביטחון — רק כשיש מה לעשות
  };

  //  נקרא מ-renderAll ב-admin.html בכל שינוי בהזמנות, ומ-sq-assign.js אחרי שיוך
  window.lgWaInRefresh = function () { rebuild(); render(); };

  async function post(body) {
    const res = await _lgAuthPost('/api/wa-inbound-drain', body);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: d.error || ('HTTP ' + res.status) };
    return d;
  }

  //  single-flight בתוך הלשונית. בין לשוניות — הטרנזקציה בשרת.
  async function drain(ch) {
    if (draining[ch]) return;
    draining[ch] = true;
    try { await post(ch === 'email' ? { channel: 'email', action: 'drain' } : { action: 'drain' }); }
    catch (e) { console.warn(ch + '-inbound drain:', e && e.message); }
    finally { draining[ch] = false; }
  }

  async function act(action, key, ch) {
    if (busyKey) return;
    let note = '';
    if (action === 'close') {
      note = window.prompt('טופל ידנית — הערה קצרה (לא חובה):', '');
      if (note === null) return;                      // ביטול
    }
    busyKey = key;
    document.querySelectorAll('#waInList [data-key="' + CSS.escape(key) + '"][data-ch="' + CSS.escape(ch) + '"] .wain-btn')
      .forEach(b => { b.disabled = true; });
    try {
      const r = await post(lgWaInActBody(ch, action, key, note));
      if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
    } catch (e) {
      alert('הפעולה לא בוצעה: ' + (e && e.message));
    } finally {
      busyKey = '';
      render();                                       // המאזין יביא את המצב החדש
    }
  }

  function view(orderId) {
    const box = $('waInView'), img = $('waInViewImg');
    if (!box || !img) return;
    img.removeAttribute('src');
    box.hidden = false;
    // שכבת הסקיצה בלבד — לא קוראים את sketches/ ישירות
    lgSketchIntoImg(img, { id: orderId, hasSketch: true });
  }

  //  נפתח על הלשונית שיש בה מה לעשות — WhatsApp קודם
  window.lgWaInOpen = function () {
    const p = $('waInPanel'); if (!p) return;
    p.hidden = false; rebuild();
    const n = attention(); if (!n.wa && n.em) tab = 'email';
    render();
  };
  window.lgWaInClose = function () { const p = $('waInPanel'); if (p) p.hidden = true; closePick(); };

  function wire() {
    // הכפתורים נוצרים מחדש בכל רינדור, ולכן האזנה על הפאנל כולו
    const panel = $('waInPanel');
    if (!panel) return;
    const q = $('waInPickQ');
    if (q) q.addEventListener('input', () => renderAccList(q));
    const px = $('waInPickX'); if (px) px.addEventListener('click', closePick);
    const pb = $('waInPick');
    if (pb) pb.addEventListener('click', ev => {
      if (ev.target === pb) { closePick(); return; }   // נגיעה ברקע הכהה
      const opt = ev.target.closest('.wain-acc-opt'); if (opt) picked(opt.dataset.acc);
    });
    // מקטע מקופל — זוכרים אם פתוח. toggle לא מבעבע, ולכן capture
    panel.addEventListener('toggle', ev => {
      const d = ev.target; if (d && d.dataset && d.dataset.fold) folds[d.dataset.fold] = d.open;
    }, true);
    panel.addEventListener('click', ev => {
      const tb = ev.target.closest('.wain-tab');
      if (tb) { tab = tb.dataset.tab; render(); $('waInList').scrollTop = 0; return; }
      // ⋮ — פותח/סוגר את הפעולה של השורה
      const more = ev.target.closest('.wain-more');
      if (more) {
        const m = more.parentNode.querySelector('.wain-menu');
        if (m) { m.hidden = !m.hidden; more.setAttribute('aria-expanded', m.hidden ? 'false' : 'true'); }
        return;
      }
      const b = ev.target.closest('button[data-gact],button[data-sact],button[data-eact],button[data-tact]'); if (!b) return;
      const row = b.closest('[data-gkey],[data-skey],[data-ekey],[data-tkey]'); if (!row) return;
      const who = (row.querySelector('bdi') || {}).textContent || '';
      if (b.dataset.gact) b.dataset.gact === 'link' ? openPick('g', row.dataset.gkey, who) : groupAct(row.dataset.gkey, b.dataset.gact);
      else if (b.dataset.sact) b.dataset.sact === 'link' ? openPick('s', row.dataset.skey, who) : senderAct(row.dataset.skey, b.dataset.sact);
      else if (b.dataset.eact) b.dataset.eact === 'link' ? openPick('e', row.dataset.ekey, who) : emailAct(row.dataset.ekey, b.dataset.eact);
      else b.dataset.tact === 'add' ? openPick('t', '', '') : textAct(row.dataset.tkey, b.dataset.tact);
    });
    const list = $('waInList');
    if (list) list.addEventListener('click', async ev => {
      const pb = ev.target.closest('button[data-agpilot]');
      if (pb) {   // פיילוט ללקוח — דרך ה-drain; ההאזנה מרעננת
        pb.disabled = true;
        const res = await post({ action: 'agent-pilot', customerId: pb.dataset.cid, on: pb.dataset.on === '1' });
        if (!res.ok) { pb.disabled = false; alert(res.message || 'הפעולה נכשלה'); }
        return;
      }
      const g = ev.target.closest('button[data-agv]');
      if (g) {   // ✓/✗ על רשומת צל — דרך ה-drain; הרשימה מתעדכנת מההאזנה
        g.disabled = true;
        const res = await post({ action: 'agent-verdict', key: g.dataset.key, ok: g.dataset.agv === '1', note: '' });
        if (!res.ok) { g.disabled = false; alert(res.message || 'הסימון נכשל'); }
        return;
      }
      const b = ev.target.closest('button[data-act]'); if (!b) return;
      if (b.dataset.act === 'view') view(b.dataset.order);
      else act(b.dataset.act, b.dataset.key, b.dataset.ch || 'whatsapp');
    });
    const vc = $('waInViewClose'); if (vc) vc.addEventListener('click', () => { $('waInView').hidden = true; });
  }

  function start() {
    wire();
    firebase.auth().onAuthStateChanged(user => {
      if (!user) return;
      _lgDb.ref('waInbound').orderByChild('createdAt').limitToLast(200)
        .on('value', onSnap('whatsapp'), e => console.warn('waInbound listen:', e && e.message));
      // מייל (20/10) — אותו פאנל. emailParts (הבייטים) לא נקראים מכאן אף פעם.
      _lgDb.ref('emailInbound').orderByChild('createdAt').limitToLast(200)
        .on('value', onSnap('email'), e => console.warn('emailInbound listen:', e && e.message));
      _lgDb.ref('waMeta/groupsSeen').on('value', sn => { groupsSeen = sn.val() || {}; render(); },
        e => console.warn('groupsSeen listen:', e && e.message));
      _lgDb.ref('waGroups').on('value', sn => { groupsLinked = sn.val() || {}; render(); },
        e => console.warn('waGroups listen:', e && e.message));
      _lgDb.ref('waMeta/sendersSeen').on('value', sn => { sendersSeen = sn.val() || {}; render(); },
        e => console.warn('sendersSeen listen:', e && e.message));
      _lgDb.ref('waSenders').on('value', sn => { sendersLinked = sn.val() || {}; render(); },
        e => console.warn('waSenders listen:', e && e.message));
      _lgDb.ref('waMeta/emailSendersSeen').on('value', sn => { emailsSeen = sn.val() || {}; render(); },
        e => console.warn('emailSendersSeen listen:', e && e.message));
      _lgDb.ref('waMeta/emailSenders').on('value', sn => { emailsLinked = sn.val() || {}; render(); },
        e => console.warn('emailSenders listen:', e && e.message));
      _lgDb.ref('waMeta/agentShadow').orderByChild('createdAt').limitToLast(100)
        .on('value', sn => { agentShadow = sn.val() || {}; if (tab === 'agents') render(); },
        e => console.warn('agentShadow listen:', e && e.message));
      _lgDb.ref('waMeta/agentPilot').on('value', sn => { agentPilot = sn.val() || {}; if (tab === 'agents') render(); },
        e => console.warn('agentPilot listen:', e && e.message));
      _lgDb.ref('waMeta/agentOutbox').orderByChild('createdAt').limitToLast(300)
        .on('value', sn => { agentOutbox = sn.val() || {}; if (tab === 'agents') render(); },
        e => console.warn('agentOutbox listen:', e && e.message));
      _lgDb.ref('waMeta/textCustomers').on('value', sn => { textCustomers = sn.val() || {}; render(); },
        e => console.warn('textCustomers listen:', e && e.message));
      // כל 2 דקות כל עוד הדף פתוח — ורק אם באמת יש מה לעבד
      if (!timer) timer = setInterval(() => {
        ['whatsapp', 'email'].forEach(ch => { if (byCh[ch].some(x => x.inProgress)) drain(ch); });
      }, 2 * 60 * 1000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
