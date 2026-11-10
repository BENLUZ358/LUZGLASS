// ═══════════════════════════════════════════════════════════════════
//  drafter-batch.js — מגירת "טיוטה לשרטט" בתחתית תור הסקיצות (admin.html).
//  בן, 10/11. אפיון: docs/superpowers/specs/2026-11-10-drafter-pdf-batches-design.md
//
//  בן פותח הזמנות ברצף מהתור. כל הזמנה שנשלחת לחשבשבת נכנסת לטיוטה (סל),
//  ובמגירה למטה תמיד רואים מה כבר נכנס ומחכה. "לא לשלוח עכשיו" מוציא הזמנה
//  מהטיוטה (ו"החזר" מחזיר). כשהתור ריק — "שלח לשרטט": PDF אחד במייל ל-lozzagagot.
//  "השרטט סיים" מעביר את כל מה שנשלח ל"בנה יום עבודה" (opty).
//  הכל דרך /api/wa-inbound-drain (drafter-status/-send/-done/-resend/-hold).
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-drafter-ui.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const _dbCount = n => n === 1 ? 'הזמנה אחת' : n + ' הזמנות';
const _dbTime = t => new Date(t).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
const _DB_MAIL = { pending: 'המייל בדרך', sent: 'המייל נשלח', failed: 'המייל נכשל', expired: 'המייל נכשל', cancelled: 'המייל נכשל' };

function drafterBarModel(st) {
  const basket = (st && st.basket) || [], open = (st && st.open) || [];
  return {
    basketText: basket.length ? 'בסל: ' + _dbCount(basket.length) : 'הסל ריק',
    canSend: basket.length > 0,
    sendLabel: basket.length ? 'שלח לשרטט (' + basket.length + ')' : 'שלח לשרטט',
    open: open.map(b => ['משלוח ' + b.n, _dbTime(b.at), _dbCount(b.count), _DB_MAIL[b.emailState] || ''].filter(Boolean).join(' · ')),
    canDone: open.length > 0,
    //  משלוחים שהמייל שלהם נכשל — כפתור "שלח שוב" (סקירה 10/11)
    resend: open.filter(b => ['failed', 'expired', 'cancelled'].includes(b.emailState)).map(b => b.n),
  };
}
const drafterTrayTitle = st => {
  const n = ((st && st.basket) || []).length;
  return 'טיוטה לשרטט · ' + (n ? _dbCount(n) : 'ריקה');
};
const drafterItemLine = it => [it.orderNum, it.client, it.sketchName].filter(Boolean).join(' · ');
const drafterAddedToast = n => 'נכנסה לטיוטה לשרטט (' + n + ')';
const drafterSendConfirm = n => 'לשלוח ' + n + ' הזמנות לשרטט במייל?';
const drafterDoneConfirm = n => 'להעביר את כל מה שנשלח לשרטט (' + n + ') ל"בנה יום עבודה"?';
function drafterDoneText(r) {
  const moved = (r && r.moved) || [], skipped = (r && r.skipped) || [], held = (r && r.held) || [];
  if (!moved.length && !skipped.length && !held.length) return 'אין הזמנות שנשלחו לשרטט ומחכות';
  const out = ['עברו ל"בנה יום עבודה": ' + (moved.length ? _dbCount(moved.length) : '0 הזמנות')];
  if (skipped.length) out.push('לא הועברו:', ...skipped.map(s => (s.orderNum || s.id) + ' — ' + s.reason));
  held.forEach(n => out.push('משלוח ' + n + ' לא הועבר — המייל שלו לא יצא. לחץ "שלח שוב" ליד המשלוח.'));
  return out.join('\n');
}
//  תחנת שרטט — כרטיס לכל משלוח (קובץ) שנשלח ועוד לא "השרטט סיים" (בן, 10/11)
function drafterBatchCard(b) {
  return {
    title: ['משלוח ' + b.n, _dbTime(b.at), _dbCount(b.count)].join(' · '),
    mail: _DB_MAIL[b.emailState] || '',
    lines: (b.orders || []).map(o => drafterItemLine(o) + (o.stage && o.stage !== 'drafter' && o.stage !== 'chash' ? ' · כבר לא אצל שרטט' : '')),
  };
}
const drafterDoneOneConfirm = b => 'השרטט סיים את משלוח ' + b.n + ' (' + _dbCount(b.count) + ')? הן יעברו ל"בנה יום עבודה".';

function drafterTag(o) {
  if (!o || (o.stage !== 'drafter' && o.stage !== 'chash')) return '';
  if (o.drafterHold) return 'לא לשלוח עכשיו';
  return o.drafterBatch != null ? 'נשלח · משלוח ' + o.drafterBatch : 'בטיוטה לשרטט';
}

// ─── DOM ────────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  let busy = false, last = null, expanded = false;
  const el = () => document.getElementById('drafterBar');

  async function post(body) {
    const res = await _lgAuthPost('/api/wa-inbound-drain', body);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: d.error || ('שגיאה ' + res.status) };
    return d;
  }
  //  קובץ PDF בלשונית חדשה. החלון נפתח לפני ההמתנה — אחרת הדפדפן חוסם אותו.
  async function openPdf(body) {
    const win = window.open('', '_blank');
    if (win) win.document.write('<p dir="rtl" style="font:16px sans-serif;padding:20px">טוען את הקובץ…</p>');
    const r = await post(body).catch(e => ({ ok: false, message: e.message }));
    if (!r.ok || !r.b64) { if (win) win.close(); return { ok: false, message: r.message || 'הקובץ לא נטען' }; }
    const bin = atob(r.b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
    if (win) win.location.href = url; else window.location.href = url;
    return { ok: true, parts: r.parts || 1 };
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function draw(msg) {
    const box = el(); if (!box) return;
    const st = last || { basket: [], held: [], open: [] };
    const m = drafterBarModel(st);
    const total = (st.open || []).reduce((a, b) => a + (b.count || 0), 0);
    let h = '<div class="drb-head">'
      + '<button type="button" class="drb-toggle" id="drbToggle" aria-expanded="' + expanded + '">'
      + '<span aria-hidden="true">📄</span> ' + esc(drafterTrayTitle(st)) + ' <span class="drb-caret" aria-hidden="true">' + (expanded ? '▼' : '▲') + '</span></button>'
      + '<button type="button" class="btn btn-primary drb-btn" id="drbSend"' + (m.canSend && !busy ? '' : ' aria-disabled="true"') + '>' + esc(m.sendLabel) + '</button></div>';
    if (expanded) {
      h += '<div class="drb-body">';
      if ((st.basket || []).length) h += '<button type="button" class="btn btn-secondary drb-btn drb-preview" id="drbPreview">הצג טיוטה (PDF)</button>';
      h += (st.basket || []).length
        ? '<ul class="drb-list">' + st.basket.map(it => '<li><span>' + esc(drafterItemLine(it)) + '</span>'
            + '<button type="button" class="btn btn-ghost drb-mini" data-hold="' + esc(it.id) + '">לא לשלוח עכשיו</button></li>').join('') + '</ul>'
        : '<p class="drb-empty">עוד לא נכנסה הזמנה. כל הזמנה שתשלח לחשבשבת תיכנס לכאן.</p>';
      if ((st.held || []).length) {
        h += '<div class="drb-sub">לא לשלוח עכשיו</div><ul class="drb-list drb-held">' + st.held.map(it => '<li><span>' + esc(drafterItemLine(it)) + '</span>'
          + '<button type="button" class="btn btn-secondary drb-mini" data-unhold="' + esc(it.id) + '">החזר</button></li>').join('') + '</ul>';
      }
      if (m.open.length) {
        h += '<div class="drb-sub">נשלח לשרטט</div><ul class="drb-list">' + m.open.map((t, i) => {
          const n = st.open[i].n;
          return '<li><span>' + esc(t) + '</span>' + (m.resend.includes(n) ? '<button type="button" class="btn btn-secondary drb-mini drb-resend" data-n="' + n + '">שלח שוב</button>' : '') + '</li>';
        }).join('') + '</ul>'
          + '<button type="button" class="btn btn-secondary drb-btn drb-done" id="drbDone"' + (busy ? ' aria-disabled="true"' : '') + '>השרטט סיים</button>';
      }
      h += '</div>';
    } else if (m.open.length) {
      h += '<div class="drb-peek">' + esc('אצל השרטט: ' + _dbCount(total)) + '</div>';
    }
    if (msg) h += '<div class="drb-msg" role="status">' + esc(msg).replace(/\n/g, '<br>') + '</div>';
    box.innerHTML = h;
    wire(st, m, total);
  }

  function wire(st, m, total) {
    const box = el();
    box.querySelector('#drbToggle').onclick = () => { expanded = !expanded; draw(); };
    box.querySelector('#drbSend').onclick = async () => {
      if (busy || !m.canSend) return;
      if (!confirm(drafterSendConfirm(st.basket.length))) return;
      busy = true; draw('שולח…');
      const r = await post({ action: 'drafter-send' }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? 'משלוח ' + r.n + ' נשלח לתור המיילים — יגיע ל-lozzagagot תוך דקה-שתיים'
                         : (r.code === 'empty' ? 'הטיוטה ריקה' : r.code === 'busy' ? 'שליחה אחרת באמצע — נסה שוב בעוד דקה' : 'השליחה נכשלה: ' + (r.message || '')));
    };
    const pv = box.querySelector('#drbPreview');
    if (pv) pv.onclick = async () => {
      if (busy) return;
      busy = true;
      const r = await openPdf({ action: 'drafter-preview', idx: 0 });
      busy = false;
      if (!r.ok) draw('לא הצלחתי להציג: ' + r.message);
      else if (r.parts > 1) draw('הטיוטה גדולה — מוצג חלק 1 מתוך ' + r.parts);
    };
    box.querySelectorAll('[data-hold],[data-unhold]').forEach(btn => { btn.onclick = async () => {
      if (busy) return;
      const hold = btn.hasAttribute('data-hold');
      const id = btn.getAttribute(hold ? 'data-hold' : 'data-unhold');
      busy = true;
      const r = await post({ action: 'drafter-hold', id, hold }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? '' : (r.message || 'לא הצליח'));
    }; });
    box.querySelectorAll('.drb-resend').forEach(btn => { btn.onclick = async () => {
      if (busy) return;
      const n = Number(btn.dataset.n);
      busy = true; draw('שולח שוב את משלוח ' + n + '…');
      const r = await post({ action: 'drafter-resend', n }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? 'משלוח ' + n + ' נשלח שוב לתור המיילים' : 'לא הצליח: ' + (r.message || ''));
    }; });
    const done = box.querySelector('#drbDone');
    if (done) done.onclick = async () => {
      if (busy || !m.canDone) return;
      if (!confirm(drafterDoneConfirm(total))) return;
      busy = true; draw('מעביר…');
      const r = await post({ action: 'drafter-done' }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? drafterDoneText(r) : 'לא הצליח: ' + (r.message || ''));
    };
  }

  async function refresh(msg) {
    const r = await post({ action: 'drafter-status' }).catch(() => null);
    if (r && r.ok) last = r;
    draw(msg || (r && r.ok ? '' : 'לא הצלחתי לטעון את הטיוטה לשרטט'));
    return last;
  }

  // ─── תחנת שרטט: המשלוחים לפי קובץ ───────────────────────────────
  let bOpen = {}, bMsg = '';
  async function drawBatches() {
    const box = document.getElementById('drafterBatches'); if (!box) return;
    const r = await post({ action: 'drafter-status' }).catch(() => null);
    const open = (r && r.ok && r.open) || [];
    let h = '<div class="drbs-head">משלוחים לשרטט' + (open.length ? ' (' + open.length + ')' : '') + '</div>';
    if (!r || !r.ok) h += '<p class="drbs-empty">לא הצלחתי לטעון את המשלוחים</p>';
    else if (!open.length) h += '<p class="drbs-empty">אין משלוחים שמחכים לשרטט</p>';
    open.forEach(b => {
      const c = drafterBatchCard(b);
      h += '<div class="drbs-card"><button type="button" class="drbs-title" data-toggle="' + b.n + '" aria-expanded="' + !!bOpen[b.n] + '">'
        + '<span aria-hidden="true">📄</span> ' + esc(c.title) + (c.mail ? ' <span class="drbs-mail">' + esc(c.mail) + '</span>' : '') + '</button>'
        + (bOpen[b.n] ? '<ul class="drb-list">' + c.lines.map(t => '<li><span>' + esc(t) + '</span></li>').join('') + '</ul>' : '')
        + '<div class="drbs-actions"><button type="button" class="btn btn-secondary drb-btn" data-file="' + b.n + '">פתח קובץ</button>'
        + '<button type="button" class="btn btn-primary drb-btn" data-done="' + b.n + '" data-count="' + b.count + '">השרטט סיים</button></div></div>';
    });
    if (bMsg) h += '<div class="drb-msg" role="status">' + esc(bMsg).replace(/\n/g, '<br>') + '</div>';
    box.innerHTML = h;
    box.querySelectorAll('[data-toggle]').forEach(x => { x.onclick = () => { const n = x.dataset.toggle; bOpen[n] = !bOpen[n]; drawBatches(); }; });
    box.querySelectorAll('[data-file]').forEach(x => { x.onclick = async () => {
      const res = await openPdf({ action: 'drafter-file', n: Number(x.dataset.file), idx: 0 });
      if (!res.ok) { bMsg = 'הקובץ לא נפתח: ' + res.message; drawBatches(); }
    }; });
    box.querySelectorAll('[data-done]').forEach(x => { x.onclick = async () => {
      if (busy) return;
      const n = Number(x.dataset.done);
      if (!confirm(drafterDoneOneConfirm({ n, count: Number(x.dataset.count) }))) return;
      busy = true;
      const res = await post({ action: 'drafter-done', n }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      bMsg = res.ok ? drafterDoneText(res) : 'לא הצליח: ' + (res.message || '');
      drawBatches();
    }; });
  }
  window.lgDrafterBatchesMount = drawBatches;

  //  נקרא מ-openSketchQueue, ואחרי כל שליחה לחשבשבת (added=true → הודעה קצרה)
  window.lgDrafterBarShow = async function (on, added) {
    const box = el(); if (!box) return;
    box.hidden = !on;
    if (!on) return;
    const st = await refresh();
    if (added && st && typeof showToast === 'function') showToast(drafterAddedToast((st.basket || []).length));
  };
})();
