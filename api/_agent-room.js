'use strict';
// ═══════════════════════════════════════════════════════════════════
//  api/_agent-room.js — "חדר הסוכנים": יומן אירועים של הסוכנים (בן, 10/11).
//
//  עוזר משותף, לא route. "קישור תוך כדי": כל פעולה שנבנית מעכשיו כותבת
//  אירוע ל-waMeta/agentRoom בשם הסוכן האחראי, כך שכשהחדר ייבנה — ההיסטוריה
//  כבר שם. ר' docs/superpowers/specs/2026-11-10-agents-room-design.md ("מי אחראי על מה").
//
//  waMeta/agentRoom/<מפתח> = { at, agent, kind:'info'|'ask', text, ref }
//  ⚠️ waMeta נכתב רק בשרת (החוקים חוסמים את הדפדפן) — אין שינוי חוקים.
//  ⚠️ לעולם לא זורק: היומן הוא תיעוד, לא העבודה עצמה.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const ROOM = 'waMeta/agentRoom';
const KINDS = ['info', 'ask'];

//  מפתח שממוין לפי זמן (כמו push של פיירבייס): זמן ב-base36 ברוחב קבוע + אקראי
const _key = at => String(Math.max(0, Math.floor(at))).padStart(13, '0').replace(/\d+/, d => Number(d).toString(36).padStart(9, '0'))
  + crypto.randomBytes(5).toString('hex');

async function lgRoomPost(db, { agent, kind, text, ref } = {}, now) {
  try {
    const at = Number(now) || Date.now();
    const key = _key(at);
    await db.ref(ROOM + '/' + key).set({
      at,
      agent: String(agent || '').slice(0, 40),
      kind: KINDS.includes(kind) ? kind : 'info',
      text: String(text || '').slice(0, 500),
      ref: ref == null || ref === '' ? null : String(ref).slice(0, 200),
    });
    return key;
  } catch (e) {
    console.warn('agent-room: post failed', e && e.name);
    return null;
  }
}

module.exports = { lgRoomPost, ROOM };
