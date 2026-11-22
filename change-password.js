// שינוי סיסמה — כל משתמש מחובר משנה לעצמו (בן, 22/11)
//
// הסיסמה חיה רק ב-Firebase Auth (אין שדה password ב-RTDB), לכן השינוי הוא
// reauthenticate עם הסיסמה הנוכחית ואז updatePassword. הסיסמה הנוכחית נדרשת
// גם כי Firebase מסרב לשנות סיסמה בלי התחברות טרייה, וגם כדי שמי שמוצא
// טלפון פתוח לא יוכל להחליף סיסמה. אין שינוי בכללי האבטחה של הנתונים.

// בדיקת השדות לפני שפונים לשרת. מחזיר '' כשהכול תקין, אחרת הודעה בעברית.
function lgPwCheck(cur, next, again) {
  if (!String(cur || '')) return 'צריך להקליד את הסיסמה הנוכחית';
  const n = String(next || '');
  if (n.length < 6) return 'הסיסמה החדשה צריכה להיות לפחות 6 תווים';
  if (n !== String(again || '')) return 'הסיסמה החדשה לא זהה בשתי הפעמים';
  if (n === String(cur)) return 'הסיסמה החדשה זהה לנוכחית';
  return '';
}

// קוד שגיאה של Firebase → הודעה פשוטה
function lgPwErrorText(e) {
  const c = String((e && e.code) || '');
  if (/wrong-password|invalid-credential|invalid-login-credentials/.test(c)) return 'הסיסמה הנוכחית לא נכונה';
  if (/weak-password/.test(c)) return 'הסיסמה החדשה חלשה מדי — לפחות 6 תווים';
  if (/too-many-requests/.test(c)) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות';
  if (/network-request-failed|lg\/timeout/.test(c)) return 'אין חיבור לאינטרנט. נסה שוב';
  if (/requires-recent-login|user-mismatch|user-token-expired/.test(c)) return 'צריך לצאת ולהיכנס מחדש, ואז לנסות שוב';
  return 'משהו השתבש. נסה שוב';
}

async function lgChangePassword(cur, next) {
  const u = firebase.auth().currentUser;
  if (!u || !u.email) { const e = new Error('no user'); e.code = 'user-token-expired'; throw e; }
  const cred = firebase.auth.EmailAuthProvider.credential(u.email, cur);
  await u.reauthenticateWithCredential(cred);
  await u.updatePassword(next);
}

function lgOpenChangePassword() {
  if (document.getElementById('lgPwBox')) return;
  const wrap = document.createElement('div');
  wrap.id = 'lgPwBox';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'lgPwTitle');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;font-family:Heebo,sans-serif';
  const fld = (id, label, ac) => `<label style="display:block;margin:0 0 12px;font-size:14px;font-weight:600;color:#333">${label}
      <input id="${id}" type="password" autocomplete="${ac}" dir="ltr" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:11px 12px;font-size:16px;border:1px solid #bbb;border-radius:6px;font-family:inherit"></label>`;
  wrap.innerHTML = `<form id="lgPwForm" style="background:#fff;color:#222;width:100%;max-width:380px;border-radius:10px;padding:22px 20px;box-shadow:0 10px 40px rgba(0,0,0,.3)">
      <h2 id="lgPwTitle" style="margin:0 0 16px;font-size:19px">🔑 שינוי סיסמה</h2>
      ${fld('lgPwCur', 'סיסמה נוכחית', 'current-password')}
      ${fld('lgPwNew', 'סיסמה חדשה (לפחות 6 תווים)', 'new-password')}
      ${fld('lgPwNew2', 'שוב את הסיסמה החדשה', 'new-password')}
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;margin:-4px 0 12px;cursor:pointer"><input type="checkbox" id="lgPwShow"> הצג סיסמאות</label>
      <div id="lgPwMsg" role="status" aria-live="polite" style="min-height:20px;font-size:14px;font-weight:600;margin-bottom:12px"></div>
      <div style="display:flex;gap:10px">
        <button type="submit" id="lgPwGo" style="flex:1;min-height:46px;background:#1e7d3a;color:#fff;border:0;border-radius:6px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer">שמור סיסמה</button>
        <button type="button" id="lgPwCancel" style="min-height:46px;padding:0 18px;background:#eee;color:#333;border:0;border-radius:6px;font-size:15px;font-family:inherit;cursor:pointer">ביטול</button>
      </div></form>`;
  document.body.appendChild(wrap);
  const $ = id => document.getElementById(id);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
  $('lgPwCancel').onclick = close;
  $('lgPwShow').onchange = ev => ['lgPwCur', 'lgPwNew', 'lgPwNew2'].forEach(id => { $(id).type = ev.target.checked ? 'text' : 'password'; });
  const say = (t, ok) => { const m = $('lgPwMsg'); m.textContent = t; m.style.color = ok ? '#1e7d3a' : '#b3261e'; };
  $('lgPwForm').onsubmit = async ev => {
    ev.preventDefault();
    const cur = $('lgPwCur').value, nw = $('lgPwNew').value, again = $('lgPwNew2').value;
    const bad = lgPwCheck(cur, nw, again);
    if (bad) { say(bad); return; }
    const go = $('lgPwGo'); go.disabled = true; go.textContent = 'שומר…'; say('');
    try {
      await lgChangePassword(cur, nw);
      say('✓ הסיסמה שונתה. בפעם הבאה נכנסים עם הסיסמה החדשה', true);
      go.textContent = '✓ נשמר';
      $('lgPwCancel').textContent = 'סגור';
      setTimeout(close, 2500);
    } catch (e) {
      console.warn('[change-password]', e && e.code);
      say(lgPwErrorText(e));
      go.disabled = false; go.textContent = 'שמור סיסמה';
    }
  };
  setTimeout(() => $('lgPwCur').focus(), 30);
}

if (typeof module !== 'undefined') module.exports = { lgPwCheck, lgPwErrorText };
