// ═══════════════════════════════════════════════════════════════════
//  api/_agent-shadow.js — רשומת צל לסוכני הלקוחות (מרכזן + עוקב).
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  אפיון: docs/superpowers/specs/2026-10-30-customer-agents-design.md
//
//  ─── הזרימה ───────────────────────────────────────────────────────
//
//    webhook → lgAgentShadowRecord (create-once) → waMeta/agentShadow/<id>
//    בנפרד   → lgAgentShadowProcess: תפיסה → זיהוי לקוח → סיווג → ניתוב
//              → "מה עוקב היה עונה" — נשמר ברשומה בלבד.
//
//  ⚠️ מצב צל: שום דבר מכאן לא נשלח ללקוח. אין כאן lgWaEnqueue ואין ספק.
//  ⚠️ לא מקושר (לא בקבוצה מקושרת, לא ב-waSenders, לא ברשימת Vercel) →
//     נרשם בלי טקסט, route:'shaul', והמודל לא נקרא.
//  ⚠️ לא נרשם לוג של טקסט ההודעה, downloadUrl או מפתחות.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { lgWaInboundParse, lgWaInboundKey } = require('./_wa-inbound');
const { lgWaSenderLink, lgClientFromWaSender, lgClientFromWaGroup, waChatToLocal } = require('./_wa-recipient');
const { lgWaInboundAllowed } = require('./_env');
const { lgInboxStillMine } = require('./_inbox-common');
const { lgOkevFind, lgOkevReply, lgOkevRoute, AGENT_MENU_TEXT } = require('./_agent-okev');
const { lgAgentClassify } = require('./_agent-classify');

const SHADOW = 'waMeta/agentShadow';
const HUMAN = 'waMeta/agentHuman';
// שקט אחרי הודעה ידנית של בן/שאול באותו צ'אט
const AGENT_HUMAN_QUIET_MS = 2 * 60 * 60 * 1000;

// כמו בקליטה: ארוך מ-maxDuration, כדי שתפיסה חיה לא תיגנב
const CLAIM_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const TEXT_MAX = 4000;

const _isGroup = id => /^\d+(-\d+)?@g\.us$/.test(id);

// ─── סינון ──────────────────────────────────────────────────────────
//  מחזיר { action:'record'|'human'|'ignore', entry }.
//  'human' = הודעה שהוקלדה בטלפון של המפעל (outgoingMessageReceived) — מסמנת
//  שאדם עונה עכשיו. הודעה שיצאה מה-API (outgoingAPIMessageReceived) לא נחשבת,
//  אחרת בשלב 2 הסוכן היה משתיק את עצמו אחרי כל תשובה שלו.
function lgAgentShadowParse(body) {
  const ignore = { action: 'ignore', entry: null };
  const b = body || {};
  const action = b.typeWebhook === 'incomingMessageReceived' ? 'record'
    : b.typeWebhook === 'outgoingMessageReceived' ? 'human' : '';
  if (!action || !b.idMessage) return ignore;
  const sd = b.senderData || {};
  const chatId = String(sd.chatId || '');
  const groupId = _isGroup(chatId) ? chatId : '';
  const sender = groupId ? waChatToLocal(String(sd.sender || '')) : waChatToLocal(chatId);
  if (!groupId && !sender) return ignore;

  const md = b.messageData || {};
  const tm = String(md.typeMessage || '');
  const f = md.fileMessageData || {};
  const ext = md.extendedTextMessageData || {};
  let text = '', quotedId = '', hasImage = false;
  if (tm === 'textMessage') text = (md.textMessageData || {}).textMessage;
  else if (tm === 'extendedTextMessage') text = ext.text;
  else if (tm === 'quotedMessage') { text = ext.text; quotedId = String(ext.stanzaId || ''); }
  else if (tm === 'imageMessage' || (tm === 'documentMessage' && String(f.mimeType || '').toLowerCase().startsWith('image/'))) {
    hasImage = true; text = f.caption;          // הכיתוב — בלי downloadUrl
  }
  // כל סוג אחר (נמחקה, תגובה, סוג חדש) — נרשם עם typeMessage בלבד ו-text ריק

  return { action, entry: {
    idMessage: String(b.idMessage),
    typeWebhook: String(b.typeWebhook),
    typeMessage: tm,
    chatId, groupId, sender,
    text: String(text || '').slice(0, TEXT_MAX),
    quotedId, hasImage,
    timestamp: (Number(b.timestamp) || 0) * 1000,
  } };
}

// מפתח הצ'אט ל-HUMAN: הקבוצה, או הצ'אט הפרטי
const _chatKey = e => lgWaInboundKey(e.groupId || e.chatId);

// מקושר = קבוצה ב-waGroups, מספר ב-waSenders, או ברשימת Vercel
async function _isLinked(db, e) {
  if (e.groupId) {
    const g = (await db.ref('waGroups/' + lgWaInboundKey(e.groupId)).once('value')).val();
    return !!(g && g.customerId);
  }
  if (!e.sender) return false;
  if (await lgWaSenderLink(db, e.sender)) return true;
  return !!lgWaInboundAllowed(e.sender).allowed;
}

// ─── רישום — create-once ────────────────────────────────────────────
//  מחזיר { key, created }, או null כשאין מה לרשום (כולל הודעה ידנית —
//  שם רק מסמנים HUMAN/<chat>/lastAt).
async function lgAgentShadowRecord(db, body, now) {
  const t = now || Date.now();
  const p = lgAgentShadowParse(body);
  if (p.action === 'human') {
    await db.ref(HUMAN + '/' + _chatKey(p.entry)).update({ lastAt: t });
    return null;
  }
  if (p.action !== 'record') return null;
  const linked = await _isLinked(db, p.entry);
  const ib = lgWaInboundParse(body);
  const rec = { ...p.entry, linked, intakeKind: (ib && ib.entry && ib.entry.kind) || '',
                state: 'received', attempts: 0, createdAt: t, updatedAt: t };
  // לא מקושר — לא שומרים את תוכן ההודעה
  if (!linked) delete rec.text;
  const key = lgWaInboundKey(p.entry.idMessage);
  const r = await db.ref(SHADOW + '/' + key).transaction(cur => {
    if (cur === null) return rec;   // null-first: null הוא בדיוק המקרה שבו כותבים
    return;                          // abort — כבר נרשם
  });
  return { key, created: !!r.committed };
}

// ─── תפיסה ──────────────────────────────────────────────────────────
//  אותו דפוס כמו lgWaInboundClaim, בלי הגבלת גיל (אין קובץ שפג).
async function _claim(db, key, now) {
  const token = crypto.randomBytes(8).toString('hex');
  const r = await db.ref(SHADOW + '/' + key).transaction(cur => {
    if (cur === null) return null;                                       // null-first
    if (!['received', 'failed', 'processing'].includes(cur.state)) return;   // סופי
    if (cur.state === 'processing' && cur.claimedAt && (now - cur.claimedAt) < CLAIM_TTL_MS) return;
    if ((cur.attempts || 0) >= MAX_ATTEMPTS) {
      return { ...cur, state: 'dead', claimedAt: null, updatedAt: now,
               reason: MAX_ATTEMPTS + ' ניסיונות נכשלו — ' + (cur.lastError || '') };
    }
    return { ...cur, state: 'processing', claimedAt: now, claimToken: token,
             attempts: (cur.attempts || 0) + 1, updatedAt: now };
  });
  const entry = r.committed ? r.snapshot.val() : null;
  if (!entry || entry.state !== 'processing') return { claimed: false, reason: (entry && entry.state) || (r.snapshot.val() || {}).state || 'לא נתפסה' };
  return { claimed: true, entry };
}

// ─── עיבוד ──────────────────────────────────────────────────────────
//  מחזיר { ok, reason }. כותב ברשומה את מה שהסוכן היה עושה — ולא עושה אותו.
async function lgAgentShadowProcess(db, key, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const env = o.env || process.env;
  const c = await _claim(db, key, now);
  if (!c.claimed) return { ok: false, reason: c.reason };
  const e = c.entry;
  try {
    const out = { intent: '', ref: '', route: 'shaul', wouldReply: '', matchedOrderIds: [],
                  customerId: '', customerName: '', model: '', usage: null };
    if (e.linked) {
      const who = e.groupId ? await lgClientFromWaGroup(db, e.groupId, e.sender) : await lgClientFromWaSender(db, e.chatId);
      out.customerId = String((who && who.customerId) || '');
      out.customerName = String((who && who.name) || '');
      if (!e.text && !e.hasImage) {
        // נמחקה / תגובה / סוג לא מוכר — אין מה לסווג
        out.route = 'none';
      } else {
        const cls = await lgAgentClassify({ text: e.text, hasImage: !!e.hasImage,
          model: env.AGENT_MODEL, key: env.OPENAI_API_KEY, fetcher: o.fetchImpl });
        out.intent = cls.intent; out.ref = cls.ref || ''; out.usage = cls.usage || null;
        // המודל נקרא רק כשיש טקסט (תמונה בלבד = order בלי קריאה)
        out.model = String(e.text || '').trim() ? String(env.AGENT_MODEL || '') : '';
        const last = (await db.ref(HUMAN + '/' + _chatKey(e) + '/lastAt').once('value')).val();
        const humanQuiet = !!last && (now - Number(last)) < AGENT_HUMAN_QUIET_MS;
        out.route = lgOkevRoute({ intent: out.intent, isGroup: !!e.groupId, linked: true, humanQuiet });
        if (out.route === 'okev') {
          // ⚠️ קורא את כל orders ומסנן כאן — מקובל כל עוד יש מעט הזמנות בפרודקשן.
          //    לפני הפעלה חיה צריך אינדקס על customerId (orderByChild + equalTo)
          //    ב-database.rules.json.
          const all = out.customerId ? ((await db.ref('orders').once('value')).val() || {}) : {};
          const mine = Object.entries(all)
            .filter(([, x]) => x && String(x.customerId || '') === out.customerId)
            .map(([id, x]) => ({ ...x, id }));
          const found = lgOkevFind(mine, { quotedId: e.quotedId || '', ref: out.ref });
          out.wouldReply = lgOkevReply(out.intent, found);
          out.matchedOrderIds = found.orders.map(x => x.id);
        } else if (out.route === 'menu') {
          out.wouldReply = AGENT_MENU_TEXT;
        }
      }
    }
    const touch = { ...out, state: 'done', doneAt: now, claimedAt: null, claimToken: null, lastError: null };
    if (!await lgInboxStillMine(db, SHADOW, key, e.claimToken, now, touch)) return { ok: false, reason: 'lost-claim' };
    return { ok: true, reason: '' };
  } catch (err) {
    // רק שם השגיאה — לא טקסט ההודעה ולא מפתחות
    const msg = String((err && err.name) || 'Error');
    try { await lgInboxStillMine(db, SHADOW, key, e.claimToken, now, { state: 'failed', claimedAt: null, claimToken: null, lastError: msg }); }
    catch (e2) { console.warn('agent-shadow: could not record failure', e2 && e2.name); }
    return { ok: false, reason: msg };
  }
}

// ─── ממתינים ────────────────────────────────────────────────────────
//  אותו דפוס כמו lgWaInboundPending: לפי state, ואז מיון לפי createdAt.
async function lgAgentShadowPending(db, limit, now) {
  const t = now || Date.now();
  const byState = st => db.ref(SHADOW).orderByChild('state').equalTo(st).once('value');
  const snaps = await Promise.all(['received', 'failed', 'processing'].map(byState));
  const rows = [];
  snaps.forEach(sn => sn.forEach(ch => {
    const v = ch.val() || {};
    const ok = v.state === 'received'
      || (v.state === 'failed' && (v.attempts || 0) < MAX_ATTEMPTS)
      || (v.state === 'processing' && (!v.claimedAt || t - v.claimedAt >= CLAIM_TTL_MS));
    if (ok) rows.push({ key: ch.key, at: v.createdAt || 0 });
  }));
  rows.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.slice(0, limit || 20).map(r => r.key);
}

module.exports = { SHADOW, HUMAN, AGENT_HUMAN_QUIET_MS, lgAgentShadowParse, lgAgentShadowRecord,
                   lgAgentShadowProcess, lgAgentShadowPending };
