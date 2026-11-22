// node scripts/test-change-password.js
const { lgPwCheck, lgPwErrorText } = require('../change-password.js');
const fs = require('fs'), path = require('path');
let bad = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' got ' + JSON.stringify(got))); };

check('empty current', lgPwCheck('', 'abcdef', 'abcdef'), 'צריך להקליד את הסיסמה הנוכחית');
check('short new', lgPwCheck('old123', 'abc', 'abc'), 'הסיסמה החדשה צריכה להיות לפחות 6 תווים');
check('mismatch', lgPwCheck('old123', 'abcdef', 'abcdeg'), 'הסיסמה החדשה לא זהה בשתי הפעמים');
check('same as old', lgPwCheck('abcdef', 'abcdef', 'abcdef'), 'הסיסמה החדשה זהה לנוכחית');
check('good', lgPwCheck('old123', 'new456', 'new456'), '');
check('wrong password', lgPwErrorText({ code: 'auth/wrong-password' }), 'הסיסמה הנוכחית לא נכונה');
check('invalid credential (v9)', lgPwErrorText({ code: 'auth/invalid-login-credentials' }), 'הסיסמה הנוכחית לא נכונה');
check('too many', lgPwErrorText({ code: 'auth/too-many-requests' }), 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות');
check('unknown', lgPwErrorText({}), 'משהו השתבש. נסה שוב');

const root = path.join(__dirname, '..');
for (const f of ['portal.html', 'admin.html']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  check(f + ' loads change-password.js', /<script src="change-password\.js\?v=\w+"><\/script>/.test(s), true);
  check(f + ' has the button', s.includes('lgOpenChangePassword()'), true);
}
console.log(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
