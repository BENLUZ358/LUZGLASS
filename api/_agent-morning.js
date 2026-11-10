'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-morning.js — מנהל: סיכום בוקר בחדר (חדר הסוכנים, פריטים 8+9, 11/11).
//
//  עוזר משותף, לא route. נקרא מהדופק (_agent-watch.lgAgentWatchRun) בכל ריצה; עובד פעם ביום —
//  בדופק הראשון אחרי 07:00 בישראל, ראשון–שישי. חדר בלבד: לא וואטסאפ, לא ללקוח.
//  רק כשיש הגדרות במסך (waMeta/agentConfig) והמנהל לא כבוי — כך שבלי הגדרות אין קריאה של orders.
//
//  מה בסיכום:
//    • שאלות שמחכות לבן (waMeta/agentRoomOpen)
//    • טיוטה לשרטט (כמה הזמנות בסל) + משלוחים פתוחים אצל השרטט
//    • חשבוניות / קבצים תקועים — בעיות פתוחות של הארכיון (waMeta/agentWatch/problems, לא "סגור")
//    • הזמנות שנשלחו לחשבשבת אתמול (hashavshevet/hsOrder.sentAt, לא simulated)
//    • ביום ראשון בלבד (שבועי): אחוז ✓ לכל סוכן מהסימונים של 7 הימים האחרונים —
//      verdict { ok, at } על רשומות waMeta/agentShadow (lgAgentShadowVerdict), הסוכן לפי route
//      (lgAgentOfRoute). ≥95% עם ≥20 סימונים והסוכן ב"שקט" → "אפשר להדליק 'עונה' ל<סוכן>".
//  פעם ביום: waMeta/agentRoomMorning/<yyyy-mm-dd> נתפס בטרנזקציה (null-first). כשל לא משחרר
//  (failed נרשם) — כדי שדופק של כל דקה לא יקרא שוב ושוב את orders.
// ═══════════════════════════════════════════════════════════════════

const { lgAgentModeOf, lgAgentOfRoute, LG_AGENT_KEYS } = require('./_agent-config');
const { lgRoomPost, ROOM_OPEN } = require('./_agent-room');

const MORNING = 'waMeta/agentRoomMorning';
const SHADOW = 'waMeta/agentShadow';
const DAY = 24 * 3600 * 1000;
const RATE_DAYS = 7, RATE_MIN_N = 20, RATE_MIN = 0.95;
const LG_AGENT_HE = { markazan: 'מרכזן', okev: 'עוקב', archive: 'ארכיון', price: 'מחירון', kolet: 'קולט', manager: 'מנהל' };

function _jer(now) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric',
                                     weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { iso: `${p.year}-${p.month}-${p.day}`, text: `${p.day}.${p.month}.${p.year}`, weekday: p.weekday, hour: Number(p.hour) };
}

//  ראשון–שישי, מ-07:00 בישראל
function lgMorningDue(now) {
  const j = _jer(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(j.weekday) && j.hour >= 7;
}

//  shadow: { key: רשומה } → { agent: { n, ok } } — סימונים מ-7 הימים האחרונים, בלי הודעות צוות
function lgVerdictRates(shadow, now) {
  const out = {};
  for (const r of Object.values(shadow || {})) {
    const v = r && r.verdict;
    if (!v || typeof v.ok !== 'boolean' || r.staff === true || r.route === 'staff') continue;
    const at = Number(v.at) || 0;
    if (at > now || now - at > RATE_DAYS * DAY) continue;
    const a = lgAgentOfRoute(r.route);
    const x = out[a] || (out[a] = { n: 0, ok: 0 });
    x.n++; if (v.ok) x.ok++;
  }
  return out;
}

const _list = (a, n) => (a.length ? ' (' + a.slice(0, n).join(', ') + (a.length > n ? ', …' : '') + ')' : '');
const _hsAt = o => { const h = o && (o.hashavshevet || o.hsOrder); return h && h.sentAt && !h.simulated ? Number(h.sentAt) || 0 : 0; };

//  x: { date, open:[name], draft, batches:[{n,count}], archive:[text], hs:[orderNum], rates?, modes }
function lgMorningText(x) {
  const lines = ['בוקר טוב — סיכום בוקר ' + x.date];
  lines.push('שאלות שמחכות לך בחדר: ' + x.open.length + _list(x.open, 5));
  lines.push('טיוטה לשרטט: ' + x.draft + ' הזמנות · משלוחים פתוחים אצל השרטט: ' + x.batches.length
    + _list(x.batches.map(b => 'משלוח ' + b.n + ' — ' + (Number(b.count) || 0)), 5));
  lines.push('חשבוניות / קבצים תקועים: ' + x.archive.length + (x.archive.length ? ' — ' + x.archive.slice(0, 3).join('; ') : ''));
  lines.push('נשלחו לחשבשבת אתמול: ' + x.hs.length + _list(x.hs, 10));
  if (x.rates) {
    const have = LG_AGENT_KEYS.filter(a => x.rates[a] && x.rates[a].n);
    lines.push('✓ בשבוע האחרון: ' + (have.length
      ? have.map(a => LG_AGENT_HE[a] + ' ' + Math.round(x.rates[a].ok / x.rates[a].n * 100) + '% (' + x.rates[a].n + ')').join(' · ')
      : 'אין סימונים'));
    for (const a of have) {
      const r = x.rates[a];
      if (r.n >= RATE_MIN_N && r.ok / r.n >= RATE_MIN && x.modes[a] === 'shadow') lines.push("אפשר להדליק 'עונה' ל" + LG_AGENT_HE[a]);
    }
  }
  return lines.join('\n');
}

//  o: { env, now, cfg (undefined → נקרא) } → { posted, skipped? }
async function lgAgentMorningRun(db, o) {
  const opt = o || {}, env = opt.env || process.env, now = Number(opt.now) || Date.now();
  if (env.AGENT_SHADOW_ENABLED !== 'true') return { posted: false, skipped: 'off' };
  if (!lgMorningDue(now)) return { posted: false, skipped: 'not-due' };
  const cfg = opt.cfg !== undefined ? opt.cfg : await require('./_agent-config').lgAgentConfig(db);
  if (!cfg) return { posted: false, skipped: 'no-config' };
  if (lgAgentModeOf(cfg, 'manager', env) === 'off') return { posted: false, skipped: 'manager-off' };
  const j = _jer(now);
  const t = await db.ref(MORNING + '/' + j.iso).transaction(cur => (cur ? undefined : { at: now }));
  if (!t.committed) return { posted: false, skipped: 'done-today' };
  try {
    const DB = require('./_drafter-batch');
    const open = Object.values((await db.ref(ROOM_OPEN).once('value')).val() || {})
      .sort((a, b) => (Number(a && a.at) || 0) - (Number(b && b.at) || 0)).map(v => String((v && v.customer) || LG_AGENT_HE[v && v.agent] || 'שאלה'));
    const batchesAll = (await db.ref('waMeta/drafterBatches').once('value')).val() || {};
    const done = await DB.lgDrafterDoneSet(db);
    const batches = Object.entries(batchesAll).filter(([k, b]) => k[0] !== '_' && b && b.n && !b.doneAt)
      .map(([, b]) => b).sort((a, b) => a.n - b.n);
    //  orders — פעם ביום, ורק עם הגדרות במסך
    const orders = (await db.ref('orders').once('value')).val() || {};
    const draft = Object.values(orders).filter(x => DB.lgDrafterInBasket(x, done)).length;
    const yesterday = _jer(now - DAY).iso;
    const hs = Object.entries(orders).filter(([, x]) => x && x.isTest !== true && _hsAt(x) && _jer(_hsAt(x)).iso === yesterday)
      .sort((a, b) => _hsAt(a[1]) - _hsAt(b[1])).map(([id, x]) => String(x.orderNum || id));
    const archive = Object.values((await db.ref('waMeta/agentWatch/problems').once('value')).val() || {})
      .filter(p => p && p.agent === 'archive' && !p.dismissed).sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
      .map(p => String(p.text || ''));
    //  שבועי — ביום ראשון בלבד (קריאה אחת של agentShadow בשבוע)
    let rates = null;
    if (j.weekday === 'Sun') rates = lgVerdictRates((await db.ref(SHADOW).once('value')).val() || {}, now);
    const modes = {};
    LG_AGENT_KEYS.forEach(a => { modes[a] = lgAgentModeOf(cfg, a, env); });
    const text = lgMorningText({ date: j.text, open, draft, batches, archive, hs, rates, modes });
    const rk = await lgRoomPost(db, { agent: 'manager', kind: 'summary', text }, now);
    //  ⚠️ כשל לא משחרר את היום: אחרת כל דופק (כל דקה) היה קורא שוב את orders. נרשם וזהו.
    if (!rk) { await db.ref(MORNING + '/' + j.iso).update({ failed: 'room' }); return { posted: false, skipped: 'room-failed' }; }
    return { posted: true, roomKey: rk };
  } catch (e) {
    console.warn('agent-morning: run', e && e.name);
    try { await db.ref(MORNING + '/' + j.iso).update({ failed: String((e && e.name) || 'error').slice(0, 40) }); } catch (_) { /* תיעוד בלבד */ }
    return { posted: false, skipped: 'error' };
  }
}

module.exports = { MORNING, lgMorningDue, lgVerdictRates, lgMorningText, lgAgentMorningRun };
