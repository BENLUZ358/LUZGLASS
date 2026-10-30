// ═══════════════════════════════════════════════════════════════════
//  api/_agent-send.js — תור השליחה של הסוכנים (שלב 2).
//
//  עוזר משותף, לא route. הסוכנים כותבים משפט חופשי (לא הנוסח הקבוע של
//  renderText), לפעמים עם קבצים (העתק חשבונית, סקיצה) או העברה של הודעת
//  לקוח לשאול. התור נפרד מ-waOutbox ומ-_wa-drain-core.js בכוונה — ההודעות
//  הקיימות לא נוגעות כאן — אבל הדפוס אחד:
//
//    getState → חלון (lgWaReserveSlot) → תפיסה (lgWaClaim, אותה טרנזקציה)
//    → בדיקה חוזרת מהנתונים החיים → provider.gate → שליחה → סגירה
//
//  ⚠️ שום הודעה לא יוצאת אלא אם (Global Constraints):
//    AGENT_SHADOW_ENABLED==='true' וגם AGENT_REPLY_ENABLED==='true' וגם
//    הנמען לקוח בפיילוט (waMeta/agentPilot/<customerId> === true) או איש צוות.
//  הכל נבדק **בזמן השליחה**, לא בהכנסה לתור: בן יכול לכבות את המתג או לנתק
//  קבוצה בין לבין, והקישור השמור ברשומה הוא תיעוד, לא הרשאה.
//
//  רשומה: waMeta/agentOutbox/<key> = { to, customerId, text, files, reason,
//    state: pending|sent|failed|blocked|expired, attempts, messageId, … }
//  files: [{kind:'invoice-copy', invoiceKey} | {kind:'sketch', orderId}
//          | {kind:'forward', fromChat, idMessage}]
//  ⚠️ לא נרשם ללוג: טקסט ההודעה, base64, טוקנים. רק e.name.
// ═══════════════════════════════════════════════════════════════════

const { lgWaProvider } = require('./_wa-provider');
const { lgWaClaim, lgWaComplete, lgWaRelease, lgWaPending, lgWaReserveSlot } = require('./_wa-outbox');
const { lgWaSenderKey, lgWaSenderLink } = require('./_wa-recipient');

const AGENT_OUTBOX = 'waMeta/agentOutbox';
const PILOT = 'waMeta/agentPilot';
const BUDGET_MS = 45 * 1000;          // מתחת ל-maxDuration 60, כמו ב-drain
const SLOT_MAX_WAIT_MS = 15 * 1000;

//  אותו ניקוי מפתח כמו lgWaInboundKey (לא מיובא — _wa-inbound כבד ולא נחוץ כאן)
const _key = id => String(id || '').replace(/[.#$[\]/]/g, '_');
const _isGroup = to => /@g\.us$/.test(String(to || ''));

//  AGENT_STAFF_PHONES → ספרות מקומיות (0…). הראשון = שאול.
function lgAgentStaff(env) {
  return String((env || {}).AGENT_STAFF_PHONES || '').split(',')
    .map(s => lgWaSenderKey(s.trim())).filter(Boolean);
}

const _switchesOn = env => (env || {}).AGENT_SHADOW_ENABLED === 'true' && (env || {}).AGENT_REPLY_ENABLED === 'true';

//  create-once: מפתח קיים (בכל מצב) → queued:false. הסוכן גוזר את המפתח
//  מ-idMessage, ולכן webhook + drain על אותה הודעה מכניסים פעם אחת.
async function lgAgentEnqueue(db, { key, to, customerId, text, files, reason }) {
  const k = _key(key);
  if (!k) return { key: k, queued: false };
  const now = Date.now();
  const r = await db.ref(AGENT_OUTBOX + '/' + k).transaction(cur => {
    if (cur) return;                       // abort — כבר קיימת
    return {
      to: String(to || ''), customerId: customerId == null ? '' : String(customerId),
      text: String(text || ''), files: Array.isArray(files) ? files : [], reason: String(reason || ''),
      state: 'pending', attempts: 0, createdAt: now, updatedAt: now,
      claimedAt: null, claimedBy: null, sentAt: null, messageId: null, lastError: null, httpStatus: null,
    };
  });
  return { key: k, queued: !!r.committed };
}

//  מי הנמען **עכשיו**. { ok, phone, accountKey, reason }.
//  קבוצה → עדיין ב-waGroups לאותו customerId. טלפון → צוות, או עדיין ב-waSenders
//  לאותו customerId. לקוח (לא צוות) → גם בפיילוט.
async function _liveRecipient(db, entry, staff) {
  const cid = String(entry.customerId || '');
  if (_isGroup(entry.to)) {
    const link = (await db.ref('waGroups/' + _key(entry.to)).once('value')).val();
    if (!link || !link.customerId || String(link.customerId) !== cid || !cid)
      return { ok: false, reason: 'הקבוצה אינה מקושרת עוד ללקוח — לא נשלח' };
    if ((await db.ref(PILOT + '/' + cid).once('value')).val() !== true)
      return { ok: false, reason: 'הלקוח אינו בפיילוט הסוכנים' };
    return { ok: true, phone: String(entry.to), accountKey: cid };
  }
  const phone = lgWaSenderKey(entry.to);
  if (!phone) return { ok: false, reason: 'נמען לא תקין' };
  //  ⚠️ צוות: הקישור הוא הרשימה ב-Vercel. accountKey לא ריק כי השער דורש כרטיס.
  if (staff.includes(phone)) return { ok: true, phone, accountKey: cid || 'staff' };
  const link = await lgWaSenderLink(db, phone);
  if (!link || link.customerId !== cid || !cid) return { ok: false, reason: 'המספר אינו מקושר ללקוח — לא נשלח' };
  if ((await db.ref(PILOT + '/' + cid).once('value')).val() !== true)
    return { ok: false, reason: 'הלקוח אינו בפיילוט הסוכנים' };
  return { ok: true, phone, accountKey: cid };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const _safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40);

//  הקבצים נטענים עכשיו, לא נשמרים בתור. { ok, media:[{name,mime,buf}], forwards:[{fromChat,idMessage}], reason }
//  ⚠️ גם כאן התיק של אותו לקוח בלבד — שכבת הסוכן כבר בדקה, וזו רשת הביטחון.
async function _loadFiles(db, entry) {
  const cid = String(entry.customerId || '');
  const media = [], forwards = [];
  for (const f of entry.files || []) {
    if (f && f.kind === 'invoice-copy') {
      const rec = (await db.ref('invoicePdf/' + _key(f.invoiceKey)).once('value')).val();
      if (!rec || rec.state !== 'ready' || String(rec.accountKey || '') !== cid || !cid)
        return { ok: false, reason: 'החשבונית אינה מוכנה או אינה של הלקוח' };
      const pdf = (await db.ref('invoicePdfBlobs/' + _key(f.invoiceKey) + '/copy').once('value')).val();
      if (!pdf) return { ok: false, reason: 'העתק החשבונית חסר' };
      media.push({ name: 'חשבונית ' + _safe(rec.docNumber) + '.pdf', mime: 'application/pdf', buf: Buffer.from(String(pdf), 'base64') });
    } else if (f && f.kind === 'sketch') {
      const id = _key(f.orderId);
      const order = (await db.ref('orders/' + id).once('value')).val();
      if (!order || String(order.customerId || '') !== cid || !cid) return { ok: false, reason: 'ההזמנה אינה של הלקוח' };
      const v = (await db.ref('sketches/' + id).once('value')).val() || order.sketch;
      const m = String(v || '').match(/^data:([^;,]+);base64,([\s\S]+)$/);
      if (!m) return { ok: false, reason: 'הסקיצה חסרה' };
      const mime = m[1].toLowerCase();
      media.push({ name: 'סקיצה ' + _safe(order.orderNum || id) + '.' + (EXT[mime] || 'bin'), mime, buf: Buffer.from(m[2], 'base64') });
    } else if (f && f.kind === 'forward') {
      if (!f.fromChat || !f.idMessage) return { ok: false, reason: 'אין הודעה להעביר' };
      forwards.push({ fromChat: String(f.fromChat), idMessage: String(f.idMessage) });
    } else {
      return { ok: false, reason: 'סוג קובץ לא מוכר' };
    }
  }
  return { ok: true, media, forwards };
}

//  שליחה אחת: העברות (לפי צ'אט מקור) → קבצים עם הטקסט ככיתוב, או טקסט לבד.
//  messageId = של הטקסט/הכיתוב (מחירון שומר אותו כדי לזהות "השב" של שאול).
//  ⚠️ כשל באמצע → ok:false וניסיון חוזר שולח הכל שוב (עדיף כפול על חסר).
async function _deliver(provider, to, entry, loaded) {
  const forwardIds = [];
  const byChat = [];
  for (const f of loaded.forwards) {
    let g = byChat.find(x => x.fromChat === f.fromChat);
    if (!g) byChat.push(g = { fromChat: f.fromChat, ids: [] });
    g.ids.push(f.idMessage);
  }
  for (const g of byChat) {
    if (typeof provider.forward !== 'function') return { ok: false, failureKind: 'other', reason: 'הספק הנוכחי לא מעביר הודעות' };
    const out = await provider.forward({ to, fromChat: g.fromChat, idMessages: g.ids });
    if (!out.ok) return out;
    forwardIds.push(out.messageId);
  }
  let out;
  if (loaded.media.length) {
    if (typeof provider.sendFiles !== 'function') return { ok: false, failureKind: 'other', reason: 'הספק הנוכחי לא שולח קבצים' };
    out = await provider.sendFiles({ to, caption: entry.text || '', files: loaded.media });
  } else if (String(entry.text || '').trim()) {
    if (typeof provider.sendText !== 'function') return { ok: false, failureKind: 'other', reason: 'הספק הנוכחי לא שולח טקסט חופשי' };
    out = await provider.sendText({ to, text: entry.text });
  } else if (forwardIds.length) {
    out = { ok: true, httpStatus: 200, messageId: forwardIds[forwardIds.length - 1] };
  } else {
    return { ok: false, failureKind: 'other', reason: 'אין מה לשלוח' };
  }
  return { ...out, forwardIds };
}

//  רשומה שאסור לשלוח — נסגרת לנצח. ⚠️ lgWaPending מחזיר רק pending/failed,
//  ולכן 'blocked' לא נתפס שוב.
async function _block(db, key, why) {
  await db.ref(AGENT_OUTBOX + '/' + key).update({ state: 'blocked', claimedAt: null, lastError: String(why).slice(0, 300), updatedAt: Date.now() });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

//  { sent, failed, blocked, skipped, state }
async function lgAgentSendPending(db, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const provider = o.provider || lgWaProvider();
  const started = o.now || Date.now();
  const budget = o.budgetMs || BUDGET_MS;
  const res = { sent: 0, failed: 0, blocked: 0, skipped: 0, state: null };
  const by = 'agent-send';

  const keys = await lgWaPending(db, 50, AGENT_OUTBOX);
  if (!keys.length) return res;

  //  ⚠️ מתגים כבויים → כל מה שבתור נחסם. לא "ימתין עד שידליקו": הודעה
  //  שנכתבה כשהמתג דלק יכולה להיות לא רלוונטית לגמרי כשידליקו שוב.
  if (!_switchesOn(env)) {
    for (const key of keys) {
      const c = await lgWaClaim(db, key, by, AGENT_OUTBOX);
      if (!c.claimed) { res.skipped++; continue; }
      await _block(db, key, 'הסוכנים כבויים (AGENT_SHADOW_ENABLED / AGENT_REPLY_ENABLED)');
      res.blocked++;
    }
    return res;
  }

  if (!provider.configured) { res.state = 'not-configured'; return res; }
  //  ⚠️ לפני הכל — מנותק: לא נוגעים ברשומות, אין ניסיון שנספר
  if (provider.checksState) {
    const st = await provider.getState();
    res.state = st.state;
    if (st.state !== 'authorized') { res.skipped = keys.length; return res; }
  }

  const staff = lgAgentStaff(env);
  let processed = 0;
  for (const key of keys) {
    if (processed >= (provider.maxPerRun || 10)) break;
    if (Date.now() - started > budget) break;

    //  חלון לפני תפיסה — ר' ההסבר ב-_wa-drain-core.js
    if (provider.globalSlot) {
      const slot = await lgWaReserveSlot(db, provider.nextGap(), SLOT_MAX_WAIT_MS);
      if (!slot.ok) break;
      if (slot.waitMs) await sleep(slot.waitMs);
    }

    const { claimed, entry } = await lgWaClaim(db, key, by, AGENT_OUTBOX);
    if (!claimed) { res.skipped++; continue; }

    const live = await _liveRecipient(db, entry, staff);
    if (!live.ok) { await _block(db, key, live.reason); res.blocked++; continue; }
    const gate = provider.gate({ phone: live.phone, accountKey: live.accountKey, linked: true });
    if (!gate.allowed) { await _block(db, key, gate.reason || 'השער חסם'); res.blocked++; continue; }

    const loaded = await _loadFiles(db, entry).catch(e => ({ ok: false, reason: 'חריגה בטעינת קבצים (' + (e && e.name) + ')' }));
    if (!loaded.ok) { await _block(db, key, loaded.reason); res.blocked++; continue; }

    let out;
    try { out = await _deliver(provider, live.phone, entry, loaded); }
    catch (e) { out = { ok: false, failureKind: 'other', reason: 'חריגה בשליחה (' + (e && e.name) + ')' }; }

    //  ניתוק באמצע → חוזר לתור בלי לספור ניסיון, והסבב נעצר
    if (!out.ok && out.failureKind === 'disconnected') {
      await lgWaRelease(db, key, out.reason || 'WhatsApp מנותק', AGENT_OUTBOX);
      res.state = 'notAuthorized';
      break;
    }

    //  ⚠️ reason מגיע מהספק (שגיאת ה-API, אחרי redact) או מכאן — אף פעם לא טקסט ההודעה
    await lgWaComplete(db, key, { ok: out.ok, messageId: out.messageId, httpStatus: out.httpStatus, reason: out.reason }, AGENT_OUTBOX);
    if (out.forwardIds && out.forwardIds.length)
      await db.ref(AGENT_OUTBOX + '/' + key).update({ forwardIds: out.forwardIds });
    processed++;
    if (out.ok) res.sent++; else res.failed++;

    if (!provider.globalSlot && processed < (provider.maxPerRun || 10)) await sleep(provider.nextGap());
  }
  return res;
}

module.exports = { AGENT_OUTBOX, lgAgentStaff, lgAgentEnqueue, lgAgentSendPending };
