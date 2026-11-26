// ✏️ ערוך פריטים מחלון הסקיצה (בן, 26/11) — לכל מי שבמסך יום העבודה / חיסום / טריפלקס.
// מידה, סוג זכוכית, הוספה ומחיקה. כל שינוי נשמר מיד דרך lgSaveOrderItemsEdit (firebase-db.js):
// מחיר נעול מחושב מחדש, "תיקון הזמנות" לחשבשבת, סימן על השורה לתחנת החשבוניות,
// וסימוני "הגיע" לא זזים כשמוחקים שורה.
//
// lgItemsEditOpen(orderId, ctx) — ctx: { getOrder(id), skuMap(), prices() → {globalP, clientP}, toast(msg) }
// lgItemsEditRefresh()          — לקרוא מהמאזין של ההזמנות; מצייר מחדש אם החלון פתוח.
//
// סוג זכוכית (בן, 26/11): לא כולם זוכרים מק"ט — כפתורים "8 שקוף" / "8 קליר" בשלוף, והשאר
// בחיפוש לפי שם. כפתור בשלוף שומר על העיבוד של השורה (מחוסם/מלוטש/גרפיקה/חלבי/טריפלקס) ומחליף
// רק את הזכוכית. "כל הסקיצה" מחליף את כל השורות בבת אחת.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let S = null;   // { id, ctx, busy }
  const QUICK = [{ mm: 8, glass: 'שקוף', label: '8 שקוף' }, { mm: 8, glass: 'קליר', label: '8 קליר' }];

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
.lgie-busy{opacity:.55;pointer-events:none;}
.lgie-gl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.lgie-q{font:inherit;font-size:15px;font-weight:700;min-height:40px;padding:0 12px;border-radius:6px;border:1px solid #b8922a;background:#fff;color:#1a1714;cursor:pointer;}
.lgie-q.on{background:#b8922a;color:#fff;}
.lgie-s{font:inherit;font-size:15px;padding:8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;flex:1;min-width:150px;}
.lgie-all{background:#fbf6ea;border-bottom:2px solid rgba(184,146,42,.35);}
.lgie-code{font-size:12px;color:#8a8278;direction:ltr;}`;
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

  // "8 מ''מ קליר מחוסם · 8CMH" (מהחיפוש) או מק"ט לבד
  const codeOf = v => { const t = String(v || '').trim(), k = t.lastIndexOf('·'); return (k >= 0 ? t.slice(k + 1) : t).trim().toUpperCase(); };
  const catList = () => Object.values(S.ctx.skuMap() || {}).filter(e => e && e.code && e.active !== false && e.kind !== 'hardware' && e.proc);
  // אותו עיבוד כמו בשורה, זכוכית אחרת. כמה אפשרויות (למשל 8CMH / 8CMHC צבע) — זו שהשם שלה
  // הוא השם הישן עם הזכוכית החדשה, אחרת הקצרה.
  function matchGlass(it, mm, glass) {
    const proc = it.chisum ? 'chisum' : it.litush ? 'litush' : null;
    const c = catList().filter(e => Number(e.mm) === mm && e.glass === glass && (!proc || e.proc === proc) &&
      !!e.graphic === !!it.graphic && !!e.chalavi === !!it.chalavi && !!e.triplex === !!it.triplex);
    if (!c.length) return null;
    const oldName = String(it.name || it.glassFullName || ''), want = it.glass ? oldName.replace(it.glass, glass) : '';
    const exact = c.find(e => e.name === want);
    if (exact) return exact.code;
    c.sort((a, b) => (proc ? 0 : (a.proc === 'chisum' ? -1 : 0) - (b.proc === 'chisum' ? -1 : 0)) || String(a.name).length - String(b.name).length);
    return c[0].code;
  }
  const isQuick = (it, q) => Number(it.mm) === q.mm && it.glass === q.glass;

  function skuFields(code) {
    const c = codeOf(code);
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
        </div>
        <div class="lgie-gl">${QUICK.map(q => `<button type="button" class="lgie-q${isQuick(it, q) ? ' on' : ''}" data-q="${q.mm}|${esc(q.glass)}" data-i="${i}">${esc(q.label)}</button>`).join('')}
          <input class="lgie-s" data-f="sku" data-i="${i}" list="lgIeSkus" autocomplete="off" placeholder="🔍 סוג אחר — שם או מק״ט" aria-label="חיפוש סוג זכוכית לשורה ${i + 1}">
          ${it.sku ? `<span class="lgie-code">${esc(it.sku)}</span>` : ''}</div>`}
        ${was ? `<div class="lgie-was">✏️ ${esc(was)}</div>` : ''}
      </div>`;
    }).join('');
    const box = root.querySelector('.lgie-box');
    box.classList.toggle('lgie-busy', !!S.busy);
    box.innerHTML = `
      <div class="lgie-head"><b>✏️ ערוך פריטים — ${esc(o.orderClient || '')} ${esc(o.orderNum || '')}${o.sketchName ? ' · ' + esc(o.sketchName) : ''}</b>
        <button type="button" class="lgie-x" data-close aria-label="סגור">✕</button></div>
      ${stop ? `<div class="lgie-note">${esc(stop)}</div>` : hs ? '<div class="lgie-note">ההזמנה כבר בחשבשבת — כל שינוי יסומן לחשבונית וירשם ב"תיקון הזמנות"</div>' : ''}
      <datalist id="lgIeSkus">${list.map(e => `<option value="${esc((e.name || e.code) + ' · ' + e.code)}"></option>`).join('')}</datalist>
      ${!stop && items.length > 1 ? `<div class="lgie-row lgie-all">
        <div class="lgie-top"><span class="lgie-g">כל הסקיצה (${items.length} שורות)</span></div>
        <div class="lgie-gl">${QUICK.map(q => `<button type="button" class="lgie-q${items.every(it => isQuick(it, q)) ? ' on' : ''}" data-qall="${q.mm}|${esc(q.glass)}">${esc(q.label)}</button>`).join('')}
          <input class="lgie-s" id="lgIeAllSku" list="lgIeSkus" autocomplete="off" placeholder="🔍 סוג אחר לכל השורות" aria-label="סוג זכוכית לכל השורות"></div>
      </div>` : ''}
      ${rows || '<div class="lgie-hint">אין פריטים</div>'}
      ${stop ? '' : `<div class="lgie-row lgie-add">
        <div class="lgie-top"><span class="lgie-g">+ שורה חדשה</span></div>
        <div class="lgie-ed">
          <input class="lgie-in" id="lgIeAddW" inputmode="numeric" placeholder="רוחב" aria-label="רוחב שורה חדשה במ״מ">
          <span>×</span>
          <input class="lgie-in" id="lgIeAddH" inputmode="numeric" placeholder="גובה" aria-label="גובה שורה חדשה במ״מ">
          <input class="lgie-in" id="lgIeAddQty" inputmode="numeric" value="1" style="width:52px" aria-label="כמות">
          <span class="lgie-u">יח׳</span>
        </div>
        <div class="lgie-gl">${QUICK.map(q => `<button type="button" class="lgie-q" data-qadd="${q.mm}|${esc(q.glass)}">${esc(q.label)}</button>`).join('')}
          <input class="lgie-s" id="lgIeAddSku" list="lgIeSkus" autocomplete="off" placeholder="🔍 סוג זכוכית — שם או מק״ט" aria-label="סוג זכוכית לשורה חדשה">
          <button type="button" class="lgie-btn" data-add>הוסף</button></div></div>
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

  function setGlass(items, i, nf) {
    const it = items[i]; if (!it || !nf || nf.sku === it.sku) return false;
    detach(items, it); Object.assign(it, nf); delete it.skuMissing; return true;
  }
  function applyAll(pick, label) {
    const o = S.ctx.getOrder(S.id); if (!o) return;
    const items = itemsOf(o); let n = 0, miss = 0;
    items.forEach((it, i) => { const code = pick(it); if (!code) { miss++; return; } if (setGlass(items, i, skuFields(code))) n++; });
    if (!n) { S.ctx.toast(miss ? 'אין מק"ט מתאים ל-' + label + ' בעיבוד של השורות' : 'כל השורות כבר ' + label); render(); return; }
    if (!confirm('להפוך ' + (n === items.length ? 'את כל ' + n + ' השורות' : n + ' שורות') + ' ל-' + label + '?' + (miss ? '\n(' + miss + ' שורות בלי מק"ט מתאים יישארו כמו שהן)' : ''))) { render(); return; }
    save(items, '✓ ' + n + ' שורות הוחלפו ל-' + label);
  }

  function onChange(e) {
    const el = e.target; if (!S) return;
    if (el.id === 'lgIeAllSku') {
      const nf = skuFields(el.value);
      if (!nf) { S.ctx.toast('סוג הזכוכית לא נמצא — בחר מהרשימה'); el.value = ''; return; }
      applyAll(() => nf.sku, nf.name);
      return;
    }
    if (!el.dataset || el.dataset.i == null) return;
    const o = S.ctx.getOrder(S.id); if (!o) return;
    const i = Number(el.dataset.i), f = el.dataset.f, items = itemsOf(o), it = items[i]; if (!it) return;
    if (f === 'sku') {
      const nf = skuFields(el.value);
      if (!nf) { S.ctx.toast('סוג הזכוכית לא נמצא — בחר מהרשימה'); el.value = ''; return; }
      if (!setGlass(items, i, nf)) { el.value = ''; return; }
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
    const q = t.closest('[data-q]');
    if (q) {
      const o = S.ctx.getOrder(S.id); if (!o) return;
      const i = Number(q.dataset.i), items = itemsOf(o), it = items[i]; if (!it) return;
      const [mm, glass] = q.dataset.q.split('|'), code = matchGlass(it, Number(mm), glass);
      if (!code) { S.ctx.toast('אין מק"ט ' + mm + ' ' + glass + ' לעיבוד של השורה — חפש בתיבה'); return; }
      if (setGlass(items, i, skuFields(code))) save(items, '✓ ' + mm + ' ' + glass);
      return;
    }
    const qa = t.closest('[data-qall]');
    if (qa) { const [mm, glass] = qa.dataset.qall.split('|'); applyAll(it => matchGlass(it, Number(mm), glass), mm + ' ' + glass); return; }
    const qd = t.closest('[data-qadd]');
    if (qd) {
      const [mm, glass] = qd.dataset.qadd.split('|'), o = S.ctx.getOrder(S.id);
      //  שורה חדשה — העיבוד כמו השורה הראשונה בהזמנה, ואם אין — מחוסם
      const first = (o && itemsOf(o)[0]) || { chisum: true };
      const code = matchGlass(first, Number(mm), glass) || matchGlass({ chisum: true }, Number(mm), glass);
      const nf = code && skuFields(code), box = document.getElementById('lgIeAddSku');
      if (nf && box) box.value = nf.name + ' · ' + nf.sku;
      return;
    }
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
      if (!nf) { S.ctx.toast('בחר סוג זכוכית — 8 שקוף / 8 קליר או מהחיפוש'); return; }
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
