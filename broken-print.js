// ── 💥 שבר: חלון הדפסה (בן, 19/11) ─────────────────────────────────────────
//  אחרי "סיום בדיקה" בחיסום, מה שלא סומן עובר לשבר בתחנת הבדיקה. החלון הזה
//  מראה אותו, ולכל זכוכית: 🖨 סקיצה (A4 ל-Brother), 🖨 צורה (ציור אופטי-ווי
//  על A4) ו-🏷 מדבקה (עם הצורה כשיש). אותו דבר גם בתחנת הבדיקה ליד כל שבר.
//  ההדפסה דרך תור ההדפסות (/api/print, kind sheets, printer a4), כמו לוחות
//  אופטי-ווי וכפתור 🖨 בחלון ההזמנה. צריך: firebase-db.js, opty-shape.js,
//  order-labels.js. ר' docs/superpowers/specs/2026-11-19-broken-redo-design.md
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  //  מסך בלי הודעות משלו (לשרטט) — הודעה קטנה למטה, שלא תיעלם לחיצה בלי תשובה
  const ownToast = m => { const t = document.createElement('div'); t.setAttribute('role', 'status'); t.textContent = m;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1714;color:#fff;padding:10px 18px;border-radius:8px;font:600 14px Heebo,sans-serif;direction:rtl';
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };
  const say = m => { if (typeof showToast === 'function') showToast(m); else if (typeof toast === 'function') toast(m); else ownToast(m); };
  const itemsOf = o => Array.isArray(o && o.items) ? o.items : Object.values((o && o.items) || {});

  //  עמוד A4 (JPEG base64) מתמונה: שורת כותרת קטנה למעלה, תמונה לרוחב מסובבת למלא את הדף
  function lgA4PageJpeg(img, head) {
    const PW = 1240, PH = 1754, M = 44, TOP = 70;
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH);
    x.font = '700 26px Heebo, Arial, sans-serif'; x.fillStyle = '#333';
    x.textAlign = 'center'; x.direction = 'rtl'; x.textBaseline = 'middle';
    let s = String(head || ''); while (s.length > 1 && x.measureText(s).width > PW - 2 * M) s = s.slice(0, -2) + '…';
    x.fillText(s, PW / 2, M + 12);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const W = PW - 2 * M, H = PH - TOP - M, rot = iw > ih * 1.15;
    const bw = rot ? ih : iw, bh = rot ? iw : ih, sc = Math.min(W / bw, H / bh);
    const dw = bw * sc, dh = bh * sc;
    x.save(); x.translate(M + W / 2, TOP + H / 2); if (rot) x.rotate(Math.PI / 2);
    x.drawImage(img, -(rot ? dh : dw) / 2, -(rot ? dw : dh) / 2, rot ? dh : dw, rot ? dw : dh);
    x.restore();
    for (const q of [0.85, 0.7, 0.55]) { const b = c.toDataURL('image/jpeg', q).split(',')[1]; if (b.length <= 1400000) return b; }
    return c.toDataURL('image/jpeg', 0.4).split(',')[1];
  }
  const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('התמונה לא נטענה')); i.src = src; });
  async function sendA4(page, title, orderId) {
    const res = await _lgAuthPost('/api/print', { action: 'create', kind: 'sheets', printer: 'a4', client: title, orderIds: [String(orderId)], pages: [page] });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.code || ('HTTP ' + res.status));
  }
  const headOf = (o, extra) => ['💥 שבר', o.orderClient, o.sketchName, o.orderNum, extra].filter(Boolean).join(' · ');

  async function lgPrintSketchA4(o) {
    try {
      const src = await lgLoadSketch(o);
      if (!src) { say('⚠️ אין סקיצה להזמנה הזאת'); return; }
      await sendA4(lgA4PageJpeg(await loadImg(src), headOf(o)), 'שבר — סקיצה ' + (o.orderNum || ''), o.id);
      say('✓ הסקיצה נשלחה למדפסת Brother');
    } catch (e) { console.error('broken sketch print:', e); say('⚠️ הסקיצה לא נשלחה: ' + (e.message || '')); }
  }

  //  🖨 הדפסת סקיצה רגילה מכל מסך (בן, 19/11: "בכל שלב כפתור הדפס על הסקיצה") — תחנת בדיקה,
  //  תחנת חשבוניות, לשרטט. opts.img — התמונה שעל המסך (כולל ציור מקומי שעוד לא נשמר);
  //  opts.src — כתובת/data של סקיצה ערוכה; אחרת הסקיצה השמורה. opts.btn — ננעל עד שנשלח.
  async function lgPrintOrderSketch(o, opts) {
    const op = opts || {}, btn = op.btn;
    if (!o) return;
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.textContent = 'שולח…'; }
    try {
      let img = op.img && op.img.complete && op.img.naturalWidth > 0 ? op.img : null;
      if (!img) {
        const src = op.src || await lgLoadSketch(o);
        if (!src) { say('⚠️ אין סקיצה להזמנה הזאת'); return; }
        img = await loadImg(src);
      }
      const head = [o.orderClient, o.sketchName, o.orderNum].filter(Boolean).join(' · ');
      await sendA4(lgA4PageJpeg(img, head), 'סקיצה ' + (o.orderNum || '') + ' ' + (o.orderClient || ''), o.id);
      say('✓ הסקיצה נשלחה למדפסת Brother');
    } catch (e) { console.error('sketch print:', e); say('⚠️ ההדפסה לא נשלחה: ' + (e.message || '')); }
    finally { if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = btn.dataset.t || '🖨 הדפס'; }, 3000); }
  }

  async function lgPrintShapeA4(o, idx) {
    const it = itemsOf(o)[idx] || {};
    if (!it.optyShape) { say('⚠️ לזכוכית הזאת אין צורה מאופטי-ווי'); return; }
    try {
      const raw = (await _lgDb.ref('meta/optyGeo/' + it.optyShape).once('value')).val();
      if (!raw) { say('⚠️ הציור של צורה ' + it.optyShape + ' עוד לא נקלט באופטי-ווי'); return; }
      let svg = lgOptyShapeSvg(lgOptyNetGeo(raw), { px: 1600, dims: true });
      if (!/xmlns=/.test(svg)) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      svg = svg.replace('<svg ', '<svg style="color:#000" ');
      const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
      const dims = Math.round(Number(it.w) || 0) + '×' + Math.round(Number(it.h) || 0);
      await sendA4(lgA4PageJpeg(img, headOf(o, 'צורה ' + it.optyShape + ' · ' + dims)), 'שבר — צורה ' + it.optyShape, o.id);
      say('✓ הצורה נשלחה למדפסת Brother');
    } catch (e) { console.error('broken shape print:', e); say('⚠️ הצורה לא נשלחה: ' + (e.message || '')); }
  }

  function lgPrintBrokenLabel(o, idx) {
    const it = itemsOf(o)[idx] || {};
    if (typeof window.lgPrintOrderLabels !== 'function') { say('⚠️ המדבקות לא נטענו — רענן את הדף'); return; }
    const opts = { broken: true }; if (it.optyShape) opts.withShape = true;
    window.lgPrintOrderLabels(o, [idx], opts);
  }

  //  כפתורי ההדפסה לזכוכית אחת. ההזמנה נשמרת לפי מפתח, כדי שה-onclick יהיה פשוט.
  const _reg = {};
  function lgBrokenPrintBtns(o, idx) {
    const k = String(o.id) + ':' + idx; _reg[k] = o;
    const it = itemsOf(o)[idx] || {};
    const has = typeof lgHasSketch !== 'function' || lgHasSketch(o);
    const b = 'min-height:44px;padding:0 12px;border-radius:8px;font:700 13px Heebo,sans-serif;cursor:pointer;white-space:nowrap;border:1px solid rgba(0,0,0,.18);background:#fff;color:#1a1714;';
    const kq = esc(JSON.stringify(k));
    return `<span style="display:inline-flex;gap:6px;flex-wrap:wrap;">`
      + (has ? `<button type="button" style="${b}background:#1a1714;border-color:#1a1714;color:#fff;" onclick="event.stopPropagation();lgBrokenPrint(${kq},'view')">🖼 ראה סקיצה</button>` : '')
      + (it.optyShape ? `<button type="button" style="${b}" onclick="event.stopPropagation();lgBrokenPrint(${kq},'viewShape')">📐 ראה צורה</button>` : '')
      + (has ? `<button type="button" style="${b}" onclick="event.stopPropagation();lgBrokenPrint(${kq},'sketch')">🖨 סקיצה</button>` : '')
      + (it.optyShape ? `<button type="button" style="${b}" onclick="event.stopPropagation();lgBrokenPrint(${kq},'shape')">🖨 צורה ${esc(it.optyShape)}</button>` : '')
      + (Number(it.w) > 0 && Number(it.h) > 0 ? `<button type="button" style="${b}background:#b8922a;border-color:#b8922a;color:#fff;" onclick="event.stopPropagation();lgBrokenPrint(${kq},'label')">🏷 מדבקה${it.optyShape ? ' + צורה' : ''}</button>` : '')
      + `</span>`;
  }
  function lgBrokenPrint(k, what) {
    const o = _reg[k]; if (!o) return;
    const idx = Number(String(k).split(':').pop());
    if (what === 'view') return lgBrokenViewSketch(o, idx);
    if (what === 'viewShape') { if (typeof lgOptyShapeView === 'function') lgOptyShapeView(o, idx); return; }
    if (what === 'sketch') return lgPrintSketchA4(o);
    if (what === 'shape') return lgPrintShapeA4(o, idx);
    return lgPrintBrokenLabel(o, idx);
  }

  //  🖼 ראה סקיצה (בן, 19/11: "אין לי אופציה לראות את הסקיצה") — חלון עם הסקיצה,
  //  והזכוכית השבורה כתובה למעלה; מתוכו גם הדפסה
  function lgBrokenViewSketch(o, idx) {
    const it = itemsOf(o)[idx] || {};
    const old = document.getElementById('lgBrokenSk'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'lgBrokenSk';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:10px;font-family:Heebo,sans-serif;direction:rtl;';
    const b = 'min-height:44px;padding:0 14px;border-radius:8px;font:800 14px Heebo,sans-serif;cursor:pointer;border:1px solid #ccc;background:#fff;color:#1a1714;';
    ov.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:900px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #eee;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:900;color:#1a1714;">${esc(o.orderClient || '')}${o.sketchName ? ' · ' + esc(o.sketchName) : ''} <span style="font-size:12px;color:#6b6259" dir="ltr">${esc(o.orderNum || '')}</span></div>
          <div style="font-size:14px;color:#c0392b;font-weight:800;">💥 שבר: ${typeof lgDimsText === 'function' ? lgDimsText(it.w, it.h) : esc(it.w + '×' + it.h)} · ${esc(it.name || '')}${it.optyShape ? ' · צורה ' + esc(it.optyShape) : ''}</div>
        </div>
        <button type="button" data-print style="${b}">🖨 הדפס</button>
        <button type="button" data-close aria-label="סגור" style="${b}min-width:44px;padding:0;">✕</button>
      </div>
      <div style="flex:1;overflow:auto;background:#f6f6f6;display:flex;align-items:center;justify-content:center;min-height:240px;">
        <img alt="סקיצת ההזמנה" style="max-width:100%;max-height:80vh;display:block;">
      </div></div>`;
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
      else if (e.target.closest('[data-print]')) lgPrintSketchA4(o);
    });
    document.body.appendChild(ov);
    const img = ov.querySelector('img');
    if (typeof lgSketchIntoImg === 'function') lgSketchIntoImg(img, o);
    else lgLoadSketch(o).then(src => { if (src) img.src = src; });
  }

  //  list = [{order, idx}]
  function lgBrokenRedoPopup(list) {
    if (!list || !list.length) return;
    const old = document.getElementById('lgBrokenPop'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'lgBrokenPop';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:12px;font-family:Heebo,sans-serif;direction:rtl;';
    ov.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:90vh;overflow:auto;">
      <div style="background:#c0392b;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:10px;">
        <div style="flex:1;font-size:16px;font-weight:900;">💥 ${list.length === 1 ? 'זכוכית אחת עברה' : list.length + ' זכוכיות עברו'} לשבר — לתחנת הבדיקה</div>
        <button type="button" data-close aria-label="סגור" style="min-width:44px;min-height:44px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">✕</button></div>
      <div style="padding:6px 16px 4px;font-size:13px;color:#555;">הן מופיעות בתחנת הבדיקה תחת "💥 שבר", ויוצאות בדוח החיסום הבא. אפשר להדפיס מכאן:</div>
      ${list.map(({ order: o, idx }) => { const it = itemsOf(o)[idx] || {};
        return `<div style="padding:10px 16px;border-top:1px solid #eee;">
          <div style="font-size:15px;font-weight:800;color:#1a1714;">${esc(o.orderClient || '')}${o.sketchName ? ' · ' + esc(o.sketchName) : ''} <span style="font-size:12px;font-weight:600;color:#8a8278" dir="ltr">${esc(o.orderNum || '')}</span></div>
          <div style="margin:2px 0 8px;"><span style="font-size:18px;font-weight:900;color:#1a1714;">${typeof lgDimsText === 'function' ? lgDimsText(it.w, it.h) : esc(it.w + '×' + it.h)}</span>
            <span style="font-size:12px;color:#8a8278;margin-inline-start:6px;">${esc(it.name || '')}</span></div>
          ${lgBrokenPrintBtns(o, idx)}
        </div>`; }).join('')}
      <div style="padding:12px 16px;border-top:1px solid #eee;"><button type="button" data-close style="width:100%;min-height:48px;background:#1a1714;color:#fff;border:none;border-radius:8px;font:800 15px Heebo,sans-serif;cursor:pointer;">סגור</button></div>
    </div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) ov.remove(); });
    document.body.appendChild(ov);
  }

  window.lgBrokenRedoPopup = lgBrokenRedoPopup;
  window.lgBrokenPrintBtns = lgBrokenPrintBtns;
  window.lgBrokenPrint = lgBrokenPrint;
  window.lgA4PageJpeg = lgA4PageJpeg;
  window.lgPrintOrderSketch = lgPrintOrderSketch;
})();
