// סרטון 09 — איך מוצאים איפה הזמנה נמצאת: החיפוש בדף אופטי-ווי (בן, 24/11).
// opty.html, לשונית "🔍 חיפוש": מספר הזמנה / לקוח / מידה / כמה יחד; גם זכוכית שלא במערכת ("לא במערכת").
import { CLOCK, DAY, users, item, order } from '../lib/seedlib.js';

export const meta = { id: '09', file: '09 - חיפוש הזמנה באופטי-ווי', title: 'איפה ההזמנה? חיפוש באופטי-ווי', viewport: { w: 1600, h: 900 } };

const iso = d => new Date(CLOCK + d * DAY).toISOString().slice(0, 10);
const cut = (d, marked) => ({ at: iso(d), job: '', ...(marked ? { marked: true } : {}) });
const glass = (w, h, job, shape, c) => item('8SMH', w, h, { optyJob: job, optyShape: shape, optyCut: { ...c, job } });
const job = (j, d, list) => ({
  job: j, day: iso(d), mat: '08S', matName: '8 mm clear',
  sheets: [{ count: 1, pieces: list.map((p, i) => ({ order: i + 1, pos: i + 1, shape: p.shape || '', w: p.w + 2, h: p.h + 2 })) }],
  pieces: Object.fromEntries(list.map((p, i) => [i + 1, { client: p.client, name: p.name, w: p.w + 2, h: p.h + 2 }])),
});

export function seed() {
  const orders = {
    s9401: order('s9401', 'L9401', 'galil', { stage: 'chisum', status: 'בחיסום', sketchName: 'מקלחון הורים', createdAt: CLOCK - 3 * DAY,
      items: [glass(885, 1985, 'M09101', '901001', cut(-1, true)), glass(600, 1985, 'M09101', '901002', cut(-1, true))] }),
    s9402: order('s9402', 'L9402', 'sharon', { stage: 'workday', status: 'בייצור', sketchName: 'אמבטיה', createdAt: CLOCK - 2 * DAY,
      items: [glass(900, 2000, 'M09102', '902001', cut(0))] }),
    s9403: order('s9403', 'L9403', 'david', { stage: 'done', status: 'מוכן לאיסוף', sketchName: 'חלון סלון', createdAt: CLOCK - 6 * DAY,
      items: [glass(700, 1200, 'M09090', '903001', cut(-3, true))] }),
    s9404: order('s9404', 'L9404', 'tzafon', { stage: 'drafter', status: 'אצל שרטט', sketchName: 'דלת כניסה', createdAt: CLOCK - DAY,
      items: [item('8SMH', 780, 1985)] }),
  };
  const optyJobs = {
    M09090: job('M09090', -3, [{ shape: '903001', w: 700, h: 1200, client: 'אלומיניום דוד', name: 'חלון' }]),
    M09101: job('M09101', -1, [{ shape: '901001', w: 885, h: 1985, client: 'זגגות הגליל', name: 'הורים' },
                               { shape: '901002', w: 600, h: 1985, client: 'זגגות הגליל', name: 'הורים' },
                               { w: 500, h: 1985, client: 'זגגות הים', name: 'כהן' }]),
    M09102: job('M09102', 0, [{ shape: '902001', w: 900, h: 2000, client: 'מקלחוני השרון', name: 'אמבטיה' },
                              { w: 800, h: 1900, client: 'זגגות הים', name: 'לוי' }]),
  };
  return { __clock: CLOCK, __session: '0500000000', db: { users: users(), orders, meta: { optyJobs } } };
}

export async function script(r) {
  r.card({ kind: 'title', title: 'איפה ההזמנה?', sub: 'חיפוש בדף אופטי-ווי · לכל העובדים',
    bullets: ['מחפשים לפי **מספר הזמנה, שם לקוח או מידה** — או כמה יחד', 'רואים **מתי נחתך** ו**איפה זה עכשיו**', 'גם זכוכית שעוד **לא במערכת**'] });

  await r.open('opty.html', { wait: '#hQ' });
  await r.show({ focus: ['.tabs', '.hbar'], mark: '#hQ',
    text: 'נכנסים ל**אופטי-ווי**. למעלה **🔍 חיפוש** — ושורת חיפוש אחת. זה כל מה שצריך.', hold: 5 });

  r.chapter('לפי מספר הזמנה');
  await r.type({ target: '#hQ', value: 'L9401', focus: '.hbar', text: 'מקלידים את **מספר ההזמנה**.' });
  await r.show({ focus: '#hubOut .hord', mark: '#hubOut .hord header',
    text: 'הכרטיס של ההזמנה: מספר, לקוח, שם הסקיצה — ותגית קטנה **"במערכת"**.', hold: 4.5 });
  await r.show({ focus: '#hubOut .hord', mark: { sel: '#hubOut .hcut', nth: 0 },
    text: 'בכל זכוכית — **מתי נחתכה**: ✂ נחתך + היום והתאריך.', hold: 4.5 });
  await r.show({ focus: '#hubOut .hord', mark: { sel: '#hubOut .hit .pill', nth: 0 },
    text: 'ומימין — **איפה היא עכשיו**: כאן **בחיסום**. ככה יודעים בדיוק מה לענות ללקוח.', hold: 5 });
  await r.click({ target: { sel: '#hubOut .hit .hdim', nth: 0 }, focus: '#hubOut .hord',
    text: 'רוצים עוד פרטים? לוחצים על הזכוכית.',
    after: 'נפתח מספר האופטימיזציה, מספר הצורה, והכפתורים **📐 צורה** ו**ללוח**. לחיצה נוספת סוגרת.', afterMark: { sel: '#hubOut .hx', nth: 0 } });

  r.chapter('לפי שם לקוח');
  await r.type({ target: '#hQ', value: 'השרון', focus: '.hbar', text: 'אפשר גם **חלק משם הלקוח**.' });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hord',
    text: 'כל ההזמנות של הלקוח. כאן: **⏳ לחיתוך היום**, והמצב — **מתוכנן לחיתוך**.', hold: 5 });

  r.chapter('לפי מידה');
  await r.type({ target: '#hQ', value: '1985', focus: '.hbar', text: 'יש רק מידה? מקלידים **מספר אחד מהמידה**.' });
  await r.show({ focus: '#hubOut', wide: false, mark: '#hubOut .hsum',
    text: 'מופיע כל מה שיש בו 1985 — **הזמנות במערכת**, וגם **זכוכיות שלא במערכת**.', hold: 5 });
  await r.show({ focus: '#hubOut .hord.out', mark: '#hubOut .hord.out .htag',
    text: 'כרטיס עם קו מקווקו ותגית **"לא במערכת"** = זכוכית שנחתכה באופטי-ווי, אבל אין לה הזמנה אצלנו. גם לה רואים **מתי נחתכה** ו**מה המצב**.', hold: 6.5 });

  r.chapter('כמה פרמטרים יחד');
  await r.type({ target: '#hQ', value: '1985 הים', focus: '.hbar', text: 'יותר מדי תוצאות? מוסיפים עוד מילה — **מידה + לקוח**.' });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hord',
    text: 'נשאר רק מה שמתאים **לשניהם**. אפשר לשלב: מידה, לקוח, שם סקיצה, מספר הזמנה.', hold: 5 });
  await r.type({ target: '#hQ', value: '885x1985', focus: '.hbar', text: 'מידה מלאה? כותבים **רוחב x גובה**.' });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hit.on',
    text: 'הזכוכית שמתאימה **מודגשת בצהוב**.', hold: 4.5 });

  r.card({ title: 'לסיכום', bullets: ['🔍 חיפוש → מקלידים **מספר הזמנה / לקוח / מידה**', '✂ = **מתי נחתך** · התגית הצבעונית = **איפה עכשיו**',
    '"במערכת" / **"לא במערכת"** — רשום בקטן על כל כרטיס', 'לא מצאת? נסה רק מספר אחד מהמידה, או חלק מהשם'] });
}
