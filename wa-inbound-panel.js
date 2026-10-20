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
function _waInAddr(from) {
  const s = String(from || '');
  const m = s.match(/<([^<>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
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
//  מכאן והלאה רק בדפדפן. ב-Node (בדיקות) אין document, ולכן לא רץ כלום.
if (typeof document !== 'undefined') (function () {
  // שורות לכל ערוץ בנפרד — כל מאזין מחליף רק את שלו; rows = שניהם יחד
  let rows = [], byCh = { whatsapp: [], email: [] }, showAll = false, timer = null, busyKey = '';
  const draining = { whatsapp: false, email: false };

  const $ = id => document.getElementById(id);

  // ─── קבוצות WhatsApp (בן, 06/10) ──────────────────────────────────
  //  כל קבוצה שמספר העסק חבר בה ושלחה תמונה מופיעה כאן (רק שמה נשמר).
  //  "קשר ללקוח" → כל תמונה בה נכנסת לתור על הלקוח, והעדכון יוצא לקבוצה.
  //  הכתיבה דרך /api/wa-inbound-drain (link-group) — לא ישירות.
  let groupsSeen = {}, groupsLinked = {};

  function groupsBox() {
    let box = $('waInGroups');
    if (!box) {
      const list = $('waInList'); if (!list) return null;
      box = document.createElement('div'); box.id = 'waInGroups';
      list.parentNode.insertBefore(box, list);
    }
    return box;
  }

  // בחירת לקוח לקבוצה — רשימה גלויה מתחת לשדה (07/10). רשימת ההצעות המובנית של הדפדפן ב-iOS
  // מציג הצעות רק מעל המקלדת ורק כשיש התאמה, ונראה כמו שדה שלא עושה כלום.
  function accountMatches(q) {
    const m = (typeof hashavshevetAccountsMap !== 'undefined' && hashavshevetAccountsMap) || {};
    const t = String(q || '').trim().toLowerCase();
    return Object.values(m).filter(a => a && a.key)
      .filter(a => !t || String(a.name || '').toLowerCase().includes(t) || String(a.key).toLowerCase().includes(t))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
      .slice(0, 8);
  }
  function renderAccList(input) {
    const list = input && input.parentNode.parentNode.querySelector('.wain-acc-list');
    if (!list) return;
    const hits = accountMatches(input.value);
    list.hidden = false;
    list.innerHTML = hits.length
      ? hits.map(a => `<button type="button" class="wain-acc-opt" data-acc="${_waInEsc(a.key)}" data-name="${_waInEsc(a.name || '')}">
           <span>${_waInEsc(a.name || '')}</span><span class="wain-acc-key" dir="ltr">${_waInEsc(a.key)}</span></button>`).join('')
      : `<div class="wain-acc-none">לא נמצא כרטיס בשם הזה. נסה חלק מהשם או את מפתח הלקוח בחשבשבת.</div>`;
  }

  function renderGroups() {
    const box = groupsBox(); if (!box) return;
    // מקלידים שם לקוח — רענון חי (הודעה נכנסת) לא מוחק את מה שהוקלד
    if (box.contains(document.activeElement) && document.activeElement.classList.contains('wain-acc')) return;
    const keys = Object.keys(groupsSeen);
    if (!keys.length) { box.innerHTML = ''; return; }
    keys.sort((a, b) => (!!groupsLinked[a]) - (!!groupsLinked[b]) || (groupsSeen[b].lastAt || 0) - (groupsSeen[a].lastAt || 0));
    box.innerHTML = `<div class="wain-gtitle">קבוצות WhatsApp</div>` + keys.map(k => {
      const g = groupsSeen[k], l = groupsLinked[k];
      return `<div class="wain-row ${l ? 'wain-ok' : 'wain-warn'}" data-gkey="${_waInEsc(k)}">
        <div class="wain-l1"><span class="wain-chip">${l ? 'מקושרת' : 'קבוצה חדשה'}</span>
          <span class="wain-client">${_waInEsc(g.name || 'קבוצה ללא שם')}</span>
          <span class="wain-when">${_waInEsc(_waInWhen(g.lastAt))}</span></div>
        ${l ? `<div class="wain-reason">לקוח: <b>${_waInEsc(l.customerName || l.customerId)}</b> — כל תמונה בקבוצה נכנסת לתור, והעדכון "הסקיצות טופלו" יוצא לקבוצה.</div>
               <div class="wain-acts"><button class="wain-btn" data-gact="unlink">נתק</button></div>`
            : `<div class="wain-reason">${g.count || 1} תמונות נשלחו מהקבוצה ולא נקלטו. קשר אותה ללקוח, והתמונות הבאות ייכנסו לתור.</div>
               <div class="wain-acts"><input class="wain-acc" placeholder="שם הלקוח או מפתח בחשבשבת" aria-label="לקוח לקבוצה" autocomplete="off">
                 <button class="wain-btn wain-primary" data-gact="link">קשר ללקוח</button></div>
               <div class="wain-acc-list" hidden></div>`}
      </div>`;
    }).join('');
  }

  async function groupAct(key, action, input) {
    let customerId = '';
    if (action === 'link') {
      // נבחר מהרשימה → data-acc; אחרת מה שהוקלד (מפתח, או "שם · מפתח")
      const v = String((input && input.value) || '');
      customerId = String((input && input.dataset.acc) || v.split('·').pop() || '').trim();
      if (!customerId) { alert('בחר לקוח מהרשימה'); return; }
    } else if (!confirm('לנתק את הקבוצה? תמונות חדשות ממנה לא ייכנסו לתור.')) return;
    const r = await post({ action: action === 'link' ? 'link-group' : 'unlink-group', key, customerId });
    if (!r.ok) alert(r.message || 'הפעולה לא בוצעה');
  }

  function badge() {
    const c = lgWaInCounts(rows);
    // קבוצה חדשה שלא קושרה — גם היא דורשת טיפול
    c.attention += Object.keys(groupsSeen).filter(k => !groupsLinked[k]).length;
    const a = $('waInBadgeA'), p = $('waInBadgeP');
    if (a) { a.textContent = '⚠ ' + c.attention; a.hidden = !c.attention; }
    if (p) { p.textContent = '⏳ ' + c.inProgress; p.hidden = !c.inProgress; }
  }

  function render() {
    badge();
    renderGroups();
    const list = $('waInList'); if (!list) return;
    const shown = rows.filter(x => showAll || x.needsAttention || x.inProgress);
    list.innerHTML = shown.length ? shown.map(lgWaInRowHtml).join('')
      : `<div class="wain-empty">${showAll ? 'אין עדיין קליטות.' : 'אין קליטות שדורשות טיפול ✓'}</div>`;
    const t = $('waInToggle'); if (t) t.textContent = showAll ? 'רק מה שדורש טיפול' : 'הצג הכל';
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

  window.lgWaInOpen = function () { const p = $('waInPanel'); if (p) { p.hidden = false; rebuild(); render(); } };
  window.lgWaInClose = function () { const p = $('waInPanel'); if (p) p.hidden = true; };

  function wire() {
    // קבוצות — הכפתורים נוצרים מחדש בכל רינדור, ולכן האזנה על הפאנל כולו
    const panel = $('waInPanel');
    if (panel) {
      ['input', 'focusin'].forEach(evn => panel.addEventListener(evn, ev => {
        const inp = ev.target.closest && ev.target.closest('.wain-acc'); if (!inp) return;
        if (evn === 'input') delete inp.dataset.acc;          // הקלדה מבטלת בחירה קודמת
        // נגיעה בשדה שכבר נבחר בו לקוח — לא לפתוח רשימה (היא הייתה מחפשת את
        // "שם · מפתח" כולו ומציגה "לא נמצא"). שדה ריק — כל הכרטיסים.
        else if (inp.dataset.acc) return;
        renderAccList(inp);
      }));
      panel.addEventListener('click', ev => {
        const opt = ev.target.closest('.wain-acc-opt'); if (!opt) return;
        const row = opt.closest('[data-gkey]'); const inp = row && row.querySelector('.wain-acc');
        if (!inp) return;
        inp.value = opt.dataset.name + ' · ' + opt.dataset.acc;
        inp.dataset.acc = opt.dataset.acc;
        opt.parentNode.hidden = true;
      });
    }
    if (panel) panel.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-gact]'); if (!b) return;
      const row = b.closest('[data-gkey]'); if (!row) return;
      groupAct(row.dataset.gkey, b.dataset.gact, row.querySelector('.wain-acc'));
    });
    const list = $('waInList');
    if (list) list.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-act]'); if (!b) return;
      if (b.dataset.act === 'view') view(b.dataset.order);
      else act(b.dataset.act, b.dataset.key, b.dataset.ch || 'whatsapp');
    });
    const t = $('waInToggle'); if (t) t.addEventListener('click', () => { showAll = !showAll; render(); });
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
      // כל 2 דקות כל עוד הדף פתוח — ורק אם באמת יש מה לעבד
      if (!timer) timer = setInterval(() => {
        ['whatsapp', 'email'].forEach(ch => { if (byCh[ch].some(x => x.inProgress)) drain(ch); });
      }, 2 * 60 * 1000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
