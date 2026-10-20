// ═══════════════════════════════════════════════════════════════════
//  api/_email-recipient.js — של איזה לקוח המייל שהגיע.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  אותו צורה כמו lgClientFromWaSender / lgClientFromWaGroup ב-
//  _wa-recipient.js, אבל המפתח הוא כתובת השולח ולא מספר טלפון.
//
//  ⚠️ לא מנחשים. כתובת שמופיעה בשני כרטיסים (שותפים, משרד ומחסן) נשארת
//  "ambiguous" ומשויכת ביד — סקיצה שנחתה אצל הלקוח הלא נכון מופיעה
//  בפורטל שלו, וזה גרוע יותר מסקיצה בלי שיוך.
//
//  ⚠️ hashavshevetAccounts/<key>.email נשמר **גולמי** כפי שהוא בחשבשבת:
//  כמה כתובות מופרדות ב-; , או רווח, באותיות כלשהן. ההשוואה כאן מנרמלת
//  כל כתובת בנפרד — לא מנרמלים באחסון כדי לא לאבד את מה שהוזן.
// ═══════════════════════════════════════════════════════════════════

const { norm } = require('./_wa-recipient.js');

//  '"Dana" <Dana@X.com>' → 'dana@x.com'. כל דבר שאינו כתובת → ''.
function lgEmailAddr(raw) {
  const s = String(raw || '');
  const m = /<([^<>]*)>/.exec(s);
  const a = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(a) ? a : '';
}

//  מחזיר { matched, via, email, phone, loginPhone, customerId, name, candidates? }.
//  via: 'email' | 'ambiguous' | 'none'. loginPhone = מפתח users כשנמצא שם.
async function lgClientFromEmail(db, from) {
  const email = lgEmailAddr(from);
  const none = { matched: false, via: 'none', email, phone: '', loginPhone: '', customerId: '', name: '' };
  if (!email) return none;

  const all = (await db.ref('hashavshevetAccounts').once('value')).val() || {};
  const hits = Object.entries(all).filter(([, a]) => a && String(a.email || '')
    .split(/[;,\s]+/).some(e => lgEmailAddr(e) === email));
  if (hits.length > 1) return { ...none, via: 'ambiguous', candidates: hits.length };
  if (hits.length !== 1) return none;

  const [key, card] = hits[0];
  const customerId = String(card.key || key);
  // משתמש הפורטל של הלקוח — כמו ב-lgClientFromWaGroup, כדי שהסקיצה תופיע אצלו
  const users = (await db.ref('users').once('value')).val() || {};
  const login = Object.keys(users).find(k => users[k] && String(users[k].customerId || '') === customerId) || '';
  const u = users[login] || {};
  return {
    matched: true, via: 'email', email,
    phone: login || norm(card.phone),
    loginPhone: login, customerId,
    // אותו כלל כמו lgClientFromWaSender: שם העסק של המשתמש, אחרת שם הכרטיס
    name: String((u.businessName || '').trim() || u.name || card.name || ''),
  };
}

module.exports = { lgEmailAddr, lgClientFromEmail };
