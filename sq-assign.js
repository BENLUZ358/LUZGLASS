// ═══════════════════════════════════════════════════════════════════
//  sq-assign.js — "שייך ללקוח" בתור הסקיצות (admin.html). 20/10.
//
//  הזמנה שהגיעה במייל או בוואטסאפ ולא זוהה לה לקוח נכנסת לתור על
//  "לא מזוהה" (emailUnassigned / waUnassigned). עד היום לא היה איפה לשייך
//  אותה — הסימון רק ישב שם (אפיון מייל §3.4, תיקון בדיקת הקוד). כאן:
//  כפתור בתוך הסקיצה, חיפוש בכרטיסי חשבשבת, בחירה → עדכון ההזמנה.
//
//  ⚠️ השיוך **לא** כותב את כתובת המייל של השולח על הכרטיס. המקור לאמת
//  הוא חשבשבת; בן מעדכן שם (אפיון §3.4). ההזמנה שומרת את emailFrom כמו
//  שהוא — לשם תצא התשובה.
//
//  ⚠️ טלפון הכניסה: המשתמש ב-users שה-customerId שלו הוא מפתח הכרטיס —
//  אותו כלל בדיוק כמו lgClientFromWaGroup (api/_wa-recipient.js). בלעדיו
//  הסקיצה לא מופיעה ללקוח בפורטל.
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-sq-assign.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const SQ_ASSIGN_MAX = 20;

//  כרטיסים שהשם או המפתח שלהם מכילים את מה שהוקלד. עד 20, לפי שם.
function sqAssignSearch(accounts, q) {
  const t = String(q || '').trim().toLowerCase();
  return Object.values(accounts || {})
    .filter(a => a && a.key)
    .filter(a => !t || String(a.name || '').toLowerCase().includes(t) || String(a.key).toLowerCase().includes(t))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'))
    .slice(0, SQ_ASSIGN_MAX)
    .map(a => ({ key: String(a.key), name: String(a.name || '') }));
}

//  טלפון הכניסה של הכרטיס. users — האובייקט מ-Firebase (מפתח = טלפון)
//  או מערך רשומות עם phone. אין משתמש כזה → ''.
function sqAssignLoginPhone(users, key) {
  const k = String(key || '');
  if (!k || !users) return '';
  if (Array.isArray(users)) {
    const u = users.find(x => x && String(x.customerId || '') === k);
    return u ? String(u.phone || u.id || '') : '';
  }
  return Object.keys(users).find(p => users[p] && String(users[p].customerId || '') === k) || '';
}

//  מתי מציגים את הכפתור
function sqAssignNeeded(o) {
  return !!(o && (o.waUnassigned || o.emailUnassigned || o.isTest));
}

//  השיוך עצמו — דרך updateOrder בלבד (firebase-db.js).
async function lgAssignOrderToAccount(orderId, acc, loginPhone) {
  if (!orderId || !acc || !acc.key) throw new Error('לא נבחר כרטיס לקוח');
  const name = String(acc.name || acc.key);
  await updateOrder(orderId, {
    customerId: String(acc.key), orderClient: name, client: name, businessName: name,
    waUnassigned: false, emailUnassigned: false,
    ...(loginPhone ? { phone: loginPhone, clientPhone: loginPhone } : {}),
  });
}

// ═══ דפדפן ═══════════════════════════════════════════════════════════
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  let cur = null, busy = false;

  function accounts() {
    return (typeof hashavshevetAccountsMap !== 'undefined' && hashavshevetAccountsMap) || {};
  }

  //  נקרא מ-sqShowDetail בכל פתיחת סקיצה
  window.sqAssignShow = function (o) {
    const box = $('sqAssignWrap'); if (!box) return;
    cur = o || null;
    if (!sqAssignNeeded(o)) { box.hidden = true; box.innerHTML = ''; return; }
    const from = o.emailUnassigned && o.emailFrom
      ? ' — נשלחה מ-<span class="sqa-from">' + lgEsc(o.emailFrom) + '</span>' : '';
    box.hidden = false;
    box.innerHTML = '<div class="sqa-msg">'+(o.isTest?(o.customerId?'משויך לכרטיס '+lgEsc(o.customerId)+' — '+lgEsc(o.orderClient||o.client||'')+'. אפשר לשנות את השיוך.':'שם הבדיקה אינו שיוך ללקוח. בחר כרטיס לקוח כדי להפעיל את פרופיל הלמידה שלו.'):'הלקוח של הסקיצה הזו לא זוהה'+from+'. בחר את כרטיס הלקוח שלה בחשבשבת.')+'</div><div class="sqa-row"><button type="button" class="sqa-btn" data-sqa="open">'+(o.customerId?'שנה לקוח':'שייך ללקוח')+'</button></div>';
  };

  function openPicker() {
    const box = $('sqAssignWrap'); if (!box || !cur) return;
    box.querySelector('.sqa-row').outerHTML = `<div class="sqa-row">
        <input id="sqAssignQ" type="search" placeholder="שם הלקוח או מפתח בחשבשבת" aria-label="חיפוש כרטיס לקוח" autocomplete="off">
        <button type="button" class="sqa-btn sqa-quiet" data-sqa="cancel">ביטול</button></div>
      <div class="sqa-list"></div>`;
    const q = $('sqAssignQ');
    renderList('');
    q.focus();
  }

  function renderList(q) {
    const list = document.querySelector('#sqAssignWrap .sqa-list'); if (!list) return;
    const hits = sqAssignSearch(accounts(), q);
    list.innerHTML = hits.length
      ? hits.map(a => `<button type="button" class="sqa-opt" data-acc="${lgEsc(a.key)}">
           <span>${lgEsc(a.name || a.key)}</span><span class="sqa-key" dir="ltr">${lgEsc(a.key)}</span></button>`).join('')
      : `<div class="sqa-none">${Object.keys(accounts()).length
          ? 'לא נמצא כרטיס כזה. נסה חלק מהשם או את המפתח בחשבשבת.'
          : 'כרטיסי הלקוחות מחשבשבת עוד לא נטענו.'}</div>`;
  }

  async function choose(key) {
    if (busy || !cur) return;
    const a = accounts()[key];
    if (!a) { alert('כרטיס הלקוח לא נמצא'); return; }
    let acc = { key: String(a.key), name: String(a.name || a.key) };
    if (!confirm('לשייך את הסקיצה ל"' + acc.name + '" (' + acc.key + ')?')) return;
    const o = cur;
    busy = true;
    document.querySelectorAll('#sqAssignWrap button').forEach(b => { b.disabled = true; });
    try {
      // ⚠️ users נקרא טרי ולא מהמטמון של הדף — מפתח = טלפון, כמו בשרת
      let phone='';
      if(o.isTest){
        const response=await _lgAuthPost('/api/sketch-reader',{action:'assignClient',orderId:o.id,customerId:acc.key});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'השיוך לא נשמר');
        phone=data.fields.clientPhone;acc={key:data.fields.customerId,name:data.fields.orderClient};
      }else{
        const users = (await _lgDb.ref('users').once('value')).val() || {};
        phone = sqAssignLoginPhone(users, acc.key);
        await lgAssignOrderToAccount(o.id, acc, phone);
      }
      // המאזין יביא את ההזמנה המעודכנת; עד אז — מה שעל המסך (כולל orders,
      // שממנו פאנל הקליטות יודע שהקליטה כבר לא דורשת טיפול)
      const same = i => i && String(i.id) === String(o.id);
      [o, (typeof sqItems !== 'undefined' ? sqItems : []).find(same),
          (typeof orders !== 'undefined' && Array.isArray(orders) ? orders : []).find(same)].forEach(x => {
        if (!x) return;
        x.customerId = acc.key;
        x.client = x.orderClient = x.businessName = acc.name;
        x.waUnassigned = x.emailUnassigned = false;
        if (phone || o.isTest) x.phone = x.clientPhone = phone;
      });
      const h = $('sqDClient'); if (h && cur === o) h.textContent = acc.name;
      if (cur === o) window.sqAssignShow(o);
      if (typeof sqRender === 'function') sqRender();
      if (typeof lgWaInRefresh === 'function') lgWaInRefresh();
      if (typeof showToast === 'function') showToast('שויך ל-' + acc.name);
    } catch (e) {
      alert('השיוך לא נשמר: ' + (e && e.message));
      document.querySelectorAll('#sqAssignWrap button').forEach(b => { b.disabled = false; });
    } finally {
      busy = false;
    }
  }

  function wire() {
    const box = $('sqAssignWrap'); if (!box) return;
    box.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.sqa === 'open') openPicker();
      else if (b.dataset.sqa === 'cancel') window.sqAssignShow(cur);
      else if (b.dataset.acc) choose(b.dataset.acc);
    });
    box.addEventListener('input', ev => { if (ev.target.id === 'sqAssignQ') renderList(ev.target.value); });
    // חיצי מקלדת בתור (← →) לא יקפצו לסקיצה הבאה באמצע הקלדה
    box.addEventListener('keydown', ev => { if (ev.target.id === 'sqAssignQ') ev.stopPropagation(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
