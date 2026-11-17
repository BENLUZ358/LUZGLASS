// ═══════════════════════════════════════════════════════════════════
//  order-labels.js — 🏷 מדבקה מכל מקום (בן, 11/11).
//  בחלון "פרטים" של הזמנה בלוח ההזמנות: כפתור מדבקה ליד כל פריט, ו"מדבקות לכל
//  הפריטים" — בכל שלב, גם אחרי שההזמנה עברה לחשבוניות. אותה מדבקה (print-labels.js)
//  ואותו מרכז הדפסות (/api/print → הכלי במשרד → TSC) כמו בחיסום ביום עבודה.
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-order-labels.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

//  order → מדבקות. idxs (רשות) = אילו פריטים; בלי idxs — כל פריט שיש לו מידות.
function lgOrderLabels(order, idxs) {
  if (!order) return [];
  const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
  const pick = idxs ? idxs.map(Number) : items.map((_, i) => i).filter(i => Number(items[i] && items[i].w) > 0 && Number(items[i] && items[i].h) > 0);
  return lgLabelsForClient([{ order: { ...order, items }, idxs: pick }]);
}
const lgOrderLabelsMsg = n => n === 1 ? 'מדבקה אחת נשלחה למדפסת המדבקות' : n + ' מדבקות נשלחו למדפסת המדבקות';

// ─── DOM ────────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') (function () {
  const STATE = { queued: 'בתור — המחשב במשרד ידפיס תוך כמה שניות', printing: 'מדפיס…', printed: '✓ הודפס',
                  failed: '✗ ההדפסה נכשלה — בדוק שמדפסת המדבקות דלוקה', unknown: '⚠ לא ידוע אם הודפס — בדוק את המדפסת' };
  const toast = t => { if (typeof showToast === 'function') showToast(t); };
  let busy = false;

  //  order + idxs → נשלח למרכז ההדפסות, ועוקב 30 שניות אחרי המצב
  //  opts.withShape (בן, 16/11) — "מדבקה עם צורה": מצייר את הצורה מאופטי-ווי במדבקה
  window.lgPrintOrderLabels = async function (order, idxs, opts) {
    if (busy) return;
    const labels = lgOrderLabels(order, idxs);
    if (opts && opts.withShape) {
      const withNum = labels.filter(l => l.shape);
      if (!withNum.length) { toast('לפריט הזה עוד אין מספר צורה מאופטי-ווי'); return; }
      labels.forEach(l => { if (l.shape) l.withShape = true; });
      if (typeof lgOptyLoadGeos === 'function') await lgOptyLoadGeos(labels);
    }
    if (opts && opts.broken) labels.forEach(l => { l.broken = true; });   // "שבר" — מהחיסום (בן, 16/11)
    if (!labels.length) { toast('אין פריט עם מידות להדפסה'); return; }
    busy = true;
    try {
      try { await document.fonts.load('700 64px Heebo', 'אבג 0123'); } catch (e) {}
      if (typeof lgLabelsSign === 'function') await lgLabelsSign(labels);   // ברקוד לכל זכוכית (17/11)
      const plain = labels.map(l => ({ title: l.title, dims: l.dims, sketchName: l.sketchName, glass: l.glass || '', orderNum: l.orderNum, shape: l.shape, job: l.job || '', withShape: !!l.withShape, broken: !!l.broken, ...(l.qr ? { qr: l.qr } : {}) }));
      const bitmaps = labels.map(l => lgLabelRender(l).bitmap);   // labels — עם הצורה (geo), שלא נשמרת בתור
      const res = await _lgAuthPost('/api/print', { action: 'create', kind: 'labels', printer: 'labels',
        client: String(order.orderClient || ''), orderIds: [String(order.id)], labels: plain, bitmaps });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.code || ('HTTP ' + res.status));
      toast(lgOrderLabelsMsg(labels.length));
      const started = Date.now();
      const tick = async () => {
        try {
          const r = await _lgAuthPost('/api/print', { action: 'get', id: d.id });
          const j = await r.json().catch(() => ({}));
          const s = j.job && j.job.state;
          if (s && s !== 'queued' && s !== 'printing') { toast(STATE[s] || s); return; }
        } catch (e) {}
        if (Date.now() - started < 30000) setTimeout(tick, 3000);
        else toast('עדיין בתור — המשך בלוח ההדפסות');
      };
      setTimeout(tick, 3000);
    } catch (e) {
      console.error('order labels:', e);
      toast('✗ המדבקה לא נשלחה: ' + (e.message || 'שגיאה') + ' — נסה שוב');
    } finally { busy = false; }
  };
})();
