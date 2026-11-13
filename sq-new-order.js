// ═══════════════════════════════════════════════════════════════════
//  sq-new-order.js — "+ הזמנה חדשה" בתור הסקיצות (admin.html). 13/11.
//
//  בן פותח הזמנה בעצמו: סקיצה, כרטיס חשבשבת (גם מזדמן 99 עם שם הלקוח
//  הפרטי) ונייד. רק "מוכן" והחשבונית יוצאים לנייד הזה — אף פעם לא לטלפון
//  של הכרטיס. אפיון: docs/superpowers/specs/2026-11-13-manual-order-phone-design.md
//
//  ⚠️ הנייד **לא** נכתב על ההזמנה כ-phone / clientPhone. הרשומה המהימנה היא
//  waMeta/manualOrders/<id>, ונכתבת רק בשרת (פעולת manual-order-set). הדפדפן
//  לא יכול לקרוא את waMeta, ולכן ההזמנה נושאת manualNotify (לתצוגה בלבד)
//  ו-manualNotifySaved — האם השרת אישר את הרשומה.
//
//  סדר השמירה: בדיקה → lgNextOrderNum → saveOrder → manual-order-set →
//  updateOrder(manualNotifySaved:true). השרת דורש שההזמנה כבר קיימת.
//
//  wdReadyGroupKey — הקיבוץ של "מוכן" ביום עבודה (workday.html טוען את
//  הקובץ הזה בשבילה). החלק של ה-DOM רץ רק כשיש תור סקיצות בדף.
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-sq-new-order.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const SQ_NEW_ORDER_DEFAULT_ORIGINAL = 'send';
const SQ_CASUAL_KEY = '99';

//  ⚠️ תאום של lgManualPhone ב-api/_manual-order.js — אם אחד משתנה, גם השני.
function sqNewOrderPhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : '';
}

//  f = {image, sketchName, acc:{key,name}, privateName, phone, original}
function sqNewOrderValidate(f) {
  f = f || {};
  const errors = {};
  if (!f.image) errors.image = 'צריך לצרף תמונה של הסקיצה';
  if (!f.acc || !f.acc.key) errors.acc = 'צריך לבחור כרטיס לקוח';
  else if (String(f.acc.key) === SQ_CASUAL_KEY && !String(f.privateName || '').trim())
    errors.privateName = 'ללקוח מזדמן צריך לכתוב את שם הלקוח';
  if (!String(f.phone || '').trim()) errors.phone = 'צריך לכתוב נייד לעדכונים';
  else if (!sqNewOrderPhone(f.phone)) errors.phone = 'המספר לא תקין — צריך נייד שמתחיל ב-05';
  return { ok: !Object.keys(errors).length, errors };
}

//  מה ש-saveOrder מקבל. בלי phone — ר' ההערה למעלה.
function sqNewOrderRecord(f, orderNum) {
  const acc = f.acc || {};
  const key = String(acc.key || '');
  const cardName = String(acc.name || key);
  const is99 = key === SQ_CASUAL_KEY;
  const privateName = is99 ? String(f.privateName || '').trim() : '';
  const name = is99 ? privateName : cardName;
  return {
    source: 'manual', stage: '', orderNum: String(orderNum || ''),
    customerId: key, orderClient: name, client: name, businessName: name,
    priceClient: cardName, privateName,
    sketchName: String(f.sketchName || '').trim(),
    manualNotify: { phone: sqNewOrderPhone(f.phone), original: f.original === 'paper' ? 'paper' : SQ_NEW_ORDER_DEFAULT_ORIGINAL },
    sketch: f.image,
  };
}

//  saved — האם manual-order-set האחרון הצליח להזמנה הזו (manualNotifySaved)
function sqManualStatus(order, saved) {
  return order && order.manualNotify && order.manualNotify.phone && saved ? 'ok' : 'missing';
}

function sqManualLine(order) {
  const n = (order && order.manualNotify) || {};
  const p = String(n.phone || '');
  const shown = p.length === 10 ? p.slice(0, 3) + '-' + p.slice(3) : p;
  return '📱 עדכונים ל-' + shown + ' · מקור: ' + (n.original === 'paper' ? 'הדפסה' : 'לנייד');
}

//  "מוכן" ביום עבודה: הודעה אחת לכל קבוצה. הזמנה ידנית נפרדת לפי הנייד —
//  שני לקוחות מזדמנים בשם "יוסי" עם ניידים שונים לא יתאחדו.
//  ⚠️ תאום של הקיבוץ ב-lgReadyNetPick (api/_ready-net.js) — אם אחד משתנה, גם השני.
function wdReadyGroupKey(o) {
  o = o || {};
  return (o.orderClient || '') + '|' + (o.source === 'manual' && o.manualNotify ? (o.manualNotify.phone || '') : '');
}

// ═══ דפדפן ═══════════════════════════════════════════════════════════
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  let form = null;          // מצב הטופס הפתוח
  let busy = false;
  let cur = null;           // ההזמנה בשורת המצב

  function accounts() {
    return (typeof hashavshevetAccountsMap !== 'undefined' && hashavshevetAccountsMap) || {};
  }
  const esc = s => (typeof lgEsc === 'function' ? lgEsc(s) : String(s == null ? '' : s));
  const toast = m => { if (typeof showToast === 'function') showToast(m); };

  //  אותה הקטנה כמו upload.html (compressImage): רוחב עד 1000, JPEG 0.6
  function shrink(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const s = Math.min(1, 1000 / img.width);
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ─── החלון ──────────────────────────────────────────────────────────
  window.sqNewOrderOpen = function () {
    if (busy) return;
    form = { image: '', sketchName: '', acc: null, privateName: '', phone: '', original: SQ_NEW_ORDER_DEFAULT_ORIGINAL,
             id: '', orderNum: '' };
    let ov = $('sqNewOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'sqNewOv';
      ov.className = 'overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-labelledby', 'sqNewT');
      document.body.appendChild(ov);
      ov.addEventListener('click', onClick);
      ov.addEventListener('input', onInput);
      ov.addEventListener('change', onChange);
      // חיצי מקלדת בתור לא יקפצו לסקיצה אחרת באמצע הקלדה
      ov.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); ev.stopPropagation(); });
    }
    ov.innerHTML = `<div class="modal sqn-modal">
      <div class="mhdr"><h2 id="sqNewT">הזמנה חדשה</h2><button type="button" class="mcl" data-sqn="close" aria-label="סגור">✕</button></div>
      <div class="mbody">
        <div class="sqn-f">
          <span class="sqn-l">סקיצה</span>
          <label class="sqn-file" for="sqNewImg"><span id="sqNewImgT">📷 צלם או בחר תמונה</span></label>
          <input id="sqNewImg" type="file" accept="image/*" class="sqn-hide">
          <img id="sqNewPrev" class="sqn-prev" alt="הסקיצה שנבחרה" hidden>
          <div class="sqn-err" id="sqNewE_image"></div>
        </div>
        <div class="sqn-f">
          <label class="sqn-l" for="sqNewName">שם הסקיצה <span class="sqn-opt">(לא חובה)</span></label>
          <input id="sqNewName" class="sqn-in" type="text" autocomplete="off" placeholder="למשל: מקלחון חדר רחצה">
        </div>
        <div class="sqn-f">
          <span class="sqn-l" id="sqNewAccL">כרטיס לקוח בחשבשבת</span>
          <div id="sqNewAcc"></div>
          <div class="sqn-err" id="sqNewE_acc"></div>
        </div>
        <div class="sqn-f" id="sqNewPrivW" hidden>
          <label class="sqn-l" for="sqNewPriv">שם הלקוח</label>
          <input id="sqNewPriv" class="sqn-in" type="text" autocomplete="off" maxlength="80" placeholder="למשל: יוסי כהן">
          <div class="sqn-err" id="sqNewE_privateName"></div>
        </div>
        <div class="sqn-f">
          <label class="sqn-l" for="sqNewPhone">נייד לעדכונים</label>
          <input id="sqNewPhone" class="sqn-in" type="tel" inputmode="numeric" dir="ltr" autocomplete="off" placeholder="05X-XXXXXXX">
          <div class="sqn-hint">רק "מוכן" והחשבונית יוצאים למספר הזה.</div>
          <div class="sqn-err" id="sqNewE_phone"></div>
        </div>
        <fieldset class="sqn-f sqn-fs">
          <legend class="sqn-l">מקור החשבונית:</legend>
          <div class="sqn-radios">
            <label class="sqn-radio"><input type="radio" name="sqNewOrig" value="send" checked> 📱 לשלוח לנייד</label>
            <label class="sqn-radio"><input type="radio" name="sqNewOrig" value="paper"> 🖨 להדפיס</label>
          </div>
        </fieldset>
        <div class="sqn-err sqn-err-all" id="sqNewE_all" role="alert"></div>
      </div>
      <div class="mfoot">
        <button type="button" class="btn-save" id="sqNewSave" data-sqn="save">שמור הזמנה</button>
        <button type="button" class="btn-cancel" data-sqn="close">ביטול</button>
      </div>
    </div>`;
    renderAcc();
    ov.classList.add('open');
  };

  function close() {
    if (busy) return;
    const ov = $('sqNewOv'); if (ov) { ov.classList.remove('open'); ov.innerHTML = ''; }
    form = null;
  }

  // ─── בחירת כרטיס ───────────────────────────────────────────────────
  function renderAcc() {
    const box = $('sqNewAcc'); if (!box || !form) return;
    const priv = $('sqNewPrivW');
    if (priv) priv.hidden = !(form.acc && form.acc.key === SQ_CASUAL_KEY);
    if (form.acc) {
      box.innerHTML = `<div class="sqn-chosen"><span class="sqn-chosen-n">${esc(form.acc.name)}</span>
        <span class="sqn-key" dir="ltr">${esc(form.acc.key)}</span>
        <button type="button" class="sqn-btn sqn-quiet" data-sqn="change">שנה</button></div>`;
      return;
    }
    box.innerHTML = `<div class="sqn-row">
        <input id="sqNewQ" class="sqn-in" type="search" placeholder="שם הלקוח או מפתח" aria-labelledby="sqNewAccL" autocomplete="off">
        <button type="button" class="sqn-btn" data-sqn="casual">מזדמן (99)</button></div>
      <div class="sqn-list" id="sqNewList"></div>`;
    renderList('');
  }

  function renderList(q) {
    const list = $('sqNewList'); if (!list) return;
    const all = accounts();
    const hits = String(q || '').trim() ? sqAssignSearch(all, q) : [];
    list.innerHTML = hits.length
      ? hits.map(a => `<button type="button" class="sqa-opt" data-acc="${esc(a.key)}">
           <span>${esc(a.name || a.key)}</span><span class="sqa-key" dir="ltr">${esc(a.key)}</span></button>`).join('')
      : !Object.keys(all).length ? '<div class="sqa-none">כרטיסי הלקוחות מחשבשבת עוד לא נטענו.</div>'
      : String(q || '').trim() ? '<div class="sqa-none">לא נמצא כרטיס כזה. נסה חלק מהשם או את המפתח.</div>' : '';
  }

  function pick(key) {
    const a = accounts()[key];
    if (!a) {
      setErr('acc', key === SQ_CASUAL_KEY ? 'כרטיס 99 לא נמצא — סנכרן לקוחות' : 'כרטיס הלקוח לא נמצא');
      return;
    }
    form.acc = { key: String(a.key), name: String(a.name || a.key) };
    setErr('acc', '');
    renderAcc();
    const f = form.acc.key === SQ_CASUAL_KEY ? $('sqNewPriv') : $('sqNewPhone');
    if (f) f.focus();
  }

  function setErr(field, msg) {
    const e = $('sqNewE_' + field); if (e) e.textContent = msg || '';
  }

  // ─── אירועים ───────────────────────────────────────────────────────
  function onClick(ev) {
    const ov = $('sqNewOv');
    if (ev.target === ov) { close(); return; }
    const b = ev.target.closest('button'); if (!b || b.disabled) return;
    const a = b.dataset.sqn;
    if (a === 'close') close();
    else if (a === 'save') save();
    else if (a === 'casual') pick(SQ_CASUAL_KEY);
    else if (a === 'change') { form.acc = null; renderAcc(); const q = $('sqNewQ'); if (q) q.focus(); }
    else if (b.dataset.acc) pick(b.dataset.acc);
  }

  function onInput(ev) {
    if (!form) return;
    const t = ev.target;
    if (t.id === 'sqNewQ') renderList(t.value);
    else if (t.id === 'sqNewName') form.sketchName = t.value;
    else if (t.id === 'sqNewPriv') { form.privateName = t.value; setErr('privateName', ''); }
    else if (t.id === 'sqNewPhone') { form.phone = t.value; setErr('phone', ''); }
  }

  function onChange(ev) {
    if (!form) return;
    const t = ev.target;
    if (t.name === 'sqNewOrig') form.original = t.value === 'paper' ? 'paper' : 'send';
    else if (t.id === 'sqNewImg' && t.files && t.files[0]) {
      const file = t.files[0];
      if (!/^image\//.test(file.type || '')) { setErr('image', 'אפשר לצרף רק תמונה'); return; }
      const r = new FileReader();
      r.onload = async () => {
        if (!form) return;
        form.image = await shrink(r.result);
        const p = $('sqNewPrev'); if (p) { p.src = form.image; p.hidden = false; }
        const l = $('sqNewImgT'); if (l) l.textContent = '📷 החלף תמונה';
        setErr('image', '');
      };
      r.onerror = () => setErr('image', 'לא הצלחתי לקרוא את התמונה — נסה שוב');
      r.readAsDataURL(file);
    }
  }

  // ─── שמירה ─────────────────────────────────────────────────────────
  async function save() {
    if (busy || !form) return;
    ['image', 'acc', 'privateName', 'phone', 'all'].forEach(k => setErr(k, ''));
    const v = sqNewOrderValidate(form);
    if (!v.ok) {
      Object.keys(v.errors).forEach(k => setErr(k, v.errors[k]));
      const first = { image: 'sqNewImg', acc: 'sqNewQ', privateName: 'sqNewPriv', phone: 'sqNewPhone' }[Object.keys(v.errors)[0]];
      const el = $(first); if (el && el.type !== 'file') el.focus();
      return;
    }
    busy = true;
    const btn = $('sqNewSave'); if (btn) { btn.disabled = true; btn.textContent = 'שומר…'; }
    let id = '';
    try {
      // ⚠️ מספר ומזהה נקבעים פעם אחת: ניסיון חוזר אחרי כישלון דורס את אותה
      //  הזמנה ולא פותח שנייה עם מספר חדש.
      if (!form.orderNum) form.orderNum = await lgNextOrderNum();
      if (!form.id) form.id = 'ord_' + Date.now();
      const rec = sqNewOrderRecord(form, form.orderNum);
      id = await saveOrder({ ...rec, id: form.id });
    } catch (e) {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'שמור הזמנה'; }
      setErr('all', 'ההזמנה לא נשמרה — נסה שוב');
      console.error('[sq-new-order] save failed:', e);
      return;
    }
    const sent = { privateName: form.privateName, original: form.original, phone: form.phone };
    busy = false;
    close();
    const ok = await setPhone(id, sent);
    toast(ok ? 'ההזמנה נשמרה' : 'ההזמנה נשמרה, אבל הטלפון לא נשמר — נסה שוב');
    openInQueue(id);
  }

  //  manual-order-set → updateOrder(manualNotifySaved). מחזיר true/false.
  async function setPhone(id, f) {
    try {
      const res = await _lgAuthPost('/api/wa-inbound-drain', {
        action: 'manual-order-set', orderId: id, phone: f.phone,
        original: f.original === 'paper' ? 'paper' : 'send',
        ...(String(f.privateName || '').trim() ? { privateName: String(f.privateName).trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { console.warn('[sq-new-order] manual-order-set:', data.code || res.status); return false; }
      await updateOrder(id, {
        manualNotifySaved: true,
        manualNotify: { phone: sqNewOrderPhone(f.phone), original: f.original === 'paper' ? 'paper' : 'send' },
      });
      return true;
    } catch (e) {
      console.error('[sq-new-order] manual-order-set failed:', e);
      return false;
    }
  }

  //  ההזמנה החדשה בלי "נראה" → הטאב "עוד לא נראה". המאזין בונה את התור מחדש;
  //  מחכים לה עד 5 שניות ופותחים אותה.
  function openInQueue(id) {
    if (typeof sqSeenTab !== 'undefined' && sqSeenTab === 'seen' && typeof sqSetSeenTab === 'function') sqSetSeenTab('unseen');
    let n = 0;
    const t = setInterval(() => {
      const there = typeof sqItems !== 'undefined' && sqItems.some(i => String(i.id) === String(id));
      if (there || ++n > 25) {
        clearInterval(t);
        if (there && typeof sqSelect === 'function') sqSelect(id);
      }
    }, 200);
  }

  // ─── שורת המצב בסקיצה ──────────────────────────────────────────────
  //  נקרא מ-sqShowDetail בכל פתיחת סקיצה
  window.sqManualShow = function (o) {
    const box = $('sqManualWrap'); if (!box) return;
    cur = o && o.source === 'manual' ? o : null;
    if (!cur) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const st = sqManualStatus(cur, !!cur.manualNotifySaved);
    box.classList.toggle('sqm-bad', st !== 'ok');
    box.innerHTML = st === 'ok'
      ? `<div class="sqm-row"><span class="sqm-t">${esc(sqManualLine(cur))}</span>
           <button type="button" class="sqm-btn" data-sqm="edit" aria-label="שנה נייד או מקור">✎</button></div>`
      : `<div class="sqm-row"><span class="sqm-t">הטלפון לא נשמר — נסה שוב</span>
           <button type="button" class="sqm-btn sqm-retry" data-sqm="${cur.manualNotify && cur.manualNotify.phone ? 'retry' : 'edit'}">נסה שוב</button>
           <button type="button" class="sqm-btn" data-sqm="edit" aria-label="שנה נייד או מקור">✎</button></div>`;
  };

  function editForm() {
    const box = $('sqManualWrap'); if (!box || !cur) return;
    const n = cur.manualNotify || {};
    box.innerHTML = `<div class="sqm-edit">
        <label class="sqn-l" for="sqmPhone">נייד לעדכונים</label>
        <input id="sqmPhone" class="sqn-in" type="tel" inputmode="numeric" dir="ltr" autocomplete="off" value="${esc(n.phone || '')}">
        <fieldset class="sqn-fs"><legend class="sqn-l">מקור החשבונית:</legend>
          <div class="sqn-radios">
            <label class="sqn-radio"><input type="radio" name="sqmOrig" value="send" ${n.original === 'paper' ? '' : 'checked'}> 📱 לשלוח לנייד</label>
            <label class="sqn-radio"><input type="radio" name="sqmOrig" value="paper" ${n.original === 'paper' ? 'checked' : ''}> 🖨 להדפיס</label>
          </div></fieldset>
        <div class="sqn-err" id="sqmErr" role="alert"></div>
        <div class="sqm-row">
          <button type="button" class="sqm-btn sqm-save" data-sqm="save">שמור</button>
          <button type="button" class="sqm-btn" data-sqm="cancel">ביטול</button>
        </div>
      </div>`;
    const p = $('sqmPhone'); if (p) p.focus();
  }

  async function runSet(o, f) {
    const box = $('sqManualWrap');
    if (box) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const ok = await setPhone(o.id, f);
    if (ok) {
      // המאזין יביא את ההזמנה המעודכנת; עד אז — מה שעל המסך
      const same = i => i && String(i.id) === String(o.id);
      [o, (typeof sqItems !== 'undefined' ? sqItems : []).find(same)].forEach(x => {
        if (!x) return;
        x.manualNotifySaved = true;
        x.manualNotify = { phone: sqNewOrderPhone(f.phone), original: f.original === 'paper' ? 'paper' : 'send' };
      });
      toast('הטלפון נשמר');
    } else {
      toast('הטלפון לא נשמר — נסה שוב');
    }
    if (cur && String(cur.id) === String(o.id)) window.sqManualShow(o);
  }

  function wireStatus() {
    const box = $('sqManualWrap'); if (!box) return;
    box.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled || !cur) return;
      const a = b.dataset.sqm;
      const n = cur.manualNotify || {};
      if (a === 'edit') editForm();
      else if (a === 'cancel') window.sqManualShow(cur);
      else if (a === 'retry') runSet(cur, { phone: n.phone, original: n.original, privateName: cur.privateName || '' });
      else if (a === 'save') {
        const phone = ($('sqmPhone') || {}).value || '';
        if (!sqNewOrderPhone(phone)) { const e = $('sqmErr'); if (e) e.textContent = 'המספר לא תקין — צריך נייד שמתחיל ב-05'; return; }
        const orig = (box.querySelector('input[name="sqmOrig"]:checked') || {}).value;
        runSet(cur, { phone, original: orig, privateName: cur.privateName || '' });
      }
    });
    box.addEventListener('keydown', ev => { ev.stopPropagation(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireStatus);
  else wireStatus();
})();
