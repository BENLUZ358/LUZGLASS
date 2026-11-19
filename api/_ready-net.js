'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_ready-net.js — "מוכן לאיסוף" שלא יצא מהדף נשלח מהשרת (בן, 11/11).
//
//  למה: את "מוכן" שולח הדף שבמכשיר (יום עבודה / תחנת בדיקה / ניהול) אחרי המעבר
//  ל-done. דף שנסגר או רוענן ברגע הלא נכון → ההודעה לא יוצאת (9/11 דוח חיסום 50,
//  11/11 דוח 52 — L1204/L1205 של א.מ.מראות). רשת הביטחון בטעינת יום עבודה
//  (lgReadyUnsentIds) תלויה בכך שמישהו פותח את המסך — וב-11/11 גם היא לא שלחה.
//
//  מה (בן, 11/11 — "מהרגע שנעשתה הפעולה, לא כל 5 דק'"): ברגע שהזמנה מסומנת "מוכן"
//  הדף מודיע לשרת (lgLockAndAdvance → whatsapp-dispatch kind 'ready-watch') והיא
//  נרשמת ב-waMeta/readyNet/watch/<id>. כשההודעה נכנסת לתור — נמחקת משם. הדופק של
//  כלי החשבוניות (כל דקה, api/_invoice-upload.js) קורא רק את הרשימה הקטנה הזו;
//  ריקה → לא עושה כלום ולא קורא אף הזמנה. הזמנה שברשימה יותר מ-3 דק' נבדקת לבד
//  (orders/<id>): עדיין done, בלי whatsapp.sentAt / emailNotices.ready, לא פיקטיבית,
//  לא בתור → אותה שליחה בדיוק כמו מהדף: whatsapp-dispatch kind:'ready' (אותו נמען,
//  אותו נוסח עם שמות הסקיצות, אותו סירוב לשני נמענים), מקובצות לפי שם הלקוח, ואז
//  drain. אחרי בדיקה ההזמנה יוצאת מהרשימה — ניסיון אחד בלבד, סירוב לא חוזר.
//  שורה בחדר הסוכנים אצל העוקב (אפור): מה נשלח, או למה לא. שעות: א'–ו' 06–20.
//
//  לא תלוי במתגי הסוכנים: זו ההודעה הרגילה של המערכת, לא תשובת סוכן.
//  עלות: קריאת רשימה קטנה בכל דופק; הזמנות נקראות רק כשיש מה לבדוק.
// ═══════════════════════════════════════════════════════════════════

const NET = 'waMeta/readyNet';
const MIN = 60 * 1000, H = 60 * MIN;
const GAP_MS = 50 * 1000;        // מנעול קצר — שני מחשבים עם כלי חשבוניות לא בודקים יחד
const MIN_AGE_MS = 1 * MIN;      // הדף שולח תוך שניות — דקה זה "לא יצא" (היה 3; בן 19/11: לקצר)
const MAX_AGE_MS = 24 * H;       // כמו lgReadyUnsentIds; הודעה בת יממה פגה ממילא
const MAX_GROUPS = 10;           // לכל ריצה

//  א'–ו', 06:00–20:00 שעון ישראל
function lgReadyNetHours(now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  const h = Number(p.hour);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday) && h >= 6 && h < 20;
}

//  טהור. orders = { id: order }, inQueue = Set של מזהי הזמנות שכבר בתור ready, tried = { id: at }
//  → [{ client, ids:[...] }] מקובץ לפי orderClient (+ הנייד של הזמנה ידנית), בסדר readyAt
function lgReadyNetPick(orders, now, inQueue, tried, minAgeMs) {
  const t = Number(now) || Date.now();
  const q = inQueue || new Set(), tr = tried || {};
  const list = Object.entries(orders || {}).filter(([id, o]) => {
    if (!o || o.stage !== 'done' || o.isTest) return false;
    const at = Number(o.readyAt) || 0;
    const minAge = minAgeMs == null ? MIN_AGE_MS : minAgeMs;
    if (!at || t - at < minAge || t - at > MAX_AGE_MS) return false;
    if (o.whatsapp && o.whatsapp.sentAt) return false;
    if (o.emailNotices && o.emailNotices.ready) return false;
    if (q.has(id) || tr[id]) return false;
    return true;
  }).sort((a, b) => (Number(a[1].readyAt) || 0) - (Number(b[1].readyAt) || 0));
  //  ⚠️ תאום של wdReadyGroupKey (sq-new-order.js) — אם אחד משתנה, גם השני.
  //  הזמנה ידנית נפרדת לפי הנייד שלה: לא מתאחדת עם הזמנה רגילה של אותו כרטיס,
  //  ושני לקוחות מזדמנים באותו שם עם ניידים שונים לא מתאחדים.
  const by = new Map();
  for (const [id, o] of list) {
    const c = String(o.orderClient || '—');
    const k = c + '|' + (o.source === 'manual' && o.manualNotify ? String(o.manualNotify.phone || '') : '');
    if (!by.has(k)) by.set(k, { client: c, ids: [] });
    by.get(k).ids.push(id);
  }
  return [...by.values()];
}

//  מזהי הזמנות שכבר יושבות בתור כ-ready (ממתינה / נשלחה / בשליחה) — כדי לא לשלוח פעמיים
async function _queuedReadyIds(db, now) {
  const ob = (await db.ref('waOutbox').orderByChild('createdAt').startAt(now - MAX_AGE_MS - H).once('value')).val() || {};
  const s = new Set();
  for (const m of Object.values(ob)) {
    if (!m || m.kind !== 'ready' || ['failed', 'expired', 'cancelled'].includes(m.state)) continue;
    (m.orderIds || []).forEach(id => s.add(String(id)));
  }
  return s;
}

//  שליחה דרך whatsapp-dispatch עצמו (אותו קוד כמו מהדף), בלי בקשת רשת
async function _dispatch(db, ids, deps) {
  if (deps && deps.dispatch) return deps.dispatch(db, ids);
  const handler = require('./whatsapp-dispatch');
  let out = { status: 0, body: null };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: 'POST', headers: {}, body: { kind: 'ready', orderIds: ids, dryRun: false } }, res,
                { db, auth: { ok: true, phone: 'ready-net' } });
  return out;
}

//  רישום / מחיקה מרשימת המעקב. מזהה הזמנה תקין בלבד (מפתח RTDB).
const _okId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[.#$\[\]\/]/.test(id);
async function lgReadyNetWatch(db, ids, now) {
  const up = {};
  for (const id of (ids || []).map(String).filter(_okId).slice(0, 40)) up[id] = Number(now) || Date.now();
  if (Object.keys(up).length) await db.ref(NET + '/watch').update(up);
  return Object.keys(up).length;
}
async function lgReadyNetUnwatch(db, ids) {
  const up = {};
  for (const id of (ids || []).map(String).filter(_okId)) up['watch/' + id] = null;
  if (Object.keys(up).length) await db.ref(NET).update(up);
}

//  ─── "שלחתי" רק כשבאמת יצאה (בן, 16/11 — T-0009) ───────────────────────────
//  16/11 13:12 שלוש הודעות נכנסו לתור, GREEN API לא ענה עד 13:28 — והחדר כבר אמר "שלחתי".
//  עכשיו: אחרי ה-drain בודקים את waOutbox/<key>. יצאה → "שלחתי". עוד לא → "נכנסה לתור,
//  מחכה לוואטסאפ", והמפתח נרשם ב-waMeta/readyNet/follow. כל דופק (גם בלילה) בודק את
//  הרשימה הקטנה הזו: יצאה → שורה "יצאה (שעה)"; נכשלה → שורה עם הסיבה (פעם אחת לכל מצב);
//  15 דק' בתור → שורה אחת "עדיין מחכה"; פג תוקף / נעלמה / יממה → יוצאת מהרשימה.
const STUCK_MS = 15 * MIN;
const _hm = t => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const _who = v => `הודעת "מוכן לאיסוף" ל${v.client} (${v.names})`;
async function lgReadyNetFollow(db, now) {
  const f = (await db.ref(NET + '/follow').once('value')).val();
  if (!f) return 0;
  const { lgRoomPost } = require('./_agent-room');
  const up = {};
  let posted = 0;
  for (const [key, v] of Object.entries(f)) {
    if (!_okId(key) || !v) { up['follow/' + key] = null; continue; }
    const m = (await db.ref('waOutbox/' + key).once('value')).val();
    const age = now - (Number(v.at) || now);
    let text = null, drop = false, said = null;
    if (!m) drop = true;
    else if (m.state === 'sent') { text = `${_who(v)} יצאה עכשיו מהשרת (${_hm(Number(m.sentAt) || now)}).`; drop = true; }
    else if (m.state === 'expired' || m.state === 'cancelled') { text = `${_who(v)} לא יצאה, ופג תוקפה: ${m.lastError || m.state}`; drop = true; }
    else if (m.state === 'failed') { if (v.said !== 'failed') { text = `${_who(v)} לא יצאה: ${m.lastError || 'שליחה נכשלה'}`; said = 'failed'; } }
    else if (age >= STUCK_MS && v.said !== 'stuck' && v.said !== 'failed') {
      text = `${_who(v)} עדיין מחכה בתור ${Math.round(age / MIN)} דק' — וואטסאפ לא שולח${m.lastError ? ': ' + m.lastError : ''}.`;
      said = 'stuck';
    }
    if (!drop && age > MAX_AGE_MS) drop = true;
    if (drop) up['follow/' + key] = null;
    else if (said) up['follow/' + key + '/said'] = said;
    if (text) {
      try { await lgRoomPost(db, { agent: 'okev', kind: 'info', text, ref: { orderId: v.orderId } }, now); posted++; }
      catch (e) { console.warn('ready-net: follow room', e && e.name); }
    }
  }
  if (Object.keys(up).length) await db.ref(NET).update(up);
  return posted;
}

async function lgReadyNetRun(db, o) {
  const opt = o || {};
  const now = Number(opt.now) || Date.now();
  //  מעקב אחרי מה שכבר בתור — לפני בדיקת השעות: שורת "יצאה" שייכת לרגע שיצאה
  try { await lgReadyNetFollow(db, now); } catch (e) { console.warn('ready-net: follow', e && e.name); }
  if (!opt.force && !lgReadyNetHours(now)) return { ok: true, skipped: 'hours' };

  //  רק הרשימה הקטנה — ריקה = אין מה לעשות, שום הזמנה לא נקראת
  const watch = (await db.ref(NET + '/watch').once('value')).val() || {};
  const due = Object.keys(watch).filter(id => now - (Number(watch[id]) || 0) >= MIN_AGE_MS);
  if (!due.length) return { ok: true, sent: 0, watching: Object.keys(watch).length };

  const g = await db.ref(NET + '/lastRun').transaction(cur => (cur != null && Math.abs(now - Number(cur)) < GAP_MS ? undefined : now));
  if (!g.committed) return { ok: true, skipped: 'throttled' };

  //  כל הזמנה שהגיע זמנה נקראת לבד ויוצאת מהרשימה — ניסיון אחד בלבד
  const orders = {};
  for (const id of due) {
    const v = (await db.ref('orders/' + id).once('value')).val();
    if (v) orders[id] = v;
  }
  await lgReadyNetUnwatch(db, due);
  const groups = lgReadyNetPick(orders, now, await _queuedReadyIds(db, now), {}, 0).slice(0, MAX_GROUPS);
  if (!groups.length) return { ok: true, sent: 0 };

  const { lgRoomPost } = require('./_agent-room');
  const keys = [];
  const done = [];
  const queuedPosts = [];          // נכתבות אחרי ה-drain, לפי מה שבאמת קרה בתור
  for (const grp of groups) {
    const names = grp.ids.map(id => String((orders[id] && (orders[id].sketchName || orders[id].orderNum)) || id)).join(', ');
    let r;
    try { r = await _dispatch(db, grp.ids, opt); }
    catch (e) { console.warn('ready-net: dispatch', e && e.name); r = { status: 500, body: { error: 'תקלה בשרת' } }; }
    const b = (r && r.body) || {};
    let text;
    if (r && r.status === 200 && b.queued) {
      keys.push(b.outboxKey);
      queuedPosts.push({ key: String(b.outboxKey), client: grp.client, names, orderId: grp.ids[0] });
      text = null;
    } else if (r && r.status === 200 && b.preview && !b.configured) {
      text = null;   // סביבת בדיקות בלי וואטסאפ — אין מה לדווח
    } else {
      const why = b.error || b.reason || ('קוד ' + (r && r.status));
      text = `הודעת "מוכן לאיסוף" ל${grp.client} (${names}) לא יצאה מהדף, וגם מהשרת לא נשלחה: ${why}`;
    }
    done.push({ client: grp.client, ids: grp.ids, status: r && r.status, queued: !!b.queued });
    if (text) {
      try { await lgRoomPost(db, { agent: 'okev', kind: 'info', text, ref: { orderId: grp.ids[0] } }, now); }
      catch (e) { console.warn('ready-net: room', e && e.name); }
    }
  }
  //  budgetMs (מהדופק — מה שנשאר עד t0+55ש׳, תיקון סקירה סופית I3): 0 → לא שולחים עכשיו, השורות
  //  נשארות ממתינות לשליחה הבאה (דף פתוח / השרת). בלי budgetMs — התקציב הרגיל של drainNow.
  const hasBudget = opt.budgetMs !== undefined && opt.budgetMs !== null;
  const budgetMs = hasBudget ? Math.max(0, Number(opt.budgetMs) || 0) : 0;
  if (keys.length && (!hasBudget || budgetMs > 0)) {
    try { await (opt.drain || require('./_wa-drain-core').drainNow)(db, keys, 'ready-net', hasBudget ? { budgetMs } : {}); }
    catch (e) { console.warn('ready-net: drain', e && e.name); }
  }
  //  "שלחתי" רק אם waOutbox אומר sent; אחרת "נכנסה לתור" + מעקב (lgReadyNetFollow)
  const follow = {};
  for (const q of queuedPosts) {
    let st = null;
    try { st = ((await db.ref('waOutbox/' + q.key).once('value')).val() || {}).state || null; } catch (e) {}
    const text = st === 'sent'
      ? `${_who(q)} לא יצאה מהדף — שלחתי אותה מהשרת.`
      : `${_who(q)} לא יצאה מהדף — נכנסה לתור בשרת, מחכה לוואטסאפ. אכתוב כאן כשתצא.`;
    if (st !== 'sent' && _okId(q.key)) follow['follow/' + q.key] = { client: q.client, names: q.names, orderId: q.orderId, at: now, said: 'queued' };
    try { await lgRoomPost(db, { agent: 'okev', kind: 'info', text, ref: { orderId: q.orderId } }, now); }
    catch (e) { console.warn('ready-net: room', e && e.name); }
  }
  if (Object.keys(follow).length) { try { await db.ref(NET).update(follow); } catch (e) { console.warn('ready-net: follow save', e && e.name); } }
  return { ok: true, sent: keys.length, groups: done };
}

module.exports = { lgReadyNetRun, lgReadyNetPick, lgReadyNetHours, lgReadyNetWatch, lgReadyNetUnwatch, NET };
