// ═══════════════════════════════════════════════════════════════════
//  api/_inbox-common.js — מה שמשותף לתיבות הקליטה (WhatsApp, מייל).
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  הוצא מ-_wa-inbound.js ב-20/10 כשנוספה קליטת המייל (_email-inbound.js).
//  כל פונקציה מקבלת את נתיב התיבה ('waInbound' / 'emailInbound') כפרמטר,
//  ולכן יש עותק אחד של כל כלל — ולא שניים שנפרדים בשקט.
//
//  ⚠️ ההתנהגות עבור WhatsApp זהה לגמרי למה שהיה. אל תשנה כאן כלל בלי
//  להריץ את בדיקות WhatsApp (test-wa-inbound, -panel, -groups, -text-inbound).
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

//  ⚠️ "התפיסה עדיין שלי?" — נבדק בטרנזקציה ממש לפני כל כתיבה.
//
//  CLAIM_TTL_MS (2 דק') ארוך מ-maxDuration (60 שניות), ולכן בפועל מעבד
//  לא אמור לחיות אחרי שהתפיסה שלו פגה. אבל "לא אמור" אינו ערובה: מעבד
//  שנתקע, תפיסה שפגה, ומעבד שני שסיים — ואז הראשון מתעורר וכותב. מזהה
//  ההזמנה דטרמיניסטי ולכן לא תיווצר **הזמנה שנייה**, אבל הכתיבה המאוחרת
//  הייתה דורסת את ההזמנה הקיימת — כולל sketchSeenAt של מי שכבר עבר עליה —
//  או הופכת done ל-failed. כאן זה נעצר.
//
//  touch: מה לכתוב ברשומה אם היא עדיין שלי (null = רק לבדוק ולרענן).
async function lgInboxStillMine(db, inbox, key, token, now, touch) {
  const r = await db.ref(inbox + '/' + key).transaction(cur => {
    if (cur === null) return null;                                   // null-first
    if (cur.state !== 'processing' || cur.claimToken !== token) return;   // abort — לא שלי
    const next = { ...cur, claimedAt: now, updatedAt: now, ...(touch || {}) };
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
    return next;
  });
  return !!(r.committed && r.snapshot.val());
}

// ─── מספר הזמנה — פעם אחת לקליטה ────────────────────────────────────
//  refNum נשמר ברשומה לפני הכתיבה, ו-retry משתמש בו שוב — אחרת כל ניסיון
//  היה שורף מספר.
async function lgInboxRefNum(db, inbox, key, entry) {
  if (entry.refNum) return entry.refNum;
  // אותה נוסחה בדיוק כמו lgNextOrderNum בדפדפן
  const c = await db.ref('meta/orderCounter').transaction(cur => Math.max(cur || 0, 999) + 1);
  const mine = 'L' + c.snapshot.val();
  const r = await db.ref(inbox + '/' + key + '/refNum').transaction(cur => (cur === null ? mine : undefined));
  // מישהו קדם לנו — המספר שלו גובר, ושלנו מתבזבז (נדיר, ועדיף על כפילות)
  return r.committed ? mine : r.snapshot.val();
}

// ─── פעולות אדמין ───────────────────────────────────────────────────
//  שורת audit חדשה, בלי לדרוס את הקודמות. המפתח ייחודי גם לשתי פעולות
//  באותה מילישנייה.
const lgInboxAudit = (cur, t, entry) => ({
  ...(cur.audit || {}),
  [t + '_' + entry.action + '_' + crypto.randomBytes(3).toString('hex')]: { at: t, ...entry },
});
//  בטרנזקציה null לא מוחק שדה כמו ב-update — מוחקים ביד
const lgInboxDropNulls = o => { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };

module.exports = { lgInboxStillMine, lgInboxRefNum, lgInboxAudit, lgInboxDropNulls };
