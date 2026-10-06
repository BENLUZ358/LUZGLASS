// ═══════════════════════════════════════════════════════════════════
//  sku-picker.js — בורר מק"טים בעברית בשדה הקוד של תור הסקיצות.
//
//  iOS לא מאפשר לאתר לבחור את שפת המקלדת: השדה נפתח בעברית והקלדת
//  "8SMH" דרשה החלפת מקלדת בכל פריט. כאן מקלידים "8 שקוף חיסום" או קוד,
//  בוחרים מהרשימה, והקוד נכנס לשדה — ומשם הכל כמו קודם (iwResolve/iwAdd).
//
//  החלק העליון — חיפוש ו"אחרונים", פונקציות טהורות שנבדקות ב-Node
//  (scripts/test-sku-picker.js). החלק התחתון — DOM, רק בדפדפן.
//
//  ⚠️ מוצעים רק מק"טים שאפשר באמת להוסיף: active ועם proc. lgResolveSkuCode
//  דוחה כל השאר, והצעה שלהם הייתה נגמרת ב"קוד לא מוכר".
// ═══════════════════════════════════════════════════════════════════

const LG_SKU_RECENT_KEY = 'lgSkuRecent';
const LG_SKU_RECENT_MAX = 6;

// מילים נרדפות: מה שאומרים מול מה שכתוב בשם המק"ט בחשבשבת
const _LG_SKU_SYN = {
  'חיסום': ['חיסום', 'מחוסם'], 'מחוסם': ['מחוסם', 'חיסום'],
  'ליטוש': ['ליטוש', 'מלוטש'], 'מלוטש': ['מלוטש', 'ליטוש'],
  'חיתוך': ['חיתוך', 'חתוך'],   'חתוך':  ['חתוך', 'חיתוך'],
};

// מ''מ / מ״מ / מ"מ — אותו דבר. גם רווחים כפולים.
const _lgSkuNorm = s => String(s == null ? '' : s)
  .replace(/['"`׳״]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const _lgSkuOk = e => !!(e && e.code && e.active !== false && e.proc);

function _lgSkuTokenHit(tok, e, name, code) {
  if (/^\d+$/.test(tok)) return Number(e.mm) === Number(tok) || code.startsWith(tok.toUpperCase());
  if (/^[a-z0-9+]+$/i.test(tok) && code.startsWith(tok.toUpperCase())) return true;
  return (_LG_SKU_SYN[tok] || [tok]).some(t => name.includes(t));
}

//  מחזיר [{code, name}] — התאמה מדויקת לקוד ראשונה, אחר כך קידומת קוד,
//  ואז לפי עובי ושם.
function lgSkuSearch(query, catalog, limit) {
  const q = _lgSkuNorm(query);
  if (!q) return [];
  const toks = q.split(' ');
  const Q = q.replace(/\s/g, '').toUpperCase();
  const hits = [];
  Object.values(catalog || {}).forEach(e => {
    if (!_lgSkuOk(e)) return;
    const code = String(e.code).toUpperCase(), name = _lgSkuNorm(e.name);
    if (!toks.every(t => _lgSkuTokenHit(t, e, name, code))) return;
    const rank = code === Q ? 0 : code.startsWith(Q) ? 1 : 2;
    hits.push({ rank, mm: Number(e.mm) || 0, e });
  });
  hits.sort((a, b) => a.rank - b.rank || a.mm - b.mm ||
                      String(a.e.name).localeCompare(String(b.e.name), 'he'));
  return hits.slice(0, limit || 8).map(h => ({ code: String(h.e.code), name: String(h.e.name || h.e.code) }));
}

// ─── אחרונים — לכל מכשיר. אחסון שנכשל (גלישה פרטית) לא שובר כלום ─────
const _lgSkuStore = s => s || (typeof localStorage !== 'undefined' ? localStorage : null);

function _lgSkuRecentRaw(storage) {
  try {
    const v = JSON.parse((_lgSkuStore(storage) || { getItem: () => null }).getItem(LG_SKU_RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_) { return []; }
}

function lgSkuRecentPush(code, storage) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return;
  const next = [c, ..._lgSkuRecentRaw(storage).filter(x => x !== c)].slice(0, LG_SKU_RECENT_MAX);
  try { (_lgSkuStore(storage) || { setItem() {} }).setItem(LG_SKU_RECENT_KEY, JSON.stringify(next)); } catch (_) {}
}

//  רק מה שעדיין אפשר להוסיף — מק"ט שנמחק או כובה לא חוזר מהזיכרון
function lgSkuRecentList(catalog, storage) {
  return _lgSkuRecentRaw(storage)
    .map(c => (catalog || {})[c])
    .filter(_lgSkuOk)
    .map(e => ({ code: String(e.code), name: String(e.name || e.code) }));
}

// ═══ דפדפן ═══════════════════════════════════════════════════════════
if (typeof document !== 'undefined') (function () {
  let rows = [], active = -1, open = false;
  const $ = id => document.getElementById(id);
  const cat = () => (typeof skuCatalogMap !== 'undefined' ? skuCatalogMap : {});
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function place() {
    const inp = $('iwCode'), box = $('iwSkuList');
    if (!inp || !box) return;
    box.style.top = (inp.offsetTop + inp.offsetHeight + 2) + 'px';
    box.style.left = inp.offsetLeft + 'px';
    box.style.width = inp.offsetWidth + 'px';
  }

  function render(emptyMsg) {
    const inp = $('iwCode'), box = $('iwSkuList');
    if (!inp || !box) return;
    open = rows.length > 0 || !!emptyMsg;
    inp.setAttribute('aria-expanded', open ? 'true' : 'false');
    box.hidden = !open;
    if (!open) { inp.removeAttribute('aria-activedescendant'); return; }
    place();
    box.innerHTML = rows.length
      ? rows.map((r, i) => `<div class="sku-opt${i === active ? ' on' : ''}" role="option" id="iwSkuOpt${i}"
           aria-selected="${i === active}" data-code="${esc(r.code)}"><span class="sku-n">${esc(r.name)}</span>
           <span class="sku-c" dir="ltr">${esc(r.code)}</span></div>`).join('')
      : `<div class="sku-empty">${esc(emptyMsg)}</div>`;
    if (active >= 0) inp.setAttribute('aria-activedescendant', 'iwSkuOpt' + active);
    else inp.removeAttribute('aria-activedescendant');
  }

  function refresh() {
    const q = ($('iwCode') || {}).value || '';
    if (q.trim()) {
      rows = lgSkuSearch(q, cat(), 8);
      active = rows.length ? 0 : -1;
      render(rows.length ? '' : 'לא נמצא מק"ט — נסה מילה אחרת או קוד');
    } else {
      rows = lgSkuRecentList(cat());
      active = -1;
      render('');
    }
  }

  function hide() { rows = []; active = -1; render(''); }

  function choose(code) {
    const inp = $('iwCode');
    inp.value = code;
    if (typeof iwPreview === 'function') iwPreview(code);
    hide();
    const w = $('iwW'); if (w) w.focus();          // ממשיכים ישר למידה
  }

  //  נקרא מ-onkeydown של השדה לפני הטיפול הקיים. true = טופל כאן.
  window.lgSkuPickerKey = function (e) {
    if (!open || !rows.length) { if (e.key === 'Escape' && open) { hide(); return true; } return false; }
    if (e.key === 'ArrowDown') { active = (active + 1) % rows.length; render(''); e.preventDefault(); return true; }
    if (e.key === 'ArrowUp')   { active = (active - 1 + rows.length) % rows.length; render(''); e.preventDefault(); return true; }
    if (e.key === 'Escape')    { hide(); return true; }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); choose(rows[active].code); return true; }
    return false;
  };

  function wire() {
    const inp = $('iwCode'), box = $('iwSkuList');
    if (!inp || !box) return;
    inp.addEventListener('input', refresh);
    inp.addEventListener('focus', refresh);
    inp.addEventListener('blur', () => setTimeout(hide, 150));
    // pointerdown ולא click — אחרת ה-blur סוגר את הרשימה לפני שהלחיצה נרשמת
    box.addEventListener('pointerdown', ev => {
      const o = ev.target.closest('.sku-opt'); if (!o) return;
      ev.preventDefault(); choose(o.dataset.code);
    });
    window.addEventListener('resize', () => { if (open) place(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
