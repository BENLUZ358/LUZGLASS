// ═══════════════════════════════════════════════════════════════════
//  api/_zgagi-route.js — הכתובת היחידה של זגאגי: POST /api/zgagi
//
//  לא route משלו: vercel.json מפנה את /api/zgagi ל-/api/wa-inbound?zgagi=1,
//  כי כל 12 הפונקציות של התוכנית החינמית תפוסות (כמו /api/agent-daily).
//
//  אימות: Authorization: Bearer <ZGAGI_LINK_TOKEN>. מפתח ריק ב-env = אף
//  אחד לא נכנס (lgHookTokenOk). הכיוון תמיד מזגאגי אלינו — אנחנו לא פונים
//  לזגאגי בכלל, ולכן אין לנו שום סוד שלהם.
//
//  op: receive (פריט אחד) | stages (שלבים של פריטים) | cancel (פריט אחד)
// ═══════════════════════════════════════════════════════════════════

const { lgHookTokenOk } = require('./_hook-token');

const OPS = {
  receive: (db, b, now) => require('./_zgagi-inbound').lgZgagiReceive(db, b, now),
  stages:  (db, b)      => require('./_zgagi-status').lgZgagiStages(db, b),
  cancel:  (db, b, now) => require('./_zgagi-status').lgZgagiCancel(db, b, now),
};
const STATUS = { ok: 200, 'bad-input': 400, 'unknown-customer': 422, locked: 409, 'not-found': 404 };

//  deps: { db, env, now } → { status, body }
async function lgZgagiHandle(req, deps) {
  const env = deps.env || process.env;
  const h = (req && req.headers) || {};
  if (!lgHookTokenOk(h.authorization || h.Authorization, env.ZGAGI_LINK_TOKEN, 'zgagi'))
    return { status: 401, body: { error: 'unauthorized' } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object' || !OPS[b.op]) return { status: 400, body: { error: 'unknown op' } };
  const db = typeof deps.db === 'function' ? deps.db() : deps.db;
  const r = await OPS[b.op](db, b, deps.now || Date.now());
  return { status: STATUS[r.code] || 200, body: r };
}

module.exports = async function zgagiRoute(req, res) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) { res.status(500).json({ error: 'server not configured' }); return; }
    const r = await lgZgagiHandle(req, { db: () => require('./wa-inbound')._db() });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('zgagi: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
};
module.exports.lgZgagiHandle = lgZgagiHandle;
