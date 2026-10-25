'use strict';
const crypto = require('node:crypto');
const NS = 'devBrainRelay';
const MAX = Number.MAX_SAFE_INTEGER;
const hex = /^[a-f0-9]{64}$/;
const result = (status, body) => ({ status, body });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function canonical(v, depth = 0) {
  if (depth > 32) throw new Error('JSON nesting limit');
  if (Array.isArray(v)) return '[' + v.map(x => canonical(x, depth + 1)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k], depth + 1)).join(',') + '}';
  return JSON.stringify(v);
}
function phone(v) {
  const s = String(v || '').replace(/[+\s()-]/g, '');
  return /^05\d{8}$/.test(s) ? '972' + s.slice(1) : /^9725\d{8}$/.test(s) ? s : '';
}
function config(env) {
  let projectId = '';
  try { projectId = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}').project_id; } catch (_) {}
  const owner = phone(env.DEV_BRAIN_RELAY_OWNER);
  return { enabled: env.DEV_BRAIN_RELAY_ENABLED === 'true', owner, projectId,
    valid: !!owner && hex.test(env.DEV_BRAIN_RELAY_TOKEN || '') &&
      ['lussglass', 'luz-glass-test'].includes(projectId) && env.DEV_BRAIN_RELAY_PROJECT === projectId && /^\d{5,20}$/.test(String(env.GREENAPI_ID_INSTANCE || '')) };
}
function ownerText(raw, owner) {
  if (!raw || raw.typeWebhook !== 'incomingMessageReceived') return false;
  const sd = raw.senderData || {}, md = raw.messageData || {};
  const chat = String(sd.chatId || '');
  if (!/^\d+@c\.us$/.test(chat) || !owner || phone(chat.slice(0, -5)) !== owner) return false;
  if (sd.sender && sd.sender !== chat) return false;
  if (!['textMessage', 'extendedTextMessage', 'quotedMessage'].includes(md.typeMessage)) return false;
  return true;
}
function text(raw) {
  const md = raw.messageData;
  return md.typeMessage === 'textMessage' ? (md.textMessageData || {}).textMessage : (md.extendedTextMessageData || {}).text;
}
function identity(raw, c) {
  try {
    if (!ownerText(raw, c.owner) || !/^\d{5,20}$/.test(String((raw.instanceData || {}).idInstance || '')) ||
        String(raw.instanceData.idInstance) !== String(c.instance) ||
        typeof raw.idMessage !== 'string' || !raw.idMessage || raw.idMessage.length > 200 ||
        typeof text(raw) !== 'string' || !text(raw).trim() || text(raw).length > 20000 || Buffer.byteLength(JSON.stringify(raw)) > 65536) return null;
    return { key: sha(JSON.stringify([c.projectId, String(raw.instanceData.idInstance), raw.idMessage])), sourceHash: sha(canonical(raw)) };
  } catch (_) { return null; } // Invalid/cyclic/deep input must not escape into the customer route.
}
function current(rec, key, c) {
  if (!rec || rec.projectId !== c.projectId || rec.owner !== c.owner) return false;
  const id = identity(rec.raw, c);
  return !!id && id.key === key && id.sourceHash === rec.sourceHash;
}
function settings(deps) {
  const env = deps.env || process.env;
  return { ...config(env), instance: env.GREENAPI_ID_INSTANCE };
}
async function maybeCaptureOwner(raw, deps) {
  const c = settings(deps);
  if (!c.enabled || !ownerText(raw, c.owner)) return null;
  if (!c.valid) return result(503, { error: 'relay unavailable' });
  const id = identity(raw, c);
  if (!id || deps.rawBodyBytes > 65536) return result(400, { error: 'invalid relay event' });
  const now = deps.now === undefined ? Date.now() : deps.now;
  try {
    const rec = { projectId: c.projectId, owner: c.owner, raw: JSON.parse(JSON.stringify(raw)), sourceHash: id.sourceHash,
      state: 'ready', createdAt: now, availableAt: now };
    const tx = await deps.db.ref(NS + '/' + id.key).transaction(cur => cur === null ? rec : undefined);
    const saved = tx.snapshot.val();
    if (!current(saved, id.key, c) || saved.sourceHash !== id.sourceHash) return result(409, { error: 'relay collision' });
    return result(200, { ok: true, relayed: true });
  } catch (_) { return result(500, { error: 'relay storage failed' }); }
}
async function handleRelay(req, deps) {
  const env = deps.env || process.env, c = settings(deps);
  if (req.method !== 'POST') return result(405, { error: 'method not allowed' });
  if (!c.enabled || !c.valid) return result(503, { error: 'relay unavailable' });
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const auth = headers.authorization;
  if (typeof auth !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(auth) ||
      !crypto.timingSafeEqual(Buffer.from(auth.slice(7)), Buffer.from(env.DEV_BRAIN_RELAY_TOKEN))) return result(401, { error: 'unauthorized' });
  if (headers['x-devbrain-project'] !== c.projectId) return result(403, { error: 'wrong project' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return result(400, { error: 'invalid request' });
  const now = deps.now === undefined ? Date.now() : deps.now;
  const ok = data => result(200, { projectId: c.projectId, ...data });
  try {
    if (b.action === 'claim') {
      if (typeof b.workerId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(b.workerId) || Object.keys(b).some(k => !['action', 'workerId'].includes(k))) return result(400, { error: 'invalid request' });
      const snap = await deps.db.ref(NS).orderByChild('availableAt').limitToFirst(50).once('value');
      const candidates = [];
      snap.forEach(s => { if (hex.test(s.key) && s.val().availableAt <= now) candidates.push(s.key); });
      for (const key of candidates) {
        const token = crypto.randomBytes(32).toString('hex');
        const tx = await deps.db.ref(NS + '/' + key).transaction(cur => {
          if (cur === null) return null; // Firebase null-first cache probe must not abort.
          if (!current(cur, key, c) || cur.availableAt > now || ['done', 'development', 'review'].includes(cur.state)) return;
          return { ...cur, leaseToken: token, leaseUntil: now + 60000, availableAt: now + 60000, workerId: b.workerId };
        });
        const rec = tx.snapshot.val();
        if (tx.committed && rec && rec.leaseToken === token) return ok({ entry: { key, sourceHash: rec.sourceHash, raw: rec.raw,
          leaseToken: token, leaseUntil: rec.leaseUntil, decision: rec.decision || null } });
      }
      return ok({ entry: null });
    }
    if (b.action !== 'ack' || !hex.test(b.key || '') || !hex.test(b.leaseToken || '') ||
        !['customer', 'development', 'review'].includes(b.decision) || Object.keys(b).some(k => !['action', 'key', 'leaseToken', 'decision'].includes(k))) return result(400, { error: 'invalid request' });
    const ref = deps.db.ref(NS + '/' + b.key);
    // Freeze the decision durably before invoking any customer code. Every later mutation is lease fenced.
    const tx = await ref.transaction(cur => {
      if (cur === null) return null;
      if (!current(cur, b.key, c) || cur.leaseToken !== b.leaseToken || (cur.decision && cur.decision !== b.decision)) return;
      if (['done', 'development', 'review'].includes(cur.state)) return cur;
      if (cur.leaseUntil <= now) return;
      return { ...cur, decision: b.decision, state: b.decision === 'customer' ? 'handoff_pending' : b.decision,
        availableAt: b.decision === 'customer' ? cur.leaseUntil : MAX };
    });
    const rec = tx.snapshot.val();
    if (!tx.committed || !rec) return result(409, { error: 'lease conflict' });
    const receipt = record => ok({ ok: true, state: 'done', decision: b.decision,
      ...(record.handoff ? { disposition: record.handoff.disposition } : {}) });
    if (rec.state !== 'handoff_pending') return receipt(rec);
    if (typeof deps.customer !== 'function') return result(500, { error: 'handoff failed' });
    const response = await deps.customer(rec.raw);
    // Distinguish a durable inbox write from the original handler's legitimate manual path.
    // Only fixed parser/filter reasons are retained: never arbitrary callback text or URLs.
    const body = response && response.body;
    const ignoredReasons = ['type', 'no id', 'not a private chat or group', 'not a sketch', 'sender', 'group not linked'];
    let handoff;
    if (response && response.status === 200 && body) {
      if (typeof body.recorded === 'boolean') handoff = { disposition: 'inbox' };
      else if (body.ok === true && typeof body.ignored === 'string' && body.ignored.length <= 80 && ignoredReasons.includes(body.ignored)) {
        handoff = { disposition: 'manual', reason: body.ignored };
      }
    }
    if (!handoff) return result(500, { error: 'handoff failed' });
    const done = await ref.transaction(cur => {
      if (cur === null) return null;
      if (!current(cur, b.key, c) || cur.leaseToken !== b.leaseToken || cur.decision !== 'customer' || !['handoff_pending', 'done'].includes(cur.state)) return;
      if (cur.state === 'done') return cur; // Preserve the first durable receipt on concurrent retry.
      return { ...cur, state: 'done', handoff, availableAt: MAX };
    });
    return done.committed && done.snapshot.val() ? receipt(done.snapshot.val()) : result(409, { error: 'lease conflict' });
  } catch (_) { return result(500, { error: 'relay storage failed' }); }
}
module.exports = { handleRelay, maybeCaptureOwner, canonical };
