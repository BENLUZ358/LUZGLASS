// ═══════════════════════════════════════════════════════════════════
//  drafter-batch.js — "שלח לשרטט" / "השרטט סיים" בלשונית "אצל שרטט" (admin.html).
//  בן, 10/11. אפיון: docs/superpowers/specs/2026-11-10-drafter-pdf-batches-design.md
//
//  השרטט לא עובד על הממשק. "שלח לשרטט" בונה בשרת PDF מכל ההזמנות שאצל שרטט
//  ועוד לא נשלחו, ושולח במייל ל-lozzagagot. "השרטט סיים" מעביר את כל מה
//  שנשלח ל"בנה יום עבודה" (opty), בדיוק כמו "✓ סיים סקיצה" ב-drafter.html.
//  הכל דרך /api/wa-inbound-drain (drafter-status / drafter-send / drafter-done).
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
function drafterTag(o) {
  if (!o || (o.stage !== 'drafter' && o.stage !== 'chash')) return '';
  return o.drafterBatch != null ? 'נשלח · משלוח ' + o.drafterBatch : 'בסל';
}

// ─── DOM ────────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  let busy = false, last = null;
  const el = () => document.getElementById('drafterBar');

  async function post(body) {
    const res = await _lgAuthPost('/api/wa-inbound-drain', body);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: d.error || ('שגיאה ' + res.status) };
    return d;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function draw(msg) {
    const box = el(); if (!box) return;
    const m = drafterBarModel(last || {});
    const total = ((last && last.open) || []).reduce((a, b) => a + (b.count || 0), 0);
    box.innerHTML =
      '<div class="drb-row"><span class="drb-basket">' + esc(m.basketText) + '</span>'
      + '<button type="button" class="btn btn-primary drb-btn" id="drbSend"' + (m.canSend && !busy ? '' : ' aria-disabled="true"') + '>' + esc(m.sendLabel) + '</button>'
      + '<button type="button" class="btn btn-secondary drb-btn" id="drbDone"' + (m.canDone && !busy ? '' : ' aria-disabled="true"') + '>השרטט סיים</button></div>'
      + (m.open.length ? '<ul class="drb-open">' + m.open.map((t, i) => {
          const n = last.open[i].n;
          return '<li>' + esc(t) + (m.resend.includes(n) ? ' <button type="button" class="btn btn-secondary drb-resend" data-n="' + n + '">שלח שוב</button>' : '') + '</li>';
        }).join('') + '</ul>' : '')
      + (msg ? '<div class="drb-msg" role="status">' + esc(msg).replace(/\n/g, '<br>') + '</div>' : '');
    box.querySelector('#drbSend').onclick = async () => {
      if (busy || !m.canSend) return;
      if (!confirm(drafterSendConfirm(last.basket.length))) return;
      busy = true; draw('שולח…');
      const r = await post({ action: 'drafter-send' }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? 'משלוח ' + r.n + ' נשלח לתור המיילים — יגיע ל-lozzagagot תוך דקה-שתיים'
                         : (r.code === 'empty' ? 'הסל ריק' : 'השליחה נכשלה: ' + (r.message || '')));
    };
    box.querySelectorAll('.drb-resend').forEach(btn => { btn.onclick = async () => {
      if (busy) return;
      const n = Number(btn.dataset.n);
      busy = true; draw('שולח שוב את משלוח ' + n + '…');
      const r = await post({ action: 'drafter-resend', n }).catch(e => ({ ok: false, message: e.message }));
      busy = false;
      await refresh(r.ok ? 'משלוח ' + n + ' נשלח שוב לתור המיילים' : 'לא הצליח: ' + (r.message || ''));
    }; });
    box.querySelector('#drbDone').onclick = async () => {
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
    draw(msg || (r && r.ok ? '' : 'לא הצלחתי לטעון את מצב השרטט'));
  }

  //  נקרא מ-setSF ב-admin.html
  window.lgDrafterBarShow = function (on) {
    const box = el(); if (!box) return;
    box.hidden = !on;
    if (on) refresh();
  };
})();
