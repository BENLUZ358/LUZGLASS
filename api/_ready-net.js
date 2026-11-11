'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_ready-net.js — "מוכן לאיסוף" שלא יצא מהדף נשלח מהשרת (בן, 11/11).
//
//  למה: את "מוכן" שולח הדף שבמכשיר (יום עבודה / תחנת בדיקה / ניהול) אחרי המעבר
//  ל-done. דף שנסגר או רוענן ברגע הלא נכון → ההודעה לא יוצאת (9/11 דוח חיסום 50,
//  11/11 דוח 52 — L1204/L1205 של א.מ.מראות). רשת הביטחון בטעינת יום עבודה
//  (lgReadyUnsentIds) תלויה בכך שמישהו פותח את המסך — וב-11/11 גם היא לא שלחה.
//
//  מה: בדופק של כלי החשבוניות (כל דקה, api/_invoice-upload.js), לכל היותר פעם
//  ב-5 דק' ובשעות העבודה: הזמנות ב-done שה-readyAt שלהן בין 3 דק' ל-24 שעות, בלי
//  whatsapp.sentAt ובלי emailNotices.ready, לא פיקטיביות, ושלא יושבות כבר בתור
//  השליחה (waOutbox, kind ready, pending/sent) → אותה שליחה בדיוק כמו מהדף:
//  whatsapp-dispatch עם kind:'ready' (אותו נמען, אותו נוסח עם שמות הסקיצות, אותו
//  סירוב לשני נמענים), מקובצות לפי שם הלקוח כמו _waSendReadyGrouped, ואז drain.
//  כל הזמנה מנוסה פעם אחת בלבד (waMeta/readyNet/tried/<id>) — סירוב לא חוזר כל 5 דק'.
//  שורה בחדר הסוכנים אצל העוקב (אפור): מה נשלח, או למה לא.
//
//  לא תלוי במתגי הסוכנים: זו ההודעה הרגילה של המערכת, לא תשובת סוכן.
//  עלות: קריאת orders (~0.65MB, 11/11) פעם ב-5 דק' בשעות העבודה בלבד.
// ═══════════════════════════════════════════════════════════════════

const NET = 'waMeta/readyNet';
const MIN = 60 * 1000, H = 60 * MIN;
const GAP_MS = 5 * MIN;          // לכל היותר פעם ב-5 דק'
const MIN_AGE_MS = 3 * MIN;      // הדף שולח תוך שניות — 3 דק' זה "לא יצא"
const MAX_AGE_MS = 24 * H;       // כמו lgReadyUnsentIds; הודעה בת יממה פגה ממילא
const TRIED_KEEP_MS = 3 * 24 * H;
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
//  → [{ client, ids:[...] }] מקובץ לפי orderClient, בסדר readyAt
function lgReadyNetPick(orders, now, inQueue, tried) {
  const t = Number(now) || Date.now();
  const q = inQueue || new Set(), tr = tried || {};
  const list = Object.entries(orders || {}).filter(([id, o]) => {
    if (!o || o.stage !== 'done' || o.isTest) return false;
    const at = Number(o.readyAt) || 0;
    if (!at || t - at < MIN_AGE_MS || t - at > MAX_AGE_MS) return false;
    if (o.whatsapp && o.whatsapp.sentAt) return false;
    if (o.emailNotices && o.emailNotices.ready) return false;
    if (q.has(id) || tr[id]) return false;
    return true;
  }).sort((a, b) => (Number(a[1].readyAt) || 0) - (Number(b[1].readyAt) || 0));
  const by = new Map();
  for (const [id, o] of list) {
    const c = String(o.orderClient || '—');
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(id);
  }
  return [...by].map(([client, ids]) => ({ client, ids }));
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

async function lgReadyNetRun(db, o) {
  const opt = o || {};
  const now = Number(opt.now) || Date.now();
  if (!opt.force && !lgReadyNetHours(now)) return { ok: true, skipped: 'hours' };
  const g = await db.ref(NET + '/lastRun').transaction(cur => (cur != null && Math.abs(now - Number(cur)) < GAP_MS ? undefined : now));
  if (!g.committed) return { ok: true, skipped: 'throttled' };

  //  ניקוי tried ישן
  const tried = { ...((await db.ref(NET + '/tried').once('value')).val() || {}) };
  for (const [k, v] of Object.entries(tried)) {
    if (now - (Number(v) || 0) > TRIED_KEEP_MS) { await db.ref(NET + '/tried/' + k).set(null); delete tried[k]; }
  }

  const orders = (await db.ref('orders').once('value')).val() || {};
  const groups = lgReadyNetPick(orders, now, await _queuedReadyIds(db, now), tried).slice(0, MAX_GROUPS);
  if (!groups.length) return { ok: true, sent: 0 };

  const { lgRoomPost } = require('./_agent-room');
  const keys = [];
  const done = [];
  for (const grp of groups) {
    //  נרשם לפני השליחה: ריצה שנהרגה באמצע לא תנסה שוב
    for (const id of grp.ids) await db.ref(NET + '/tried/' + id).set(now);
    const names = grp.ids.map(id => String((orders[id] && (orders[id].sketchName || orders[id].orderNum)) || id)).join(', ');
    let r;
    try { r = await _dispatch(db, grp.ids, opt); }
    catch (e) { console.warn('ready-net: dispatch', e && e.name); r = { status: 500, body: { error: 'תקלה בשרת' } }; }
    const b = (r && r.body) || {};
    let text;
    if (r && r.status === 200 && b.queued) {
      keys.push(b.outboxKey);
      text = `הודעת "מוכן לאיסוף" ל${grp.client} (${names}) לא יצאה מהדף — שלחתי אותה מהשרת.`;
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
  if (keys.length) {
    try { await (opt.drain || require('./_wa-drain-core').drainNow)(db, keys, 'ready-net'); }
    catch (e) { console.warn('ready-net: drain', e && e.name); }
  }
  return { ok: true, sent: keys.length, groups: done };
}

module.exports = { lgReadyNetRun, lgReadyNetPick, lgReadyNetHours, NET };
