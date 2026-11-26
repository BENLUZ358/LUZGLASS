// ✏️ ערוך פריטים מחלון הסקיצה (בן, 26/11) — לכל מי שבמסך יום העבודה / חיסום / טריפלקס.
// מידה, סוג זכוכית, הוספה ומחיקה. כל שינוי נשמר מיד דרך lgSaveOrderItemsEdit (firebase-db.js):
// מחיר נעול מחושב מחדש, "תיקון הזמנות" לחשבשבת, סימן על השורה לתחנת החשבוניות,
// וסימוני "הגיע" לא זזים כשמוחקים שורה.
//
// lgItemsEditOpen(orderId, ctx) — ctx: { getOrder(id), skuMap(), prices() → {globalP, clientP}, toast(msg) }
// lgItemsEditRefresh()          — לקרוא מהמאזין של ההזמנות; מצייר מחדש אם החלון פתוח.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let S = null;   // { id, ctx, busy }

  function css() {
    if (document.getElementById('lgIeCss')) return;
    const st = document.createElement('style'); st.id = 'lgIeCss';
    st.textContent = `
.lgie{position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto;font-family:Heebo,sans-serif;}
.lgie-box{background:#fff;color:#1a1714;width:100%;max-width:560px;border-radius:10px;overflow:hidden;margin:auto 0;}
.lgie-head{background:#1a1714;color:#f7f4ef;padding:12px 14px;display:flex;align-items:center;gap:10px;}
.lgie-head b{flex:1;font-size:15px;} .lgie-x{background:none;border:none;color:#fff;font-size:22px;min-width:44px;min-height:44px;cursor:pointer;}
.lgie-note{margin:10px 12px 0;padding:8px 10px;border-radius:6px;background:#fdecea;color:#a93226;font-size:13px;font-weight:700;}
.lgie-row{padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.07);display:flex;flex-direction:column;gap:6px;}
.lgie-top{display:flex;align-items:center;gap:8px;}
.lgie-n{font-size:12px;color:#8a8278;min-width:22px;}
.lgie-g{flex:1;font-size:15px;font-weight:800;}
.lgie-del{background:#fff;border:1px solid rgba(169,50,38,.4);color:#a93226;border-radius:6px;min-width:44px;min-height:40px;font-size:16px;cursor:pointer;}
.lgie-ed{display:flex;align-items:center;gap:6px;flex-wrap:wrap;direction:ltr;justify-content:flex-end;}
.lgie-in{font:inherit;font-size:16px;padding:8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;width:84px;text-align:center;direction:ltr;}
.lgie-sku{width:110px;text-transform:uppercase;}
.lgie-u{font-size:12px;color:#8a8278;}
.lgie-was{font-size:13px;font-weight:700;color:#a93226;}
.lgie-add{background:#f6f3ee;}
.lgie-btn{font:inherit;font-size:15px;font-weight:700;min-height:44px;padding:0 14px;border-radius:6px;border:none;background:#1a1714;color:#fff;cursor:pointer;}
.lgie-hint{padding:10px 12px;font-size:12px;color:#8a8278;}
.lgie-busy{opacity:.55;pointer-events:none;}`;
    document.head.appendChild(st);
  }

  const itemsOf = o => (Array.isArray(o.items) ? o.items : Object.values(o.items || {})).map(it => Object.assign({}, it));
  const dimsTxt = (w, h) => (typeof lgDimsText === 'function' ? lgDimsText(w, h, '?') : w + '×' + h);
  const wasTxt = s => String(s || '').replace(/^(\d+)×(\d+)$/, (_, w, h) => dimsTxt(w, h));

  function blocked(o) {
    if ((o.invoiceDone && o.invoiceDone.docNumber) || (typeof _lgLegacyInvoiced === 'function' && _lgLegacyInvoiced(o)))
      return 'כבר הופקה חשבונית להזמנה הזאת — אי אפשר לערוך כאן';
    if (Object.keys(o.invoicePieces || {}).length) return 'חלק מההזמנה כבר בחשבונית — תיקון מידה בודדת רק בתחנת החשבוניות';
    return '';
  }

  function skuFields(code) {
    const c = String(code || '').toUpperCase().trim();
    const r = typeof lgResolveSkuCode === 'function' ? lgResolveSkuCode(c, S.ctx.skuMap() || {}) : null;
    if (!r) return null;
    return { name: r.label, glassFullName: r.label, glass: r.glass, mm: r.mm, chisum: r.proc === 'chisum', litush: r.proc === 'litush',
      graphic: !!r.graphic, chalavi: !!r.chalavi, triplex: !!r.triplex, sku: r.sku || c };
  }
  // חתיכה שנערכה יוצאת מקבוצת הכמות — כמו בחלון של האדמין
  function detach(items, it) {
    if (it.quantityGroupId && items.filter(x => x.quantityGroupId === it.quantityGroupId).length > 1) {
      delete it.quantityGroupId; delete it.originalQuantity; delete it.groupIndex;
    }
  }

  function render() {
    const root = document.getElementById('lgIe'); if (!root || !S) return;
    const o = S.ctx.getOrder(S.id);
    if (!o) { close(); return; }
    const items = itemsOf(o), stop = blocked(o);
    const list = Object.values(S.ctx.skuMap() || {}).filter(e => e && e.code && e.active !== false && e.kind !== 'hardware' && e.proc)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const hs = typeof lgHsWasSent === 'function' && lgHsWasSent(o);
    const rows = items.map((it, i) => {
      const was = [it.editedFrom ? 'היה ' + wasTxt(it.editedFrom) : '', it.editedGlassFrom ? 'היה ' + it.editedGlassFrom : '', it.addedAt ? 'שורה חדשה' : '']
        .filter(Boolean).join(' · ');
      return `<div class="lgie-row">
        <div class="lgie-top"><span class="lgie-n">${esc(it.hsLine || i + 1)}</span><span class="lgie-g">${esc(it.glassFullName || it.name || 'פריט')}</span>
          ${stop ? '' : `<button type="button" class="lgie-del" data-del="${i}" aria-label="מחק שורה ${i + 1}">🗑</button>`}</div>
        ${stop ? `<div style="font-size:18px;font-weight:900">${dimsTxt(it.w, it.h)}</div>` : `<div class="lgie-ed">
          <input class="lgie-in" data-f="w" data-i="${i}" inputmode="numeric" value="${Math.round(+it.w || 0) || ''}" aria-label="רוחב שורה ${i + 1} במ״מ">
          <span>×</span>
          <input class="lgie-in" data-f="h" data-i="${i}" inputmode="numeric" value="${Math.round(+it.h || 0) || ''}" aria-label="גובה שורה ${i + 1} במ״מ">
          <span class="lgie-u">מ״מ</span>
          <input class="lgie-in lgie-sku" data-f="sku" data-i="${i}" list="lgIeSkus" autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc(it.sku || '')}" aria-label="מק״ט שורה ${i + 1}" placeholder="מק״ט">
        </div>`}
        ${was ? `<div class="lgie-was">✏️ ${esc(was)}</div>` : ''}
      </div>`;
    }).join('');
    const box = root.querySelector('.lgie-box');
    box.classList.toggle('lgie-busy', !!S.busy);
    box.innerHTML = `
      <div class="lgie-head"><b>✏️ ערוך פריטים — ${esc(o.orderClient || '')} ${esc(o.orderNum || '')}${o.sketchName ? ' · ' + esc(o.sketchName) : ''}</b>
        <button type="button" class="lgie-x" data-close aria-label="סגור">✕</button></div>
      ${stop ? `<div class="lgie-note">${esc(stop)}</div>` : hs ? '<div class="lgie-note">ההזמנה כבר בחשבשבת — כל שינוי יסומן לחשבונית וירשם ב"תיקון הזמנות"</div>' : ''}
      <datalist id="lgIeSkus">${list.map(e => `<option value="${esc(e.code)}">${esc(e.name || e.code)}</option>`).join('')}</datalist>
      ${rows || '<div class="lgie-hint">אין פריטים</div>'}
      ${stop ? '' : `<div class="lgie-row lgie-add">
        <div class="lgie-top"><span class="lgie-g">+ שורה חדשה</span></div>
        <div class="lgie-ed">
          <input class="lgie-in" id="lgIeAddW" inputmode="numeric" placeholder="רוחב" aria-label="רוחב שורה חדשה במ״מ">
          <span>×</span>
          <input class="lgie-in" id="lgIeAddH" inputmode="numeric" placeholder="גובה" aria-label="גובה שורה חדשה במ״מ">
          <input class="lgie-in lgie-sku" id="lgIeAddSku" list="lgIeSkus" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="מק״ט" aria-label="מק״ט שורה חדשה">
          <input class="lgie-in" id="lgIeAddQty" inputmode="numeric" value="1" style="width:52px" aria-label="כמות">
          <button type="button" class="lgie-btn" data-add>הוסף</button>
        </div></div>
      <div class="lgie-hint">מידות במילימטרים. כל שינוי נשמר מיד.</div>`}`;
  }

  async function save(items, okMsg) {
    const o = S && S.ctx.getOrder(S.id); if (!o) return;
    const ctx = S.ctx, id = S.id;
    S.busy = true; render();
    try {
      const r = await lgSaveOrderItemsEdit(o, items, ctx.prices ? ctx.prices() : {});
      o.items = items;   // מיד במסך; המאזין יביא את הגרסה עם הסימנים
      ctx.toast(okMsg + (r && r.logged ? ' — נרשם בתיקון הזמנות' : ''));
      //  המסך מעדכן את מה שהוא מחזיק לפי מספר שורה (טיוטה, יום העבודה) — בן, 26/11
      if (ctx.onSaved) try { ctx.onSaved(id, r || {}); } catch (e2) { console.error('lgItemsEdit onSaved:', e2); }
    } catch (e) {
      console.error('lgItemsEdit:', e);
      S.ctx.toast('✗ ' + (e.message || 'השמירה נכשלה — נסה שוב'));
    }
    if (S) { S.busy = false; render(); }
  }

  function onChange(e) {
    const el = e.target; if (!S || !el.dataset || el.dataset.i == null) return;
    const o = S.ctx.getOrder(S.id); if (!o) return;
    const i = Number(el.dataset.i), f = el.dataset.f, items = itemsOf(o), it = items[i]; if (!it) return;
    if (f === 'sku') {
      const nf = skuFields(el.value);
      if (!nf) { S.ctx.toast('מק"ט לא נמצא בקטלוג'); el.value = it.sku || ''; return; }
      if (nf.sku === it.sku) return;
      detach(items, it); Object.assign(it, nf); delete it.skuMissing;
      save(items, '✓ סוג הזכוכית הוחלף');
      return;
    }
    const r = lgParseDimensionInput(el.value);
    if (!r.ok) { S.ctx.toast(r.error); el.value = Math.round(+it[f] || 0) || ''; return; }
    if (Math.round(+it[f] || 0) === r.mm) return;
    detach(items, it); it[f] = r.mm;
    save(items, '✓ המידה נשמרה');
  }

  function onClick(e) {
    if (!S) return;
    const t = e.target;
    if (t === document.getElementById('lgIe') || t.closest('[data-close]')) { close(); return; }
    const del = t.closest('[data-del]');
    if (del) {
      const o = S.ctx.getOrder(S.id); if (!o) return;
      const i = Number(del.dataset.del), items = itemsOf(o), it = items[i]; if (!it) return;
      if (!confirm('למחוק את השורה ' + (it.glassFullName || it.name || '') + ' ' + Math.round(+it.w || 0) + '×' + Math.round(+it.h || 0) + '?')) return;
      items.splice(i, 1);
      save(items, '✓ השורה נמחקה');
      return;
    }
    if (t.closest('[data-add]')) {
      const o = S.ctx.getOrder(S.id); if (!o) return;
      const nf = skuFields(document.getElementById('lgIeAddSku').value);
      if (!nf) { S.ctx.toast('בחר מק"ט מהרשימה'); return; }
      const rW = lgParseDimensionInput(document.getElementById('lgIeAddW').value), rH = lgParseDimensionInput(document.getElementById('lgIeAddH').value);
      if (!rW.ok) { S.ctx.toast('רוחב: ' + rW.error); return; }
      if (!rH.ok) { S.ctx.toast('גובה: ' + rH.error); return; }
      const qty = Math.max(1, Math.min(50, parseInt(document.getElementById('lgIeAddQty').value || '1', 10) || 1));
      const items = itemsOf(o);
      const add = typeof lgMakeQuantityGroup === 'function' ? lgMakeQuantityGroup(Object.assign({}, nf, { w: rW.mm, h: rH.mm }), qty)
        : Array.from({ length: qty }, () => Object.assign({}, nf, { w: rW.mm, h: rH.mm }));
      items.push(...add);
      save(items, qty > 1 ? '✓ ' + qty + ' שורות נוספו' : '✓ השורה נוספה');
    }
  }

  function onKey(e) { if (e.key === 'Escape' && S) close(); }

  function close() {
    const r = document.getElementById('lgIe'); if (r) r.remove();
    document.removeEventListener('keydown', onKey);
    S = null;
  }

  window.lgItemsEditOpen = function (orderId, ctx) {
    css(); close();
    S = { id: String(orderId), ctx, busy: false };
    const root = document.createElement('div');
    root.id = 'lgIe'; root.className = 'lgie'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="lgie-box"></div>';
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    render();
  };
  //  המאזין של ההזמנות מביא גרסה חדשה — לא מצייר באמצע הקלדה
  window.lgItemsEditRefresh = function () {
    if (!S || S.busy) return;
    const a = document.activeElement;
    if (a && a.closest && a.closest('#lgIe') && a.tagName === 'INPUT') return;
    render();
  };
})();
