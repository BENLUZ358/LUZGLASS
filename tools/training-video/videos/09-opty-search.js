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
  //  בן, 24/11: קצר ומעשי — בלי פתיחה ארוכה, מראים איך מגיעים לדף ואז מחפשים
  await r.open('admin.html', { wait: '#unavSidebar a[href="opty.html"]' });
  await r.show({ focus: '#unavSidebar', mark: '#unavSidebar a[href="opty.html"]',
    text: 'בתפריט, למטה תחת **הגדרות** — לוחצים **אופטי-ווי**.', hold: 3.2 });

  await r.open('opty.html', { wait: '#hQ' });
  await r.type({ target: '#hQ', value: 'L9401', focus: '.hbar', text: 'בשורת החיפוש מקלידים **מספר הזמנה**.' });
  await r.show({ focus: '#hubOut .hord', mark: ['#hubOut .hcut', '#hubOut .hit .pill'],
    text: '✂ **מתי נחתך** · התגית מימין = **איפה זה עכשיו** (כאן: בחיסום).', hold: 4 });

  await r.type({ target: '#hQ', value: 'השרון', focus: '.hbar', text: 'או **חלק משם הלקוח**.', hold: 1.2 });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hord', text: '⏳ לחיתוך היום · **מתוכנן לחיתוך**.', hold: 3 });

  await r.type({ target: '#hQ', value: '1985', focus: '.hbar', text: 'או **מספר מהמידה**.', hold: 1.2 });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hord.out .htag',
    text: 'מופיע גם מה ש**לא במערכת** (קו מקווקו) — עם מתי נחתך ומה המצב.', hold: 4 });

  await r.type({ target: '#hQ', value: '1985 הים', focus: '.hbar', text: 'הרבה תוצאות? **מידה + לקוח** יחד.', hold: 1.2 });
  await r.show({ focus: '#hubOut', mark: '#hubOut .hord', text: 'נשאר רק מה שמתאים לשניהם. זהו!', hold: 3 });
}
