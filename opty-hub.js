// ═══════════════════════════════════════════════════════════════════
//  opty-hub.js — חיפוש אחד באופטי-ווי (בן, 19/11: "חיפוש הזמנה עפ"י כמה פרמטרים,
//  מידה, שם הזמנה, שם סקיצה וכו'"). מחבר שני מקורות למצב אחד לכל זכוכית:
//  ההזמנות שלנו (stage + optyCut על הפריט) והאופטימיזציות (meta/optyJobs).
//  זכוכית שנחתכה באופטי-ווי ולא מחוברת לשום פריט אצלנו = "לא אצלנו".
//  טהור: דפדפן וגם Node (scripts/test-opty-hub.js).
// ═══════════════════════════════════════════════════════════════════

const LG_HUB_DIM_TOL = 3;           // מ"מ — כמו בחיבור (השרטט מוסיף 2, ליטוש 1 מכל צד)
const LG_HUB_MAX_ORDERS = 100, LG_HUB_MAX_LOOSE = 200;

//  הצבעים/קבוצות של המצב (גם הסינון): wait ממתין · plan לחיתוך · cut נחתך · ready מוכן · done נאסף
const LG_HUB_STATES = [
  { id: '', label: 'הכל' },
  { id: 'wait', label: 'לפני חיתוך' },
  { id: 'plan', label: 'לחיתוך' },
  { id: 'cut', label: 'נחתך' },
  { id: 'ready', label: 'מוכן / נאסף' },
  { id: 'loose', label: 'לא אצלנו' },
];

function _hubLib(name) {
  if (typeof globalThis[name] === 'function') return globalThis[name];
  try { return require('./opty-layout.js')[name]; } catch (e) { return null; }
}
const _hubN = s => String(s == null ? '' : s).toLowerCase().replace(/["'`׳״]/g, '').replace(/\s+/g, ' ').trim();
const _hubIso = ms => { const f = _hubLib('lgOptyTodayIso'); return ms ? (f ? f(Number(ms)) : new Date(Number(ms)).toISOString().slice(0, 10)) : ''; };

//  "850x1900 אביעד 1235" → { pairs:[[850,1900]], words:['אביעד','1235'] }. × * x X / ביניהם — זוג מידות.
function lgHubParse(q) {
  const pairs = [];
  const rest = String(q || '').replace(/(\d{2,4}(?:\.\d+)?)\s*[x×X*\/]\s*(\d{2,4}(?:\.\d+)?)/g, (_, a, b) => { pairs.push([Number(a), Number(b)]); return ' '; });
  return { pairs, words: _hubN(rest).split(' ').filter(Boolean) };
}
const _hubNear = (a, b) => Math.abs(Number(a) - Number(b)) <= LG_HUB_DIM_TOL;
//  מידה של זכוכית (אצלנו נטו; באופטי-ווי עם ליטוש — +2, ולכן גם w-2)
function _hubDimHit(w, h, pair, opty) {
  const W = Number(w) || 0, H = Number(h) || 0, [a, b] = pair;
  const fit = (x, y) => (_hubNear(x, a) && _hubNear(y, b)) || (_hubNear(x, b) && _hubNear(y, a));
  return fit(W, H) || (opty && fit(W - 2, H - 2));
}
const _hubNumHit = (w, h, word, opty) => /^\d{2,4}$/.test(word)
  && [Number(w), Number(h)].some(x => _hubNear(x, word) || (opty && _hubNear(x - 2, word)));

//  ─── מצב אחד לזכוכית שלנו ───
//  השלב שלנו קובע מרגע החיסום והלאה; לפני כן — מה שאופטי-ווי יודע (נחתך / לחיתוך / באופטימיזציה).
const LG_HUB_STAGE = {
  collected: { label: 'נאסף', tone: 'ready' },
  done: { label: 'מוכן לאיסוף', tone: 'ready' },
  delivery: { label: 'מוכן · ממתין להובלה', tone: 'ready' },
  graphic: { label: 'בגרפיקה', tone: 'cut' },
  chisum: { label: 'בחיסום / תחנת בדיקה', tone: 'cut' },
};
const LG_HUB_EARLY = { '': 'ממתין לאישור', pending: 'ממתין לאישור', chash: 'אצל שרטט', drafter: 'אצל שרטט', opty: 'מחכה לאופטי-ווי', workday: 'ביום עבודה' };
function lgHubItemState(o, it, todayIso) {
  const late = LG_HUB_STAGE[(o && o.stage) || ''];
  if (late) return Object.assign({ src: 'ours' }, late);
  const cs = _hubLib('lgOptyCutState'), c = cs && it && it.optyCut ? cs(it.optyCut, todayIso) : null;
  if (c) return { label: c.label, tone: c.cut ? 'cut' : 'plan', src: 'opty' };
  if (it && it.optyJob) return { label: 'באופטימיזציה ' + it.optyJob, tone: 'plan', src: 'opty' };
  return { label: LG_HUB_EARLY[(o && o.stage) || ''] || 'ממתין', tone: 'wait', src: 'ours' };
}

//  ─── שני דברים לעובד (בן, 24/11: "מתי זה נחתך ומה הסטטוס של זה") ───
//  מתי נחתך — מהסימון של אופטי-ווי על הפריט (נשאר גם אחרי שההזמנה עברה לחיסום), ואם אין — לפי יום האופטימיזציה
const _hubDay = iso => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return isNaN(d) ? '' : 'אבגדהוש'[d.getUTCDay()] + "'"; };
const _hubDm = iso => String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7);
const _hubNext = iso => new Date(Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
function _hubWhen(at, cut, todayIso) {
  if (cut) return { label: '✂ נחתך ' + _hubDay(at) + ' ' + _hubDm(at), cut: true };
  if (at === todayIso) return { label: '⏳ לחיתוך היום', cut: false };
  if (at === _hubNext(todayIso)) return { label: '⏳ לחיתוך מחר ' + _hubDm(at), cut: false };
  return { label: '⏳ לחיתוך ' + _hubDay(at) + ' ' + _hubDm(at), cut: false };
}
function lgHubCutLine(it, rec, todayIso) {
  const c = it && it.optyCut;
  if (c && !c.undone && c.at) return _hubWhen(c.at, !!c.marked || c.at < todayIso, todayIso);
  if (it && it.optyJob && rec && rec.day) return _hubWhen(rec.day, false, todayIso);
  if (it && it.optyJob) return { label: 'באופטימיזציה ' + it.optyJob, cut: false };
  return { label: 'עוד לא באופטימיזציה', cut: false };
}
//  איפה עכשיו — השלב שלנו מהחיסום והלאה; לפני כן: נחתך / מתוכנן / השלב המוקדם
function lgHubNow(o, it, todayIso) {
  const late = LG_HUB_STAGE[(o && o.stage) || ''];
  const c = it && it.optyCut, cutNow = c && !c.undone && c.at && (c.marked || c.at < todayIso);
  //  ההזמנה בחיסום אבל הזכוכית הזאת עוד לא נחתכה (למשל שבר שנחתך מחדש) — לא "בחיסום"
  if (late && late.tone === 'cut' && c && !c.undone && c.at && !cutNow) return { label: 'מתוכנן לחיתוך', tone: 'plan' };
  if (late) return { label: late.label, tone: late.tone };
  if (cutNow) return { label: 'נחתך · לפני חיסום', tone: 'cut' };
  if (it && (it.optyJob || (c && !c.undone && c.at))) return { label: 'מתוכנן לחיתוך', tone: 'plan' };
  return { label: LG_HUB_EARLY[(o && o.stage) || ''] || 'ממתין', tone: 'wait' };
}

//  זכוכית מהאופטימיזציה בלבד (לא מחוברת): נחתך / לחיתוך לפי יום העבודה והסימון בלוח, ועם info
//  ({chisum, graphic}) — גם "יוצא לחיסום / בחיסום / מוכן" כמו בחיפוש של 17/11 (lgOptyPieceReady)
function lgHubPieceState(rec, sheetNo, todayIso, info) {
  const pr = _hubLib('lgOptyPieceReady'), pc = _hubLib('lgOptyPieceCut');
  const c = info && pr ? pr(rec, sheetNo, todayIso, !!info.chisum, !!info.graphic) : pc ? pc(rec, sheetNo, todayIso) : { cut: false, label: '' };
  return { label: c.label, tone: c.ready ? 'ready' : c.cut ? 'cut' : 'plan', src: 'opty' };
}
//  חיסום/גרפיקה לזכוכית באופטי-ווי: ההערה גוברת, אחרת סוג הזכוכית (הגדרות)
function _hubPieceInfo(rec, r, mats) {
  const ni = _hubLib('lgOptyNoteInfo'), mc = _hubLib('lgOptyMatChisum');
  const n = ni ? ni(r.note) : { chisum: null, graphic: false };
  return { chisum: n.chisum !== null ? n.chisum : !!(mc && mc(rec.mat, rec.matName, mats)), graphic: n.graphic };
}

//  פריט שלנו → המפתח של הזכוכית באופטי-ווי ('M00320|s274122' או 'M00320|p7')
const _hubKey = (job, shape, pos) => shape ? job + '|s' + shape : job + '|p' + pos;
function lgHubLinkedKeys(orders) {
  const out = new Set();
  (orders || []).forEach(o => _hubItems(o).forEach(({ it }) => {
    if (it && it.optyJob && (it.optyShape || it.optyPos)) out.add(_hubKey(it.optyJob, it.optyShape, it.optyPos));
  }));
  return out;
}
function _hubItems(o) {
  const its = (o && o.items) || [];
  return Array.isArray(its) ? its.map((it, idx) => ({ it, idx })) : Object.keys(its).map((k, idx) => ({ it: its[k], idx }));
}

//  ─── החיפוש ───
//  args: { orders:[{id,orderNum,orderClient,sketchName,stage,createdAt,items}], jobs:{M00…:rec}, todayIso, q,
//          f:{ from, to, mat, state }, waiting:Set(shape) — צורות שמחכות לחיבור (meta/optyPending/optyReview),
//          mats — meta/optyMats (חיסום לפי סוג זכוכית) }
//  → { orders:[{ o, items:[{idx,it,st,hit}], date, mats:[] }], loose:[piece], counts:{ orders, loose } }
function lgHubSearch(args) {
  const a = args || {}, f = a.f || {}, today = a.todayIso || _hubIso(Date.now());
  const { pairs, words } = lgHubParse(a.q);
  const jobs = a.jobs || {}, waiting = a.waiting || new Set();
  const inRange = d => !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to);
  const anyQ = pairs.length || words.length;

  //  הזמנות שלנו
  const outO = [];
  if (f.state !== 'loose') (a.orders || []).forEach(o => {
    if (!o) return;
    const items = _hubItems(o).filter(x => x.it);
    const jobDays = items.map(x => x.it.optyJob && jobs[x.it.optyJob] && jobs[x.it.optyJob].day).filter(Boolean);
    const date = _hubIso(o.createdAt);
    if ((f.from || f.to) && !inRange(date) && !jobDays.some(inRange)) return;
    const mats = [...new Set(items.map(x => x.it.optyJob && jobs[x.it.optyJob] && jobs[x.it.optyJob].mat).filter(Boolean))];
    if (f.mat && !mats.includes(f.mat)) return;
    const head = _hubN([o.orderNum, o.orderClient, o.sketchName, o.id].join(' '));
    const itHay = x => _hubN([x.it.name, x.it.optyShape, x.it.optyJob].join(' '));
    //  כל מילה: בכותרת, או בפריט כלשהו (שם / צורה / M00… / מידה). זוג מידות: בפריט.
    const hitBy = items.map(() => false);
    const okWords = words.every(w => {
      let ok = head.includes(w);
      items.forEach((x, i) => { if (itHay(x).includes(w) || _hubNumHit(x.it.w, x.it.h, w)) { ok = true; if (!head.includes(w)) hitBy[i] = true; } });
      return ok;
    });
    if (!okWords) return;
    const okPairs = pairs.every(p => { let ok = false; items.forEach((x, i) => { if (_hubDimHit(x.it.w, x.it.h, p)) { ok = true; hitBy[i] = true; } }); return ok; });
    if (!okPairs) return;
    const rows = items.map((x, i) => ({ idx: x.idx, it: x.it, st: lgHubItemState(o, x.it, today), hit: hitBy[i] }));
    if (f.state && !rows.some(r => r.st.tone === f.state)) return;
    outO.push({ o, items: rows, date, mats });
  });
  outO.sort((x, y) => (Number(y.o.createdAt) || 0) - (Number(x.o.createdAt) || 0));

  //  זכוכיות באופטי-ווי שלא מחוברות אצלנו
  const outL = [];
  const linked = lgHubLinkedKeys(a.orders);
  const seq = _hubLib('lgOptySheetSeq');
  if (seq && f.state !== 'wait') Object.values(jobs).forEach(rec => {
    if (!rec || !rec.sheets || !rec.job) return;
    if (f.mat && rec.mat !== f.mat) return;
    if ((f.from || f.to) && !inRange(rec.day || '')) return;
    const seen = {};
    seq(rec.sheets).forEach(({ sheetNo, total, sheet }) => (sheet.pieces || []).forEach(p => {
      if (seen[p.pos]) return; seen[p.pos] = 1;
      if (linked.has(_hubKey(rec.job, p.shape, p.pos))) return;
      const r = (rec.pieces || {})[p.pos] || {}, w = r.w || p.w, h = r.h || p.h;
      const hay = _hubN([p.shape, r.client, r.name, rec.job, r.note].join(' '));
      if (!words.every(x => hay.includes(x) || _hubNumHit(w, h, x, true))) return;
      if (!pairs.every(pr => _hubDimHit(w, h, pr, true))) return;
      const st = lgHubPieceState(rec, sheetNo, today, _hubPieceInfo(rec, r, a.mats));
      if (f.state && f.state !== 'loose' && st.tone !== f.state) return;
      outL.push({ job: rec.job, day: rec.day || '', mat: rec.mat || '', sheetNo, total, order: p.order, pos: p.pos, shape: p.shape || '',
        client: r.client || '', name: r.name || '', w, h, note: r.note || '', st, waiting: !!(p.shape && waiting.has(String(p.shape))) });
    }));
  });
  outL.sort((x, y) => (y.day || '').localeCompare(x.day || '') || x.client.localeCompare(y.client) || x.job.localeCompare(y.job) || x.order - y.order);

  return { orders: outO.slice(0, LG_HUB_MAX_ORDERS), loose: outL.slice(0, LG_HUB_MAX_LOOSE),
    counts: { orders: outO.length, loose: outL.length }, query: anyQ };
}

//  "לא אצלנו" לפי לקוח באופטי-ווי — לרשימה המקובצת
function lgHubGroupLoose(loose) {
  const m = new Map();
  (loose || []).forEach(p => { const k = p.client || 'בלי שם לקוח'; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
  return [...m.entries()].map(([client, list]) => ({ client, list }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_HUB_STATES, lgHubParse, lgHubItemState, lgHubCutLine, lgHubNow, lgHubPieceState, lgHubLinkedKeys, lgHubSearch, lgHubGroupLoose };
}
