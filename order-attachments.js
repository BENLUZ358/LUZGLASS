// ═══════════════════════════════════════════════════════════════════
//  order-attachments.js — כמה תמונות על הזמנה אחת (בן, 10/11).
//  אפיון: docs/superpowers/specs/2026-11-10-order-attachments-design.md
//
//  להזמנה סקיצה אחת (sketches/<id>, כמו תמיד). אליה אפשר לצרף תמונות
//  "גרפיקה חלבי" / "שרטוט פרזול": התמונה ב-sketches/<id>__att<k> (כמו
//  __layer / __base הקיימים), והפרטים ב-orders/<id>/attachments/<k>.
//  איחוד = ההזמנה שנגררה נמחקת מהתור, ועותק מלא שלה נשמר ב-from כדי
//  ש"הפרד" יחזיר אותה בדיוק כמו שהייתה.
//
//  החלק העליון — פונקציות טהורות, נבדקות ב-Node (scripts/test-order-attachments.js).
//  החלק התחתון — DOM, רץ רק בדפדפן.
// ═══════════════════════════════════════════════════════════════════

const LG_ATT_KINDS = { graphic: 'גרפיקה חלבי', hardware: 'שרטוט פרזול' };

const _attMail = s => { const m = String(s || '').match(/<([^>]+)>/); return String(m ? m[1] : s || '').trim().toLowerCase(); };

function lgAttList(order) {
  const a = (order && order.attachments) || {};
  return Object.keys(a).map(Number).filter(k => Number.isInteger(k) && a[k] && LG_ATT_KINDS[a[k].kind])
    .sort((x, y) => x - y)
    .map(k => ({ k, kind: a[k].kind, label: LG_ATT_KINDS[a[k].kind], at: a[k].at || 0 }));
}

function lgAttSlides(order) {
  const atts = (order && order.attachments) || {};
  //  מרכזן (10/11): צרופה שהמרכזן צירף לבד — כתוב עליה, ו"הפרד" שם כמו תמיד
  const by = a => (atts[a.k] && atts[a.k].attachedBy === 'markazan' ? ' · צורף ע"י המרכזן' : '');
  return [{ label: 'סקיצה', key: order.id },
          ...lgAttList(order).map(a => ({ label: a.label + by(a), key: order.id + '__att' + a.k, k: a.k }))];
}

//  מרכזן (סקירה 10/11): להזמנה יש צרופה שהמרכזן צירף לבד — תג בשורה בתור, כדי שבן יפתח ו"הפרד"
function lgAttByMarkazan(order) {
  const a = (order && order.attachments) || {};
  return Object.keys(a).some(k => a[k] && a[k].attachedBy === 'markazan');
}

//  מרכזן (10/11): הצעת צרופה על שורה בתור — orders/<id>/attachSuggest (api/_attach-suggest.js)
function lgAttSuggestText(order) {
  const s = order && order.attachSuggest;
  if (!s || !s.targetId || !LG_ATT_KINDS[s.kind]) return '';
  const name = String(s.targetName || '').trim() || String(s.targetNum || '').trim() || 'הסקיצה';
  return 'נראה כמו ' + LG_ATT_KINDS[s.kind] + " — לצרף ל'" + name + "'?";
}

function lgAttCanMerge(src, dst) {
  if (!src || !dst || !src.id || !dst.id) return { ok: false, why: 'הזמנה לא נמצאה' };
  if (src.id === dst.id) return { ok: false, why: 'אי אפשר לחבר הזמנה לעצמה' };
  if (src.stage) return { ok: false, why: 'אפשר לחבר רק תמונה שעוד בתור הסקיצות' };
  if (src.items && Object.keys(src.items).length) return { ok: false, why: 'לתמונה הזו כבר הוזנו פריטים — היא הזמנה, לא צרופה' };
  //  הצרופות של המקור היו נעלמות (רק העותק ב-from היה זוכר אותן)
  if (lgAttList(src).length) return { ok: false, why: 'לתמונה הזו יש כבר תמונות נוספות — קודם הפרד אותן' };
  if (src.hashavshevet && Object.keys(src.hashavshevet).length) return { ok: false, why: 'התמונה הזו כבר נשלחה לחשבשבת' };
  const sc = String(src.customerId || ''), dc = String(dst.customerId || '');
  if (sc || dc) {
    if (sc !== dc) return { ok: false, why: 'אפשר לחבר רק בין הזמנות של אותו לקוח' };
  } else {
    const sameWa = src.waSender && String(src.waSender) === String(dst.waSender || '');
    const sameMail = src.emailFrom && _attMail(src.emailFrom) === _attMail(dst.emailFrom);
    if (!sameWa && !sameMail) return { ok: false, why: 'אפשר לחבר רק בין הזמנות של אותו שולח' };
  }
  return { ok: true };
}

//  ההזמנות שאפשר לחבר אליהן — אותו לקוח, כל שלב, החדשה למעלה, עד 12
function lgAttCandidates(src, orders) {
  return (orders || []).filter(o => o && o.id !== src.id && lgAttCanMerge(src, o).ok)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
}

//  k הבא: אחרי המונה orders/<dst>/attNext ואחרי הגדול שקיים (הזמנות מלפני המונה).
//  ⚠️ k לא חוזר לשימוש — גם לא אחרי "הפרד" — כי הודעות ומטמונים כבר מכירים את <dst>__att<k>.
function _attNextK(dst, attNext) {
  const ks = Object.keys((dst && dst.attachments) || {}).map(Number).filter(Number.isInteger);
  const n = Number(attNext);
  return Math.max((ks.length ? Math.max(...ks) : 0) + 1, Number.isInteger(n) && n > 0 ? n : 1);
}

//  src/dst = רשומות ההזמנה. srcSketch = data URL של התמונה. extra = { layer, base } של עורך הסקיצות.
//  k = המספר שהוקצה בטרנזקציה על attNext (lgAttMerge); בלי k — החישוב מהרשומה (בדיקות).
//  → { k, upd } — עדכון רב-נתיבי אחד (אטומי)
function lgAttMergePlan(src, dst, kind, srcSketch, extra, now, by, kAlloc) {
  if (!LG_ATT_KINDS[kind]) throw new Error('סוג צרופה לא מוכר');
  const k = Number.isInteger(kAlloc) && kAlloc > 0 ? kAlloc : _attNextK(dst, dst && dst.attNext);
  const e = extra || {};
  //  העותק בלי השדות הכבדים: התמונה עצמה כבר עוברת ל-sketches/<dst>__att<k>,
  //  ו"הפרד" מחזיר אותה ל-sketches/<srcId>
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.sketch; delete copy.files;
  const upd = {};
  upd['sketches/' + dst.id + '__att' + k] = srcSketch;
  upd['orders/' + dst.id + '/attachments/' + k] = { kind, at: now, by: String(by || ''),
    from: { order: copy, layer: e.layer || null, base: e.base || null } };
  upd['orders/' + dst.id + '/updatedAt'] = now;
  upd['orders/' + src.id] = null;
  upd['sketches/' + src.id] = null;
  upd['sketches/' + src.id + '__layer'] = null;
  upd['sketches/' + src.id + '__base'] = null;
  return { k, upd };
}

function lgAttSplitPlan(dst, k, attSketch) {
  const a = dst && dst.attachments && dst.attachments[k];
  if (!a || !a.from || !a.from.order || !a.from.order.id) throw new Error('הצרופה לא נמצאה');
  const o = a.from.order;
  const upd = {};
  upd['orders/' + o.id] = JSON.parse(JSON.stringify(o));
  //  מרכזן (סקירה 10/11): השורה חוזרת בלי ההצעה — אחרת התג חוזר ו"צרף" נספר פעמיים
  delete upd['orders/' + o.id].attachSuggest;
  upd['sketches/' + o.id] = attSketch;
  if (a.from.layer) upd['sketches/' + o.id + '__layer'] = a.from.layer;
  if (a.from.base) upd['sketches/' + o.id + '__base'] = a.from.base;
  upd['orders/' + dst.id + '/attachments/' + k] = null;
  upd['sketches/' + dst.id + '__att' + k] = null;
  upd['orders/' + dst.id + '/updatedAt'] = Date.now();
  return upd;
}

//  הודעת וואטסאפ שהפכה לצרופה → { orderId, k } | null
function lgAttFindByMsg(orders, waMessageId) {
  const id = String(waMessageId || '');
  if (!id) return null;
  for (const o of orders || []) {
    const a = (o && o.attachments) || {};
    for (const k of Object.keys(a)) {
      const f = a[k] && a[k].from && a[k].from.order;
      if (f && String(f.waMessageId || '') === id) return { orderId: o.id, k: Number(k) };
    }
  }
  return null;
}

// ── לחיצה ארוכה, החלקה, דפדוף ──────────────────────────────────────────
const LG_ATT_PRESS_MS = 500;      // לחיצה ארוכה על שורה בתור
const LG_ATT_PRESS_SLOP = 10;     // תזוזה מעבר לזה = גלילה, לא לחיצה ארוכה
const LG_ATT_SWIPE_MIN = 40;

function lgAttPressMoved(dx, dy) { return Math.hypot(dx || 0, dy || 0) > LG_ATT_PRESS_SLOP; }

//  החלקה אופקית → +1 (הבאה) / -1 (הקודמת) / 0. בעברית הבאה באה משמאל,
//  ולכן אצבע שזזה ימינה = הבאה (כמו דפדוף בספר).
function lgAttSwipeDir(dx, dy) {
  const ax = Math.abs(dx || 0), ay = Math.abs(dy || 0);
  if (ax < LG_ATT_SWIPE_MIN || ax < ay * 1.5) return 0;
  return dx > 0 ? 1 : -1;
}

function lgAttStep(i, dir, n) {
  if (!n) return 0;
  return Math.max(0, Math.min(n - 1, (i || 0) + (dir || 0)));
}

//  כבר יצאה חשבונית על ההזמנה (מלאה או חלקית) — רשומה גולמית או אחרי lgNormalizeOrder
function lgAttInvoiced(o) {
  if (!o) return false;
  const d = o.invoiceDone;
  if (d && d.docNumber) return true;
  const has = x => !!(x && typeof x === 'object' && Object.keys(x).length);
  return has(d && d.pieces) || has(o.invoicePieces);
}

function lgAttBadge(o) {
  const n = lgAttList(o).length;
  return n ? '📎 ' + n : '';
}

// ═══ דפדפן ═══════════════════════════════════════════════════════════
if (typeof window !== 'undefined') (function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => { if (typeof showToast === 'function') showToast(m); else window.alert(m); };
  const allOrders = () => (typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [];
  const stageLabel = o => !o.stage ? 'בתור הסקיצות'
    : (typeof lgStageToStatus === 'function' ? lgStageToStatus(o.stage) : o.stage);
  const cache = () => (typeof _lgSketchCache !== 'undefined' ? _lgSketchCache : null);

  function css() {
    if (document.getElementById('lgAttCss')) return;
    const st = document.createElement('style');
    st.id = 'lgAttCss';
    st.textContent = `
.lg-att-bar{display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 8px;direction:rtl;font-family:Heebo,sans-serif;flex-wrap:wrap;box-sizing:border-box;max-width:100%}
.lg-att-bar.lg-att-ov{position:absolute;left:0;right:0;margin:0 auto;width:max-content;flex-wrap:nowrap;z-index:6;background:rgba(26,23,20,0.85);border-radius:999px;max-width:calc(100% - 16px)}
.lg-att-bar.lg-att-top{top:8px}.lg-att-bar.lg-att-bottom{bottom:8px}
.lg-att-btn{min-width:44px;min-height:44px;border:1px solid rgba(0,0,0,0.15);background:#fff;color:#1a1714;border-radius:10px;font:700 20px Heebo,sans-serif;cursor:pointer;padding:0}
.lg-att-btn:disabled{opacity:0.35;cursor:default}
.lg-att-mid{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.lg-att-chip{font:700 13px Heebo,sans-serif;padding:3px 10px;border-radius:999px;background:#f5efe0;color:#7a5c12;white-space:nowrap}
.lg-att-n{font:700 12px Heebo,sans-serif;color:#777}
.lg-att-ov .lg-att-n{color:#f7f4ef}
.lg-att-dots{display:flex;gap:4px}
.lg-att-dot{width:8px;height:8px;border-radius:50%;background:rgba(128,128,128,0.45)}
.lg-att-dot.on{background:#b8922a}
.lg-att-split{min-height:44px;padding:0 14px;font:700 13px Heebo,sans-serif;border:1px solid #c0392b;color:#c0392b;background:#fff;border-radius:10px;cursor:pointer}
.lg-att-split[hidden]{display:none}
.lg-att-dlg{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;direction:rtl}
.lg-att-sheet{background:#fff;color:#1a1714;width:100%;max-width:480px;max-height:85vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px;box-sizing:border-box;font-family:Heebo,sans-serif}
.lg-att-h{font:800 16px Heebo,sans-serif;margin:0 0 4px}
.lg-att-sub{font-size:13px;color:#666;margin:0 0 12px}
.lg-att-big{display:block;width:100%;min-height:56px;margin:0 0 10px;font:800 16px Heebo,sans-serif;border-radius:12px;border:2px solid #b8922a;background:#fff;color:#1a1714;cursor:pointer}
.lg-att-opt{display:block;width:100%;text-align:right;min-height:52px;padding:8px 12px;margin:0 0 8px;border:1px solid rgba(0,0,0,0.12);border-radius:10px;background:#faf8f4;color:#1a1714;font:700 14px Heebo,sans-serif;cursor:pointer;overflow-wrap:anywhere}
.lg-att-opt small{display:block;font-size:12px;font-weight:400;color:#666}
.lg-att-none{font-size:13px;color:#666;padding:8px 0 14px}
.lg-att-cancel{display:block;width:100%;min-height:44px;border:none;background:#eee;color:#1a1714;border-radius:10px;font:700 14px Heebo,sans-serif;cursor:pointer}
.lg-att-grab{outline:2px dashed #b8922a;outline-offset:-2px;opacity:0.75}
.lg-att-drop{outline:2px solid #b8922a;outline-offset:-2px;background:rgba(184,146,42,0.12)}
.lg-att-nosel{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
@media (min-width:600px){.lg-att-dlg{align-items:center}.lg-att-sheet{border-radius:14px}}`;
    document.head.appendChild(st);
  }

  //  חלון תחתון. build(box, close) ממלא אותו; close(v) סוגר ומחזיר v.
  function sheet(build) {
    css();
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'lg-att-dlg';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      const box = document.createElement('div');
      box.className = 'lg-att-sheet';
      ov.appendChild(box);
      let done = false;
      const close = v => { if (done) return; done = true; ov.remove(); resolve(v); };
      ov.addEventListener('click', e => { if (e.target === ov) close(null); });
      // ⚠️ חצי המקלדת של התור (← →) לא יעברו לסקיצה אחרת מאחורי החלון
      ov.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(null); });
      build(box, close);
      document.body.appendChild(ov);
      const f = box.querySelector('button'); if (f) f.focus();
    });
  }

  //  → Promise<'graphic'|'hardware'|null>
  window.lgAttPickKind = function () {
    return sheet((box, close) => {
      box.innerHTML = '<p class="lg-att-h">מה התמונה הזו?</p><p class="lg-att-sub">היא תצורף להזמנה ותופיע ליד הסקיצה.</p>'
        + Object.keys(LG_ATT_KINDS).map(k => `<button type="button" class="lg-att-big" data-kind="${k}">${esc(LG_ATT_KINDS[k])}</button>`).join('')
        + '<button type="button" class="lg-att-cancel" data-kind="">ביטול</button>';
      box.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        close(b.dataset.kind || null);
      });
    });
  };

  //  הרשומה הגולמית מ-Firebase (לא זו שעברה lgNormalizeOrder) — כדי ש"הפרד" יחזיר בדיוק
  async function readOrder(id) {
    const v = (await _lgDb.ref('orders/' + id).once('value')).val();
    return v ? Object.assign({}, v, { id: v.id || id }) : null;
  }

  function who() {
    try { if (typeof lgVerifiedSession === 'function') { const s = lgVerifiedSession(); return s ? (s.name || s.phone || '') : ''; } } catch (e) {}
    return '';
  }

  //  איחוד: srcId (שורה בתור) נכנסת לתוך dstId כצרופה. כתיבה אטומית אחת.
  window.lgAttMerge = async function (srcId, dstId, kind) {
    try {
      const [src, dst] = await Promise.all([readOrder(srcId), readOrder(dstId)]);
      if (!src || !dst) { toast('ההזמנה לא נמצאה'); return false; }
      const ok = lgAttCanMerge(src, dst);
      if (!ok.ok) { toast(ok.why); return false; }
      const img = await lgLoadSketch(src);
      if (!img) { toast('אין תמונה להעביר'); return false; }
      // ⚠️ השכבה של עורך הסקיצות נקראת כמו שהיא שמורה (מחרוזת), כדי ש"הפרד" יחזיר אותה בדיוק.
      // lgLoadSketchLayer מפענח אותה, וכתיבה חוזרת של האובייקט הייתה שוברת את העורך.
      const [l, b] = await Promise.all([
        _lgDb.ref('sketches/' + srcId + '__layer').once('value'),
        _lgDb.ref('sketches/' + srcId + '__base').once('value'),
      ]);
      //  ⚠️ k מוקצה בטרנזקציה על המונה, לפני הכתיבה — שני איחודים לאותה הזמנה בבת אחת
      //  לא יקבלו אותו k (ואחד היה דורס את התמונה של השני). פיירבייס קוראת קודם עם null.
      const minK = _attNextK(dst, dst.attNext);
      const tx = await _lgDb.ref('orders/' + dst.id + '/attNext')
        .transaction(cur => _attNextK(null, Math.max(Number(cur) || 0, minK)) + 1);
      if (!tx || !tx.committed) throw new Error('לא הוקצה מקום לצרופה');
      const k = Number(tx.snapshot.val()) - 1;
      const plan = lgAttMergePlan(src, dst, kind, img, { layer: l.val(), base: b.val() }, Date.now(), who(), k);
      await _lgDb.ref().update(plan.upd);
      const c = cache();
      if (c) { c.set(dst.id + '__att' + plan.k, img); c.delete(String(src.id)); }
      toast('צורף ל' + (dst.orderNum ? 'הזמנה ' + dst.orderNum : 'הזמנה') + ' — ' + LG_ATT_KINDS[kind]);
      if (lgAttInvoiced(dst)) setTimeout(() => toast('החשבונית כבר נשלחה בלי התמונה הזו'), 2700);
      return true;
    } catch (e) {
      toast('האיחוד לא נשמר: ' + ((e && e.message) || e));
      return false;
    }
  };

  //  הפרדה: הצרופה k חוזרת להיות שורה בתור, בדיוק כמו שהייתה.
  window.lgAttSplit = async function (dstId, k) {
    try {
      const dst = await readOrder(dstId);
      if (!dst) { toast('ההזמנה לא נמצאה'); return false; }
      const img = await lgGetSketch(dstId + '__att' + k);
      if (!img) { toast('התמונה של הצרופה לא נמצאה'); return false; }
      const upd = lgAttSplitPlan(dst, k, img);
      await _lgDb.ref().update(upd);
      const back = dst.attachments[k].from.order.id;
      const c = cache();
      if (c) { c.delete(dstId + '__att' + k); c.set(String(back), img); }
      toast('הופרד — התמונה חזרה לתור הסקיצות');
      return true;
    } catch (e) {
      toast('ההפרדה לא נשמרה: ' + ((e && e.message) || e));
      return false;
    }
  };

  async function pickAndMerge(srcId, dstId) {
    const src = allOrders().find(o => String(o.id) === String(srcId));
    const dst = allOrders().find(o => String(o.id) === String(dstId));
    if (src && dst) { const ok = lgAttCanMerge(src, dst); if (!ok.ok) { toast(ok.why); return false; } }
    const kind = await window.lgAttPickKind();
    if (!kind) return false;
    return window.lgAttMerge(srcId, dstId, kind);
  }

  //  "חבר אל…" — ההזמנות של אותו לקוח (כל שלב), החדשה למעלה
  window.lgAttConnectMenu = function (src) {
    if (!src) return Promise.resolve(false);
    const list = lgAttCandidates(src, allOrders());
    return sheet((box, close) => {
      box.innerHTML = `<p class="lg-att-h">חבר אל…</p>
        <p class="lg-att-sub">התמונה של ${esc(src.orderClient || src.client || 'הלקוח')} תצורף להזמנה שתבחר, ותצא מהתור.</p>`
        + (list.length
          ? list.map(o => `<button type="button" class="lg-att-opt" data-id="${esc(o.id)}">${esc(o.orderNum || 'בלי מספר')} · ${esc(o.orderClient || '')}
              <small>${esc(o.sketchName || 'ללא שם')} · ${esc(stageLabel(o))}</small></button>`).join('')
          : '<div class="lg-att-none">אין הזמנה אחרת של אותו לקוח שאפשר לחבר אליה.</div>')
        + '<button type="button" class="lg-att-cancel">ביטול</button>';
      box.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        close(b.dataset.id || null);
      });
    }).then(id => id ? pickAndMerge(src.id, id) : false);
  };

  //  לחיצה ארוכה (טלפון ועכבר) + גרירה (עכבר) על שורות ברשימה.
  //  opts: { row: '[data-sq-id]', idOf(row) → id }
  window.lgAttWireList = function (listEl, opts) {
    if (!listEl || listEl._lgAttWired) return;
    listEl._lgAttWired = true;
    css();
    listEl.classList.add('lg-att-nosel');
    const rowSel = (opts && opts.row) || '[data-sq-id]';
    const idOf = (opts && opts.idOf) || (r => r.dataset.sqId);
    const find = id => allOrders().find(o => String(o.id) === String(id));
    let t = null, x0 = 0, y0 = 0, row = null, fired = false, dragId = null;
    const stop = () => { clearTimeout(t); t = null; row = null; };
    listEl.addEventListener('pointerdown', e => {
      const r = e.target.closest(rowSel); if (!r || !listEl.contains(r)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // גרירה בעכבר בלבד — בטלפון לחיצה ארוכה מפעילה גרירה של הדפדפן ומבלבלת
      r.draggable = e.pointerType === 'mouse';
      stop(); fired = false; row = r; x0 = e.clientX; y0 = e.clientY;
      t = setTimeout(() => {
        const rr = row; stop();
        const src = rr && find(idOf(rr));
        if (!src) return;
        fired = true;
        rr.classList.add('lg-att-grab');
        try { if (navigator.vibrate) navigator.vibrate(20); } catch (err) {}
        window.lgAttConnectMenu(src).finally(() => rr.classList.remove('lg-att-grab'));
      }, LG_ATT_PRESS_MS);
    });
    listEl.addEventListener('pointermove', e => { if (t && lgAttPressMoved(e.clientX - x0, e.clientY - y0)) stop(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => listEl.addEventListener(ev, () => { if (t) stop(); }));
    // אחרי לחיצה ארוכה — לא לפתוח את הסקיצה (sqSelect) ולא את תפריט הדפדפן
    listEl.addEventListener('click', e => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
    listEl.addEventListener('contextmenu', e => { if (t || fired) e.preventDefault(); });
    listEl.addEventListener('dragstart', e => {
      const r = e.target.closest && e.target.closest(rowSel); if (!r) return;
      stop();
      dragId = idOf(r);
      r.classList.add('lg-att-grab');
      try { e.dataTransfer.setData('text/plain', String(dragId)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    const over = e => { const r = e.target.closest && e.target.closest(rowSel); return r && dragId && idOf(r) !== dragId ? r : null; };
    const clearDrop = () => listEl.querySelectorAll('.lg-att-drop').forEach(x => x.classList.remove('lg-att-drop'));
    listEl.addEventListener('dragover', e => {
      const r = over(e); if (!r) return;
      e.preventDefault();
      if (!r.classList.contains('lg-att-drop')) { clearDrop(); r.classList.add('lg-att-drop'); }
    });
    listEl.addEventListener('dragleave', e => { const r = over(e); if (r && !r.contains(e.relatedTarget)) r.classList.remove('lg-att-drop'); });
    listEl.addEventListener('dragend', () => {
      clearDrop(); listEl.querySelectorAll('.lg-att-grab').forEach(x => x.classList.remove('lg-att-grab')); dragId = null;
    });
    listEl.addEventListener('drop', e => {
      const r = over(e); if (!r) return;
      e.preventDefault();
      const srcId = dragId, dstId = idOf(r);
      clearDrop(); dragId = null;
      pickAndMerge(srcId, dstId);
    });
  };

  //  דפדוף בין הסקיצה לצרופות, על ה-<img> הקיים של הדף.
  //  container — האלמנט שבו התמונה; order — ההזמנה (null = רק לנקות פס ישן).
  //  opts: { img, overlay: 'top'|'bottom', swipe: false, onSplit(k) }
  //  ⚠️ בלי צרופות — לא נוגעים בכלום (רק מסירים פס של הזמנה קודמת, אם נשאר).
  window.lgAttFlipper = function (container, order, opts) {
    opts = opts || {};
    const img = opts.img || (container && container.querySelector('img'));
    const slides = order && order.id ? lgAttSlides(order) : [];
    const sig = slides.map(s => s.key).join('|');
    // אותה הזמנה ואותן צרופות (עדכון חי) — משאירים את הדפדוף איפה שהוא
    // (אלא אם הדף החליף בינתיים את התמונה בעצמו — אז מתחילים מהסקיצה)
    const old = img && img._lgAttBar;
    if (old && old.isConnected && old._sig === sig && slides.length > 1
        && (old._api.index === 0 || img.dataset.lgFor === old._key())) return old._api;
    const drop = b => { if (b._lgOff) b._lgOff(); b.remove(); };
    if (img && img._lgAttBar) { drop(img._lgAttBar); img._lgAttBar = null; }
    [container, img && img.parentElement].forEach(h => {
      if (h) h.querySelectorAll(':scope > .lg-att-bar').forEach(b => { if (!b._lgImg || !b._lgImg.isConnected || b._lgImg === img) drop(b); });
    });
    if (!img || slides.length < 2) return null;
    css();

    let i = 0, mainSrc = '', mainFor = '', token = 0;
    const bar = document.createElement('div');
    bar.className = 'lg-att-bar' + (opts.overlay ? ' lg-att-ov lg-att-' + opts.overlay : '');
    bar._lgImg = img;
    bar._sig = sig;
    bar.innerHTML = `<button type="button" class="lg-att-btn" data-d="-1" aria-label="התמונה הקודמת">›</button>
      <div class="lg-att-mid"><span class="lg-att-chip" aria-live="polite"></span>
        <span class="lg-att-dots" aria-hidden="true">${slides.map(() => '<span class="lg-att-dot"></span>').join('')}</span></div>
      <span class="lg-att-n"></span>
      <button type="button" class="lg-att-btn" data-d="1" aria-label="התמונה הבאה">‹</button>
      ${opts.onSplit ? '<button type="button" class="lg-att-split" hidden>הפרד</button>' : ''}`;
    const $q = s => bar.querySelector(s);

    function paint() {
      const s = slides[i];
      $q('.lg-att-chip').textContent = s.label;
      $q('.lg-att-n').textContent = (i + 1) + '/' + slides.length;
      bar.querySelectorAll('.lg-att-dot').forEach((d, j) => d.classList.toggle('on', j === i));
      $q('[data-d="-1"]').disabled = i === 0;
      $q('[data-d="1"]').disabled = i === slides.length - 1;
      const sp = $q('.lg-att-split'); if (sp) sp.hidden = !s.k;
    }

    function go(n) {
      n = lgAttStep(n, 0, slides.length);
      if (n === i) return;
      if (i === 0) { mainSrc = img.getAttribute('src') || ''; mainFor = img.dataset.lgFor || ''; }
      i = n;
      const my = ++token;
      paint();
      if (i === 0) {
        img.dataset.lgFor = mainFor;
        if (mainSrc) img.src = mainSrc;
        // ⚠️ הסקיצה אולי לא סיימה להיטען כשדפדפנו ממנה (הטעינה ראתה lgFor של צרופה ונזרקה),
        // ו-mainSrc הוא ממלא מקום. טוענים שוב — מהמטמון; אם כבר נטענה, lgSketchIntoImg לא משנה כלום.
        if ((!mainSrc || !mainFor || mainFor === String(order.id)) && typeof lgSketchIntoImg === 'function') lgSketchIntoImg(img, order);
        return;
      }
      const key = slides[i].key;
      // טעינה מאחרת של הסקיצה הראשית (lgSketchIntoImg) לא תדרוס את הצרופה
      img.dataset.lgFor = key;
      lgGetSketch(key).then(src => {
        // ⚠️ גם lgFor: הדף אולי כבר טען לאותו <img> הזמנה אחרת
        if (my !== token || !img.isConnected || img.dataset.lgFor !== key) return;
        if (src) img.src = src;
        else if (typeof showToast === 'function') showToast('התמונה לא נמצאה');
        else console.warn('[order-attachments] חסרה תמונה:', key);
      }).catch(() => {});
    }

    bar.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.d) { go(i + Number(b.dataset.d)); return; }
      if (b.classList.contains('lg-att-split') && slides[i].k && opts.onSplit) {
        if (!window.confirm('להפריד את ה' + slides[i].label + ' מההזמנה? היא תחזור לתור הסקיצות.')) return;
        opts.onSplit(slides[i].k);
      }
    });
    // לחיצה על הפס לא פותחת/סוגרת את מה שמתחתיו (למשל לוח בסגירה בנגיעה ברקע)
    bar.addEventListener('pointerdown', e => e.stopPropagation());

    // החלקה על התמונה
    let sx = null, sy = 0, swiped = false;
    const down = e => { sx = e.clientX; sy = e.clientY; swiped = false; };
    const up = e => {
      if (sx === null) return;
      const d = lgAttSwipeDir(e.clientX - sx, e.clientY - sy); sx = null;
      if (d) { swiped = true; go(i + d); }
    };
    const click = e => { if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); } };
    if (opts.swipe !== false) {
      img.addEventListener('pointerdown', down);
      img.addEventListener('pointerup', up);
      img.addEventListener('click', click, true);
    }
    bar._lgOff = () => {
      img.removeEventListener('pointerdown', down);
      img.removeEventListener('pointerup', up);
      img.removeEventListener('click', click, true);
      token++;
      // מחזירים את הסקיצה רק אם התמונה עוד מציגה צרופה שלנו. הדף כבר טען
      // הזמנה אחרת לאותו <img> (lgFor השתנה) — לא דורסים אותה בסקיצה הישנה.
      if (i !== 0 && img.dataset.lgFor === slides[i].key) { img.dataset.lgFor = mainFor; if (mainSrc) img.src = mainSrc; }
    };
    bar._key = () => slides[i].key;
    bar._api = { go: n => go(n), get index() { return i; } };
    img._lgAttBar = bar;

    paint();
    if (opts.overlay && container) {
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.appendChild(bar);
    } else {
      img.insertAdjacentElement('afterend', bar);
    }
    return bar._api;
  };
})();
