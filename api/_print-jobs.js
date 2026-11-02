// ═══════════════════════════════════════════════════════════════════
//  api/_print-jobs.js — מרכז הדפסות: עבודות הדפסה (בן, 3/11).
//  (route: /api/print → wa-inbound?print=1, ר' _print-route.js)
//
//  אדמין (workday באייפד, prints.html) יוצר עבודה: מדבקות כטקסט + תמונה ארוזה
//  לכל מדבקה (1 ביט לנקודה, 70 בתים לשורה — print-labels.js). הכלי במחשב במשרד
//  (tools/invoice-watcher, טוקן INVOICE_UPLOAD_TOKEN) מושך, מדפיס ב-TSC ומדווח.
//
//  waMeta/printJobs/<id>      הרשומה (טקסט בלבד) — רשימה, לוח בקרה, הדפסה חוזרת
//  waMeta/printJobBlobs/<id>  התמונות — נמחקות כשהעבודה נגמרה
//  waMeta/printQueue/<id>     רק העבודות הפעילות (בתור / מדפיס). הכלי שואל כל
//                             כמה שניות — הוא קורא רק את זה, לא את כל ההיסטוריה
//                             (אין אינדקס ב-waMeta, ובלי שינוי חוקים)
//  waMeta/printAgent          lastSeenAt — "המחשב במשרד מחובר"
//  ⚠️ waMeta כתוב רק מהשרת — בלי שינוי חוקים.
//
//  מצבים: queued → printing → printed | queued (מדפסת לא ענתה, עד 3, עם המתנה) | failed
//         printing שעבר את הנעילה → unknown: לא ידוע אם יצא — **לא** מודפס
//         שוב לבד. בן מחליט ("הדפס שוב" = עבודה חדשה).
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgHookTokenOk } = require('./_hook-token');

const JOBS = 'waMeta/printJobs', BLOBS = 'waMeta/printJobBlobs', QUEUE = 'waMeta/printQueue', AGENT = 'waMeta/printAgent';
const MAX_LABELS = 70;
const LEASE_MS = 2 * 60000;
const MAX_ATTEMPTS = 3;
//  מדפסת כבויה (החלפת גליל) — מחכים לפני הניסיון הבא, אחרת שלושת הניסיונות
//  נשרפים בשתי שניות והכל "נכשל"
const RETRY_WAIT_MS = [30000, 2 * 60000, 5 * 60000];
const KEEP_MS = 90 * 24 * 3600 * 1000;
const KINDS = ['labels'];
const PRINTERS = ['labels'];
const BITMAP_B64 = 52268;   // 70 × 560 = 39200 בתים

const fail = (status, code) => ({ status, body: { ok: false, code } });
const _str = (v, n) => String(v == null ? '' : v).slice(0, n);
const _label = l => ({ title: _str(l && l.title, 80), dims: _str(l && l.dims, 40),
                       sketchName: _str(l && l.sketchName, 80), orderNum: _str(l && l.orderNum, 30) });
const _b64 = s => typeof s === 'string' && s.length === BITMAP_B64 && /^[A-Za-z0-9+/]+=*$/.test(s);

//  שדות לתצוגה — בלי תמונות
function _view(id, j) {
  return { id, kind: j.kind, printer: j.printer, client: j.client || '', orderIds: j.orderIds || [],
    count: j.count || 0, state: j.state, createdAt: j.createdAt || 0, createdBy: j.createdBy || '',
    attempts: j.attempts || 0, printedAt: j.printedAt || 0, error: j.error || '', reprintOf: j.reprintOf || '' };
}

//  סוף עבודה: יוצאת מהתור והתמונות נמחקות (הדפסה חוזרת מציירת מחדש מהטקסט)
const _finish = (db, id) => db.ref().update({ [QUEUE + '/' + id]: null, [BLOBS + '/' + id]: null });

async function create(db, b, who, now) {
  const labels = Array.isArray(b.labels) ? b.labels : [];
  const bitmaps = Array.isArray(b.bitmaps) ? b.bitmaps : [];
  if (!KINDS.includes(b.kind) || !PRINTERS.includes(b.printer)) return fail(400, 'bad-kind');
  if (!labels.length || labels.length > MAX_LABELS) return fail(400, 'bad-count');
  if (bitmaps.length !== labels.length || !bitmaps.every(_b64)) return fail(400, 'bad-bitmaps');
  const user = (await db.ref('users/' + who).once('value')).val() || {};
  const id = now.toString(36) + crypto.randomBytes(4).toString('hex');
  const job = {
    kind: b.kind, printer: b.printer, client: _str(b.client, 80),
    orderIds: (Array.isArray(b.orderIds) ? b.orderIds : []).slice(0, 200).map(x => _str(x, 60)),
    labels: labels.map(_label), count: labels.length, state: 'queued',
    createdAt: now, createdBy: _str(user.name || who, 60), attempts: 0,
    ...(b.reprintOf ? { reprintOf: _str(b.reprintOf, 40) } : {}),
  };
  await db.ref().update({ [JOBS + '/' + id]: job, [BLOBS + '/' + id]: bitmaps, [QUEUE + '/' + id]: { createdAt: now } });
  //  שמירה 90 יום — בזמן יצירה (אין cron פנוי)
  const all = (await db.ref(JOBS).once('value')).val() || {};
  const old = {};
  Object.keys(all).forEach(k => {
    if ((all[k].createdAt || 0) >= now - KEEP_MS) return;
    old[JOBS + '/' + k] = null; old[BLOBS + '/' + k] = null; old[QUEUE + '/' + k] = null;
  });
  if (Object.keys(old).length) await db.ref().update(old);
  return { status: 200, body: { ok: true, id } };
}

async function list(db, b, now) {
  const from = Number(b.from) > 0 ? Number(b.from) : now - KEEP_MS;
  const all = (await db.ref(JOBS).once('value')).val() || {};
  const items = Object.keys(all).map(k => _view(k, all[k])).filter(v => v.createdAt >= from)
    .sort((a, c) => c.createdAt - a.createdAt);
  const agent = (await db.ref(AGENT).once('value')).val() || {};
  return { status: 200, body: { ok: true, items, agent: { lastSeenAt: agent.lastSeenAt || 0 } } };
}

async function get(db, b) {
  const id = _str(b.id, 40);
  const j = id && (await db.ref(JOBS + '/' + id).once('value')).val();
  if (!j) return fail(404, 'not-found');
  return { status: 200, body: { ok: true, job: { ..._view(id, j), labels: j.labels || [] } } };
}

//  הכלי במחשב: עבודה אחת בכל פעם, הוותיקה ראשונה. קורא רק את התור הפעיל.
async function claim(db, now) {
  await db.ref(AGENT).update({ lastSeenAt: now });
  const q = (await db.ref(QUEUE).once('value')).val() || {};
  const ids = Object.keys(q).sort((a, c) => (q[a].createdAt || 0) - (q[c].createdAt || 0));
  for (const id of ids) {
    let gone = false, stuck = false;
    const tx = await db.ref(JOBS + '/' + id).transaction(cur => {
      if (!cur) { gone = true; return null; }
      gone = false; stuck = false;
      //  נתקעה בהדפסה (הכלי נפל / נסגר באמצע) — לא ידוע אם יצא. לא חוזרת לתור.
      if (cur.state === 'printing' && (cur.leaseUntil || 0) <= now) {
        stuck = true;
        return { ...cur, state: 'unknown', leaseUntil: null, error: 'לא ידוע אם הודפס — בדוק את המדפסת' };
      }
      if (cur.state !== 'queued' || (cur.notBefore || 0) > now) return;
      return { ...cur, state: 'printing', leaseUntil: now + LEASE_MS, notBefore: null, attempts: (cur.attempts || 0) + 1 };
    });
    const j = tx.committed && tx.snapshot.val();
    if (gone || !j || ['printed', 'failed', 'unknown'].includes(j.state)) {
      if (gone || stuck || (j && j.state !== 'queued' && j.state !== 'printing')) await _finish(db, id);
      continue;
    }
    if (j.state !== 'printing' || j.leaseUntil !== now + LEASE_MS) continue;
    const bitmaps = (await db.ref(BLOBS + '/' + id).once('value')).val();
    const list = Array.isArray(bitmaps) ? bitmaps : Object.values(bitmaps || {});
    if (!list.length) {   // התמונות חסרות — אין מה להדפיס
      await db.ref(JOBS + '/' + id).update({ state: 'failed', leaseUntil: null, error: 'התמונות חסרות — הדפס שוב מהלוח' });
      await _finish(db, id);
      continue;
    }
    return { status: 200, body: { ok: true, job: { id, printer: j.printer, bitmaps: list } } };
  }
  return { status: 200, body: { ok: true, job: null } };
}

async function done(db, b, now) {
  const id = _str(b.id, 40);
  const tx = await db.ref(JOBS + '/' + id).transaction(cur => {
    if (!cur) return null;
    if (cur.state !== 'printing' && cur.state !== 'unknown') return;
    if (b.ok === true) return { ...cur, state: 'printed', printedAt: now, leaseUntil: null, error: null };
    const err = _str(b.error || 'ההדפסה נכשלה', 200);
    //  לא התחבר למדפסת (כבויה / לא ברשת) — שום דבר לא נשלח, מותר לנסות שוב, אחרי המתנה
    if (b.retryable === true && (cur.attempts || 0) < MAX_ATTEMPTS && cur.state === 'printing') {
      const wait = RETRY_WAIT_MS[Math.min((cur.attempts || 1) - 1, RETRY_WAIT_MS.length - 1)];
      return { ...cur, state: 'queued', leaseUntil: null, notBefore: now + wait, error: err };
    }
    return { ...cur, state: 'failed', leaseUntil: null, error: err };
  });
  const j = tx.committed && tx.snapshot.val();
  if (!j) return fail(404, 'not-found');
  if (j.state !== 'queued') await _finish(db, id);
  return { status: 200, body: { ok: true, state: j.state } };
}

//  deps: { db, now, env, verify(req) → {ok, status, role, phone} }
async function handlePrint(req, deps) {
  if (req.method !== 'POST') return fail(405, 'method');
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  b = (b && typeof b === 'object') ? b : {};
  const now = deps.now || Date.now();
  const env = deps.env || process.env;
  const action = String(b.action || '');
  if (action === 'agent-claim' || action === 'agent-done') {
    const h = req.headers || {};
    if (!lgHookTokenOk(h.authorization || h.Authorization, env.INVOICE_UPLOAD_TOKEN, 'print')) return fail(401, 'unauthorized');
    return action === 'agent-claim' ? claim(deps.db, now) : done(deps.db, b, now);
  }
  const u = await deps.verify(req);
  if (!u.ok) return fail(u.status || 401, 'unauthorized');
  if (u.role !== 'admin') return fail(403, 'forbidden');
  if (action === 'create') return create(deps.db, b, u.phone, now);
  if (action === 'list') return list(deps.db, b, now);
  if (action === 'get') return get(deps.db, b);
  return fail(400, 'bad-action');
}

module.exports = { handlePrint, MAX_LABELS, LEASE_MS };
