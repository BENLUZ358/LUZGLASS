// ═══════════════════════════════════════════════════════════════════
//  api/_hook-token.js — בדיקת הסוד של endpoint שנקרא מבחוץ, בלי אדמין.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//  הוצא מ-wa-inbound.js ב-20/10 כשנוסף email-inbound — שני endpoints עם
//  סוד, ושני עותקים של הבדיקה היו בדיוק המקום שבו תיקון אחד נשכח בשני
//  (ר' 15/10 למטה: שני תיקונים בלילה אחד).
//
//    lgHookTokenOk(header, secret) → boolean
//
//  header = כותרת Authorization כפי שהגיעה; secret = הסוד מ-Vercel.
//  לא הוגדר סוד (או שהוא רק "Bearer") → אף אחד לא נכנס.
//  לעולם לא נרשמים ללוג: הסוד או הכותרת.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

//  הסוד עצמו, בלי "Bearer" ובלי רווחים. 15/10: בייצור כל webhook חזר 401 —
//  הסוד ב-Vercel ובשדה של GREEN API הוקלדו ידנית בטלפון, ו-"Bearer " או רווח
//  בצד אחד הספיקו כדי שאף הודעה לא תיכנס. משווים את הסוד, לא את העטיפה.
//  ובאותו לילה, גם אחרי זה — 401: הסוד הודבק בטלפון בדף בעברית, והאייפון
//  הכניס סימני כיוון בלתי נראים (U+200E/U+200F). הסוד הוא ASCII גלוי בלבד,
//  אז כל תו אחר — רווח, סימן כיוון, רווח צר-אפס — אינו חלק ממנו.
function _bare(s) {
  return String(s || '').replace(/[^\x21-\x7E]+/g, ' ').trim()
    .replace(/^bearer\s+/i, '').replace(/\s+/g, '');
}

//  השוואה בזמן קבוע. גיבוב קודם, כדי שגם האורך לא ידלוף.
function lgHookTokenOk(header, secret) {
  const want = _bare(secret);
  if (!want || /^bearer$/i.test(want)) return false;
  const got = _bare(header);
  const h = s => crypto.createHash('sha256').update(s).digest();
  const ok = crypto.timingSafeEqual(h(got), h(want));
  //  כשנדחה — רק אורכים וסימן לתווים נסתרים, לעולם לא הסוד עצמו. בלי זה
  //  ביומן של Vercel רואים 401 ולא יודעים איזה צד שונה.
  if (!ok) console.warn('hook-token: rejected', { gotLen: got.length, wantLen: want.length,
    hidden: /[^\x20-\x7E]/.test(String(header || '') + String(secret || '')) });
  return ok;
}

module.exports = { lgHookTokenOk };
