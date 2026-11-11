'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-config.js — מתגי הסוכנים במסך, לא ב-Vercel (בן, 10/11).
//
//  עוזר משותף, לא route. waMeta/agentConfig =
//    { agents: { markazan|okev|archive|price|kolet|manager: 'off'|'shadow'|'reply' },
//      escalatePhone: '0547725552', updatedAt, by }
//  נכתב רק דרך /api/wa-inbound-drain (agent-config-set) — בלי שינוי חוקים.
//
//  lgAgentMode — הקריאה המאוחדת היחידה. כל מקום שבדק AGENT_REPLY_ENABLED
//  עובר דרכה:
//    AGENT_SHADOW_ENABLED !== 'true' → 'off' (מתג חירום עליון, נשאר ב-Vercel)
//    אחרת — הערך של הסוכן ב-agentConfig
//    אין agentConfig (או ערך לא תקין) → כמו היום: 'reply' רק אם
//      AGENT_REPLY_ENABLED==='true', אחרת 'shadow' — כך שהפריסה לא משנה כלום.
//  ⚠️ escalatePhone — המספר של בן לשאלות "לא יודע". **לא** איש צוות: שכבת השליחה
//     מתירה אליו רק AGENT_BEN_REASONS (שאלה, לקוח לא מרוצה, שומר, הבוקר, תקלה — דרך
//     lgBenNotify ב-_agent-ben.js), והעברת תמונה רק מהצ'אט
//     של הלקוח של אותה שאלה (תיקון סקירה 10/11). בלי הגדרות — AGENT_ESCALATE_DEFAULT
//     הוא רק היעד של ההתראה, לא צוות.
//  אפיון: docs/superpowers/specs/2026-11-10-agents-room-design.md
// ═══════════════════════════════════════════════════════════════════

const { lgWaSenderKey } = require('./_wa-recipient');

const AGENT_CONFIG = 'waMeta/agentConfig';
const LG_AGENT_KEYS = ['markazan', 'okev', 'archive', 'price', 'kolet', 'manager'];
const LG_AGENT_MODES = ['off', 'shadow', 'reply'];
const AGENT_ESCALATE_DEFAULT = '0547725552';
const _own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

//  מה שהיה לפני המסך (בלי המתג העליון)
const _legacy = env => ((env || {}).AGENT_REPLY_ENABLED === 'true' ? 'reply' : 'shadow');

//  המצב השמור של סוכן (או הישן), בלי המתג העליון — מה שהמתג במסך מראה
function _stored(cfg, key, env) {
  const v = cfg && cfg.agents && LG_AGENT_KEYS.includes(key) && _own(cfg.agents, key) ? cfg.agents[key] : null;
  return LG_AGENT_MODES.includes(v) ? v : _legacy(env);
}

//  טהור. cfg = הערך של waMeta/agentConfig (או null)
function lgAgentModeOf(cfg, key, env) {
  if ((env || {}).AGENT_SHADOW_ENABLED !== 'true') return 'off';
  return _stored(cfg, String(key == null ? '' : key), env);
}

//  מספר טלפון מקומי (05XXXXXXXX) או ''
const _phone = raw => { const p = lgWaSenderKey(String(raw == null ? '' : raw)); return /^05\d{8}$/.test(p) ? p : ''; };
function lgAgentEscalatePhone(cfg) {
  return _phone(cfg && cfg.escalatePhone) || AGENT_ESCALATE_DEFAULT;
}

//  איזה סוכן אחראי על מסלול של המרכזן ("מי אחראי על מה" באפיון).
//  'shaul' — מה שאף סוכן לא יודע (צהוב לבן) — של המרכזן: התפריט שלו מבטיח ללקוח
//  "כתבו כאן ונחזור אליך", ולכן ההמשך הולך לפי המתג שלו — אחרת הובטחה תשובה שאף
//  אחד לא ייתן (תיקון סקירה 10/11). השאר — המרכזן.
const LG_ROUTE_AGENT = { okev: 'okev', menu: 'markazan', archive: 'archive', quote: 'price', price: 'price', staff: 'price',
                         kolet: 'kolet', 'kolet-deleted': 'kolet', shaul: 'markazan', complaint: 'markazan' };
const lgAgentOfRoute = route => (_own(LG_ROUTE_AGENT, String(route || '')) ? LG_ROUTE_AGENT[String(route)] : 'markazan');

async function lgAgentConfig(db) {
  try { const v = (await db.ref(AGENT_CONFIG).once('value')).val(); return v && typeof v === 'object' ? v : null; }
  catch (e) { console.warn('agent-config: read', e && e.name); return null; }
}

async function lgAgentMode(db, key, env) {
  const e = env || process.env;
  if (e.AGENT_SHADOW_ENABLED !== 'true') return 'off';   // בלי קריאה מה-DB
  return lgAgentModeOf(await lgAgentConfig(db), key, e);
}

//  מייל להתראות לבן: ריק = אין; תקין = באותיות קטנות בלי רווחים
const _email = raw => { const e = String(raw == null ? '' : raw).trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; };

//  האם הסוכן עונה ללקוח: "עונה לכל הלקוחות" דולק, או הלקוח ברשימת הפיילוט.
//  ⚠️ לא בודק קישור — מספר לא מקושר נשאר בלי תשובה (הבדיקות waGroups / waSenders נשארות במקומן).
async function lgAgentCustomerOn(db, cid, cfg) {
  if (!cid) return false;
  if (cfg && cfg.allCustomers === true) return true;
  return (await db.ref('waMeta/agentPilot/' + cid).once('value')).val() === true;
}

//  מה שהמסך מקבל: המצב של כל סוכן (שמור או ישן), המספר, והאם נשמר אי-פעם
function lgAgentConfigView(cfg, env) {
  const agents = {};
  LG_AGENT_KEYS.forEach(k => { agents[k] = _stored(cfg, k, env); });
  return { agents, escalatePhone: lgAgentEscalatePhone(cfg), saved: !!cfg,
           allCustomers: !!cfg && cfg.allCustomers === true, escalateEmail: _email(cfg && cfg.escalateEmail),
           updatedAt: Number(cfg && cfg.updatedAt) || 0 };
}

//  agent-config-set: { agent, mode } או { escalatePhone } או { allCustomers } או { escalateEmail }. אימות קפדני.
//  כתיבה ראשונה — כל הסוכנים מקבלים את מה שהם עושים היום, ורק אז השינוי,
//  כדי שהדלקה של סוכן אחד לא תשנה בשקט את האחרים.
async function lgAgentConfigSet(db, body, ctx) {
  const b = body || {}, c = ctx || {};
  const hasAgent = _own(b, 'agent'), hasPhone = _own(b, 'escalatePhone');
  const hasAll = _own(b, 'allCustomers'), hasEmail = _own(b, 'escalateEmail');
  if (!hasAgent && !hasPhone && !hasAll && !hasEmail) return { ok: false, code: 'bad-request', message: 'אין מה לשנות' };
  if (hasAgent && (typeof b.agent !== 'string' || !LG_AGENT_KEYS.includes(b.agent))) return { ok: false, code: 'bad-agent', message: 'סוכן לא מוכר' };
  if (hasAgent && !LG_AGENT_MODES.includes(b.mode)) return { ok: false, code: 'bad-mode', message: 'מצב לא מוכר' };
  let phone = '';
  if (hasPhone) {
    phone = typeof b.escalatePhone === 'string' ? _phone(b.escalatePhone) : '';
    if (!phone) return { ok: false, code: 'bad-phone', message: 'מספר טלפון לא תקין' };
  }
  if (hasAll && typeof b.allCustomers !== 'boolean') return { ok: false, code: 'bad-all', message: 'ערך לא תקין' };
  let email = '';
  if (hasEmail) {
    const raw = typeof b.escalateEmail === 'string' ? b.escalateEmail.trim() : null;
    if (raw === null) return { ok: false, code: 'bad-email', message: 'כתובת מייל לא תקינה' };
    email = raw === '' ? '' : _email(raw);
    if (raw !== '' && !email) return { ok: false, code: 'bad-email', message: 'כתובת מייל לא תקינה' };
  }
  const env = c.env || process.env;
  const now = Number(c.now) || Date.now();
  const by = String(c.by || '').slice(0, 60);
  try {
    // null-first: הקריאה הראשונה (null) בונה מברירות המחדל; השנייה מהערך האמיתי
    await db.ref(AGENT_CONFIG).transaction(cur => {
      const base = lgAgentConfigView(cur && typeof cur === 'object' ? cur : null, env);
      const agents = { ...base.agents };
      if (hasAgent) agents[b.agent] = b.mode;
      return { agents, escalatePhone: hasPhone ? phone : base.escalatePhone,
               allCustomers: hasAll ? b.allCustomers : base.allCustomers,
               escalateEmail: hasEmail ? email : base.escalateEmail, updatedAt: now, by };
    });
  } catch (e) {
    console.warn('agent-config: write', e && e.name);
    return { ok: false, code: 'error', message: 'השמירה נכשלה' };
  }
  return { ok: true, code: '' };
}

module.exports = { AGENT_CONFIG, LG_AGENT_KEYS, LG_AGENT_MODES, AGENT_ESCALATE_DEFAULT,
                   lgAgentModeOf, lgAgentMode, lgAgentConfig, lgAgentConfigView, lgAgentConfigSet, lgAgentCustomerOn, lgAgentEscalatePhone, lgAgentOfRoute };
