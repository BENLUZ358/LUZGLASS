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
//  זכוכית שלא במערכת (רק באופטי-ווי): אותה שורת "מתי נחתך" לפי יום העבודה ומצב החיתוך (בן, 24/11)
function lgHubDayLine(dayIso, cut, todayIso) {
  return dayIso ? _hubWhen(String(dayIso).slice(0, 10), !!cut, todayIso) : { label: '', cut: false };
}
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

//  ─── סוג זכוכית אחד לשני המקורות (בן, 27/11: סינון לפי זכוכית) ───
//  אצלנו: עובי + שם ("8 קליר"); באופטי-ווי: קוד חומר (08C) → השם בעברית → המילים שלנו.
//  ⚠️ "קליר" אצלנו = אקסטרה קליר באופטי-ווי (C), "שקוף" = S. "גלינה קליר" = Master Line Clear.
const LG_HUB_GLASS_SYN = [['מאסטר ליין שקוף', 'גלינה קליר'], ['אקסטרה קליר', 'קליר'], ['חלבי שקוף', 'אסיד קליר'], ['חלבי', 'אסיד'],
  ['פפיט', 'פפיטה'], ['מראה אפור', 'מראה אפורה']];
const _hubGlassClean = s => {
  let t = String(s || '').replace(/["'׳״]/g, '').replace(/\s*mm\b|\s*ממ\b/gi, '').replace(/\s+/g, ' ').trim();
  for (const [a, b] of LG_HUB_GLASS_SYN) if (t.endsWith(' ' + a) || t === a) { t = t.slice(0, t.length - a.length) + b; break; }
  return t.replace(/^0+(\d)/, '$1');
};
//  קוד חומר של אופטי-ווי → "8 קליר" (בלי השם — הקוד עצמו)
function lgHubMatGlass(code, mats) {
  const c = String(code || ''); if (!c) return '';
  const m = (mats || {})[c] || {}, heF = _hubLib('lgOptyMatHe');
  const he = m.he || (m.en && heF ? heF(c, m.en) : '');
  return he ? _hubGlassClean(he) : c;
}
//  פריט שלנו → "8 קליר" / "8+8 שקוף" (טריפלקס); בלי עובי/זכוכית — מהשם המלא; אחרת מהאופטימיזציה
function lgHubGlass(it, rec, mats) {
  if (!it) return '';
  const full = String(it.glassFullName || it.name || '');
  const tri = full.match(/(\d{1,2})\s*\+\s*(\d{1,2})/);
  if (it.glass && (it.mm || tri)) return _hubGlassClean((tri ? tri[1] + '+' + tri[2] : it.mm) + ' ' + it.glass);
  const m = full.replace(/["'׳״]/g, '').match(/(\d{1,2}(?:\s*\+\s*\d{1,2})?)\s*ממ\s+(.+?)(?:\s+(?:מחוסם|מלוטש|גרפיקה|צורתית|טריפלקס|צבע))*\s*$/);
  if (m) return _hubGlassClean(m[1].replace(/\s+/g, '') + ' ' + m[2].replace(/\s+(מחוסם|מלוטש|גרפיקה|צורתית|טריפלקס|צבע)\b/g, '').trim());
  if (rec && rec.mat) return lgHubMatGlass(rec.mat, mats);
  return '';
}

//  ─── החיפוש ───
//  args: { orders:[{id,orderNum,orderClient,sketchName,stage,createdAt,items}], jobs:{M00…:rec}, todayIso, q,
//          f:{ from, to, by:'cut'|'order', glass:[], clients:[], wMin, wMax, hMin, hMax, state, sort:'new'|'old', mat },
//          waiting:Set(shape), mats — meta/optyMats, clientOf(optyName) → השם אצלנו (זוגות השמות) }
//  תאריך (בן 27/11, המועצה): by='cut' (ברירת מחדל) — יום החיתוך של הזכוכית (הסימון או יום האופטימיזציה), ולזכוכית
//  שעוד לא באופטימיזציה — יום ההזמנה; by='order' — רק יום ההזמנה.
//  → { orders:[{ o, items:[{idx,it,st,hit,match,glass}], date, mats:[] }], loose:[piece], counts:{ orders, loose, units, m2 },
//      stateCounts:{ '':n, wait, plan, cut, ready } }
const _hubQty = it => Math.max(1, Number(it && (it.quantity || it.qty)) || 1);
const _hubNum = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
function lgHubSearch(args) {
  const a = args || {}, f = a.f || {}, today = a.todayIso || _hubIso(Date.now());
  const { pairs, words } = lgHubParse(a.q);
  const jobs = a.jobs || {}, waiting = a.waiting || new Set();
  const inRange = d => !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to);
  const dated = !!(f.from || f.to), byOrder = f.by === 'order';
  const anyQ = pairs.length || words.length;
  const glassSet = (f.glass || []).length ? new Set(f.glass) : null;
  const clientSet = (f.clients || []).length ? new Set(f.clients.map(_hubN)) : null;
  const wMin = _hubNum(f.wMin), wMax = _hubNum(f.wMax), hMin = _hubNum(f.hMin), hMax = _hubNum(f.hMax);
  const sizeOk = (w, h, opty) => {
    const W = (Number(w) || 0) - (opty ? 2 : 0), H = (Number(h) || 0) - (opty ? 2 : 0), T = opty ? LG_HUB_DIM_TOL : 0;
    return (wMin == null || W >= wMin - T) && (wMax == null || W <= wMax + T) && (hMin == null || H >= hMin - T) && (hMax == null || H <= hMax + T);
  };
  const clientOf = typeof a.clientOf === 'function' ? a.clientOf : (x => x);
  const stateCounts = { '': 0, wait: 0, plan: 0, cut: 0, ready: 0 };

  //  הזמנות שלנו
  const outO = [];
  if (f.state !== 'loose') (a.orders || []).forEach(o => {
    if (!o) return;
    if (clientSet && !clientSet.has(_hubN(o.orderClient))) return;
    const items = _hubItems(o).filter(x => x.it);
    const date = _hubIso(o.createdAt);
    if (byOrder && dated && !inRange(date)) return;
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
    const rows = items.map((x, i) => {
      const rec = x.it.optyJob && jobs[x.it.optyJob];
      const c = x.it.optyCut, cutDay = c && !c.undone && c.at ? String(c.at).slice(0, 10) : (rec && rec.day) || '';
      const glass = lgHubGlass(x.it, rec, a.mats);
      const ok = (!glassSet || glassSet.has(glass)) && sizeOk(x.it.w, x.it.h, false)
        && (byOrder || !dated || inRange(cutDay || date));
      return { idx: x.idx, it: x.it, st: lgHubItemState(o, x.it, today), hit: hitBy[i], ok, glass };
    });
    if (!rows.some(r => r.ok)) return;
    stateCounts[''] += 1;
    ['wait', 'plan', 'cut', 'ready'].forEach(t => { if (rows.some(r => r.ok && r.st.tone === t)) stateCounts[t] += 1; });
    rows.forEach(r => { r.match = r.ok && (!f.state || r.st.tone === f.state); });
    if (f.state && !rows.some(r => r.match)) return;
    outO.push({ o, items: rows, date, mats });
  });
  outO.sort((x, y) => (Number(y.o.createdAt) || 0) - (Number(x.o.createdAt) || 0));
  if (f.sort === 'old') outO.reverse();

  //  זכוכיות באופטי-ווי שלא מחוברות אצלנו (אין להן יום הזמנה — לפי יום האופטימיזציה גם ב"תאריך הזמנה")
  const outL = [];
  const linked = lgHubLinkedKeys(a.orders);
  const seq = _hubLib('lgOptySheetSeq');
  if (seq && f.state !== 'wait') Object.values(jobs).forEach(rec => {
    if (!rec || !rec.sheets || !rec.job) return;
    if (f.mat && rec.mat !== f.mat) return;
    if (dated && !inRange(rec.day || '')) return;
    const glass = lgHubMatGlass(rec.mat, a.mats);
    if (glassSet && !glassSet.has(glass)) return;
    const seen = {};
    seq(rec.sheets).forEach(({ sheetNo, total, sheet }) => (sheet.pieces || []).forEach(p => {
      if (seen[p.pos]) return; seen[p.pos] = 1;
      if (linked.has(_hubKey(rec.job, p.shape, p.pos))) return;
      const r = (rec.pieces || {})[p.pos] || {}, w = r.w || p.w, h = r.h || p.h;
      const client = clientOf(r.client || '') || r.client || '';
      if (clientSet && !clientSet.has(_hubN(client))) return;
      if (!sizeOk(w, h, true)) return;
      const hay = _hubN([p.shape, r.client, client, r.name, rec.job, r.note].join(' '));
      if (!words.every(x => hay.includes(x) || _hubNumHit(w, h, x, true))) return;
      if (!pairs.every(pr => _hubDimHit(w, h, pr, true))) return;
      const st = lgHubPieceState(rec, sheetNo, today, _hubPieceInfo(rec, r, a.mats));
      if (stateCounts[st.tone] != null) stateCounts[st.tone] += 1;
      stateCounts[''] += 1;
      if (f.state && f.state !== 'loose' && st.tone !== f.state) return;
      outL.push({ job: rec.job, day: rec.day || '', mat: rec.mat || '', glass, sheetNo, total, order: p.order, pos: p.pos, shape: p.shape || '',
        client, optyClient: r.client || '', name: r.name || '', w, h, qty: Number(r.qty) || 1, note: r.note || '', st, waiting: !!(p.shape && waiting.has(String(p.shape))) });
    }));
  });
  outL.sort((x, y) => (y.day || '').localeCompare(x.day || '') || x.client.localeCompare(y.client) || x.job.localeCompare(y.job) || x.order - y.order);
  if (f.sort === 'old') outL.reverse();

  //  סיכום (המועצה): יחידות ומ"ר — לפי הכמות, נטו (באופטי-ווי פחות הליטוש)
  let units = 0, m2 = 0;
  outO.forEach(x => x.items.forEach(r => { if (!r.match) return; const q = _hubQty(r.it); units += q; m2 += q * (Number(r.it.w) || 0) * (Number(r.it.h) || 0) / 1e6; }));
  outL.forEach(p => { units += p.qty; m2 += p.qty * Math.max(0, p.w - 2) * Math.max(0, p.h - 2) / 1e6; });

  return { orders: outO.slice(0, LG_HUB_MAX_ORDERS), loose: outL.slice(0, LG_HUB_MAX_LOOSE), allOrders: outO, allLoose: outL,
    counts: { orders: outO.length, loose: outL.length, units, m2: Math.round(m2 * 100) / 100 }, stateCounts, query: anyQ };
}

//  מספרים ליד כל אפשרות בסינון: כמה זכוכיות יש מכל סוג / מכל לקוח — עם כל שאר הסינונים, בלי הסינון הזה עצמו
function lgHubFacets(args) {
  const a = args || {}, f = a.f || {};
  const g = lgHubSearch(Object.assign({}, a, { f: Object.assign({}, f, { glass: [] }) }));
  const glass = new Map();
  const addG = (k, n) => { const key = k || 'אחר'; glass.set(key, (glass.get(key) || 0) + n); };
  g.allOrders.forEach(x => x.items.forEach(r => { if (r.match) addG(r.glass, _hubQty(r.it)); }));
  g.allLoose.forEach(p => addG(p.glass, p.qty));
  const c = lgHubSearch(Object.assign({}, a, { f: Object.assign({}, f, { clients: [] }) }));
  const clients = new Map();
  const addC = (k, n) => { if (!k) return; clients.set(k, (clients.get(k) || 0) + n); };
  c.allOrders.forEach(x => addC(String(x.o.orderClient || '').trim(), 1));
  c.allLoose.forEach(p => addC(String(p.client || '').trim(), 1));
  const sorted = m => [...m.entries()].map(([key, n]) => ({ key, n })).sort((x, y) => y.n - x.n || x.key.localeCompare(y.key, 'he'));
  return { glass: sorted(glass), clients: sorted(clients) };
}

//  "מידות" (בן 27/11: "מידות לפי לקוח"): לקוח → שורה לכל מידה+זכוכית+מצב, כמויות מחוברות
//  → [{ client, rows:[{ w, h, glass, qty, tone, label, refs:[orderNum/sketch] }], units, m2 }]
function lgHubSizeTable(res) {
  const by = new Map();
  const grp = name => { const k = name || 'בלי שם לקוח'; if (!by.has(k)) by.set(k, { client: k, map: new Map(), units: 0, m2: 0 }); return by.get(k); };
  const add = (g, w, h, glass, qty, st, ref, net) => {
    const W = Math.round(Number(w) || 0), H = Math.round(Number(h) || 0), key = W + 'x' + H + '|' + glass + '|' + st.tone;
    if (!g.map.has(key)) g.map.set(key, { w: W, h: H, glass, qty: 0, tone: st.tone, label: st.label, refs: [] });
    const r = g.map.get(key); r.qty += qty; if (ref && !r.refs.includes(ref)) r.refs.push(ref);
    if (r.label !== st.label) r.label = st.tone === 'cut' ? 'נחתך' : r.label;
    g.units += qty; g.m2 += qty * Math.max(0, net[0]) * Math.max(0, net[1]) / 1e6;
  };
  ((res && res.allOrders) || []).forEach(x => x.items.forEach(r => { if (!r.match) return;
    add(grp(String(x.o.orderClient || '').trim()), r.it.w, r.it.h, r.glass || 'אחר', _hubQty(r.it), r.st,
      x.o.sketchName || x.o.orderNum || '', [Number(r.it.w) || 0, Number(r.it.h) || 0]); }));
  ((res && res.allLoose) || []).forEach(p => add(grp(p.client), p.w, p.h, p.glass || 'אחר', p.qty, p.st, p.name || p.job, [p.w - 2, p.h - 2]));
  return [...by.values()].map(g => ({ client: g.client, units: g.units, m2: Math.round(g.m2 * 100) / 100,
    rows: [...g.map.values()].sort((a, b) => b.h - a.h || b.w - a.w) })).sort((a, b) => b.units - a.units || a.client.localeCompare(b.client, 'he'));
}

//  "לא אצלנו" לפי לקוח באופטי-ווי — לרשימה המקובצת
function lgHubGroupLoose(loose) {
  const m = new Map();
  (loose || []).forEach(p => { const k = p.client || 'בלי שם לקוח'; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
  return [...m.entries()].map(([client, list]) => ({ client, list }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LG_HUB_STATES, LG_HUB_GLASS_SYN, lgHubGlass, lgHubMatGlass, lgHubFacets, lgHubSizeTable, lgHubParse, lgHubItemState, lgHubCutLine, lgHubNow, lgHubDayLine, lgHubPieceState, lgHubLinkedKeys, lgHubSearch, lgHubGroupLoose };
}
