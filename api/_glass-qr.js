// ═══════════════════════════════════════════════════════════════════════
//  /api/glass — ברקוד לכל זכוכית (בן, 17/11)
//  אפיון: docs/superpowers/specs/2026-11-17-glass-barcode-sketch-design.md
//
//  הברקוד: HTTPS://<אתר>/G/<ספרות ההזמנה>-<זכוכית מ-1>-<חתימה 8 תווים>.
//  החתימה = HMAC-SHA256 על "<orderId>|<idx>" בסוד שרת — מי שמשנה מספר מקבל
//  "ברקוד לא תקין", ולכן הדף הציבורי לא חושף הזמנה של אחר. לא נשמר כלום.
//
//  פעולות:
//   POST {action:'sign', items:[{orderId, idx}]}  — מנהל בלבד. מחזיר כתובת לכל זכוכית.
//   GET  ?c=<code>                                  — ציבורי. שם סקיצה, מידה, תמונות (מספר), בלי מחירים.
//   POST {action:'collect', c, name?}               — ציבורי (נהג הלקוח, בן 19/11). החתימה = ההרשאה.
//                                                     כל ההזמנה → נאסף + scanCollect {at, glassNo, name, early}.
//   GET  ?c=<code>&img=<n>                          — ציבורי. התמונה n (המקורית של הלקוח / צרופה).
//  הניתוב: vercel.json /api/glass → wa-inbound?glass=1 (מגבלת 12 הפונקציות).
// ═══════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MAX_SIGN = 200;

function _secret() {
  if (process.env.LG_QR_SECRET) return String(process.env.LG_QR_SECRET);
  //  בלי סוד ייעודי: נגזר מהמפתח הפרטי של חשבון השירות — קיים בכל סביבה, סודי, ושונה בין ייצור לבדיקות
  let pk = '';
  try { pk = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}').private_key || ''; } catch (_) { pk = ''; }
  if (!pk) throw new Error('no secret');
  return crypto.createHash('sha256').update('lg-glass-qr-v1|' + pk).digest('hex');
}

function lgGlassSig(orderId, idx, secret) {
  const h = crypto.createHmac('sha256', secret || _secret()).update(String(orderId) + '|' + Number(idx)).digest();
  let bits = 0, val = 0, out = '';
  for (let i = 0; i < 5; i++) {                       // 40 ביט → 8 תווי base32
    val = (val << 8) | h[i]; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}

const _digits = o => String((o && (o.orderNum || o.refNum)) || '').replace(/\D/g, '');

function lgGlassCode(order, idx, secret) {
  const n = _digits(order);
  if (!n || !order || !order.id) return '';
  return n + '-' + (Number(idx) + 1) + '-' + lgGlassSig(order.id, idx, secret);
}

function lgGlassParse(code) {
  const m = String(code || '').trim().toUpperCase().match(/(?:^|\/G\/)(\d{3,9})-(\d{1,3})-([A-Z2-7]{8})$/);
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  return idx >= 0 ? { num: m[1], idx, sig: m[3] } : null;
}

//  orders: {id: order}. מחזיר את ההזמנה שהספרות שלה תואמות והחתימה שלה עוברת — או null.
function lgGlassFind(orders, p, secret) {
  if (!p) return null;
  const want = Buffer.from(p.sig);
  for (const [id, o] of Object.entries(orders || {})) {
    if (!o || _digits(o) !== p.num) continue;
    const got = Buffer.from(lgGlassSig(o.id || id, p.idx, secret));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return Object.assign({ id }, o);
  }
  return null;
}

function _host(req) {
  const h = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '');
  return /^luzglass[a-z0-9-]*\.vercel\.app$/i.test(h) ? h : 'luzglass.vercel.app';
}
const lgGlassUrl = (code, host) => ('HTTPS://' + (host || 'luzglass.vercel.app') + '/G/' + code).toUpperCase();

//  התמונות שמוצגות ללקוח: המקורית (__base אם נערכה, אחרת הסקיצה) + צרופות. לא שכבת העריכה.
async function _imageKeys(db, o) {
  const id = String(o.id);
  const keys = [];
  const base = (await db.ref('sketches/' + id + '__base').once('value')).val();
  if (base) keys.push(id + '__base');
  else if ((await db.ref('sketches/' + id).once('value')).exists()) keys.push(id);
  else if (o.sketch || (o.files && o.files.f0 && o.files.f0.data)) keys.push('inline');
  const att = o.attachments || {};
  Object.keys(att).map(Number).filter(k => Number.isInteger(k) && att[k]).sort((a, b) => a - b)
    .forEach(k => keys.push(id + '__att' + k));
  return keys;
}

function _publicView(o, idx, imgCount) {
  const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
  const it = items[idx] || null;
  const glass = x => ({ w: Number(x && x.w) || 0, h: Number(x && x.h) || 0, name: String((x && x.name) || '') });
  return {
    ok: true,
    client: String(o.orderClient || o.client || ''),
    sketchName: String(o.sketchName || ''),
    orderNum: String(o.orderNum || ''),
    orderId: String(o.id),
    glassNo: idx + 1,
    glass: it ? glass(it) : null,
    count: items.length,
    images: imgCount,
    //  בלי סקיצה (הזמנת טקסט) — רשימת הזכוכיות במקום תמונה
    items: imgCount ? [] : items.map(glass),
    stage: String(o.stage || ''),
    scanCollect: o.scanCollect ? { at: Number(o.scanCollect.at) || 0, name: String(o.scanCollect.name || ''), early: !!o.scanCollect.early } : null,
  };
}

const fail = (status, code) => ({ status, body: { ok: false, code } });

//  נהג הלקוח סרק ולחץ "הזמנה נאספה" (בן, 19/11). כל ההזמנה נאספת.
//  כבר נאסף → לא כותבים שוב. בהובלה שלנו → לא (סיום הובלה נעשה ממסך ההובלות, עם ההודעה ללקוח).
//  לפני "מוכן" → נאסף בכל זאת (הנהג מחזיק את הזכוכית), מסומן early כדי שבניהול יראו.
function lgScanCollectPlan(o, now, glassNo, name) {
  const st = String((o && o.stage) || '');
  if (st === 'collected') return { kind: 'already', at: Number(o.scanCollect && o.scanCollect.at) || Number(o.updatedAt) || 0 };
  if (st === 'delivery') return { kind: 'delivery' };
  const rec = { at: now, glassNo: Number(glassNo) || 0 };
  const nm = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (nm) rec.name = nm;
  if (st !== 'done') rec.early = true;
  return { kind: 'ok', patch: { stage: 'collected', status: 'נאסף', updatedAt: now, scanCollect: rec } };
}

async function handleGlass(req, deps) {
  const { db, verify } = deps;
  const q = req.query || {};
  if (req.method === 'POST' && (req.body || {}).action === 'collect') {
    const b = req.body;
    const p = lgGlassParse(b.c);
    if (!p) return fail(400, 'bad-code');
    const orders = (await db.ref('orders').once('value')).val() || {};
    const o = lgGlassFind(orders, p, _secret());
    if (!o) return fail(404, 'not-found');
    const plan = lgScanCollectPlan(o, Date.now(), p.idx + 1, b.name);
    if (plan.kind === 'already') return { status: 409, body: { ok: false, code: 'already', at: plan.at } };
    if (plan.kind === 'delivery') return fail(409, 'delivery');
    await db.ref('orders/' + o.id).update(plan.patch);
    return { status: 200, body: { ok: true, at: plan.patch.updatedAt, early: !!plan.patch.scanCollect.early } };
  }
  if (req.method === 'POST') {
    const who = await verify(req);
    if (!who.ok || who.role !== 'admin') return fail(who.ok ? 403 : (who.status || 401), 'not-admin');
    const b = req.body || {};
    if (b.action !== 'sign') return fail(400, 'bad-action');
    const items = Array.isArray(b.items) ? b.items.slice(0, MAX_SIGN) : [];
    const secret = _secret(), host = _host(req), cache = {}, out = [];
    for (const x of items) {
      const id = String((x && x.orderId) || ''), idx = Number(x && x.idx);
      if (!id || /[.#$\[\]\/]/.test(id) || !Number.isInteger(idx) || idx < 0) { out.push(''); continue; }
      if (!(id in cache)) cache[id] = (await db.ref('orders/' + id).once('value')).val();
      const o = cache[id];
      const code = o ? lgGlassCode(Object.assign({ id }, o), idx, secret) : '';
      out.push(code ? lgGlassUrl(code, host) : '');
    }
    return { status: 200, body: { ok: true, urls: out } };
  }
  const p = lgGlassParse(q.c);
  if (!p) return fail(400, 'bad-code');
  const orders = (await db.ref('orders').once('value')).val() || {};
  const o = lgGlassFind(orders, p, _secret());
  if (!o) return fail(404, 'not-found');
  const keys = await _imageKeys(db, o);
  if (q.img == null) return { status: 200, body: _publicView(o, p.idx, keys.length) };
  const n = Number(q.img);
  if (!Number.isInteger(n) || n < 0 || n >= keys.length) return fail(404, 'no-image');
  const src = keys[n] === 'inline' ? (o.sketch || o.files.f0.data)
    : (await db.ref('sketches/' + keys[n]).once('value')).val();
  return { status: 200, image: String(src || '') };
}

module.exports = { handleGlass, lgScanCollectPlan, lgGlassSig, lgGlassCode, lgGlassParse, lgGlassFind, lgGlassUrl, _publicView };
