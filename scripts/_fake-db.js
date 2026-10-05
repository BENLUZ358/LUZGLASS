//  בסיס נתונים מדומה עם טרנזקציות, לשימוש בדיקות.
//
//  ⚠️ מדמה את הסמנטיקה שבאמת חשובה: transaction נקראת **פעמיים** —
//  תחילה עם הערך שבמטמון המקומי (null) ורק אחר כך עם הערך מהשרת.
//  הכפיל הקודם קרא פעם אחת עם הערך האמיתי, ולכן אחת-עשרה בדיקות
//  idempotency עברו על קוד ששום תפיסה בו לא עבדה בפועל. ר' lgWaClaim.
//
//  הוצא לקובץ משלו ב-05/10 כשנוספו בדיקות הניתוק — שני עותקים של הכפיל
//  היו בדיוק מקור האמת הכפול שהפרויקט הזה נכווה בו שוב ושוב.

function fakeDb(initial) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  const keys = p => String(p).split('/').filter(Boolean);
  const get  = p => keys(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const put  = (p, v) => {
    const ks = keys(p); let o = data;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const snapOf = (v, order) => ({
    val: () => (v === undefined ? null : v),
    exists: () => v !== undefined,
    forEach(cb) {
      // מסודר לפי createdAt כברירת מחדל, או לפי סדר השאילתה כשיש כזו
      (order || Object.keys(v || {})
        .sort((a, b) => ((v[a] || {}).createdAt || 0) - ((v[b] || {}).createdAt || 0)))
        .forEach(k => cb({ key: k, val: () => v[k] }));
    },
  });
  //  ⚠️ שאילתה אמיתית, לא קישוט. הכפיל הקודם החזיר את self מ-limitToFirst
  //  והחזיר את **כל** הילדים — ולכן אף בדיקה לא ראתה מה קורה כשהתור
  //  ארוך מה-limit. בדיוק שם הסתתר הבאג של lgWaPending (2026-10-04).
  //  סמנטיקה כמו RTDB: orderByChild ממיין לפי ערך הילד ואז לפי המפתח,
  //  equalTo מסנן, limitToFirst חותך אחרי הסינון.
  function runQuery(v, q) {
    if (v == null || typeof v !== 'object' || !q.by) return snapOf(v);
    const cv = k => (v[k] || {})[q.by];
    const rank = x => x == null ? 0 : typeof x === 'boolean' ? 1 : typeof x === 'number' ? 2 : 3;
    const cmp = (a, b) => {
      const x = cv(a), y = cv(b);
      if (rank(x) !== rank(y)) return rank(x) - rank(y);
      if (x !== y) return x < y ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    };
    let keys = Object.keys(v).sort(cmp);
    if ('eq' in q) keys = keys.filter(k => cv(k) === q.eq);
    if (q.limit != null) keys = keys.slice(0, q.limit);
    const out = {}; keys.forEach(k => { out[k] = v[k]; });
    return snapOf(keys.length ? out : undefined, keys);
  }
  return {
    _data: data,
    ref(p) {
      const q = {};
      const self = {
        orderByChild: c => { q.by = c; return self; },
        equalTo:      x => { q.eq = x; return self; },
        limitToFirst: n => { q.limit = n; return self; },
        once: async () => runQuery(get(p), q),
        set:  async v => put(p, v),
        //  כמו RTDB: מפתח עם '/' הוא נתיב, והעדכון רב-נתיבי ואטומי. null
        //  מוחק. ref() בלי נתיב הוא השורש — כך נכתבת הזמנה + סקיצה יחד.
        update: async v => {
          const base = keys(p || '').join('/');
          if (!base || Object.keys(v).some(k => k.includes('/'))) {
            for (const [k, x] of Object.entries(v)) put((base ? base + '/' : '') + k, x);
            return;
          }
          put(p, { ...(get(p) || {}), ...v });
        },
        //  ⚠️ פיירבייס קוראת לפונקציה **פעמיים**: תחילה עם הערך שבמטמון
        //  המקומי — שהוא null — ורק אחר כך עם הערך מהשרת. פונקציה שמחזירה
        //  undefined בקריאה הראשונה מבטלת את הטרנזקציה כולה, ופיירבייס
        //  לעולם לא מביאה את הערך האמיתי.
        //
        //  הכפיל הקודם קרא פעם אחת בלבד, עם הערך האמיתי. הוא היה נדיב מדי,
        //  ולכן אחת-עשרה בדיקות idempotency עברו על קוד ששום תפיסה בו לא
        //  עבדה בפועל. L9005 נתקעה בתור בגלל בדיוק זה.
        async transaction(fn) {
          const first = fn(null);
          if (first === undefined) return { committed: false, snapshot: snapOf(undefined) };
          const cur  = get(p);
          const next = fn(cur === undefined ? null : cur);
          if (next === undefined) return { committed: false, snapshot: snapOf(cur) };
          put(p, next); return { committed: true, snapshot: snapOf(next) };
        },
      };
      return self;
    },
  };
}

module.exports = { fakeDb };
